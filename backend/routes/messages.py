"""Messages routes — 1-on-1 DMs (polling based), reactions, unread count.

Extracted from server.py. All endpoints mounted under /api/.
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends

from app_core.db import db
from app_core.deps import now_utc, get_current_user
from app_core.helpers import conv_id, resolve_media
from app_core.models import MessageIn, MessageReactIn
from app_core.push import send_push
from app_core import r2 as _r2

router = APIRouter()


@router.get("/messages/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    convs = await db.conversations.find(
        {"participants": user["user_id"]},
        {"_id": 0, "unread": 1},
    ).to_list(500)
    total = 0
    convos_with_unread = 0
    for c in convs:
        n = (c.get("unread") or {}).get(user["user_id"], 0) or 0
        if n > 0:
            total += n
            convos_with_unread += 1
    return {"total": total, "conversations": convos_with_unread}


@router.get("/messages/conversations")
async def list_conversations(user: dict = Depends(get_current_user)):
    convs = await db.conversations.find({"participants": user["user_id"]}, {"_id": 0}).to_list(200)
    other_ids = []
    for c in convs:
        for p in c["participants"]:
            if p != user["user_id"]:
                other_ids.append(p)
    others = await db.users.find(
        {"user_id": {"$in": other_ids}},
        {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1, "avatar_key": 1},
    ).to_list(500)
    other_map = {u["user_id"]: u for u in others}
    out = []
    for c in convs:
        peer_id = next((p for p in c["participants"] if p != user["user_id"]), None)
        peer = other_map.get(peer_id, {})
        row = {
            "conversation_id": c["conversation_id"],
            "peer_id": peer_id,
            "peer_name": peer.get("name", "Friend"),
            "peer_avatar_color": peer.get("avatar_color"),
            "peer_avatar_b64": peer.get("avatar_b64"),
            "last_text": c.get("last_text"),
            "last_at": c.get("last_at"),
            "unread": c.get("unread", {}).get(user["user_id"], 0),
        }
        if peer.get("avatar_key"):
            row["peer_avatar_url"] = _r2.generate_get_url(peer["avatar_key"])
        out.append(row)
    out.sort(key=lambda x: x.get("last_at") or "", reverse=True)
    return {"conversations": out}


@router.get("/messages/with/{peer_id}")
async def get_messages(peer_id: str, user: dict = Depends(get_current_user)):
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": peer_id})
    if not fship and peer_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not friends")
    cid = conv_id(user["user_id"], peer_id)
    msgs = await db.messages.find({"conversation_id": cid}, {"_id": 0}).sort("at", 1).to_list(500)
    for m in msgs:
        resolve_media(m)
    await db.conversations.update_one(
        {"conversation_id": cid},
        {"$set": {f"unread.{user['user_id']}": 0}},
    )
    peer = await db.users.find_one(
        {"user_id": peer_id},
        {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1, "avatar_key": 1},
    )
    if peer:
        resolve_media(peer)
    return {"conversation_id": cid, "peer": peer, "messages": msgs}


@router.post("/messages/with/{peer_id}")
async def send_message(peer_id: str, data: MessageIn, user: dict = Depends(get_current_user)):
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": peer_id})
    if not fship:
        raise HTTPException(status_code=403, detail="Not friends")
    text = (data.text or "").strip()
    has_photo = bool(data.photo_b64 or data.photo_key)
    has_audio = bool(data.audio_b64 or data.audio_key)
    if not text and not has_photo and not has_audio:
        raise HTTPException(status_code=400, detail="Empty message")
    cid = conv_id(user["user_id"], peer_id)
    now = now_utc()
    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "conversation_id": cid,
        "sender_id": user["user_id"],
        "sender_name": user.get("name", ""),
        "text": text,
        "photo_key": data.photo_key,
        "photo_b64": data.photo_b64 if not data.photo_key else None,
        "audio_key": data.audio_key,
        "audio_b64": data.audio_b64 if not data.audio_key else None,
        "audio_seconds": data.audio_seconds if has_audio else None,
        "reply_to": data.reply_to,
        "reply_preview": (data.reply_preview or "")[:140] if data.reply_preview else None,
        "reply_sender_name": data.reply_sender_name,
        "reactions": [],
        "at": now.isoformat(),
    }
    await db.messages.insert_one(dict(msg))
    preview = text[:200] if text else ("📷 Photo" if has_photo else "🎙 Voice note")
    await db.conversations.update_one(
        {"conversation_id": cid},
        {
            "$set": {
                "conversation_id": cid,
                "participants": sorted([user["user_id"], peer_id]),
                "last_text": preview,
                "last_at": now.isoformat(),
            },
            "$inc": {f"unread.{peer_id}": 1},
        },
        upsert=True,
    )
    resolve_media(msg)
    push_body = text[:120] if text else ("Sent you a photo" if data.photo_b64 else "Sent you a voice note")
    await send_push(
        peer_id, "message",
        f"{user.get('name', 'Someone')} sent you a message",
        push_body,
        {"route": "/conversation", "peer_id": user["user_id"], "kind": "message"},
    )
    msg.pop("_id", None)
    return {"ok": True, "message": msg}


@router.post("/messages/{message_id}/react")
async def react_message(message_id: str, data: MessageReactIn, user: dict = Depends(get_current_user)):
    """Toggle a reaction (heart/thumb/fire/laugh/wow/sad) on a DM. Insta-style."""
    msg = await db.messages.find_one({"message_id": message_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    parts = (msg.get("conversation_id") or "").split(":")
    if user["user_id"] not in [msg.get("sender_id")] + parts[1:]:
        conv = await db.conversations.find_one({"conversation_id": msg.get("conversation_id")})
        if not conv or user["user_id"] not in conv.get("participants", []):
            raise HTTPException(status_code=403, detail="Not a participant")
    existing = [r for r in (msg.get("reactions") or []) if r.get("user_id") == user["user_id"]]
    already_same = any(r.get("emoji") == data.emoji for r in existing)
    if already_same:
        await db.messages.update_one(
            {"message_id": message_id},
            {"$pull": {"reactions": {"user_id": user["user_id"], "emoji": data.emoji}}},
        )
    else:
        await db.messages.update_one(
            {"message_id": message_id},
            {"$pull": {"reactions": {"user_id": user["user_id"]}}},
        )
        await db.messages.update_one(
            {"message_id": message_id},
            {"$push": {"reactions": {
                "user_id": user["user_id"],
                "name": user.get("name", ""),
                "emoji": data.emoji,
                "at": now_utc().isoformat(),
            }}},
        )
        if msg.get("sender_id") and msg["sender_id"] != user["user_id"]:
            await send_push(
                msg["sender_id"], "message",
                f"{user.get('name', 'Someone')} reacted to your message",
                f"{data.emoji}",
                {"route": "/conversation", "peer_id": user["user_id"], "kind": "message"},
            )
    fresh = await db.messages.find_one({"message_id": message_id}, {"_id": 0, "reactions": 1})
    return {"ok": True, "reactions": fresh.get("reactions", []) if fresh else []}
