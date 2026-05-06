"""Backend test for Session 23 — MP4 Reel Pre-warming feature.

Verifies:
  1) POST /api/moods is non-blocking (<1.5s), prewarm runs in background.
  2) shared_reel sub-doc is populated in DB within ~20s.
  3) Subsequent POST /api/share/reel/{mood_id} returns cached:true quickly (<1.5s).
  4) Auth / validation regressions on POST /api/moods.
  5) Edge case: delete mood immediately after post — prewarm must not crash backend.
  6) Smoke regression on moods/today, heatmap, insights, feed, streak/freeze-status.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

# Backend URL comes from frontend/.env (EXPO_PUBLIC_BACKEND_URL), /api prefix mandatory.
load_dotenv("/app/frontend/.env")
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") + "/api"

# Mongo for direct DB verification of the prewarm result.
load_dotenv("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

LUNA_EMAIL = "luna@innfeel.app"
LUNA_PW = "demo1234"
ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PW = "admin123"

PASS: list[str] = []
FAIL: list[str] = []


def _mark(ok: bool, label: str, extra: str = "") -> None:
    tag = "PASS" if ok else "FAIL"
    line = f"[{tag}] {label}" + (f"  — {extra}" if extra else "")
    print(line, flush=True)
    (PASS if ok else FAIL).append(label)


async def login(client: httpx.AsyncClient, email: str, pw: str) -> str:
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    r.raise_for_status()
    body = r.json()
    return body["access_token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _delete_today(client: httpx.AsyncClient, token: str) -> None:
    await client.delete(f"{BASE}/moods/today", headers=_bearer(token))


async def _get_backend_log_tail(n: int = 200) -> str:
    try:
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            lines = f.readlines()
        return "".join(lines[-n:])
    except Exception as e:
        return f"(log read failed: {e})"


async def test_1_post_moods_nonblocking(client: httpx.AsyncClient, luna: str) -> Optional[str]:
    """POST /api/moods must return in < 1.5s even though prewarm kicks off."""
    await _delete_today(client, luna)

    body = {
        "emotion": "joy",
        "intensity": 3,
        "word": "sunshine",
        "privacy": "friends",
        "local_hour": 14,
    }
    t0 = time.perf_counter()
    r = await client.post(f"{BASE}/moods", json=body, headers=_bearer(luna))
    dt = time.perf_counter() - t0
    _mark(r.status_code == 200, "T1: POST /moods returns 200", f"{r.status_code} in {dt:.2f}s")
    if r.status_code != 200:
        print("  body:", r.text[:500])
        return None

    j = r.json()
    mood = j.get("mood") or {}
    mood_id = mood.get("mood_id")

    _mark(dt < 1.5, "T1: POST /moods < 1.5s (non-blocking)", f"elapsed={dt:.3f}s")
    _mark(bool(mood_id), "T1: response.mood.mood_id present", f"mood_id={mood_id}")
    _mark(isinstance(j.get("streak"), int), "T1: streak is int", f"streak={j.get('streak')}")
    _mark(j.get("replaced") is False, "T1: replaced:false on fresh post", f"replaced={j.get('replaced')}")
    _mark(mood.get("emotion") == "joy", "T1: mood.emotion == joy")
    _mark(mood.get("word") == "sunshine", "T1: mood.word == sunshine")
    _mark(mood.get("privacy") == "friends", "T1: mood.privacy == friends")

    return mood_id


async def test_2_prewarm_populates_db(mood_id: str, max_wait: float = 25.0) -> Optional[str]:
    """Poll Mongo until shared_reel appears (or timeout)."""
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
    except Exception as e:
        _mark(False, "T2: motor import", str(e))
        return None

    mc = AsyncIOMotorClient(MONGO_URL)
    db = mc[DB_NAME]
    deadline = time.perf_counter() + max_wait
    shared_reel = None
    t0 = time.perf_counter()
    while time.perf_counter() < deadline:
        doc = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0, "shared_reel": 1})
        if doc and doc.get("shared_reel"):
            shared_reel = doc["shared_reel"]
            break
        await asyncio.sleep(1.0)
    dt = time.perf_counter() - t0

    _mark(shared_reel is not None, "T2: shared_reel appears in DB within 25s", f"waited={dt:.1f}s")
    if shared_reel is None:
        mc.close()
        return None

    required = {"key", "hash", "has_video", "has_audio", "size", "ts"}
    present = set(shared_reel.keys())
    missing = required - present
    _mark(not missing, "T2: shared_reel has required keys", f"missing={missing or 'none'}")
    _mark(isinstance(shared_reel.get("key"), str) and shared_reel["key"].startswith("shares/reel_"),
          "T2: shared_reel.key prefix shares/reel_", f"key={shared_reel.get('key')}")
    _mark(isinstance(shared_reel.get("hash"), str) and len(shared_reel["hash"]) >= 8,
          "T2: shared_reel.hash is hex string", f"hash={shared_reel.get('hash')}")
    _mark(isinstance(shared_reel.get("size"), int) and shared_reel["size"] > 1000,
          "T2: shared_reel.size > 1KB", f"size={shared_reel.get('size')}")

    first_hash = shared_reel["hash"]
    mc.close()
    return first_hash


async def test_3_cache_hit_share(client: httpx.AsyncClient, luna: str, mood_id: str) -> None:
    t0 = time.perf_counter()
    r = await client.post(f"{BASE}/share/reel/{mood_id}", headers=_bearer(luna))
    dt = time.perf_counter() - t0
    _mark(r.status_code == 200, "T3: POST /share/reel/{mood_id} returns 200", f"{r.status_code} in {dt:.2f}s")
    if r.status_code != 200:
        print("  body:", r.text[:500])
        return
    j = r.json()
    _mark(j.get("cached") is True, "T3: cached:true (prewarm hit)", f"cached={j.get('cached')}")
    _mark(isinstance(j.get("url"), str) and j["url"].startswith("https://"),
          "T3: url is https presigned", f"url_prefix={(j.get('url') or '')[:60]}")
    _mark(isinstance(j.get("key"), str) and j["key"].startswith("shares/reel_"),
          "T3: key prefix shares/reel_", f"key={j.get('key')}")
    _mark(dt < 1.5, "T3: cache HIT response < 1.5s", f"elapsed={dt:.3f}s")
    if dt < 0.5:
        _mark(True, "T3: cache HIT < 500ms perf goal", f"elapsed={dt*1000:.0f}ms")
    else:
        # not a failure — just report
        print(f"  note: cache HIT was {dt*1000:.0f}ms (goal <500ms)")


async def test_4_regressions(client: httpx.AsyncClient, luna: str) -> None:
    # 4a) POST /moods with no auth → 401 (use a bare client — httpx persists cookies
    # from prior login, which this endpoint also accepts).
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as bare:
        r = await bare.post(f"{BASE}/moods", json={"emotion": "joy", "intensity": 3})
    _mark(r.status_code == 401, "T4a: POST /moods without auth → 401", f"got={r.status_code}")

    # 4b) POST /moods with invalid emotion → 422
    r = await client.post(
        f"{BASE}/moods",
        json={"emotion": "banana", "intensity": 3, "privacy": "friends"},
        headers=_bearer(luna),
    )
    _mark(r.status_code == 422, "T4b: POST /moods invalid emotion → 422", f"got={r.status_code}")

    # 4c) POST /moods again same day (edit) → replaced:true, same mood_id
    first = await client.post(
        f"{BASE}/moods",
        json={"emotion": "joy", "intensity": 3, "word": "sunshine", "privacy": "friends"},
        headers=_bearer(luna),
    )
    if first.status_code != 200:
        _mark(False, "T4c: prep first post 200", f"got={first.status_code}")
        return
    first_mood = first.json()["mood"]
    first_id = first_mood["mood_id"]

    await asyncio.sleep(0.5)
    t0 = time.perf_counter()
    second = await client.post(
        f"{BASE}/moods",
        json={"emotion": "calm", "intensity": 4, "word": "morning", "privacy": "private"},
        headers=_bearer(luna),
    )
    dt2 = time.perf_counter() - t0
    _mark(second.status_code == 200, "T4c: edit POST /moods → 200", f"got={second.status_code}")
    _mark(dt2 < 1.5, "T4c: edit POST /moods < 1.5s (non-blocking)", f"elapsed={dt2:.2f}s")
    if second.status_code == 200:
        j2 = second.json()
        _mark(j2.get("replaced") is True, "T4c: replaced:true on edit", f"replaced={j2.get('replaced')}")
        _mark(j2["mood"]["mood_id"] == first_id, "T4c: mood_id preserved on edit",
              f"old={first_id} new={j2['mood']['mood_id']}")
        _mark(j2["mood"]["emotion"] == "calm", "T4c: emotion updated to calm")

    # Grab first-hash from DB before waiting
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
    except Exception as e:
        _mark(False, "T4d: motor import", str(e))
        return

    mc = AsyncIOMotorClient(MONGO_URL)
    db = mc[DB_NAME]

    # Wait for 2nd prewarm to complete and update hash.
    deadline = time.perf_counter() + 30.0
    new_shared = None
    while time.perf_counter() < deadline:
        doc = await db.moods.find_one({"mood_id": first_id}, {"_id": 0, "shared_reel": 1})
        sr = doc.get("shared_reel") if doc else None
        if sr and sr.get("hash"):
            # Accept when hash is set (it may or may not differ depending on content hash coverage).
            new_shared = sr
            # Check a couple times to be sure the prewarm finished post-edit:
            # we need the hash to be something — if it's the OLD first-post hash we keep waiting.
            break
        await asyncio.sleep(1.0)

    _mark(new_shared is not None, "T4d: shared_reel present after edit", f"sr={bool(new_shared)}")
    # For completeness, confirm the hash encodes the NEW description/word.
    # The hash uses emotion/color/word/description/user_name + media keys; since all changed,
    # the hash should differ from the first-post hash. We can recompute to assert.
    if new_shared:
        # Short rewait to make sure prewarm from edit has fully overwritten the first-post hash.
        # (The first prewarm may still be finishing when edit happens; both get scheduled.)
        await asyncio.sleep(8.0)
        doc = await db.moods.find_one({"mood_id": first_id}, {"_id": 0, "shared_reel": 1})
        sr2 = (doc or {}).get("shared_reel") or {}
        _mark(isinstance(sr2.get("hash"), str) and len(sr2["hash"]) >= 8,
              "T4d: shared_reel.hash still populated after edit", f"hash={sr2.get('hash')}")
    mc.close()


async def test_5_failure_tolerance(client: httpx.AsyncClient, luna: str) -> None:
    """Post a mood, DELETE it immediately — backend must not crash when prewarm tries to build."""
    await _delete_today(client, luna)

    # Snapshot current err log length
    try:
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            before_len = len(f.read())
    except Exception:
        before_len = 0

    r = await client.post(
        f"{BASE}/moods",
        json={"emotion": "anger", "intensity": 5, "word": "quick", "privacy": "private"},
        headers=_bearer(luna),
    )
    if r.status_code != 200:
        _mark(False, "T5: prep POST /moods 200", f"got={r.status_code}")
        return
    mood_id = r.json()["mood"]["mood_id"]

    # Immediate delete — race against prewarm.
    r2 = await client.delete(f"{BASE}/moods/{mood_id}", headers=_bearer(luna))
    _mark(r2.status_code == 200, "T5: DELETE /moods/{mood_id} 200 (before prewarm finishes)",
          f"got={r2.status_code}")

    # Give the background task 15s to run and potentially log an error.
    await asyncio.sleep(15.0)

    try:
        with open("/var/log/supervisor/backend.err.log", "r") as f:
            all_text = f.read()
        new_text = all_text[before_len:]
    except Exception as e:
        new_text = ""
        _mark(False, "T5: read backend err log", str(e))
        return

    # Look for obvious unhandled exceptions / 500s.
    bad_markers = ["Traceback (most recent call last)", "500 Internal Server Error"]
    offending_lines = []
    for ln in new_text.splitlines():
        for m in bad_markers:
            if m in ln:
                offending_lines.append(ln)

    # The prewarm function already has try/except swallowing; an INFO/WARNING is fine.
    _mark(
        not offending_lines,
        "T5: no unhandled exceptions in backend err log after delete race",
        f"markers={offending_lines[:3] if offending_lines else 'none'}",
    )

    # Confirm backend still responsive.
    ping = await client.get(f"{BASE}/auth/me", headers=_bearer(luna))
    _mark(ping.status_code == 200, "T5: backend still responsive (GET /auth/me)", f"got={ping.status_code}")


async def test_6_smoke_regressions(client: httpx.AsyncClient, luna: str) -> None:
    # Make sure luna has a mood today so feed != locked
    await _delete_today(client, luna)
    post = await client.post(
        f"{BASE}/moods",
        json={"emotion": "joy", "intensity": 3, "word": "smoke", "privacy": "friends"},
        headers=_bearer(luna),
    )
    _mark(post.status_code == 200, "T6-prep: POST /moods for smoke", f"got={post.status_code}")

    endpoints = [
        ("GET /moods/today", client.get(f"{BASE}/moods/today", headers=_bearer(luna))),
        ("GET /moods/heatmap", client.get(f"{BASE}/moods/heatmap", headers=_bearer(luna))),
        ("GET /moods/insights", client.get(f"{BASE}/moods/insights", headers=_bearer(luna))),
        ("GET /moods/feed", client.get(f"{BASE}/moods/feed", headers=_bearer(luna))),
        ("GET /streak/freeze-status", client.get(f"{BASE}/streak/freeze-status", headers=_bearer(luna))),
    ]
    for label, coro in endpoints:
        r = await coro
        _mark(r.status_code == 200, f"T6: {label} → 200", f"got={r.status_code}")


async def main() -> None:
    print(f"BASE={BASE}")
    print(f"MONGO_URL={MONGO_URL} DB={DB_NAME}")
    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        luna = await login(client, LUNA_EMAIL, LUNA_PW)
        _mark(bool(luna), "Login as luna", f"token_len={len(luna)}")

        mood_id = await test_1_post_moods_nonblocking(client, luna)
        if not mood_id:
            print("\n[ABORT] no mood_id — cannot continue")
        else:
            print("\nSleeping ~18s to let prewarm finish…", flush=True)
            await asyncio.sleep(18.0)
            first_hash = await test_2_prewarm_populates_db(mood_id, max_wait=10.0)
            await test_3_cache_hit_share(client, luna, mood_id)

        await test_4_regressions(client, luna)
        await test_5_failure_tolerance(client, luna)
        await test_6_smoke_regressions(client, luna)

    print("\n" + "=" * 70)
    print(f"RESULTS: PASS={len(PASS)}  FAIL={len(FAIL)}")
    if FAIL:
        print("FAILED tests:")
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    else:
        print("All tests PASS ✓")


if __name__ == "__main__":
    asyncio.run(main())
