"""Meditation routes — server-side gating of the free-tier trials.

Tier model
──────────
  • Free: ONE trial per theme (sleep, anxiety, gratitude, focus). Once
    a theme is consumed, that theme is locked behind the paywall. The
    user can still preview the picker — only `start` is gated.
  • Pro / Zen: unlimited.

The TTS narration & animation run on-device (zero server cost), so this
gate is purely about monetisation, not infrastructure protection.

Endpoints
─────────
  GET  /api/meditation/eligibility       → who can play what right now
  POST /api/meditation/start  {theme}    → consume a trial if Free, else no-op

State
─────
  users.meditation_trials_used: list[str]   — themes already consumed by
  this user (Free tier only). Pro/Zen never write here.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app_core.db import db
from app_core.deps import get_current_user, is_pro, now_utc

router = APIRouter()

# Single source of truth — keep in sync with the frontend SESSIONS map.
VALID_THEMES = ("sleep", "anxiety", "gratitude", "focus")


def _user_tier(user: dict) -> str:
    """zen | pro | free — same convention as routes/coach.py."""
    if user.get("zen"):
        return "zen"
    if is_pro(user):
        return "pro"
    return "free"


def _used_trials(user: dict) -> List[str]:
    raw = user.get("meditation_trials_used") or []
    return [t for t in raw if isinstance(t, str) and t in VALID_THEMES]


class StartIn(BaseModel):
    theme: str = Field(min_length=1, max_length=24)


@router.get("/meditation/eligibility")
async def meditation_eligibility(user: dict = Depends(get_current_user)):
    """Tell the client which themes are still free-trialable + total quota.

    Response shape (consumed by frontend `meditation.tsx` at mount):
      {
        tier: "free" | "pro" | "zen",
        used:      ["sleep", ...],     # themes already consumed (Free only)
        remaining: ["anxiety", ...],   # themes still free for this user
        unlimited: bool,               # Pro/Zen always true
        themes:    ["sleep","anxiety","gratitude","focus"]  # canonical list
      }
    """
    tier = _user_tier(user)
    if tier in ("pro", "zen"):
        return {
            "tier": tier,
            "used": [],
            "remaining": list(VALID_THEMES),
            "unlimited": True,
            "themes": list(VALID_THEMES),
        }
    used = _used_trials(user)
    remaining = [t for t in VALID_THEMES if t not in used]
    return {
        "tier": "free",
        "used": used,
        "remaining": remaining,
        "unlimited": False,
        "themes": list(VALID_THEMES),
    }


@router.post("/meditation/start")
async def meditation_start(data: StartIn, user: dict = Depends(get_current_user)):
    """Mark a theme as consumed (Free tier only) and let the client play it.

    Pro/Zen always succeed without writing anything. Free users get a 402
    if they've already used this theme — the client then routes to /paywall.
    """
    theme = data.theme.lower().strip()
    if theme not in VALID_THEMES:
        raise HTTPException(status_code=400, detail="Unknown meditation theme")

    tier = _user_tier(user)
    if tier in ("pro", "zen"):
        # Unlimited — record nothing, just confirm.
        return {"ok": True, "tier": tier, "consumed": False}

    # Free tier — atomic check-then-add. We use $addToSet so a double-tap
    # from the client doesn't double-consume; the server is the source of
    # truth, and the client's UX of "press Start once" stays naive-safe.
    used = _used_trials(user)
    if theme in used:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Your free trial for this meditation is over. Upgrade to Pro "
                f"to unlock unlimited meditations."
            ),
        )

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$addToSet": {"meditation_trials_used": theme},
            "$set": {"meditation_trials_last_at": now_utc()},
        },
    )
    return {"ok": True, "tier": "free", "consumed": True, "theme": theme}
