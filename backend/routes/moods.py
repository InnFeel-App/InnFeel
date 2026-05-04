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
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"streak": streak}})
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
