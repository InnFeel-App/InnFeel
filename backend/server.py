from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import json
import hashlib
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Body
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    CheckoutSessionRequest,
)
from emergentintegrations.llm.chat import LlmChat, UserMessage

# Shared infrastructure (moved out of this file for maintainability)
from app_core.config import (
    STRIPE_API_KEY, EMERGENT_LLM_KEY,
    JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS,
)
from app_core.constants import EMOTIONS, PRO_PRICE_USD
from app_core.db import client, db
from app_core.deps import (
    now_utc, today_key,
    hash_password, verify_password,
    create_access_token, create_refresh_token, set_auth_cookies,
    get_current_user, is_pro, sanitize_user,
)
from app_core.models import (
    RegisterIn, LoginIn, EMOTION_LITERAL, MusicTrackIn, InnFeelIn,
    AvatarIn, ReactionIn, CommentIn, MessageIn, AddFriendIn,
    CheckoutIn, AdminGrantProIn, AdminRevokeProIn,
    PushTokenIn, NotifPrefsIn, IAPValidateIn,
    UpdateProfileIn, UpdateEmailIn, DeleteAccountIn, MessageReactIn,
)
from app_core.push import send_push, EXPO_PUSH_URL

app = FastAPI(title="InnFeel API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("innfeel")


# =========================================================================
# Legacy block removed — config/EMOTIONS/client/db/helpers/models live in app_core now.
# =========================================================================

# Startup
# =========================================================================
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.moods.create_index([("user_id", 1), ("day_key", 1)])
    await db.moods.create_index("created_at")
    await db.friendships.create_index([("user_id", 1), ("friend_id", 1)], unique=True)
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.messages.create_index([("conversation_id", 1), ("at", 1)])
    await db.conversations.create_index("participants")
    await db.wellness_cache.create_index([("user_id", 1), ("emotion", 1), ("day_key", 1)], unique=True)
    await db.activity.create_index([("user_id", 1), ("at", -1)])
    await db.activity.create_index([("user_id", 1), ("read", 1)])
    # one-time migration: rename legacy admin@mooddrop.app → admin@innfeel.app
    # Order-safe: if BOTH rows exist, delete the legacy one first (no rename).
    legacy_admin = await db.users.find_one({"email": "admin@mooddrop.app"})
    if legacy_admin:
        new_admin_exists = await db.users.find_one({"email": "admin@innfeel.app"})
        if new_admin_exists:
            await db.users.delete_one({"user_id": legacy_admin["user_id"]})
            logger.info("Removed legacy admin@mooddrop.app (already migrated)")
        else:
            try:
                await db.users.update_one(
                    {"user_id": legacy_admin["user_id"]},
                    {"$set": {"email": "admin@innfeel.app"}},
                )
                logger.info("Migrated admin@mooddrop.app → admin@innfeel.app")
            except Exception as e:
                # If a duplicate appeared between read and write, drop legacy and continue.
                logger.warning(f"Migration rename hit a race ({e}); deleting legacy row.")
                await db.users.delete_one({"user_id": legacy_admin["user_id"]})

    # seed demo admin
    existing = await db.users.find_one({"email": "admin@innfeel.app"})
    if not existing:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": uid,
            "email": "admin@innfeel.app",
            "password_hash": hash_password("admin123"),
            "name": "Admin",
            "avatar_color": "#F472B6",
            "pro": True,
            "pro_expires_at": now_utc() + timedelta(days=365),
            "is_admin": True,
            "friend_count": 0,
            "streak": 0,
            "created_at": now_utc(),
        })
        logger.info("Seeded admin user")
    else:
        # Ensure admin flag is set on the seeded admin (idempotent)
        await db.users.update_one(
            {"email": "admin@innfeel.app"},
            {"$set": {"is_admin": True, "pro": True}},
        )
    # seed a couple of demo friends so feed is not empty
    for (email, name, color, emotion) in [
        ("luna@innfeel.app", "Luna", "#A78BFA", "nostalgia"),
        ("rio@innfeel.app", "Rio", "#2DD4BF", "focus"),
        ("sage@innfeel.app", "Sage", "#34D399", "peace"),
    ]:
        ex = await db.users.find_one({"email": email})
        if not ex:
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid,
                "email": email,
                "password_hash": hash_password("demo1234"),
                "name": name,
                "avatar_color": color,
                "pro": False,
                "friend_count": 0,
                "streak": 1,
                "created_at": now_utc(),
            })


# =========================================================================
# Auth endpoints
# =========================================================================
@api.post("/auth/register")
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
        # Legal acceptance trace (GDPR proof of consent)
        "terms_accepted_at": now_utc() if bool(data.terms_accepted) else None,
        "terms_version": "2025-06-01" if bool(data.terms_accepted) else None,
    }
    await db.users.insert_one(doc)
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"user": sanitize_user(doc), "access_token": access, "refresh_token": refresh}


@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user["user_id"], email)
    refresh = create_refresh_token(user["user_id"])
    set_auth_cookies(response, access, refresh)
    return {"user": sanitize_user(user), "access_token": access, "refresh_token": refresh}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return sanitize_user(user)


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


# =========================================================================
# Account management — edit name, email, delete account + all data (GDPR)
# =========================================================================
@api.patch("/account/profile")
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


@api.post("/account/email")
async def update_email(data: UpdateEmailIn, user: dict = Depends(get_current_user)):
    """Change email. Requires current password for security."""
    current = await db.users.find_one({"user_id": user["user_id"]})
    if not current or not verify_password(data.password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect password")
    new_email = data.new_email.lower().strip()
    if new_email == current.get("email", "").lower():
        return {"ok": True, "user": sanitize_user(current)}
    existing = await db.users.find_one({"email": new_email})
    if existing and existing.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=409, detail="This email is already in use")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email": new_email}})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": sanitize_user(fresh)}


@api.delete("/account")
async def delete_account(data: DeleteAccountIn, response: Response, user: dict = Depends(get_current_user)):
    """GDPR-compliant hard-delete of all user data.

    Requires password + typing "DELETE" as confirmation. Removes:
      users row · moods · reactions on own moods · comments · messages · conversations ·
      friendships (symmetric) · activity · iap_events · push_token · close_friends
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


@api.get("/account/export")
async def export_account(user: dict = Depends(get_current_user)):
    """GDPR Article 20 — data portability. Returns the user's data as JSON."""
    uid = user["user_id"]
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
    if u and isinstance(u.get("created_at"), datetime):
        u["created_at"] = u["created_at"].isoformat()
    if u and isinstance(u.get("pro_expires_at"), datetime):
        u["pro_expires_at"] = u["pro_expires_at"].isoformat()

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


# =========================================================================
# Auras
# =========================================================================
async def compute_streak(user_id: str) -> int:
    # Single query: fetch distinct day_keys for this user (last 400 days worth), count consecutive days ending today.
    cursor = db.moods.find({"user_id": user_id}, {"_id": 0, "day_key": 1}).sort("day_key", -1)
    rows = await cursor.to_list(400)
    if not rows:
        return 0
    posted_days = {r["day_key"] for r in rows}
    streak = 0
    d = now_utc()
    for _ in range(400):
        key = d.strftime("%Y-%m-%d")
        if key in posted_days:
            streak += 1
            d = d - timedelta(days=1)
        else:
            break
    return streak


@api.get("/moods/today")
async def get_today(user: dict = Depends(get_current_user)):
    key = today_key()
    mood = await db.moods.find_one({"user_id": user["user_id"], "day_key": key}, {"_id": 0})
    if mood and isinstance(mood.get("created_at"), datetime):
        mood["created_at"] = mood["created_at"].isoformat()
    return {"mood": mood}


@api.delete("/moods/today")
async def delete_today(user: dict = Depends(get_current_user)):
    """Delete the user's own mood of today (if any). Lets them retry their drop.

    Also wipes derived daily data: today's wellness cache and today's LLM badge,
    so the next drop re-triggers a fresh wellness prompt.
    """
    key = today_key()
    result = await db.moods.delete_one({"user_id": user["user_id"], "day_key": key})
    # Clear today's wellness cache for this user so the next drop triggers a fresh LLM call
    await db.wellness_cache.delete_many({"user_id": user["user_id"], "day_key": key})
    return {"ok": True, "deleted": result.deleted_count}


@api.delete("/moods/{mood_id}")
async def delete_mood(mood_id: str, user: dict = Depends(get_current_user)):
    """Delete a specific mood of the current user (own moods only)."""
    mood = await db.moods.find_one({"mood_id": mood_id})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    if mood["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your aura")
    await db.moods.delete_one({"mood_id": mood_id})
    await db.wellness_cache.delete_many({"user_id": user["user_id"], "day_key": mood.get("day_key")})
    return {"ok": True}


