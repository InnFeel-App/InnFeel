"""Streak routes — let users save a missed day with a freeze.

QUOTAS (refreshed on the 1st of each calendar month):
  • Free: 0 freezes/month  (Pro upsell)
  • Pro:  2 freezes/month
  • Zen:  4 freezes/month

BUNDLE PURCHASE (available to ALL users, including Free):
  • +3 extra freezes for €1.99
  • Limited to 1 bundle/month per user
  • Only offered/visible when current streak >= 7 days
  • Stored in `users.streak_freezes_purchased` (cumulative, never resets)

A freeze can only bridge YESTERDAY (so you can't retro-spam old days).
Today's aura must already be posted — otherwise the freeze does nothing.

Records:
  • `users.streak_freezes`            — list of {day_key, ts, source: "monthly"|"bundle"}
  • `users.streak_freezes_purchased`  — int, cumulative count of bundle freezes available
  • `users.streak_freezes_total`      — int, lifetime usage counter (analytics)
  • `users.bundle_purchases`          — list of {month_key, ts, payment_id}
"""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException

from app_core.db import db
from app_core.deps import get_current_user, is_pro, now_utc
from app_core.helpers import compute_streak

router = APIRouter()

# Quotas — single source of truth
QUOTA_FREE = 0
QUOTA_PRO = 2
QUOTA_ZEN = 4
BUNDLE_FREEZES = 3
BUNDLE_PRICE_EUR = 1.99
BUNDLE_MIN_STREAK = 7  # bundle only offered when streak >= 7


def _current_month_key(dt) -> str:
    return dt.strftime("%Y-%m")


def _plan_quota(user: dict) -> int:
    """Monthly freeze quota based on tier (`plan` field, fallback to is_pro flag)."""
    plan = (user.get("plan") or "").lower()
    if plan == "zen":
        return QUOTA_ZEN
    if plan == "pro" or is_pro(user):
        return QUOTA_PRO
    return QUOTA_FREE


def _used_this_month(user: dict) -> int:
    cur = _current_month_key(now_utc())
    return sum(
        1
        for f in (user.get("streak_freezes") or [])
        if isinstance(f.get("day_key"), str)
        and f["day_key"][:7] == cur
        and (f.get("source") or "monthly") == "monthly"
    )


def _bundle_purchased_this_month(user: dict) -> bool:
    cur = _current_month_key(now_utc())
    for p in (user.get("bundle_purchases") or []):
        if p.get("month_key") == cur:
            return True
    return False


