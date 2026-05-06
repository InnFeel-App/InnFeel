"""Backend test — Friends invite-code endpoints (privacy-safe share flow).

Tests new endpoints in /app/backend/routes/friends.py:
  • GET  /api/friends/my-code
  • POST /api/friends/add-by-code

Plus privacy regression on /api/friends and legacy /api/friends/add.
"""
import asyncio
import os
import re
import time
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

LUNA_EMAIL = "luna@innfeel.app"
LUNA_PW = "demo1234"
RIO_EMAIL = "rio@innfeel.app"
RIO_PW = "demo1234"
ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PW = "admin123"

CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")

_passed = 0
_failed = 0
_failures: list[str] = []


def check(cond, label):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ✅ {label}")
    else:
        _failed += 1
        _failures.append(label)
        print(f"  ❌ {label}")


def login(client: httpx.Client, email: str, password: str) -> str:
    t0 = time.time()
    r = client.post(f"{API}/auth/login", json={"email": email, "password": password})
    dt = (time.time() - t0) * 1000
    print(f"  [login {email}] {r.status_code} in {dt:.0f}ms")
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in login response: {data}"
    return token


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def get_user_doc(email: str) -> Optional[dict]:
    m = AsyncIOMotorClient(MONGO_URL)
    try:
        u = await m[DB_NAME].users.find_one({"email": email.lower()})
        return u
    finally:
        m.close()


async def count_friendships(a: str, b: str) -> int:
    m = AsyncIOMotorClient(MONGO_URL)
    try:
        return await m[DB_NAME].friendships.count_documents({"user_id": a, "friend_id": b})
    finally:
        m.close()


async def delete_friendship(a: str, b: str) -> int:
    m = AsyncIOMotorClient(MONGO_URL)
    try:
        r = await m[DB_NAME].friendships.delete_many({
            "$or": [
                {"user_id": a, "friend_id": b},
                {"user_id": b, "friend_id": a},
            ]
        })
        return r.deleted_count
    finally:
        m.close()


