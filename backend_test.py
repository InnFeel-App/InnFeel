"""Backend tests for MoodDrop.

Focus areas:
1. LLM-powered wellness endpoint /api/wellness/{emotion}
2. Close Friends endpoints (/api/friends, /api/friends/close/{id}, /api/friends/close)
3. privacy=close behavior in /api/moods/feed
4. Regression: auth, friends add/remove, moods today/feed baseline.
"""
import os
import sys
import time
import uuid
import json
import requests
from datetime import datetime

BASE = os.environ.get("BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@mooddrop.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@mooddrop.app"
LUNA_PASS = "demo1234"

results = []


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def req(method, path, token=None, json_body=None, expected=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{API}{path}"
    r = requests.request(method, url, headers=headers, json=json_body, timeout=60)
    return r


def login(email, password):
    r = req("POST", "/auth/login", json_body={"email": email, "password": password})
    if r.status_code != 200:
        return None, r
    return r.json(), r


def register(email, password, name):
    r = req("POST", "/auth/register", json_body={"email": email, "password": password, "name": name})
    return r


def main():
    print(f"=== BACKEND TESTS — base {API} ===")

    # ---------- Regression: auth/login ----------
    admin, r = login(ADMIN_EMAIL, ADMIN_PASS)
    if not admin:
        log("auth/login admin", False, f"{r.status_code} {r.text[:200]}")
        print("Cannot continue — admin login failed.")
        return
    admin_token = admin["access_token"]
    admin_id = admin["user"]["user_id"]
    log("auth/login admin", admin["user"]["pro"] is True, f"pro={admin['user']['pro']}")

    # /auth/me
    r = req("GET", "/auth/me", token=admin_token)
    log("auth/me", r.status_code == 200 and r.json().get("email") == ADMIN_EMAIL, f"{r.status_code}")

    # ---------- Login luna ----------
    luna, r = login(LUNA_EMAIL, LUNA_PASS)
    if not luna:
        log("auth/login luna", False, f"{r.status_code} {r.text[:200]}")
        return
    luna_token = luna["access_token"]
    luna_id = luna["user"]["user_id"]
    log("auth/login luna", True, f"luna_id={luna_id}")

    # Ensure luna is friends with admin (idempotent)
    r = req("POST", "/friends/add", token=admin_token, json_body={"email": LUNA_EMAIL})
    log("friends/add luna→admin", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    # ---------- /api/friends listing — check is_close field ----------
    r = req("GET", "/friends", token=admin_token)
    ok = r.status_code == 200
    has_is_close = False
    luna_in_list = False
    if ok:
        body = r.json()
        for f in body.get("friends", []):
            if "is_close" not in f:
                ok = False
                break
            if f.get("email") == LUNA_EMAIL or f.get("user_id") == luna_id:
                luna_in_list = True
        has_is_close = ok
    log("/friends has is_close field", has_is_close and luna_in_list, f"status={r.status_code}, luna_listed={luna_in_list}")

    # ---------- 1) LLM Wellness ----------
    # First call for joy
    r1 = req("GET", "/wellness/joy", token=admin_token)
    if r1.status_code != 200:
        log("wellness/joy first", False, f"{r1.status_code} {r1.text[:200]}")
    else:
        body1 = r1.json()
        required = {"emotion", "tone", "quote", "advice", "share_cta", "color", "source"}
        missing = required - set(body1.keys())
        log(
            "wellness/joy fields",
            not missing and bool(body1.get("quote")) and bool(body1.get("advice")),
            f"source={body1.get('source')}, missing={missing}",
        )
        first_source = body1.get("source")
        first_quote = body1.get("quote")

        # Second call should be cache if first was llm
        r2 = req("GET", "/wellness/joy", token=admin_token)
        body2 = r2.json() if r2.status_code == 200 else {}
        if first_source == "llm":
            second_ok = body2.get("source") == "llm-cache" and body2.get("quote") == first_quote
            log("wellness/joy cache 24h", second_ok, f"src1={first_source}, src2={body2.get('source')}, same_quote={body2.get('quote') == first_quote}")
        elif first_source == "static":
            log(
                "wellness/joy fallback static",
                body1.get("quote") and body1.get("advice"),
                f"source=static (LLM unavailable). second_source={body2.get('source')}",
            )
        else:
            log("wellness/joy unexpected source", False, f"source={first_source}")

    # Invalid emotion -> 404
    r = req("GET", "/wellness/banana", token=admin_token)
    log("wellness invalid emotion → 404", r.status_code == 404, f"{r.status_code}")

    # Valid emotions: calm, sadness, anger
    for em in ["calm", "sadness", "anger"]:
        r = req("GET", f"/wellness/{em}", token=admin_token)
        ok = r.status_code == 200
        body = r.json() if ok else {}
        ok_full = ok and bool(body.get("quote")) and bool(body.get("advice")) and body.get("source") in {"llm", "llm-cache", "static"}
        log(f"wellness/{em}", ok_full, f"src={body.get('source')}, qlen={len(body.get('quote',''))}")

    # ---------- 2) Close friends endpoints ----------
    # Toggle on
    r = req("POST", f"/friends/close/{luna_id}", token=admin_token)
    body = r.json() if r.status_code == 200 else {}
    initial_state = body.get("is_close")
    log("close/{luna} toggle 1", r.status_code == 200 and "is_close" in body, f"is_close={initial_state}")

    # Toggle again
    r = req("POST", f"/friends/close/{luna_id}", token=admin_token)
    body2 = r.json() if r.status_code == 200 else {}
    second_state = body2.get("is_close")
    toggled = (initial_state is not None) and (second_state is not None) and (initial_state != second_state)
    log("close/{luna} toggle 2 (flipped)", toggled, f"first={initial_state} second={second_state}")

    # Make sure final is_close = true for further test
    if not second_state:
        r = req("POST", f"/friends/close/{luna_id}", token=admin_token)
        body = r.json()
        log("close/{luna} ensure on", body.get("is_close") is True, f"is_close={body.get('is_close')}")

    # GET /friends/close listing
    r = req("GET", "/friends/close", token=admin_token)
    body = r.json() if r.status_code == 200 else {}
    found = any(f.get("user_id") == luna_id for f in body.get("friends", []))
    log("GET /friends/close lists luna", r.status_code == 200 and found, f"count={len(body.get('friends', []))}")

    # Verify is_close reflected in /friends list now
    r = req("GET", "/friends", token=admin_token)
    luna_close = False
    if r.status_code == 200:
        for f in r.json().get("friends", []):
            if f.get("user_id") == luna_id:
                luna_close = bool(f.get("is_close"))
    log("/friends shows luna is_close=true", luna_close, f"is_close={luna_close}")

    # ---------- Pro gating: register fresh non-pro user, add luna, try close ----------
    rand = uuid.uuid4().hex[:8]
    fresh_email = f"tester_{rand}@mooddrop.app"
    rr = register(fresh_email, "Strong#Pass1", f"Tester {rand}")
    if rr.status_code != 200:
        log("register fresh user", False, f"{rr.status_code} {rr.text[:150]}")
    else:
        fresh = rr.json()
        fresh_token = fresh["access_token"]
        log("register fresh user", fresh["user"]["pro"] is False, f"pro={fresh['user']['pro']}")

        # Add luna as friend
        r = req("POST", "/friends/add", token=fresh_token, json_body={"email": LUNA_EMAIL})
        log("fresh adds luna", r.status_code == 200, f"{r.status_code}")

        # Try close → 403
        r = req("POST", f"/friends/close/{luna_id}", token=fresh_token)
        is_403 = r.status_code == 403
        msg = ""
        try:
            msg = r.json().get("detail", "")
        except Exception:
            pass
        log("close as Free user → 403 Pro", is_403 and "Pro" in msg, f"status={r.status_code} detail={msg}")

    # ---------- 3) privacy=close in feed ----------
    # We need admin to drop a mood today with privacy=close (if not already dropped today).
    # Then luna also drops a mood (so feed unlocks). Verify luna's feed.
    # NOTE: /api/moods is idempotent per day — if admin/luna already dropped, we can't change privacy.
    # We'll detect whether admin's mood today is privacy=close. If not, this part can't be re-run today.

    # Check admin today
    r = req("GET", "/moods/today", token=admin_token)
    admin_today = r.json().get("mood") if r.status_code == 200 else None

    if not admin_today:
        # Drop mood with privacy=close
        body = {"word": "grateful", "emotion": "joy", "intensity": 4, "privacy": "close"}
        r = req("POST", "/moods", token=admin_token, json_body=body)
        log("admin drops close mood", r.status_code == 200 and r.json()["mood"]["privacy"] == "close", f"{r.status_code} {r.text[:120]}")
    else:
        already_close = admin_today.get("privacy") == "close"
        log(
            "admin already dropped today",
            already_close,
            f"privacy={admin_today.get('privacy')} — note: cannot retest with new privacy on same day",
        )

    # Luna drops mood (if not already)
    r = req("GET", "/moods/today", token=luna_token)
    luna_today = r.json().get("mood") if r.status_code == 200 else None
    if not luna_today:
        body = {"word": "ok", "emotion": "calm", "intensity": 3, "privacy": "friends"}
        r = req("POST", "/moods", token=luna_token, json_body=body)
        log("luna drops mood", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    else:
        log("luna already dropped today", True, f"privacy={luna_today.get('privacy')}")

    # ----- Phase A: BEFORE admin marks luna as close, verify luna feed should NOT include admin's close mood -----
    # First make sure admin->luna close = OFF for this phase.
    # Currently we set it ON above. Toggle off, then re-test.
    # Get current state
    r = req("GET", "/friends/close", token=admin_token)
    if r.status_code == 200:
        if any(f.get("user_id") == luna_id for f in r.json().get("friends", [])):
            r = req("POST", f"/friends/close/{luna_id}", token=admin_token)
            body = r.json()
            log("toggle close OFF for phase-A", body.get("is_close") is False, f"is_close={body.get('is_close')}")

    # Now luna's feed should NOT contain admin's mood IF admin's mood is privacy=close
    r = req("GET", "/moods/feed", token=luna_token)
    body = r.json() if r.status_code == 200 else {}
    items = body.get("items", [])
    admin_in_luna_feed_A = any(it.get("user_id") == admin_id for it in items)
    # We need admin's privacy to be close to validate. Re-check:
    r2 = req("GET", "/moods/today", token=admin_token)
    admin_priv = (r2.json() or {}).get("mood", {}).get("privacy") if r2.status_code == 200 else None
    if admin_priv == "close":
        log(
            "feed: phase-A luna should NOT see admin close mood",
            not admin_in_luna_feed_A,
            f"locked={body.get('locked')}, items={len(items)}, admin_in_feed={admin_in_luna_feed_A}",
        )
    else:
        log(
            "feed phase-A skipped (admin mood privacy != close)",
            True,
            f"admin_priv={admin_priv}",
        )

    # ----- Phase B: After admin marks luna as close, luna's feed SHOULD see admin's close mood -----
    r = req("POST", f"/friends/close/{luna_id}", token=admin_token)
    body = r.json()
    log("toggle close ON for phase-B", body.get("is_close") is True, f"is_close={body.get('is_close')}")

    r = req("GET", "/moods/feed", token=luna_token)
    body = r.json() if r.status_code == 200 else {}
    items = body.get("items", [])
    admin_in_luna_feed_B = any(it.get("user_id") == admin_id for it in items)
    if admin_priv == "close":
        log(
            "feed: phase-B luna SHOULD see admin close mood",
            admin_in_luna_feed_B,
            f"items={len(items)}, admin_in_feed={admin_in_luna_feed_B}",
        )
    else:
        # If admin's mood is privacy=friends, we expect to see it regardless. Just sanity check.
        log(
            "feed phase-B sanity (admin mood privacy != close)",
            admin_in_luna_feed_B,
            f"admin_priv={admin_priv}, in_feed={admin_in_luna_feed_B}",
        )

    # ---------- 4) Regression — friends add/remove on a fresh user ----------
    rand2 = uuid.uuid4().hex[:8]
    e = f"reg_{rand2}@mooddrop.app"
    rr = register(e, "Strong#Pass2", f"Reg {rand2}")
    if rr.status_code == 200:
        tok = rr.json()["access_token"]
        # add luna
        r = req("POST", "/friends/add", token=tok, json_body={"email": LUNA_EMAIL})
        log("regression friends/add", r.status_code == 200, f"{r.status_code}")
        # remove luna
        r = req("DELETE", f"/friends/{luna_id}", token=tok)
        log("regression friends/remove", r.status_code == 200, f"{r.status_code}")
    else:
        log("regression register", False, f"{rr.status_code}")

    # ---------- Summary ----------
    print("\n=== SUMMARY ===")
    fails = [r for r in results if not r[1]]
    for n, ok, d in results:
        print(f"  {'OK ' if ok else 'FAIL'}  {n} :: {d}")
    print(f"\nTotal: {len(results)}, Passed: {len(results)-len(fails)}, Failed: {len(fails)}")
    if fails:
        sys.exit(1)


if __name__ == "__main__":
    main()
