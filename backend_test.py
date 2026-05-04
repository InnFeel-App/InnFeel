"""
Session 20 Path C item B2 — Backend test for GET /api/moods/insights.

Tests per review request:
  1) Happy path (luna) — shape + ready:true + tone validation
  2) Cold-start fresh user — ready:false, needed>=1, empty insights
  3) Auth required — 401
  4) /moods/stats regression (luna)
  5) Spot check: /auth/me (admin) + /share/reel/{mood_id} (luna)
"""
import os
import re
import sys
import time
import json
import httpx
from pathlib import Path

# Resolve base URL from the frontend env
FRONTEND_ENV = Path("/app/frontend/.env")
BASE_URL = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'") + "/api"
        break
assert BASE_URL, "Could not read EXPO_PUBLIC_BACKEND_URL"
print(f"BASE_URL = {BASE_URL}")

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

TONES_ALLOWED = {"positive", "neutral", "warning"}
IONICON_RE = re.compile(r"^[a-z][a-z0-9-]*$")  # alphabetic lowercase with dashes

results = []  # list of (ok: bool, label: str, detail: str)


def record(ok, label, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
    results.append((ok, label, detail))


def _client():
    # Do NOT persist cookies between calls — tests pass Bearer tokens and the
    # server prefers cookies over Authorization when both are set. A fresh
    # client per call eliminates that pitfall observed in prior sessions.
    return httpx.Client(timeout=30.0, follow_redirects=True)


def login(email, password):
    with _client() as c:
        r = c.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token")
    uid = (body.get("user") or {}).get("user_id") or body.get("user_id")
    assert tok and uid, f"login missing token/user_id: {body}"
    return tok, uid


def auth_headers(tok):
    return {"Authorization": f"Bearer {tok}"}


# -------------------------------------------------------------------------
# 1) HAPPY PATH (luna) — /moods/insights returns ready:true with valid cards
# -------------------------------------------------------------------------
def test_happy_path():
    print("\n=== 1) Happy path — luna /moods/insights ===")
    tok, uid = login(LUNA_EMAIL, LUNA_PASS)
    with _client() as c:
        r = c.get(f"{BASE_URL}/moods/insights", headers=auth_headers(tok))
    record(r.status_code == 200, "Status 200", f"got {r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        return
    body = r.json()

    record("insights" in body, "has key 'insights'", str(list(body.keys())))
    record("ready" in body, "has key 'ready'", str(list(body.keys())))
    record("computed_for" in body, "has key 'computed_for'", str(list(body.keys())))

    record(body.get("ready") is True, "ready is True", f"ready={body.get('ready')}")
    record(isinstance(body.get("insights"), list), "insights is a list", f"type={type(body.get('insights')).__name__}")

    # Card validation
    cards = body.get("insights") or []
    print(f"  (luna has {len(cards)} insight cards)")
    ionicon_found = False
    for idx, card in enumerate(cards):
        for key in ("id", "icon", "title", "tone"):
            v = card.get(key)
            record(
                isinstance(v, str) and v.strip() != "",
                f"card[{idx}].{key} is non-empty string",
                f"got {v!r}",
            )
        tone = card.get("tone")
        record(
            tone in TONES_ALLOWED,
            f"card[{idx}].tone in {TONES_ALLOWED}",
            f"tone={tone!r}",
        )
        icon = card.get("icon") or ""
        if IONICON_RE.match(icon):
            ionicon_found = True
        # value/subtitle optional — just check type if present
        if "value" in card and card["value"] is not None:
            record(isinstance(card["value"], str), f"card[{idx}].value is string or absent", f"got {type(card['value']).__name__}")
        if "subtitle" in card and card["subtitle"] is not None:
            record(isinstance(card["subtitle"], str), f"card[{idx}].subtitle is string or absent", f"got {type(card['subtitle']).__name__}")

    if cards:
        record(ionicon_found, "At least one card has a valid Ionicons name pattern",
               f"icons={[c.get('icon') for c in cards]}")
    else:
        record(True, "Empty insights array on ready:true is acceptable (no patterns detected)", "")

    # computed_for is ISO timestamp
    cf = body.get("computed_for")
    try:
        from datetime import datetime
        datetime.fromisoformat(cf.replace("Z", "+00:00") if cf and cf.endswith("Z") else cf)
        record(True, "computed_for is ISO-parseable", f"value={cf}")
    except Exception as e:
        record(False, "computed_for is ISO-parseable", f"value={cf} err={e}")

    # Log the cards for visibility
    print("  cards:", json.dumps(cards, indent=2)[:1200])


# -------------------------------------------------------------------------
# 2) COLD-START — fresh user gets ready:false, needed>=1
# -------------------------------------------------------------------------
def test_cold_start():
    print("\n=== 2) Cold-start — fresh user /moods/insights ===")
    ts = int(time.time())
    email = f"coldstart_{ts}@mailinator.com"
    password = "ColdStart#2026!"
    name = "Cold Start"

    with _client() as c:
        r = c.post(f"{BASE_URL}/auth/register", json={
            "email": email,
            "password": password,
            "name": name,
            "lang": "en",
            "terms_accepted": True,
        })
    record(r.status_code == 200, "Register fresh user 200", f"status={r.status_code} body={r.text[:150]}")
    if r.status_code != 200:
        return
    body = r.json()
    tok = body.get("access_token")
    uid = (body.get("user") or {}).get("user_id")
    record(bool(tok and uid), "Token + user_id present", "")

    # Query insights
    with _client() as c:
        r = c.get(f"{BASE_URL}/moods/insights", headers=auth_headers(tok))
    record(r.status_code == 200, "GET /moods/insights 200", f"status={r.status_code}")
    if r.status_code == 200:
        body2 = r.json()
        record(body2.get("ready") is False, "ready is False", f"ready={body2.get('ready')}")
        record(isinstance(body2.get("needed"), int) and body2["needed"] >= 1,
               "needed is int >= 1", f"needed={body2.get('needed')}")
        msg = body2.get("message")
        record(isinstance(msg, str) and msg.strip() != "",
               "message is non-empty string", f"message={msg!r}")
        record(body2.get("insights") == [], "insights is empty list", f"insights={body2.get('insights')}")

    # Cleanup — DELETE /account
    with _client() as c:
        r = c.request(
            "DELETE",
            f"{BASE_URL}/account",
            json={"password": password, "confirm": "DELETE"},
            headers=auth_headers(tok),
        )
    record(r.status_code == 200, "Cleanup DELETE /account 200", f"status={r.status_code} body={r.text[:150]}")


# -------------------------------------------------------------------------
# 3) AUTH REQUIRED — 401 without Authorization
# -------------------------------------------------------------------------
def test_auth_required():
    print("\n=== 3) Auth required — no Authorization ===")
    with _client() as c:
        r = c.get(f"{BASE_URL}/moods/insights")
    record(r.status_code == 401, "GET /moods/insights with no auth → 401", f"status={r.status_code} body={r.text[:150]}")


# -------------------------------------------------------------------------
# 4) REGRESSION — /moods/stats (luna)
# -------------------------------------------------------------------------
def test_stats_regression():
    print("\n=== 4) /moods/stats regression (luna) ===")
    tok, _ = login(LUNA_EMAIL, LUNA_PASS)
    with _client() as c:
        r = c.get(f"{BASE_URL}/moods/stats", headers=auth_headers(tok))
    record(r.status_code == 200, "GET /moods/stats 200", f"status={r.status_code}")
    if r.status_code != 200:
        return
    body = r.json()
    for k in ("streak", "drops_this_week", "dominant", "distribution", "by_weekday"):
        record(k in body, f"has key '{k}'", f"keys={list(body.keys())}")


# -------------------------------------------------------------------------
# 5) SPOT CHECK — /auth/me (admin) + /share/reel/{mood_id} (luna)
# -------------------------------------------------------------------------
def test_spot_checks():
    print("\n=== 5) Spot-check: /auth/me admin + /share/reel/{mood_id} luna ===")

    # /auth/me admin
    admin_tok, _ = login(ADMIN_EMAIL, ADMIN_PASS)
    with _client() as c:
        r = c.get(f"{BASE_URL}/auth/me", headers=auth_headers(admin_tok))
    record(r.status_code == 200, "GET /auth/me (admin) 200", f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        user_obj = body.get("user") if "user" in body else body
        record(user_obj.get("email") == ADMIN_EMAIL, "admin /auth/me email matches",
               f"email={user_obj.get('email')}")

    # /share/reel as luna
    luna_tok, luna_uid = login(LUNA_EMAIL, LUNA_PASS)

    with _client() as c:
        r = c.get(f"{BASE_URL}/moods/today", headers=auth_headers(luna_tok))
    mood_id = None
    if r.status_code == 200:
        mood = (r.json() or {}).get("mood")
        if mood:
            mood_id = mood.get("mood_id")

    if not mood_id:
        with _client() as c:
            r = c.post(
                f"{BASE_URL}/moods",
                headers=auth_headers(luna_tok),
                json={"emotion": "calm", "word": "gentle", "intensity": 2, "privacy": "friends"},
            )
        if r.status_code == 200:
            mood_id = ((r.json() or {}).get("mood") or {}).get("mood_id")

    record(bool(mood_id), "luna has a mood for today", f"mood_id={mood_id}")

    if mood_id:
        with _client() as c:
            r = c.post(f"{BASE_URL}/share/reel/{mood_id}", headers=auth_headers(luna_tok), timeout=60.0)
        record(r.status_code == 200, "POST /share/reel/<mood_id> (luna) 200",
               f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            body = r.json()
            record(body.get("ok") is True, "share body.ok is True", f"body={json.dumps(body)[:200]}")


def main():
    try:
        test_happy_path()
    except Exception as e:
        record(False, "test_happy_path raised", str(e))
    try:
        test_cold_start()
    except Exception as e:
        record(False, "test_cold_start raised", str(e))
    try:
        test_auth_required()
    except Exception as e:
        record(False, "test_auth_required raised", str(e))
    try:
        test_stats_regression()
    except Exception as e:
        record(False, "test_stats_regression raised", str(e))
    try:
        test_spot_checks()
    except Exception as e:
        record(False, "test_spot_checks raised", str(e))

    total = len(results)
    passed = sum(1 for ok, *_ in results if ok)
    failed = [(l, d) for ok, l, d in results if not ok]
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed}/{total} PASS")
    if failed:
        print(f"\n{len(failed)} FAIL(S):")
        for l, d in failed:
            print(f"  - {l}" + (f" ({d})" if d else ""))
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