@api.post("/moods")
async def create_mood(data: InnFeelIn, user: dict = Depends(get_current_user)):
    key = today_key()
    existing = await db.moods.find_one({"user_id": user["user_id"], "day_key": key})
    if existing:
        raise HTTPException(status_code=400, detail="You already shared your aura today. Come back tomorrow!")

    pro = is_pro(user)
    # enforce pro-only inputs
    if not pro:
        if data.intensity > 5:
            raise HTTPException(status_code=403, detail="Intensity above 5 is a Pro feature")
        if data.text or data.audio_b64:
            raise HTTPException(status_code=403, detail="Text & audio notes are Pro features")
        if data.music:
            raise HTTPException(status_code=403, detail="Background music is a Pro feature")

    music_obj = None
    if data.music:
        music_obj = data.music.model_dump()

    mood_id = f"mood_{uuid.uuid4().hex[:12]}"
    doc = {
        "mood_id": mood_id,
        "user_id": user["user_id"],
        "day_key": key,
        "word": (data.word or "").strip() or None,
        "emotion": data.emotion,
        "color": EMOTIONS[data.emotion],
        "intensity": data.intensity,
        "photo_b64": data.photo_b64,
        "video_b64": data.video_b64,
        "video_seconds": min(10, data.video_seconds) if data.video_b64 and data.video_seconds else (10 if data.video_b64 else None),
        "has_video": bool(data.video_b64),
        "text": data.text,
        "audio_b64": data.audio_b64,
        "audio_seconds": data.audio_seconds if data.audio_b64 else None,
        "has_audio": bool(data.audio_b64),
        "music": music_obj,
        "privacy": data.privacy,
        "reactions": [],
        "created_at": now_utc(),
    }
    await db.moods.insert_one(doc)
    # Update streak
    streak = await compute_streak(user["user_id"])
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"streak": streak}})
    doc.pop("_id", None)
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return {"mood": doc, "streak": streak}


@api.get("/moods/feed")
async def friends_feed(user: dict = Depends(get_current_user)):
    # must have posted today
    key = today_key()
    mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": key})
    if not mine:
        return {"locked": True, "items": []}
    # get friends
    friendships = await db.friendships.find({"user_id": user["user_id"]}).to_list(1000)
    friend_ids = [f["friend_id"] for f in friendships]
    if not friend_ids:
        return {"locked": False, "items": []}
    # authors who marked me as "close" — they see me for their close-posts
    close_edges = await db.friendships.find(
        {"user_id": {"$in": friend_ids}, "friend_id": user["user_id"], "close": True},
        {"_id": 0, "user_id": 1},
    ).to_list(1000)
    close_author_ids = {e["user_id"] for e in close_edges}
    cursor = db.moods.find(
        {
            "user_id": {"$in": friend_ids},
            "day_key": key,
            "privacy": {"$ne": "private"},
            "$or": [
                {"privacy": "friends"},
                {"privacy": "close", "user_id": {"$in": list(close_author_ids)}},
            ],
        },
        {"_id": 0, "audio_b64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(200)
    # Backfill has_audio flag for older docs that didn't set it explicitly.
    for it in items:
        if "has_audio" not in it:
            it["has_audio"] = False
    # attach author info
    authors = await db.users.find({"user_id": {"$in": friend_ids}}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1}).to_list(1000)
    author_map = {a["user_id"]: a for a in authors}
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
        a = author_map.get(it["user_id"], {})
        it["author_name"] = a.get("name", "Friend")
        it["author_color"] = a.get("avatar_color", "#A78BFA")
        it["author_avatar_b64"] = a.get("avatar_b64")
    return {"locked": False, "items": items}


@api.get("/moods/{mood_id}/audio")
async def get_mood_audio(mood_id: str, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "user_id": 1, "audio_b64": 1, "audio_seconds": 1, "privacy": 1, "day_key": 1})
    if not mood or not mood.get("audio_b64"):
        raise HTTPException(status_code=404, detail="No audio")
    # Authorization: author or friend (unless private)
    if mood["user_id"] != user["user_id"]:
        if mood.get("privacy") == "private":
            raise HTTPException(status_code=403, detail="Private")
        fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": mood["user_id"]})
        if not fship:
            raise HTTPException(status_code=403, detail="Not friends")
        # Requester must have posted today to keep reciprocity
        mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": mood["day_key"]})
        if not mine:
            raise HTTPException(status_code=403, detail="Share your aura to unlock")
    return {"audio_b64": mood["audio_b64"], "audio_seconds": mood.get("audio_seconds")}


@api.post("/moods/{mood_id}/comment")
async def add_comment(mood_id: str, data: CommentIn, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "user_id": 1, "day_key": 1, "privacy": 1})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    # Author or friend with reciprocity rule
    if mood["user_id"] != user["user_id"]:
        if mood.get("privacy") == "private":
            raise HTTPException(status_code=403, detail="Private mood")
        fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": mood["user_id"]})
        if not fship:
            raise HTTPException(status_code=403, detail="Not friends")
        mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": mood["day_key"]})
        if not mine:
            raise HTTPException(status_code=403, detail="Share your aura to comment")
    comment = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "name": user.get("name", ""),
        "avatar_color": user.get("avatar_color", "#A78BFA"),
        "text": data.text.strip(),
        "at": now_utc().isoformat(),
    }
    await db.moods.update_one({"mood_id": mood_id}, {"$push": {"comments": comment}})
    # Record activity item for the aura owner (unless they're commenting on their own)
    if mood["user_id"] != user["user_id"]:
        await db.activity.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:12]}",
            "user_id": mood["user_id"],
            "from_user_id": user["user_id"],
            "from_name": user.get("name", ""),
            "from_avatar_color": user.get("avatar_color", "#A78BFA"),
            "from_avatar_b64": user.get("avatar_b64"),
            "kind": "comment",
            "text": data.text.strip()[:140],
            "mood_id": mood_id,
            "mood_word": mood.get("word", ""),
            "mood_emotion": mood.get("emotion", ""),
            "mood_color": mood.get("color"),
            "at": now_utc(),
            "read": False,
        })
        await send_push(
            mood["user_id"], "reaction",
            f"{user.get('name', 'Someone')} commented on your aura",
            data.text.strip()[:100],
            {"route": "/activity", "mood_id": mood_id, "kind": "comment"},
        )
    return {"ok": True, "comment": comment}


@api.get("/moods/{mood_id}/comments")
async def get_comments(mood_id: str, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "comments": 1, "user_id": 1, "privacy": 1, "day_key": 1})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    if mood["user_id"] != user["user_id"]:
        if mood.get("privacy") == "private":
            raise HTTPException(status_code=403, detail="Private mood")
        fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": mood["user_id"]})
        if not fship:
            raise HTTPException(status_code=403, detail="Not friends")
    return {"comments": mood.get("comments", [])}


@api.post("/moods/{mood_id}/react")
async def react(mood_id: str, data: ReactionIn, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    # prevent duplicate from same user (replace previous reaction)
    new_reaction = {"user_id": user["user_id"], "name": user.get("name", ""), "emoji": data.emoji, "at": now_utc()}
    await db.moods.update_one(
        {"mood_id": mood_id},
        {"$pull": {"reactions": {"user_id": user["user_id"]}}}
    )
    await db.moods.update_one({"mood_id": mood_id}, {"$push": {"reactions": new_reaction}})

    # Record activity item so the author sees who reacted
    if mood["user_id"] != user["user_id"]:  # don't notify self-reactions
        await db.activity.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:12]}",
            "user_id": mood["user_id"],                # the recipient (aura owner)
            "from_user_id": user["user_id"],
            "from_name": user.get("name", ""),
            "from_avatar_color": user.get("avatar_color", "#A78BFA"),
            "from_avatar_b64": user.get("avatar_b64"),
            "kind": "reaction",
            "emoji": data.emoji,
            "mood_id": mood_id,
            "mood_word": mood.get("word", ""),
            "mood_emotion": mood.get("emotion", ""),
            "mood_color": mood.get("color"),
            "at": now_utc(),
            "read": False,
        })
        # Push notification to aura owner
        await send_push(
            mood["user_id"], "reaction",
            f"{user.get('name', 'Someone')} reacted to your aura ✨",
            f"They sent a {data.emoji} on your \"{mood.get('word', 'aura')}\"",
            {"route": "/activity", "mood_id": mood_id, "kind": "reaction"},
        )

    # Return a fresh aggregated breakdown so the client can rerender without refetch
    fresh = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "reactions": 1})
    return {"ok": True, "reactions": fresh.get("reactions", []) if fresh else []}


