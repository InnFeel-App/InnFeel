"""
Session 9 backend regression test for InnFeel.
Focus: server-side push notifications, send_push side-effects, Pro analytics, regression sweep.
"""
import os
import sys
import time
import uuid
import json
import requests

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"

ADMIN_EMAIL = "admin@innfeel.app"
ADMIN_PASSWORD = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASSWORD = "demo1234"


PASS = []
FAIL = []


def _log(name, ok, detail=""):
    line = f"{'PASS' if ok else 'FAIL'}: {name}{(' — ' + detail) if detail else ''}"
    print(line)
    (PASS if ok else FAIL).append(line)


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def section(title):
    print(f"\n=== {title} ===")


# --- Logins ----------------------------------------------------------------
section("AUTH")
try:
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    _log("admin login 200", True)
except Exception as e:
    _log("admin login 200", False, str(e))
    sys.exit(1)

try:
    luna_tok = login(LUNA_EMAIL, LUNA_PASSWORD)
    _log("luna login 200", True)
except Exception as e:
    _log("luna login 200", False, str(e))
    sys.exit(1)

# /auth/me
r = requests.get(f"{BASE}/auth/me", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and r.json().get("is_admin") is True and r.json().get("pro") is True
_log("admin /auth/me is_admin:true, pro:true", ok, f"status={r.status_code} body_keys={list(r.json().keys())[:6]}")
admin_me = r.json()
admin_id = admin_me["user_id"]

r = requests.get(f"{BASE}/auth/me", headers=hdr(luna_tok), timeout=20)
luna_me = r.json()
luna_id = luna_me["user_id"]
_log("luna /auth/me 200", r.status_code == 200, f"status={r.status_code}")

# Make sure admin <-> luna are friends (idempotent)
r = requests.post(f"{BASE}/friends/add", headers=hdr(admin_tok), json={"email": LUNA_EMAIL}, timeout=20)
ok = r.status_code == 200 and r.json().get("ok") is True and "friend" in r.json()
fr = r.json().get("friend") or {}
ok2 = all(k in fr for k in ("user_id", "name", "email", "avatar_color"))
_log("/friends/add (admin→luna) shape unchanged", ok and ok2, f"status={r.status_code} keys={list(fr.keys())}")


# --- Push notifications: register/unregister/prefs/test --------------------
section("PUSH NOTIFICATIONS")

# register-token
fake_token = f"ExponentPushToken[abc123fake_but_long_enough_{uuid.uuid4().hex[:8]}]"
r = requests.post(f"{BASE}/notifications/register-token", headers=hdr(admin_tok),
                  json={"token": fake_token, "platform": "ios"}, timeout=20)
_log("POST /notifications/register-token 200 {ok:true}",
     r.status_code == 200 and r.json().get("ok") is True,
     f"status={r.status_code} body={r.text[:120]}")

# prefs GET (defaults)
r = requests.get(f"{BASE}/notifications/prefs", headers=hdr(admin_tok), timeout=20)
prefs_default = r.json().get("prefs") if r.status_code == 200 else None
ok = (
    r.status_code == 200
    and prefs_default is not None
    and prefs_default.get("reminder") is True
    and prefs_default.get("reaction") is True
    and prefs_default.get("message") is True
    and prefs_default.get("friend") is True
)
_log("GET /notifications/prefs all defaults true", ok, f"status={r.status_code} prefs={prefs_default}")

# prefs POST partial set
r = requests.post(f"{BASE}/notifications/prefs", headers=hdr(admin_tok),
                  json={"reaction": False}, timeout=20)
_log("POST /notifications/prefs {reaction:false} 200 {ok:true}",
     r.status_code == 200 and r.json().get("ok") is True,
     f"status={r.status_code} body={r.text[:80]}")

r = requests.get(f"{BASE}/notifications/prefs", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and r.json().get("prefs", {}).get("reaction") is False
_log("GET /notifications/prefs reflects reaction:false", ok, f"prefs={r.json().get('prefs')}")

# Re-enable reaction
r = requests.post(f"{BASE}/notifications/prefs", headers=hdr(admin_tok),
                  json={"reaction": True}, timeout=20)
_log("POST /notifications/prefs {reaction:true} (re-enable) 200", r.status_code == 200 and r.json().get("ok") is True,
     f"status={r.status_code}")

r = requests.get(f"{BASE}/notifications/prefs", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and r.json().get("prefs", {}).get("reaction") is True
_log("verify reaction re-enabled true", ok, f"prefs={r.json().get('prefs')}")

# notifications/test (will fail to deliver since fake token, but endpoint should respond 200 with ok:bool)
r = requests.post(f"{BASE}/notifications/test", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and isinstance(r.json().get("ok"), bool)
_log("POST /notifications/test 200 {ok:bool}", ok, f"status={r.status_code} body={r.text[:80]}")

# unregister-token
r = requests.post(f"{BASE}/notifications/unregister-token", headers=hdr(admin_tok), timeout=20)
_log("POST /notifications/unregister-token 200 {ok:true}",
     r.status_code == 200 and r.json().get("ok") is True,
     f"status={r.status_code}")


# --- send_push side-effect wiring (response shapes unchanged) ---------------
section("SIDE-EFFECT WIRING (response shape regression)")

# Ensure both have a mood today so feed is unlocked + we can react/comment.
# Clean today, then drop fresh.
requests.delete(f"{BASE}/moods/today", headers=hdr(admin_tok), timeout=20)
requests.delete(f"{BASE}/moods/today", headers=hdr(luna_tok), timeout=20)

# Admin posts (Pro features allowed)
r = requests.post(f"{BASE}/moods", headers=hdr(admin_tok), json={
    "word": "calmsea", "emotion": "calm", "intensity": 4, "privacy": "friends"
}, timeout=20)
ok = r.status_code == 200 and "mood" in r.json()
admin_mood_id = r.json()["mood"]["mood_id"] if ok else None
_log("admin POST /moods 200", ok, f"status={r.status_code} mood_id={admin_mood_id}")

# Luna posts
r = requests.post(f"{BASE}/moods", headers=hdr(luna_tok), json={
    "word": "warm", "emotion": "grateful", "intensity": 4, "privacy": "friends"
}, timeout=20)
ok = r.status_code == 200 and "mood" in r.json()
luna_mood_id = r.json()["mood"]["mood_id"] if ok else None
_log("luna POST /moods 200", ok, f"status={r.status_code} mood_id={luna_mood_id}")

# luna reacts to admin's mood
if admin_mood_id:
    t0 = time.time()
    r = requests.post(f"{BASE}/moods/{admin_mood_id}/react", headers=hdr(luna_tok),
                      json={"emoji": "heart"}, timeout=20)
    elapsed = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    ok = (
        r.status_code == 200
        and body.get("ok") is True
        and isinstance(body.get("reactions"), list)
    )
    _log("POST /moods/{id}/react shape {ok:true, reactions:[...]}", ok,
         f"status={r.status_code} elapsed={elapsed:.2f}s keys={list(body.keys())}")

    # luna comments on admin's mood
    t0 = time.time()
    r = requests.post(f"{BASE}/moods/{admin_mood_id}/comment", headers=hdr(luna_tok),
                      json={"text": "Nice aura"}, timeout=20)
    elapsed = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    cmt = body.get("comment") or {}
    ok = (
        r.status_code == 200
        and body.get("ok") is True
        and isinstance(cmt, dict)
        and cmt.get("text") == "Nice aura"
        and "comment_id" in cmt
    )
    _log("POST /moods/{id}/comment shape {ok:true, comment:{...}}", ok,
         f"status={r.status_code} elapsed={elapsed:.2f}s cmt_keys={list(cmt.keys())}")
else:
    _log("react/comment tests skipped (no admin mood)", False)

# admin → luna message
t0 = time.time()
r = requests.post(f"{BASE}/messages/with/{luna_id}", headers=hdr(admin_tok),
                  json={"text": "hi from tester"}, timeout=20)
elapsed = time.time() - t0
body = r.json() if r.status_code == 200 else {}
msg = body.get("message") or {}
required = ("message_id", "conversation_id", "sender_id", "sender_name", "text", "at")
missing = [k for k in required if k not in msg]
ok = r.status_code == 200 and body.get("ok") is True and not missing and msg.get("text") == "hi from tester"
_log("POST /messages/with/{peer} shape includes all required keys", ok,
     f"status={r.status_code} elapsed={elapsed:.2f}s missing={missing} keys={list(msg.keys())}")

# friends/add — already done; do another to confirm shape (uses second user)
# Use a freshly registered user as "the one being added" so push fires
fresh_email = f"tester_{uuid.uuid4().hex[:8]}@innfeel.app"
fresh_password = "TesterPass123!"
r = requests.post(f"{BASE}/auth/register", json={
    "email": fresh_email, "password": fresh_password, "name": "Test Tina",
}, timeout=20)
ok = r.status_code == 200 and "user" in r.json()
fresh_tok = r.json().get("access_token")
fresh_id = r.json().get("user", {}).get("user_id")
_log("register fresh user (for friend-add push test)", ok, f"status={r.status_code}")

if fresh_id:
    t0 = time.time()
    r = requests.post(f"{BASE}/friends/add", headers=hdr(admin_tok),
                      json={"email": fresh_email}, timeout=20)
    elapsed = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    fr = body.get("friend") or {}
    needed = ("user_id", "name", "email", "avatar_color")
    missing = [k for k in needed if k not in fr]
    ok = (
        r.status_code == 200
        and body.get("ok") is True
        and not missing
        and elapsed < 8.0  # fire-and-forget — must not block
    )
    _log("POST /friends/add (push fire-and-forget) returns normally", ok,
         f"status={r.status_code} elapsed={elapsed:.2f}s missing={missing}")


# --- Pro analytics --------------------------------------------------------
section("PRO ANALYTICS (/moods/stats)")

r = requests.get(f"{BASE}/moods/stats", headers=hdr(admin_tok), timeout=20)
ok_status = r.status_code == 200
body = r.json() if ok_status else {}
_log("/moods/stats 200 (admin/Pro)", ok_status, f"status={r.status_code}")

# regression keys
for k in ("by_weekday", "distribution", "dominant", "dominant_color", "streak", "drops_this_week"):
    _log(f"stats has {k}", k in body, f"value type={type(body.get(k)).__name__}")

# range_30/90/365 with required sub-keys
for days in (30, 90, 365):
    rk = f"range_{days}"
    sub = body.get(rk)
    has_keys = isinstance(sub, dict) and all(
        k in sub for k in ("count", "distribution", "avg_intensity", "volatility")
    )
    types_ok = (
        isinstance(sub, dict)
        and isinstance(sub.get("count"), int)
        and isinstance(sub.get("distribution"), dict)
        and isinstance(sub.get("avg_intensity"), (int, float))
        and isinstance(sub.get("volatility"), (int, float))
    )
    _log(f"stats has {rk} with {{count,distribution,avg_intensity,volatility}}",
         has_keys and types_ok,
         f"sub_keys={list(sub.keys()) if isinstance(sub, dict) else None}")

insights = body.get("insights")
ok = isinstance(insights, list) and all(isinstance(x, str) for x in insights)
_log("stats has insights[] list of strings", ok, f"insights_len={len(insights) if isinstance(insights, list) else None}")

# Non-Pro user: register fresh (no Pro)
free_email = f"free_{uuid.uuid4().hex[:8]}@innfeel.app"
r = requests.post(f"{BASE}/auth/register", json={
    "email": free_email, "password": "FreePass123!", "name": "Free Frances",
}, timeout=20)
free_tok = r.json().get("access_token") if r.status_code == 200 else None
_log("register free user", free_tok is not None, f"status={r.status_code}")

if free_tok:
    r = requests.get(f"{BASE}/moods/stats", headers=hdr(free_tok), timeout=20)
    body_free = r.json() if r.status_code == 200 else {}
    _log("/moods/stats 200 (free)", r.status_code == 200, f"status={r.status_code}")
    has_basic = all(k in body_free for k in ("distribution", "dominant", "by_weekday", "streak"))
    _log("free stats has basic keys", has_basic, f"keys={list(body_free.keys())}")
    no_pro_keys = ("range_30" not in body_free
                   and "range_90" not in body_free
                   and "range_365" not in body_free
                   and "insights" not in body_free)
    _log("free stats omits pro analytics (no range_*/insights)", no_pro_keys,
         f"keys={list(body_free.keys())}")


# --- Regression sweep ------------------------------------------------------
section("REGRESSION SWEEP")

# /moods/today admin
r = requests.get(f"{BASE}/moods/today", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and "mood" in r.json()
_log("/moods/today admin 200", ok, f"status={r.status_code}")

# /moods/feed admin
r = requests.get(f"{BASE}/moods/feed", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and "items" in r.json()
_log("/moods/feed admin 200", ok, f"status={r.status_code} item_count={len(r.json().get('items', []))}")

# /friends
r = requests.get(f"{BASE}/friends", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and "friends" in r.json()
_log("/friends 200", ok, f"status={r.status_code}")

# /friends/close/{luna_id} — Pro toggle
r = requests.post(f"{BASE}/friends/close/{luna_id}", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and isinstance(r.json().get("is_close"), bool)
state_after = r.json().get("is_close") if ok else None
_log("/friends/close/{luna_id} 200 toggles", ok, f"status={r.status_code} is_close={state_after}")
# Toggle back to original (so we don't leave state changed permanently)
if state_after is True:
    requests.post(f"{BASE}/friends/close/{luna_id}", headers=hdr(admin_tok), timeout=20)

# /wellness/joy
r = requests.get(f"{BASE}/wellness/joy", headers=hdr(admin_tok), timeout=20)
body = r.json() if r.status_code == 200 else {}
ok = r.status_code == 200 and body.get("source") and body.get("quote") and body.get("advice")
_log("/wellness/joy 200 with quote+advice+source", ok,
     f"status={r.status_code} source={body.get('source')}")

# /music/search?q=ocean (admin Pro)
r = requests.get(f"{BASE}/music/search", headers=hdr(admin_tok), params={"q": "ocean"}, timeout=20)
ok = r.status_code == 200 and isinstance(r.json().get("tracks"), list) and len(r.json().get("tracks")) > 0
_log("/music/search?q=ocean (Pro) 200 with tracks", ok, f"status={r.status_code}")

# /admin/me
r = requests.get(f"{BASE}/admin/me", headers=hdr(admin_tok), timeout=20)
ok = r.status_code == 200 and r.json().get("is_admin") is True
_log("/admin/me admin is_admin:true", ok, f"status={r.status_code}")

# /admin/users/search?q=luna
r = requests.get(f"{BASE}/admin/users/search", headers=hdr(admin_tok), params={"q": "luna"}, timeout=20)
ok = r.status_code == 200 and isinstance(r.json().get("users"), list) and len(r.json().get("users")) >= 1
_log("/admin/users/search?q=luna 200 with matches", ok,
     f"status={r.status_code} count={len(r.json().get('users', []))}")

# /payments/checkout {} fallback
r = requests.post(f"{BASE}/payments/checkout", headers=hdr(admin_tok), json={}, timeout=30)
body = r.json() if r.status_code == 200 else {}
url = body.get("url", "")
ok = r.status_code == 200 and "checkout.stripe.com" in url
_log("/payments/checkout {} 200 with checkout.stripe.com URL", ok,
     f"status={r.status_code} url_prefix={url[:50]}")


# --- Final summary --------------------------------------------------------
section("SUMMARY")
total = len(PASS) + len(FAIL)
pass_rate = (len(PASS) / total * 100) if total else 0
print(f"\nResult: {len(PASS)}/{total} passed ({pass_rate:.1f}%)")
if FAIL:
    print("\nFAILURES:")
    for f in FAIL:
        print(" -", f)
sys.exit(0 if not FAIL else 1)
