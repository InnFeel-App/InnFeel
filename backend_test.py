"""Session 25 — Guided Journaling endpoints backend test.

Covers:
  • POST /api/journal/checkin
  • GET  /api/journal/today
  • GET  /api/journal/history
  • POST /api/journal/reflect
  • DELETE /api/journal/{kind}
  • Soft-refund on LLM failure
  • Regression on /api/coach/history
"""
import os
import sys
import time
import asyncio
import subprocess
from typing import Tuple

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_URL = "https://charming-wescoff-8.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"

LUNA = ("luna@innfeel.app", "demo1234")
RIO = ("rio@innfeel.app", "demo1234")
ADMIN = ("hello@innfeel.app", "admin123")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "test_database")

PASS = []
FAIL = []


def log_pass(msg: str):
    PASS.append(msg)
    print(f"  PASS  {msg}")


def log_fail(msg: str):
    FAIL.append(msg)
    print(f"  FAIL  {msg}")


def assert_eq(actual, expected, label):
    if actual == expected:
        log_pass(f"{label}: {actual!r}")
        return True
    log_fail(f"{label}: expected {expected!r} got {actual!r}")
    return False


def assert_truthy(actual, label):
    if actual:
        log_pass(f"{label}: {str(actual)[:100]}")
        return True
    log_fail(f"{label}: falsy ({actual!r})")
    return False


def login(client: httpx.Client, creds: Tuple[str, str]) -> str:
    email, pw = creds
    r = client.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"no token returned for {email}: {body}"
    client.headers.update({"Authorization": f"Bearer {token}"})
    client.cookies.clear()
    return token


def fresh_client() -> httpx.Client:
    return httpx.Client(timeout=60.0, follow_redirects=False)


async def _clean_today(user_email: str):
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    u = await db.users.find_one({"email": user_email})
    if not u:
        return 0
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    day_key = now.strftime("%Y-%m-%d")
    res = await db.journal_entries.delete_many({"user_id": u["user_id"], "day_key": day_key})
    return res.deleted_count


async def _today_entries(user_email: str):
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    u = await db.users.find_one({"email": user_email})
    if not u:
        return []
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    day_key = now.strftime("%Y-%m-%d")
    return [d async for d in db.journal_entries.find({"user_id": u["user_id"], "day_key": day_key})]


async def _coach_daily_count(user_email: str):
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    u = await db.users.find_one({"email": user_email})
    if not u:
        return 0
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    day_key = now.strftime("%Y-%m-%d")
    doc = await db.coach_limits.find_one({"user_id": u["user_id"], "kind": "daily", "day_key": day_key})
    return (doc or {}).get("count", 0)


