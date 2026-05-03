"""Media endpoints — pre-signed upload URLs + Pro-gate for video.

Exposes:
  POST /api/media/upload-url  {kind, content_type, ext?}
    → {url, method, headers, key, expires_in}
  DELETE /api/media/object    {key}  (owner-only — must match user prefix)
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app_core.deps import get_current_user, is_pro
from app_core import r2

router = APIRouter(tags=["media"])
logger = logging.getLogger("innfeel.media")

# Conservative content-type whitelist — blocks anything silly at the edge.
_ALLOWED_PHOTO = {"image/jpeg", "image/png", "image/webp", "image/heic"}
_ALLOWED_AUDIO = {"audio/m4a", "audio/mp4", "audio/aac", "audio/x-m4a", "audio/webm", "audio/mpeg", "audio/ogg"}
_ALLOWED_VIDEO = {"video/mp4", "video/quicktime"}

_EXT_BY_CT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
    "audio/m4a": "m4a", "audio/mp4": "m4a", "audio/aac": "m4a", "audio/x-m4a": "m4a",
    "audio/webm": "webm", "audio/mpeg": "mp3", "audio/ogg": "ogg",
    "video/mp4": "mp4", "video/quicktime": "mov",
}


class UploadUrlIn(BaseModel):
    kind: Literal["mood_photo", "mood_audio", "mood_video", "msg_photo", "msg_audio", "avatar"]
    content_type: str = Field(min_length=3, max_length=64)
    ext: Optional[str] = Field(default=None, max_length=6)


@router.post("/media/upload-url")
async def get_upload_url(data: UploadUrlIn, user: dict = Depends(get_current_user)):
    if not r2.is_enabled():
        raise HTTPException(status_code=503, detail="Media storage temporarily unavailable")
    ct = data.content_type.lower().split(";")[0].strip()

    # Kind-specific validation
    if data.kind == "mood_video":
        if not is_pro(user):
            raise HTTPException(status_code=402, detail="Video auras are a Pro feature")
        if ct not in _ALLOWED_VIDEO:
            raise HTTPException(status_code=400, detail="Unsupported video type")
    elif data.kind in ("mood_photo", "msg_photo", "avatar"):
        if ct not in _ALLOWED_PHOTO:
            raise HTTPException(status_code=400, detail="Unsupported photo type")
    elif data.kind in ("mood_audio", "msg_audio"):
        if ct not in _ALLOWED_AUDIO:
            raise HTTPException(status_code=400, detail="Unsupported audio type")

    ext = (data.ext or _EXT_BY_CT.get(ct, "bin")).lower().lstrip(".")
    key = r2.make_key(data.kind, user["user_id"], ext)
    signed = r2.generate_put_url(key, content_type=ct, expires=900)
    if not signed:
        raise HTTPException(status_code=500, detail="Could not sign upload URL")
    return signed


class DeleteObjectIn(BaseModel):
    key: str = Field(min_length=1, max_length=256)


@router.post("/media/delete")
async def delete_my_object(data: DeleteObjectIn, user: dict = Depends(get_current_user)):
    """Delete an R2 object — only allowed if the key lives under the caller's user_id prefix.

    This lets the mobile app clean up after aborted uploads without exposing admin-level delete.
    """
    uid = user["user_id"]
    if f"/{uid}/" not in data.key:
        raise HTTPException(status_code=403, detail="Not your object")
    ok = r2.delete_object(data.key)
    return {"ok": ok}