@api.get("/activity")
async def activity_feed(user: dict = Depends(get_current_user), limit: int = 50):
    """Activity feed — reactions and comments someone else made on YOUR auras.

    Returns newest first, capped at `limit` items.
    """
    cursor = db.activity.find({"user_id": user["user_id"]}, {"_id": 0}).sort("at", -1).limit(limit)
    items = await cursor.to_list(limit)
    unread = 0
    for it in items:
        if isinstance(it.get("at"), datetime):
            it["at"] = it["at"].isoformat()
        if not it.get("read", False):
            unread += 1
    return {"items": items, "unread": unread}


@api.get("/activity/unread-count")
async def activity_unread_count(user: dict = Depends(get_current_user)):
    """Lightweight endpoint for the tab/home badge."""
    n = await db.activity.count_documents({"user_id": user["user_id"], "read": False})
    return {"unread": n}


@api.post("/activity/mark-read")
async def activity_mark_read(user: dict = Depends(get_current_user)):
    await db.activity.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}


# =========================================================================
# Push notifications (Expo Push) — send_push/EXPO_PUSH_URL moved to app_core.push
# =========================================================================


@api.post("/notifications/register-token")
async def register_push_token(data: PushTokenIn, user: dict = Depends(get_current_user)):
    """Save the Expo push token for this user (replaces any previous)."""
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "push_token": data.token,
            "push_platform": data.platform or "unknown",
            "push_registered_at": now_utc(),
        }},
    )
    return {"ok": True}


@api.post("/notifications/unregister-token")
async def unregister_push_token(user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$unset": {"push_token": "", "push_platform": ""}},
    )
    return {"ok": True}


@api.get("/notifications/prefs")
async def get_notif_prefs(user: dict = Depends(get_current_user)):
    """All categories default to True if not explicitly set."""
    cur = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "notif_prefs": 1})
    prefs = (cur or {}).get("notif_prefs") or {}
    return {"prefs": {
        "reminder": prefs.get("reminder", True),
        "reaction": prefs.get("reaction", True),
        "message": prefs.get("message", True),
        "friend": prefs.get("friend", True),
    }}


@api.post("/notifications/prefs")
async def set_notif_prefs(data: NotifPrefsIn, user: dict = Depends(get_current_user)):
    update = {}
    for cat in ("reminder", "reaction", "message", "friend"):
        v = getattr(data, cat)
        if v is not None:
            update[f"notif_prefs.{cat}"] = bool(v)
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return {"ok": True}


@api.post("/notifications/test")
async def test_push(user: dict = Depends(get_current_user)):
    """Send a test push to the authenticated user — useful to verify their token."""
    ok = await send_push(
        user["user_id"], "reminder",
        "InnFeel test ✦",
        "If you see this, push notifications are working!",
        {"kind": "test"},
    )
    return {"ok": ok}


@api.get("/moods/history")
async def history(user: dict = Depends(get_current_user)):
    pro = is_pro(user)
    query = {"user_id": user["user_id"]}
    cursor = db.moods.find(query, {"_id": 0, "audio_b64": 0, "photo_b64": 0}).sort("created_at", -1)
    limit = 365 if pro else 7
    items = await cursor.to_list(limit)
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
    return {"items": items, "is_pro": pro}


@api.get("/moods/stats")
async def stats(user: dict = Depends(get_current_user)):
    pro = is_pro(user)
    # last 7 days
    since7 = now_utc() - timedelta(days=7)
    moods7 = await db.moods.find({"user_id": user["user_id"], "created_at": {"$gte": since7}}, {"_id": 0, "photo_b64": 0, "audio_b64": 0}).to_list(200)
    # distribution
    dist = {k: 0 for k in EMOTIONS.keys()}
    for m in moods7:
        dist[m["emotion"]] = dist.get(m["emotion"], 0) + 1
    dominant = max(dist, key=dist.get) if any(dist.values()) else None
    # weekly by day-of-week
    by_dow = {i: 0 for i in range(7)}
    for m in moods7:
        d = m["created_at"]
        if isinstance(d, str):
            d = datetime.fromisoformat(d)
        by_dow[d.weekday()] += 1
    streak = await compute_streak(user["user_id"])
    result = {
        "streak": streak,
        "drops_this_week": len(moods7),
        "dominant": dominant,
        "dominant_color": EMOTIONS.get(dominant) if dominant else None,
        "distribution": dist,
        "by_weekday": by_dow,
    }
    if pro:
        # 30/90/365 analytics
        def series(days):
            since = now_utc() - timedelta(days=days)
            return since
        for days in (30, 90, 365):
            since = now_utc() - timedelta(days=days)
            ms = await db.moods.find(
                {"user_id": user["user_id"], "created_at": {"$gte": since}},
                {"_id": 0, "emotion": 1, "intensity": 1, "created_at": 1},
            ).to_list(2000)
            d2 = {k: 0 for k in EMOTIONS.keys()}
            intens = []
            for m in ms:
                d2[m["emotion"]] = d2.get(m["emotion"], 0) + 1
                intens.append(m["intensity"])
            avg = sum(intens) / len(intens) if intens else 0
            volatility = 0.0
            if len(intens) >= 2:
                mean = avg
                volatility = (sum((x - mean) ** 2 for x in intens) / len(intens)) ** 0.5
            result[f"range_{days}"] = {
                "count": len(ms),
                "distribution": d2,
                "avg_intensity": round(avg, 2),
                "volatility": round(volatility, 2),
            }
        # insight sentences
        insights = []
        if dominant:
            insights.append(f"Your dominant emotion this week is {dominant}.")
        if result["range_30"]["avg_intensity"] >= 6:
            insights.append("You've felt intensely this month — high emotional energy.")
        elif result["range_30"]["avg_intensity"] > 0:
            insights.append("Your emotional intensity has been moderate this month.")
        result["insights"] = insights
    return result


# =========================================================================
# Badges & Leaderboard — gamification between friends
# =========================================================================
BADGE_CATALOG = [
    {"key": "first_aura",      "label": "First Aura",       "icon": "sparkles",         "color": "#FACC15", "hint": "Share your first aura"},
    {"key": "streak_7",        "label": "Week Warrior",     "icon": "flame",            "color": "#FB923C", "hint": "7-day streak"},
    {"key": "streak_30",       "label": "Zen Master",       "icon": "ribbon",           "color": "#A855F7", "hint": "30-day streak"},
    {"key": "streak_100",      "label": "Century",          "icon": "trophy",           "color": "#FACC15", "hint": "100-day streak"},
    {"key": "explorer_10",     "label": "Emotion Explorer", "icon": "compass",          "color": "#22D3EE", "hint": "Used 10 different emotions"},
    {"key": "explorer_all",    "label": "Full Spectrum",    "icon": "color-palette",    "color": "#EC4899", "hint": "Used all 24 emotions"},
    {"key": "social_5",        "label": "Connector",        "icon": "people",           "color": "#34D399", "hint": "5 or more friends"},
    {"key": "social_25",       "label": "Community",        "icon": "people-circle",    "color": "#10B981", "hint": "25 or more friends"},
    {"key": "loved_50",        "label": "Loved",            "icon": "heart",            "color": "#F472B6", "hint": "Received 50 reactions"},
    {"key": "loved_250",       "label": "Beloved",          "icon": "heart-circle",     "color": "#EC4899", "hint": "Received 250 reactions"},
    {"key": "prolific_30",     "label": "Prolific",         "icon": "create",           "color": "#60A5FA", "hint": "Shared 30 auras total"},
    {"key": "prolific_100",    "label": "Virtuoso",         "icon": "medal",            "color": "#38BDF8", "hint": "Shared 100 auras total"},
]


async def _compute_badges_for(user_id: str) -> tuple[list[str], dict]:
    """Compute which badge keys a given user has earned + the underlying metrics."""
    # Totals
    moods_count = await db.moods.count_documents({"user_id": user_id})
    friends = await db.friendships.count_documents({"user_id": user_id})
    # Unique emotions used
    emos = set()
    async for m in db.moods.find({"user_id": user_id}, {"emotion": 1}):
        if m.get("emotion"): emos.add(m["emotion"])
    # Total reactions received on one's moods
    reactions_rx = 0
    async for m in db.moods.find({"user_id": user_id}, {"reactions": 1}):
        reactions_rx += len(m.get("reactions") or [])
    streak = await compute_streak(user_id)
    earned: list[str] = []
    if moods_count >= 1:   earned.append("first_aura")
    if streak   >= 7:      earned.append("streak_7")
    if streak   >= 30:     earned.append("streak_30")
    if streak   >= 100:    earned.append("streak_100")
    if len(emos) >= 10:    earned.append("explorer_10")
    if len(emos) >= 24:    earned.append("explorer_all")
    if friends  >= 5:      earned.append("social_5")
    if friends  >= 25:     earned.append("social_25")
    if reactions_rx >= 50: earned.append("loved_50")
    if reactions_rx >= 250: earned.append("loved_250")
    if moods_count >= 30:  earned.append("prolific_30")
    if moods_count >= 100: earned.append("prolific_100")
    metrics = {
        "moods_count": moods_count,
        "friends": friends,
        "unique_emotions": len(emos),
        "reactions_received": reactions_rx,
        "streak": streak,
    }
    return earned, metrics


