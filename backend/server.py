from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
import json
import hashlib
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Body
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    CheckoutSessionRequest,
)
from emergentintegrations.llm.chat import LlmChat, UserMessage

# =========================================================================
# Config
# =========================================================================
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MINUTES = 60 * 24 * 7  # 7 days for mobile convenience
REFRESH_TOKEN_TTL_DAYS = 30

PRO_PRICE_USD = 4.99  # monthly

# Emotion color palette — ordered from "best to worst" (positive → neutral → negative)
EMOTIONS = {
    # top: positive & expansive
    "joy":         "#FACC15",
    "happy":       "#FFD166",
    "love":        "#EC4899",
    "excitement":  "#FF7A00",
    # positive & nurturing
    "grateful":    "#F59E0B",
    "hopeful":     "#38BDF8",
    "inspired":    "#A855F7",
    "confident":   "#FB923C",
    "motivated":   "#22D3EE",
    # calm & steady
    "peace":       "#10B981",
    "calm":        "#3B82F6",
    "focus":       "#06D6A0",
    "nostalgia":   "#C026D3",
    # low energy / flat
    "tired":       "#94A3B8",
    "bored":       "#78716C",
    "unmotivated": "#6B7280",
    # isolating / sad
    "lonely":      "#64748B",
    "sadness":     "#6366F1",
    # worried / anxious / lost
    "worried":     "#CA8A04",
    "anxiety":     "#F59E0B",
    "lost":        "#475569",
    # intense negative
    "stressed":    "#DC2626",
    "overwhelmed": "#B91C1C",
    "anger":       "#EF4444",
}

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="MoodDrop API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mooddrop")


# =========================================================================
# Helpers
# =========================================================================
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_key(d: Optional[datetime] = None) -> str:
    d = d or now_utc()
    return d.strftime("%Y-%m-%d")


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
        "pro_source": u.get("pro_source"),  # e.g. "admin_grant" / "stripe" / "dev"
        "is_admin": bool(u.get("is_admin", False)),
        "friend_count": u.get("friend_count", 0),
        "streak": u.get("streak", 0),
        "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
    }


def require_admin(user: dict = Depends(lambda: None)):
    # Placeholder to make signature clear; the actual check is inside each admin endpoint
    # via `user.get("is_admin")` because FastAPI Depends chaining with get_current_user
    # would otherwise be nested.
    pass


# =========================================================================
# Models
# =========================================================================
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=40)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


EMOTION_LITERAL = Literal[
    "joy", "happy", "love", "excitement",
    "grateful", "hopeful", "inspired", "confident", "motivated",
    "peace", "calm", "focus", "nostalgia",
    "tired", "bored", "unmotivated",
    "lonely", "sadness",
    "worried", "anxiety", "lost",
    "stressed", "overwhelmed", "anger",
]


class MusicTrackIn(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    artist: Optional[str] = Field(default=None, max_length=120)
    artwork_url: Optional[str] = Field(default=None, max_length=500)
    preview_url: str = Field(min_length=1, max_length=500)
    source: Literal["apple", "spotify"] = "apple"


class MoodDropIn(BaseModel):
    word: str = Field(min_length=1, max_length=30)
    emotion: EMOTION_LITERAL
    intensity: int = Field(ge=1, le=10)
    photo_b64: Optional[str] = None  # base64 image
    text: Optional[str] = Field(default=None, max_length=280)
    audio_b64: Optional[str] = None  # base64 audio
    audio_seconds: Optional[int] = Field(default=None, ge=1, le=30)
    music: Optional[MusicTrackIn] = None  # Pro: track from Apple/Spotify search
    privacy: Literal["friends", "close", "private"] = "friends"


class AvatarIn(BaseModel):
    avatar_b64: str = Field(min_length=1)


class ReactionIn(BaseModel):
    emoji: Literal["heart", "fire", "hug", "smile", "sparkle"]


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class AddFriendIn(BaseModel):
    email: EmailStr


class CheckoutIn(BaseModel):
    origin_url: Optional[str] = None


class AdminGrantProIn(BaseModel):
    email: EmailStr
    days: int = Field(ge=1, le=3650, default=30)
    note: Optional[str] = Field(default=None, max_length=200)


class AdminRevokeProIn(BaseModel):
    email: EmailStr


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
    # seed demo admin
    existing = await db.users.find_one({"email": "admin@mooddrop.app"})
    if not existing:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": uid,
            "email": "admin@mooddrop.app",
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
            {"email": "admin@mooddrop.app"},
            {"$set": {"is_admin": True, "pro": True}},
        )
    # seed a couple of demo friends so feed is not empty
    for (email, name, color, emotion) in [
        ("luna@mooddrop.app", "Luna", "#A78BFA", "nostalgia"),
        ("rio@mooddrop.app", "Rio", "#2DD4BF", "focus"),
        ("sage@mooddrop.app", "Sage", "#34D399", "peace"),
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
# Moods
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
        raise HTTPException(status_code=404, detail="Mood not found")
    if mood["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your mood")
    await db.moods.delete_one({"mood_id": mood_id})
    await db.wellness_cache.delete_many({"user_id": user["user_id"], "day_key": mood.get("day_key")})
    return {"ok": True}


@api.post("/moods")
async def create_mood(data: MoodDropIn, user: dict = Depends(get_current_user)):
    key = today_key()
    existing = await db.moods.find_one({"user_id": user["user_id"], "day_key": key})
    if existing:
        raise HTTPException(status_code=400, detail="You already dropped your mood today. Come back tomorrow!")

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
        "word": data.word.strip(),
        "emotion": data.emotion,
        "color": EMOTIONS[data.emotion],
        "intensity": data.intensity,
        "photo_b64": data.photo_b64,
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
            raise HTTPException(status_code=403, detail="Drop your mood to unlock")
    return {"audio_b64": mood["audio_b64"], "audio_seconds": mood.get("audio_seconds")}


@api.post("/moods/{mood_id}/comment")
async def add_comment(mood_id: str, data: CommentIn, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "user_id": 1, "day_key": 1, "privacy": 1})
    if not mood:
        raise HTTPException(status_code=404, detail="Mood not found")
    # Author or friend with reciprocity rule
    if mood["user_id"] != user["user_id"]:
        if mood.get("privacy") == "private":
            raise HTTPException(status_code=403, detail="Private mood")
        fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": mood["user_id"]})
        if not fship:
            raise HTTPException(status_code=403, detail="Not friends")
        mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": mood["day_key"]})
        if not mine:
            raise HTTPException(status_code=403, detail="Drop your mood to comment")
    comment = {
        "comment_id": f"cmt_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "name": user.get("name", ""),
        "avatar_color": user.get("avatar_color", "#A78BFA"),
        "text": data.text.strip(),
        "at": now_utc().isoformat(),
    }
    await db.moods.update_one({"mood_id": mood_id}, {"$push": {"comments": comment}})
    return {"ok": True, "comment": comment}


