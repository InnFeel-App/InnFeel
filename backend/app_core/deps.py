"""Shared authentication + helper dependencies."""
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import HTTPException, Request, Response
from .db import db
from .config import JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover — defensive for very old Python
    ZoneInfo = None  # type: ignore


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_key(d: Optional[datetime] = None, tz: Optional[str] = None) -> str:
    """Return the key for the current "aura day".

    The aura day rolls over at **local noon** in the user's timezone:
      - 11:59 local → still yesterday's key
      - 12:00 local → today's key
    This gives users a full ~24h window aligned with their local noon
    reminder. If `tz` is omitted or invalid, falls back to UTC noon
    (legacy behavior, preserves old day_keys).
    """
    d = d or now_utc()
    if tz and ZoneInfo is not None:
        try:
            local = d.astimezone(ZoneInfo(tz))
            # Shift 12h back: anything before noon local is still "yesterday".
            anchor = local - timedelta(hours=12)
            return anchor.strftime("%Y-%m-%d")
        except Exception:
            pass
    # UTC fallback
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
        # Lazy timezone sync — frontend sends `X-Tz: Europe/Paris` (IANA name)
        # on every request. If it differs from what's stored, persist it.
        # This keeps `today_key(tz=user["tz"])` aligned with the user's
        # actual local clock (e.g. when they travel) without a dedicated
        # endpoint round-trip. The validation is cheap: we only accept
        # tz names that ZoneInfo can resolve.
        tz_hdr = request.headers.get("x-tz") or request.headers.get("X-Tz")
        if tz_hdr and isinstance(tz_hdr, str) and 2 <= len(tz_hdr) <= 64 and tz_hdr != user.get("tz"):
            if ZoneInfo is not None:
                try:
                    ZoneInfo(tz_hdr)  # validate
                    await db.users.update_one(
                        {"user_id": user["user_id"]},
                        {"$set": {"tz": tz_hdr}},
                    )
                    user["tz"] = tz_hdr
                except Exception:
                    pass  # invalid tz name — ignore silently
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
    avatar_url = None
    try:
        k = u.get("avatar_key")
        if k:
            from . import r2 as _r2  # local import to avoid circulars at module load
            avatar_url = _r2.generate_get_url(k)
    except Exception:
        avatar_url = None
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "avatar_color": u.get("avatar_color", "#A78BFA"),
        "avatar_b64": u.get("avatar_b64"),
        "avatar_key": u.get("avatar_key"),
        "avatar_url": avatar_url,
        "pro": is_pro(u),
        "pro_expires_at": u.get("pro_expires_at").isoformat() if isinstance(u.get("pro_expires_at"), datetime) else u.get("pro_expires_at"),
        "pro_source": u.get("pro_source"),  # e.g. "admin_grant" / "stripe" / "iap_apple" / "iap_google" / "dev"
        "zen": bool(u.get("zen", False)),
        "is_admin": bool(u.get("is_admin", False)),
        "is_owner": bool(u.get("is_owner", False)),
        "friend_count": u.get("friend_count", 0),
        "streak": u.get("streak", 0),
        "tz": u.get("tz"),
        "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
        "email_verified_at": u.get("email_verified_at").isoformat() if isinstance(u.get("email_verified_at"), datetime) else u.get("email_verified_at"),
    }
