"""Moods routes — daily aura create/read/update/delete, feed, comments, reactions, activity.

Extracted from server.py for maintainability. Every endpoint here is mounted under /api/.
"""
import uuid
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends

from app_core.constants import EMOTIONS
from app_core.db import db
from app_core.deps import now_utc, today_key, get_current_user, is_pro
from app_core.helpers import compute_streak, resolve_media
from app_core.models import InnFeelIn, ReactionIn, CommentIn
from app_core.push import send_push
from app_core import r2 as _r2

router = APIRouter()
logger = logging.getLogger("innfeel")


@router.get("/moods/today")
async def get_today(user: dict = Depends(get_current_user)):
    key = today_key()
    mood = await db.moods.find_one({"user_id": user["user_id"], "day_key": key}, {"_id": 0})
    if mood and isinstance(mood.get("created_at"), datetime):
        mood["created_at"] = mood["created_at"].isoformat()
    if mood:
        resolve_media(mood)
    return {"mood": mood}


@router.delete("/moods/today")
async def delete_today(user: dict = Depends(get_current_user)):
    """Delete the user's own mood of today (if any). Lets them retry their drop.

    Also wipes derived daily data: today's wellness cache and today's LLM badge,
    so the next drop re-triggers a fresh wellness prompt.
    """
    key = today_key()
    result = await db.moods.delete_one({"user_id": user["user_id"], "day_key": key})
    await db.wellness_cache.delete_many({"user_id": user["user_id"], "day_key": key})
    return {"ok": True, "deleted": result.deleted_count}


@router.delete("/moods/{mood_id}")
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


@router.post("/moods")
async def create_mood(data: InnFeelIn, user: dict = Depends(get_current_user)):
    """Create OR replace today's aura (UPSERT — preserves mood_id/day_key/created_at/streak)."""
    key = today_key()
    existing = await db.moods.find_one({"user_id": user["user_id"], "day_key": key})

    pro = is_pro(user)
    has_audio = bool(data.audio_b64 or data.audio_key)
    has_video = bool(data.video_b64 or data.video_key)
    if not pro:
        if data.intensity > 5:
            raise HTTPException(status_code=403, detail="Intensity above 5 is a Pro feature")
        if data.text or has_audio:
            raise HTTPException(status_code=403, detail="Text & audio notes are Pro features")
        if data.music:
            raise HTTPException(status_code=403, detail="Background music is a Pro feature")
        if has_video:
            raise HTTPException(status_code=402, detail="Video auras are a Pro feature")

    music_obj = data.music.model_dump() if data.music else None

    if existing:
        for fld in ("photo_key", "video_key", "audio_key"):
            old_key = existing.get(fld)
            new_key = getattr(data, fld) if hasattr(data, fld) else None
            if old_key and old_key != new_key:
                try:
                    _r2.delete_object(old_key)
                except Exception as e:
                    logger.warning(f"R2 cleanup failed for {old_key}: {e}")

    mood_id = existing["mood_id"] if existing else f"mood_{uuid.uuid4().hex[:12]}"
    created_at = existing.get("created_at") if existing else now_utc()
    doc = {
        "mood_id": mood_id,
        "user_id": user["user_id"],
        "day_key": key,
        "word": (data.word or "").strip() or None,
        "emotion": data.emotion,
        "color": EMOTIONS[data.emotion],
        "intensity": data.intensity,
        "photo_key": data.photo_key,
        "photo_b64": data.photo_b64 if not data.photo_key else None,
        "video_key": data.video_key,
        "video_b64": data.video_b64 if not data.video_key else None,
        "video_seconds": min(10, data.video_seconds) if has_video and data.video_seconds else (10 if has_video else None),
        "has_video": has_video,
        "text": data.text,
        "audio_key": data.audio_key,
        "audio_b64": data.audio_b64 if not data.audio_key else None,
        "audio_seconds": data.audio_seconds if has_audio else None,
        "has_audio": has_audio,
        "music": music_obj,
        "privacy": data.privacy,
        "reactions": [],
        "comments": [],
        "created_at": created_at,
        "updated_at": now_utc() if existing else None,
    }
    if existing:
        await db.moods.replace_one({"mood_id": mood_id}, doc)
    else:
        await db.moods.insert_one(doc)
    streak = await compute_streak(user["user_id"])
    update_user: dict = {"$set": {"streak": streak}}
    # B4 — Smart Reminders: track the user's typical local posting hour. Only on
    # FRESH posts (not edits) so a single day = a single sample. We keep a rolling
    # window of the last 30 entries; the smart-hour endpoint reads from this list.
    if not existing and data.local_hour is not None:
        update_user["$push"] = {
            "recent_local_hours": {
                "$each": [int(data.local_hour)],
                "$slice": -30,  # keep only the last 30 samples
            }
        }
    await db.users.update_one({"user_id": user["user_id"]}, update_user)
    doc.pop("_id", None)
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    resolve_media(doc)
    return {"mood": doc, "streak": streak, "replaced": bool(existing)}


