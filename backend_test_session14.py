"""Session 14 — P1 routing refactor regression sweep.

Validates moods/friends/messages endpoints (now in routes/) preserve all behavior.
Plus regression spot-check on untouched endpoints in server.py.
"""
import asyncio
import os
import httpx
from typing import Tuple

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"
ADMIN = ("hello@innfeel.app", "admin123")
DEMO  = ("luna@innfeel.app",  "demo1234")

# 1x1 transparent PNG for photo_b64 fallback path
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

results = []


def rec(name: str, ok: bool, detail: str = ""):
    results.append((name, ok, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name}{(' — ' + detail) if detail else ''}")


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# --- thin auth-aware HTTP wrappers that clear cookies before every call -----
# httpx persists Set-Cookie across calls, and the backend's get_current_user
# prefers the cookie over the Authorization header. Clearing cookies before
# every request guarantees the Bearer token is the only auth source (so the
# server resolves the correct user, not "whoever last logged in").
async def aget(client, path, tok=None, **kw):
    client.cookies.clear()
    h = kw.pop("headers", {}) or {}
    if tok: h.update(hdr(tok))
    return await client.get(f"{BASE}{path}", headers=h, **kw)

async def apost(client, path, tok=None, **kw):
    client.cookies.clear()
    h = kw.pop("headers", {}) or {}
    if tok: h.update(hdr(tok))
    return await client.post(f"{BASE}{path}", headers=h, **kw)

async def adel(client, path, tok=None, **kw):
    client.cookies.clear()
    h = kw.pop("headers", {}) or {}
    if tok: h.update(hdr(tok))
    return await client.delete(f"{BASE}{path}", headers=h, **kw)


async def login(client: httpx.AsyncClient, email: str, password: str) -> Tuple[str, dict]:
    r = await apost(client, "/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    j = r.json()
    return j["access_token"], j["user"]


async def reg_fresh(client: httpx.AsyncClient, label: str) -> Tuple[str, dict]:
    """Register a fresh user with a unique email."""
    email = f"sess14_{label}_{os.urandom(3).hex()}@example.com"
    r = await apost(client, "/auth/register", json={
        "email": email, "password": "password123", "name": f"S14 {label}",
    })
    assert r.status_code == 200, f"register {label}: {r.status_code} {r.text[:300]}"
    j = r.json()
    return j["access_token"], j["user"]


async def cleanup_today(client: httpx.AsyncClient, tok: str):
    await adel(client, "/moods/today", tok)


async def ensure_pro(client: httpx.AsyncClient, tok: str):
    """Make the user Pro=True via /dev/toggle-pro (idempotent — toggles if needed)."""
    r = await aget(client, "/auth/me", tok)
    if r.json().get("pro"):
        return
    await apost(client, "/dev/toggle-pro", tok)
    r = await aget(client, "/auth/me", tok)
    assert r.json().get("pro"), "Failed to make user Pro via /dev/toggle-pro"


async def ensure_friendship(client: httpx.AsyncClient, tok: str, peer_email: str):
    """Make sure peer_email is a friend of the user. Idempotent."""
    r = await aget(client, "/friends", tok)
    rows = r.json().get("friends", [])
    if not any(f.get("email") == peer_email for f in rows):
        await apost(client, "/friends/add", tok, json={"email": peer_email})


# ============================================================================
async def test_moods(client):
    print("\n========== 1) MOODS (routes/moods.py) ==========")
    admin_tok, _ = await login(client, *ADMIN)
    luna_tok,  _ = await login(client, *DEMO)
    await ensure_pro(client, admin_tok)
    await ensure_friendship(client, admin_tok, DEMO[0])
    luna_u  = (await aget(client, "/auth/me", luna_tok)).json()
    admin_u = (await aget(client, "/auth/me", admin_tok)).json()
    await cleanup_today(client, admin_tok)
    await cleanup_today(client, luna_tok)

    # GET /moods/today (empty)
    r = await aget(client, "/moods/today", admin_tok)
    rec("GET /moods/today (no mood) 200 + mood:null",
        r.status_code == 200 and r.json().get("mood") is None,
        f"status={r.status_code}")

    # POST /moods (create)
    r = await apost(client, "/moods", admin_tok, json={
        "word": "hello", "emotion": "joy", "intensity": 4, "privacy": "friends",
    })
    j = r.json() if r.status_code == 200 else {}
    mood_id_1 = j.get("mood", {}).get("mood_id")
    streak_1 = j.get("streak")
    rec("POST /moods (first create) 200 + replaced:false + mood_id",
        r.status_code == 200 and mood_id_1 and j.get("replaced") is False,
        f"status={r.status_code} mood_id={mood_id_1}")

    # POST /moods (re-drop) UPSERT
    r = await apost(client, "/moods", admin_tok, json={
        "word": "updated", "emotion": "calm", "intensity": 3, "privacy": "friends",
    })
    j = r.json() if r.status_code == 200 else {}
    mood_id_2 = j.get("mood", {}).get("mood_id")
    rec("POST /moods (re-drop) UPSERT — preserves mood_id",
        r.status_code == 200 and mood_id_2 == mood_id_1, f"old={mood_id_1} new={mood_id_2}")
    rec("POST /moods (re-drop) replaced:true",
        j.get("replaced") is True, f"replaced={j.get('replaced')}")
    rec("POST /moods (re-drop) streak preserved",
        j.get("streak") == streak_1, f"old={streak_1} new={j.get('streak')}")
    rec("POST /moods (re-drop) emotion updated to calm",
        j.get("mood", {}).get("emotion") == "calm",
        f"emotion={j.get('mood', {}).get('emotion')}")

    # GET /moods/today reflects upsert
    r = await aget(client, "/moods/today", admin_tok)
    today_mood = r.json().get("mood") if r.status_code == 200 else None
    rec("GET /moods/today returns posted mood",
        r.status_code == 200 and today_mood and today_mood.get("mood_id") == mood_id_1,
        f"status={r.status_code}")

    # GET /moods/feed locked:true before luna posts
    r = await aget(client, "/moods/feed", luna_tok)
    rec("GET /moods/feed locked:true before luna posts",
        r.status_code == 200 and r.json().get("locked") is True,
        f"locked={r.json().get('locked')}")

    # luna posts, feed unlocked
    r = await apost(client, "/moods", luna_tok, json={
        "word": "calm sea", "emotion": "calm", "intensity": 3, "privacy": "friends",
    })
    rec("luna POST /moods 200", r.status_code == 200, f"status={r.status_code}")

    r = await aget(client, "/moods/feed", luna_tok)
    rec("GET /moods/feed locked:false after post",
        r.status_code == 200 and r.json().get("locked") is False,
        f"locked={r.json().get('locked')}")

    # POST /moods/{id}/react (luna -> admin's mood)
    r = await apost(client, f"/moods/{mood_id_1}/react", luna_tok, json={"emoji": "heart"})
    ok = r.status_code == 200 and r.json().get("ok") is True and \
         isinstance(r.json().get("reactions"), list)
    rec("POST /moods/{id}/react 200 + ok:true + reactions[]", ok, f"status={r.status_code}")

    # POST /moods/{id}/comment
    r = await apost(client, f"/moods/{mood_id_1}/comment", luna_tok,
                    json={"text": "Beautiful aura!"})
    ok = r.status_code == 200 and r.json().get("ok") is True and \
         "comment_id" in (r.json().get("comment") or {})
    rec("POST /moods/{id}/comment 200 + comment.comment_id", ok, f"status={r.status_code}")

    # GET /moods/{id}/comments
    r = await aget(client, f"/moods/{mood_id_1}/comments", admin_tok)
    cmts = r.json().get("comments", []) if r.status_code == 200 else []
    rec("GET /moods/{id}/comments returns the comment",
        r.status_code == 200 and any(c.get("text") == "Beautiful aura!" for c in cmts),
        f"count={len(cmts)}")

    # GET /moods/{id}/audio (no audio yet)
    r = await aget(client, f"/moods/{mood_id_1}/audio", admin_tok)
    rec("GET /moods/{id}/audio (no audio) → 404", r.status_code == 404, f"status={r.status_code}")

    # Re-drop with audio_b64 (Pro)
    await cleanup_today(client, admin_tok)
    r = await apost(client, "/moods", admin_tok, json={
        "emotion": "joy", "intensity": 4, "privacy": "friends",
        "audio_b64": PNG_B64, "audio_seconds": 3,
    })
    audio_mood_id = r.json().get("mood", {}).get("mood_id") if r.status_code == 200 else None
    rec("Pro admin POST /moods with audio_b64 200",
        r.status_code == 200 and audio_mood_id, f"status={r.status_code}")

    # Authorization checks
    r = await aget(client, f"/moods/{audio_mood_id}/audio", admin_tok)
    rec("GET /moods/{id}/audio (owner) → 200",
        r.status_code == 200 and "audio_seconds" in r.json(), f"status={r.status_code}")
    r = await aget(client, f"/moods/{audio_mood_id}/audio", luna_tok)
    rec("GET /moods/{id}/audio (friend who dropped today) → 200",
        r.status_code == 200, f"status={r.status_code}")
    stranger_tok, _ = await reg_fresh(client, "stranger")
    r = await aget(client, f"/moods/{audio_mood_id}/audio", stranger_tok)
    rec("GET /moods/{id}/audio (non-friend) → 403",
        r.status_code == 403, f"status={r.status_code}")

    # DELETE /moods/today (idempotent)
    r = await adel(client, "/moods/today", admin_tok)
    rec("DELETE /moods/today (1st) → 200 deleted:1",
        r.status_code == 200 and r.json().get("deleted") == 1, f"body={r.json()}")
    r = await adel(client, "/moods/today", admin_tok)
    rec("DELETE /moods/today (2nd) → 200 deleted:0 (idempotent)",
        r.status_code == 200 and r.json().get("deleted") == 0, f"body={r.json()}")

    # GET /moods/history
    r = await aget(client, "/moods/history", luna_tok)
    rec("GET /moods/history 200 + items[]",
        r.status_code == 200 and isinstance(r.json().get("items"), list),
        f"status={r.status_code}")

    # GET /moods/stats Pro admin
    await apost(client, "/moods", admin_tok, json={
        "word": "stats", "emotion": "joy", "intensity": 4, "privacy": "friends"})
    r = await aget(client, "/moods/stats", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /moods/stats Pro admin: range_30/90/365 + insights",
        r.status_code == 200 and {"range_30", "range_90", "range_365", "insights"}.issubset(set(j.keys())),
        f"keys={sorted(j.keys())}")
    r = await aget(client, "/moods/stats", stranger_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /moods/stats free user: no range_30",
        r.status_code == 200 and "range_30" not in j and "streak" in j,
        f"keys={sorted(j.keys())}")

    return admin_tok, admin_u, luna_tok, luna_u


# ============================================================================
async def test_activity(client, admin_tok):
    print("\n========== 2) ACTIVITY (routes/moods.py) ==========")
    r = await aget(client, "/activity", admin_tok)
    rec("GET /activity 200 + items[]",
        r.status_code == 200 and isinstance(r.json().get("items"), list),
        f"status={r.status_code}")

    r = await aget(client, "/activity/unread-count", admin_tok)
    rec("GET /activity/unread-count 200 + unread:int",
        r.status_code == 200 and isinstance(r.json().get("unread"), int),
        f"body={r.json() if r.status_code==200 else r.text[:120]}")

    r = await apost(client, "/activity/mark-read", admin_tok)
    rec("POST /activity/mark-read 200 + ok:true",
        r.status_code == 200 and r.json().get("ok") is True, f"status={r.status_code}")

    r = await aget(client, "/activity/unread-count", admin_tok)
    rec("GET /activity/unread-count after mark-read == 0",
        r.status_code == 200 and r.json().get("unread") == 0, f"unread={r.json().get('unread')}")


# ============================================================================
async def test_friends(client, admin_tok, luna_tok, luna_u):
    print("\n========== 3) FRIENDS (routes/friends.py) ==========")

    r = await aget(client, "/friends", admin_tok)
    rows = r.json().get("friends") or []
    luna_row = next((u for u in rows if u.get("email") == DEMO[0]), None)
    rec("GET /friends 200 + rows have dropped_today + is_close",
        r.status_code == 200 and luna_row and "dropped_today" in luna_row and "is_close" in luna_row,
        f"luna_row={luna_row}")

    # POST /friends/close/{luna} as Pro admin → toggle on
    r = await apost(client, f"/friends/close/{luna_u['user_id']}", admin_tok)
    rec("POST /friends/close/{luna} as Pro admin 200 + is_close:true",
        r.status_code == 200 and r.json().get("is_close") is True,
        f"status={r.status_code} body={r.json() if r.status_code==200 else r.text[:120]}")

    # GET /friends/close lists luna
    r = await aget(client, "/friends/close", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    contains = any(u.get("user_id") == luna_u["user_id"] for u in (j.get("friends") or []))
    rec("GET /friends/close lists luna",
        r.status_code == 200 and contains, f"count={len(j.get('friends', []))}")

    # toggle back
    r = await apost(client, f"/friends/close/{luna_u['user_id']}", admin_tok)
    rec("POST /friends/close/{luna} (2nd) toggles is_close:false",
        r.status_code == 200 and r.json().get("is_close") is False, f"status={r.status_code}")

    # Free user → 403
    free_tok, _ = await reg_fresh(client, "free")
    r = await apost(client, "/friends/add", free_tok, json={"email": ADMIN[0]})
    rec("Free user POST /friends/add admin 200", r.status_code == 200, f"status={r.status_code}")
    r = await aget(client, "/friends", free_tok)
    admin_uid = next((u["user_id"] for u in r.json().get("friends", []) if u.get("email") == ADMIN[0]), None)
    if admin_uid:
        r = await apost(client, f"/friends/close/{admin_uid}", free_tok)
        rec("Free user POST /friends/close → 403 (Pro gating)",
            r.status_code == 403 and "Pro" in r.text, f"status={r.status_code}")
    else:
        rec("Free user POST /friends/close → 403 (Pro gating)", False, "could not resolve admin uid")

    # match-contacts
    r = await apost(client, "/friends/match-contacts", admin_tok,
                    json={"emails": [DEMO[0], "nope@example.com"]})
    matches = r.json().get("matches", []) if r.status_code == 200 else []
    rec("POST /friends/match-contacts returns luna match",
        r.status_code == 200 and any(m.get("email") == DEMO[0] for m in matches),
        f"count={len(matches)}")

    # add + delete (symmetric)
    add_tok, add_u = await reg_fresh(client, "addtest")
    r = await apost(client, "/friends/add", add_tok, json={"email": DEMO[0]})
    rec("POST /friends/add (new user → luna) 200 + ok",
        r.status_code == 200 and r.json().get("ok") is True, f"status={r.status_code}")

    r = await aget(client, "/friends", luna_tok)
    contains = any(u.get("user_id") == add_u["user_id"] for u in r.json().get("friends", []))
    rec("Friendship is symmetric (luna sees the new user)", contains, f"contains={contains}")

    r = await adel(client, f"/friends/{luna_u['user_id']}", add_tok)
    rec("DELETE /friends/{luna} 200", r.status_code == 200, f"status={r.status_code}")
    r = await aget(client, "/friends", luna_tok)
    contains = any(u.get("user_id") == add_u["user_id"] for u in r.json().get("friends", []))
    rec("DELETE /friends symmetric cleanup (luna no longer sees new user)",
        not contains, f"contains_after={contains}")


# ============================================================================
async def test_messages(client, admin_tok, admin_u, luna_tok, luna_u):
    print("\n========== 4) MESSAGES (routes/messages.py) ==========")
    # ensure they are still friends (symmetric tests above didn't touch them)
    await ensure_friendship(client, admin_tok, DEMO[0])

    r = await aget(client, "/messages/unread-count", luna_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /messages/unread-count 200 + total/conversations:int",
        r.status_code == 200 and isinstance(j.get("total"), int) and isinstance(j.get("conversations"), int),
        f"body={j}")

    r = await aget(client, "/messages/conversations", admin_tok)
    rec("GET /messages/conversations 200 + conversations[]",
        r.status_code == 200 and isinstance(r.json().get("conversations"), list),
        f"status={r.status_code}")

    # POST /messages/with text
    r = await apost(client, f"/messages/with/{luna_u['user_id']}", admin_tok,
                    json={"text": "hi from session 14"})
    j = r.json() if r.status_code == 200 else {}
    msg = j.get("message") or {}
    needed = {"message_id", "conversation_id", "sender_id", "sender_name", "text", "at"}
    rec("POST /messages/with/{peer} text → 200 + full message shape",
        r.status_code == 200 and j.get("ok") is True and needed.issubset(set(msg.keys())),
        f"status={r.status_code} keys={sorted(msg.keys())}")
    msg_id_1 = msg.get("message_id")

    # POST /messages/with photo_key (R2)
    r = await apost(client, "/media/upload-url", admin_tok,
                    json={"kind": "msg_photo", "content_type": "image/jpeg"})
    if r.status_code == 200:
        photo_key = r.json().get("key")
        r = await apost(client, f"/messages/with/{luna_u['user_id']}", admin_tok,
                        json={"photo_key": photo_key})
        j = r.json() if r.status_code == 200 else {}
        m = j.get("message") or {}
        url_signed = "X-Amz-Signature" in (m.get("photo_url") or "")
        rec("POST /messages/with/{peer} photo_key → 200 + photo_url signed",
            r.status_code == 200 and url_signed,
            f"status={r.status_code} url={m.get('photo_url', '')[:60]}")
    else:
        rec("POST /media/upload-url for msg_photo 200", False,
            f"status={r.status_code} body={r.text[:120]}")

    # GET /messages/with — ensure photo_url resolved on R2 messages
    r = await aget(client, f"/messages/with/{admin_u['user_id']}", luna_tok)
    j = r.json() if r.status_code == 200 else {}
    msgs = j.get("messages") or []
    has_photo_url = any("X-Amz-Signature" in (m.get("photo_url") or "") for m in msgs)
    rec("GET /messages/with/{peer} 200 + photo_url signed for R2 msg",
        r.status_code == 200 and has_photo_url,
        f"status={r.status_code} count={len(msgs)} photo_url_present={has_photo_url}")

    # POST /messages/{id}/react toggle
    if msg_id_1:
        r = await apost(client, f"/messages/{msg_id_1}/react", luna_tok, json={"emoji": "heart"})
        ok = r.status_code == 200 and r.json().get("ok") is True and \
             any(rx.get("emoji") == "heart" for rx in r.json().get("reactions", []))
        rec("POST /messages/{id}/react add → 200 + reactions has heart", ok, f"status={r.status_code}")

        # toggle off
        r = await apost(client, f"/messages/{msg_id_1}/react", luna_tok, json={"emoji": "heart"})
        ok = r.status_code == 200 and r.json().get("ok") is True and \
             not any(rx.get("emoji") == "heart" and rx.get("user_id") == luna_u["user_id"]
                     for rx in r.json().get("reactions", []))
        rec("POST /messages/{id}/react toggle off → 200 + reaction removed", ok, f"status={r.status_code}")


# ============================================================================
async def test_regression(client, admin_tok):
    print("\n========== 5) REGRESSION (untouched in server.py) ==========")
    r = await aget(client, "/auth/me", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /auth/me 200 + email + is_admin:true",
        r.status_code == 200 and j.get("email") and j.get("is_admin") is True,
        f"keys={sorted(j.keys())}")

    r = await aget(client, "/badges", admin_tok)
    rec("GET /badges 200", r.status_code == 200, f"status={r.status_code}")

    r = await aget(client, "/friends/leaderboard", admin_tok)
    rec("GET /friends/leaderboard 200", r.status_code == 200, f"status={r.status_code}")

    r = await aget(client, "/admin/me", admin_tok)
    rec("GET /admin/me 200 + is_admin:true",
        r.status_code == 200 and r.json().get("is_admin") is True, f"status={r.status_code}")

    r = await aget(client, "/music/search?q=ocean", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /music/search?q=ocean Pro admin 200 + tracks[]",
        r.status_code == 200 and isinstance(j.get("tracks"), list) and len(j.get("tracks", [])) > 0,
        f"status={r.status_code} count={len(j.get('tracks', []))}")

    r = await aget(client, "/wellness/joy", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    rec("GET /wellness/joy 200 + quote+advice",
        r.status_code == 200 and j.get("quote") and j.get("advice"),
        f"source={j.get('source')}")

    r = await aget(client, "/notifications/prefs", admin_tok)
    j = r.json() if r.status_code == 200 else {}
    prefs = j.get("prefs") or j
    rec("GET /notifications/prefs 200 + reminder/reaction/message/friend keys",
        r.status_code == 200 and all(k in prefs for k in ("reminder", "reaction", "message", "friend")),
        f"status={r.status_code} body={j}")


async def main():
    async with httpx.AsyncClient(timeout=45.0) as client:
        admin_tok, admin_u, luna_tok, luna_u = await test_moods(client)
        await test_activity(client, admin_tok)
        await test_friends(client, admin_tok, luna_tok, luna_u)
        await test_messages(client, admin_tok, admin_u, luna_tok, luna_u)
        await test_regression(client, admin_tok)

    pas = sum(1 for _, ok, _ in results if ok)
    fail = sum(1 for _, ok, _ in results if not ok)
    print(f"\n=========== SUMMARY: {pas}/{pas+fail} PASS ===========")
    if fail:
        print("\nFAILED CASES:")
        for name, ok, det in results:
            if not ok:
                print(f"  ✗ {name} — {det}")


if __name__ == "__main__":
    asyncio.run(main())
