#!/usr/bin/env python3
"""
Session 12 regression sanity pass — post-refactor (auth + account routes split).
Targets ~33 endpoints to confirm the include_router setup preserves all contracts.
"""
import os
import sys
import time
import json
import hashlib
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

# ------------------ Config ------------------
BACKEND_URL = None
try:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BACKEND_URL = line.strip().split("=", 1)[1].strip().strip('"')
                break
except Exception:
    pass
BACKEND_URL = BACKEND_URL or "http://localhost:8001"
API = BACKEND_URL.rstrip("/") + "/api"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
try:
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("MONGO_URL="):
                MONGO_URL = line.strip().split("=", 1)[1].strip().strip('"')
            elif line.startswith("DB_NAME="):
                DB_NAME = line.strip().split("=", 1)[1].strip().strip('"')
except Exception:
    pass

ADMIN_EMAIL = "admin@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

# ------------------ Reporting ------------------
results = []

def record(name: str, ok: bool, detail: str = "") -> None:
    sym = "PASS" if ok else "FAIL"
    print(f"[{sym}] {name}" + (f" — {detail}" if detail else ""))
    results.append({"name": name, "ok": ok, "detail": detail})


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def post(client: httpx.AsyncClient, path: str, json_body=None, token: Optional[str] = None) -> httpx.Response:
    headers = auth_headers(token) if token else {}
    client.cookies.clear()
    return await client.post(API + path, json=json_body, headers=headers)


async def get(client: httpx.AsyncClient, path: str, token: Optional[str] = None) -> httpx.Response:
    headers = auth_headers(token) if token else {}
    client.cookies.clear()
    return await client.get(API + path, headers=headers)


async def patch(client: httpx.AsyncClient, path: str, json_body=None, token: Optional[str] = None) -> httpx.Response:
    headers = auth_headers(token) if token else {}
    client.cookies.clear()
    return await client.patch(API + path, json=json_body, headers=headers)


async def delete(client: httpx.AsyncClient, path: str, token: Optional[str] = None, json_body=None) -> httpx.Response:
    headers = auth_headers(token) if token else {}
    client.cookies.clear()
    return await client.request("DELETE", API + path, headers=headers, json=json_body)


async def login(client: httpx.AsyncClient, email: str, password: str) -> Tuple[Optional[str], dict]:
    r = await post(client, "/auth/login", {"email": email, "password": password})
    if r.status_code != 200:
        return None, {}
    data = r.json()
    return data.get("access_token"), data.get("user", {})


