"""
InnFeel backend regression test (post-rebrand).
Covers: auth, moods, wellness LLM, friends + close + feed, music, admin, stripe, messages, comments+reactions.

Run:  python /app/backend_test.py
"""
import os
import sys
import time
import json
import uuid
import requests
from typing import Optional

# -------- Config --------
def _read_env(path: str) -> dict:
    out = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out

FRONTEND_ENV = _read_env("/app/frontend/.env")
BASE = (FRONTEND_ENV.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE:
    print("FATAL: EXPO_PUBLIC_BACKEND_URL not found in /app/frontend/.env")
    sys.exit(2)
API = f"{BASE}/api"
print(f">>> Using API base: {API}")

PASSED = []
FAILED = []

def _record(name: str, ok: bool, info: str = ""):
    if ok:
        PASSED.append(name)
        print(f"  PASS  {name}  {info}")
    else:
        FAILED.append((name, info))
        print(f"  FAIL  {name}  {info}")

def _h(token: Optional[str]) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}

def post(path, token=None, json_body=None, expect=None, name=None):
    url = f"{API}{path}"
    r = requests.post(url, headers=_h(token), json=json_body or {}, timeout=30)
    return _check(r, expect, name or f"POST {path}")

def get(path, token=None, params=None, expect=None, name=None):
    url = f"{API}{path}"
    r = requests.get(url, headers=_h(token), params=params or {}, timeout=30)
    return _check(r, expect, name or f"GET {path}")

def delete(path, token=None, expect=None, name=None):
    url = f"{API}{path}"
    r = requests.delete(url, headers=_h(token), timeout=30)
    return _check(r, expect, name or f"DELETE {path}")

def _check(r, expect, name):
    ok = (r.status_code == expect) if expect is not None else (200 <= r.status_code < 300)
    body = None
    try:
        body = r.json()
    except Exception:
        body = r.text[:200]
    info = f"status={r.status_code}"
    if not ok:
        info += f" body={str(body)[:240]}"
    _record(name, ok, info)
    return r, body

def login(email, password, label):
    r, body = post("/auth/login", json_body={"email": email, "password": password}, expect=200, name=f"login {label}")
    if r.status_code == 200 and isinstance(body, dict):
        return body.get("access_token"), body.get("user")
    return None, None

def register_fresh(name_prefix: str):
    ts = int(time.time() * 1000)
    rnd = uuid.uuid4().hex[:6]
    email = f"{name_prefix}_{ts}_{rnd}@example.com"
    pw = "Test1234!"
    r, body = post("/auth/register", json_body={"email": email, "password": pw, "name": name_prefix.title()}, expect=200, name=f"register {name_prefix}")
    tok = body.get("access_token") if isinstance(body, dict) else None
    user = body.get("user") if isinstance(body, dict) else None
    return email, pw, tok, user

# ============================================================
# A) Auth
# ============================================================
print("\n=== A) Auth & users ===")
admin_token, admin_user = login("admin@innfeel.app", "admin123", "admin")
if admin_user:
    ok = bool(admin_user.get("is_admin")) and bool(admin_user.get("pro"))
    _record("admin login flags is_admin+pro", ok, f"is_admin={admin_user.get('is_admin')} pro={admin_user.get('pro')}")
else:
    _record("admin login flags is_admin+pro", False, "no user object")

post("/auth/login", json_body={"email": "admin@mooddrop.app", "password": "admin123"}, expect=401, name="legacy admin@mooddrop.app login → 401")

r, me_body = get("/auth/me", token=admin_token, expect=200, name="auth/me admin")
if isinstance(me_body, dict):
    has_keys = ("is_admin" in me_body) and ("pro" in me_body) and ("pro_source" in me_body)
    _record("auth/me has is_admin/pro/pro_source", has_keys, f"is_admin={me_body.get('is_admin')} pro={me_body.get('pro')} pro_source={me_body.get('pro_source')}")

fresh_email, fresh_pw, fresh_token, fresh_user = register_fresh("t1")

luna_token, luna_user = login("luna@innfeel.app", "demo1234", "luna")
LUNA_ID = luna_user["user_id"] if luna_user else None
ADMIN_ID = admin_user["user_id"] if admin_user else None

