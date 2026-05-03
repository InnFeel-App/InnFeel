"""Full backend regression sanity-check for InnFeel post-refactor."""

import os
import sys
import uuid
import requests

BASE = os.environ.get("BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com")
API = BASE.rstrip("/") + "/api"

ADMIN_EMAIL = "admin@innfeel.app"
ADMIN_PW = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PW = "demo1234"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")


def post(path, token=None, json_body=None, params=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.post(API + path, headers=h, json=json_body, params=params, timeout=30)


def get(path, token=None, params=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.get(API + path, headers=h, params=params, timeout=30)


def delete(path, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return requests.delete(API + path, headers=h, timeout=30)


def login(email, pw):
    r = post("/auth/login", json_body={"email": email, "password": pw})
    if r.status_code != 200:
        return None, r
    return r.json().get("access_token"), r


# 1) AUTH
print("\n=== 1) AUTH ===")

rand_email = f"sandy_{uuid.uuid4().hex[:8]}@innfeel.app"
r = post("/auth/register", json_body={"email": rand_email, "password": "Test1234!", "name": "Sandy Test"})
record("auth/register new user", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
new_token = r.json().get("access_token") if r.status_code == 200 else None

admin_token, r = login(ADMIN_EMAIL, ADMIN_PW)
record("auth/login admin", r.status_code == 200 and admin_token is not None, f"{r.status_code}")

luna_token, r = login(LUNA_EMAIL, LUNA_PW)
record("auth/login luna", r.status_code == 200 and luna_token is not None, f"{r.status_code}")

r = get("/auth/me", token=admin_token)
me_admin = r.json() if r.status_code == 200 else {}
record("auth/me admin is_admin:true", r.status_code == 200 and me_admin.get("is_admin") is True,
       f"{r.status_code} is_admin={me_admin.get('is_admin')}")

r = get("/auth/me", token=luna_token)
me_luna = r.json() if r.status_code == 200 else {}
luna_id = me_luna.get("user_id")
record("auth/me luna", r.status_code == 200 and luna_id is not None, f"{r.status_code}")

r = post("/auth/logout", token=new_token)
record("auth/logout", r.status_code == 200, f"{r.status_code}")

# 2) MOODS
print("\n=== 2) MOODS ===")

delete("/moods/today", token=luna_token)

r = post("/moods", token=luna_token,
        json_body={"word": "ocean", "emotion": "joy", "intensity": 4, "privacy": "friends"})
luna_mood_body = r.json() if r.status_code == 200 else {}
luna_mood_id = (
    luna_mood_body.get("mood_id")
    or (luna_mood_body.get("mood") or {}).get("mood_id")
)
record("POST /moods luna", r.status_code == 200 and luna_mood_id is not None,
       f"{r.status_code} keys={list(luna_mood_body.keys())[:8]}")

delete("/moods/today", token=admin_token)
r = post("/moods", token=admin_token,
        json_body={"word": "calm", "emotion": "calm", "intensity": 3, "privacy": "friends"})
record("POST /moods admin", r.status_code == 200, f"{r.status_code}")

r = get("/moods/today", token=luna_token)
record("GET /moods/today luna", r.status_code == 200 and r.json().get("mood") is not None,
       f"{r.status_code}")

r = get("/moods/feed", token=luna_token)
feed = r.json() if r.status_code == 200 else {}
record("GET /moods/feed luna", r.status_code == 200 and isinstance(feed.get("items"), list),
       f"{r.status_code} items={len(feed.get('items', []))}")

r = get("/moods/stats", token=luna_token)
record("GET /moods/stats luna", r.status_code == 200, f"{r.status_code}")

r = get("/moods/stats", token=admin_token)
stats = r.json() if r.status_code == 200 else {}
shape_ok = all(k in stats for k in ("range_30", "range_90", "range_365"))
ranges_ok = shape_ok and all(
    isinstance(stats.get(k), dict) and all(sub in stats.get(k, {}) for sub in ("count", "distribution", "avg_intensity", "volatility"))
    for k in ("range_30", "range_90", "range_365")
)
insights_ok = isinstance(stats.get("insights"), list) and all(isinstance(x, str) for x in stats.get("insights", []))
record("GET /moods/stats admin Pro shape range_30/90/365 + insights[]",
       r.status_code == 200 and shape_ok and ranges_ok and insights_ok,
       f"shape_ok={shape_ok} ranges_ok={ranges_ok} insights_ok={insights_ok}")

if luna_mood_id:
    r = post(f"/moods/{luna_mood_id}/react", token=admin_token, json_body={"emoji": "heart"})
    body = r.json() if r.status_code == 200 else {}
    shape = r.status_code == 200 and body.get("ok") is True and isinstance(body.get("reactions"), list)
    record("POST /moods/{id}/react shape {ok:true, reactions:[...]}", shape,
           f"{r.status_code} keys={list(body.keys())}")

    r = post(f"/moods/{luna_mood_id}/comment", token=admin_token, json_body={"text": "nice"})
    body = r.json() if r.status_code == 200 else {}
    shape = r.status_code == 200 and body.get("ok") is True and isinstance(body.get("comment"), dict)
    record("POST /moods/{id}/comment shape {ok:true, comment:{...}}", shape,
           f"{r.status_code} keys={list(body.keys())}")

r = get("/activity", token=luna_token)
record("GET /activity luna", r.status_code == 200, f"{r.status_code}")

r = get("/activity/unread-count", token=luna_token)
record("GET /activity/unread-count luna", r.status_code == 200, f"{r.status_code} {r.text[:80]}")

r = post("/activity/mark-read", token=luna_token, json_body={})
record("POST /activity/mark-read luna", r.status_code == 200, f"{r.status_code}")

# 3) FRIENDS
print("\n=== 3) FRIENDS ===")

r = get("/friends", token=admin_token)
record("GET /friends admin", r.status_code == 200 and "friends" in r.json(),
       f"{r.status_code} count={len(r.json().get('friends', []))}")

peer_email = f"peer_{uuid.uuid4().hex[:8]}@innfeel.app"
rp = post("/auth/register", json_body={"email": peer_email, "password": "Peer1234!", "name": "Peer Test"})
peer_token = rp.json().get("access_token") if rp.status_code == 200 else None

r = post("/friends/add", token=admin_token, json_body={"email": peer_email})
body = r.json() if r.status_code == 200 else {}
shape = r.status_code == 200 and body.get("ok") is True and isinstance(body.get("friend"), dict)
friend_obj = body.get("friend", {}) if shape else {}
required_friend_fields = ("user_id", "name", "email", "avatar_color")
missing = [k for k in required_friend_fields if k not in friend_obj]
record("POST /friends/add shape {ok:true, friend:{user_id,name,email,avatar_color}}",
       shape and not missing, f"{r.status_code} missing={missing} keys={list(friend_obj.keys())}")
peer_friend_id = friend_obj.get("user_id")

if peer_friend_id:
    r = post(f"/friends/close/{peer_friend_id}", token=admin_token, json_body={})
    record("POST /friends/close/{id}", r.status_code == 200, f"{r.status_code}")

    r = delete(f"/friends/{peer_friend_id}", token=admin_token)
    record("DELETE /friends/{id}", r.status_code == 200, f"{r.status_code}")

# 4) MESSAGES
print("\n=== 4) MESSAGES ===")

if luna_id:
    r = post(f"/messages/with/{luna_id}", token=admin_token, json_body={"text": "hi"})
    body = r.json() if r.status_code == 200 else {}
    msg = body.get("message", {}) if isinstance(body, dict) else {}
    required_msg_fields = ("message_id", "conversation_id", "sender_id", "sender_name", "text", "at")
    missing = [f for f in required_msg_fields if f not in msg]
    shape_ok = (r.status_code == 200 and body.get("ok") is True
                and isinstance(msg, dict) and not missing)
    record("POST /messages/with/{peer} shape preserved", shape_ok,
           f"{r.status_code} missing={missing} body_keys={list(body.keys())}")

    r = get(f"/messages/with/{luna_id}", token=admin_token)
    record("GET /messages/with/{peer}", r.status_code == 200, f"{r.status_code}")

r = get("/messages", token=admin_token)
record("GET /messages (inbox)", r.status_code == 200, f"{r.status_code}")

# 5) WELLNESS
print("\n=== 5) WELLNESS ===")
for emo in ("joy", "anxiety"):
    r = get(f"/wellness/{emo}", token=admin_token)
    body = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and body.get("quote") and body.get("advice")
    record(f"GET /wellness/{emo}", ok, f"{r.status_code} source={body.get('source')}")

# 6) MUSIC
print("\n=== 6) MUSIC ===")
r = get("/music/search", token=admin_token, params={"q": "ocean"})
body = r.json() if r.status_code == 200 else {}
tracks = body.get("tracks", [])
record("GET /music/search?q=ocean", r.status_code == 200 and isinstance(tracks, list) and len(tracks) > 0,
       f"{r.status_code} count={len(tracks)}")

# 7) ADMIN
print("\n=== 7) ADMIN ===")

r = get("/admin/me", token=admin_token)
record("GET /admin/me admin is_admin:true", r.status_code == 200 and r.json().get("is_admin") is True,
       f"{r.status_code}")

r = get("/admin/users/search", token=admin_token, params={"q": "luna"})
record("GET /admin/users/search?q=luna", r.status_code == 200 and isinstance(r.json().get("users"), list),
       f"{r.status_code} count={len(r.json().get('users', []))}")

r = post("/admin/grant-pro", token=admin_token, json_body={"email": LUNA_EMAIL, "days": 30})
record("POST /admin/grant-pro luna 30d", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

r = post("/admin/revoke-pro", token=admin_token, json_body={"email": LUNA_EMAIL})
record("POST /admin/revoke-pro luna", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

# 8) NOTIFICATIONS
print("\n=== 8) NOTIFICATIONS ===")

fake_token = "ExponentPushToken[fake_long_token_abc123]"
r = post("/notifications/register-token", token=admin_token,
         json_body={"token": fake_token, "platform": "ios"})
record("POST /notifications/register-token", r.status_code == 200, f"{r.status_code}")

r = get("/notifications/prefs", token=admin_token)
record("GET /notifications/prefs (1st)", r.status_code == 200, f"{r.status_code}")

r = post("/notifications/prefs", token=admin_token, json_body={"reaction": False})
record("POST /notifications/prefs reaction:false", r.status_code == 200, f"{r.status_code}")

r = get("/notifications/prefs", token=admin_token)
prefs = r.json().get("prefs", {}) if r.status_code == 200 else {}
record("GET /notifications/prefs reaction now false",
       r.status_code == 200 and prefs.get("reaction") is False,
       f"{r.status_code} prefs={prefs}")

r = post("/notifications/prefs", token=admin_token, json_body={"reaction": True})
record("POST /notifications/prefs reaction:true", r.status_code == 200, f"{r.status_code}")

r = post("/notifications/test", token=admin_token, json_body={})
record("POST /notifications/test", r.status_code == 200, f"{r.status_code}")

r = post("/notifications/unregister-token", token=admin_token, json_body={"token": fake_token})
record("POST /notifications/unregister-token", r.status_code == 200, f"{r.status_code}")

# 9) PAYMENTS
print("\n=== 9) PAYMENTS ===")
r = post("/payments/checkout", token=admin_token, json_body={"origin_url": "https://example.com"})
body = r.json() if r.status_code == 200 else {}
ok = r.status_code == 200 and "checkout.stripe.com" in (body.get("url") or "")
record("POST /payments/checkout", ok, f"{r.status_code} url={(body.get('url') or '')[:60]}")

# 10) DEV
print("\n=== 10) DEV ===")
r = post("/dev/toggle-pro", token=new_token)
ok1 = r.status_code == 200
state1 = r.json().get("pro") if ok1 else None
r = post("/dev/toggle-pro", token=new_token)
ok2 = r.status_code == 200
state2 = r.json().get("pro") if ok2 else None
record("POST /dev/toggle-pro twice (toggles)", ok1 and ok2 and state1 != state2,
       f"states={state1}->{state2}")

# 11-13) IAP NEW
print("\n=== 11-13) IAP ===")

r = post("/iap/sync", token=admin_token, json_body={})
body = r.json() if r.status_code == 200 else {}
expected_ok = (r.status_code == 200 and body.get("ok") is False
               and body.get("pro") is False and body.get("reason") == "no_subscriber")
record("POST /iap/sync no_subscriber {ok:false,pro:false,reason:'no_subscriber'} (no 500)",
       expected_ok, f"{r.status_code} body={body}")

r = get("/iap/status", token=admin_token)
body = r.json() if r.status_code == 200 else {}
shape = (r.status_code == 200 and "pro" in body
         and "pro_expires_at" in body and "pro_source" in body)
record("GET /iap/status shape {pro,pro_expires_at,pro_source}",
       shape, f"{r.status_code} body={body}")

event_id = f"evt_test_abc_{uuid.uuid4().hex[:8]}"
payload = {"event": {"id": event_id, "type": "INITIAL_PURCHASE", "app_user_id": "user_nonexistent"}}
r = requests.post(API + "/iap/webhook", json=payload, timeout=30)
record("POST /iap/webhook first → 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

r = requests.post(API + "/iap/webhook", json=payload, timeout=30)
body = r.json() if r.status_code == 200 else {}
record("POST /iap/webhook resend same event.id {duplicate:true}",
       r.status_code == 200 and body.get("duplicate") is True,
       f"{r.status_code} body={body}")

r = requests.post(API + "/iap/webhook", json={}, timeout=30)
body = r.json() if r.status_code == 200 else {}
record("POST /iap/webhook invalid body {} → 200 ignored:'missing_ids'",
       r.status_code == 200 and body.get("ignored") == "missing_ids",
       f"{r.status_code} body={body}")

r = requests.post(API + "/iap/sync", json={}, timeout=30)
record("POST /iap/sync without auth → 401/403", r.status_code in (401, 403),
       f"{r.status_code}")

r = requests.get(API + "/iap/status", timeout=30)
record("GET /iap/status without auth → 401/403", r.status_code in (401, 403),
       f"{r.status_code}")

# Summary
print("\n" + "=" * 60)
total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
pct = 100.0 * passed / total if total else 0
print(f"TOTAL: {passed}/{total} PASS ({pct:.1f}%)")
print("\nFAILURES:")
for n, ok, d in results:
    if not ok:
        print(f"  - {n} :: {d}")

sys.exit(0 if passed == total else 1)
