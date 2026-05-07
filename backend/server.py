from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import uuid
import logging
import json
import hashlib
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Body
from starlette.middleware.cors import CORSMiddleware
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutStatusResponse,
    CheckoutSessionRequest,
)
from emergentintegrations.llm.chat import LlmChat, UserMessage

# Shared infrastructure (moved out of this file for maintainability)
from app_core.config import (
    STRIPE_API_KEY, EMERGENT_LLM_KEY,
)
from app_core.constants import EMOTIONS, PRO_PRICE_USD
from app_core.db import client, db
from app_core.deps import (
    now_utc, today_key,
    hash_password,
    get_current_user, is_pro, sanitize_user,
)
from app_core.models import (
    InnFeelIn,
    AvatarIn, ReactionIn, CommentIn, MessageIn, AddFriendIn,
    CheckoutIn, AdminGrantProIn, AdminRevokeProIn,
    PushTokenIn, NotifPrefsIn,
    MessageReactIn,
)
from app_core.push import send_push
from app_core.email import send_weekly_recap_email

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
    # Email verification tokens — TTL index for auto-cleanup
    await db.email_verifications.create_index("user_id")
    await db.email_verifications.create_index("expires_at", expireAfterSeconds=0)

    # One-time migration: rename legacy admin@innfeel.app → hello@innfeel.app
    # (Apple Custom Domain only allows 3 aliases: hello, support, noreply.)
    legacy_admin = await db.users.find_one({"email": "admin@innfeel.app"})
    if legacy_admin:
        new_admin_exists = await db.users.find_one({"email": "hello@innfeel.app"})
        if new_admin_exists and new_admin_exists.get("user_id") != legacy_admin.get("user_id"):
            await db.users.delete_one({"user_id": legacy_admin["user_id"]})
            logger.info("Removed legacy admin@innfeel.app (hello@innfeel.app already exists)")
        else:
            try:
                await db.users.update_one(
                    {"user_id": legacy_admin["user_id"]},
                    {"$set": {"email": "hello@innfeel.app"}},
                )
                logger.info("Migrated admin@innfeel.app → hello@innfeel.app")
            except Exception as e:
                logger.warning(f"admin → hello rename race ({e}); deleting legacy row.")
                await db.users.delete_one({"user_id": legacy_admin["user_id"]})

    # seed demo admin (hello@innfeel.app)
    existing = await db.users.find_one({"email": "hello@innfeel.app"})
    if not existing:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": uid,
            "email": "hello@innfeel.app",
            "password_hash": hash_password("admin123"),
            "name": "Admin",
            "avatar_color": "#F472B6",
            "pro": True,
            "zen": True,
            "pro_expires_at": now_utc() + timedelta(days=3650),
            "is_admin": True,
            "is_owner": True,
            "friend_count": 0,
            "streak": 0,
            "created_at": now_utc(),
            "email_verified_at": now_utc(),
        })
        logger.info("Seeded owner user (hello@innfeel.app) with full Zen access")
    else:
        # Ensure owner flags are set + Zen full access never expires (idempotent)
        await db.users.update_one(
            {"email": "hello@innfeel.app"},
            {"$set": {
                "is_admin": True,
                "is_owner": True,
                "pro": True,
                "zen": True,
                "pro_expires_at": now_utc() + timedelta(days=3650),
                "email_verified_at": existing.get("email_verified_at") or now_utc(),
            }},
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
                "email_verified_at": now_utc(),
            })
        elif not ex.get("email_verified_at"):
            await db.users.update_one({"email": email}, {"$set": {"email_verified_at": now_utc()}})



# =========================================================================
# Auth + Account + Media endpoints — extracted to /app/backend/routes/
# =========================================================================
from routes.auth import router as auth_router
from routes.account import router as account_router
from routes.media import router as media_router
from routes.moods import router as moods_router
from routes.friends import router as friends_router
from routes.messages import router as messages_router
from routes.share import router as share_router
from routes.streak import router as streak_router
from routes.coach import router as coach_router
from routes.journal import router as journal_router
from routes.meditation import router as meditation_router
from routes.admin import router as admin_router
from app_core import r2 as _r2
from app_core.helpers import compute_streak
api.include_router(auth_router)
api.include_router(account_router)
api.include_router(media_router)
api.include_router(moods_router)
api.include_router(friends_router)
api.include_router(messages_router)
api.include_router(share_router)
api.include_router(streak_router)
api.include_router(coach_router)
api.include_router(journal_router)
api.include_router(meditation_router)
api.include_router(admin_router)





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
        "weekly_recap": prefs.get("weekly_recap", True),
    }}


