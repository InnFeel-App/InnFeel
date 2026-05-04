"""Streak Freeze backend test (Session 21 / Path C / Task B3).

Covers:
  1) GET /api/streak/freeze-status auth required.
  2) Admin (Pro) freeze-status shape.
  3) Free user freeze-status + 403 on POST /streak/freeze.
  4) "Yesterday missed but today posted" — Pro user can freeze yesterday.
  5) Bundle path — Free user with bundle credits can freeze.
  6) POST /streak/bundle/purchase eligibility (streak<7 → 403, streak>=7 → 200,
     same month → 403, DB has bundle_purchases entry).
  7) compute_streak bridges frozen days (verified indirectly via streak field).

Cleans up DB state at the end.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from pathlib import Path
from dotenv import load_dotenv

# Load backend .env so we get MONGO_URL + DB_NAME identical to running server.
load_dotenv(Path(__file__).parent / "backend" / ".env")

# Public preview URL (frontend/.env EXPO_PUBLIC_BACKEND_URL)
BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PW = "admin123"
RIO_EMAIL = "rio@innfeel.app"
RIO_PW = "demo1234"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PW = "demo1234"

PASS = []
FAIL = []


def ok(name, cond, info=""):
    if cond:
        PASS.append(name)
        print(f"  ✓ {name}" + (f"  [{info}]" if info else ""))
    else:
        FAIL.append(f"{name} :: {info}")
        print(f"  ✗ {name}  [{info}]")


def now_utc():
    return datetime.now(timezone.utc)


def today_str():
    return now_utc().strftime("%Y-%m-%d")


def yest_str():
    return (now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")


def day_n_str(n):
    """N days ago (0 = today)."""
    return (now_utc() - timedelta(days=n)).strftime("%Y-%m-%d")


async def login(client, email, pw):
    # New httpx client per call would defeat cookie semantics; the harness
    # passes a fresh client per user. We also clear cookies on each request
    # in helpers so the Bearer token wins.
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        raise RuntimeError(f"Login {email} → {r.status_code}: {r.text}")
    body = r.json()
    return body["access_token"]


def headers(token):
    return {"Authorization": f"Bearer {token}"}


async def aget(client, path, token=None, **kw):
    client.cookies.clear()
    return await client.get(f"{BASE}{path}", headers=headers(token) if token else {}, **kw)


async def apost(client, path, token=None, json=None, **kw):
    client.cookies.clear()
    return await client.post(f"{BASE}{path}", headers=headers(token) if token else {}, json=json, **kw)


async def adel(client, path, token=None, **kw):
    client.cookies.clear()
    return await client.delete(f"{BASE}{path}", headers=headers(token) if token else {}, **kw)


async def main():
    print(f"BASE={BASE}")
    print(f"DB={DB_NAME}")

    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as c:
        # ============================================================
        # AUTH SETUP
        # ============================================================
        print("\n[setup] login")
        admin_tok = await login(c, ADMIN_EMAIL, ADMIN_PW)
        rio_tok = await login(c, RIO_EMAIL, RIO_PW)
        luna_tok = await login(c, LUNA_EMAIL, LUNA_PW)

        # Resolve user_ids
        admin_doc = await db.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "user_id": 1})
        rio_doc = await db.users.find_one({"email": RIO_EMAIL}, {"_id": 0, "user_id": 1})
        luna_doc = await db.users.find_one({"email": LUNA_EMAIL}, {"_id": 0, "user_id": 1})
        admin_uid = admin_doc["user_id"]
        rio_uid = rio_doc["user_id"]
        luna_uid = luna_doc["user_id"]
        print(f"  admin_uid={admin_uid} rio_uid={rio_uid} luna_uid={luna_uid}")

        # ============================================================
        # CLEAN STATE — reset rio + luna so tests are deterministic
        # ============================================================
        print("\n[setup] reset DB state for rio + luna")
        for uid in (rio_uid, luna_uid):
            await db.users.update_one(
                {"user_id": uid},
                {
                    "$set": {
                        "streak_freezes": [],
                        "streak_freezes_purchased": 0,
                        "streak_freezes_total": 0,
                        "bundle_purchases": [],
                    },
                    "$unset": {"plan": "", "pro": "", "pro_expires_at": "", "pro_source": ""},
                },
            )
            # remove any seeded test moods we might've left from a prior run
            await db.moods.delete_many({"user_id": uid})

        # ============================================================
        # 1) AUTH GUARD on /streak/freeze-status
        # ============================================================
        print("\n[1] auth guard")
        c.cookies.clear()  # important: httpx persisted login cookies above
        r = await c.get(f"{BASE}/streak/freeze-status")
        ok("GET /streak/freeze-status without token → 401", r.status_code == 401, f"got {r.status_code}")

        # ============================================================
        # 2) Admin (Pro) freeze-status
        # ============================================================
        print("\n[2] admin freeze-status")
        r = await aget(c, "/streak/freeze-status", admin_tok)
        ok("admin freeze-status 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok("admin plan in {pro,zen}", j.get("plan") in ("pro", "zen"), f"plan={j.get('plan')}")
            ok("admin quota == 2 (Pro)", j.get("quota") == 2, f"quota={j.get('quota')}")
            ok(
                "admin monthly_remaining <= 2",
                isinstance(j.get("monthly_remaining"), int) and 0 <= j["monthly_remaining"] <= 2,
                f"monthly_remaining={j.get('monthly_remaining')}",
            )
            ok("bundle key present", "bundle" in j, "")
            if "bundle" in j:
                streak = j.get("current_streak", 0)
                eligible = j["bundle"].get("eligible")
                # eligible iff streak>=7 AND not purchased this month
                expected_eligible = streak >= 7 and not j["bundle"].get("purchased_this_month", False)
                ok(
                    "admin bundle.eligible matches current streak rule",
                    eligible == expected_eligible,
                    f"streak={streak} eligible={eligible} expected={expected_eligible}",
                )

        # ============================================================
        # 3) Free user (rio) freeze-status + POST 403
        # ============================================================
        print("\n[3] free user (rio) freeze-status + POST 403")
        # Make sure rio has no mood today and is_pro=False
        await db.moods.delete_many({"user_id": rio_uid})
        r = await aget(c, "/streak/freeze-status", rio_tok)
        ok("rio freeze-status 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            j = r.json()
            ok("rio quota == 0", j.get("quota") == 0, f"quota={j.get('quota')}")
            ok("rio monthly_remaining == 0", j.get("monthly_remaining") == 0, f"got {j.get('monthly_remaining')}")
            ok("rio bundle_remaining == 0", j.get("bundle_remaining") == 0, f"got {j.get('bundle_remaining')}")

        r = await apost(c, "/streak/freeze", rio_tok)
        ok("rio POST /streak/freeze → 403", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 403:
            detail = (r.json().get("detail") or "").lower()
            ok(
                "rio 403 detail mentions 'Pro feature'",
                "pro feature" in detail,
                f"detail={detail!r}",
            )

        # ============================================================
        # 4) Yesterday missed scenario — Pro user, monthly source
        # ============================================================
        print("\n[4] yesterday-missed scenario (rio promoted to Pro)")
        # Insert today's mood for rio
        import uuid as _uuid

        today = today_str()
        yesterday = yest_str()
        await db.moods.insert_one(
            {
                "mood_id": f"mood_{_uuid.uuid4().hex[:12]}",
                "user_id": rio_uid,
                "day_key": today,
                "emotion": "joy",
                "intensity": 5,
                "created_at": now_utc(),
                "word": "test",
            }
        )
        # Ensure NO mood for yesterday
        deleted = await db.moods.delete_many({"user_id": rio_uid, "day_key": yesterday})
        # Promote rio to Pro for this test (simulates the fixture)
        await db.users.update_one(
            {"user_id": rio_uid},
            {"$set": {"pro": True, "pro_expires_at": now_utc() + timedelta(days=30), "pro_source": "test"}},
        )

        r = await aget(c, "/streak/freeze-status", rio_tok)
        ok("rio (pro) freeze-status 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            j = r.json()
            ok("rio (pro) quota == 2", j.get("quota") == 2, f"got {j.get('quota')}")
            ok(
                "rio (pro) monthly_remaining == 2",
                j.get("monthly_remaining") == 2,
                f"got {j.get('monthly_remaining')}",
            )
            ok(
                "rio (pro) can_freeze_yesterday == true",
                j.get("can_freeze_yesterday") is True,
                f"got {j.get('can_freeze_yesterday')}",
            )
            ok(
                "rio (pro) yesterday_key matches",
                j.get("yesterday_key") == yesterday,
                f"got {j.get('yesterday_key')}",
            )

        # POST /freeze
        r = await apost(c, "/streak/freeze", rio_tok)
        ok("rio (pro) POST /streak/freeze → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok("source == 'monthly'", j.get("source") == "monthly", f"source={j.get('source')}")
            ok("frozen_day == yesterday", j.get("frozen_day") == yesterday, f"got {j.get('frozen_day')}")
            ok("monthly_remaining == 1", j.get("monthly_remaining") == 1, f"got {j.get('monthly_remaining')}")

        # DB checks
        rio_after = await db.users.find_one({"user_id": rio_uid}, {"_id": 0, "streak_freezes": 1, "streak_freezes_total": 1})
        rio_freezes = rio_after.get("streak_freezes") or []
        ok(
            "DB: streak_freezes contains an entry with source='monthly'",
            any(f.get("source") == "monthly" and f.get("day_key") == yesterday for f in rio_freezes),
            f"freezes={rio_freezes}",
        )
        ok(
            "DB: streak_freezes_total >= 1",
            (rio_after.get("streak_freezes_total") or 0) >= 1,
            f"total={rio_after.get('streak_freezes_total')}",
        )

        # Second POST → 400
        r = await apost(c, "/streak/freeze", rio_tok)
        ok("second POST /streak/freeze → 400", r.status_code == 400, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 400:
            detail = (r.json().get("detail") or "").lower()
            ok(
                "400 detail mentions 'already frozen'",
                "already frozen" in detail or "already" in detail,
                f"detail={detail!r}",
            )

        # ============================================================
        # 5) Bundle path — Free user with bundle credits
        # ============================================================
        print("\n[5] bundle path (rio reverted to Free, +3 bundle credits)")
        # Reset rio: revoke pro, clear streak_freezes (so yesterday is freezable again),
        # set streak_freezes_purchased=3.
        await db.users.update_one(
            {"user_id": rio_uid},
            {
                "$set": {
                    "streak_freezes": [],
                    "streak_freezes_purchased": 3,
                },
                "$unset": {"pro": "", "pro_expires_at": "", "pro_source": ""},
            },
        )
        # Today's mood is still present, yesterday still missing.
        r = await aget(c, "/streak/freeze-status", rio_tok)
        ok("rio (free w/ bundle) freeze-status 200", r.status_code == 200, f"{r.status_code}")
        if r.status_code == 200:
            j = r.json()
            ok("bundle_remaining == 3", j.get("bundle_remaining") == 3, f"got {j.get('bundle_remaining')}")
            ok("monthly_remaining == 0", j.get("monthly_remaining") == 0, f"got {j.get('monthly_remaining')}")
            ok(
                "can_freeze_yesterday == true (via bundle)",
                j.get("can_freeze_yesterday") is True,
                f"got {j.get('can_freeze_yesterday')}",
            )

        r = await apost(c, "/streak/freeze", rio_tok)
        ok("rio (free w/ bundle) POST /streak/freeze → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok("source == 'bundle'", j.get("source") == "bundle", f"source={j.get('source')}")
            ok("bundle_remaining == 2", j.get("bundle_remaining") == 2, f"got {j.get('bundle_remaining')}")

        rio_after = await db.users.find_one({"user_id": rio_uid}, {"_id": 0, "streak_freezes_purchased": 1})
        ok(
            "DB: streak_freezes_purchased decremented to 2",
            rio_after.get("streak_freezes_purchased") == 2,
            f"got {rio_after.get('streak_freezes_purchased')}",
        )

        # ============================================================
        # 6) Bundle purchase eligibility
        # ============================================================
        print("\n[6] bundle purchase eligibility")

        # 6a) Free user with current_streak < 7 → 403.
        # Reset rio fully — clear moods + freezes so streak is 0/1 max.
        await db.moods.delete_many({"user_id": rio_uid})
        await db.users.update_one(
            {"user_id": rio_uid},
            {
                "$set": {"streak_freezes": [], "bundle_purchases": []},
                "$unset": {"pro": "", "pro_expires_at": "", "pro_source": ""},
            },
        )
        # Insert just today's mood → streak == 1
        await db.moods.insert_one(
            {
                "mood_id": f"mood_{_uuid.uuid4().hex[:12]}",
                "user_id": rio_uid,
                "day_key": today_str(),
                "emotion": "joy",
                "intensity": 5,
                "created_at": now_utc(),
                "word": "test",
            }
        )
        r = await apost(c, "/streak/bundle/purchase", rio_tok)
        ok("free rio with streak<7: bundle/purchase → 403", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 403:
            detail = (r.json().get("detail") or "").lower()
            ok(
                "403 detail mentions '7-day streak'",
                "7-day streak" in detail or "7 day" in detail or "bundle unlocks" in detail,
                f"detail={detail!r}",
            )

        # 6b) Seed 7 days of moods for rio so streak >= 7 (today and last 6 days).
        await db.moods.delete_many({"user_id": rio_uid})
        # Reset bundle credits to a known value so the post-purchase assertion is deterministic.
        await db.users.update_one(
            {"user_id": rio_uid},
            {"$set": {"streak_freezes_purchased": 0, "bundle_purchases": []}},
        )
        for n in range(7):
            await db.moods.insert_one(
                {
                    "mood_id": f"mood_{_uuid.uuid4().hex[:12]}",
                    "user_id": rio_uid,
                    "day_key": day_n_str(n),
                    "emotion": "joy",
                    "intensity": 5,
                    "created_at": now_utc() - timedelta(days=n),
                    "word": "streaktest",
                }
            )
        # Verify streak via freeze-status
        r = await aget(c, "/streak/freeze-status", rio_tok)
        if r.status_code == 200:
            j = r.json()
            ok("rio current_streak >= 7", j.get("current_streak", 0) >= 7, f"got {j.get('current_streak')}")
            ok(
                "bundle.eligible == true (streak>=7, no purchase yet)",
                j.get("bundle", {}).get("eligible") is True,
                f"bundle={j.get('bundle')}",
            )

        # Purchase
        r = await apost(c, "/streak/bundle/purchase", rio_tok)
        ok("rio (streak>=7) bundle/purchase → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok("freezes_granted == 3", j.get("freezes_granted") == 3, f"got {j.get('freezes_granted')}")
            ok("price_eur == 1.99", j.get("price_eur") == 1.99, f"got {j.get('price_eur')}")
            # rio had 0 bundle credits at start of 6b (we reset to 0 in 6a step), so after purchase = 3.
            ok(
                "bundle_remaining == 3 after purchase",
                j.get("bundle_remaining") == 3,
                f"got {j.get('bundle_remaining')}",
            )

        # 6c) Same month → 403
        r = await apost(c, "/streak/bundle/purchase", rio_tok)
        ok("rio second purchase same month → 403", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 403:
            detail = (r.json().get("detail") or "").lower()
            ok(
                "403 detail mentions 'already purchased this month'",
                "already purchased" in detail,
                f"detail={detail!r}",
            )

        # 6d) DB: bundle_purchases array has month_key
        cur_month = now_utc().strftime("%Y-%m")
        rio_after = await db.users.find_one({"user_id": rio_uid}, {"_id": 0, "bundle_purchases": 1, "streak_freezes_purchased": 1})
        purchases = rio_after.get("bundle_purchases") or []
        ok(
            "DB: bundle_purchases has entry with current month_key",
            any(p.get("month_key") == cur_month for p in purchases),
            f"purchases={purchases}",
        )
        ok(
            "DB: streak_freezes_purchased >= 3 after purchase",
            (rio_after.get("streak_freezes_purchased") or 0) >= 3,
            f"got {rio_after.get('streak_freezes_purchased')}",
        )

        # ============================================================
        # 7) compute_streak bridges frozen days — verify indirectly
        #    Use luna. Seed moods on day-2 and day-0 (today), but NOT day-1.
        #    Also need today mood + yesterday missing for the freeze endpoint.
        #    Promote luna to Pro (so monthly quota>0).
        #    POST /streak/freeze should bridge yesterday and return streak == 2.
        # ============================================================
        print("\n[7] compute_streak bridges frozen days (via luna)")
        await db.moods.delete_many({"user_id": luna_uid})
        await db.users.update_one(
            {"user_id": luna_uid},
            {
                "$set": {
                    "streak_freezes": [],
                    "streak_freezes_purchased": 0,
                    "bundle_purchases": [],
                    "pro": True,
                    "pro_expires_at": now_utc() + timedelta(days=30),
                    "pro_source": "test",
                }
            },
        )
        # Insert moods on day-0 (today) and day-2 (NOT day-1).
        for n in (0, 2):
            await db.moods.insert_one(
                {
                    "mood_id": f"mood_{_uuid.uuid4().hex[:12]}",
                    "user_id": luna_uid,
                    "day_key": day_n_str(n),
                    "emotion": "joy",
                    "intensity": 5,
                    "created_at": now_utc() - timedelta(days=n),
                    "word": "bridge",
                }
            )

        # Before freeze: streak should be 1 (only today; yesterday breaks it).
        # Hit POST /streak/freeze and inspect "streak" field after bridging.
        r = await apost(c, "/streak/freeze", luna_tok)
        ok("luna POST /streak/freeze (bridge) → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            ok(
                "luna streak == 2 after bridging yesterday",
                j.get("streak") == 2,
                f"got streak={j.get('streak')}",
            )
            ok("luna source == 'monthly'", j.get("source") == "monthly", f"got {j.get('source')}")

        # ============================================================
        # CLEANUP — restore deterministic state
        # ============================================================
        print("\n[cleanup] restoring DB state")
        for uid in (rio_uid, luna_uid):
            await db.moods.delete_many({"user_id": uid})
            await db.users.update_one(
                {"user_id": uid},
                {
                    "$set": {
                        "streak_freezes": [],
                        "streak_freezes_purchased": 0,
                        "streak_freezes_total": 0,
                        "bundle_purchases": [],
                    },
                    "$unset": {"plan": "", "pro": "", "pro_expires_at": "", "pro_source": ""},
                },
            )

    # ============================================================
    print("\n" + "=" * 60)
    print(f"PASS: {len(PASS)}    FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFAILED:")
        for f in FAIL:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL GREEN ✦")


if __name__ == "__main__":
    asyncio.run(main())