def test_1_checkin_happy_path():
    print("\n=== TEST 1: POST /api/journal/checkin happy path ===")
    asyncio.run(_clean_today(LUNA[0]))

    with fresh_client() as c:
        r = c.post(f"{API}/journal/checkin", json={"kind": "morning", "answers": {"a": "b"}})
        assert_eq(r.status_code, 401, "no-auth → 401")

    with fresh_client() as c:
        login(c, LUNA)

        t0 = time.time()
        r = c.post(f"{API}/journal/checkin", json={
            "kind": "morning",
            "answers": {"sleep": "OK", "intentions": "Be kind"},
        })
        dt = time.time() - t0
        assert_eq(r.status_code, 200, f"morning checkin → 200 ({dt:.2f}s)")
        body = r.json()
        entry = body.get("entry", {})
        assert_eq(entry.get("kind"), "morning", "entry.kind")
        assert_truthy(entry.get("day_key"), "entry.day_key")
        assert_eq(entry.get("answers"), {"sleep": "OK", "intentions": "Be kind"}, "entry.answers")
        first_updated_at = entry.get("updated_at")
        assert_truthy(first_updated_at, "entry.updated_at present")

        docs = asyncio.run(_today_entries(LUNA[0]))
        morning_docs = [d for d in docs if d["kind"] == "morning"]
        assert_eq(len(morning_docs), 1, "DB: one morning doc")
        if morning_docs:
            assert_eq(morning_docs[0].get("answers"), {"sleep": "OK", "intentions": "Be kind"}, "DB answers map")

        time.sleep(1.2)
        r = c.post(f"{API}/journal/checkin", json={
            "kind": "morning",
            "answers": {"sleep": "Great", "intentions": "Move slowly"},
        })
        assert_eq(r.status_code, 200, "re-POST morning → 200")
        new_entry = r.json().get("entry", {})
        assert_eq(new_entry.get("answers"), {"sleep": "Great", "intentions": "Move slowly"}, "re-POST answers updated")
        second_updated_at = new_entry.get("updated_at")
        if first_updated_at and second_updated_at and second_updated_at > first_updated_at:
            log_pass(f"updated_at advanced ({first_updated_at} → {second_updated_at})")
        else:
            log_fail(f"updated_at did NOT advance ({first_updated_at} → {second_updated_at})")
        docs = asyncio.run(_today_entries(LUNA[0]))
        morning_docs = [d for d in docs if d["kind"] == "morning"]
        assert_eq(len(morning_docs), 1, "DB: still ONE morning doc (upsert not insert)")

        r = c.post(f"{API}/journal/checkin", json={"kind": "random", "answers": {"x": "y"}})
        assert_eq(r.status_code, 422, "kind=random → 422")

        r = c.post(f"{API}/journal/checkin", json={"kind": "evening", "answers": {}})
        assert_eq(r.status_code, 400, "empty answers + no note → 400")
        if r.status_code == 400:
            detail = r.json().get("detail", "")
            if "Write at least one answer" in detail:
                log_pass(f"400 detail msg matches: {detail!r}")
            else:
                log_fail(f"400 detail msg unexpected: {detail!r}")


def test_2_today():
    print("\n=== TEST 2: GET /api/journal/today ===")
    with fresh_client() as c:
        login(c, LUNA)

        r = c.get(f"{API}/journal/today")
        assert_eq(r.status_code, 200, "GET today → 200")
        body = r.json()
        assert_truthy(body.get("day_key"), "today.day_key")
        assert_truthy(body.get("morning"), "today.morning populated")
        assert_eq(body.get("evening"), None, "today.evening is null")

        r = c.post(f"{API}/journal/checkin", json={
            "kind": "evening",
            "answers": {"highlight": "Yes!"},
        })
        assert_eq(r.status_code, 200, "evening checkin → 200")

        r = c.get(f"{API}/journal/today")
        assert_eq(r.status_code, 200, "GET today (after evening) → 200")
        body = r.json()
        assert_truthy(body.get("morning"), "today.morning still populated")
        assert_truthy(body.get("evening"), "today.evening populated")
        if body.get("evening"):
            assert_eq(body["evening"].get("answers"), {"highlight": "Yes!"}, "evening.answers")


def test_3_history():
    print("\n=== TEST 3: GET /api/journal/history ===")
    with fresh_client() as c:
        login(c, LUNA)

        r = c.get(f"{API}/journal/history")
        assert_eq(r.status_code, 200, "GET history → 200")
        body = r.json()
        items = body.get("items", [])
        assert_truthy(isinstance(items, list), f"items is list (len={len(items)})")
        if len(items) >= 2:
            day_keys = [it.get("day_key") for it in items]
            if day_keys == sorted(day_keys, reverse=True):
                log_pass(f"items sorted by day_key DESC ({day_keys[:3]})")
            else:
                log_fail(f"items NOT sorted DESC: {day_keys[:5]}")
        else:
            log_pass(f"items.len={len(items)} (cannot test sort with <2)")

        r = c.get(f"{API}/journal/history?days=200")
        assert_eq(r.status_code, 200, "history?days=200 → 200 (no error, server caps)")

        r = c.get(f"{API}/journal/history?days=1")
        assert_eq(r.status_code, 200, "history?days=1 → 200")
        body = r.json()
        n = len(body.get("items", []))
        if n <= 1:
            log_pass(f"days=1 → {n} item(s) (≤1)")
        else:
            log_fail(f"days=1 → {n} items (expected ≤1)")


