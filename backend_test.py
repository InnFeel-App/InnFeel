"""Backend tests for P2 transactional emails feature.

Covers:
  1) Welcome email on /auth/verify-email success (non-blocking, idempotent)
  2) /notifications/prefs extended with weekly_recap
  3) /admin/send-weekly-recap admin tool
  4) Regression sanity spot check
"""
import asyncio
import hashlib
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

# ---- Config ---------------------------------------------------------------
FRONTEND_ENV = Path("/app/frontend/.env")
BACKEND_URL = ""
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BACKEND_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
API = f"{BACKEND_URL}/api"
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL not found"

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PW = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PW = "demo1234"

# Mongo (direct access for setting a known OTP + cleanup)
BACKEND_ENV = Path("/app/backend/.env")
MONGO_URL = ""
DB_NAME = "test_database"
for line in BACKEND_ENV.read_text().splitlines():
    if line.startswith("MONGO_URL="):
        MONGO_URL = line.split("=", 1)[1].strip().strip('"')
    elif line.startswith("DB_NAME="):
        DB_NAME = line.split("=", 1)[1].strip().strip('"')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

RESULTS: list[tuple[str, bool, str]] = []


def log(name: str, ok: bool, detail: str = ""):
    RESULTS.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name} :: {detail[:280]}")


def _fresh_client() -> httpx.AsyncClient:
    """Every request uses a fresh cookie jar so Bearer tokens are deterministic."""
    return httpx.AsyncClient(timeout=30.0, base_url=API)


