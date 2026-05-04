"""Session 19 backend test — focus on /api/share/reel/{mood_id} fixes.

Tests:
1) Owner happy path with NO photo/video/music (fallback gradient + Ken Burns + silent track).
2) Owner path with a real small photo (Ken Burns photo path).
3) Event-loop responsiveness during encoding (asyncio.to_thread proof).
4) 401 / 403 / 404 regressions.
5) Regression spot-check of previously-green endpoints.
"""
from __future__ import annotations

import base64
import io
import os
import threading
import time
from typing import Any, Optional

import httpx

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"
ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

REEL_TIMEOUT = 25.0


results: list[tuple[str, bool, str]] = []


def log(name: str, ok: bool, detail: str = "") -> None:
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {name}  {detail}")
    results.append((name, ok, detail))


def _client(token: Optional[str] = None, timeout: float = 30.0) -> httpx.Client:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.Client(base_url=BASE, headers=headers, timeout=timeout, follow_redirects=False)


def login(email: str, password: str) -> str:
    with _client() as c:
        r = c.post("/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
        return r.json()["access_token"]


def ensure_luna_mood_basic(token: str) -> str:
    """Delete today's mood and re-post a minimal one (no photo/video/music)."""
    with _client(token) as c:
        c.delete("/moods/today")
        r = c.post(
            "/moods",
            json={"emotion": "calm", "word": "peaceful", "intensity": 2, "privacy": "private"},
        )
        assert r.status_code == 200, f"POST /moods failed: {r.status_code} {r.text}"
        data = r.json()
        mood = data.get("mood") or data
        mid = mood.get("mood_id") or data.get("mood_id")
        assert mid, f"no mood_id in response: {data}"
        return mid


def ensure_luna_mood_with_photo(token: str) -> str:
    """Post a mood with a small photo_b64 (tiny yellow JPEG)."""
    try:
        from PIL import Image
    except Exception:
        Image = None

    if Image is not None:
        img = Image.new("RGB", (800, 800), (255, 215, 40))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        photo_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    else:
        # Fallback: 1x1 yellow JPEG (base64).
        photo_b64 = (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////"
            "////////////////////////////////////////////2wBDAf////////////////////////"
            "////////////////////////////////////////////////////////////////////////wAA"
            "RCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAA"
            "AAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIR"
            "AxEAPwB/AD//2Q=="
        )

    with _client(token) as c:
        c.delete("/moods/today")
        r = c.post(
            "/moods",
            json={
                "emotion": "joy",
                "word": "sunshine",
                "intensity": 3,
                "privacy": "private",
                "photo_b64": photo_b64,
            },
        )
        if r.status_code != 200:
            return ""
        data = r.json()
        mood = data.get("mood") or data
        return mood.get("mood_id") or data.get("mood_id") or ""


# ────────────────────────────────────────────────────────────────────────────────
# 1) Owner happy path — minimal content (fallback gradient + silent track)
# ────────────────────────────────────────────────────────────────────────────────
def test_reel_happy_path_minimal(luna_token: str) -> str:
    print("\n=== TEST 1: Reel happy path (no photo/video/music) ===")
    mood_id = ensure_luna_mood_basic(luna_token)
    log("test1.setup_mood", bool(mood_id), f"mood_id={mood_id}")

    t0 = time.time()
    with _client(luna_token, timeout=REEL_TIMEOUT) as c:
        r = c.post(f"/share/reel/{mood_id}")
    elapsed = time.time() - t0
    log("test1.reel_status_200", r.status_code == 200, f"status={r.status_code} elapsed={elapsed:.2f}s body={r.text[:400]}")
    if r.status_code != 200:
        return mood_id

    log("test1.reel_under_15s", elapsed <= 15.0, f"elapsed={elapsed:.2f}s")
    body = r.json()
    log("test1.ok_true", body.get("ok") is True, f"body.ok={body.get('ok')}")
    log("test1.has_url", isinstance(body.get("url"), str) and body["url"].startswith("http"), f"url={str(body.get('url'))[:80]}")
    log("test1.has_key_prefix", str(body.get("key", "")).startswith("shares/reel_"), f"key={body.get('key')}")
    log("test1.duration_15", body.get("duration") == 15, f"duration={body.get('duration')}")
    log("test1.has_video_false", body.get("has_video") is False, f"has_video={body.get('has_video')}")
    log("test1.has_audio_false", body.get("has_audio") is False, f"has_audio={body.get('has_audio')}")

    # Download the URL and check content-type + content-length.
    url = body.get("url")
    if url:
        with httpx.Client(timeout=30.0, follow_redirects=True) as c:
            r2 = c.get(url)
        ctype = r2.headers.get("Content-Type", "")
        size = int(r2.headers.get("Content-Length") or len(r2.content))
        log("test1.download_200", r2.status_code == 200, f"status={r2.status_code}")
        log("test1.content_type_mp4", "video/mp4" in ctype, f"ctype={ctype}")
        log("test1.content_length_gt_50kb", size > 50000, f"size={size}")

    return mood_id


# ────────────────────────────────────────────────────────────────────────────────
# 2) Reel with photo (Ken Burns photo path)
# ────────────────────────────────────────────────────────────────────────────────
def test_reel_with_photo(luna_token: str) -> None:
    print("\n=== TEST 2: Reel with real photo (Ken Burns path) ===")
    mood_id = ensure_luna_mood_with_photo(luna_token)
    if not mood_id:
        log("test2.setup_mood", False, "photo_b64 mood could not be created — skipping")
        return
    log("test2.setup_mood", True, f"mood_id={mood_id}")

    t0 = time.time()
    with _client(luna_token, timeout=REEL_TIMEOUT) as c:
        r = c.post(f"/share/reel/{mood_id}")
    elapsed = time.time() - t0

    log("test2.reel_status_200", r.status_code == 200, f"status={r.status_code} elapsed={elapsed:.2f}s body={r.text[:400]}")
    if r.status_code != 200:
        return

    log("test2.reel_under_20s", elapsed <= 20.0, f"elapsed={elapsed:.2f}s")
    body = r.json()
    log("test2.ok_true", body.get("ok") is True)
    log("test2.has_video_false", body.get("has_video") is False, f"has_video={body.get('has_video')} (photo path)")
    log("test2.has_audio_false", body.get("has_audio") is False, f"has_audio={body.get('has_audio')}")

    url = body.get("url")
    if url:
        with httpx.Client(timeout=30.0, follow_redirects=True) as c:
            r2 = c.get(url)
        size = int(r2.headers.get("Content-Length") or len(r2.content))
        log("test2.download_200", r2.status_code == 200, f"status={r2.status_code}")
        log("test2.content_length_gt_200kb", size > 200_000, f"size={size}")


# ────────────────────────────────────────────────────────────────────────────────
# 3) Event-loop responsiveness during encoding
# ────────────────────────────────────────────────────────────────────────────────
def test_event_loop_responsive(luna_token: str, admin_token: str, mood_id: str) -> None:
    print("\n=== TEST 3: Event-loop responsive during ffmpeg encode ===")
    if not mood_id:
        log("test3.precondition", False, "no mood_id available for reel call")
        return

    reel_result: dict = {}
    auth_result: dict = {}

    def call_reel() -> None:
        t0 = time.time()
        try:
            with _client(luna_token, timeout=REEL_TIMEOUT) as c:
                r = c.post(f"/share/reel/{mood_id}")
            reel_result["status"] = r.status_code
            reel_result["elapsed"] = time.time() - t0
            reel_result["body"] = r.text[:300]
        except Exception as e:
            reel_result["err"] = str(e)
            reel_result["elapsed"] = time.time() - t0

    def call_auth_me() -> None:
        # Wait 200ms so A is already in ffmpeg territory.
        time.sleep(0.2)
        t0 = time.time()
        try:
            with _client(admin_token, timeout=10.0) as c:
                r = c.get("/auth/me")
            auth_result["status"] = r.status_code
            auth_result["elapsed"] = time.time() - t0
        except Exception as e:
            auth_result["err"] = str(e)
            auth_result["elapsed"] = time.time() - t0

    t_reel = threading.Thread(target=call_reel)
    t_auth = threading.Thread(target=call_auth_me)
    t_reel.start()
    t_auth.start()
    t_auth.join(timeout=20.0)
    t_reel.join(timeout=30.0)

    log(
        "test3.reel_eventually_200",
        reel_result.get("status") == 200,
        f"reel status={reel_result.get('status')} elapsed={reel_result.get('elapsed', 0):.2f}s err={reel_result.get('err')}",
    )
    log(
        "test3.auth_me_200",
        auth_result.get("status") == 200,
        f"auth status={auth_result.get('status')} elapsed={auth_result.get('elapsed', 0):.2f}s err={auth_result.get('err')}",
    )
    log(
        "test3.auth_me_under_2s",
        auth_result.get("elapsed", 99) < 2.0,
        f"auth elapsed={auth_result.get('elapsed', 0):.2f}s (must be <2.0s to prove event loop free)",
    )
    log(
        "test3.auth_me_under_5s_hard",
        auth_result.get("elapsed", 99) < 5.0,
        f"auth elapsed={auth_result.get('elapsed', 0):.2f}s (hard cutoff — >5s proves threading broken)",
    )


# ────────────────────────────────────────────────────────────────────────────────
# 4) 401 / 403 / 404 regressions
# ────────────────────────────────────────────────────────────────────────────────
def test_auth_regressions(luna_token: str, admin_token: str, luna_mood_id: str) -> None:
    print("\n=== TEST 4: 401 / 403 / 404 regressions ===")

    # 401: no auth header
    with httpx.Client(base_url=BASE, timeout=20.0) as c:
        r = c.post(f"/share/reel/{luna_mood_id}")
    log("test4.unauth_401", r.status_code == 401, f"status={r.status_code} body={r.text[:200]}")

    # 403: admin tries luna's aura
    with _client(admin_token, timeout=REEL_TIMEOUT) as c:
        r = c.post(f"/share/reel/{luna_mood_id}")
    log(
        "test4.not_your_aura_403",
        r.status_code == 403 and "Not your aura" in r.text,
        f"status={r.status_code} body={r.text[:200]}",
    )

    # 404: nonexistent mood_id
    with _client(luna_token, timeout=20.0) as c:
        r = c.post("/share/reel/mood_does_not_exist")
    log(
        "test4.not_found_404",
        r.status_code == 404 and "Aura not found" in r.text,
        f"status={r.status_code} body={r.text[:200]}",
    )


# ────────────────────────────────────────────────────────────────────────────────
# 5) Regression spot-check (previously green endpoints)
# ────────────────────────────────────────────────────────────────────────────────
def test_regression(admin_token: str, luna_token: str) -> None:
    print("\n=== TEST 5: Regression spot-check ===")

    with _client(admin_token) as c:
        r = c.get("/auth/me")
    log("test5.admin_auth_me", r.status_code == 200 and r.json().get("email") == ADMIN_EMAIL, f"status={r.status_code}")

    with _client(luna_token) as c:
        r = c.get("/moods/feed")
    log("test5.luna_moods_feed", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

    with _client(luna_token) as c:
        r = c.get("/friends")
    if r.status_code == 200:
        friends = r.json().get("friends") if isinstance(r.json(), dict) else r.json()
        friends = friends or []
        no_email = all("email" not in f for f in friends) if isinstance(friends, list) else True
        log("test5.luna_friends_200", True, f"count={len(friends) if isinstance(friends, list) else '?'}")
        log("test5.luna_friends_no_email", no_email, f"email field absent on all rows")
    else:
        log("test5.luna_friends_200", False, f"status={r.status_code}")

    # Find a message to react to in luna's conversations
    with _client(luna_token) as c:
        r = c.get("/messages/conversations")
    convo_peer = None
    if r.status_code == 200:
        convs = r.json()
        if isinstance(convs, dict):
            convs = convs.get("conversations") or []
        if convs:
            convo_peer = convs[0].get("peer_id") or (convs[0].get("peer") or {}).get("user_id")
    msg_id = None
    if convo_peer:
        with _client(luna_token) as c:
            r = c.get(f"/messages/with/{convo_peer}")
        if r.status_code == 200:
            msgs = r.json()
            if isinstance(msgs, dict):
                msgs = msgs.get("messages") or []
            if msgs:
                msg_id = msgs[-1].get("message_id")
    if msg_id:
        with _client(luna_token) as c:
            r = c.post(f"/messages/{msg_id}/react", json={"emoji": "love_eyes"})
        # Note: spec says love_eyes should be 200. But session 16 showed the accepted emoji set
        # does NOT include love_eyes. Accept 200 or 422 and just record.
        log(
            "test5.message_react_love_eyes",
            r.status_code == 200,
            f"status={r.status_code} body={r.text[:250]}",
        )
    else:
        log("test5.message_react_love_eyes", False, "no message found to react on")


# ────────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────────
def main() -> None:
    print(f"BASE URL: {BASE}")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    luna_token = login(LUNA_EMAIL, LUNA_PASS)

    # Test 1 — minimal content
    luna_mood_basic = test_reel_happy_path_minimal(luna_token)

    # Test 2 — photo path (creates a new today's mood, overwriting test1's)
    test_reel_with_photo(luna_token)

    # For Test 3 we want a minimal reel (faster encode) so recreate minimal mood.
    luna_mood_basic = ensure_luna_mood_basic(luna_token)

    # Test 3 — event loop responsiveness
    test_event_loop_responsive(luna_token, admin_token, luna_mood_basic)

    # Test 4 — 401/403/404
    test_auth_regressions(luna_token, admin_token, luna_mood_basic)

    # Test 5 — regression spot-check
    test_regression(admin_token, luna_token)

    print("\n\n============ SUMMARY ============")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    for name, ok, detail in results:
        tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {name}")
        if not ok and detail:
            print(f"         ↳ {detail[:400]}")
    print(f"\nTOTAL: {passed} pass / {failed} fail / {len(results)} total")


if __name__ == "__main__":
    main()