# ============================================================
# B) Moods
# ============================================================
print("\n=== B) Moods ===")
delete("/moods/today", token=admin_token, expect=200, name="DELETE /moods/today (clean slate)")

post("/moods", token=admin_token, json_body={
    "word": "radiant", "emotion": "joy", "intensity": 6, "privacy": "private"
}, expect=200, name="admin POST /moods (joy, intensity=6 Pro)")

# 8 — invalid emotion key 'joyful' should 422
delete("/moods/today", token=admin_token, expect=200, name="DELETE /moods/today (pre-422)")
post("/moods", token=admin_token, json_body={
    "word": "test", "emotion": "joyful", "intensity": 3, "privacy": "private"
}, expect=422, name="POST /moods invalid emotion 'joyful' → 422")

# 9 - 4 fresh users for new emotions
NEW_EMOTIONS = ["motivated", "unmotivated", "worried", "lost"]
for emo in NEW_EMOTIONS:
    e, p, tok, _u = register_fresh(f"emo_{emo}")
    post("/moods", token=tok, json_body={
        "word": "test", "emotion": emo, "intensity": 5, "privacy": "private"
    }, expect=200, name=f"free user posts mood emotion={emo}")

# Re-drop admin mood with motivated key
post("/moods", token=admin_token, json_body={
    "word": "fired-up", "emotion": "motivated", "intensity": 6, "privacy": "private"
}, expect=200, name="admin POST /moods (motivated)")

# 10 - GET /moods/today admin
r, body = get("/moods/today", token=admin_token, expect=200, name="GET /moods/today admin")
if isinstance(body, dict):
    mood = body.get("mood") or {}
    _record("GET /moods/today returns mood", bool(mood and mood.get("emotion") == "motivated"), f"emotion={mood.get('emotion')}")

# 11 - delete idempotent
r, body = delete("/moods/today", token=admin_token, expect=200, name="DELETE /moods/today first call")
if isinstance(body, dict):
    _record("DELETE /moods/today deleted=1", body.get("deleted") == 1, f"deleted={body.get('deleted')}")
r, body = delete("/moods/today", token=admin_token, expect=200, name="DELETE /moods/today second call (idempotent)")
if isinstance(body, dict):
    _record("DELETE /moods/today deleted=0 second call", body.get("deleted") == 0, f"deleted={body.get('deleted')}")

# ============================================================
# C) Wellness
# ============================================================
print("\n=== C) Wellness ===")
r, body = get("/wellness/motivated", token=admin_token, expect=200, name="GET /wellness/motivated #1")
src1 = body.get("source") if isinstance(body, dict) else None
_record("/wellness/motivated has quote+advice+source", isinstance(body, dict) and bool(body.get("quote")) and bool(body.get("advice")) and "source" in body, f"src={src1}")

r, body2 = get("/wellness/motivated", token=admin_token, expect=200, name="GET /wellness/motivated #2 (cache)")
src2 = body2.get("source") if isinstance(body2, dict) else None
_record("/wellness/motivated 2nd call source ∈ {llm-cache, static, llm}", src2 in ("llm-cache", "static", "llm"), f"src2={src2}")

r, body = get("/wellness/lost", token=admin_token, expect=200, name="GET /wellness/lost")
_record("/wellness/lost non-empty quote+advice", isinstance(body, dict) and bool(body.get("quote")) and bool(body.get("advice")), "")

get("/wellness/joyful", token=admin_token, expect=404, name="GET /wellness/joyful → 404")

# ============================================================
# D) Friends + close + feed
# ============================================================
print("\n=== D) Friends + close + feed ===")
r, body = get("/friends", token=admin_token, expect=200, name="GET /friends admin")
friends = body.get("friends") if isinstance(body, dict) else []
has_is_close = all("is_close" in f for f in friends) if friends else True
_record("/friends rows have is_close field", has_is_close, f"n_friends={len(friends)}")

r = requests.post(f"{API}/friends/add", headers=_h(admin_token), json={"email": "luna@innfeel.app"}, timeout=30)
ok = r.status_code in (200, 409)
_record("admin /friends/add luna → 200 or 409", ok, f"status={r.status_code}")

if not LUNA_ID:
    r, body = get("/friends", token=admin_token, expect=200, name="GET /friends to find luna id")
    for f in (body.get("friends") if isinstance(body, dict) else []):
        if f.get("email") == "luna@innfeel.app":
            LUNA_ID = f["user_id"]
            break