@router.get("/moods/feed")
async def friends_feed(user: dict = Depends(get_current_user)):
    key = today_key()
    mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": key})
    if not mine:
        return {"locked": True, "items": []}
    friendships = await db.friendships.find({"user_id": user["user_id"]}).to_list(1000)
    friend_ids = [f["friend_id"] for f in friendships]
    if not friend_ids:
        return {"locked": False, "items": []}
    # Friends that *I* marked as close (for sort priority — appear first).
    my_close_friend_ids = {f["friend_id"] for f in friendships if f.get("close")}
    # Friends that marked *me* as close (so I can see their `close`-privacy auras).
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
    for it in items:
        if "has_audio" not in it:
            it["has_audio"] = False
    authors = await db.users.find(
        {"user_id": {"$in": friend_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1, "avatar_key": 1},
    ).to_list(1000)
    author_map = {a["user_id"]: a for a in authors}
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
        a = author_map.get(it["user_id"], {})
        it["author_name"] = a.get("name", "Friend")
        it["author_color"] = a.get("avatar_color", "#A78BFA")
        it["author_avatar_b64"] = a.get("avatar_b64")
        # Flag so the client can style close-friends' cards if desired.
        it["author_is_close"] = it["user_id"] in my_close_friend_ids
        if a.get("avatar_key"):
            it["author_avatar_url"] = _r2.generate_get_url(a["avatar_key"])
        resolve_media(it)
    # Two-tier sort: close friends first, then by created_at desc within each tier.
    # `sorted` is stable — items already come pre-sorted by created_at desc.
    items.sort(key=lambda x: 0 if x.get("author_is_close") else 1)
    return {"locked": False, "items": items}


@router.get("/moods/{mood_id}/audio")
async def get_mood_audio(mood_id: str, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one(
        {"mood_id": mood_id},
        {"_id": 0, "user_id": 1, "audio_b64": 1, "audio_key": 1, "audio_seconds": 1, "privacy": 1, "day_key": 1},
    )
    if not mood or not (mood.get("audio_b64") or mood.get("audio_key")):
        raise HTTPException(status_code=404, detail="No audio")
    if mood["user_id"] != user["user_id"]:
        if mood.get("privacy") == "private":
            raise HTTPException(status_code=403, detail="Private")
        fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": mood["user_id"]})
        if not fship:
            raise HTTPException(status_code=403, detail="Not friends")
        mine = await db.moods.find_one({"user_id": user["user_id"], "day_key": mood["day_key"]})
        if not mine:
            raise HTTPException(status_code=403, detail="Share your aura to unlock")
    out = {"audio_seconds": mood.get("audio_seconds")}
    if mood.get("audio_key"):
        out["audio_url"] = _r2.generate_get_url(mood["audio_key"])
    if mood.get("audio_b64"):
        out["audio_b64"] = mood["audio_b64"]
    return out


@router.post("/moods/{mood_id}/comment")
async def add_comment(mood_id: str, data: CommentIn, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "user_id": 1, "day_key": 1, "privacy": 1, "word": 1, "emotion": 1, "color": 1})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
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


@router.get("/moods/{mood_id}/comments")
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


@router.post("/moods/{mood_id}/react")
async def react(mood_id: str, data: ReactionIn, user: dict = Depends(get_current_user)):
    mood = await db.moods.find_one({"mood_id": mood_id})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    new_reaction = {"user_id": user["user_id"], "name": user.get("name", ""), "emoji": data.emoji, "at": now_utc()}
    await db.moods.update_one(
        {"mood_id": mood_id},
        {"$pull": {"reactions": {"user_id": user["user_id"]}}},
    )
    await db.moods.update_one({"mood_id": mood_id}, {"$push": {"reactions": new_reaction}})

    if mood["user_id"] != user["user_id"]:
        await db.activity.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:12]}",
            "user_id": mood["user_id"],
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
        await send_push(
            mood["user_id"], "reaction",
            f"{user.get('name', 'Someone')} reacted to your aura ✨",
            f"They sent a {data.emoji} on your \"{mood.get('word', 'aura')}\"",
            {"route": "/activity", "mood_id": mood_id, "kind": "reaction"},
        )

    fresh = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "reactions": 1})
    return {"ok": True, "reactions": fresh.get("reactions", []) if fresh else []}


