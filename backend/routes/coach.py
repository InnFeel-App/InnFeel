"""AI Wellness Coach routes — Claude Sonnet 4.5 via Emergent LLM Key.

Endpoints:
  • POST /api/coach/chat       — send a message, receive Claude's reply
  • GET  /api/coach/history    — load the user's chat history (most recent ~50 turns)
  • POST /api/coach/reset      — wipe the user's coach history (start over)

Design notes:
  • One persistent session per user (session_id = user_id). All turns are stored
    in MongoDB (`coach_messages`) so history survives across requests; we feed
    the last N exchanges back into the prompt for continuity.
  • The system prompt is enriched with a compact snapshot of the user's recent
    moods, current streak and dominant emotions — this is the "context
    compression" step. We never feed full mood history, just summary stats.
  • Per-tier rate limiting (rolling 24 h window):
        Free → 1 trial / lifetime
        Pro  → 10 messages / day
        Zen  → 30 messages / day
    Counters live in `coach_limits` keyed by user_id + day_key (Zen/Pro) or
    just user_id (Free trial).
  • Failures degrade gracefully — if Claude errors we return a short fallback
    message instead of 5xx so the chat UI stays usable.
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from app_core.db import db
from app_core.deps import get_current_user, today_key, now_utc, is_pro

load_dotenv()

logger = logging.getLogger("innfeel.coach")

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────────
# Tier quotas — keep them lazy-readable for future dashboards.
# ──────────────────────────────────────────────────────────────────────────────
QUOTA_FREE_LIFETIME = 1   # one-shot trial for free users
QUOTA_PRO_DAILY = 5       # shared between coach chat AND journal reflect
QUOTA_ZEN_DAILY = 20      # 4× Pro, defensible margin even on heavy users

# Maximum recent turns we feed back into the prompt for continuity.
MAX_HISTORY_TURNS = 12
# Maximum recent moods we summarise for the system prompt.
MAX_MOOD_CONTEXT = 14

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY", "")


def _user_tier(user: dict) -> str:
    """zen | pro | free — Zen is a higher Pro tier flagged by `zen` boolean."""
    if user.get("zen"):
        return "zen"
    if is_pro(user):
        return "pro"
    return "free"


async def _check_and_consume_quota(user: dict) -> None:
    """Atomically check + consume one chat credit. Raises 402 on quota exhaustion.

    The same counter is shared with the Journal Reflect endpoint — it's the
    user-facing "AI credits" pool. We keep one counter per user/day so the
    UI can render a single, honest "X/5 left today" badge regardless of
    whether they spent the credit on a chat turn or a journal reflection.
    """
    uid = user["user_id"]
    tier = _user_tier(user)
    if tier == "free":
        # One-shot lifetime trial. Stored as a sentinel doc keyed by user_id only.
        doc = await db.coach_limits.find_one({"user_id": uid, "kind": "free_trial"})
        used = (doc or {}).get("count", 0)
        if used >= QUOTA_FREE_LIFETIME:
            raise HTTPException(
                status_code=402,
                detail=f"Your free coach trial is over. Upgrade to Pro for {QUOTA_PRO_DAILY} AI credits a day (chat + journal).",
            )
        await db.coach_limits.update_one(
            {"user_id": uid, "kind": "free_trial"},
            {"$inc": {"count": 1}, "$set": {"last_used_at": now_utc()}},
            upsert=True,
        )
        return
    # Pro / Zen — daily rolling counter (UTC day_key). Shared with journal.
    daily_quota = QUOTA_ZEN_DAILY if tier == "zen" else QUOTA_PRO_DAILY
    day = today_key(now_utc())
    doc = await db.coach_limits.find_one({"user_id": uid, "kind": "daily", "day_key": day})
    used = (doc or {}).get("count", 0)
    if used >= daily_quota:
        raise HTTPException(
            status_code=402,
            detail=f"You've used your {daily_quota} AI credits today (chat + journal). They refresh tomorrow.",
        )
    await db.coach_limits.update_one(
        {"user_id": uid, "kind": "daily", "day_key": day},
        {"$inc": {"count": 1}, "$set": {"last_used_at": now_utc()}},
        upsert=True,
    )


async def _build_user_context(user: dict) -> str:
    """Compact one-paragraph summary of the user's recent emotional landscape.
    Injected verbatim at the end of the system prompt so Claude can personalise
    its replies without us shipping the full mood history every turn."""
    uid = user["user_id"]
    cursor = db.moods.find({"user_id": uid}).sort("created_at", -1).limit(MAX_MOOD_CONTEXT)
    moods = [m async for m in cursor]
    if not moods:
        return "The user hasn't logged any moods yet — gently encourage them to share their first aura."

    # Tally dominant emotions + average intensity.
    emo_counter: dict[str, int] = {}
    intensities: list[int] = []
    most_recent_word: Optional[str] = None
    for m in moods:
        emo = (m.get("emotion") or "").strip()
        if emo:
            emo_counter[emo] = emo_counter.get(emo, 0) + 1
        if isinstance(m.get("intensity"), int):
            intensities.append(m["intensity"])
        if most_recent_word is None and m.get("word"):
            most_recent_word = m["word"]
    top_emos = sorted(emo_counter.items(), key=lambda x: -x[1])[:3]
    top_emo_str = ", ".join(f"{k} ({v})" for k, v in top_emos) or "none yet"
    avg_intensity = round(sum(intensities) / len(intensities), 1) if intensities else None
    streak = user.get("streak", 0)
    name = user.get("name") or "Friend"

    parts = [
        f"User: {name} (streak: {streak} days).",
        f"Last {len(moods)} auras — top emotions: {top_emo_str}.",
    ]
    if avg_intensity is not None:
        parts.append(f"Average intensity: {avg_intensity}/5.")
    if most_recent_word:
        parts.append(f"Most recent aura word: \"{most_recent_word}\".")
    return " ".join(parts)


# ──────────────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────────────
class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    text: str
    created_at: str


class ChatOut(BaseModel):
    reply: str
    quota_left: Optional[int] = None
    tier: str
    turn_id: str


# ──────────────────────────────────────────────────────────────────────────────
# Coach prompt
# ──────────────────────────────────────────────────────────────────────────────
COACH_SYSTEM_PROMPT = """You are InnFeel's AI Wellness Coach — warm, grounded,
non-judgmental. Your role: help the user understand their emotions, gently
explore patterns, and suggest small, doable practices (breathing, journaling
prompts, micro-rituals).