@api.get("/moods/{mood_id}/comments")
async def get_comments(mood_id: str, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "comments": 1, "user_id": 1, "privacy": 1, "day_key": 1})
    if not mood:
        raise HTTPException(status_code=404, detail="Mood not found")
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
        raise HTTPException(status_code=404, detail="Mood not found")
    # prevent duplicate from same user
    new_reaction = {"user_id": user["user_id"], "name": user.get("name", ""), "emoji": data.emoji, "at": now_utc().isoformat()}
    await db.moods.update_one(
        {"mood_id": mood_id},
        {"$pull": {"reactions": {"user_id": user["user_id"]}}}
    )
    await db.moods.update_one({"mood_id": mood_id}, {"$push": {"reactions": new_reaction}})
    return {"ok": True}


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
# Friends
# =========================================================================
@api.get("/music/search")
async def music_search(q: str, user: dict = Depends(get_current_user)):
    """Search tracks on Apple's iTunes catalog (free, no auth). Returns tracks with a 30s preview MP3 URL.

    Response: { tracks: [{ track_id, name, artist, artwork_url, preview_url, source }] }
    """
    if not is_pro(user):
        raise HTTPException(status_code=403, detail="Background music is a Pro feature")
    q = (q or "").strip()
    if len(q) < 2:
        return {"tracks": []}
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_http:
            r = await client_http.get(
                "https://itunes.apple.com/search",
                params={"term": q, "media": "music", "entity": "song", "limit": 20},
                headers={"User-Agent": "MoodDrop/1.0"},
            )
        data = r.json() if r.status_code == 200 else {"results": []}
    except Exception as e:
        logger.warning(f"iTunes search failed: {e}")
        data = {"results": []}
    results = []
    for t in data.get("results", []):
        if not t.get("previewUrl"):
            continue
        art = t.get("artworkUrl100") or ""
        # Upgrade artwork to 300x300 for better quality
        if art:
            art = art.replace("100x100bb", "300x300bb")
        results.append({
            "track_id": str(t.get("trackId")) if t.get("trackId") else t.get("previewUrl", "")[:48],
            "name": t.get("trackName") or "",
            "artist": t.get("artistName") or "",
            "artwork_url": art,
            "preview_url": t.get("previewUrl"),
            "source": "apple",
        })
    return {"tracks": results[:15]}


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
    # Did they drop today?
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
        metadata={"user_id": user["user_id"], "product": "mooddrop_pro_monthly"},
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
        "metadata": {"product": "mooddrop_pro_monthly"},
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
    return {"app": "MoodDrop", "version": "1.0"}


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
    cid = _conv_id(user["user_id"], peer_id)
    now = now_utc()
    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "conversation_id": cid,
        "sender_id": user["user_id"],
        "sender_name": user.get("name", ""),
        "text": data.text.strip(),
        "at": now.isoformat(),
    }
    await db.messages.insert_one(dict(msg))
    await db.conversations.update_one(
        {"conversation_id": cid},
        {
            "$set": {
                "conversation_id": cid,
                "participants": sorted([user["user_id"], peer_id]),
                "last_text": data.text.strip()[:200],
                "last_at": now.isoformat(),
            },
            "$inc": {f"unread.{peer_id}": 1},
        },
        upsert=True,
    )
    msg.pop("_id", None)
    return {"ok": True, "message": msg}


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
        "You are MoodDrop's gentle wellness coach. "
        "Given a user's emotion and optional mood word, craft a short uplifting message. "
        "Rules: Return STRICT JSON with keys 'quote' and 'advice'. "
        "- 'quote': one-sentence poetic reflection (max 120 chars), no author attribution. "
        "- 'advice': one actionable, concrete tip a person can do in under 3 minutes (max 200 chars), empathetic, no platitudes. "
        "Never use markdown, quotes, or emoji in the output values. Never wrap in code fences."
    )
    prompt = (
        f"User name: {user_name}. Emotion: {emotion} ({tone}). "
        f"Mood word: {word or '—'}. Intensity: {intensity if intensity is not None else '—'}/10. "
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
