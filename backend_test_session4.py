"""Session 4 MoodDrop backend tests.

Tests:
 1) Mood delete & redo
 2) Admin grant/revoke Pro
 3) Unread messages
 4) Stripe checkout robustness
 5) Regression: auth/me admin, /friends is_close, /wellness/joy
"""
import os
import sys
import uuid
import json
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

ADMIN_EMAIL = "admin@mooddrop.app"
ADMIN_PW = "admin123"
LUNA_EMAIL = "luna@mooddrop.app"
LUNA_PW = "demo1234"

TIMEOUT = 30

results = []  # list of (name, ok, detail)


def log(name, ok, detail=""):
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {name}: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


def register(email, password, name):
    r = requests.post(f"{BASE}/auth/register", json={"email": email, "password": password, "name": name}, timeout=TIMEOUT)
    assert r.status_code == 200, f"register {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


# ---------------------------------------------------------------------------
# Setup: admin + luna tokens
# ---------------------------------------------------------------------------
print(f"BASE = {BASE}")
admin_tok = login(ADMIN_EMAIL, ADMIN_PW)
luna_tok = login(LUNA_EMAIL, LUNA_PW)


# ===========================================================================
# 1) MOOD DELETE & REDO
# ===========================================================================
print("\n=== 1) MOOD DELETE & REDO ===")

# 1a) Ensure a mood exists today for admin, then delete, redelete, then re-post
# First ensure clean slate: delete today mood
r = requests.delete(f"{BASE}/moods/today", headers=H(admin_tok), timeout=TIMEOUT)
log("1a-prep DELETE /moods/today (cleanup)", r.status_code == 200,
    f"status={r.status_code} body={r.text[:200]}")

# Post a mood (admin is Pro, but we'll keep it simple)
mood_payload = {"word": "sunrise", "emotion": "joy", "intensity": 4, "privacy": "private"}
r = requests.post(f"{BASE}/moods", json=mood_payload, headers=H(admin_tok), timeout=TIMEOUT)
log("1a-1 POST /moods (create fresh mood)", r.status_code == 200,
    f"status={r.status_code} body={r.text[:200]}")

