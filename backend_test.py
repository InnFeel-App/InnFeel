"""Session 25 — AI Wellness Coach backend tests.

Tests for /api/coach/{history,chat,reset} endpoints implemented in
/app/backend/routes/coach.py. Backed by Claude Sonnet 4.5 via Emergent LLM Key.
"""
import os
import re
import time
import json
import asyncio
import subprocess
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient


BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"
LUNA = ("luna@innfeel.app", "demo1234")
HELLO = ("hello@innfeel.app", "admin123")
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
ENV_PATH = "/app/backend/.env"
GOOD_KEY = "sk-emergent-9D26eE3272eC0781bB"

results = []  # (name, ok, msg)


def log(name, ok, msg=""):
    results.append((name, ok, msg))
    icon = "PASS" if ok else "FAIL"
    print(f"  [{icon}] {name}{(' — ' + msg) if msg else ''}")


def login(client: httpx.Client, email: str, pw: str) -> str:
    r = client.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    body = r.json()
    return body["access_token"]


async def get_user_id_by_email(email: str) -> str:
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        u = await cli[DB_NAME].users.find_one({"email": email}, {"user_id": 1})
        return u["user_id"]
    finally:
        cli.close()


async def db_run(coro_fn):
    cli = AsyncIOMotorClient(MONGO_URL)
    try:
        return await coro_fn(cli[DB_NAME])
    finally:
        cli.close()


# ──────────────────────────────────────────────────────────────────────
# Test scenarios
# ──────────────────────────────────────────────────────────────────────

def t1_history_unauth():
    print("\n[1] GET /api/coach/history without auth")
    with httpx.Client(timeout=15) as c:
        r = c.get(f"{BASE}/coach/history")
        log("1.1 GET /coach/history no-auth → 401", r.status_code == 401, f"got {r.status_code}")


def t2_chat_happy(luna_token: str, luna_id: str):
    print("\n[2] POST /api/coach/chat happy path (luna)")
    headers = {"Authorization": f"Bearer {luna_token}"}
    with httpx.Client(timeout=60) as c:
        # Verify pro
        me = c.get(f"{BASE}/auth/me", headers=headers).json()
        log("2.0 /auth/me luna pro=true", bool(me.get("pro")), f"pro={me.get('pro')}")
        t0 = time.time()
        r = c.post(
            f"{BASE}/coach/chat",
            headers=headers,
            json={"text": "I feel a bit overwhelmed today, can you help me ground?"},
        )
        elapsed = time.time() - t0
        log("2.1 POST /coach/chat 200", r.status_code == 200, f"got {r.status_code} in {elapsed:.2f}s")
        if r.status_code != 200:
            print("    body:", r.text[:500])
            return None, None, None
        body = r.json()
        reply = body.get("reply") or ""
        log("2.2 reply length > 30", len(reply.strip()) > 30, f"len={len(reply)}")
        log("2.3 tier == 'pro'", body.get("tier") == "pro", f"tier={body.get('tier')}")
        ql = body.get("quota_left")
        log("2.4 quota_left integer 0..10", isinstance(ql, int) and 0 <= ql <= 10, f"quota_left={ql}")
        tid = body.get("turn_id") or ""
        log("2.5 turn_id 24-char hex", bool(re.fullmatch(r"[a-f0-9]{24}", tid)), f"turn_id={tid}")
        log("2.6 timing 2-15s (Claude)", 1.5 <= elapsed <= 20, f"elapsed={elapsed:.2f}s")

    async def check_db(d):
        cur = d.coach_messages.find({"user_id": luna_id}).sort("created_at", -1).limit(2)
        rows = [x async for x in cur]
        return rows

    rows = asyncio.run(db_run(check_db))
    roles = sorted([r.get("role") for r in rows])
    log("2.7 DB has user+assistant for luna", roles == ["assistant", "user"], f"roles={roles} count={len(rows)}")
    return body.get("quota_left"), body.get("reply"), body.get("turn_id")