def test_4_reflect_pro_only():
    print("\n=== TEST 4: POST /api/journal/reflect (Pro only) ===")

    with fresh_client() as c:
        login(c, RIO)
        r = c.post(f"{API}/journal/reflect", json={"kind": "morning"})
        assert_eq(r.status_code, 402, "rio (Free) reflect → 402")
        if r.status_code == 402:
            detail = r.json().get("detail", "")
            if "Pro" in detail or "pro" in detail.lower():
                log_pass(f"402 detail mentions Pro: {detail!r}")
            else:
                log_fail(f"402 detail missing Pro mention: {detail!r}")

    with fresh_client() as c:
        login(c, LUNA)
        r1 = c.delete(f"{API}/journal/morning")
        assert_eq(r1.status_code, 200, "DELETE /journal/morning → 200")
        r2 = c.delete(f"{API}/journal/evening")
        assert_eq(r2.status_code, 200, "DELETE /journal/evening → 200")

        r = c.post(f"{API}/journal/reflect", json={"kind": "morning"})
        assert_eq(r.status_code, 404, "reflect with no entries → 404")
        if r.status_code == 404:
            detail = r.json().get("detail", "")
            if "No journal entries" in detail or "no journal entries" in detail.lower():
                log_pass(f"404 detail: {detail!r}")

        r = c.post(f"{API}/journal/checkin", json={
            "kind": "morning",
            "answers": {"sleep": "Restless", "intentions": "Soften shoulders, drink water, breathe before replying."},
        })
        assert_eq(r.status_code, 200, "re-post morning → 200")

        coach_count_before = asyncio.run(_coach_daily_count(LUNA[0]))
        print(f"  [info] coach daily count before reflect: {coach_count_before}")

        t0 = time.time()
        r = c.post(f"{API}/journal/reflect", json={"kind": "morning"})
        dt = time.time() - t0
        assert_eq(r.status_code, 200, f"reflect (morning) → 200 ({dt:.2f}s)")
        if r.status_code == 200:
            body = r.json()
            reflection = body.get("reflection", "")
            quota_left = body.get("quota_left")
            if isinstance(reflection, str) and len(reflection) > 30:
                log_pass(f"reflection non-empty len={len(reflection)} preview={reflection[:80]!r}")
            else:
                log_fail(f"reflection too short or wrong type: {reflection!r}")
            if isinstance(quota_left, int):
                log_pass(f"quota_left is int: {quota_left}")
            else:
                log_fail(f"quota_left wrong type: {quota_left!r}")

        docs = asyncio.run(_today_entries(LUNA[0]))
        morning_doc = next((d for d in docs if d["kind"] == "morning"), None)
        if morning_doc:
            assert_truthy(morning_doc.get("reflection"), "DB morning.reflection persisted")
            assert_truthy(morning_doc.get("reflected_at"), "DB morning.reflected_at persisted")
        else:
            log_fail("morning doc not found after reflect")

        coach_count_after = asyncio.run(_coach_daily_count(LUNA[0]))
        if coach_count_after == coach_count_before + 1:
            log_pass(f"coach_limits daily counter +1 ({coach_count_before} → {coach_count_after})")
        else:
            log_fail(f"coach_limits daily counter expected {coach_count_before+1}, got {coach_count_after}")


