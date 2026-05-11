"""Friends routes — list, add/remove, close-friends toggle, contact matching.

Extracted from server.py. All endpoints mounted under /api/.
"""
import secrets

from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field

from app_core.db import db
from app_core.deps import now_utc, today_key, get_current_user, is_pro
from app_core.models import AddFriendIn
from app_core.push import send_push

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Invite code helpers — share-safe per-user identifier so the WhatsApp invite
# text doesn't leak the user's email. Codes are short, all-uppercase,
# unambiguous (no O/0/I/1) base32-style strings of fixed length 8.
# ─────────────────────────────────────────────────────────────────────────────
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 32 chars, no O/0/I/1


def _generate_invite_code(length: int = 8) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


async def _ensure_invite_code(user: dict) -> str:
    """Return the user's invite code, lazily creating one if missing.
    Retries on the (extremely unlikely) collision."""
    code = (user or {}).get("invite_code")
    if code:
        return code
    for _ in range(8):
        candidate = _generate_invite_code()
        # `update_one` is upsert-free — we add a uniqueness check at write time.
        existing = await db.users.find_one({"invite_code": candidate}, {"_id": 1})
        if existing:
            continue
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"invite_code": candidate, "invite_code_at": now_utc()}},
        )
        return candidate
    raise HTTPException(status_code=500, detail="Could not allocate an invite code")


@router.get("/friends/my-code")
async def get_my_invite_code(user: dict = Depends(get_current_user)):
    """Return the caller's stable invite code. Used by the share-sheet to
    build the deep link without exposing the user's email."""
    code = await _ensure_invite_code(user)
    return {"code": code}


class AddByCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)


@router.post("/friends/add-by-code")
async def add_friend_by_code(data: AddByCodeIn, user: dict = Depends(get_current_user)):
    """Add a friend by their share-safe invite code (no email exchange)."""
    pro = is_pro(user)
    if not pro:
        existing_count = await db.friendships.count_documents({"user_id": user["user_id"]})
        if existing_count >= 25:
            raise HTTPException(status_code=403, detail="Free plan caps at 25 friends. Upgrade to Pro.")
    code = data.code.strip().upper()
    target = await db.users.find_one({"invite_code": code})
    if not target:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="That's your own code")
    # Idempotent — already-friends just returns ok.
    already = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": target["user_id"]})
    if not already:
        for a, b in [(user["user_id"], target["user_id"]), (target["user_id"], user["user_id"])]:
            try:
                await db.friendships.insert_one({"user_id": a, "friend_id": b, "created_at": now_utc()})
            except Exception:
                pass
        fc = await db.friendships.count_documents({"user_id": user["user_id"]})
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_count": fc}})
        await send_push(
            target["user_id"], "friend",
            "New friend on InnFeel ✨",
            f"{user.get('name', 'Someone')} added you as a friend",
            {"route": "/(tabs)/friends", "from_user_id": user["user_id"], "kind": "friend"},
        )
    return {
        "ok": True,
        "already_friends": bool(already),
        "friend": {
            "user_id": target["user_id"],
            "name": target.get("name", ""),
            "avatar_color": target.get("avatar_color"),
        },
    }