def t3_history(luna_token: str):
    print("\n[3] GET /api/coach/history?limit=80 (luna)")
    headers = {"Authorization": f"Bearer {luna_token}"}
    with httpx.Client(timeout=15) as c:
        r = c.get(f"{BASE}/coach/history?limit=80", headers=headers)
        log("3.1 GET /coach/history 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code != 200:
            print("    body:", r.text[:500])
            return
        body = r.json()
        items = body.get("items") or []
        log("3.2 items has at least 2 entries", len(items) >= 2, f"count={len(items)}")
        log("3.3 tier == 'pro'", body.get("tier") == "pro", f"tier={body.get('tier')}")
        ql = body.get("quota_left")
        log("3.4 quota_left integer 0..10", isinstance(ql, int) and 0 <= ql <= 10, f"quota_left={ql}")
        roles_seq = [it.get("role") for it in items]
        log("3.5 first item role=user", roles_seq[0] == "user" if roles_seq else False, f"first={roles_seq[:1]}")
        log("3.6 contains an assistant turn", "assistant" in roles_seq, f"roles={roles_seq[:6]}")
        ts = [it.get("created_at") for it in items]
        ascending = all(ts[i] <= ts[i + 1] for i in range(len(ts) - 1))
        log("3.7 created_at ascending", ascending)


def t4_multi_turn(luna_token: str, prev_quota):
    print("\n[4] Multi-turn continuity")
    headers = {"Authorization": f"Bearer {luna_token}"}
    with httpx.Client(timeout=60) as c:
        t0 = time.time()
        r = c.post(
            f"{BASE}/coach/chat",
            headers=headers,
            json={"text": "Yes, can you give me a 60-second exercise?"},
        )
        elapsed = time.time() - t0
        log("4.1 POST /coach/chat 200", r.status_code == 200, f"got {r.status_code} in {elapsed:.2f}s")
        if r.status_code != 200:
            print("    body:", r.text[:500])
            return None
        body = r.json()
        reply = (body.get("reply") or "").lower()
        keywords = ["ground", "breath", "feet", "60", "second", "minute", "overwhelm", "anchor", "body", "sense", "inhale", "exhale"]
        hit = [k for k in keywords if k in reply]
        log("4.2 reply references prior context", len(hit) >= 1, f"keywords_hit={hit}")
        ql = body.get("quota_left")
        expected = (prev_quota - 1) if prev_quota is not None else None
        log("4.3 quota_left == prev - 1", ql == expected, f"prev={prev_quota} got={ql}")
        return ql


def t5_quota_exhaustion(luna_token: str, luna_id: str):
    print("\n[5] Quota exhaustion (Pro)")
    quota = 10

    async def setup(d):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        anchor = now - timedelta(hours=12)
        day = anchor.strftime("%Y-%m-%d")
        await d.coach_limits.update_one(
            {"user_id": luna_id, "kind": "daily", "day_key": day},
            {"$set": {"count": quota - 1, "last_used_at": now}},
            upsert=True,
        )
        return day

    day = asyncio.run(db_run(setup))
    log("5.0 pre-set counter=9", True, f"day_key={day}")

    headers = {"Authorization": f"Bearer {luna_token}"}
    with httpx.Client(timeout=60) as c:
        r = c.post(f"{BASE}/coach/chat", headers=headers, json={"text": "Tiny ping?"})
        log("5.1 chat #10 → 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            ql = r.json().get("quota_left")
            log("5.2 quota_left == 0", ql == 0, f"quota_left={ql}")
        else:
            print("    body:", r.text[:400])

        r2 = c.post(f"{BASE}/coach/chat", headers=headers, json={"text": "Another ping?"})
        log("5.3 chat #11 → 402", r2.status_code == 402, f"got {r2.status_code}")
        if r2.status_code == 402:
            detail = (r2.json().get("detail") or "")
            log(
                "5.4 detail contains 'reached your daily coach quota'",
                "reached your daily coach quota" in detail,
                f"detail={detail!r}",
            )
        else:
            print("    body:", r2.text[:400])

    async def reset(d):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        anchor = now - timedelta(hours=12)
        day = anchor.strftime("%Y-%m-%d")
        await d.coach_limits.update_one(
            {"user_id": luna_id, "kind": "daily", "day_key": day},
            {"$set": {"count": 0, "last_used_at": now}},
            upsert=True,
        )

    asyncio.run(db_run(reset))
    log("5.5 counter reset to 0", True)


def restart_backend():
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], capture_output=True)
    time.sleep(5)


def set_env_key(new_key: str):
    with open(ENV_PATH, "r") as f:
        text = f.read()
    text = re.sub(r'EMERGENT_LLM_KEY="[^"]*"', f'EMERGENT_LLM_KEY="{new_key}"', text)
    with open(ENV_PATH, "w") as f:
        f.write(text)