async def _login(c: httpx.AsyncClient, email: str, password: str) -> str:
    r = await c.post("/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["access_token"]


def auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def _read_backend_log_tail(lines: int = 800) -> str:
    out = ""
    for path in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
        if os.path.exists(path):
            try:
                res = subprocess.run(
                    ["tail", "-n", str(lines), path],
                    capture_output=True, text=True, timeout=5,
                )
                out += res.stdout + "\n"
            except Exception:
                pass
    return out


# =================================================================
# TEST 1 — Welcome email on /auth/verify-email success
# =================================================================
async def test_welcome_email():
    test_email = f"qa_p2_{uuid.uuid4().hex[:10]}@innfeel.app"
    test_pw = "Welcome-PW-42!"
    test_name = "Noemie Welcome"

    async with _fresh_client() as c:
        r = await c.post("/auth/register", json={
            "email": test_email,
            "password": test_pw,
            "name": test_name,
            "lang": "fr",
            "terms_accepted": True,
        })
    if r.status_code != 200:
        log("1.register-fresh-user", False, f"status={r.status_code} body={r.text[:300]}")
        return
    j = r.json()
    user_id = j.get("user", {}).get("user_id")
    access_token = j.get("access_token")
    log("1.register-fresh-user", True,
        f"user_id={user_id} email_verified_at={j.get('user', {}).get('email_verified_at')}")

    # Verify users.lang was persisted as 'fr' (check DB directly — sanitize_user doesn't expose it)
    u_doc = await db.users.find_one({"user_id": user_id})
    lang_val = u_doc.get("lang") if u_doc else None
    log("1.users.lang persisted == 'fr'", lang_val == "fr", f"lang={lang_val!r}")

    # Patch the OTP hash to a known code so we can complete verification deterministically.
    # (Resend HTTP API may send the real email; we can't read the inbox here, and the
    #  '[dev]' log line is only emitted when Resend FAILS.)
    known_code = "246801"
    patched = await db.email_verifications.update_one(
        {"user_id": user_id},
        {"$set": {
            "code_hash": hashlib.sha256(known_code.encode()).hexdigest(),
            "attempts": 0,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }},
    )
    log("1.email_verifications patched", patched.modified_count == 1,
        f"modified={patched.modified_count}")

    # Prime: welcome_email_sent_at should NOT already be set
    pre = await db.users.find_one({"user_id": user_id}, {"welcome_email_sent_at": 1})
    log("1.pre-verify welcome_email_sent_at absent",
        (pre or {}).get("welcome_email_sent_at") is None,
        f"pre_value={(pre or {}).get('welcome_email_sent_at')}")

    # POST /auth/verify-email — this is where send_welcome_email fires
    async with _fresh_client() as c:
        r = await c.post(
            "/auth/verify-email",
            json={"code": known_code},
            headers=auth(access_token),
        )
    if r.status_code != 200:
        log("1.verify-email 200", False, f"status={r.status_code} body={r.text[:300]}")
        return
    jv = r.json()
    vu = jv.get("user", {})
    log("1.verify-email 200", True,
        f"already_verified={jv.get('already_verified')} email_verified_at={vu.get('email_verified_at')}")
    log("1.email_verified_at populated on returned user",
        bool(vu.get("email_verified_at")),
        f"value={vu.get('email_verified_at')}")

    # Check users.email_verified_at in DB
    u_verified = await db.users.find_one({"user_id": user_id})
    log("1.users.email_verified_at stamped in DB",
        u_verified is not None and u_verified.get("email_verified_at") is not None,
        f"value={u_verified.get('email_verified_at') if u_verified else None}")

    # Grace period for the async welcome_email_sent_at write
    await asyncio.sleep(0.6)
    u_after = await db.users.find_one({"user_id": user_id}, {"welcome_email_sent_at": 1})
    wel = (u_after or {}).get("welcome_email_sent_at")
    # Per spec: ok==True (Resend success) OR ok==False (Resend failed in dev) are both acceptable;
    # stamp is only written on True. Either way the endpoint must return 200. We record outcome.
    log("1.welcome_email_sent_at stamping outcome",
        True,  # informational — both branches are valid
        f"welcome_email_sent_at={wel} (set => Resend OK; None => Resend failed, endpoint still 200)")

    # Informational: scan logs for send trace
    log_tail = await _read_backend_log_tail(lines=600)
    mentions = [tok for tok in
                ("Resend send failed", "Welcome email send failed",
                 "RESEND_API_KEY missing", "[dev] Verification code")
                if tok in log_tail]
    log("1.welcome-email log trace (info)", True,
        f"log keywords observed={mentions}")

    # Re-trigger /auth/verify-email → already_verified path, no duplicate welcome email
    async with _fresh_client() as c:
        r2 = await c.post(
            "/auth/verify-email",
            json={"code": known_code},
            headers=auth(access_token),
        )
    ok2 = r2.status_code == 200 and r2.json().get("already_verified") is True
    log("1.re-trigger verify-email → already_verified",
        ok2, f"status={r2.status_code} body={r2.text[:200]}")

    u_after2 = await db.users.find_one({"user_id": user_id}, {"welcome_email_sent_at": 1})
    wel2 = (u_after2 or {}).get("welcome_email_sent_at")
    same = wel2 == wel
    log("1.welcome_email_sent_at unchanged on re-verify (no duplicate)",
        same, f"first={wel} second={wel2}")

    # Cleanup — delete the test user via DELETE /account
    async with _fresh_client() as c:
        r3 = await c.request(
            "DELETE",
            "/account",
            json={"password": test_pw, "confirm": "DELETE"},
            headers=auth(access_token),
        )
    log("1.cleanup DELETE /account",
        r3.status_code == 200 and r3.json().get("ok") is True,
        f"status={r3.status_code} body={r3.text[:200]}")

    # Double-check user is gone
    gone = await db.users.find_one({"user_id": user_id})
    log("1.cleanup DB row deleted",
        gone is None, f"still_present={gone is not None}")


# =================================================================
# TEST 2 — /notifications/prefs extended with weekly_recap
# =================================================================
async def test_notif_prefs_weekly_recap():
    async with _fresh_client() as c:
        tok = await _login(c, LUNA_EMAIL, LUNA_PW)

    # First make sure any prior state is cleared so the default-True branch holds.
    await db.users.update_one(
        {"email": LUNA_EMAIL},
        {"$unset": {"notif_prefs.weekly_recap": ""}},
    )

    async with _fresh_client() as c:
        r = await c.get("/notifications/prefs", headers=auth(tok))
    prefs = (r.json() or {}).get("prefs", {})
    log("2.GET prefs initial 200",
        r.status_code == 200, f"keys={list(prefs.keys())}")
    log("2.weekly_recap default == True",
        prefs.get("weekly_recap") is True,
        f"weekly_recap={prefs.get('weekly_recap')}")

    # Existing keys still present and default True
    for k in ("reminder", "reaction", "message", "friend"):
        v = prefs.get(k)
        log(f"2.existing key '{k}' default True",
            v is True, f"{k}={v}")

    # Flip to False
    async with _fresh_client() as c:
        r = await c.post(
            "/notifications/prefs",
            json={"weekly_recap": False},
            headers=auth(tok),
        )
    log("2.POST prefs weekly_recap=false → 200 {ok:true}",
        r.status_code == 200 and r.json().get("ok") is True,
        f"status={r.status_code} body={r.text[:160]}")

    async with _fresh_client() as c:
        r = await c.get("/notifications/prefs", headers=auth(tok))
    prefs2 = (r.json() or {}).get("prefs", {})
    log("2.GET reflects weekly_recap=false",
        prefs2.get("weekly_recap") is False,
        f"weekly_recap={prefs2.get('weekly_recap')}")

    # Restore default True
    async with _fresh_client() as c:
        r = await c.post(
            "/notifications/prefs",
            json={"weekly_recap": True},
            headers=auth(tok),
        )
    log("2.POST prefs weekly_recap=true (restore) → 200",
        r.status_code == 200 and r.json().get("ok") is True,
        f"status={r.status_code}")

    async with _fresh_client() as c:
        r = await c.get("/notifications/prefs", headers=auth(tok))
    log("2.restore confirmed",
        r.status_code == 200 and r.json()["prefs"].get("weekly_recap") is True,
        f"weekly_recap={r.json().get('prefs', {}).get('weekly_recap')}")


# =================================================================
# TEST 3 — /admin/send-weekly-recap
# =================================================================
async def test_admin_send_weekly_recap():
    async with _fresh_client() as c:
        admin_tok = await _login(c, ADMIN_EMAIL, ADMIN_PW)
    async with _fresh_client() as c:
        luna_tok = await _login(c, LUNA_EMAIL, LUNA_PW)

    # Admin with valid email
    async with _fresh_client() as c:
        r = await c.post(
            "/admin/send-weekly-recap",
            json={"email": LUNA_EMAIL},
            headers=auth(admin_tok),
        )
    if r.status_code != 200:
        log("3.admin → luna 200", False, f"status={r.status_code} body={r.text[:300]}")
    else:
        j = r.json()
        log("3.admin → luna 200",
            isinstance(j.get("ok"), bool) and j.get("email") == LUNA_EMAIL,
            f"body={j}")

    # Non-admin (luna) → 403 "Admin only"
    async with _fresh_client() as c:
        r = await c.post(
            "/admin/send-weekly-recap",
            json={"email": LUNA_EMAIL},
            headers=auth(luna_tok),
        )
    log("3.non-admin → 403 'Admin only'",
        r.status_code == 403 and "Admin" in r.text,
        f"status={r.status_code} body={r.text[:200]}")

    # Admin with missing email → 400
    async with _fresh_client() as c:
        r = await c.post(
            "/admin/send-weekly-recap",
            json={},
            headers=auth(admin_tok),
        )
    log("3.admin missing email → 400",
        r.status_code == 400,
        f"status={r.status_code} body={r.text[:200]}")

    # Admin with noexist user → 404 "No such user"
    async with _fresh_client() as c:
        r = await c.post(
            "/admin/send-weekly-recap",
            json={"email": "noexist@example.com"},
            headers=auth(admin_tok),
        )
    log("3.admin noexist → 404 'No such user'",
        r.status_code == 404 and "No such user" in r.text,
        f"status={r.status_code} body={r.text[:200]}")


# =================================================================
# TEST 4 — Regression sanity
# =================================================================
async def test_regression():
    async with _fresh_client() as c:
        admin_tok = await _login(c, ADMIN_EMAIL, ADMIN_PW)
    async with _fresh_client() as c:
        luna_tok = await _login(c, LUNA_EMAIL, LUNA_PW)

    async with _fresh_client() as c:
        r = await c.get("/auth/me", headers=auth(admin_tok))
    log("4.GET /auth/me (admin)",
        r.status_code == 200 and r.json().get("email") == ADMIN_EMAIL,
        f"status={r.status_code} email={r.json().get('email') if r.status_code==200 else '-'}")

    async with _fresh_client() as c:
        r = await c.get("/moods/today", headers=auth(luna_tok))
    log("4.GET /moods/today (luna)",
        r.status_code == 200 and "mood" in r.json(),
        f"status={r.status_code} body={r.text[:160]}")

    async with _fresh_client() as c:
        r = await c.get("/friends", headers=auth(luna_tok))
    ok = r.status_code == 200
    friends_list = None
    if ok:
        js = r.json()
        # tolerate either {friends:[...]} or raw list
        if isinstance(js, dict) and isinstance(js.get("friends"), list):
            friends_list = js["friends"]
        elif isinstance(js, list):
            friends_list = js
        else:
            ok = False
    log("4.GET /friends (luna)",
        ok and friends_list is not None,
        f"status={r.status_code} friends_len={len(friends_list) if friends_list is not None else '-'}")

    async with _fresh_client() as c:
        r = await c.get("/messages/unread-count", headers=auth(luna_tok))
    log("4.GET /messages/unread-count (luna)",
        r.status_code == 200 and "total" in r.json() and "conversations" in r.json(),
        f"status={r.status_code} body={r.text[:160]}")


async def main():
    print(f"Backend: {API}\n")
    await test_welcome_email()
    print()
    await test_notif_prefs_weekly_recap()
    print()
    await test_admin_send_weekly_recap()
    print()
    await test_regression()
    print()

    total = len(RESULTS)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print("=" * 70)
    print(f"RESULT: {passed}/{total} passed")
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAIL  {name}  ::  {detail[:300]}")
    return passed == total


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