# -----------------------------------------------------------------------------
# Activity feed — co-located with moods since every activity item is about a mood
# -----------------------------------------------------------------------------
@router.get("/activity")
async def activity_feed(user: dict = Depends(get_current_user), limit: int = 50):
    """Activity feed — reactions and comments someone else made on YOUR auras."""
    cursor = db.activity.find({"user_id": user["user_id"]}, {"_id": 0}).sort("at", -1).limit(limit)
    items = await cursor.to_list(limit)
    unread = 0
    for it in items:
        if isinstance(it.get("at"), datetime):
            it["at"] = it["at"].isoformat()
        if not it.get("read", False):
            unread += 1
    return {"items": items, "unread": unread}


@router.get("/activity/unread-count")
async def activity_unread_count(user: dict = Depends(get_current_user)):
    """Lightweight endpoint for the tab/home badge."""
    n = await db.activity.count_documents({"user_id": user["user_id"], "read": False})
    return {"unread": n}


@router.post("/activity/mark-read")
async def activity_mark_read(user: dict = Depends(get_current_user)):
    await db.activity.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}


# -----------------------------------------------------------------------------
# History & Stats (mood-centric analytics)
# -----------------------------------------------------------------------------
@router.get("/moods/history")
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


@router.get("/moods/heatmap")
async def heatmap(days: int = 90, user: dict = Depends(get_current_user)):
    """Return a per-day map of the user's auras for the last N days (default 90).

    Used by the GitHub-style heatmap calendar on the Stats page. Each cell carries
    enough data to render: emotion (color key), intensity (opacity), and day_key.
    Frozen days (from streak_freezes) are returned with `frozen: true` so the UI
    can show a snowflake instead of an empty cell.
    """
    days = max(7, min(int(days), 365))
    since = now_utc() - timedelta(days=days)
    cursor = db.moods.find(
        {"user_id": user["user_id"], "created_at": {"$gte": since}},
        {"_id": 0, "day_key": 1, "emotion": 1, "intensity": 1, "color": 1},
    )
    rows = await cursor.to_list(2000)
    by_day: dict[str, dict] = {}
    for r in rows:
        k = r.get("day_key")
        if not k:
            continue
        # If multiple posts somehow exist for one day (shouldn't), keep highest intensity.
        cur = by_day.get(k)
        if not cur or (r.get("intensity") or 0) > (cur.get("intensity") or 0):
            by_day[k] = {
                "day_key": k,
                "emotion": r.get("emotion"),
                "intensity": int(r.get("intensity") or 0),
                "color": r.get("color") or EMOTIONS.get(r.get("emotion", "")),
            }
    # Layer in frozen days so the UI can render a distinct ❄️ marker.
    user_doc = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "streak_freezes": 1}
    ) or {}
    frozen_days = {
        f.get("day_key")
        for f in (user_doc.get("streak_freezes") or [])
        if f.get("day_key")
    }
    cells = list(by_day.values())
    return {
        "days": days,
        "from": since.strftime("%Y-%m-%d"),
        "to": now_utc().strftime("%Y-%m-%d"),
        "cells": cells,
        "frozen_days": sorted(frozen_days),
        "count": len(cells),
    }


@router.get("/moods/stats")
async def stats(user: dict = Depends(get_current_user)):
    pro = is_pro(user)
    since7 = now_utc() - timedelta(days=7)
    moods7 = await db.moods.find(
        {"user_id": user["user_id"], "created_at": {"$gte": since7}},
        {"_id": 0, "photo_b64": 0, "audio_b64": 0},
    ).to_list(200)
    dist = {k: 0 for k in EMOTIONS.keys()}
    for m in moods7:
        dist[m["emotion"]] = dist.get(m["emotion"], 0) + 1
    dominant = max(dist, key=dist.get) if any(dist.values()) else None
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
        insights = []
        if dominant:
            insights.append(f"Your dominant emotion this week is {dominant}.")
        if result["range_30"]["avg_intensity"] >= 6:
            insights.append("You've felt intensely this month — high emotional energy.")
        elif result["range_30"]["avg_intensity"] > 0:
            insights.append("Your emotional intensity has been moderate this month.")
        result["insights"] = insights
    return result



