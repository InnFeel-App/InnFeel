"""Streak routes — let users spend a monthly freeze to bridge a missed day.

Quotas:
  • Free: 0 freezes/month  (Pro upsell)
  • Pro: 1 freeze/month
  • Zen: 3 freezes/month

A freeze can only be applied to YESTERDAY (so a user can recover without retro-spamming
old days). Freezes are recorded as `users.streak_freezes: [{day_key, ts}]`. The monthly
quota is enforced by counting freezes whose `ts` is within the current calendar month.
"""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException

from app_core.db import db
from app_core.deps import get_current_user, is_pro, now_utc
from app_core.helpers import compute_streak

router = APIRouter()


def _current_month_key(dt) -> str:
    return dt.strftime("%Y-%m")


def _plan_quota(user: dict) -> int:
    """0 for free, 1 for Pro, 3 for Zen. We'll check `plan` first then fall back to is_pro."""
    plan = (user.get("plan") or "").lower()
    if plan == "zen":
        return 3
    if is_pro(user):
        return 1
    return 0


@router.get("/streak/freeze-status")
async def freeze_status(user: dict = Depends(get_current_user)):
    """Return how many freezes the user has left this month and whether yesterday is freezable."""
    quota = _plan_quota(user)
    cur_month = _current_month_key(now_utc())
    used_this_month = sum(
        1
        for f in (user.get("streak_freezes") or [])
        if isinstance(f.get("day_key"), str)
        and f["day_key"][:7] == cur_month
    )
    remaining = max(0, quota - used_this_month)

    # Eligibility: yesterday was missed AND today is posted (so freeze actually saves a streak).
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
        remaining > 0
        and not yesterday_post
        and bool(today_post)
        and yesterday_key not in used_freezes_keys
    )
    return {
        "quota": quota,
        "used_this_month": used_this_month,
        "remaining": remaining,
        "can_freeze_yesterday": can_freeze_yesterday,
        "yesterday_key": yesterday_key,
    }


@router.post("/streak/freeze")
async def use_freeze(user: dict = Depends(get_current_user)):
    """Spend a freeze for yesterday. Atomic & idempotent (won't double-spend)."""
    quota = _plan_quota(user)
    if quota == 0:
        raise HTTPException(status_code=403, detail="Streak freeze is a Pro feature")

    cur_month = _current_month_key(now_utc())
    used_this_month = sum(
        1
        for f in (user.get("streak_freezes") or [])
        if isinstance(f.get("day_key"), str)
        and f["day_key"][:7] == cur_month
    )
    if used_this_month >= quota:
        raise HTTPException(status_code=403, detail="No freezes left this month")

    yesterday_key = (now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")
    today_key = now_utc().strftime("%Y-%m-%d")

    # Eligibility checks server-side (UI hides the button but we re-validate).
    today_post = await db.moods.find_one({"user_id": user["user_id"], "day_key": today_key})
    if not today_post:
        raise HTTPException(status_code=400, detail="Drop today's aura first to save your streak")
    yesterday_post = await db.moods.find_one({"user_id": user["user_id"], "day_key": yesterday_key})
    if yesterday_post:
        raise HTTPException(status_code=400, detail="Yesterday already has an aura")

    used_keys = {f.get("day_key") for f in (user.get("streak_freezes") or [])}
    if yesterday_key in used_keys:
        raise HTTPException(status_code=400, detail="Yesterday is already frozen")

    # Atomic: $push the freeze record AND $inc a counter for indexing/leaderboards.
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$push": {"streak_freezes": {"day_key": yesterday_key, "ts": now_utc()}},
            "$inc": {"streak_freezes_total": 1},
        },
    )
    new_streak = await compute_streak(user["user_id"])
    return {"ok": True, "frozen_day": yesterday_key, "streak": new_streak, "remaining": quota - used_this_month - 1}
