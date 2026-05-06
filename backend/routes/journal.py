"""Guided Journaling routes — morning + evening check-ins.

Endpoints:
  • POST /api/journal/checkin  { kind, answers, note? } → save (replace) today's entry
  • GET  /api/journal/today                              → today's morning + evening entries
  • GET  /api/journal/history?days=N                     → list past entries
  • POST /api/journal/reflect  { kind }                  → AI reflection on today's entries
                                                           (uses Coach quota — Pro/Zen only)
  • DELETE /api/journal/{entry_id}                       → delete a journal entry

Design:
  • Schema is flexible — `answers` is a dict {prompt_key: text}. The frontend
    chooses which prompts to show; the backend doesn't validate prompt keys
    so we can iterate on copy without redeploys.
  • One entry per (user_id, day_key, kind) — re-saving replaces the prior one.
  • AI reflection re-uses the existing Coach plumbing in routes/coach.py so
    we don't double the LLM call surface (one budget, one prompt template).
"""
import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from app_core.db import db
from app_core.deps import get_current_user, today_key, now_utc, is_pro

logger = logging.getLogger("innfeel.journal")

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────────────
class CheckinIn(BaseModel):
    kind: str = Field(pattern="^(morning|evening)$")
    answers: Dict[str, str] = Field(default_factory=dict)
    note: Optional[str] = Field(default=None, max_length=2000)


class ReflectIn(BaseModel):
    kind: str = Field(pattern="^(morning|evening|day)$")


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/journal/checkin")
async def journal_checkin(data: CheckinIn, user: dict = Depends(get_current_user)):
    """Upsert (replace) today's journal entry for the given kind."""
    day = today_key(now_utc())
    # Trim & cap each answer so a single entry can't blow up the doc.
    cleaned: Dict[str, str] = {}
    for k, v in (data.answers or {}).items():
        if not isinstance(v, str):
            continue
        v_clean = v.strip()[:1000]
        if v_clean:
            cleaned[k[:48]] = v_clean
    note_clean = (data.note or "").strip()[:2000] or None
    if not cleaned and not note_clean:
        raise HTTPException(status_code=400, detail="Write at least one answer or a note.")

    doc = {
        "user_id": user["user_id"],
        "kind": data.kind,
        "day_key": day,
        "answers": cleaned,
        "note": note_clean,
        "updated_at": now_utc(),
    }
    res = await db.journal_entries.find_one_and_update(
        {"user_id": user["user_id"], "kind": data.kind, "day_key": day},
        {
            "$set": doc,
            "$setOnInsert": {"created_at": now_utc()},
        },
        upsert=True,
        return_document=True,
    )
    out = res or doc
    return {
        "ok": True,
        "entry": {
            "kind": out.get("kind"),
            "day_key": out.get("day_key"),
            "answers": out.get("answers", {}),
            "note": out.get("note"),
            "updated_at": (out.get("updated_at") or now_utc()).isoformat(),
        },
    }


@router.get("/journal/today")
async def journal_today(user: dict = Depends(get_current_user)):
    day = today_key(now_utc())
    cursor = db.journal_entries.find({"user_id": user["user_id"], "day_key": day})
    entries: Dict[str, Any] = {}
    async for d in cursor:
        entries[d["kind"]] = {
            "answers": d.get("answers", {}),
            "note": d.get("note"),
            "updated_at": (d.get("updated_at") or now_utc()).isoformat(),
        }
    return {"day_key": day, "morning": entries.get("morning"), "evening": entries.get("evening")}


@router.get("/journal/history")
async def journal_history(user: dict = Depends(get_current_user), days: int = 30):
    """Return entries grouped by day_key, oldest → newest, capped by `days`."""
    days = max(1, min(int(days), 180))
    cursor = (
        db.journal_entries
        .find({"user_id": user["user_id"]})
        .sort("day_key", -1)
        .limit(days * 2)  # at most 2 entries per day (morning + evening)
    )
    by_day: Dict[str, Dict[str, Any]] = {}
    async for d in cursor:
        slot = by_day.setdefault(d["day_key"], {})
        slot[d["kind"]] = {
            "answers": d.get("answers", {}),
            "note": d.get("note"),
            "updated_at": (d.get("updated_at") or now_utc()).isoformat(),
        }
    items = [{"day_key": k, **v} for k, v in sorted(by_day.items(), reverse=True)]
    return {"items": items}


