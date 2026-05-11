"""Shared helpers used across multiple route modules.

Keeping these in app_core avoids import cycles between individual route files.
"""
from datetime import timedelta
from app_core import r2 as _r2
from app_core.db import db
from app_core.deps import now_utc, today_key


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
    """Count consecutive posting days ending today, accounting for active streak freezes.

    A streak freeze is a per-month "skip" voucher (2/month for Pro, 4/month for Zen,
    plus optional bundle of +3 freezes for €1.99 available to all tiers).
    Each frozen day is counted as if the user had posted, so missing a day doesn't reset
    the streak — but no streak day is incremented for a frozen day either (it just bridges).

    Freezes live in `users.streak_freezes` as a list of {day_key: "YYYY-MM-DD", ts: dt}.
    They're consumed on read (here) — if the day was already missed, we use a freeze.

    Day boundaries follow the user's local-noon convention (see `today_key`).
    """
    cursor = db.moods.find({"user_id": user_id}, {"_id": 0, "day_key": 1}).sort("day_key", -1)
    rows = await cursor.to_list(400)
    if not rows:
        return 0
    posted_days = {r["day_key"] for r in rows}

    # Pull the user's used-freeze ledger so we don't double-spend.
    user_doc = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "streak_freezes": 1, "streak_freezes_month": 1, "is_pro": 1, "pro_expires_at": 1, "plan": 1, "tz": 1},
    ) or {}
    used_freezes: set[str] = {f.get("day_key") for f in (user_doc.get("streak_freezes") or []) if f.get("day_key")}
    user_tz = user_doc.get("tz")

    streak = 0
    d = now_utc()
    for _ in range(400):
        # Use today_key so day boundaries match how moods are stored
        # (local-noon rollover when tz is known).
        key = today_key(d, tz=user_tz)
        if key in posted_days:
            streak += 1
        elif key in used_freezes:
            # Bridged day — streak continues but doesn't increment.
            pass
        else:
            break
        d = d - timedelta(days=1)
    return streak


def conv_id(a: str, b: str) -> str:
    """Stable conversation id for a 1-on-1 DM between users `a` and `b`."""
    p = sorted([a, b])
    return f"conv_{p[0]}_{p[1]}"