# ------------------ Main ------------------
async def main():
    print(f"\nBackend: {API}")
    print(f"Mongo:   {MONGO_URL}/{DB_NAME}\n")

    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]

    async with httpx.AsyncClient(timeout=30.0) as client:
        # ===== AUTH (moved to routes/auth.py) =====
        # 1. Admin login
        admin_token, admin_user = await login(client, ADMIN_EMAIL, ADMIN_PASS)
        ok = bool(admin_token) and admin_user.get("is_admin") is True and admin_user.get("email_verified_at")
        record("1. POST /auth/login admin → 200 + is_admin:true + email_verified_at", ok,
               f"is_admin={admin_user.get('is_admin')} email_verified_at={admin_user.get('email_verified_at')}")

        # 2. Luna login
        luna_token, luna_user = await login(client, LUNA_EMAIL, LUNA_PASS)
        record("2. POST /auth/login luna → 200", bool(luna_token), f"user_id={luna_user.get('user_id')}")

        # 3. /auth/me with email_verified_at
        r = await get(client, "/auth/me", admin_token)
        me = r.json() if r.status_code == 200 else {}
        record("3. GET /auth/me → 200 + email_verified_at present",
               r.status_code == 200 and "email_verified_at" in me,
               f"status={r.status_code} keys_has_email_verified_at={'email_verified_at' in me}")

        # 4. /auth/logout
        r = await post(client, "/auth/logout", {}, admin_token)
        record("4. POST /auth/logout → 200", r.status_code == 200, f"status={r.status_code}")

        # 5. Register fresh user with lang:'fr'
        fresh_email = f"regr_{uuid.uuid4().hex[:8]}@innfeel.app"
        r = await post(client, "/auth/register", {
            "email": fresh_email, "password": "StrongP@ss1", "name": "Regr Tester", "lang": "fr",
            "terms_accepted": True
        })
        reg_json = r.json() if r.status_code == 200 else {}
        fresh_token = reg_json.get("access_token")
        fresh_user = reg_json.get("user", {})
        ok = (r.status_code == 200 and bool(fresh_token)
              and fresh_user.get("email_verified_at") in (None, "None"))
        record("5. POST /auth/register fresh (lang:fr) → 200, verified_at null, token set",
               ok, f"status={r.status_code} verified_at={fresh_user.get('email_verified_at')}")

        # 6. send-verification immediately after register → cooldown
        r = await post(client, "/auth/send-verification", {"lang": "fr"}, fresh_token)
        body = r.json() if r.status_code == 200 else {}
        ok = (r.status_code == 200 and body.get("ok") is False
              and isinstance(body.get("cooldown_seconds"), int) and body["cooldown_seconds"] <= 45)
        record("6. POST /auth/send-verification post-register → ok:false, cooldown<=45",
               ok, f"status={r.status_code} body={body}")

        # 7. verify-email with wrong code → 400 with remaining attempts message
        r = await post(client, "/auth/verify-email", {"code": "000000"}, fresh_token)
        body = r.json() if r.status_code == 400 else {}
        det = body.get("detail", "")
        ok = r.status_code == 400 and "Incorrect code" in det and "attempts left" in det
        record("7. POST /auth/verify-email bad code → 400 'Incorrect code. N attempts left.'",
               ok, f"status={r.status_code} detail={det}")

        # 8. Patch db to inject known hash, then verify-email → 200
        known_code = "123456"
        known_hash = hashlib.sha256(known_code.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        res = await db.email_verifications.update_one(
            {"user_id": fresh_user["user_id"]},
            {"$set": {
                "code_hash": known_hash, "attempts": 0,
                "expires_at": now + timedelta(minutes=10),
                "last_sent_at": now,
            }},
        )
        # Verify patch was applied
        patched_ok = res.matched_count == 1
        r = await post(client, "/auth/verify-email", {"code": known_code}, fresh_token)
        body = r.json() if r.status_code == 200 else {}
        u = body.get("user") or {}
        ok = (patched_ok and r.status_code == 200 and body.get("ok") is True
              and u.get("email_verified_at"))
        record("8. POST /auth/verify-email (patched) → 200 ok:true + user.email_verified_at populated",
               ok, f"status={r.status_code} patched={patched_ok} verified_at={u.get('email_verified_at')}")

        # ===== ACCOUNT (moved to routes/account.py) =====
        # 9. POST /account/email as unverified user → 403
        # Register yet another fresh user (still unverified since we don't patch+verify)
        unv_email = f"unv_{uuid.uuid4().hex[:8]}@innfeel.app"
        r = await post(client, "/auth/register", {
            "email": unv_email, "password": "StrongP@ss1", "name": "Unverified",
            "terms_accepted": True
        })
        unv_token = r.json().get("access_token") if r.status_code == 200 else None
        r = await post(client, "/account/email",
                       {"new_email": f"changed_{uuid.uuid4().hex[:6]}@innfeel.app",
                        "password": "StrongP@ss1"},
                       unv_token)
        body = r.json() if r.status_code == 403 else {}
        det = body.get("detail", "")
        ok = r.status_code == 403 and "verify your current email" in det.lower()
        record("9. POST /account/email (unverified) → 403 verification required",
               ok, f"status={r.status_code} detail={det}")

        # 10. PATCH /account/profile as admin {name:'Admin'}
        admin_token, _ = await login(client, ADMIN_EMAIL, ADMIN_PASS)
        r = await patch(client, "/account/profile", {"name": "Admin"}, admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and body.get("ok") is True and bool(body.get("user"))
        record("10. PATCH /account/profile admin → 200 ok:true + user",
               ok, f"status={r.status_code} name={body.get('user',{}).get('name')}")

        # 11. GET /account/export as admin
        r = await get(client, "/account/export", admin_token)
        body = r.json() if r.status_code == 200 else {}
        keys = {"exported_at", "user", "moods", "friendships", "messages"}
        ok = r.status_code == 200 and keys.issubset(body.keys())
        record("11. GET /account/export admin → 200 with {exported_at,user,moods,friendships,messages}",
               ok, f"status={r.status_code} keys={sorted(body.keys())[:6]}")

        # ===== OTHER UNCHANGED ENDPOINTS =====
        # Pre-clean: delete admin today's mood so POST works
        await delete(client, "/moods/today", admin_token)
        await delete(client, "/moods/today", luna_token)

        # Ensure admin is Pro (state may have been revoked in earlier test sessions).
        me_r = await get(client, "/auth/me", admin_token)
        me_body = me_r.json() if me_r.status_code == 200 else {}
        if not me_body.get("pro"):
            tr = await post(client, "/dev/toggle-pro", {}, admin_token)
            if tr.status_code == 200 and tr.json().get("pro") is False:
                # it was actually Pro internally — toggle back
                await post(client, "/dev/toggle-pro", {}, admin_token)

        # 12. POST /moods admin fresh drop (privacy:friends so luna can comment later)
        r = await post(client, "/moods", {
            "word": "sunrise", "emotion": "joy", "intensity": 4, "privacy": "friends"
        }, admin_token)
        body = r.json() if r.status_code == 200 else {}
        admin_mood_id = body.get("mood_id") or body.get("mood", {}).get("mood_id")
        record("12. POST /moods admin fresh → 200", r.status_code == 200 and bool(admin_mood_id),
               f"status={r.status_code} mood_id={admin_mood_id}")

        # Also have luna drop for feed
        r_luna = await post(client, "/moods", {
            "word": "waves", "emotion": "calm", "intensity": 3, "privacy": "friends"
        }, luna_token)

        # 13. GET /moods/today
        r = await get(client, "/moods/today", admin_token)
        record("13. GET /moods/today → 200", r.status_code == 200, f"status={r.status_code}")

        # 14. GET /moods/stats admin Pro
        r = await get(client, "/moods/stats", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = (r.status_code == 200 and "range_30" in body and "range_90" in body
              and "range_365" in body and "insights" in body)
        record("14. GET /moods/stats Pro admin → range_30/90/365 + insights",
               ok, f"status={r.status_code} has_ranges={all(k in body for k in ['range_30','range_90','range_365','insights'])}")

        # 15. POST /moods/{id}/react
        if admin_mood_id:
            r = await post(client, f"/moods/{admin_mood_id}/react", {"emoji": "heart"}, luna_token)
            body = r.json() if r.status_code == 200 else {}
            ok = r.status_code == 200 and body.get("ok") is True and isinstance(body.get("reactions"), list)
            record("15. POST /moods/{id}/react → 200 ok + reactions[]",
                   ok, f"status={r.status_code}")
        else:
            record("15. POST /moods/{id}/react", False, "no admin_mood_id")

        # 16. POST /moods/{id}/comment
        if admin_mood_id:
            r = await post(client, f"/moods/{admin_mood_id}/comment", {"text": "Beautiful"}, luna_token)
            body = r.json() if r.status_code == 200 else {}
            comment = body.get("comment") or {}
            ok = (r.status_code == 200 and body.get("ok") is True
                  and comment.get("comment_id") and comment.get("text") == "Beautiful")
            record("16. POST /moods/{id}/comment → 200 ok + comment{...}",
                   ok, f"status={r.status_code}")
        else:
            record("16. POST /moods/{id}/comment", False, "no admin_mood_id")

        # 17. GET /friends
        r = await get(client, "/friends", admin_token)
        record("17. GET /friends admin → 200", r.status_code == 200, f"status={r.status_code}")

        # 18. POST /friends/add luna
        r = await post(client, "/friends/add", {"email": LUNA_EMAIL}, admin_token)
        body = r.json() if r.status_code == 200 else {}
        friend = body.get("friend") or {}
        ok = (r.status_code == 200 and body.get("ok") is True
              and all(k in friend for k in ["user_id", "name", "email", "avatar_color"]))
        record("18. POST /friends/add → 200 + friend{user_id,name,email,avatar_color}",
               ok, f"status={r.status_code} friend_keys={list(friend.keys())}")
        luna_id = friend.get("user_id") or luna_user.get("user_id")

        # 19. GET /friends/leaderboard
        r = await get(client, "/friends/leaderboard", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and all(k in body for k in ["streak", "moods", "loved"])
        record("19. GET /friends/leaderboard → 200 with streak/moods/loved",
               ok, f"status={r.status_code} keys={list(body.keys())[:6]}")

        # 20. GET /badges
        r = await get(client, "/badges", admin_token)
        record("20. GET /badges admin → 200", r.status_code == 200, f"status={r.status_code}")

        # 21. POST /messages/with/{luna_id}
        msg_id = None
        if luna_id:
            r = await post(client, f"/messages/with/{luna_id}", {"text": "hi"}, admin_token)
            body = r.json() if r.status_code == 200 else {}
            m = body.get("message") or {}
            ok = r.status_code == 200 and body.get("ok") is True and m.get("message_id")
            msg_id = m.get("message_id")
            record("21. POST /messages/with/{luna_id} → 200 ok + message{...}",
                   ok, f"status={r.status_code} msg_id={msg_id}")
        else:
            record("21. POST /messages/with/{luna_id}", False, "no luna_id")

        # 22. GET /messages/conversations
        r = await get(client, "/messages/conversations", admin_token)
        record("22. GET /messages/conversations → 200", r.status_code == 200, f"status={r.status_code}")

        # 23. POST /messages/{msg_id}/react
        if msg_id:
            r = await post(client, f"/messages/{msg_id}/react", {"emoji": "heart"}, luna_token)
            record("23. POST /messages/{msg_id}/react → 200",
                   r.status_code == 200, f"status={r.status_code}")
        else:
            record("23. POST /messages/{msg_id}/react", False, "no msg_id")

        # 24. GET /music/search?q=ocean (admin Pro)
        r = await get(client, "/music/search?q=ocean", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and isinstance(body.get("tracks"), list)
        record("24. GET /music/search?q=ocean Pro → 200 tracks[]",
               ok, f"status={r.status_code} tracks={len(body.get('tracks',[]))}")

        # 25. GET /wellness/joy
        r = await get(client, "/wellness/joy", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and body.get("source") in ("llm", "llm-cache", "static")
        record("25. GET /wellness/joy → 200 + source",
               ok, f"status={r.status_code} source={body.get('source')}")

        # 26. GET /admin/me
        r = await get(client, "/admin/me", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and body.get("is_admin") is True
        record("26. GET /admin/me admin → is_admin:true",
               ok, f"status={r.status_code} is_admin={body.get('is_admin')}")

        # 27. GET /admin/users/search?q=luna
        r = await get(client, "/admin/users/search?q=luna", admin_token)
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and isinstance(body.get("users"), list) and len(body["users"]) >= 1
        record("27. GET /admin/users/search?q=luna → 200 users[]",
               ok, f"status={r.status_code} count={len(body.get('users',[]))}")

        # 28. POST /payments/checkout
        r = await post(client, "/payments/checkout", {}, admin_token)
        body = r.json() if r.status_code == 200 else {}
        url = body.get("url", "")
        ok = r.status_code == 200 and "checkout.stripe.com" in url
        record("28. POST /payments/checkout → 200 + checkout.stripe.com URL",
               ok, f"status={r.status_code} url_has_stripe={'checkout.stripe.com' in url}")

        # 29. GET /iap/status
        r = await get(client, "/iap/status", admin_token)
        record("29. GET /iap/status → 200", r.status_code == 200, f"status={r.status_code}")

        # 30. POST /iap/sync
        r = await post(client, "/iap/sync", {}, admin_token)
        record("30. POST /iap/sync → 200", r.status_code == 200, f"status={r.status_code}")

        # 31. POST /iap/webhook (valid event)
        r = await post(client, "/iap/webhook", {
            "event": {
                "id": f"evt_regr_{uuid.uuid4().hex[:10]}",
                "type": "INITIAL_PURCHASE",
                "app_user_id": admin_user.get("user_id", "user_test"),
            }
        })
        record("31. POST /iap/webhook (valid event) → 200",
               r.status_code == 200, f"status={r.status_code}")

        # 32. GET /notifications/prefs
        r = await get(client, "/notifications/prefs", admin_token)
        record("32. GET /notifications/prefs → 200", r.status_code == 200, f"status={r.status_code}")

        # 33. POST /notifications/prefs
        r = await post(client, "/notifications/prefs", {"reaction": True}, admin_token)
        record("33. POST /notifications/prefs → 200", r.status_code == 200, f"status={r.status_code}")

    # Summary
    passed = sum(1 for x in results if x["ok"])
    total = len(results)
    pct = 100.0 * passed / total if total else 0.0
    print(f"\n========================================")
    print(f"Result: {passed}/{total} PASS ({pct:.1f}%)")
    if passed != total:
        print("\nFAILURES:")
        for r in results:
            if not r["ok"]:
                print(f"  - {r['name']} :: {r['detail']}")
    print("========================================\n")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