@api.post("/notifications/prefs")
async def set_notif_prefs(data: NotifPrefsIn, user: dict = Depends(get_current_user)):
    update = {}
    for cat in ("reminder", "reaction", "message", "friend", "weekly_recap"):
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


@api.get("/notifications/smart-hour")
async def get_smart_hour(user: dict = Depends(get_current_user)):
    """Smart Reminders (B4) — return the user's typical posting hour for a personalized
    daily reminder. Computed from `users.recent_local_hours` (rolling last 30 entries
    pushed by the client at post time).

    Strategy: median hour over a small histogram (more robust than mean against
    occasional late/early posts). When fewer than 5 samples, fall back to noon (12).
    """
    cur = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "recent_local_hours": 1},
    ) or {}
    samples = [
        int(h) for h in (cur.get("recent_local_hours") or [])
        if isinstance(h, (int, float)) and 0 <= int(h) <= 23
    ]

    DEFAULT_HOUR = 12
    if len(samples) < 5:
        return {
            "hour": DEFAULT_HOUR,
            "minute": 0,
            "source": "default",
            "samples": len(samples),
            "confidence": "low",
        }

    # Histogram + median (handles ties + noise gracefully)
    samples_sorted = sorted(samples)
    median = samples_sorted[len(samples_sorted) // 2]

    # If the user has a strong cluster (>= 50% of samples within ±1h of median),
    # we report high confidence — otherwise medium.
    near = sum(1 for h in samples if abs(h - median) <= 1)
    confidence = "high" if near / len(samples) >= 0.5 else "medium"

    return {
        "hour": int(median),
        "minute": 0,
        "source": "history",
        "samples": len(samples),
        "confidence": confidence,
    }



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


@api.post("/profile/avatar")
async def update_avatar(data: AvatarIn, user: dict = Depends(get_current_user)):
    update = {}
    if data.avatar_key:
        update["avatar_key"] = data.avatar_key
        update["avatar_b64"] = None  # prefer R2
    elif data.avatar_b64:
        update["avatar_b64"] = data.avatar_b64
        update["avatar_key"] = None
    else:
        raise HTTPException(status_code=400, detail="Provide avatar_key or avatar_b64")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
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


@api.post("/admin/send-weekly-recap")
async def admin_send_weekly_recap(data: dict = Body(...), user: dict = Depends(get_current_user)):
    """Admin tool — send the weekly recap email immediately to a specific user (by email).

    Body: {email: "luna@innfeel.app"} — ignores the weekly_recap_sent_at cadence guard.
    Useful for QA of the email template in each locale.
    """
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    target_email = (data.get("email") or "").strip().lower()
    if not target_email:
        raise HTTPException(status_code=400, detail="email required")
    target = await db.users.find_one({"email": target_email}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="No such user")
    ok = await _send_weekly_recap_for_user(target)
    return {"ok": ok, "email": target_email}


@api.get("/")
async def root():
    return {"app": "InnFeel", "version": "1.0"}




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


# =========================================================================
# Free-tier purge job — deletes moods older than 90 days for non-Pro users.
# Runs once per day in the background. Also cleans the corresponding R2 objects.
# =========================================================================
FREE_RETENTION_DAYS = 90


async def _purge_old_free_media_once() -> dict:
    cutoff = now_utc() - timedelta(days=FREE_RETENTION_DAYS)
    stats = {"moods_deleted": 0, "r2_objects_deleted": 0, "users_checked": 0}
    # Find all non-Pro users (or whose Pro expired)
    async for u in db.users.find({}, {"_id": 0, "user_id": 1, "pro": 1, "pro_expires_at": 1}):
        stats["users_checked"] += 1
        if is_pro(u):
            continue
        uid = u.get("user_id")
        old_cursor = db.moods.find(
            {"user_id": uid, "created_at": {"$lt": cutoff}},
            {"_id": 0, "mood_id": 1, "photo_key": 1, "video_key": 1, "audio_key": 1},
        )
        old_ids = []
        async for m in old_cursor:
            old_ids.append(m["mood_id"])
            for fld in ("photo_key", "video_key", "audio_key"):
                k = m.get(fld)
                if k and _r2.delete_object(k):
                    stats["r2_objects_deleted"] += 1
        if old_ids:
            r = await db.moods.delete_many({"mood_id": {"$in": old_ids}})
            stats["moods_deleted"] += r.deleted_count
    logger.info(f"[purge] {stats}")
    return stats


async def _purge_daemon():
    while True:
        try:
            await _purge_old_free_media_once()
        except Exception as e:
            logger.warning(f"[purge] failed: {e}")
        # Sleep 24h
        await asyncio.sleep(24 * 60 * 60)


@app.on_event("startup")
async def _boot_purge_daemon():
    asyncio.create_task(_purge_daemon())



# =========================================================================
# Weekly recap daemon — sends each user one summary email per 7 days.
# Runs every 6h; per-user cadence is enforced via `weekly_recap_sent_at` stamp.
# Users can opt out via notif_prefs.weekly_recap = false (default True).
# =========================================================================
WEEKLY_INTERVAL_DAYS = 7
WEEKLY_RECAP_CHECK_INTERVAL_SEC = 6 * 60 * 60  # 6 hours


async def _send_weekly_recap_for_user(u: dict) -> bool:
    """Compute the last-7-days snapshot for `u` and mail it. Returns True on success."""
    uid = u["user_id"]
    email = u.get("email")
    if not email:
        return False
    since = now_utc() - timedelta(days=7)
    moods7 = await db.moods.find(
        {"user_id": uid, "created_at": {"$gte": since}},
        {"_id": 0, "mood_id": 1, "emotion": 1, "reactions": 1},
    ).to_list(200)
    if not moods7:
        # Nothing to recap — skip + bump stamp so we don't re-check every 6h.
        await db.users.update_one({"user_id": uid}, {"$set": {"weekly_recap_sent_at": now_utc()}})
        return False
    dist: dict[str, int] = {}
    for m in moods7:
        e = m.get("emotion")
        if e:
            dist[e] = dist.get(e, 0) + 1
    dominant = max(dist, key=dist.get) if dist else None
    dominant_color = EMOTIONS.get(dominant) if dominant else None
    reactions_received = sum(len(m.get("reactions") or []) for m in moods7)
    from app_core.helpers import compute_streak
    streak = await compute_streak(uid)
    lang = (u.get("lang") or "en").lower()[:2]
    try:
        ok = await send_weekly_recap_email(
            email,
            name=u.get("name", ""),
            lang=lang,
            auras_count=len(moods7),
            streak=streak,
            dominant=dominant,
            dominant_color=dominant_color,
            reactions_received=reactions_received,
        )
    except Exception as e:
        logger.warning(f"[weekly] send failed for {email}: {e}")
        ok = False
    await db.users.update_one({"user_id": uid}, {"$set": {"weekly_recap_sent_at": now_utc()}})
    return ok


async def _run_weekly_recap_batch() -> dict:
    """One pass: send weekly recap to every due user."""
    cutoff = now_utc() - timedelta(days=WEEKLY_INTERVAL_DAYS)
    stats = {"checked": 0, "sent": 0, "skipped_empty": 0}
    query = {
        "email_verified_at": {"$ne": None},
        "notif_prefs.weekly_recap": {"$ne": False},  # default True when key is missing
        "$nor": [{"weekly_recap_sent_at": {"$gte": cutoff}}],
    }
    async for u in db.users.find(query, {"_id": 0, "password_hash": 0}):
        stats["checked"] += 1
        sent = await _send_weekly_recap_for_user(u)
        if sent:
            stats["sent"] += 1
        else:
            stats["skipped_empty"] += 1
    if stats["checked"]:
        logger.info(f"[weekly] {stats}")
    return stats


async def _weekly_recap_daemon():
    # Small delay on boot so startup isn't blocked by a big fan-out send.
    await asyncio.sleep(60)
    while True:
        try:
            await _run_weekly_recap_batch()
        except Exception as e:
            logger.warning(f"[weekly] batch failed: {e}")
        await asyncio.sleep(WEEKLY_RECAP_CHECK_INTERVAL_SEC)


@app.on_event("startup")
async def _boot_weekly_recap_daemon():
    asyncio.create_task(_weekly_recap_daemon())