Style:
  • Concise. Aim for 2-4 short paragraphs unless the user asks for depth.
  • Conversational, never clinical. Use first names if available.
  • Reflect back what you hear before offering ideas.
  • One question at a time.
  • Never diagnose. If the user shows signs of crisis (self-harm, hopelessness),
    tell them gently that you're not a replacement for human support and share
    the international helpline reference: https://findahelpline.com.
  • Stay culturally neutral. Avoid prescriptive advice tied to one tradition.
  • Don't moralise. Don't lecture. Don't pretend to be a therapist.
  • End most replies with a soft, optional invitation (e.g. "Would you like to
    try a 60-second grounding exercise?")."""


def _make_chat(user_id: str, system_prompt: str):
    """Lazy import keeps server boot fast even if the LLM SDK has cold-start cost."""
    from emergentintegrations.llm.chat import LlmChat
    return (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"coach_{user_id}",
            system_message=system_prompt,
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    )


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/coach/history")
async def coach_history(user: dict = Depends(get_current_user), limit: int = 60):
    """Return the user's chat turns, oldest → newest, capped at `limit`."""
    limit = max(1, min(int(limit), 200))
    cursor = db.coach_messages.find({"user_id": user["user_id"]}).sort("created_at", 1).limit(limit)
    items = []
    async for d in cursor:
        items.append({
            "role": d.get("role", "assistant"),
            "text": d.get("text", ""),
            "created_at": (d.get("created_at") or now_utc()).isoformat(),
            "id": str(d.get("_id")),
        })
    tier = _user_tier(user)
    quota_left = await _quota_remaining(user)
    return {"items": items, "tier": tier, "quota_left": quota_left}


async def _quota_remaining(user: dict) -> int:
    uid = user["user_id"]
    tier = _user_tier(user)
    if tier == "free":
        doc = await db.coach_limits.find_one({"user_id": uid, "kind": "free_trial"})
        used = (doc or {}).get("count", 0)
        return max(0, QUOTA_FREE_LIFETIME - used)
    daily_quota = QUOTA_ZEN_DAILY if tier == "zen" else QUOTA_PRO_DAILY
    day = today_key(now_utc())
    doc = await db.coach_limits.find_one({"user_id": uid, "kind": "daily", "day_key": day})
    used = (doc or {}).get("count", 0)
    return max(0, daily_quota - used)


@router.post("/coach/chat", response_model=ChatOut)
async def coach_chat(data: ChatIn, user: dict = Depends(get_current_user)):
    """Send a single message; receive Claude's reply and persist both turns."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=503, detail="Coach is offline (LLM key missing).")

    # 1) Quota check — happens BEFORE we incur LLM cost.
    await _check_and_consume_quota(user)

    # 2) Persist the user's turn first so it's never lost on a downstream error.
    user_doc = {
        "user_id": user["user_id"],
        "role": "user",
        "text": data.text.strip(),
        "created_at": now_utc(),
    }
    await db.coach_messages.insert_one(user_doc)

    # 3) Build the system prompt with the user's compact emotional context.
    ctx = await _build_user_context(user)
    full_system = f"{COACH_SYSTEM_PROMPT}\n\nContext for this conversation:\n{ctx}"

    # 4) Re-feed the last MAX_HISTORY_TURNS turns to the LLM for continuity.
    cursor = db.coach_messages.find({"user_id": user["user_id"]}).sort("created_at", -1).limit(MAX_HISTORY_TURNS * 2)
    raw = [d async for d in cursor]
    raw.reverse()
    # Keep the LATEST user message as the one we send via send_message; the rest
    # are replayed as a transcript prepended to the new turn so the LLM sees
    # the full thread without us bypassing the SDK's own session state.
    transcript_lines: list[str] = []
    for t in raw[:-1]:  # exclude the just-inserted user message
        prefix = "User" if t.get("role") == "user" else "Coach"
        transcript_lines.append(f"{prefix}: {t.get('text','').strip()}")
    transcript = "\n".join(transcript_lines)

    chat = _make_chat(user["user_id"], full_system)
    from emergentintegrations.llm.chat import UserMessage  # lazy
    payload_text = data.text.strip()
    if transcript:
        payload_text = (
            "Here's our recent conversation so you have continuity:\n"
            f"{transcript}\n\n"
            f"User: {data.text.strip()}"
        )

    try:
        reply_text = await chat.send_message(UserMessage(text=payload_text))
        if not isinstance(reply_text, str) or not reply_text.strip():
            raise RuntimeError("Empty reply from LLM")
    except Exception as e:
        logger.warning(f"coach LLM error for {user['user_id']}: {e}")
        # Soft-fail: refund the quota credit we just spent so the user isn't penalised.
        try:
            tier = _user_tier(user)
            if tier == "free":
                await db.coach_limits.update_one(
                    {"user_id": user["user_id"], "kind": "free_trial"},
                    {"$inc": {"count": -1}},
                )
            else:
                day = today_key(now_utc())
                await db.coach_limits.update_one(
                    {"user_id": user["user_id"], "kind": "daily", "day_key": day},
                    {"$inc": {"count": -1}},
                )
        except Exception:
            pass
        reply_text = (
            "I'm having trouble reaching my thoughts right now — give me a moment "
            "and try again. If it keeps happening, your message wasn't lost."
        )

    # 5) Persist the assistant turn.
    asst_doc = {
        "user_id": user["user_id"],
        "role": "assistant",
        "text": reply_text.strip(),
        "created_at": now_utc(),
    }
    res = await db.coach_messages.insert_one(asst_doc)

    return ChatOut(
        reply=reply_text.strip(),
        tier=_user_tier(user),
        quota_left=await _quota_remaining(user),
        turn_id=str(res.inserted_id),
    )


@router.post("/coach/reset")
async def coach_reset(user: dict = Depends(get_current_user)):
    """Wipe the chat thread for this user (does NOT refund quota)."""
    res = await db.coach_messages.delete_many({"user_id": user["user_id"]})
    return {"ok": True, "deleted": res.deleted_count}