@router.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    fships = await db.friendships.find({"user_id": user["user_id"]}).to_list(500)
    ids = [f["friend_id"] for f in fships]
    close_map = {f["friend_id"]: bool(f.get("close", False)) for f in fships}
    # PRIVACY: do NOT expose friends' email addresses in this response — only the
    # identifiers strictly needed by the UI (name, avatar, streak, close flag).
    users = await db.users.find(
        {"user_id": {"$in": ids}},
        {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1, "avatar_key": 1, "streak": 1},
    ).to_list(500)
    key = today_key(tz=user.get("tz"))
    moods = await db.moods.find(
        {"user_id": {"$in": ids}, "day_key": key},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    drop_set = {m["user_id"] for m in moods}
    for u in users:
        u["dropped_today"] = u["user_id"] in drop_set
        u["is_close"] = close_map.get(u["user_id"], False)
    return {"friends": users}


@router.post("/friends/close/{friend_id}")
async def toggle_close_friend(friend_id: str, user: dict = Depends(get_current_user)):
    if not is_pro(user):
        raise HTTPException(status_code=403, detail="Close friends is a Pro feature")
    fship = await db.friendships.find_one({"user_id": user["user_id"], "friend_id": friend_id})
    if not fship:
        raise HTTPException(status_code=404, detail="Not friends")
    new_close = not bool(fship.get("close", False))
    if new_close:
        cnt = await db.friendships.count_documents({"user_id": user["user_id"], "close": True})
        if cnt >= 15:
            raise HTTPException(status_code=403, detail="Close friends capped at 15")
    await db.friendships.update_one(
        {"user_id": user["user_id"], "friend_id": friend_id},
        {"$set": {"close": new_close, "close_updated_at": now_utc()}},
    )
    return {"ok": True, "is_close": new_close}


@router.get("/friends/close")
async def list_close_friends(user: dict = Depends(get_current_user)):
    fships = await db.friendships.find({"user_id": user["user_id"], "close": True}).to_list(200)
    ids = [f["friend_id"] for f in fships]
    if not ids:
        return {"friends": []}
    users = await db.users.find(
        {"user_id": {"$in": ids}},
        {"_id": 0, "user_id": 1, "name": 1, "avatar_color": 1},
    ).to_list(200)
    return {"friends": users}


@router.post("/friends/match-contacts")
async def match_contacts(data: dict = Body(...), user: dict = Depends(get_current_user)):
    """Check which of the user's device contacts already have an InnFeel account."""
    emails = data.get("emails") or []
    if not isinstance(emails, list):
        raise HTTPException(status_code=400, detail="emails must be an array")
    clean = list({(e or "").strip().lower() for e in emails if isinstance(e, str) and "@" in e})[:500]
    if not clean:
        return {"matches": []}
    rows = await db.users.find(
        {"email": {"$in": clean}, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "avatar_color": 1, "avatar_b64": 1},
    ).to_list(500)
    my_friends = set()
    async for f in db.friendships.find({"user_id": user["user_id"]}, {"friend_id": 1}):
        my_friends.add(f.get("friend_id"))
    out = []
    for u in rows:
        out.append({
            "user_id": u["user_id"],
            "email": u["email"],
            "name": u.get("name", ""),
            "avatar_color": u.get("avatar_color"),
            "avatar_b64": u.get("avatar_b64"),
            "is_friend": u["user_id"] in my_friends,
        })
    return {"matches": out}


@router.post("/friends/add")
async def add_friend(data: AddFriendIn, user: dict = Depends(get_current_user)):
    pro = is_pro(user)
    if not pro:
        existing_count = await db.friendships.count_documents({"user_id": user["user_id"]})
        if existing_count >= 25:
            raise HTTPException(status_code=403, detail="Free plan caps at 25 friends. Upgrade to Pro.")
    target = await db.users.find_one({"email": data.email.lower()})
    if not target:
        raise HTTPException(status_code=404, detail="No user with that email")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    for a, b in [(user["user_id"], target["user_id"]), (target["user_id"], user["user_id"])]:
        try:
            await db.friendships.insert_one({"user_id": a, "friend_id": b, "created_at": now_utc()})
        except Exception:
            pass
    fc = await db.friendships.count_documents({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_count": fc}})
    await send_push(
        target["user_id"], "friend",
        "New friend on InnFeel ✨",
        f"{user.get('name', 'Someone')} added you as a friend",
        {"route": "/(tabs)/friends", "from_user_id": user["user_id"], "kind": "friend"},
    )
    return {
        "ok": True,
        "friend": {
            "user_id": target["user_id"],
            "name": target["name"],
            "email": target["email"],
            "avatar_color": target.get("avatar_color"),
        },
    }


@router.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, user: dict = Depends(get_current_user)):
    await db.friendships.delete_one({"user_id": user["user_id"], "friend_id": friend_id})
    await db.friendships.delete_one({"user_id": friend_id, "friend_id": user["user_id"]})
    fc = await db.friendships.count_documents({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_count": fc}})
    return {"ok": True}
