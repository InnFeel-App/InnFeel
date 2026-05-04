"""Session 17 backend test — Instagram Reel share endpoint + regressions.

Test plan:
 1) Owner happy path (luna): POST /api/share/reel/<mood_id> → 200 with ok,url,key,duration=15.
    Verify downloading the presigned URL returns HTTP 200, video/mp4, >10KB.
 2) Not your aura: admin trying to share luna's mood → 403.
 3) Not found: fake mood_id → 404.
 4) Unauth: no auth → 401.
 5) Minimal content (no photo/video/music) still succeeds with has_audio:false, has_video:false.
 6) Regression spot-check: /auth/me, /moods/feed, /friends (no email), /messages/unread-count,
    /notifications/prefs (includes weekly_recap).
"""
import asyncio
import sys

import httpx

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PWD = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PWD = "demo1234"

OK = 0
FAIL = 0
LINES = []


def log(tag, ok, detail=""):
    global OK, FAIL
    mark = "PASS" if ok else "FAIL"
    if ok:
        OK += 1
    else:
        FAIL += 1
    line = f"[{mark}] {tag} :: {detail}"
    print(line, flush=True)
    LINES.append(line)


async def login(client, email, pwd):
    client.cookies.clear()
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": pwd})
    r.raise_for_status()
    data = r.json()
    return data.get("access_token"), data.get("user", {})


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


async def api_get(client, path, tok, **kw):
    client.cookies.clear()
    return await client.get(f"{BASE}{path}", headers=hdr(tok), **kw)


async def api_post(client, path, tok, json=None, **kw):
    client.cookies.clear()
    return await client.post(f"{BASE}{path}", headers=hdr(tok), json=json, **kw)


async def api_del(client, path, tok, **kw):
    client.cookies.clear()
    return await client.delete(f"{BASE}{path}", headers=hdr(tok), **kw)


async def ensure_luna_mood(client, tok, minimal=False, want_rich=False):
    """Ensure luna has a mood today. If minimal=True, ensure no photo/video/music attached."""
    r = await api_get(client, "/moods/today", tok)
    today = r.json().get("mood") if r.status_code == 200 else None
    if minimal:
        # Delete and recreate simple mood.
        await api_del(client, "/moods/today", tok)
        payload = {"emotion": "calm", "word": "quiet", "intensity": 2}
        r = await api_post(client, "/moods", tok, json=payload)
        if r.status_code != 200:
            log("ensure_minimal_mood", False, f"POST /moods {r.status_code} {r.text[:200]}")
            return None
        return r.json().get("mood", {}).get("mood_id") or r.json().get("mood_id")
    if today and today.get("mood_id"):
        return today["mood_id"]
    payload = {"emotion": "joy", "word": "Radiant", "intensity": 3, "text": "testing reel"}
    r = await api_post(client, "/moods", tok, json=payload)
    if r.status_code != 200:
        log("ensure_mood", False, f"POST /moods {r.status_code} {r.text[:200]}")
        return None
    j = r.json()
    return j.get("mood", {}).get("mood_id") or j.get("mood_id")