def main():
    global _passed, _failed
    print(f"\n=== Backend tests: Friends invite-code endpoints ===")
    print(f"API: {API}")
    print(f"MONGO: {MONGO_URL} / {DB_NAME}\n")

    with httpx.Client(timeout=30) as c_luna, httpx.Client(timeout=30) as c_rio:
        # Logins (separate clients prevent cookie bleed between identities;
        # backend appears to prefer Set-Cookie over Authorization Bearer when
        # both are present, which would otherwise mis-route subsequent calls).
        luna_token = login(c_luna, LUNA_EMAIL, LUNA_PW)
        rio_token = login(c_rio, RIO_EMAIL, RIO_PW)
        c = c_luna  # default client for luna-flavored calls below

        # Pre: fetch user ids from DB
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        luna_doc = loop.run_until_complete(get_user_doc(LUNA_EMAIL))
        rio_doc = loop.run_until_complete(get_user_doc(RIO_EMAIL))
        assert luna_doc and rio_doc, "seed users missing"
        luna_id = luna_doc["user_id"]
        rio_id = rio_doc["user_id"]
        print(f"  luna_id={luna_id} rio_id={rio_id}")

        # ---------------------------------------------------------------
        # 1) GET /api/friends/my-code idempotency
        # ---------------------------------------------------------------
        print("\n[1] GET /api/friends/my-code idempotency")

        # 1a — no auth (use a fresh client so no session cookies leak)
        with httpx.Client(timeout=30) as cc:
            t0 = time.time()
            r = cc.get(f"{API}/friends/my-code")
            dt = (time.time() - t0) * 1000
            print(f"  no-auth: {r.status_code} in {dt:.0f}ms  body={r.text[:120]}")
            check(r.status_code == 401, "GET /friends/my-code without auth → 401")

        # 1b — luna first call
        t0 = time.time()
        r1 = c.get(f"{API}/friends/my-code", headers=auth(luna_token))
        dt = (time.time() - t0) * 1000
        print(f"  luna 1st: {r1.status_code} in {dt:.0f}ms  body={r1.text[:160]}")
        check(r1.status_code == 200, "GET /friends/my-code (luna) 1st → 200")
        code1 = None
        if r1.status_code == 200:
            body1 = r1.json()
            code1 = body1.get("code")
            check(isinstance(code1, str), "body.code is string")
            check(isinstance(code1, str) and len(code1) == 8, f"code length == 8 (got {len(code1) if isinstance(code1,str) else 'n/a'})")
            check(isinstance(code1, str) and bool(CODE_RE.match(code1)),
                  f"code matches /^[A-HJ-NP-Z2-9]{{8}}$/ (got {code1!r})")

        # 1c — second call returns SAME code
        t0 = time.time()
        r2 = c.get(f"{API}/friends/my-code", headers=auth(luna_token))
        dt = (time.time() - t0) * 1000
        print(f"  luna 2nd: {r2.status_code} in {dt:.0f}ms  body={r2.text[:160]}")
        check(r2.status_code == 200, "GET /friends/my-code (luna) 2nd → 200")
        if r2.status_code == 200:
            code2 = r2.json().get("code")
            check(code2 == code1, f"idempotent: second code equals first ({code1!r} == {code2!r})")

        # 1d — persisted in Mongo
        luna_doc_fresh = loop.run_until_complete(get_user_doc(LUNA_EMAIL))
        stored = luna_doc_fresh.get("invite_code")
        print(f"  db.users.invite_code for luna = {stored!r}")
        check(stored == code1, "users.invite_code persisted and matches API code")

        # ---------------------------------------------------------------
        # 2) POST /api/friends/add-by-code happy path
        # ---------------------------------------------------------------
        print("\n[2] POST /api/friends/add-by-code happy path")

        # 2a — rio fetches his code (must use rio's client to avoid cookie bleed)
        r = c_rio.get(f"{API}/friends/my-code", headers=auth(rio_token))
        print(f"  rio my-code: {r.status_code} {r.text[:160]}")
        check(r.status_code == 200, "rio GET /friends/my-code → 200")
        rio_code = r.json()["code"] if r.status_code == 200 else None
        check(bool(rio_code and CODE_RE.match(rio_code)), f"rio code valid shape ({rio_code!r})")

        # 2b — first, make sure luna and rio are NOT friends (reset if needed)
        pre_del = loop.run_until_complete(delete_friendship(luna_id, rio_id))
        print(f"  pre-clean removed {pre_del} existing friendship rows")

        # 2c — luna calls add-by-code {code: rio_code}
        t0 = time.time()
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": rio_code})
        dt = (time.time() - t0) * 1000
        print(f"  luna add-by-code: {r.status_code} in {dt:.0f}ms  body={r.text[:240]}")
        check(r.status_code == 200, "POST /friends/add-by-code (luna) → 200")
        if r.status_code == 200:
            body = r.json()
            check(body.get("ok") is True, "response.ok == true")
            check(body.get("already_friends") is False, "response.already_friends == false")
            friend = body.get("friend") or {}
            check(friend.get("user_id") == rio_id, f"friend.user_id == rio_id ({friend.get('user_id')!r})")
            check(isinstance(friend.get("name"), str) and len(friend.get("name", "")) > 0,
                  f"friend.name present ({friend.get('name')!r})")
            check("avatar_color" in friend, "friend.avatar_color key present")
            # Privacy: email MUST NOT leak
            check("email" not in friend, "friend.email NOT present in response")

        # 2d — verify both directions in DB
        ab = loop.run_until_complete(count_friendships(luna_id, rio_id))
        ba = loop.run_until_complete(count_friendships(rio_id, luna_id))
        print(f"  db friendships: luna->rio={ab}  rio->luna={ba}")
        check(ab == 1, f"friendships (luna→rio) exists exactly once (got {ab})")
        check(ba == 1, f"friendships (rio→luna) exists exactly once (got {ba})")

        # 2e — re-call same code, already_friends:true, no duplicate rows
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": rio_code})
        print(f"  re-call add-by-code: {r.status_code} {r.text[:200]}")
        check(r.status_code == 200, "re-call POST /friends/add-by-code → 200")
        if r.status_code == 200:
            b = r.json()
            check(b.get("ok") is True, "re-call ok == true")
            check(b.get("already_friends") is True, "re-call already_friends == true")

        ab2 = loop.run_until_complete(count_friendships(luna_id, rio_id))
        ba2 = loop.run_until_complete(count_friendships(rio_id, luna_id))
        print(f"  db friendships after re-call: luna->rio={ab2}  rio->luna={ba2}")
        check(ab2 == ab, f"re-call did not duplicate luna→rio rows ({ab}→{ab2})")
        check(ba2 == ba, f"re-call did not duplicate rio→luna rows ({ba}→{ba2})")

        # ---------------------------------------------------------------
        # 3) Error paths on POST /api/friends/add-by-code
        # ---------------------------------------------------------------
        print("\n[3] POST /api/friends/add-by-code error paths")

        # 3a — invalid code
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": "ZZZZZZZZ"})
        print(f"  invalid ZZZZZZZZ: {r.status_code} {r.text[:160]}")
        check(r.status_code == 404, "invalid code → 404")
        try:
            check(r.json().get("detail") == "Invalid invite code", "detail == 'Invalid invite code'")
        except Exception:
            _failed += 1; _failures.append("detail json parse")

        # 3b — own code
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": code1})
        print(f"  own code: {r.status_code} {r.text[:160]}")
        check(r.status_code == 400, "own code → 400")
        try:
            check(r.json().get("detail") == "That's your own code", "detail == \"That's your own code\"")
        except Exception:
            _failed += 1; _failures.append("own-code detail parse")

        # 3c — too short (length 3) → 422
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": "ABC"})
        print(f"  length 3: {r.status_code} {r.text[:160]}")
        check(r.status_code == 422, "length 3 → 422 (Pydantic min_length=4)")

        # 3d — too long (length 17) → 422
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": "A" * 17})
        print(f"  length 17: {r.status_code} {r.text[:160]}")
        check(r.status_code == 422, "length 17 → 422 (Pydantic max_length=16)")

        # 3e — lowercase accepted (backend uppercases input). Since luna+rio are
        # already friends, expect 200 with already_friends:true.
        r = c.post(f"{API}/friends/add-by-code", headers=auth(luna_token), json={"code": rio_code.lower()})
        print(f"  lowercase rio code: {r.status_code} {r.text[:200]}")
        check(r.status_code == 200, "lowercase code still works (uppercased server-side) → 200")
        if r.status_code == 200:
            check(r.json().get("already_friends") is True, "lowercase → already_friends true")

        # 3f — no auth (fresh client to avoid cookie leak)
        with httpx.Client(timeout=30) as cc:
            r = cc.post(f"{API}/friends/add-by-code", json={"code": rio_code})
            print(f"  no-auth: {r.status_code} {r.text[:160]}")
            check(r.status_code == 401, "POST /friends/add-by-code without auth → 401")

        # ---------------------------------------------------------------
        # 4) Privacy regression: /api/friends MUST NOT expose email
        # ---------------------------------------------------------------
        print("\n[4] Privacy regression — GET /api/friends")
        r = c.get(f"{API}/friends", headers=auth(luna_token))
        print(f"  /friends: {r.status_code}")
        check(r.status_code == 200, "GET /friends (luna) → 200")
        if r.status_code == 200:
            body = r.json()
            friends = body.get("friends") or []
            print(f"  friends count = {len(friends)}")
            any_email = any(("email" in f) for f in friends)
            check(not any_email, "NO friend row contains 'email' field")
            for f in friends:
                # Sanity: required fields should still be there
                check("user_id" in f, f"friend row has user_id (id={f.get('user_id')})")

        # ---------------------------------------------------------------
        # 5) Legacy /api/friends/add (email flow) — no regression
        # ---------------------------------------------------------------
        print("\n[5] Legacy /api/friends/add no-regression")
        # Reset the luna↔rio friendship rows first
        removed = loop.run_until_complete(delete_friendship(luna_id, rio_id))
        print(f"  pre-clean removed {removed} friendship rows")

        t0 = time.time()
        r = c.post(f"{API}/friends/add", headers=auth(luna_token), json={"email": RIO_EMAIL})
        dt = (time.time() - t0) * 1000
        print(f"  /friends/add: {r.status_code} in {dt:.0f}ms  body={r.text[:240]}")
        check(r.status_code == 200, "POST /friends/add with email → 200")
        if r.status_code == 200:
            body = r.json()
            check(body.get("ok") is True, "legacy ok == true")
            f = body.get("friend") or {}
            check(f.get("user_id") == rio_id, "legacy friend.user_id == rio_id")
            # Legacy endpoint still includes email in response (that's the
            # current contract of /api/friends/add). Just sanity-check shape.
            check("email" in f, "legacy /friends/add response still carries friend.email (documented)")

        # DB confirmation
        ab3 = loop.run_until_complete(count_friendships(luna_id, rio_id))
        ba3 = loop.run_until_complete(count_friendships(rio_id, luna_id))
        print(f"  db after legacy add: luna->rio={ab3}  rio->luna={ba3}")
        check(ab3 == 1 and ba3 == 1, "legacy /friends/add created both directions")

        # ---------------------------------------------------------------
        # Done
        # ---------------------------------------------------------------
        loop.close()

    print("\n=== Summary ===")
    total = _passed + _failed
    print(f"Passed: {_passed}/{total}")
    if _failures:
        print("Failures:")
        for f in _failures:
            print(f"  - {f}")
    print("===============\n")
    return _failed == 0


if __name__ == "__main__":
    ok = main()
    raise SystemExit(0 if ok else 1)
