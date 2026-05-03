"""Account management endpoints (/account/*) — profile, email, delete, export."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response

from app_core.db import db
from app_core.deps import (
    now_utc, verify_password, get_current_user, sanitize_user,
)
from app_core.models import (
    UpdateProfileIn, UpdateEmailIn, DeleteAccountIn,
)

router = APIRouter(tags=["account"])
logger = logging.getLogger("innfeel.account")


@router.patch("/account/profile")
async def update_profile(data: UpdateProfileIn, user: dict = Depends(get_current_user)):
    """Update the user's display name (pseudo). Email changes go through /account/email."""
    update: dict = {}
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        update["name"] = name
    if not update:
        return {"ok": True, "user": sanitize_user(user)}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": sanitize_user(fresh)}


@router.post("/account/email")
async def update_email(data: UpdateEmailIn, user: dict = Depends(get_current_user)):
    """Change email. Requires current password and a verified current address."""
    # Block email changes until the CURRENT email is verified (prevents address hopping).
    if not user.get("email_verified_at"):
        raise HTTPException(status_code=403, detail="Please verify your current email before changing it.")
    current = await db.users.find_one({"user_id": user["user_id"]})
    if not current or not verify_password(data.password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password")
    new_email = data.new_email.lower().strip()
    if new_email == current.get("email", "").lower():
        return {"ok": True, "user": sanitize_user(current)}
    existing = await db.users.find_one({"email": new_email})
    if existing and existing.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=409, detail="This email is already in use")
    # Reset verification status — the NEW email needs to be verified.
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email": new_email, "email_verified_at": None}},
    )
    await db.email_verifications.delete_many({"user_id": user["user_id"]})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": sanitize_user(fresh)}


@router.delete("/account")
async def delete_account(data: DeleteAccountIn, response: Response, user: dict = Depends(get_current_user)):
    """GDPR-compliant hard-delete of all user data.

    Requires password + typing "DELETE" as confirmation. Removes:
      users row · moods · reactions on own moods · comments · messages · conversations ·
      friendships (symmetric) · activity · iap_events · push_token · close_friends.
    """
    current = await db.users.find_one({"user_id": user["user_id"]})
    if not current or not verify_password(data.password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password")
    uid = user["user_id"]

    # Delete owned data
    await db.moods.delete_many({"user_id": uid})
    await db.messages.delete_many({"$or": [{"sender_id": uid}, {"recipient_id": uid}]})
    await db.conversations.delete_many({"participants": uid})
    await db.friendships.delete_many({"$or": [{"user_id": uid}, {"friend_id": uid}]})
    await db.activity.delete_many({"$or": [{"user_id": uid}, {"actor_id": uid}]})
    await db.iap_events.delete_many({"app_user_id": uid})
    await db.email_verifications.delete_many({"user_id": uid})
    # Remove reactions / comments this user made on other people's moods
    await db.moods.update_many({}, {"$pull": {"reactions": {"user_id": uid}}})
    await db.moods.update_many({}, {"$pull": {"comments": {"user_id": uid}}})
    # Finally remove the user document
    await db.users.delete_one({"user_id": uid})

    # Clear auth cookies
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    logger.info(f"Account deleted (GDPR) for user_id={uid}")
    return {"ok": True, "deleted": True}


@router.get("/account/export")
async def export_account(user: dict = Depends(get_current_user)):
    """GDPR Article 20 — data portability. Returns the user's data as JSON."""
    uid = user["user_id"]
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
    if u and isinstance(u.get("created_at"), datetime):
        u["created_at"] = u["created_at"].isoformat()
    if u and isinstance(u.get("pro_expires_at"), datetime):
        u["pro_expires_at"] = u["pro_expires_at"].isoformat()
    if u and isinstance(u.get("email_verified_at"), datetime):
        u["email_verified_at"] = u["email_verified_at"].isoformat()

    def _ser(rows):
        out = []
        for r in rows:
            r.pop("_id", None)
            for k, v in list(r.items()):
                if isinstance(v, datetime):
                    r[k] = v.isoformat()
            out.append(r)
        return out

    moods = _ser(await db.moods.find({"user_id": uid}).to_list(10000))
    friendships = _ser(await db.friendships.find({"user_id": uid}).to_list(5000))
    messages = _ser(await db.messages.find({"$or": [{"sender_id": uid}, {"recipient_id": uid}]}).to_list(50000))
    return {
        "exported_at": now_utc().isoformat(),
        "user": u,
        "moods": moods,
        "friendships": friendships,
        "messages": messages,
    }