@api.get("/badges")
async def get_badges(user: dict = Depends(get_current_user)):
    """Return the signed-in user's badges (earned + locked) and progress metrics."""
    earned, metrics = await _compute_badges_for(user["user_id"])
    catalog = []
    for b in BADGE_CATALOG:
        catalog.append({**b, "earned": b["key"] in earned})
    return {"badges": catalog, "earned_count": len(earned), "metrics": metrics}


@api.get("/friends/leaderboard")
async def friends_leaderboard(user: dict = Depends(get_current_user)):
    """Top-3 leaderboard between the user and their friends, across three categories.

    Categories: `streak` (current consecutive-day streak), `moods` (total auras shared),
    `loved` (reactions received).
    Each category returns the top 3 including the signed-in user's rank if outside top 3.
    """
    # Gather candidates = self + friends
    fids = set()
    async for f in db.friendships.find({"user_id": user["user_id"]}, {"friend_id": 1}):
        fids.add(f.get("friend_id"))
    fids.add(user["user_id"])
    # Gather stats for each candidate
    rows = []
    for uid in fids:
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1})
        if not u:
            continue
        _, m = await _compute_badges_for(uid)
        rows.append({
            "user_id": u["user_id"],
            "name": u.get("name", ""),
            "avatar_color": u.get("avatar_color"),
            "avatar_b64": u.get("avatar_b64"),
            "streak": m["streak"],
            "moods": m["moods_count"],
            "loved": m["reactions_received"],
        })

    def rank(key: str):
        sorted_rows = sorted(rows, key=lambda r: (-int(r[key]), r["name"].lower()))
        top3 = sorted_rows[:3]
        my_idx = next((i for i, r in enumerate(sorted_rows) if r["user_id"] == user["user_id"]), None)
        my_rank = (my_idx + 1) if my_idx is not None else None
        return {
            "top3": [
                {**r, "value": r[key], "rank": i + 1} for i, r in enumerate(top3)
            ],
            "my_rank": my_rank,
            "total": len(sorted_rows),
        }

    return {
        "streak": rank("streak"),
        "moods":  rank("moods"),
        "loved":  rank("loved"),
    }


# =========================================================================
# Friends
# =========================================================================
@api.get("/music/search")
async def music_search(q: str, user: dict = Depends(get_current_user)):
    """Unified music search querying Apple (iTunes) AND Spotify in parallel.

    Returns a merged, de-duplicated list sorted by provider alternation so results
    from both sources are shown. Each track carries a `source` tag ("apple" | "spotify").
    If Spotify credentials aren't configured, results fall back to Apple-only.
    """
    if not is_pro(user):
        raise HTTPException(status_code=403, detail="Background music is a Pro feature")
    q = (q or "").strip()
    if len(q) < 2:
        return {"tracks": []}
    import httpx, asyncio
    from app_core.spotify import search_tracks as spotify_search

    async def apple_search():
        try:
            async with httpx.AsyncClient(timeout=6.0) as client_http:
                r = await client_http.get(
                    "https://itunes.apple.com/search",
                    params={"term": q, "media": "music", "entity": "song", "limit": 15},
                    headers={"User-Agent": "InnFeel/1.0"},
                )
            data = r.json() if r.status_code == 200 else {"results": []}
        except Exception as e:
            logger.warning(f"iTunes search failed: {e}")
            data = {"results": []}
        out = []
        for t in data.get("results", []):
            if not t.get("previewUrl"):
                continue
            art = (t.get("artworkUrl100") or "").replace("100x100bb", "300x300bb")
            out.append({
                "track_id": str(t.get("trackId")) if t.get("trackId") else t.get("previewUrl", "")[:48],
                "name": t.get("trackName") or "",
                "artist": t.get("artistName") or "",
                "artwork_url": art,
                "preview_url": t.get("previewUrl"),
                "source": "apple",
            })
        return out

    # Run both searches in parallel; never let one source's failure break the other.
    try:
        apple_results, spotify_results = await asyncio.gather(
            apple_search(), spotify_search(q, limit=10), return_exceptions=False
        )
    except Exception as e:
        logger.warning(f"Unified music search failed: {e}")
        apple_results, spotify_results = [], []

    # Merge with dedup by (name+artist lowercased) — first seen wins.
    seen: set[str] = set()
    merged: list[dict] = []
    # Alternate between sources for a balanced feel
    max_len = max(len(apple_results), len(spotify_results))
    for i in range(max_len):
        for src_list in (apple_results, spotify_results):
            if i < len(src_list):
                t = src_list[i]
                key = (t.get("name", "").lower().strip() + "|" + (t.get("artist", "") or "").lower().strip())
                if key and key not in seen:
                    seen.add(key)
                    merged.append(t)
    return {"tracks": merged[:20]}


# Backward-compat: old endpoint returns empty tracks so legacy clients don't crash
@api.get("/music/tracks")
async def music_tracks_legacy(user: dict = Depends(get_current_user)):
    return {"tracks": []}


@api.post("/profile/avatar")
async def update_avatar(data: AvatarIn, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"avatar_b64": data.avatar_b64}})
    return {"ok": True}


@api.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    fships = await db.friendships.find({"user_id": user["user_id"]}).to_list(500)
    ids = [f["friend_id"] for f in fships]
    close_map = {f["friend_id"]: bool(f.get("close", False)) for f in fships}
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "avatar_color": 1, "streak": 1}).to_list(500)
    # Did they share an aura today?
    key = today_key()
    moods = await db.moods.find({"user_id": {"$in": ids}, "day_key": key}, {"_id": 0, "user_id": 1}).to_list(500)
    drop_set = {m["user_id"] for m in moods}
    for u in users:
        u["dropped_today"] = u["user_id"] in drop_set
        u["is_close"] = close_map.get(u["user_id"], False)
    return {"friends": users}


@api.post("/friends/close/{friend_id}")
async def toggle_close_friend(friend_id: str, user: dict = Depends(get_current_user)):
    # Pro-only feature
    if not is_pro(user):
        raise HTTPException(status_code=403, detail="Close friends is a Pro feature")
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": friend_id})
    if not fship:
        raise HTTPException(status_code=404, detail="Not friends")
    new_close = not bool(fship.get("close", False))
    # enforce a sensible cap on close friends
    if new_close:
        cnt = await db.friendships.count_documents({"user_id": user["user_id"], "close": True})
        if cnt >= 15:
            raise HTTPException(status_code=403, detail="Close friends capped at 15")
    await db.friendships.update_one(
        {"user_id": user["user_id"], "friend_id": friend_id},
        {"$set": {"close": new_close, "close_updated_at": now_utc()}},
    )
    return {"ok": True, "is_close": new_close}


@api.get("/friends/close")
async def list_close_friends(user: dict = Depends(get_current_user)):
    fships = await db.friendships.find({"user_id": user["user_id"], "close": True}).to_list(200)
    ids = [f["friend_id"] for f in fships]
    if not ids:
        return {"friends": []}
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1}).to_list(200)
    return {"friends": users}


@api.post("/friends/match-contacts")
async def match_contacts(data: dict = Body(...), user: dict = Depends(get_current_user)):
    """Check which of the user's device contacts already have an InnFeel account.

    Client posts {emails: [str, ...]} (de-duped, lowercased). Returns the users
    that match, excluding the caller and already-friends. Privacy: we don't store
    non-matching emails or the raw contact list \u2014 purely a lookup.
    """
    emails = data.get("emails") or []
    if not isinstance(emails, list):
        raise HTTPException(status_code=400, detail="emails must be an array")
    # Cap to 500 at a time and normalise
    clean = list({(e or "").strip().lower() for e in emails if isinstance(e, str) and "@" in e})[:500]
    if not clean:
        return {"matches": []}
    # Find existing InnFeel users with those emails (excluding self)
    rows = await db.users.find(
        {"email": {"$in": clean}, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1},
    ).to_list(500)
    # Flag which are already friends
    my_friends = set()
    async for f in db.friendships.find({"user_id": user["user_id"]}, {"friend_id": 1}):
        my_friends.add(f.get("friend_id"))
    out = []
    for u in rows:
        out.append({
            "user_id": u["user_id"],
            "email": u["email"],
            "name": u.get("name", ""),
            "avatar_color": u.get("avatar_color"),
            "avatar_b64": u.get("avatar_b64"),
            "is_friend": u["user_id"] in my_friends,
        })
    return {"matches": out}


