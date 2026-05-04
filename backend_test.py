"""Session 22 backend test — Smart Reminders (B4) + Heatmap (B1).

Covers:
  A) GET /api/notifications/smart-hour
     - 401 unauth
     - default with 0 samples (low confidence)
     - <5 samples returns default but reports samples count
     - 5 tight samples → source=history, high confidence
     - 5 spread samples → source=history, medium confidence

  B) POST /api/moods with optional local_hour
     - First-time post pushes to recent_local_hours (with $slice -30)
     - Edit of same day does NOT push
     - Omitted local_hour → no push
     - Rolling cap 30 — push past 30 keeps last 30, oldest dropped

  C) GET /api/moods/heatmap
     - 401 unauth
     - empty cells/frozen_days when user has no data
     - cells reflect moods + frozen_days reflect users.streak_freezes
     - color present + non-empty
     - days clamped [7, 365]
     - Multiple moods same day_key → highest intensity wins

  D) Regression: GET /api/streak/freeze-status still works (auth, shape).

Cleans up DB state at end.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "backend" / ".env")
sys.path.insert(0, str(Path(__file__).parent / "backend"))

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


def day_n_str(n):
    return (now_utc() - timedelta(days=n)).strftime("%Y-%m-%d")


async def login(client, email, pw):
    client.cookies.clear()
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        raise RuntimeError(f"Login {email} → {r.status_code}: {r.text}")
    return r.json()["access_token"]


def H(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


async def aget(client, path, token=None):
    client.cookies.clear()
    return await client.get(f"{BASE}{path}", headers=H(token))


async def apost(client, path, token=None, json=None):
    client.cookies.clear()
    return await client.post(f"{BASE}{path}", headers=H(token), json=json)


async def adel(client, path, token=None):
    client.cookies.clear()
    return await client.delete(f"{BASE}{path}", headers=H(token))


async def reset_user(db, user_id):
    await db.moods.delete_many({"user_id": user_id})
    await db.users.update_one(
        {"user_id": user_id},
        {"$unset": {
            "recent_local_hours": "",
            "streak_freezes": "",
            "streak_freezes_purchased": "",
            "streak_freezes_total": "",
            "bundle_purchases": "",
        }},
    )


async def main():
    print(f"BASE={BASE}")
    print(f"DB={DB_NAME}")

    from app_core.constants import EMOTIONS

    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as c:
        admin_tok = await login(c, ADMIN_EMAIL, ADMIN_PW)
        rio_tok = await login(c, RIO_EMAIL, RIO_PW)
        luna_tok = await login(c, LUNA_EMAIL, LUNA_PW)
        rio_doc = await db.users.find_one({"email": RIO_EMAIL}, {"_id": 0, "user_id": 1})
        luna_doc = await db.users.find_one({"email": LUNA_EMAIL}, {"_id": 0, "user_id": 1})
        rio_id = rio_doc["user_id"]
        luna_id = luna_doc["user_id"]
        print(f"rio_id={rio_id}  luna_id={luna_id}")

        # =======================================================================
        # SECTION A — GET /api/notifications/smart-hour
        # =======================================================================
        print("\n=== A) GET /api/notifications/smart-hour ===")

        # A1 — 401 unauth
        c.cookies.clear()
        r = await c.get(f"{BASE}/notifications/smart-hour")
        ok("A1: smart-hour unauth → 401", r.status_code == 401, f"got {r.status_code}")

        # A2 — Reset rio → default
        await reset_user(db, rio_id)
        r = await aget(c, "/notifications/smart-hour", rio_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("A2: smart-hour 200 (rio fresh)", r.status_code == 200, f"status={r.status_code}")
        ok("A2: hour==12 default", body.get("hour") == 12, f"got {body.get('hour')}")
        ok("A2: minute==0", body.get("minute") == 0, f"got {body.get('minute')}")
        ok("A2: source==default", body.get("source") == "default", f"got {body.get('source')}")
        ok("A2: samples==0", body.get("samples") == 0, f"got {body.get('samples')}")
        ok("A2: confidence==low", body.get("confidence") == "low", f"got {body.get('confidence')}")

        # A3 — 3 samples (still <5)
        await db.users.update_one(
            {"user_id": rio_id},
            {"$set": {"recent_local_hours": [9, 10, 11]}},
        )
        r = await aget(c, "/notifications/smart-hour", rio_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("A3: 200 with 3 samples", r.status_code == 200, f"status={r.status_code}")
        ok("A3: samples==3", body.get("samples") == 3, f"got {body.get('samples')}")
        ok("A3: source==default (still <5)", body.get("source") == "default", f"got {body.get('source')}")
        ok("A3: hour==12 default", body.get("hour") == 12, f"got {body.get('hour')}")

        # A4 — 5 tight → high
        await db.users.update_one(
            {"user_id": rio_id},
            {"$set": {"recent_local_hours": [9, 9, 10, 10, 10]}},
        )
        r = await aget(c, "/notifications/smart-hour", rio_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("A4: 200 with 5 samples", r.status_code == 200, f"status={r.status_code}")
        ok("A4: samples==5", body.get("samples") == 5, f"got {body.get('samples')}")
        ok("A4: source==history", body.get("source") == "history", f"got {body.get('source')}")
        ok("A4: hour==10", body.get("hour") == 10, f"got {body.get('hour')}")
        ok("A4: confidence==high", body.get("confidence") == "high", f"got {body.get('confidence')}")

        # A5 — 5 spread → medium
        await db.users.update_one(
            {"user_id": rio_id},
            {"$set": {"recent_local_hours": [7, 9, 12, 15, 20]}},
        )
        r = await aget(c, "/notifications/smart-hour", rio_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("A5: 200 with 5 spread", r.status_code == 200, f"status={r.status_code}")
        ok("A5: samples==5", body.get("samples") == 5, f"got {body.get('samples')}")
        ok("A5: source==history", body.get("source") == "history", f"got {body.get('source')}")
        ok("A5: hour==12 (median)", body.get("hour") == 12, f"got {body.get('hour')}")
        ok("A5: confidence==medium", body.get("confidence") == "medium",
           f"got {body.get('confidence')}")

        # =======================================================================
        # SECTION B — POST /api/moods + local_hour
        # =======================================================================
        print("\n=== B) POST /api/moods local_hour push behaviour ===")

        await reset_user(db, rio_id)

        # B2 — first-time post → push 14
        r = await apost(c, "/moods", rio_tok, json={
            "emotion": "joy", "intensity": 3, "local_hour": 14,
        })
        ok("B2: POST first mood 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
        u = await db.users.find_one({"user_id": rio_id}, {"_id": 0, "recent_local_hours": 1}) or {}
        rlh = u.get("recent_local_hours") or []
        ok("B2: recent_local_hours == [14]", rlh == [14], f"got {rlh}")

        # B3 — re-POST same day → replaced=true, no push
        r = await apost(c, "/moods", rio_tok, json={
            "emotion": "calm", "intensity": 2, "local_hour": 18,
        })
        body = r.json() if r.status_code == 200 else {}
        ok("B3: re-POST same day 200", r.status_code == 200, f"status={r.status_code}")
        ok("B3: replaced==true", body.get("replaced") is True, f"got {body.get('replaced')}")
        u = await db.users.find_one({"user_id": rio_id}, {"_id": 0, "recent_local_hours": 1}) or {}
        rlh = u.get("recent_local_hours") or []
        ok("B3: recent_local_hours UNCHANGED == [14]", rlh == [14], f"got {rlh}")

        # B4 — POST without local_hour → no push (after deleting today's mood)
        await db.moods.delete_many({"user_id": rio_id, "day_key": today_str()})
        r = await apost(c, "/moods", rio_tok, json={
            "emotion": "joy", "intensity": 3,
        })
        ok("B4: POST no local_hour 200", r.status_code == 200, f"status={r.status_code}")
        u = await db.users.find_one({"user_id": rio_id}, {"_id": 0, "recent_local_hours": 1}) or {}
        rlh = u.get("recent_local_hours") or []
        ok("B4: recent_local_hours UNCHANGED == [14]", rlh == [14], f"got {rlh}")

        # B5 — Rolling cap 30
        seed30 = list(range(0, 30))
        await db.users.update_one(
            {"user_id": rio_id},
            {"$set": {"recent_local_hours": seed30}},
        )
        await db.moods.delete_many({"user_id": rio_id, "day_key": today_str()})
        r = await apost(c, "/moods", rio_tok, json={
            "emotion": "joy", "intensity": 3, "local_hour": 5,
        })
        ok("B5: POST 31st 200", r.status_code == 200, f"status={r.status_code}")
        u = await db.users.find_one({"user_id": rio_id}, {"_id": 0, "recent_local_hours": 1}) or {}
        rlh = u.get("recent_local_hours") or []
        ok("B5: array length == 30 (cap)", len(rlh) == 30, f"len={len(rlh)} arr={rlh}")
        ok("B5: last element == 5", (rlh[-1] if rlh else None) == 5,
           f"last={rlh[-1] if rlh else None}")
        ok("B5: first element shifted off (was 0; now 1)",
           (rlh[0] if rlh else None) == 1, f"first={rlh[0] if rlh else None}")

        # =======================================================================
        # SECTION C — GET /api/moods/heatmap
        # =======================================================================
        print("\n=== C) GET /api/moods/heatmap ===")

        # C1 — unauth
        c.cookies.clear()
        r = await c.get(f"{BASE}/moods/heatmap")
        ok("C1: heatmap unauth → 401", r.status_code == 401, f"got {r.status_code}")

        # C2 — Reset luna; empty
        await reset_user(db, luna_id)
        r = await aget(c, "/moods/heatmap", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("C2: 200 empty heatmap", r.status_code == 200, f"status={r.status_code}")
        ok("C2: cells == []", body.get("cells") == [], f"got {body.get('cells')}")
        ok("C2: frozen_days == []", body.get("frozen_days") == [], f"got {body.get('frozen_days')}")
        ok("C2: count == 0", body.get("count") == 0, f"got {body.get('count')}")
        ok("C2: days == 90 default", body.get("days") == 90, f"got {body.get('days')}")

        # C3 — seed 3 moods + streak_freeze
        async def insert_mood(uid, day_key, emotion, intensity, mood_id):
            d = datetime.fromisoformat(day_key).replace(tzinfo=timezone.utc)
            await db.moods.insert_one({
                "mood_id": mood_id,
                "user_id": uid,
                "day_key": day_key,
                "emotion": emotion,
                "color": EMOTIONS.get(emotion),
                "intensity": intensity,
                "privacy": "friends",
                "reactions": [],
                "comments": [],
                "created_at": d,
                "has_audio": False,
                "has_video": False,
            })

        today_k = today_str()
        d3_k = day_n_str(3)
        d10_k = day_n_str(10)
        await db.moods.delete_many({"user_id": luna_id})
        await insert_mood(luna_id, today_k, "joy", 3, "mood_test_today")
        await insert_mood(luna_id, d3_k, "calm", 5, "mood_test_d3")
        await insert_mood(luna_id, d10_k, "sadness", 7, "mood_test_d10")

        yest_k = day_n_str(1)
        await db.users.update_one(
            {"user_id": luna_id},
            {"$set": {"streak_freezes": [{
                "day_key": yest_k,
                "ts": now_utc(),
                "source": "monthly",
            }]}},
        )

        r = await aget(c, "/moods/heatmap?days=30", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("C3: 200 with seeded moods", r.status_code == 200, f"status={r.status_code}")
        ok("C3: days == 30", body.get("days") == 30, f"got {body.get('days')}")
        cells = body.get("cells") or []
        ok("C3: cells.length == 3", len(cells) == 3, f"len={len(cells)} cells={cells}")
        ok("C3: count == 3", body.get("count") == 3, f"got {body.get('count')}")
        ok("C3: frozen_days == [yest_k]", body.get("frozen_days") == [yest_k],
           f"got {body.get('frozen_days')} expected [{yest_k}]")

        cell_days = {x.get("day_key") for x in cells}
        expected_days = {today_k, d3_k, d10_k}
        ok("C3: cell day_keys == expected", cell_days == expected_days,
           f"got {cell_days} expected {expected_days}")

        # C4 — color palette match
        good = True
        details = []
        for x in cells:
            emo = x.get("emotion")
            color = x.get("color")
            details.append((emo, color))
            if not color or not isinstance(color, str) or not color.startswith("#"):
                good = False
                break
            if EMOTIONS.get(emo) and EMOTIONS[emo] != color:
                good = False
                break
        ok("C4: every cell has palette-matching color", good, f"cells colors: {details}")

        # C5 — days=0 → 7
        r = await aget(c, "/moods/heatmap?days=0", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("C5: 200 days=0", r.status_code == 200, f"status={r.status_code}")
        ok("C5: days clamped to 7", body.get("days") == 7, f"got {body.get('days')}")

        # C6 — days=999 → 365
        r = await aget(c, "/moods/heatmap?days=999", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("C6: 200 days=999", r.status_code == 200, f"status={r.status_code}")
        ok("C6: days clamped to 365", body.get("days") == 365, f"got {body.get('days')}")

        # C7 — duplicate day → highest intensity wins
        await db.moods.delete_many({"user_id": luna_id})
        same_day = today_str()
        await insert_mood(luna_id, same_day, "joy", 2, "mood_dup_low")
        await insert_mood(luna_id, same_day, "anger", 9, "mood_dup_high")
        r = await aget(c, "/moods/heatmap?days=30", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("C7: 200 dup-day", r.status_code == 200, f"status={r.status_code}")
        cells = body.get("cells") or []
        ok("C7: only 1 cell for dup day", len(cells) == 1, f"got {len(cells)}")
        if cells:
            ok("C7: highest intensity (9) wins", cells[0].get("intensity") == 9,
               f"got intensity={cells[0].get('intensity')} emotion={cells[0].get('emotion')}")
            ok("C7: emotion of higher (anger) wins",
               cells[0].get("emotion") == "anger",
               f"got emotion={cells[0].get('emotion')}")

        # =======================================================================
        # SECTION D — Regression
        # =======================================================================
        print("\n=== D) Regression: /api/streak/freeze-status ===")
        r = await aget(c, "/streak/freeze-status", admin_tok)
        body = r.json() if r.status_code == 200 else {}
        ok("D1: streak/freeze-status admin 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")
        required = {"plan", "quota", "used_this_month", "monthly_remaining",
                    "bundle_remaining", "remaining", "can_freeze_yesterday",
                    "yesterday_key", "current_streak", "bundle"}
        missing = required - set(body.keys())
        ok("D1: required keys present", not missing, f"missing={missing}")

        # =======================================================================
        # CLEANUP
        # =======================================================================
        print("\n=== CLEANUP ===")
        await db.moods.delete_many({"user_id": rio_id})
        await db.moods.delete_many({"user_id": luna_id})
        for uid in (rio_id, luna_id):
            await db.users.update_one(
                {"user_id": uid},
                {"$unset": {
                    "recent_local_hours": "",
                    "streak_freezes": "",
                    "streak_freezes_purchased": "",
                    "streak_freezes_total": "",
                    "bundle_purchases": "",
                }},
            )
        print("  ✓ cleaned rio + luna state")

    print("\n" + "=" * 70)
    print(f"PASSED: {len(PASS)}/{len(PASS)+len(FAIL)}")
    if FAIL:
        print("FAILS:")
        for f in FAIL:
            print(f"  - {f}")
    print("=" * 70)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
