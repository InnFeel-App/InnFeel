"""Backend tests for MoodDrop — Session 3.

Focus:
1) iTunes music search /api/music/search
2) Extended emotions on POST /api/moods
3) Music object in mood creation
4) Wellness for new emotions
5) Regression: auth/login, /auth/me, /friends (is_close), /friends/close/{id}
6) Legacy /api/music/tracks still returns {tracks: []}
"""
import os
import uuid
import asyncio
import requests

BASE = os.environ.get(
    "BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@mooddrop.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@mooddrop.app"
LUNA_PASS = "demo1234"

# Mongo direct access for cleanup (DB cleanup only, no functional modifications)
from motor.motor_asyncio import AsyncIOMotorClient  # noqa
from datetime import datetime, timezone

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


def today_key():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


results = []


def log(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def register(email, password, name):
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=30,
    )
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def get(path, token=None, params=None):
    return requests.get(f"{API}{path}", headers=auth_headers(token) if token else {}, params=params, timeout=30)


def post(path, token=None, json_body=None):
    return requests.post(f"{API}{path}", headers=auth_headers(token) if token else {}, json=json_body, timeout=30)


# ---------------- Section 5 (run first: baseline & setup) ----------------
def test_regression_auth():
    token = login(ADMIN_EMAIL, ADMIN_PASS)
    ok = bool(token)
    log("regression: admin login", ok, "access_token present" if ok else "login failed")
    if not token:
        return None
    r = get("/auth/me", token)
    ok2 = r.status_code == 200 and r.json().get("email") == ADMIN_EMAIL
    log("regression: /auth/me", ok2, f"status={r.status_code}")
    return token


def test_legacy_music_tracks(admin_token):
    r = get("/music/tracks", admin_token)
    ok = r.status_code == 200 and r.json() == {"tracks": []}
    log("legacy /api/music/tracks", ok, f"status={r.status_code} body={r.text[:100]}")


# ---------------- Section 1: iTunes music search ----------------
def test_music_search_pro(admin_token):
    r = get("/music/search", admin_token, params={"q": "ocean"})
    if r.status_code != 200:
        log("music/search q=ocean Pro", False, f"status={r.status_code} body={r.text[:200]}")
        return
    data = r.json()
    tracks = data.get("tracks", [])
    if len(tracks) < 3:
        log("music/search q=ocean Pro", False, f"expected >=3 tracks, got {len(tracks)}")
        return
    bad = []
    for t in tracks[:3]:
        for k in ("track_id", "name", "artist", "artwork_url", "preview_url", "source"):
            if k not in t:
                bad.append(f"missing {k}")
        if t.get("source") != "apple":
            bad.append(f"source={t.get('source')}")
        pu = t.get("preview_url", "")
        if not (isinstance(pu, str) and pu.startswith("http")):
            bad.append(f"preview_url invalid: {pu!r}")
    log("music/search q=ocean Pro", not bad, f"{len(tracks)} tracks; issues={bad}" )


def test_music_search_free():
    email = f"free_search_{uuid.uuid4().hex[:8]}@example.com"
    token = register(email, "Passw0rd!", "FreeSearch")
    if not token:
        log("music/search Free 403", False, "registration failed")
        return
    r = get("/music/search", token, params={"q": "ocean"})
    ok = r.status_code == 403 and "Pro" in (r.json().get("detail", ""))
    log("music/search Free 403", ok, f"status={r.status_code} detail={r.text[:200]}")


def test_music_search_short(admin_token):
    r = get("/music/search", admin_token, params={"q": "a"})
    ok = r.status_code == 200 and r.json().get("tracks") == []
    log("music/search q='a' empty", ok, f"status={r.status_code} body={r.text[:120]}")


def test_music_search_missing(admin_token):
    r = get("/music/search", admin_token)
    ok = r.status_code in (400, 422)
    log("music/search missing q 400/422", ok, f"status={r.status_code}")


# ---------------- Section 2: Extended emotions (POST /moods) ----------------
NEW_EMOTIONS = [
    "happy", "lonely", "grateful", "hopeful",
    "inspired", "confident", "bored", "overwhelmed",
]


def test_extended_emotions():
    for emo in NEW_EMOTIONS:
        email = f"test_emo_{emo}_{uuid.uuid4().hex[:6]}@example.com"
        token = register(email, "Passw0rd!", f"Test {emo}")
        if not token:
            log(f"emotion {emo} register", False, "registration failed")
            continue
        r = post(
            "/moods",
            token,
            json_body={
                "word": "test",
                "emotion": emo,
                "intensity": 3,
                "privacy": "private",
            },
        )
        if r.status_code != 200:
            log(f"emotion {emo} drop", False, f"status={r.status_code} body={r.text[:200]}")
            continue
        mood = r.json().get("mood", {})
        ok = mood.get("emotion") == emo and bool(mood.get("mood_id"))
        log(f"emotion {emo} drop", ok, f"mood_id={mood.get('mood_id')} emotion={mood.get('emotion')}")


# ---------------- Section 3: Music object in mood creation ----------------
async def _clean_today_moods_for(user_email: str):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    u = await db.users.find_one({"email": user_email})
    if u:
        res = await db.moods.delete_many({"user_id": u["user_id"], "day_key": today_key()})
        client.close()
        return res.deleted_count, u["user_id"]
    client.close()
    return 0, None


def test_music_object_mood_creation(admin_token):
    # 1) cleanup admin's today mood to allow a drop with music
    deleted, admin_id = asyncio.get_event_loop().run_until_complete(_clean_today_moods_for(ADMIN_EMAIL))
    log("cleanup admin today mood", True, f"deleted={deleted}")

    music = {
        "track_id": "apple_demo_1",
        "name": "Ocean Eyes",
        "artist": "KAROL G",
        "artwork_url": "https://example.com/a.jpg",
        "preview_url": "https://example.com/preview.mp3",
        "source": "apple",
    }
    r = post(
        "/moods",
        admin_token,
        json_body={
            "word": "ocean",
            "emotion": "calm",
            "intensity": 6,
            "privacy": "friends",
            "music": music,
        },
    )
    if r.status_code != 200:
        log("mood drop with music (Pro)", False, f"status={r.status_code} body={r.text[:300]}")
        return
    mobj = r.json().get("mood", {}).get("music") or {}
    ok = (
        mobj.get("track_id") == music["track_id"]
        and mobj.get("name") == music["name"]
        and mobj.get("preview_url") == music["preview_url"]
        and mobj.get("source") == "apple"
    )
    log("mood drop with music (Pro)", ok, f"music={mobj}")

    # Feed retention: luna drops too so admin feed unlocks (still, admin needs a friend->luna; seed creates this on /friends/add only)
    # Let's make sure luna is a friend of admin.
    r_add = post("/friends/add", admin_token, json_body={"email": LUNA_EMAIL})
    # idempotent: 200 or 400
    # Have luna drop today
    luna_token = login(LUNA_EMAIL, LUNA_PASS)
    if luna_token:
        # cleanup luna's today
        asyncio.get_event_loop().run_until_complete(_clean_today_moods_for(LUNA_EMAIL))
        rdrop = post("/moods", luna_token, json_body={
            "word": "wave", "emotion": "peace", "intensity": 4, "privacy": "friends"
        })
        if rdrop.status_code != 200:
            log("luna mood drop for feed", False, f"status={rdrop.status_code} body={rdrop.text[:200]}")
        else:
            # Now check admin's feed includes luna (and music attached to admin's own mood is on admin, not feed, so verify luna item)
            rfeed = get("/moods/feed", admin_token)
            if rfeed.status_code == 200 and not rfeed.json().get("locked"):
                log("feed unlocks after luna drop", True, f"items={len(rfeed.json().get('items', []))}")
            else:
                log("feed unlocks after luna drop", False, f"status={rfeed.status_code} body={rfeed.text[:200]}")
            # Also check admin's own /moods/today music is persisted
            rtoday = get("/moods/today", admin_token)
            if rtoday.status_code == 200:
                m = (rtoday.json() or {}).get("mood") or {}
                music_in_today = m.get("music") or {}
                ok2 = music_in_today.get("track_id") == music["track_id"]
                log("music persisted in /moods/today", ok2, f"music={music_in_today}")


# ---------------- Section 4: Wellness for new emotions ----------------
def test_wellness_new_emotions(admin_token):
    for emo in NEW_EMOTIONS:
        r = get(f"/wellness/{emo}", admin_token)
        if r.status_code != 200:
            log(f"wellness {emo}", False, f"status={r.status_code} body={r.text[:200]}")
            continue
        data = r.json()
        ok = bool(data.get("quote")) and bool(data.get("advice")) and data.get("source") in ("llm", "llm-cache", "static")
        log(f"wellness {emo}", ok, f"source={data.get('source')} quote_len={len(data.get('quote',''))}")


# ---------------- Regression: /friends and close toggle ----------------
def test_friends_regression(admin_token):
    r = get("/friends", admin_token)
    if r.status_code != 200:
        log("/friends list", False, f"status={r.status_code}")
        return
    friends = r.json().get("friends", [])
    has_is_close = all("is_close" in f for f in friends)
    log("/friends has is_close on every row", has_is_close, f"count={len(friends)}")

    luna = next((f for f in friends if f.get("email") == LUNA_EMAIL), None)
    if not luna:
        # add luna
        post("/friends/add", admin_token, json_body={"email": LUNA_EMAIL})
        r2 = get("/friends", admin_token)
        friends = r2.json().get("friends", [])
        luna = next((f for f in friends if f.get("email") == LUNA_EMAIL), None)
    if not luna:
        log("friends/close toggle", False, "luna not a friend")
        return
    before = bool(luna.get("is_close"))
    r_t = post(f"/friends/close/{luna['user_id']}", admin_token)
    ok1 = r_t.status_code == 200 and r_t.json().get("is_close") != before
    after_state = r_t.json().get("is_close") if r_t.status_code == 200 else None
    log("friends/close toggle #1", ok1, f"before={before} after={after_state}")
    # toggle back
    r_t2 = post(f"/friends/close/{luna['user_id']}", admin_token)
    ok2 = r_t2.status_code == 200 and r_t2.json().get("is_close") == before
    log("friends/close toggle back", ok2, f"final={r_t2.json().get('is_close')}")


def main():
    admin_token = test_regression_auth()
    if not admin_token:
        print("Aborting — admin login failed")
        return
    test_legacy_music_tracks(admin_token)
    test_music_search_pro(admin_token)
    test_music_search_free()
    test_music_search_short(admin_token)
    test_music_search_missing(admin_token)
    test_extended_emotions()
    test_music_object_mood_creation(admin_token)
    test_wellness_new_emotions(admin_token)
    test_friends_regression(admin_token)

    print("\n================ SUMMARY ================")
    fails = [(n, d) for (n, ok, d) in results if not ok]
    passes = [(n, d) for (n, ok, d) in results if ok]
    print(f"Passed: {len(passes)}/{len(results)}")
    for n, d in fails:
        print(f"  FAIL  {n}  ::  {d}")
    if not fails:
        print("All checks passed.")


if __name__ == "__main__":
    main()