@api.post("/friends/add")
async def add_friend(data: AddFriendIn, user: dict = Depends(get_current_user)):
    pro = is_pro(user)
    # enforce free 25 friend cap
    if not pro:
        existing_count = await db.friendships.count_documents({"user_id": user["user_id"]})
        if existing_count >= 25:
            raise HTTPException(status_code=403, detail="Free plan caps at 25 friends. Upgrade to Pro.")
    target = await db.users.find_one({"email": data.email.lower()})
    if not target:
        raise HTTPException(status_code=404, detail="No user with that email")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    # idempotent add — both directions (symmetric)
    for a, b in [(user["user_id"], target["user_id"]), (target["user_id"], user["user_id"])]:
        try:
            await db.friendships.insert_one({"user_id": a, "friend_id": b, "created_at": now_utc()})
        except Exception:
            pass
    fc = await db.friendships.count_documents({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_count": fc}})
    # Notify the newly added friend
    await send_push(
        target["user_id"], "friend",
        "New friend on InnFeel ✨",
        f"{user.get('name', 'Someone')} added you as a friend",
        {"route": "/(tabs)/friends", "from_user_id": user["user_id"], "kind": "friend"},
    )
    return {"ok": True, "friend": {"user_id": target["user_id"], "name": target["name"], "email": target["email"], "avatar_color": target.get("avatar_color")}}


@api.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, user: dict = Depends(get_current_user)):
    await db.friendships.delete_one({"user_id": user["user_id"], "friend_id": friend_id})
    await db.friendships.delete_one({"user_id": friend_id, "friend_id": user["user_id"]})
    fc = await db.friendships.count_documents({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_count": fc}})
    return {"ok": True}


# =========================================================================
# Stripe payments
# =========================================================================
@api.post("/payments/checkout")
async def create_checkout(data: CheckoutIn, request: Request, user: dict = Depends(get_current_user)):
    host_url = str(request.base_url)
    webhook_url = f"{host_url.rstrip('/')}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    # Robust origin resolution: use client-provided URL if valid (http/https),
    # otherwise fall back to the request's own host (ingress preview URL).
    raw_origin = (data.origin_url or "").strip()
    origin = raw_origin.rstrip("/") if raw_origin.startswith(("http://", "https://")) else host_url.rstrip("/")
    success_url = f"{origin}/payment-success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/paywall"
    req = CheckoutSessionRequest(
        amount=PRO_PRICE_USD,
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user["user_id"], "product": "innfeel_pro_monthly"},
    )
    try:
        session = await stripe.create_checkout_session(req)
    except Exception as e:
        logger.exception("Stripe create_checkout failed")
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)[:180]}")
    await db.payment_transactions.insert_one({
        "session_id": session.session_id,
        "user_id": user["user_id"],
        "amount": PRO_PRICE_USD,
        "currency": "usd",
        "metadata": {"product": "innfeel_pro_monthly"},
        "payment_status": "initiated",
        "status": "pending",
        "created_at": now_utc(),
    })
    return {"url": session.url, "session_id": session.session_id}


@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
    host_url = str(request.base_url)
    webhook_url = f"{host_url.rstrip('/')}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    s: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if tx and tx.get("payment_status") != "paid" and s.payment_status == "paid":
        # mark paid + upgrade user to pro
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": s.payment_status, "status": s.status, "updated_at": now_utc()}},
        )
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"pro": True, "pro_expires_at": now_utc() + timedelta(days=30)}},
        )
    elif tx:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": s.payment_status, "status": s.status, "updated_at": now_utc()}},
        )
    return {"payment_status": s.payment_status, "status": s.status, "amount_total": s.amount_total, "currency": s.currency}


@api.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = str(request.base_url)
    webhook_url = f"{host_url.rstrip('/')}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    try:
        event = await stripe.handle_webhook(body, sig)
    except Exception as e:
        logger.warning("Webhook handling error: %s", e)
        return {"ok": False}
    if event.payment_status == "paid" and event.session_id:
        tx = await db.payment_transactions.find_one({"session_id": event.session_id})
        if tx and tx.get("payment_status") != "paid":
            await db.payment_transactions.update_one(
                {"session_id": event.session_id},
                {"$set": {"payment_status": "paid", "status": "complete", "updated_at": now_utc()}},
            )
            await db.users.update_one(
                {"user_id": tx["user_id"]},
                {"$set": {"pro": True, "pro_expires_at": now_utc() + timedelta(days=30)}},
            )
    return {"ok": True}


# =========================================================================
# In-App Purchases — RevenueCat unified (iOS App Store + Google Play + Stripe Web)
# =========================================================================
from app_core.revenuecat import get_subscriber as rc_get_subscriber, extract_pro_state
from app_core.config import REVENUECAT_WEBHOOK_AUTH


@api.post("/iap/sync")
async def iap_sync(user: dict = Depends(get_current_user)):
    """Client calls this right after a successful native purchase (or on demand).
    Backend fetches the authoritative subscriber state from RevenueCat REST and
    mirrors pro/pro_expires_at into our users collection.
    """
    sub = await rc_get_subscriber(user["user_id"])
    if not sub:
        return {"ok": False, "pro": False, "reason": "no_subscriber"}
    is_active, expires_at, store = extract_pro_state(sub)
    source = {"app_store": "iap_apple", "play_store": "iap_google", "stripe": "iap_stripe", "promotional": "iap_promo"}.get(store or "", "iap")
    update = {"pro": bool(is_active)}
    if is_active and expires_at:
        try:
            update["pro_expires_at"] = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            update["pro_source"] = source
        except Exception:
            pass
    else:
        update["pro_expires_at"] = None
        update["pro_source"] = None
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return {"ok": True, "pro": bool(is_active), "pro_expires_at": expires_at, "source": source}


@api.post("/iap/webhook")
async def iap_webhook(request: Request):
    """RevenueCat webhook endpoint. Configure this URL in the RevenueCat dashboard
    under Integrations → Webhooks, and set an authorization header that matches
    the REVENUECAT_WEBHOOK_AUTH env var.
    Events: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE,
            PRODUCT_CHANGE, SUBSCRIBER_ALIAS, NON_RENEWING_PURCHASE, UNCANCELLATION.
    """
    # 1) Authenticate
    expected = REVENUECAT_WEBHOOK_AUTH
    if expected:
        auth = request.headers.get("Authorization", "")
        if auth != expected:
            raise HTTPException(status_code=401, detail="Invalid webhook auth")
    # 2) Parse
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    event = payload.get("event") or {}
    event_type = event.get("type")
    event_id = event.get("id")
    app_user_id = event.get("app_user_id")
    if not event_id or not app_user_id:
        return {"ok": True, "ignored": "missing_ids"}
    # 3) Idempotency guard
    already = await db.iap_events.find_one({"event_id": event_id})
    if already:
        return {"ok": True, "duplicate": True}
    await db.iap_events.insert_one({
        "event_id": event_id,
        "event_type": event_type,
        "app_user_id": app_user_id,
        "received_at": now_utc(),
        "event": event,
    })
    # 4) Pull authoritative state from the REST API and update the user
    sub = await rc_get_subscriber(app_user_id)
    update = {"pro": False, "pro_expires_at": None}
    if sub:
        is_active, expires_at, store = extract_pro_state(sub)
        source = {"app_store": "iap_apple", "play_store": "iap_google", "stripe": "iap_stripe", "promotional": "iap_promo"}.get(store or "", "iap")
        update["pro"] = bool(is_active)
        update["pro_source"] = source if is_active else None
        if is_active and expires_at:
            try:
                update["pro_expires_at"] = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except Exception:
                pass
    await db.users.update_one({"user_id": app_user_id}, {"$set": update})
    logger.info(f"IAP webhook {event_type} applied for {app_user_id}: pro={update['pro']}")
    return {"ok": True, "event_type": event_type, "pro": update["pro"]}


@api.get("/iap/status")
async def iap_status(user: dict = Depends(get_current_user)):
    """Lightweight endpoint for the client to poll the latest pro state + source."""
    cur = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "pro": 1, "pro_expires_at": 1, "pro_source": 1},
    )
    return {
        "pro": is_pro(cur or {}),
        "pro_expires_at": (cur or {}).get("pro_expires_at"),
        "pro_source": (cur or {}).get("pro_source"),
    }


# =========================================================================
# Dev helper — toggle Pro (so testers can preview Pro features without real payment)
# =========================================================================
@api.post("/dev/toggle-pro")
async def toggle_pro(user: dict = Depends(get_current_user)):
    currently_pro = is_pro(user)
    if currently_pro:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"pro": False, "pro_expires_at": None, "pro_source": None}})
        return {"pro": False}
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"pro": True, "pro_expires_at": now_utc() + timedelta(days=30), "pro_source": "dev"}},
    )
    return {"pro": True}