async def main():
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        # --- LOGIN ---
        try:
            luna_tok, luna_user = await login(client, LUNA_EMAIL, LUNA_PWD)
            log("login.luna", True, f"user_id={luna_user.get('user_id')}")
        except Exception as e:
            log("login.luna", False, str(e))
            return
        try:
            admin_tok, admin_user = await login(client, ADMIN_EMAIL, ADMIN_PWD)
            log("login.admin", True, f"user_id={admin_user.get('user_id')}")
        except Exception as e:
            log("login.admin", False, str(e))
            return

        # =================== 1) OWNER HAPPY PATH ===================
        mood_id = await ensure_luna_mood(client, luna_tok)
        log("1.ensure_mood", bool(mood_id), f"mood_id={mood_id}")

        if mood_id:
            import time
            t0 = time.time()
            r = await api_post(client, f"/share/reel/{mood_id}", luna_tok, timeout=30.0)
            elapsed = time.time() - t0
            log(
                "1.share_reel.status",
                r.status_code == 200,
                f"status={r.status_code} body={r.text[:400]} elapsed={elapsed:.2f}s",
            )
            if r.status_code == 200:
                j = r.json()
                log("1.share_reel.ok", j.get("ok") is True, f"ok={j.get('ok')}")
                url = j.get("url") or ""
                log("1.share_reel.url_https", url.startswith("https"), f"url={url[:100]}")
                key = j.get("key") or ""
                log("1.share_reel.key_prefix", key.startswith("shares/reel_"), f"key={key}")
                log("1.share_reel.duration", j.get("duration") == 15, f"duration={j.get('duration')}")

                if url:
                    # Download the presigned URL.
                    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as cc:
                        dr = await cc.get(url)
                    log(
                        "1.download.status",
                        dr.status_code == 200,
                        f"status={dr.status_code}",
                    )
                    ct = dr.headers.get("Content-Type", "")
                    log(
                        "1.download.content_type",
                        ct.startswith("video/mp4"),
                        f"content-type={ct}",
                    )
                    body_len = len(dr.content) if dr.status_code == 200 else 0
                    log(
                        "1.download.size",
                        body_len > 10000,
                        f"bytes={body_len}",
                    )

        # =================== 2) NOT YOUR AURA ===================
        if mood_id:
            r = await api_post(client, f"/share/reel/{mood_id}", admin_tok, timeout=30.0)
            detail = ""
            try:
                detail = r.json().get("detail", "")
            except Exception:
                pass
            log(
                "2.not_your_aura.status",
                r.status_code == 403,
                f"status={r.status_code} detail={detail}",
            )
            log(
                "2.not_your_aura.detail",
                detail == "Not your aura",
                f"detail={detail!r}",
            )

        # =================== 3) NOT FOUND ===================
        r = await api_post(
            client, "/share/reel/mood_nonexistent_xxx", luna_tok, timeout=30.0
        )
        log(
            "3.not_found.status",
            r.status_code == 404,
            f"status={r.status_code} body={r.text[:200]}",
        )

        # =================== 4) UNAUTH ===================
        client.cookies.clear()
        r = await client.post(
            f"{BASE}/share/reel/{mood_id or 'xyz'}",
            timeout=30.0,
        )
        log(
            "4.unauth.status",
            r.status_code in (401, 403),  # 401 expected; some FastAPI setups use 403
            f"status={r.status_code} body={r.text[:150]}",
        )
        log(
            "4.unauth.is_401",
            r.status_code == 401,
            f"status={r.status_code}",
        )

        # =================== 5) MINIMAL CONTENT (no photo/video/music) ===================
        mood_id_min = await ensure_luna_mood(client, luna_tok, minimal=True)
        log("5.ensure_minimal_mood", bool(mood_id_min), f"mood_id={mood_id_min}")
        if mood_id_min:
            r = await api_post(
                client, f"/share/reel/{mood_id_min}", luna_tok, timeout=30.0
            )
            log(
                "5.minimal.status",
                r.status_code == 200,
                f"status={r.status_code} body={r.text[:400]}",
            )
            if r.status_code == 200:
                j = r.json()
                log(
                    "5.minimal.has_audio_false",
                    j.get("has_audio") is False,
                    f"has_audio={j.get('has_audio')}",
                )
                log(
                    "5.minimal.has_video_false",
                    j.get("has_video") is False,
                    f"has_video={j.get('has_video')}",
                )
                log(
                    "5.minimal.url_present",
                    bool(j.get("url")),
                    f"url_prefix={(j.get('url') or '')[:80]}",
                )

        # =================== 6) REGRESSION ===================
        # 6a) /auth/me (admin)
        r = await api_get(client, "/auth/me", admin_tok)
        ok = r.status_code == 200
        log("6a.auth_me_admin", ok, f"status={r.status_code}")
        if ok:
            data = r.json()
            email = data.get("email") or data.get("user", {}).get("email")
            log(
                "6a.auth_me_admin.email",
                email == ADMIN_EMAIL,
                f"email={email}",
            )

        # 6b) /moods/feed (luna)
        r = await api_get(client, "/moods/feed", luna_tok)
        log(
            "6b.moods_feed_luna",
            r.status_code == 200,
            f"status={r.status_code}",
        )

        # 6c) /friends (luna) — should NOT include email per friend
        r = await api_get(client, "/friends", luna_tok)
        log("6c.friends_luna.status", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            data = r.json()
            friends = data if isinstance(data, list) else data.get("friends") or []
            has_email = any("email" in (f or {}) for f in friends)
            log(
                "6c.friends_luna.no_email",
                not has_email,
                f"count={len(friends)} any_has_email={has_email} sample_keys={sorted(list(friends[0].keys())) if friends else []}",
            )

        # 6d) /messages/unread-count (luna)
        r = await api_get(client, "/messages/unread-count", luna_tok)
        log(
            "6d.unread_count_luna",
            r.status_code == 200,
            f"status={r.status_code} body={r.text[:200]}",
        )

        # 6e) /notifications/prefs (luna) includes weekly_recap
        r = await api_get(client, "/notifications/prefs", luna_tok)
        log(
            "6e.notif_prefs_luna.status",
            r.status_code == 200,
            f"status={r.status_code}",
        )
        if r.status_code == 200:
            prefs = r.json()
            log(
                "6e.notif_prefs_luna.weekly_recap_key",
                "weekly_recap" in prefs,
                f"keys={sorted(prefs.keys())}",
            )

        # === SUMMARY ===
        print("\n========== SUMMARY ==========", flush=True)
        print(f"PASS: {OK}  FAIL: {FAIL}  TOTAL: {OK + FAIL}", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"HARNESS CRASH: {e}", flush=True)
        sys.exit(2)
    sys.exit(0 if FAIL == 0 else 1)