def test_5_soft_refund_on_llm_failure():
    print("\n=== TEST 5: Soft-refund on LLM failure ===")

    env_path = "/app/backend/.env"
    with open(env_path, "r") as f:
        original_env = f.read()

    real_key = "sk-emergent-9D26eE3272eC0781bB"
    bad_key = "sk-emergent-INVALID"

    corrupted = original_env.replace(f'EMERGENT_LLM_KEY="{real_key}"', f'EMERGENT_LLM_KEY="{bad_key}"')
    if corrupted == original_env:
        log_fail("Could not find EMERGENT_LLM_KEY=real value to corrupt")
        return
    with open(env_path, "w") as f:
        f.write(corrupted)
    print("  [setup] Corrupted EMERGENT_LLM_KEY, restarting backend...")
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], capture_output=True)
    time.sleep(6)

    try:
        with fresh_client() as c:
            login(c, LUNA)

            r = c.get(f"{API}/coach/history")
            assert_eq(r.status_code, 200, "coach/history → 200 (corrupted key, endpoint still up)")
            quota_before = None
            if r.status_code == 200:
                quota_before = r.json().get("quota_left")
                log_pass(f"quota_left before reflect (bad key): {quota_before}")

            r = c.post(f"{API}/journal/checkin", json={
                "kind": "morning",
                "answers": {"sleep": "test soft-refund", "intentions": "verify quota stays unchanged"},
            })
            if r.status_code != 200:
                log_fail(f"checkin failed under bad key: {r.status_code} {r.text[:100]}")
                return

            t0 = time.time()
            r = c.post(f"{API}/journal/reflect", json={"kind": "morning"})
            dt = time.time() - t0
            assert_eq(r.status_code, 200, f"reflect (bad key) → 200 fallback ({dt:.2f}s)")
            if r.status_code == 200:
                body = r.json()
                reflection = body.get("reflection", "")
                quota_after = body.get("quota_left")
                if "couldn't reach my words" in reflection.lower():
                    log_pass(f"fallback message present: {reflection[:100]!r}")
                else:
                    log_fail(f"fallback message NOT detected: {reflection[:200]!r}")

                if quota_before is not None and quota_after is not None:
                    if quota_after == quota_before:
                        log_pass(f"quota_left UNCHANGED ({quota_before}) — soft-refund works")
                    else:
                        log_fail(f"quota_left CHANGED ({quota_before} → {quota_after}) — soft-refund FAILED")
    finally:
        with open(env_path, "w") as f:
            f.write(original_env)
        print("  [cleanup] Restored EMERGENT_LLM_KEY, restarting backend...")
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], capture_output=True)
        time.sleep(6)
        try:
            r = httpx.get(f"{API}/auth/me", timeout=10.0)
            log_pass(f"backend back up after key restore (auth/me → {r.status_code})")
        except Exception as e:
            log_fail(f"backend NOT back up after key restore: {e}")


def test_6_delete():
    print("\n=== TEST 6: DELETE /api/journal/{kind} ===")
    with fresh_client() as c:
        login(c, LUNA)

        r = c.post(f"{API}/journal/checkin", json={
            "kind": "morning",
            "answers": {"sleep": "ok"},
        })
        assert_eq(r.status_code, 200, "ensure morning exists → 200")

        r = c.delete(f"{API}/journal/morning")
        assert_eq(r.status_code, 200, "DELETE /journal/morning → 200")
        if r.status_code == 200:
            body = r.json()
            assert_eq(body.get("ok"), True, "delete.ok=true")
            assert_eq(body.get("deleted"), 1, "delete.deleted=1")

        r = c.get(f"{API}/journal/today")
        if r.status_code == 200:
            assert_eq(r.json().get("morning"), None, "today.morning=null after delete")

        r = c.delete(f"{API}/journal/morning")
        assert_eq(r.status_code, 200, "DELETE morning again → 200")
        if r.status_code == 200:
            assert_eq(r.json().get("deleted"), 0, "delete.deleted=0 (idempotent)")

        r = c.delete(f"{API}/journal/random")
        assert_eq(r.status_code, 400, "DELETE /journal/random → 400")


def test_7_coach_regression():
    print("\n=== TEST 7: Regression on /api/coach/history ===")
    with fresh_client() as c:
        login(c, LUNA)
        r = c.get(f"{API}/coach/history")
        assert_eq(r.status_code, 200, "GET /coach/history → 200")
        if r.status_code == 200:
            body = r.json()
            assert_truthy(isinstance(body.get("items"), list), f"history.items is list (len={len(body.get('items', []))})")
            if body.get("tier") in ("free", "pro", "zen"):
                log_pass(f"history.tier valid: {body.get('tier')}")
            else:
                log_fail(f"history.tier invalid: {body.get('tier')!r}")


def main():
    print(f"Backend URL: {API}")
    print(f"Mongo: {MONGO_URL}/{DB_NAME}")
    test_1_checkin_happy_path()
    test_2_today()
    test_3_history()
    test_4_reflect_pro_only()
    test_5_soft_refund_on_llm_failure()
    test_6_delete()
    test_7_coach_regression()

    print("\n" + "=" * 70)
    print(f"RESULTS: {len(PASS)} pass, {len(FAIL)} fail")
    if FAIL:
        print("\nFAILURES:")
        for f in FAIL:
            print(f"  - {f}")
    print("=" * 70)
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