# =========================================================================
# Admin — grant/revoke Pro for promo or friends, with expiration
# =========================================================================
def _require_admin(user: dict):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


@api.get("/admin/me")
async def admin_me(user: dict = Depends(get_current_user)):
    """Returns {is_admin: bool} quickly, no 403 if not admin."""
    return {"is_admin": bool(user.get("is_admin", False))}


@api.post("/admin/grant-pro")
async def admin_grant_pro(data: AdminGrantProIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    target = await db.users.find_one({"email": data.email.lower()})
    if not target:
        raise HTTPException(status_code=404, detail=f"No user with email {data.email}")
    expires_at = now_utc() + timedelta(days=data.days)
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {
            "pro": True,
            "pro_expires_at": expires_at,
            "pro_source": "admin_grant",
            "pro_granted_by": user["user_id"],
            "pro_grant_note": data.note,
        }},
    )
    await db.pro_grants.insert_one({
        "grant_id": f"grant_{uuid.uuid4().hex[:12]}",
        "granted_to_user_id": target["user_id"],
        "granted_to_email": target["email"],
        "granted_to_name": target.get("name", ""),
        "granted_by_user_id": user["user_id"],
        "granted_by_email": user["email"],
        "days": data.days,
        "expires_at": expires_at,
        "note": data.note,
        "created_at": now_utc(),
        "revoked": False,
    })
    return {
        "ok": True,
        "user": {
            "user_id": target["user_id"],
            "email": target["email"],
            "name": target.get("name", ""),
        },
        "pro_expires_at": expires_at.isoformat(),
    }


@api.post("/admin/revoke-pro")
async def admin_revoke_pro(data: AdminRevokeProIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    target = await db.users.find_one({"email": data.email.lower()})
    if not target:
        raise HTTPException(status_code=404, detail=f"No user with email {data.email}")
    if target.get("is_admin"):
        raise HTTPException(status_code=400, detail="Cannot revoke Pro from an admin")
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {"pro": False, "pro_expires_at": None, "pro_source": None, "pro_granted_by": None, "pro_grant_note": None}},
    )
    await db.pro_grants.update_many(
        {"granted_to_user_id": target["user_id"], "revoked": False},
        {"$set": {"revoked": True, "revoked_at": now_utc(), "revoked_by": user["user_id"]}},
    )
    return {"ok": True}


@api.get("/admin/pro-grants")
async def admin_list_grants(user: dict = Depends(get_current_user)):
    """Lists all Pro grants (past + active) the admin has issued. Active ones bubble up first."""
    _require_admin(user)
    grants = await db.pro_grants.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    now = now_utc()
    for g in grants:
        exp = g.get("expires_at")
        if isinstance(exp, datetime):
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            g["expires_at"] = exp.isoformat()
            g["is_active"] = (not g.get("revoked", False)) and exp > now
            g["days_remaining"] = max(0, (exp - now).days)
        else:
            g["is_active"] = False
            g["days_remaining"] = 0
        if isinstance(g.get("created_at"), datetime):
            g["created_at"] = g["created_at"].isoformat()
        if isinstance(g.get("revoked_at"), datetime):
            g["revoked_at"] = g["revoked_at"].isoformat()
    return {"grants": grants}


@api.get("/admin/users/search")
async def admin_search_users(q: str = "", user: dict = Depends(get_current_user)):
    """Search users by email or name to help admin find a target account."""
    _require_admin(user)
    q = (q or "").strip()
    if len(q) < 2:
        return {"users": []}
    import re
    safe = re.escape(q)
    cursor = db.users.find(
        {"$or": [
            {"email": {"$regex": safe, "$options": "i"}},
            {"name": {"$regex": safe, "$options": "i"}},
        ]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "pro": 1, "pro_expires_at": 1, "pro_source": 1, "is_admin": 1},
    ).limit(15)
    users = await cursor.to_list(15)
    for u in users:
        if isinstance(u.get("pro_expires_at"), datetime):
            u["pro_expires_at"] = u["pro_expires_at"].isoformat()
    return {"users": users}


# =========================================================================
# Unread message count — tiny endpoint for tab bar badge
# =========================================================================
@api.get("/messages/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    convs = await db.conversations.find(
        {"participants": user["user_id"]},
        {"_id": 0, "unread": 1}
    ).to_list(500)
    total = 0
    convos_with_unread = 0
    for c in convs:
        n = (c.get("unread") or {}).get(user["user_id"], 0) or 0
        if n > 0:
            total += n
            convos_with_unread += 1
    return {"total": total, "conversations": convos_with_unread}


@api.get("/")
async def root():
    return {"app": "InnFeel", "version": "1.0"}


# =========================================================================
# Messaging (1-on-1, polling-based)
# =========================================================================
def _conv_id(a: str, b: str) -> str:
    p = sorted([a, b])
    return f"conv_{p[0]}_{p[1]}"


@api.get("/messages/conversations")
async def list_conversations(user: dict = Depends(get_current_user)):
    convs = await db.conversations.find({"participants": user["user_id"]}, {"_id": 0}).to_list(200)
    other_ids = []
    for c in convs:
        for p in c["participants"]:
            if p != user["user_id"]:
                other_ids.append(p)
    others = await db.users.find({"user_id": {"$in": other_ids}}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1}).to_list(500)
    other_map = {u["user_id"]: u for u in others}
    out = []
    for c in convs:
        peer_id = next((p for p in c["participants"] if p != user["user_id"]), None)
        peer = other_map.get(peer_id, {})
        out.append({
            "conversation_id": c["conversation_id"],
            "peer_id": peer_id,
            "peer_name": peer.get("name", "Friend"),
            "peer_avatar_color": peer.get("avatar_color"),
            "peer_avatar_b64": peer.get("avatar_b64"),
            "last_text": c.get("last_text"),
            "last_at": c.get("last_at"),
            "unread": c.get("unread", {}).get(user["user_id"], 0),
        })
    out.sort(key=lambda x: x.get("last_at") or "", reverse=True)
    return {"conversations": out}


@api.get("/messages/with/{peer_id}")
async def get_messages(peer_id: str, user: dict = Depends(get_current_user)):
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": peer_id})
    if not fship and peer_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not friends")
    cid = _conv_id(user["user_id"], peer_id)
    msgs = await db.messages.find({"conversation_id": cid}, {"_id": 0}).sort("at", 1).to_list(500)
    # mark as read for me
    await db.conversations.update_one(
        {"conversation_id": cid},
        {"$set": {f"unread.{user['user_id']}": 0}},
    )
    peer = await db.users.find_one({"user_id": peer_id}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1})
    return {"conversation_id": cid, "peer": peer, "messages": msgs}


@api.post("/messages/with/{peer_id}")
async def send_message(peer_id: str, data: MessageIn, user: dict = Depends(get_current_user)):
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": peer_id})
    if not fship:
        raise HTTPException(status_code=403, detail="Not friends")
    text = (data.text or "").strip()
    # Must have at least one kind of content
    if not text and not data.photo_b64 and not data.audio_b64:
        raise HTTPException(status_code=400, detail="Empty message")
    cid = _conv_id(user["user_id"], peer_id)
    now = now_utc()
    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "conversation_id": cid,
        "sender_id": user["user_id"],
        "sender_name": user.get("name", ""),
        "text": text,
        "photo_b64": data.photo_b64,
        "audio_b64": data.audio_b64,
        "audio_seconds": data.audio_seconds,
        "reactions": [],
        "at": now.isoformat(),
    }
    await db.messages.insert_one(dict(msg))
    # last_text preview: prefer text, else hint at media
    preview = text[:200] if text else ("📷 Photo" if data.photo_b64 else "🎙 Voice note")
    await db.conversations.update_one(
        {"conversation_id": cid},
        {
            "$set": {
                "conversation_id": cid,
                "participants": sorted([user["user_id"], peer_id]),
                "last_text": preview,
                "last_at": now.isoformat(),
            },
            "$inc": {f"unread.{peer_id}": 1},
        },
        upsert=True,
    )
    # Push notification to the recipient
    push_body = text[:120] if text else ("Sent you a photo" if data.photo_b64 else "Sent you a voice note")
    await send_push(
        peer_id, "message",
        f"{user.get('name', 'Someone')} sent you a message",
        push_body,
        {"route": "/conversation", "peer_id": user["user_id"], "kind": "message"},
    )
    msg.pop("_id", None)
    return {"ok": True, "message": msg}


