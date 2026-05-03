"""Shared authentication + helper dependencies."""
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import HTTPException, Request, Response
from .db import db
from .config import JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_key(d: Optional[datetime] = None) -> str:
    """Return the key for the current "aura day".

    An aura day runs from 12:00 UTC to 12:00 UTC the next day — so an aura
    posted at 2 PM Monday is still visible until noon Tuesday. This gives
    users a full ~24h window, aligned with a noon daily reminder.
    """
    d = d or now_utc()
    # shift 12h back: so before noon UTC we're still "yesterday's day"
    anchor = d - timedelta(hours=12)
    return anchor.strftime("%Y-%m-%d")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": now_utc() + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": now_utc() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie(
        "access_token", access, httponly=True, secure=True,
        samesite="none", max_age=ACCESS_TOKEN_TTL_MINUTES * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=True,
        samesite="none", max_age=REFRESH_TOKEN_TTL_DAYS * 86400, path="/",
    )


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def is_pro(user: dict) -> bool:
    if not user.get("pro"):
        return False
    exp = user.get("pro_expires_at")
    if exp is None:
        return False
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp)
        except Exception:
            return False
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp > now_utc()


def sanitize_user(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "avatar_color": u.get("avatar_color", "#A78BFA"),
        "avatar_b64": u.get("avatar_b64"),
        "pro": is_pro(u),
        "pro_expires_at": u.get("pro_expires_at").isoformat() if isinstance(u.get("pro_expires_at"), datetime) else u.get("pro_expires_at"),
        "pro_source": u.get("pro_source"),  # e.g. "admin_grant" / "stripe" / "iap_apple" / "iap_google" / "dev"
        "is_admin": bool(u.get("is_admin", False)),
        "friend_count": u.get("friend_count", 0),
        "streak": u.get("streak", 0),
        "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
    }