# Now delete it -> should return deleted:1
r = requests.delete(f"{BASE}/moods/today", headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("ok") is True and r.json().get("deleted") == 1
log("1a-2 DELETE /moods/today -> {ok:true, deleted:1}", ok,
    f"status={r.status_code} body={r.text[:200]}")

# Call again -> deleted:0
r = requests.delete(f"{BASE}/moods/today", headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("ok") is True and r.json().get("deleted") == 0
log("1a-3 DELETE /moods/today again -> deleted:0", ok,
    f"status={r.status_code} body={r.text[:200]}")

# Now POST again -> should succeed (not blocked by already-dropped-today)
r = requests.post(f"{BASE}/moods", json=mood_payload, headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200
log("1a-4 POST /moods after delete -> 200", ok,
    f"status={r.status_code} body={r.text[:200]}")

# 1b) DELETE non-existent mood_id -> 404
fake_id = f"mood_{uuid.uuid4().hex[:12]}"
r = requests.delete(f"{BASE}/moods/{fake_id}", headers=H(admin_tok), timeout=TIMEOUT)
log("1b DELETE /moods/{nonexistent} -> 404", r.status_code == 404,
    f"status={r.status_code} body={r.text[:200]}")

# 1c) Admin tries to delete another user's mood -> 403
# Register fresh user_x, drop mood (private), grab id, admin DELETE -> 403
ux_email = f"userx_{uuid.uuid4().hex[:8]}@test.io"
ux_tok, ux_user = register(ux_email, "TestPass1!", "UserX")
r = requests.post(f"{BASE}/moods",
                  json={"word": "rainy", "emotion": "calm", "intensity": 3, "privacy": "private"},
                  headers=H(ux_tok), timeout=TIMEOUT)
ok = r.status_code == 200
assert ok, f"Failed to drop user_x mood: {r.status_code} {r.text[:300]}"
ux_mood_id = r.json()["mood"]["mood_id"]
log("1c-prep user_x dropped private mood", ok, f"mood_id={ux_mood_id}")

r = requests.delete(f"{BASE}/moods/{ux_mood_id}", headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 403
log("1c DELETE other user's mood as admin -> 403", ok,
    f"status={r.status_code} body={r.text[:200]}")


# ===========================================================================
# 2) ADMIN GRANT/REVOKE PRO
# ===========================================================================
print("\n=== 2) ADMIN GRANT/REVOKE PRO ===")

# 2a) /admin/me as admin -> is_admin:true
r = requests.get(f"{BASE}/admin/me", headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("is_admin") is True
log("2a-1 GET /admin/me (admin) -> is_admin:true", ok,
    f"status={r.status_code} body={r.text[:200]}")

# Fresh non-admin user
nu_email = f"nonadmin_{uuid.uuid4().hex[:8]}@test.io"
nu_tok, _ = register(nu_email, "TestPass1!", "NonAdmin")
r = requests.get(f"{BASE}/admin/me", headers=H(nu_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("is_admin") is False
log("2a-2 GET /admin/me (non-admin) -> is_admin:false", ok,
    f"status={r.status_code} body={r.text[:200]}")

# 2b) admin grant-pro luna 7 days
r = requests.post(f"{BASE}/admin/grant-pro",
                  json={"email": LUNA_EMAIL, "days": 7, "note": "test promo"},
                  headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200
log("2b-1 POST /admin/grant-pro luna days=7 -> 200", ok,
    f"status={r.status_code} body={r.text[:300]}")

# Verify luna /auth/me
luna_tok_new = login(LUNA_EMAIL, LUNA_PW)  # refresh token
r = requests.get(f"{BASE}/auth/me", headers=H(luna_tok_new), timeout=TIMEOUT)
if r.status_code == 200:
    j = r.json()
    pro_exp = j.get("pro_expires_at")
    from datetime import datetime, timezone
    days_delta = None
    if pro_exp:
        try:
            exp_dt = datetime.fromisoformat(pro_exp.replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            days_delta = (exp_dt - datetime.now(timezone.utc)).total_seconds() / 86400.0
        except Exception as e:
            days_delta = f"parse_err:{e}"
    ok = (j.get("pro") is True and j.get("pro_source") == "admin_grant"
          and isinstance(days_delta, float) and 6.5 <= days_delta <= 7.5)
    log("2b-2 luna /auth/me pro=true, source=admin_grant, ~7d", ok,
        f"pro={j.get('pro')} source={j.get('pro_source')} days_delta={days_delta}")
else:
    log("2b-2 luna /auth/me", False, f"status={r.status_code} body={r.text[:200]}")

# 2c) /admin/pro-grants
r = requests.get(f"{BASE}/admin/pro-grants", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    grants = r.json().get("grants", [])
    luna_active = [g for g in grants if g.get("granted_to_email") == LUNA_EMAIL
                   and g.get("is_active") is True]
    ok_found = len(luna_active) >= 1
    days_rem_ok = False
    if ok_found:
        dr = luna_active[0].get("days_remaining")
        days_rem_ok = isinstance(dr, int) and 6 <= dr <= 7
    log("2c /admin/pro-grants includes active luna grant days≈7",
        ok_found and days_rem_ok,
        f"found={ok_found} days_remaining={luna_active[0].get('days_remaining') if ok_found else None}")
else:
    log("2c /admin/pro-grants", False, f"status={r.status_code} body={r.text[:200]}")

# 2d) non-admin POST /admin/grant-pro -> 403
r = requests.post(f"{BASE}/admin/grant-pro",
                  json={"email": LUNA_EMAIL, "days": 7},
                  headers=H(nu_tok), timeout=TIMEOUT)
log("2d POST /admin/grant-pro as non-admin -> 403", r.status_code == 403,
    f"status={r.status_code} body={r.text[:200]}")

# 2e) admin revoke
r = requests.post(f"{BASE}/admin/revoke-pro",
                  json={"email": LUNA_EMAIL},
                  headers=H(admin_tok), timeout=TIMEOUT)
log("2e-1 POST /admin/revoke-pro luna -> 200", r.status_code == 200,
    f"status={r.status_code} body={r.text[:200]}")

# luna /auth/me pro:false
luna_tok_new2 = login(LUNA_EMAIL, LUNA_PW)
r = requests.get(f"{BASE}/auth/me", headers=H(luna_tok_new2), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("pro") is False
log("2e-2 luna /auth/me after revoke -> pro:false", ok,
    f"status={r.status_code} pro={r.json().get('pro') if r.status_code == 200 else None}")

# /admin/pro-grants -> grant revoked:true, is_active:false
r = requests.get(f"{BASE}/admin/pro-grants", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    grants = r.json().get("grants", [])
    luna_grants = [g for g in grants if g.get("granted_to_email") == LUNA_EMAIL]
    latest = luna_grants[0] if luna_grants else None
    ok = latest is not None and latest.get("revoked") is True and latest.get("is_active") is False
    log("2e-3 /admin/pro-grants luna revoked:true, is_active:false", ok,
        f"latest.revoked={latest.get('revoked') if latest else None} is_active={latest.get('is_active') if latest else None}")
else:
    log("2e-3 /admin/pro-grants", False, f"status={r.status_code}")

# 2f) grant to non-existent email -> 404
r = requests.post(f"{BASE}/admin/grant-pro",
                  json={"email": "noexist@example.com", "days": 7},
                  headers=H(admin_tok), timeout=TIMEOUT)
log("2f POST /admin/grant-pro noexist -> 404", r.status_code == 404,
    f"status={r.status_code} body={r.text[:200]}")

# 2g) /admin/users/search?q=luna -> >=1 result
r = requests.get(f"{BASE}/admin/users/search", params={"q": "luna"},
                 headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    users = r.json().get("users", [])
    ok = len(users) >= 1 and any(u.get("email") == LUNA_EMAIL for u in users)
    log("2g /admin/users/search?q=luna >=1 result", ok, f"count={len(users)}")
else:
    log("2g /admin/users/search q=luna", False, f"status={r.status_code}")

# 2h) q too short -> {users:[]}
r = requests.get(f"{BASE}/admin/users/search", params={"q": "a"},
                 headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and r.json().get("users") == []
log("2h /admin/users/search?q=a -> users:[]", ok,
    f"status={r.status_code} body={r.text[:200]}")


# ===========================================================================
# 3) UNREAD MESSAGES
# ===========================================================================
print("\n=== 3) UNREAD MESSAGES ===")

r = requests.get(f"{BASE}/messages/unread-count", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    j = r.json()
    ok = (isinstance(j.get("total"), int) and isinstance(j.get("conversations"), int))
    log("3 GET /messages/unread-count {total:int, conversations:int}", ok,
        f"body={j}")
else:
    log("3 GET /messages/unread-count", False, f"status={r.status_code} body={r.text[:200]}")


# ===========================================================================
# 4) STRIPE CHECKOUT ROBUSTNESS
# ===========================================================================
print("\n=== 4) STRIPE CHECKOUT ROBUSTNESS ===")

# 4a) body {} (no origin_url) -> 200
r = requests.post(f"{BASE}/payments/checkout", json={}, headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and "url" in r.json() and "session_id" in r.json()
log("4a POST /payments/checkout body={} -> 200 {url,session_id}", ok,
    f"status={r.status_code} body={r.text[:300]}")

# 4b) body {origin_url: ""} -> 200
r = requests.post(f"{BASE}/payments/checkout", json={"origin_url": ""},
                  headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and "url" in r.json() and "session_id" in r.json()
log("4b POST /payments/checkout origin_url='' -> 200", ok,
    f"status={r.status_code} body={r.text[:300]}")

# 4c) body {origin_url: "https://mooddrop.app"} -> 200
r = requests.post(f"{BASE}/payments/checkout", json={"origin_url": "https://mooddrop.app"},
                  headers=H(admin_tok), timeout=TIMEOUT)
ok = r.status_code == 200 and "url" in r.json() and "session_id" in r.json()
log("4c POST /payments/checkout origin_url=mooddrop.app -> 200", ok,
    f"status={r.status_code} body={r.text[:300]}")


# ===========================================================================
# 5) REGRESSION
# ===========================================================================
print("\n=== 5) REGRESSION ===")

# 5a) /auth/me admin has is_admin:true and pro_source present
r = requests.get(f"{BASE}/auth/me", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    j = r.json()
    ok = j.get("is_admin") is True and "pro_source" in j
    log("5a /auth/me admin has is_admin:true + pro_source key", ok,
        f"is_admin={j.get('is_admin')} pro_source={j.get('pro_source')}")
else:
    log("5a /auth/me admin", False, f"status={r.status_code}")

# 5b) /friends returns is_close on each row (admin has luna, rio, sage as friends? Need to ensure admin has a friend)
# Admin might not be friend with luna. Let's first make them friends to have a non-empty list.
r = requests.post(f"{BASE}/friends/add", json={"email": LUNA_EMAIL},
                  headers=H(admin_tok), timeout=TIMEOUT)
# ok if 200 or 400 already friends
_ = r.status_code
r = requests.get(f"{BASE}/friends", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    friends = r.json().get("friends", [])
    if friends:
        ok = all("is_close" in f for f in friends)
        log("5b /friends rows include is_close", ok, f"n={len(friends)}")
    else:
        # Even empty is OK for regression; but retry after adding friend
        log("5b /friends rows include is_close (empty list)", True, "no friends")
else:
    log("5b /friends", False, f"status={r.status_code}")

# 5c) /wellness/joy still works
r = requests.get(f"{BASE}/wellness/joy", headers=H(admin_tok), timeout=TIMEOUT)
if r.status_code == 200:
    j = r.json()
    ok = j.get("quote") and j.get("advice") and j.get("source") in ("llm", "llm-cache", "static")
    log("5c /wellness/joy still works", bool(ok),
        f"source={j.get('source')} quote_len={len(j.get('quote') or '')}")
else:
    log("5c /wellness/joy", False, f"status={r.status_code} body={r.text[:200]}")


# ===========================================================================
# SUMMARY
# ===========================================================================
print("\n=== SUMMARY ===")
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
for name, ok, detail in results:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
print(f"\n{passed}/{passed+failed} passed")
sys.exit(0 if failed == 0 else 1)