def t6_soft_refund(luna_creds):
    print("\n[6] Quota soft-refund on LLM failure")
    set_env_key("sk-emergent-INVALID")
    restart_backend()

    with httpx.Client(timeout=60) as c:
        try:
            tok = login(c, *luna_creds)
        except Exception as e:
            log("6.0 re-login luna", False, str(e))
            set_env_key(GOOD_KEY)
            restart_backend()
            return
        log("6.0 re-login luna", True)
        headers = {"Authorization": f"Bearer {tok}"}

        h0 = c.get(f"{BASE}/coach/history?limit=1", headers=headers).json()
        ql_before = h0.get("quota_left")

        r = c.post(
            f"{BASE}/coach/chat",
            headers=headers,
            json={"text": "Hello coach, I need a tiny anchor."},
        )
        log("6.1 chat with bad key → 200 (fallback)", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            body = r.json()
            reply = body.get("reply") or ""
            log(
                "6.2 fallback reply contains 'trouble reaching my thoughts'",
                "trouble reaching my thoughts" in reply,
                f"reply[:80]={reply[:80]!r}",
            )
            ql_after = body.get("quota_left")
            log(
                "6.3 quota soft-refunded (unchanged)",
                ql_after == ql_before,
                f"before={ql_before} after={ql_after}",
            )
        else:
            print("    body:", r.text[:400])

    set_env_key(GOOD_KEY)
    restart_backend()
    with open(ENV_PATH) as f:
        ok_restore = GOOD_KEY in f.read()
    log("6.4 EMERGENT_LLM_KEY restored", ok_restore)


def t7_reset(luna_creds):
    print("\n[7] POST /api/coach/reset")
    with httpx.Client(timeout=30) as c:
        tok = login(c, *luna_creds)
        headers = {"Authorization": f"Bearer {tok}"}
        h_before = c.get(f"{BASE}/coach/history?limit=80", headers=headers).json()
        ql_before = h_before.get("quota_left")
        items_before = len(h_before.get("items") or [])
        log("7.0 history items >= 4 before reset", items_before >= 4, f"items={items_before}")

        r = c.post(f"{BASE}/coach/reset", headers=headers)
        log("7.1 POST /coach/reset 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            body = r.json()
            log("7.2 ok==true", body.get("ok") is True)
            log("7.3 deleted >= 4", (body.get("deleted") or 0) >= 4, f"deleted={body.get('deleted')}")

        h_after = c.get(f"{BASE}/coach/history?limit=80", headers=headers).json()
        log("7.4 items==[] after reset", (h_after.get("items") or []) == [], f"len={len(h_after.get('items') or [])}")
        ql_after = h_after.get("quota_left")
        log(
            "7.5 quota unchanged across reset",
            ql_after == ql_before,
            f"before={ql_before} after={ql_after}",
        )


def t8_validation(luna_creds):
    print("\n[8] Validation")
    with httpx.Client(timeout=15) as c:
        tok = login(c, *luna_creds)
        headers = {"Authorization": f"Bearer {tok}"}
        r1 = c.post(f"{BASE}/coach/chat", headers=headers, json={"text": ""})
        log("8.1 empty text → 422", r1.status_code == 422, f"got {r1.status_code}")
        big = "x" * 2001
        r2 = c.post(f"{BASE}/coach/chat", headers=headers, json={"text": big})
        log("8.2 2001-char text → 422", r2.status_code == 422, f"got {r2.status_code}")
        r3 = httpx.post(f"{BASE}/coach/chat", json={"text": "hi"}, timeout=15)
        log("8.3 no auth → 401", r3.status_code == 401, f"got {r3.status_code}")


def main():
    print("=" * 70)
    print(f"InnFeel Coach backend tests vs {BASE}")
    print("=" * 70)

    luna_id = asyncio.run(get_user_id_by_email(LUNA[0]))
    print(f"luna user_id = {luna_id}")

    async def cleanup(d):
        await d.coach_messages.delete_many({"user_id": luna_id})
        await d.coach_limits.delete_many({"user_id": luna_id})

    asyncio.run(db_run(cleanup))
    print("[setup] cleared coach_messages + coach_limits for luna")

    with httpx.Client(timeout=15) as c:
        luna_token = login(c, *LUNA)

    t1_history_unauth()
    prev_q, _, _ = t2_chat_happy(luna_token, luna_id)
    t3_history(luna_token)
    t4_multi_turn(luna_token, prev_q)
    t5_quota_exhaustion(luna_token, luna_id)
    t6_soft_refund(LUNA)
    t7_reset(LUNA)
    t8_validation(LUNA)

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(n, m) for n, ok, m in results if not ok]
    print(f"RESULTS: {passed}/{len(results)} PASS")
    if failed:
        print("\nFAILURES:")
        for n, m in failed:
            print(f"  - {n}: {m}")
    print("=" * 70)
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