@router.get("/streak/freeze-status")
async def freeze_status(user: dict = Depends(get_current_user)):
    """How many freezes the user has + whether yesterday is freezable + bundle eligibility."""
    quota = _plan_quota(user)
    used = _used_this_month(user)
    monthly_remaining = max(0, quota - used)
    bundle_remaining = int(user.get("streak_freezes_purchased") or 0)
    total_remaining = monthly_remaining + bundle_remaining

    yesterday_key = (now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")
    today_key = now_utc().strftime("%Y-%m-%d")
    yesterday_post = await db.moods.find_one(
        {"user_id": user["user_id"], "day_key": yesterday_key},
        {"_id": 0, "mood_id": 1},
    )
    today_post = await db.moods.find_one(
        {"user_id": user["user_id"], "day_key": today_key},
        {"_id": 0, "mood_id": 1},
    )
    used_freezes_keys = {f.get("day_key") for f in (user.get("streak_freezes") or [])}
    can_freeze_yesterday = (
        total_remaining > 0
        and not yesterday_post
        and bool(today_post)
        and yesterday_key not in used_freezes_keys
    )

    # Compute current streak so the client can decide bundle visibility (UI gate).
    current_streak = await compute_streak(user["user_id"])
    bundle_eligible = (
        current_streak >= BUNDLE_MIN_STREAK
        and not _bundle_purchased_this_month(user)
    )

    plan = (user.get("plan") or "").lower() or ("pro" if is_pro(user) else "free")

    return {
        "plan": plan,
        "quota": quota,
        "used_this_month": used,
        "monthly_remaining": monthly_remaining,
        "bundle_remaining": bundle_remaining,
        "remaining": total_remaining,
        "can_freeze_yesterday": can_freeze_yesterday,
        "yesterday_key": yesterday_key,
        "current_streak": current_streak,
        "bundle": {
            "eligible": bundle_eligible,
            "min_streak": BUNDLE_MIN_STREAK,
            "freezes": BUNDLE_FREEZES,
            "price_eur": BUNDLE_PRICE_EUR,
            "purchased_this_month": _bundle_purchased_this_month(user),
        },
    }


@router.post("/streak/freeze")
async def use_freeze(user: dict = Depends(get_current_user)):
    """Spend a freeze on yesterday. Consumes monthly quota first, falls back to bundle."""
    quota = _plan_quota(user)
    used = _used_this_month(user)
    monthly_remaining = max(0, quota - used)
    bundle_remaining = int(user.get("streak_freezes_purchased") or 0)

    if monthly_remaining <= 0 and bundle_remaining <= 0:
        if quota == 0:
            raise HTTPException(
                status_code=403,
                detail="Streak freeze is a Pro feature — upgrade or buy a bundle",
            )
        raise HTTPException(status_code=403, detail="No freezes left this month")

    yesterday_key = (now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")
    today_key = now_utc().strftime("%Y-%m-%d")

    # Server-side eligibility re-check (UI hides the button but we re-validate).
    today_post = await db.moods.find_one(
        {"user_id": user["user_id"], "day_key": today_key}
    )
    if not today_post:
        raise HTTPException(
            status_code=400,
            detail="Drop today's aura first to save your streak",
        )
    yesterday_post = await db.moods.find_one(
        {"user_id": user["user_id"], "day_key": yesterday_key}
    )
    if yesterday_post:
        raise HTTPException(status_code=400, detail="Yesterday already has an aura")

    used_keys = {f.get("day_key") for f in (user.get("streak_freezes") or [])}
    if yesterday_key in used_keys:
        raise HTTPException(status_code=400, detail="Yesterday is already frozen")

    # Decide source: monthly first, then bundle
    source = "monthly" if monthly_remaining > 0 else "bundle"
    update_doc = {
        "$push": {
            "streak_freezes": {
                "day_key": yesterday_key,
                "ts": now_utc(),
                "source": source,
            }
        },
        "$inc": {"streak_freezes_total": 1},
    }
    if source == "bundle":
        # Decrement bundle balance atomically
        update_doc["$inc"]["streak_freezes_purchased"] = -1

    await db.users.update_one({"user_id": user["user_id"]}, update_doc)

    new_streak = await compute_streak(user["user_id"])
    new_monthly_remaining = monthly_remaining - 1 if source == "monthly" else monthly_remaining
    new_bundle_remaining = bundle_remaining - 1 if source == "bundle" else bundle_remaining
    return {
        "ok": True,
        "frozen_day": yesterday_key,
        "source": source,
        "streak": new_streak,
        "monthly_remaining": new_monthly_remaining,
        "bundle_remaining": new_bundle_remaining,
        "remaining": new_monthly_remaining + new_bundle_remaining,
    }


@router.post("/streak/bundle/purchase")
async def purchase_bundle(user: dict = Depends(get_current_user)):
    """Purchase a bundle of +3 freezes for €1.99.

    NOTE: This is the SERVER-SIDE consume endpoint. Real payment validation
    (Stripe / RevenueCat IAP receipt verification) will be wired in later — for
    now we mark the purchase + grant the freezes. The client should only call
    this AFTER a successful native IAP / Stripe checkout.
    """
    # Eligibility gates (server-side enforcement — client may also enforce).
    current_streak = await compute_streak(user["user_id"])
    if current_streak < BUNDLE_MIN_STREAK:
        raise HTTPException(
            status_code=403,
            detail=f"Bundle unlocks at a {BUNDLE_MIN_STREAK}-day streak",
        )
    if _bundle_purchased_this_month(user):
        raise HTTPException(
            status_code=403,
            detail="Bundle already purchased this month",
        )

    cur_month = _current_month_key(now_utc())
    payment_id = f"bundle_{cur_month}_{user['user_id'][-6:]}"  # placeholder until IAP wired

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$inc": {"streak_freezes_purchased": BUNDLE_FREEZES},
            "$push": {
                "bundle_purchases": {
                    "month_key": cur_month,
                    "ts": now_utc(),
                    "payment_id": payment_id,
                    "freezes": BUNDLE_FREEZES,
                    "price_eur": BUNDLE_PRICE_EUR,
                }
            },
        },
    )

    refreshed = await db.users.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "streak_freezes_purchased": 1},
    )
    return {
        "ok": True,
        "freezes_granted": BUNDLE_FREEZES,
        "bundle_remaining": int((refreshed or {}).get("streak_freezes_purchased") or 0),
        "price_eur": BUNDLE_PRICE_EUR,
        "payment_id": payment_id,
    }
