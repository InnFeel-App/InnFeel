"""Authentication + email-verification endpoints (/auth/*)."""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from app_core.db import db
from app_core.deps import (
    now_utc, hash_password, verify_password,
    create_access_token, create_refresh_token, set_auth_cookies,
    get_current_user, sanitize_user,
)
from app_core.email import send_verification_email, send_welcome_email
from app_core.models import (
    RegisterIn, LoginIn, SendVerificationIn, VerifyEmailIn,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger("innfeel.auth")

# --- Email verification configuration -----------------------------------
VERIF_CODE_TTL_MIN = 10
VERIF_MAX_ATTEMPTS = 5
VERIF_RESEND_COOLDOWN_SEC = 45


def _gen_otp() -> str:
    """Cryptographically random 6-digit code."""
    return f"{secrets.randbelow(10**6):06d}"


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


async def _issue_verification_code(user: dict, lang: str = "en") -> tuple[bool, Optional[int]]:
    """Generate & store a new OTP, then send it via Resend.

    Returns (sent_ok, cooldown_remaining_seconds). If the previous code is
    still within cooldown, returns (False, seconds_left) without resending.
    """
    now = now_utc()
    existing = await db.email_verifications.find_one({"user_id": user["user_id"]})
    if existing:
        last_sent = existing.get("last_sent_at")
        if isinstance(last_sent, datetime):
            if last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=timezone.utc)
            elapsed = (now - last_sent).total_seconds()
            if elapsed < VERIF_RESEND_COOLDOWN_SEC:
                return False, int(VERIF_RESEND_COOLDOWN_SEC - elapsed)
    code = _gen_otp()
    doc = {
        "user_id": user["user_id"],
        "email": user["email"],
        "code_hash": _hash_code(code),
        "attempts": 0,
        "expires_at": now + timedelta(minutes=VERIF_CODE_TTL_MIN),
        "last_sent_at": now,
        "lang": lang,
    }
    await db.email_verifications.update_one(
        {"user_id": user["user_id"]},
        {"$set": doc},
        upsert=True,
    )
    try:
        ok = await send_verification_email(user["email"], code, name=user.get("name", ""), lang=lang)
    except Exception as e:
        logger.warning(f"send_verification_email raised: {e}")
        ok = False
    if not ok:
        logger.warning(f"[dev] Verification code for {user['email']}: {code}")
    return ok, None


# --- Endpoints ----------------------------------------------------------
@router.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    colors = ["#60A5FA", "#FDE047", "#F472B6", "#A78BFA", "#2DD4BF", "#34D399", "#F97316"]
    doc = {
        "user_id": uid,
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name.strip(),
        "avatar_color": colors[uuid.uuid4().int % len(colors)],
        "pro": False,
        "friend_count": 0,
        "streak": 0,
        "created_at": now_utc(),
        # Remember the user's locale so we can localise future emails
        "lang": (data.lang or "en").lower()[:2],
        # Legal acceptance trace (GDPR proof of consent)
        "terms_accepted_at": now_utc() if bool(data.terms_accepted) else None,
        "terms_version": "2025-06-01" if bool(data.terms_accepted) else None,
    }
    await db.users.insert_one(doc)
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    # Fire off the first verification email (non-blocking UX — failures don't block registration)
    try:
        await _issue_verification_code(doc, lang=(data.lang or "en").lower()[:2])
    except Exception as e:
        logger.warning(f"Initial verification email failed for {email}: {e}")
    return {"user": sanitize_user(doc), "access_token": access, "refresh_token": refresh}


@router.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user["user_id"], email)
    refresh = create_refresh_token(user["user_id"])
    set_auth_cookies(response, access, refresh)
    return {"user": sanitize_user(user), "access_token": access, "refresh_token": refresh}


@router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return sanitize_user(user)


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.post("/auth/send-verification")
async def send_verification(data: SendVerificationIn, user: dict = Depends(get_current_user)):
    """(Re)send the 6-digit verification code to the authenticated user's email."""
    if user.get("email_verified_at"):
        return {"ok": True, "already_verified": True}
    lang = (data.lang or "en").lower()[:2]
    sent, cooldown = await _issue_verification_code(user, lang=lang)
    if cooldown:
        return {"ok": False, "cooldown_seconds": cooldown}
    return {"ok": True, "sent": sent, "cooldown_seconds": VERIF_RESEND_COOLDOWN_SEC}


@router.post("/auth/verify-email")
async def verify_email(data: VerifyEmailIn, user: dict = Depends(get_current_user)):
    """Check an OTP and mark the email verified if it matches."""
    if user.get("email_verified_at"):
        return {"ok": True, "already_verified": True, "user": sanitize_user(user)}
    row = await db.email_verifications.find_one({"user_id": user["user_id"]})
    if not row:
        raise HTTPException(status_code=400, detail="No pending verification. Request a new code.")
    exp = row.get("expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now_utc():
            await db.email_verifications.delete_one({"user_id": user["user_id"]})
            raise HTTPException(status_code=400, detail="Code expired. Request a new one.")
    if int(row.get("attempts", 0)) >= VERIF_MAX_ATTEMPTS:
        await db.email_verifications.delete_one({"user_id": user["user_id"]})
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")
    submitted = (data.code or "").strip().replace(" ", "").replace("-", "")
    if _hash_code(submitted) != row.get("code_hash"):
        await db.email_verifications.update_one(
            {"user_id": user["user_id"]}, {"$inc": {"attempts": 1}}
        )
        remaining = max(0, VERIF_MAX_ATTEMPTS - int(row.get("attempts", 0)) - 1)
        raise HTTPException(status_code=400, detail=f"Incorrect code. {remaining} attempts left.")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_verified_at": now_utc()}},
    )
    await db.email_verifications.delete_one({"user_id": user["user_id"]})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    # Ship the one-shot welcome email (idempotent via welcome_email_sent_at flag).
    # Non-blocking: a failure here must not break the verification response.
    if fresh and not fresh.get("welcome_email_sent_at"):
        try:
            lang = (fresh.get("lang") or "en").lower()[:2]
            sent = await send_welcome_email(fresh["email"], name=fresh.get("name", ""), lang=lang)
            if sent:
                await db.users.update_one(
                    {"user_id": user["user_id"]},
                    {"$set": {"welcome_email_sent_at": now_utc()}},
                )
        except Exception as e:
            logger.warning(f"Welcome email send failed for {fresh.get('email')}: {e}")
    return {"ok": True, "user": sanitize_user(fresh)}