# ============================================================================
# Mood Patterns Insights — data-driven discoveries about the user's emotional life.
#
# Returns 3-6 cards that surface non-obvious truths from the last 30/90 days:
#   • Best / worst weekday for each emotion
#   • Trend direction (positivity score change vs previous month)
#   • Streak milestones (current vs personal best)
#   • Mood diversity score
#   • Time-of-day preferences (when the user typically logs their aura)
#
# Computed live (no cache) since the dataset per-user is tiny (≤ 365 docs). If perf
# becomes an issue we can memoize per (user_id, day_key) in users.insights_cache.
# ============================================================================
_POSITIVE_EMOTIONS = {"joy", "calm", "love", "gratitude", "hope", "pride"}
_NEGATIVE_EMOTIONS = {"sad", "anxious", "angry", "tired", "lonely", "stressed"}
_DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _emotion_polarity(emotion: str) -> int:
    """+1 positive, -1 negative, 0 neutral. Used for trend computation."""
    if emotion in _POSITIVE_EMOTIONS:
        return 1
    if emotion in _NEGATIVE_EMOTIONS:
        return -1
    return 0


@router.get("/moods/insights")
async def get_insights(user: dict = Depends(get_current_user)):
    """Surface non-obvious patterns the user hasn't noticed about their auras.

    Each insight is shaped as { id, icon, title, value, subtitle, tone } so the
    client can render a uniform card layout without per-insight branching.
    """
    user_id = user["user_id"]
    # Mongo stores `created_at` tz-naive — strip tzinfo from our reference times so
    # comparisons don't raise "can't compare offset-naive and offset-aware datetimes".
    now = now_utc().replace(tzinfo=None)
    since_30 = now - timedelta(days=30)
    since_60 = now - timedelta(days=60)
    since_90 = now - timedelta(days=90)

    # Pull lightweight projection — we only need emotion, day_key, intensity, created_at.
    rows_90 = await db.moods.find(
        {"user_id": user_id, "created_at": {"$gte": since_90}},
        {"_id": 0, "emotion": 1, "intensity": 1, "day_key": 1, "created_at": 1},
    ).to_list(500)

    if len(rows_90) < 3:
        return {
            "insights": [],
            "ready": False,
            "needed": max(0, 3 - len(rows_90)),
            "message": "Drop a few more auras to unlock personalised insights ✦",
        }

    rows_30 = [r for r in rows_90 if r["created_at"] >= since_30]
    rows_30_60 = [r for r in rows_90 if since_60 <= r["created_at"] < since_30]

    insights: list[dict] = []

    # 1) Trend — positivity score this month vs previous month
    if rows_30 and rows_30_60:
        score_now = sum(_emotion_polarity(r["emotion"]) for r in rows_30) / len(rows_30)
        score_prev = sum(_emotion_polarity(r["emotion"]) for r in rows_30_60) / len(rows_30_60)
        diff = round((score_now - score_prev) * 100)
        if abs(diff) >= 8:  # only surface when it's noticeable
            tone = "positive" if diff > 0 else "warning"
            arrow = "↗︎" if diff > 0 else "↘︎"
            verb = "more positive" if diff > 0 else "tougher"
            insights.append({
                "id": "trend_30",
                "icon": "trending-up" if diff > 0 else "trending-down",
                "title": f"{arrow} {abs(diff)}% {verb}",
                "value": f"{abs(diff)}%",
                "subtitle": "vs the previous 30 days",
                "tone": tone,
            })

    # 2) Best weekday — which day-of-week has the most positive auras
    by_dow: dict[int, list[int]] = {i: [] for i in range(7)}
    for r in rows_30:
        d = r["created_at"]
        if isinstance(d, str):
            d = datetime.fromisoformat(d)
        by_dow[d.weekday()].append(_emotion_polarity(r["emotion"]))
    dow_scores = {
        i: (sum(scores) / len(scores)) if scores else None
        for i, scores in by_dow.items()
    }
    populated = {i: s for i, s in dow_scores.items() if s is not None and len(by_dow[i]) >= 2}
    if populated:
        best_dow = max(populated, key=populated.get)
        if populated[best_dow] >= 0.4:
            insights.append({
                "id": "best_dow",
                "icon": "sunny",
                "title": f"{_DOW_NAMES[best_dow]} is your brightest day",
                "value": _DOW_NAMES[best_dow],
                "subtitle": f"{int(populated[best_dow] * 100)}% positive auras",
                "tone": "positive",
            })
        worst_dow = min(populated, key=populated.get)
        if populated[worst_dow] <= -0.4 and worst_dow != best_dow:
            insights.append({
                "id": "worst_dow",
                "icon": "rainy",
                "title": f"{_DOW_NAMES[worst_dow]} hits harder",
                "value": _DOW_NAMES[worst_dow],
                "subtitle": "Be gentle with yourself on this day",
                "tone": "warning",
            })

    # 3) Dominant emotion 30d
    dist: dict[str, int] = {}
    for r in rows_30:
        dist[r["emotion"]] = dist.get(r["emotion"], 0) + 1
    if dist:
        dominant_emo = max(dist, key=dist.get)
        pct = round(dist[dominant_emo] / len(rows_30) * 100)
        if pct >= 30:  # only highlight when truly dominant
            insights.append({
                "id": "dominant_30",
                "icon": "color-palette",
                "title": f"Mostly {dominant_emo}",
                "value": f"{pct}%",
                "subtitle": "of your auras these 30 days",
                "tone": "positive" if dominant_emo in _POSITIVE_EMOTIONS else "neutral",
                "color": EMOTIONS.get(dominant_emo),
            })

    # 4) Streak insights — current vs personal best
    current_streak = await compute_streak(user_id)
    if current_streak >= 3:
        insights.append({
            "id": "streak_current",
            "icon": "flame",
            "title": f"{current_streak}-day streak 🔥",
            "value": str(current_streak),
            "subtitle": "Daily check-ins build self-awareness",
            "tone": "positive",
        })
    # Personal best: longest run anywhere in last 90 days
    posted_days = sorted({r["day_key"] for r in rows_90})
    if posted_days:
        best_run = 1
        run = 1
        for i in range(1, len(posted_days)):
            prev = datetime.strptime(posted_days[i - 1], "%Y-%m-%d")
            cur = datetime.strptime(posted_days[i], "%Y-%m-%d")
            if (cur - prev).days == 1:
                run += 1
                best_run = max(best_run, run)
            else:
                run = 1
        if best_run >= 7 and best_run > current_streak:
            insights.append({
                "id": "streak_best",
                "icon": "trophy",
                "title": f"Personal best: {best_run} days",
                "value": str(best_run),
                "subtitle": "Can you beat it this month?",
                "tone": "neutral",
            })

    # 5) Mood diversity — how many distinct emotions in last 30 days
    unique_count = len({r["emotion"] for r in rows_30})
    if unique_count >= 5:
        insights.append({
            "id": "diversity",
            "icon": "prism",
            "title": f"{unique_count} different emotions",
            "value": str(unique_count),
            "subtitle": "You're tuned in to subtle nuances",
            "tone": "positive",
        })

    # 6) Time of day — when do they typically post?
    hour_buckets = {"morning": 0, "afternoon": 0, "evening": 0, "night": 0}
    for r in rows_30:
        d = r["created_at"]
        if isinstance(d, str):
            d = datetime.fromisoformat(d)
        h = d.hour
        if 5 <= h < 12:
            hour_buckets["morning"] += 1
        elif 12 <= h < 17:
            hour_buckets["afternoon"] += 1
        elif 17 <= h < 22:
            hour_buckets["evening"] += 1
        else:
            hour_buckets["night"] += 1
    if rows_30:
        favorite_time = max(hour_buckets, key=hour_buckets.get)
        if hour_buckets[favorite_time] / len(rows_30) >= 0.5:
            time_emoji = {"morning": "🌅", "afternoon": "☀️", "evening": "🌆", "night": "🌙"}[favorite_time]
            insights.append({
                "id": "favorite_time",
                "icon": "time",
                "title": f"You're a {favorite_time} reflector {time_emoji}",
                "value": favorite_time.capitalize(),
                "subtitle": f"{int(hour_buckets[favorite_time] / len(rows_30) * 100)}% of your auras",
                "tone": "neutral",
            })

    # Cap at 6 most informative cards (already roughly ordered by importance).
    return {
        "insights": insights[:6],
        "ready": True,
        "computed_for": now.isoformat(),
    }
