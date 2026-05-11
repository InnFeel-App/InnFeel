"""Session 26 backend tests — 4 changes shipped on InnFeel.

CHANGE 1 — X-Tz header lazy timezone sync (get_current_user persists tz).
CHANGE 2 — today_key(d, tz) tz-aware (local-noon rollover, UTC fallback).
CHANGE 3 — POST /moods returns 409 when an aura already exists today, unless edit=true.
CHANGE 4 — compute_streak uses today_key(d, tz=user.tz) — still sane non-negative ints.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient


def _read_env(path: str, key: str) -> Optional[str]:
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{key}="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return val
    except FileNotFoundError:
        return None
    return None


BASE_URL = _read_env("/app/frontend/.env", "EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"
MONGO_URL = _read_env("/app/backend/.env", "MONGO_URL")
DB_NAME = _read_env("/app/backend/.env", "DB_NAME")

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

print(f"BASE_URL: {BASE_URL}")
print(f"MONGO   : {MONGO_URL} db={DB_NAME}")
print()

results = []


def rec(label: str, ok: bool, detail: str = ""):
    results.append((label, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {label} — {detail}")


def login(client: httpx.Client, email: str, password: str) -> str:
    r = client.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["access_token"]


def test_change1_x_tz():
    print("\n=== CHANGE 1 — X-Tz header lazy timezone sync (luna) ===")
    async def _reset_tz():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.users.update_one({"email": LUNA_EMAIL}, {"$unset": {"tz": ""}})
        cli.close()
    asyncio.run(_reset_tz())

    with httpx.Client(timeout=20.0) as c:
        token = login(c, LUNA_EMAIL, LUNA_PASS)
        hdrs = {"Authorization": f"Bearer {token}"}

        # 1a — /auth/me without X-Tz  (response is flat sanitize_user(user))
        r = c.get(f"{BASE_URL}/auth/me", headers=hdrs)
        body = r.json() if r.status_code == 200 else None
        ok = r.status_code == 200 and isinstance(body, dict) and "email" in (body or {})
        tz_val = (body or {}).get("tz")
        rec("1a /auth/me without X-Tz returns 200", ok, f"status={r.status_code}, tz={tz_val!r}")
        rec("1a tz absent or null", tz_val is None, f"tz={tz_val!r}")

        # 1b — X-Tz: Europe/Paris updates
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "Europe/Paris"})
        body = r.json()
        tz_val = body.get("tz")
        rec("1b X-Tz=Europe/Paris → user.tz=Europe/Paris", tz_val == "Europe/Paris",
            f"tz={tz_val!r}")

        # 1c — repeat 3 times, idempotent
        for _ in range(3):
            r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "Europe/Paris"})
            assert r.status_code == 200
            assert r.json().get("tz") == "Europe/Paris"
        rec("1c repeated X-Tz=Europe/Paris idempotent", True, "3 repeats all OK")

        async def _check():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            u = await db.users.find_one({"email": LUNA_EMAIL}, {"tz": 1})
            cli.close()
            return (u or {}).get("tz")
        paris_db = asyncio.run(_check())
        rec("1c DB tz=Europe/Paris persisted", paris_db == "Europe/Paris", f"db.tz={paris_db!r}")

        # 1d — switch to America/New_York
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "America/New_York"})
        tz_val = r.json().get("tz")
        rec("1d X-Tz=America/New_York → updated", tz_val == "America/New_York", f"tz={tz_val!r}")

        # 1e — invalid tz string: still 200, tz NOT updated
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "not_a_real_zone"})
        tz_val = r.json().get("tz")
        rec("1e invalid 'not_a_real_zone' → 200, tz unchanged",
            r.status_code == 200 and tz_val == "America/New_York",
            f"status={r.status_code}, tz={tz_val!r}")

        # 1f — length 1 ('A'): ignored
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "A"})
        tz_val = r.json().get("tz")
        rec("1f X-Tz='A' (len 1) ignored",
            r.status_code == 200 and tz_val == "America/New_York",
            f"status={r.status_code}, tz={tz_val!r}")

        # 1g — length 100: ignored (len > 64)
        long_tz = "X" * 100
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": long_tz})
        tz_val = r.json().get("tz")
        rec("1g X-Tz 100-char string ignored",
            r.status_code == 200 and tz_val == "America/New_York",
            f"status={r.status_code}, tz={tz_val!r}")

        # Reset to Europe/Paris for downstream
        r = c.get(f"{BASE_URL}/auth/me", headers={**hdrs, "X-Tz": "Europe/Paris"})


def test_change2_today_key():
    print("\n=== CHANGE 2 — today_key tz-aware unit tests ===")
    sys.path.insert(0, "/app/backend")
    from app_core.deps import today_key

    d1 = datetime(2026, 5, 10, 11, 0, tzinfo=timezone.utc)
    k1 = today_key(d1)
    rec("2a today_key(2026-05-10 11:00 UTC) → '2026-05-09'", k1 == "2026-05-09", f"got {k1!r}")

    k2 = today_key(d1, tz="Europe/Paris")
    rec("2b today_key(2026-05-10 11:00 UTC, tz=Europe/Paris) → '2026-05-10'",
        k2 == "2026-05-10", f"got {k2!r}")

    d3 = datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc)
    k3 = today_key(d3, tz="Europe/Paris")
    rec("2c today_key(2026-05-10 09:00 UTC, tz=Europe/Paris) → '2026-05-09'",
        k3 == "2026-05-09", f"got {k3!r}")

    try:
        k4 = today_key(d1, tz="garbage")
        rec("2d today_key with tz='garbage' falls back, no exception",
            k4 == "2026-05-09", f"got {k4!r}")
    except Exception as e:
        rec("2d today_key with tz='garbage' falls back", False, f"raised {type(e).__name__}: {e}")


def test_change3_one_per_day():
    print("\n=== CHANGE 3 — POST /moods 409 conflict ===")
    with httpx.Client(timeout=30.0) as c:
        token = login(c, LUNA_EMAIL, LUNA_PASS)
        hdrs = {"Authorization": f"Bearer {token}", "X-Tz": "Europe/Paris"}

        r = c.delete(f"{BASE_URL}/moods/today", headers=hdrs)
        rec("3a DELETE /moods/today cleanup", r.status_code == 200, f"status={r.status_code}")

        body = {"word": "test", "emotion": "joy", "intensity": 3, "privacy": "friends"}
        r = c.post(f"{BASE_URL}/moods", json=body, headers=hdrs)
        ok = r.status_code == 200
        mood = r.json().get("mood") if ok else None
        mood_id = (mood or {}).get("mood_id")
        rec("3b first POST /moods → 200 with mood_id", ok and bool(mood_id),
            f"status={r.status_code}, mood_id={mood_id!r}")

        r2 = c.post(f"{BASE_URL}/moods", json=body, headers=hdrs)
        is_409 = r2.status_code == 409
        rec("3c second POST same body → 409", is_409, f"status={r2.status_code}")
        if is_409:
            detail = r2.json().get("detail")
            shape_ok = (isinstance(detail, dict)
                        and detail.get("code") == "already_posted_today"
                        and isinstance(detail.get("message"), str)
                        and detail.get("mood_id") == mood_id)
            rec("3c 409 body shape {code, message, mood_id}",
                shape_ok, f"detail={detail!r}")
        else:
            rec("3c 409 body shape", False, f"body={r2.text[:200]}")

        body_edit = {**body, "word": "edited", "intensity": 5, "edit": True}
        r3 = c.post(f"{BASE_URL}/moods", json=body_edit, headers=hdrs)
        ok = r3.status_code == 200
        jb3 = r3.json() if ok else {}
        new_mood = jb3.get("mood")
        replaced = jb3.get("replaced")
        rec("3d POST edit=true → 200 replaced=true mood_id preserved",
            ok and replaced is True and (new_mood or {}).get("mood_id") == mood_id,
            f"status={r3.status_code}, replaced={replaced}, "
            f"mood_id={(new_mood or {}).get('mood_id')!r}, "
            f"word={(new_mood or {}).get('word')!r}, "
            f"intensity={(new_mood or {}).get('intensity')!r}")

        r4 = c.get(f"{BASE_URL}/moods/today", headers=hdrs)
        mood_today = r4.json().get("mood") if r4.status_code == 200 else None
        rec("3e GET /moods/today returns the mood",
            r4.status_code == 200 and (mood_today or {}).get("mood_id") == mood_id,
            f"status={r4.status_code}, mood_id={(mood_today or {}).get('mood_id')!r}")

        r5 = c.get(f"{BASE_URL}/moods/feed", headers=hdrs)
        ok = r5.status_code == 200
        jb = r5.json() if ok else {}
        rec("3f GET /moods/feed with X-Tz → 200",
            ok and "items" in jb and "locked" in jb,
            f"status={r5.status_code}, locked={jb.get('locked')}, items={len(jb.get('items', []))}")

        r6 = c.get(f"{BASE_URL}/friends", headers=hdrs)
        ok = r6.status_code == 200
        fjb = r6.json() if ok else {}
        friends = fjb.get("friends", [])
        all_have_dropped = all("dropped_today" in f for f in friends) and len(friends) > 0
        rec("3g GET /friends with X-Tz returns dropped_today flag on each row",
            ok and all_have_dropped,
            f"status={r6.status_code}, friends={len(friends)}, all_have_flag={all_have_dropped}, "
            f"sample={[(f.get('name'), f.get('dropped_today')) for f in friends[:3]]}")


def test_change4_compute_streak():
    print("\n=== CHANGE 4 — compute_streak ===")
    with httpx.Client(timeout=20.0) as c:
        token = login(c, LUNA_EMAIL, LUNA_PASS)
        hdrs = {"Authorization": f"Bearer {token}", "X-Tz": "Europe/Paris"}
        r = c.get(f"{BASE_URL}/auth/me", headers=hdrs)
        user = r.json() if r.status_code == 200 else None
        streak = (user or {}).get("streak")
        rec("4a Luna /auth/me streak is int >= 1",
            isinstance(streak, int) and streak >= 1, f"streak={streak!r}")

        admin_token = login(c, ADMIN_EMAIL, ADMIN_PASS)
        admin_hdrs = {"Authorization": f"Bearer {admin_token}", "X-Tz": "Europe/Paris"}
        # Note: review request mentioned `/admin/users-list` but actual route is `/admin/users/list`.
        r = c.get(f"{BASE_URL}/admin/users/list?page_size=20", headers=admin_hdrs)
        if r.status_code != 200:
            rec("4b /admin/users/list streak fields sane", False,
                f"status={r.status_code}, body={r.text[:200]}")
            return
        jb = r.json()
        users = jb.get("users", [])
        all_sane = all(isinstance(u.get("current_streak"), int) and u["current_streak"] >= 0 for u in users)
        rec("4b /admin/users/list current_streak all >= 0 ints",
            all_sane and len(users) > 0,
            f"users={len(users)}, all_sane={all_sane}, "
            f"sample={[(u.get('email'), u.get('current_streak')) for u in users[:5]]}")


if __name__ == "__main__":
    for fn in (test_change2_today_key, test_change1_x_tz, test_change3_one_per_day, test_change4_compute_streak):
        try:
            fn()
        except Exception as e:
            rec(fn.__name__, False, f"exception: {type(e).__name__}: {e}")
            import traceback; traceback.print_exc()

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(l, d) for l, ok, d in results if not ok]
    print(f"TOTAL: {passed}/{len(results)} PASS, {len(failed)} FAIL")
    if failed:
        print("\nFAILURES:")
        for l, d in failed:
            print(f"  FAIL  {l}\n        {d}")
    sys.exit(0 if not failed else 1)
