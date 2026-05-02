from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
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

# =========================================================================
# Config
# =========================================================================
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MINUTES = 60 * 24 * 7  # 7 days for mobile convenience
REFRESH_TOKEN_TTL_DAYS = 30

PRO_PRICE_USD = 4.99  # monthly

# Emotion color palette
EMOTIONS = {
    "calm": "#60A5FA",
    "joy": "#FDE047",
    "love": "#F472B6",
    "anger": "#F87171",
    "anxiety": "#FB923C",
    "sadness": "#818CF8",
    "focus": "#2DD4BF",
    "excitement": "#F97316",
    "peace": "#34D399",
    "nostalgia": "#A78BFA",
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
        "pro": is_pro(u),
        "pro_expires_at": u.get("pro_expires_at").isoformat() if isinstance(u.get("pro_expires_at"), datetime) else u.get("pro_expires_at"),
        "friend_count": u.get("friend_count", 0),
        "streak": u.get("streak", 0),
        "created_at": u.get("created_at").isoformat() if isinstance(u.get("created_at"), datetime) else u.get("created_at"),
    }


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


class MoodDropIn(BaseModel):
    word: str = Field(min_length=1, max_length=30)
    emotion: Literal["calm", "joy", "love", "anger", "anxiety", "sadness", "focus", "excitement", "peace", "nostalgia"]
    intensity: int = Field(ge=1, le=10)
    photo_b64: Optional[str] = None  # base64 image
    text: Optional[str] = Field(default=None, max_length=280)
    audio_b64: Optional[str] = None  # base64 audio
    privacy: Literal["friends", "close", "private"] = "friends"


class ReactionIn(BaseModel):
    emoji: Literal["heart", "fire", "hug", "smile", "sparkle"]


class AddFriendIn(BaseModel):
    email: EmailStr


class CheckoutIn(BaseModel):
    origin_url: str


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
            "friend_count": 0,
            "streak": 0,
            "created_at": now_utc(),
        })
        logger.info("Seeded admin user")
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
    # count consecutive days ending today with a mood drop
    streak = 0
    d = now_utc()
    for _ in range(365):
        key = d.strftime("%Y-%m-%d")
        found = await db.moods.find_one({"user_id": user_id, "day_key": key})
        if found:
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
    cursor = db.moods.find(
        {"user_id": {"$in": friend_ids}, "day_key": key, "privacy": {"$ne": "private"}},
        {"_id": 0, "audio_b64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(200)
    # attach author info
    authors = await db.users.find({"user_id": {"$in": friend_ids}}, {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1}).to_list(1000)
    author_map = {a["user_id"]: a for a in authors}
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
        a = author_map.get(it["user_id"], {})
        it["author_name"] = a.get("name", "Friend")
        it["author_color"] = a.get("avatar_color", "#A78BFA")
    return {"locked": False, "items": items}


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
            since = since_d = now_utc() - timedelta(days=days)
            ms = await db.moods.find({"user_id": user["user_id"], "created_at": {"$gte": since}}, {"_id": 0, "photo_b64": 0, "audio_b64": 0}).to_list(2000)
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
@api.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    fships = await db.friendships.find({"user_id": user["user_id"]}).to_list(500)
    ids = [f["friend_id"] for f in fships]
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "avatar_color": 1, "streak": 1}).to_list(500)
    # Did they drop today?
    key = today_key()
    moods = await db.moods.find({"user_id": {"$in": ids}, "day_key": key}, {"_id": 0, "user_id": 1}).to_list(500)
    drop_set = {m["user_id"] for m in moods}
    for u in users:
        u["dropped_today"] = u["user_id"] in drop_set
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
    origin = data.origin_url.rstrip("/")
    success_url = f"{origin}/payment-success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/paywall"
    req = CheckoutSessionRequest(
        amount=PRO_PRICE_USD,
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user["user_id"], "product": "mooddrop_pro_monthly"},
    )
    session = await stripe.create_checkout_session(req)
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
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"pro": False, "pro_expires_at": None}})
        return {"pro": False}
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"pro": True, "pro_expires_at": now_utc() + timedelta(days=30)}},
    )
    return {"pro": True}


@api.get("/")
async def root():
    return {"app": "MoodDrop", "version": "1.0"}


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