if LUNA_ID:
    r, body = post(f"/friends/close/{LUNA_ID}", token=admin_token, expect=200, name="admin toggles luna close")
    _record("close toggle returns is_close field", isinstance(body, dict) and "is_close" in body, f"body={body}")
else:
    _record("admin toggles luna close", False, "no LUNA_ID")

post(f"/friends/close/{LUNA_ID or 'user_xxx'}", token=fresh_token, expect=403, name="free user toggles close → 403")

# luna drops today (clean slate) for feed test
delete("/moods/today", token=luna_token, expect=200, name="DELETE luna /moods/today")
post("/moods", token=luna_token, json_body={
    "word": "soft", "emotion": "calm", "intensity": 4, "privacy": "friends"
}, expect=200, name="luna POST /moods (calm friends)")

# admin re-drops today (mood for the rest of regression)
post("/moods", token=admin_token, json_body={
    "word": "alive", "emotion": "joy", "intensity": 6, "privacy": "friends"
}, expect=200, name="admin POST /moods (joy friends)")

r, body = get("/moods/feed", token=admin_token, expect=200, name="GET /moods/feed admin")
items = body.get("items", []) if isinstance(body, dict) else []
_record("/moods/feed has items[]", len(items) > 0, f"n_items={len(items)}")
if items:
    has_avatar_field = all("author_avatar_b64" in it for it in items)
    _record("/moods/feed items[] have author_avatar_b64 field", has_avatar_field, "")

# ============================================================
# E) Music search
# ============================================================
print("\n=== E) Music search ===")
r, body = get("/music/search", token=admin_token, params={"q": "ocean"}, expect=200, name="GET /music/search q=ocean (Pro admin)")
tracks = body.get("tracks", []) if isinstance(body, dict) else []
_record("/music/search returns tracks[]", len(tracks) > 0, f"n_tracks={len(tracks)}")
if tracks:
    t0 = tracks[0]
    has_keys = all(k in t0 for k in ("track_id", "name", "artist", "artwork_url", "preview_url", "source"))
    _record("track has all keys", has_keys, f"keys={list(t0.keys())}")
    _record("track source=='apple'", t0.get("source") == "apple", f"src={t0.get('source')}")
    _record("track preview_url is http(s)", str(t0.get("preview_url", "")).startswith("http"), f"url={str(t0.get('preview_url',''))[:60]}")

get("/music/search", token=fresh_token, params={"q": "ocean"}, expect=403, name="GET /music/search free user → 403")

r, body = get("/music/tracks", token=admin_token, expect=200, name="GET /music/tracks legacy")
_record("/music/tracks returns {tracks: []}", isinstance(body, dict) and isinstance(body.get("tracks"), list) and len(body["tracks"]) == 0, f"body={body}")

# ============================================================
# F) Admin endpoints
# ============================================================
print("\n=== F) Admin ===")
r, body = get("/admin/me", token=admin_token, expect=200, name="GET /admin/me admin")
_record("/admin/me admin is_admin=true", isinstance(body, dict) and body.get("is_admin") is True, f"body={body}")

r, body = get("/admin/me", token=fresh_token, expect=200, name="GET /admin/me fresh user")
_record("/admin/me non-admin is_admin=false", isinstance(body, dict) and body.get("is_admin") is False, f"body={body}")

post("/admin/grant-pro", token=admin_token, json_body={"email": "luna@innfeel.app", "days": 5, "note": "regression test"}, expect=200, name="admin grant-pro luna 5d")

r, body = get("/admin/pro-grants", token=admin_token, expect=200, name="GET /admin/pro-grants")
grants = body.get("grants", []) if isinstance(body, dict) else []
luna_active = any(g.get("granted_to_email") == "luna@innfeel.app" and g.get("is_active") is True for g in grants)
_record("/admin/pro-grants includes luna active", luna_active, f"n_grants={len(grants)}")

post("/admin/grant-pro", token=fresh_token, json_body={"email": "luna@innfeel.app", "days": 1}, expect=403, name="non-admin grant-pro → 403")

post("/admin/revoke-pro", token=admin_token, json_body={"email": "luna@innfeel.app"}, expect=200, name="admin revoke-pro luna")