@api.post("/messages/{message_id}/react")
async def react_message(message_id: str, data: MessageReactIn, user: dict = Depends(get_current_user)):
    """Toggle a reaction (heart/thumb/fire/laugh/wow/sad) on a DM. Insta-style: one reaction per user per emoji — sending the same again removes it."""
    msg = await db.messages.find_one({"message_id": message_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    # Must be a participant
    parts = (msg.get("conversation_id") or "").split(":")  # "conv:uidA:uidB"
    if user["user_id"] not in [msg.get("sender_id")] + parts[1:]:
        # fallback: allow if they're in the sorted participants list on the conversation
        conv = await db.conversations.find_one({"conversation_id": msg.get("conversation_id")})
        if not conv or user["user_id"] not in conv.get("participants", []):
            raise HTTPException(status_code=403, detail="Not a participant")
    existing = [r for r in (msg.get("reactions") or []) if r.get("user_id") == user["user_id"]]
    already_same = any(r.get("emoji") == data.emoji for r in existing)
    if already_same:
        # Toggle off
        await db.messages.update_one(
            {"message_id": message_id},
            {"$pull": {"reactions": {"user_id": user["user_id"], "emoji": data.emoji}}},
        )
    else:
        # Replace any previous reaction from this user with the new one (Insta-style)
        await db.messages.update_one(
            {"message_id": message_id},
            {"$pull": {"reactions": {"user_id": user["user_id"]}}},
        )
        await db.messages.update_one(
            {"message_id": message_id},
            {"$push": {"reactions": {
                "user_id": user["user_id"],
                "name": user.get("name", ""),
                "emoji": data.emoji,
                "at": now_utc().isoformat(),
            }}},
        )
        # Push notification to the OTHER participant (the message sender, if it wasn't us)
        if msg.get("sender_id") and msg["sender_id"] != user["user_id"]:
            await send_push(
                msg["sender_id"], "message",
                f"{user.get('name', 'Someone')} reacted to your message",
                f"{data.emoji}",
                {"route": "/conversation", "peer_id": user["user_id"], "kind": "message"},
            )
    fresh = await db.messages.find_one({"message_id": message_id}, {"_id": 0, "reactions": 1})
    return {"ok": True, "reactions": fresh.get("reactions", []) if fresh else []}


# =========================================================================
# Wellness — Quote of the day + advice (mood-aware)
# =========================================================================
WELLNESS = {
    "joy": {
        "tone": "positive",
        "quotes": [
            "Joy is not in things; it is in us. — Richard Wagner",
            "Find ecstasy in life; the mere sense of living is joy enough. — Emily Dickinson",
            "Joy multiplies when shared.",
            "Today is a gift — that's why it's called the present.",
            "Wherever life plants you, bloom with grace.",
        ],
        "advice": "Capture this feeling. Send a kind message to someone who lifts you up — or share your mood card to Stories.",
        "share_cta": True,
    },
    "love": {
        "tone": "positive",
        "quotes": [
            "Love grows by giving. — Elbert Hubbard",
            "We're all just walking each other home. — Ram Dass",
            "Love is the only force capable of transforming an enemy into a friend. — MLK",
            "Where there is love, there is life. — Gandhi",
        ],
        "advice": "Tell someone you love them today — even one short message can change their day.",
        "share_cta": True,
    },
    "peace": {
        "tone": "positive",
        "quotes": [
            "Peace begins with a smile. — Mother Teresa",
            "Within you, there is a stillness and a sanctuary. — Hermann Hesse",
            "Do not let the behavior of others destroy your inner peace.",
        ],
        "advice": "Protect this calm — take 5 quiet minutes alone with no screen before the day continues.",
        "share_cta": True,
    },
    "focus": {
        "tone": "positive",
        "quotes": [
            "Where attention goes, energy flows.",
            "Focus is the gateway to all thinking. — Edward de Bono",
            "Concentrate all your thoughts upon the work at hand. — Alexander Graham Bell",
        ],
        "advice": "You're in the zone. Block 25 minutes for one important task before anything else.",
        "share_cta": False,
    },
    "excitement": {
        "tone": "positive",
        "quotes": [
            "Energy and persistence conquer all things. — Ben Franklin",
            "Enthusiasm is the electricity of life. — Gordon Parks",
            "Don't watch the clock; do what it does. Keep going. — Sam Levenson",
        ],
        "advice": "Channel this energy — start that thing you've been postponing. Even 10 minutes counts.",
        "share_cta": True,
    },
    "nostalgia": {
        "tone": "neutral",
        "quotes": [
            "The past beats inside me like a second heart. — John Banville",
            "Memory is the diary we all carry about with us. — Oscar Wilde",
            "Nostalgia is a file that removes the rough edges from the good old days.",
        ],
        "advice": "Reach out to someone from a fond memory. A short ‘thinking of you’ message means more than you think.",
        "share_cta": False,
    },
    "calm": {
        "tone": "neutral",
        "quotes": [
            "Quiet the mind, and the soul will speak. — Ma Jaya",
            "Calm is a superpower.",
            "The world always seems brighter when you've just made something nobody has made before.",
        ],
        "advice": "Use this clarity for one decision you've been putting off — even small.",
        "share_cta": False,
    },
    "tired": {
        "tone": "negative",
        "quotes": [
            "Rest when you're weary. Refresh and renew yourself. — Ralph Marston",
            "Almost everything will work again if you unplug it for a few minutes — including you. — Anne Lamott",
            "You don't have to see the whole staircase, just take the first step. — MLK",
        ],
        "advice": "Try a 10-minute lie-down with eyes closed and no phone. Hydrate. Move your shoulders. Be gentle with yourself today.",
        "share_cta": False,
    },
    "sadness": {
        "tone": "negative",
        "quotes": [
            "Tears are words the heart can't say.",
            "Even the darkest night will end and the sun will rise. — Victor Hugo",
            "Sadness flies away on the wings of time. — Jean de La Fontaine",
        ],
        "advice": "Try writing for 5 minutes in a notes app — just dump whatever comes. No filter. It often shifts something.",
        "share_cta": False,
    },
    "anger": {
        "tone": "negative",
        "quotes": [
            "For every minute you remain angry, you give up sixty seconds of peace. — Emerson",
            "Holding on to anger is like grasping a hot coal. — Buddha",
            "Speak when you are angry — and you will make the best speech you will ever regret. — Ambrose Bierce",
        ],
        "advice": "Move your body — 20 jumping jacks, a fast walk, or push-ups. Physical movement processes anger faster than thinking does.",
        "share_cta": False,
    },
    "anxiety": {
        "tone": "negative",
        "quotes": [
            "You don't have to control your thoughts. You just have to stop letting them control you. — Dan Millman",
            "Worry does not empty tomorrow of its sorrow, it empties today of its strength. — Corrie ten Boom",
            "Nothing diminishes anxiety faster than action. — Walter Anderson",
        ],
        "advice": "Try the 5-4-3-2-1 grounding: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste. Then text a friend you trust — you don't have to do this alone.",
        "share_cta": False,
    },
    "stressed": {
        "tone": "negative",
        "quotes": [
            "It's not stress that kills us, it's our reaction to it. — Hans Selye",
            "You don't have to see the whole staircase, just take the first step. — MLK",
            "When stressed, lower the bar — done is better than perfect.",
        ],
        "advice": "Try the 4-7-8 breath: inhale 4s, hold 7s, exhale 8s — repeat 4 times. Then write the ONE thing that would relieve 80% of the pressure, and do only that.",
        "share_cta": False,
    },
    "happy": {
        "tone": "positive",
        "quotes": [
            "Happiness is when what you think, what you say, and what you do are in harmony. — Gandhi",
            "The most wasted of days is one without laughter. — E.E. Cummings",
            "Happiness is a direction, not a place. — Sydney J. Harris",
        ],
        "advice": "Anchor this feeling: text one person who contributed to it and thank them — specificity makes it stick.",
        "share_cta": True,
    },
    "lonely": {
        "tone": "negative",
        "quotes": [
            "The loneliest moment is when you've just experienced something wonderful and have nobody to share it with. — Fitzgerald",
            "You are not alone; your feelings simply arrived before your people did.",
            "Solitude is where we find ourselves, so we may reach out and find others. — May Sarton",
        ],
        "advice": "Reach out to ONE person — send a simple 'thinking of you' — even a small bridge beats a perfect message. Then step outside for 5 minutes of real air.",
        "share_cta": False,
    },
    "grateful": {
        "tone": "positive",
        "quotes": [
            "Gratitude turns what we have into enough. — Melody Beattie",
            "Acknowledging the good you already have is the foundation for all abundance. — Eckhart Tolle",
            "Wear gratitude like a cloak, and it will feed every corner of your life. — Rumi",
        ],
        "advice": "Write down 3 specific things from today you're grateful for — one person, one sensation, one small win.",
        "share_cta": True,
    },
    "hopeful": {
        "tone": "positive",
        "quotes": [
            "Hope is being able to see that there is light despite all of the darkness. — Desmond Tutu",
            "Once you choose hope, anything's possible. — Christopher Reeve",
            "Hope is the thing with feathers that perches in the soul. — Emily Dickinson",
        ],
        "advice": "Capture this spark — write one sentence describing the future you're hoping for, and pin it somewhere you'll re-read it tomorrow.",
        "share_cta": True,
    },
    "inspired": {
        "tone": "positive",
        "quotes": [
            "Inspiration exists, but it has to find you working. — Pablo Picasso",
            "Creativity is intelligence having fun. — Einstein",
            "The best way to capture inspiration is to act on it immediately.",
        ],
        "advice": "Don't wait — give inspiration a body. Open a note, dump the raw idea in 2 minutes, even messy. The muse rewards motion.",
        "share_cta": True,
    },
    "confident": {
        "tone": "positive",
        "quotes": [
            "Confidence comes not from always being right but from not fearing to be wrong. — Peter T. Mcintyre",
            "You gain strength, courage, and confidence by every experience. — Eleanor Roosevelt",
            "Trust yourself. You know more than you think you do. — Benjamin Spock",
        ],
        "advice": "Use this energy for the one conversation or ask you've been postponing — confident moments have momentum, so cash it in.",
        "share_cta": False,
    },
    "bored": {
        "tone": "neutral",
        "quotes": [
            "Boredom is the feeling that everything is a waste of time; serenity, that nothing is. — Thomas Szasz",
            "The cure for boredom is curiosity. There is no cure for curiosity. — Dorothy Parker",
            "A quiet mind is not an empty one — it's a field where new ideas can land.",
        ],
        "advice": "Pick a single curiosity to chase for 15 minutes — a topic, a walk, a song rabbit-hole. Boredom is the start of creation, not the end.",
        "share_cta": False,
    },
    "overwhelmed": {
        "tone": "negative",
        "quotes": [
            "You are allowed to be both a masterpiece and a work in progress simultaneously.",
            "Almost everything will work again if you unplug it for a few minutes — including you. — Anne Lamott",
            "The way out is through — but one step at a time.",
        ],
        "advice": "Write down everything in your head on paper — just brain-dump for 3 minutes. Then circle only the ONE next thing. Do that. Ignore the rest.",
        "share_cta": False,
    },
    "motivated": {
        "tone": "positive",
        "quotes": [
            "Motivation is what gets you started. Habit is what keeps you going. — Jim Rohn",
            "Act as if what you do makes a difference. It does. — William James",
            "The secret of getting ahead is getting started. — Mark Twain",
        ],
        "advice": "Channel this fire: pick the one task that scared you yesterday and block 25 minutes for it right now. Momentum compounds.",
        "share_cta": True,
    },
    "unmotivated": {
        "tone": "negative",
        "quotes": [
            "You don't have to be great to start, but you have to start to be great. — Zig Ziglar",
            "Action isn't just the effect of motivation — it's also the cause of it. — Mark Manson",
            "Start where you are. Use what you have. Do what you can. — Arthur Ashe",
        ],
        "advice": "Shrink the task: commit to just 5 minutes of it. No pressure to finish. Almost always, motion unlocks the motivation you're waiting for.",
        "share_cta": False,
    },
    "worried": {
        "tone": "negative",
        "quotes": [
            "Worrying does not take away tomorrow's troubles. It takes away today's peace. — Randy Armstrong",
            "You wouldn't worry so much what others think if you realized how seldom they do. — Eleanor Roosevelt",
            "What worries you, masters you. — John Locke",
        ],
        "advice": "Name the worry concretely. Ask: is it within my control? If yes — one small action now. If no — schedule a 'worry window' for later and gently let it wait.",
        "share_cta": False,
    },
    "lost": {
        "tone": "negative",
        "quotes": [
            "Not all those who wander are lost. — J.R.R. Tolkien",
            "When you're lost, the best map is simply your next honest step.",
            "Sometimes the wrong choices bring us to the right places. — Anonymous",
        ],
        "advice": "Pause the big questions. Choose one tiny anchor today: a walk, a call, one page written. Clarity returns through movement, not more thinking.",
        "share_cta": False,
    },
}


@api.get("/wellness/{emotion}")
async def wellness_for(emotion: str, user: dict = Depends(get_current_user)):
    if emotion not in WELLNESS:
        raise HTTPException(status_code=404, detail="Unknown emotion")
    pack = WELLNESS[emotion]
    # Deterministic daily pick per user (fallback content)
    seed = hashlib.sha1(f"{user['user_id']}_{emotion}_{today_key()}".encode()).hexdigest()
    idx = int(seed[:8], 16) % len(pack["quotes"])
    fallback_quote = pack["quotes"][idx]
    fallback_advice = pack["advice"]

    # Try to fetch LLM-generated personalized wellness for today (24h cache per user+emotion+day)
    quote = fallback_quote
    advice = fallback_advice
    source = "static"
    day = today_key()
    if EMERGENT_LLM_KEY:
        # Find today's mood for context (word, intensity)
        today_mood = await db.moods.find_one(
            {"user_id": user["user_id"], "day_key": day},
            {"_id": 0, "word": 1, "intensity": 1, "emotion": 1},
        ) or {}
        cache = await db.wellness_cache.find_one({
            "user_id": user["user_id"],
            "emotion": emotion,
            "day_key": day,
        })
        if cache:
            quote = cache.get("quote", quote)
            advice = cache.get("advice", advice)
            source = "llm-cache"
        else:
            try:
                generated = await _generate_wellness_llm(
                    user_name=user.get("name") or "friend",
                    emotion=emotion,
                    tone=pack["tone"],
                    word=today_mood.get("word"),
                    intensity=today_mood.get("intensity"),
                )
                if generated:
                    quote = generated.get("quote", quote)
                    advice = generated.get("advice", advice)
                    source = "llm"
                    await db.wellness_cache.update_one(
                        {"user_id": user["user_id"], "emotion": emotion, "day_key": day},
                        {"$set": {
                            "user_id": user["user_id"],
                            "emotion": emotion,
                            "day_key": day,
                            "quote": quote,
                            "advice": advice,
                            "created_at": now_utc(),
                        }},
                        upsert=True,
                    )
            except Exception as e:
                logging.warning(f"LLM wellness failed, falling back: {e}")
    return {
        "emotion": emotion,
        "tone": pack["tone"],
        "quote": quote,
        "advice": advice,
        "share_cta": pack.get("share_cta", False),
        "color": EMOTIONS.get(emotion),
        "source": source,
    }


async def _generate_wellness_llm(user_name: str, emotion: str, tone: str, word: Optional[str], intensity: Optional[int]) -> Optional[dict]:
    """Generate a personalized short wellness quote + actionable advice via LLM, with strict JSON output.

    Returns None on failure.
    """
    if not EMERGENT_LLM_KEY:
        return None
    session_id = f"wellness_{hashlib.sha1(f'{user_name}_{emotion}_{today_key()}'.encode()).hexdigest()[:16]}"
    system = (
        "You are InnFeel's gentle wellness coach. "
        "Given a user's emotion and optional mood word, craft a short uplifting message. "
        "Rules: Return STRICT JSON with keys 'quote' and 'advice'. "
        "- 'quote': one-sentence poetic reflection (max 120 chars), no author attribution. "
        "- 'advice': one actionable, concrete tip a person can do in under 3 minutes (max 200 chars), empathetic, no platitudes. "
        "Never use markdown, quotes, or emoji in the output values. Never wrap in code fences."
    )
    prompt = (
        f"User name: {user_name}. Emotion: {emotion} ({tone}). "
        f"Aura word: {word or '—'}. Intensity: {intensity if intensity is not None else '—'}/10. "
        "Respond with ONLY the JSON object."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model("openai", "gpt-5.2")
    resp = await chat.send_message(UserMessage(text=prompt))
    text = (resp or "").strip()
    # Strip code fences if present
    if text.startswith("```"):
        text = text.strip("`")
        # Remove any leading language tag
        nl = text.find("\n")
        if nl != -1:
            text = text[nl + 1 :]
        text = text.strip("`").strip()
    # Find first {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except Exception:
        return None
    quote = (data.get("quote") or "").strip()
    advice = (data.get("advice") or "").strip()
    if not quote or not advice:
        return None
    # Safety: truncate
    if len(quote) > 200:
        quote = quote[:197] + "…"
    if len(advice) > 300:
        advice = advice[:297] + "…"
    return {"quote": quote, "advice": advice}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