@router.post("/journal/reflect")
async def journal_reflect(data: ReflectIn, user: dict = Depends(get_current_user)):
    """AI reflection on today's journal — runs through the Coach quota.
    Pro/Zen only (the free 1-shot trial is reserved for the regular chat)."""
    if not is_pro(user) and not user.get("zen"):
        raise HTTPException(status_code=402, detail="AI reflection is a Pro feature.")
    # Reuse the Coach pipeline — quota check, LLM call, persistence.
    from routes.coach import (
        _check_and_consume_quota,
        _build_user_context,
        _make_chat,
        _quota_remaining,
        _user_tier,
        EMERGENT_LLM_KEY,
        COACH_SYSTEM_PROMPT,
    )
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=503, detail="Coach is offline (LLM key missing).")

    day = today_key(now_utc())
    cursor = db.journal_entries.find({"user_id": user["user_id"], "day_key": day})
    morning, evening = None, None
    async for d in cursor:
        if d["kind"] == "morning":
            morning = d
        elif d["kind"] == "evening":
            evening = d
    if not morning and not evening:
        raise HTTPException(status_code=404, detail="No journal entries for today yet.")

    def _format_entry(e: Optional[dict], label: str) -> str:
        if not e:
            return ""
        bits = [f"{label}:"]
        for k, v in (e.get("answers") or {}).items():
            bits.append(f"- {k}: {v}")
        if e.get("note"):
            bits.append(f"Note: {e['note']}")
        return "\n".join(bits)

    journal_text = "\n\n".join(filter(None, [
        _format_entry(morning, "Morning check-in"),
        _format_entry(evening, "Evening reflection"),
    ]))

    target_label = {
        "morning": "the morning intention check-in",
        "evening": "the evening reflection",
        "day": "the full day's journaling",
    }[data.kind]

    prompt = (
        f"Read {target_label} below and reply with a warm, 3-4 sentence reflection. "
        f"Mirror back one specific thing you noticed, name an emotion if you sense one, "
        f"and offer one tiny, doable practice (no more). Don't be generic.\n\n"
        f"{journal_text}"
    )

    await _check_and_consume_quota(user)

    ctx = await _build_user_context(user)
    full_system = f"{COACH_SYSTEM_PROMPT}\n\nContext for this conversation:\n{ctx}"
    chat = _make_chat(user["user_id"] + "_journal", full_system)
    from emergentintegrations.llm.chat import UserMessage
    try:
        reply = await chat.send_message(UserMessage(text=prompt))
        if not isinstance(reply, str) or not reply.strip():
            raise RuntimeError("Empty LLM reply")
    except Exception as e:
        logger.warning(f"journal reflect LLM error for {user['user_id']}: {e}")
        # Soft-refund the quota so the user isn't penalised.
        try:
            tier = _user_tier(user)
            if tier == "free":
                await db.coach_limits.update_one(
                    {"user_id": user["user_id"], "kind": "free_trial"},
                    {"$inc": {"count": -1}},
                )
            else:
                await db.coach_limits.update_one(
                    {"user_id": user["user_id"], "kind": "daily", "day_key": today_key(now_utc())},
                    {"$inc": {"count": -1}},
                )
        except Exception:
            pass
        reply = (
            "I couldn't reach my words right now — try again in a moment. "
            "Your journal entries were saved."
        )

    # Persist the reflection alongside the journal entry so users can revisit.
    await db.journal_entries.update_many(
        {"user_id": user["user_id"], "day_key": day, "kind": {"$in": ["morning", "evening"] if data.kind == "day" else [data.kind]}},
        {"$set": {"reflection": reply.strip(), "reflected_at": now_utc()}},
    )
    return {
        "reflection": reply.strip(),
        "quota_left": await _quota_remaining(user),
    }


@router.delete("/journal/{kind}")
async def journal_delete(kind: str, user: dict = Depends(get_current_user)):
    if kind not in ("morning", "evening"):
        raise HTTPException(status_code=400, detail="Invalid kind")
    day = today_key(now_utc())
    res = await db.journal_entries.delete_one({"user_id": user["user_id"], "day_key": day, "kind": kind})
    return {"ok": True, "deleted": res.deleted_count}