r, body = get("/admin/users/search", token=admin_token, params={"q": "luna"}, expect=200, name="admin users/search q=luna")
matches = body.get("users", []) if isinstance(body, dict) else []
_record("admin users/search q=luna ≥ 1 result", len(matches) >= 1, f"n_matches={len(matches)}")

# ============================================================
# G) Stripe checkout
# ============================================================
print("\n=== G) Stripe checkout ===")
r, body = post("/payments/checkout", token=admin_token, json_body={}, expect=200, name="checkout {} (origin fallback)")
_record("checkout has url+session_id", isinstance(body, dict) and bool(body.get("url")) and bool(body.get("session_id")), f"url={(body.get('url') if isinstance(body,dict) else '')[:60]}")

r, body = post("/payments/checkout", token=admin_token, json_body={"origin_url": "https://example.com"}, expect=200, name="checkout origin=https://example.com")
_record("checkout has url+session_id (explicit origin)", isinstance(body, dict) and bool(body.get("url")) and bool(body.get("session_id")), "")

# ============================================================
# H) Messages
# ============================================================
print("\n=== H) Messages ===")
r, body = get("/messages/unread-count", token=admin_token, expect=200, name="GET /messages/unread-count admin")
_record("unread-count has total + conversations", isinstance(body, dict) and "total" in body and "conversations" in body, f"body={body}")

if LUNA_ID:
    post(f"/messages/with/{LUNA_ID}", token=admin_token, json_body={"text": "Hi from regression"}, expect=200, name=f"admin sends message to luna")
else:
    _record("admin sends message to luna", False, "no LUNA_ID")

r, body = get("/messages/conversations", token=luna_token, expect=200, name="luna /messages/conversations")
convs = body.get("conversations", []) if isinstance(body, dict) else []
admin_conv = next((c for c in convs if c.get("peer_id") == ADMIN_ID), None)
_record("luna sees admin conversation", admin_conv is not None, f"n_convs={len(convs)} admin_conv={bool(admin_conv)}")
if admin_conv:
    _record("luna unread > 0 in admin conv", (admin_conv.get("unread") or 0) > 0, f"unread={admin_conv.get('unread')}")

# ============================================================
# I) Comments + reactions
# ============================================================
print("\n=== I) Comments + reactions ===")
r, body = get("/moods/today", token=admin_token, expect=200, name="GET /moods/today admin (find mood_id)")
admin_mood = body.get("mood") if isinstance(body, dict) else None
admin_mood_id = admin_mood.get("mood_id") if admin_mood else None
admin_privacy = admin_mood.get("privacy") if admin_mood else None
print(f"  -> admin_mood_id={admin_mood_id}, privacy={admin_privacy}")

if not admin_mood_id:
    _record("comments+reactions setup", False, "no admin mood")
else:
    if admin_privacy == "private":
        delete("/moods/today", token=admin_token, expect=200, name="re-public admin mood: delete")
        r, body = post("/moods", token=admin_token, json_body={
            "word": "alive", "emotion": "joy", "intensity": 6, "privacy": "friends"
        }, expect=200, name="admin re-post public mood for comments")
        admin_mood_id = body.get("mood", {}).get("mood_id") if isinstance(body, dict) else None

    if admin_mood_id:
        post(f"/moods/{admin_mood_id}/comment", token=luna_token, json_body={"text": "Nice aura"}, expect=200, name="luna comments on admin mood")

        r, comments_body = get(f"/moods/{admin_mood_id}/comments", token=admin_token, expect=200, name="GET admin mood comments")
        comments = comments_body.get("comments", []) if isinstance(comments_body, dict) else []
        has_luna = any(c.get("text") == "Nice aura" for c in comments)
        _record("admin sees luna's comment on his mood", has_luna, f"n_comments={len(comments)}")

        post(f"/moods/{admin_mood_id}/react", token=luna_token, json_body={"emoji": "heart"}, expect=200, name="luna reacts heart on admin mood")

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
total = len(PASSED) + len(FAILED)
print(f"PASSED: {len(PASSED)} / {total}  ({100.0*len(PASSED)/max(1,total):.1f}%)")
print(f"FAILED: {len(FAILED)}")
if FAILED:
    print("\nFAILURES:")
    for n, info in FAILED:
        print(f"  - {n}  {info}")
sys.exit(0 if not FAILED else 1)
