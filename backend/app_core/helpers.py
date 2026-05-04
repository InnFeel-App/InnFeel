"""Shared helpers used across multiple route modules.

Keeping these in app_core avoids import cycles between individual route files.
"""
from datetime import timedelta
from app_core import r2 as _r2
from app_core.db import db
from app_core.deps import now_utc


def _attach_url(doc: dict, key_field: str, url_field: str) -> dict:
    """Populate url_field on a doc by signing key_field if present. Mutates + returns doc."""
    if not isinstance(doc, dict):
        return doc
    k = doc.get(key_field)
    if k:
        url = _r2.generate_get_url(k)
        if url:
            doc[url_field] = url
    return doc


def resolve_media(doc: dict) -> dict:
    """Attach signed URLs for any R2 object keys on the doc."""
    if not isinstance(doc, dict):
        return doc
    _attach_url(doc, "photo_key", "photo_url")
    _attach_url(doc, "video_key", "video_url")
    _attach_url(doc, "audio_key", "audio_url")
    _attach_url(doc, "avatar_key", "avatar_url")
    return doc


async def compute_streak(user_id: str) -> int:
    """Count consecutive posting days ending today for the given user."""
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


def conv_id(a: str, b: str) -> str:
    """Stable conversation id for a 1-on-1 DM between users `a` and `b`."""
    p = sorted([a, b])
    return f"conv_{p[0]}_{p[1]}"
