"""One-shot migration: move all base64 media from MongoDB → Cloudflare R2.

Idempotent. Rerunnable. Safe to run live.

Scans:
  · users.avatar_b64 → R2 + users.avatar_key
  · moods.photo_b64 / video_b64 / audio_b64 → R2 + moods.*_key
  · messages.photo_b64 / audio_b64 → R2 + messages.*_key

For each document found with a `_b64` field, uploads the bytes to R2 and swaps
the field for a `_key` pointer, then unsets the `_b64`. Handles a few unknown
image extensions by sniffing magic bytes.

Usage:
    cd /app/backend && python -m scripts.migrate_media_to_r2
"""
import asyncio
import base64
import logging
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv  # noqa: E402
load_dotenv()

from app_core.db import db  # noqa: E402
from app_core import r2  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("migrate")

# ------------------------------------------------------------------------ #
def _sniff_image_ct(raw: bytes) -> tuple[str, str]:
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if raw.startswith(b"RIFF") and len(raw) >= 12 and raw[8:12] == b"WEBP":
        return "image/webp", "webp"
    if raw[:4] == b"\x00\x00\x00\x18" or raw[:4] == b"\x00\x00\x00\x1c":
        return "image/heic", "heic"
    return "image/jpeg", "jpg"  # safe default


def _sniff_audio_ct(raw: bytes) -> tuple[str, str]:
    # m4a/mp4 starts with ....ftyp
    if len(raw) > 12 and raw[4:8] == b"ftyp":
        return "audio/m4a", "m4a"
    if raw[:4] == b"OggS":
        return "audio/ogg", "ogg"
    if raw[:3] == b"ID3" or raw[:2] in (b"\xff\xfb", b"\xff\xf3"):
        return "audio/mpeg", "mp3"
    if len(raw) > 4 and raw[:4] == b"\x1aEDF\xa3"[:4]:
        return "audio/webm", "webm"
    return "audio/m4a", "m4a"


def _sniff_video_ct(raw: bytes) -> tuple[str, str]:
    if len(raw) > 12 and raw[4:8] == b"ftyp":
        brand = raw[8:12]
        if brand == b"qt  ":
            return "video/quicktime", "mov"
        return "video/mp4", "mp4"
    return "video/mp4", "mp4"


async def _upload_b64(kind: str, user_id: str, b64: str, ct_sniffer) -> Optional[str]:
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        log.warning(f"  bad base64 for {kind} of {user_id}: {e}")
        return None
    if not raw:
        return None
    ct, ext = ct_sniffer(raw)
    key = r2.make_key(kind, user_id, ext)
    ok = r2.upload_bytes(key, raw, content_type=ct)
    if not ok:
        log.warning(f"  R2 upload failed for {kind}/{user_id}")
        return None
    return key


# ------------------------------------------------------------------------ #
async def migrate_users():
    cursor = db.users.find(
        {"avatar_b64": {"$exists": True, "$ne": None}, "avatar_key": {"$in": [None, "", False]}}
    )
    n = 0
    async for u in cursor:
        key = await _upload_b64("avatar", u["user_id"], u["avatar_b64"], _sniff_image_ct)
        if key:
            await db.users.update_one(
                {"user_id": u["user_id"]},
                {"$set": {"avatar_key": key}, "$unset": {"avatar_b64": ""}},
            )
            n += 1
            if n % 25 == 0:
                log.info(f"  users migrated: {n}")
    log.info(f"users done — {n} avatars migrated")


async def migrate_moods():
    n_photo = n_video = n_audio = 0
    cursor = db.moods.find({
        "$or": [
            {"photo_b64": {"$exists": True, "$nin": [None, ""]}, "photo_key": {"$in": [None, "", False]}},
            {"video_b64": {"$exists": True, "$nin": [None, ""]}, "video_key": {"$in": [None, "", False]}},
            {"audio_b64": {"$exists": True, "$nin": [None, ""]}, "audio_key": {"$in": [None, "", False]}},
        ]
    })
    async for m in cursor:
        uid = m.get("user_id", "unknown")
        update_set = {}
        update_unset = {}
        if m.get("photo_b64") and not m.get("photo_key"):
            k = await _upload_b64("mood_photo", uid, m["photo_b64"], _sniff_image_ct)
            if k:
                update_set["photo_key"] = k
                update_unset["photo_b64"] = ""
                n_photo += 1
        if m.get("video_b64") and not m.get("video_key"):
            k = await _upload_b64("mood_video", uid, m["video_b64"], _sniff_video_ct)
            if k:
                update_set["video_key"] = k
                update_unset["video_b64"] = ""
                n_video += 1
        if m.get("audio_b64") and not m.get("audio_key"):
            k = await _upload_b64("mood_audio", uid, m["audio_b64"], _sniff_audio_ct)
            if k:
                update_set["audio_key"] = k
                update_unset["audio_b64"] = ""
                n_audio += 1
        if update_set:
            op: dict = {"$set": update_set}
            if update_unset:
                op["$unset"] = update_unset
            await db.moods.update_one({"mood_id": m["mood_id"]}, op)
    log.info(f"moods done — photos={n_photo} videos={n_video} audios={n_audio}")


async def migrate_messages():
    n_photo = n_audio = 0
    cursor = db.messages.find({
        "$or": [
            {"photo_b64": {"$exists": True, "$nin": [None, ""]}, "photo_key": {"$in": [None, "", False]}},
            {"audio_b64": {"$exists": True, "$nin": [None, ""]}, "audio_key": {"$in": [None, "", False]}},
        ]
    })
    async for m in cursor:
        uid = m.get("sender_id", "unknown")
        update_set = {}
        update_unset = {}
        if m.get("photo_b64") and not m.get("photo_key"):
            k = await _upload_b64("msg_photo", uid, m["photo_b64"], _sniff_image_ct)
            if k:
                update_set["photo_key"] = k
                update_unset["photo_b64"] = ""
                n_photo += 1
        if m.get("audio_b64") and not m.get("audio_key"):
            k = await _upload_b64("msg_audio", uid, m["audio_b64"], _sniff_audio_ct)
            if k:
                update_set["audio_key"] = k
                update_unset["audio_b64"] = ""
                n_audio += 1
        if update_set:
            op: dict = {"$set": update_set}
            if update_unset:
                op["$unset"] = update_unset
            await db.messages.update_one({"message_id": m["message_id"]}, op)
    log.info(f"messages done — photos={n_photo} audios={n_audio}")


# ------------------------------------------------------------------------ #
async def main():
    if not r2.is_enabled():
        log.error("R2 is not configured — aborting. Set R2_* variables in .env.")
        return
    log.info("=== InnFeel media migration → Cloudflare R2 ===")
    await migrate_users()
    await migrate_moods()
    await migrate_messages()
    log.info("=== done ===")


if __name__ == "__main__":
    asyncio.run(main())
