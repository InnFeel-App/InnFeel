"""
InnFeel R2 migration sanity test (Session 13).
Targets the public preview backend URL + /api prefix.
"""
import os
import re
import json
import time
import uuid
import logging
from typing import Optional

import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("test")

BACKEND_URL = "https://charming-wescoff-8.preview.emergentagent.com"
try:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BACKEND_URL = line.split("=", 1)[1].strip().strip('"')
                break
except Exception:
    pass
API = BACKEND_URL.rstrip("/") + "/api"
log.info(f"API: {API}")

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

PASS = []
FAIL = []


def record(label: str, ok: bool, detail: str = ""):
    if ok:
        PASS.append(label)
        log.info(f"  PASS  {label}  {detail}")
    else:
        FAIL.append((label, detail))
        log.info(f"  FAIL  {label}  {detail}")


def login(client: httpx.Client, email: str, password: str) -> Optional[str]:
    client.cookies.clear()
    r = client.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json().get("access_token")
    log.info(f"login {email} -> {r.status_code} {r.text[:200]}")
    return None


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def fresh_user(client: httpx.Client) -> tuple[str, str, str]:
    suf = uuid.uuid4().hex[:8]
    email = f"r2test_{suf}@innfeel.app"
    payload = {"email": email, "password": "test1234!", "name": f"R2T{suf[:4]}", "lang": "en"}
    r = client.post(f"{API}/auth/register", json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"register failed: {r.status_code} {r.text[:200]}")
    body = r.json()
    return body["user"]["user_id"], email, body["access_token"]


def main():
    with httpx.Client(timeout=30.0) as client:
        # ============================================================
        # 1. Login
        # ============================================================
        admin_token = login(client, ADMIN_EMAIL, ADMIN_PASS)
        record("auth.login admin", admin_token is not None)
        if not admin_token:
            return

        client.cookies.clear()
        luna_token = login(client, LUNA_EMAIL, LUNA_PASS)
        record("auth.login luna", luna_token is not None)

        client.cookies.clear()
        r = client.get(f"{API}/auth/me", headers=hdr(admin_token))
        admin_user = r.json() if r.status_code == 200 else {}
        admin_id = admin_user.get("user_id", "")
        record("auth.me admin", r.status_code == 200 and admin_user.get("is_admin") is True,
               f"is_admin={admin_user.get('is_admin')} pro={admin_user.get('pro')}")
        record("auth.me admin has avatar_url field", "avatar_url" in admin_user,
               f"avatar_url={admin_user.get('avatar_url')}")

        client.cookies.clear()
        r = client.get(f"{API}/auth/me", headers=hdr(luna_token))
        luna_user = r.json() if r.status_code == 200 else {}
        luna_id = luna_user.get("user_id", "")
        record("auth.me luna", r.status_code == 200, f"luna_id={luna_id}")

        # ============================================================
        # 2. /api/media/upload-url validation matrix
        # ============================================================
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_photo", "content_type": "image/jpeg"})
        ok = r.status_code == 200
        signed = r.json() if ok else {}
        keys_ok = ok and all(k in signed for k in ("url", "method", "key", "headers", "expires_in"))
        record("media.upload-url mood_photo as admin", ok and keys_ok,
               f"status={r.status_code} keys={list(signed.keys()) if ok else r.text[:120]}")
        if ok:
            record("media.upload-url method == PUT", signed.get("method") == "PUT", f"method={signed.get('method')}")
            record("media.upload-url Content-Type header echoed",
                   signed.get("headers", {}).get("Content-Type") == "image/jpeg",
                   f"headers={signed.get('headers')}")
            record("media.upload-url key has user_id prefix",
                   f"/{admin_id}/" in signed.get("key", ""),
                   f"key={signed.get('key')}")
            record("media.upload-url url at R2 endpoint",
                   "r2.cloudflarestorage.com" in (signed.get("url") or ""),
                   f"url[:80]={(signed.get('url') or '')[:80]}")
            record("media.upload-url expires_in == 900", signed.get("expires_in") == 900,
                   f"expires_in={signed.get('expires_in')}")

        # 2b) Free user video → 402
        try:
            free_uid, free_email, free_token = fresh_user(client)
        except Exception as e:
            free_uid = free_email = free_token = None
            record("fresh free user creation", False, str(e))
        if free_token:
            client.cookies.clear()
            r = client.post(f"{API}/media/upload-url",
                            headers=hdr(free_token),
                            json={"kind": "mood_video", "content_type": "video/mp4"})
            record("media.upload-url mood_video as FREE -> 402",
                   r.status_code == 402 and "Pro feature" in r.text,
                   f"status={r.status_code} body={r.text[:160]}")

        # 2c) Pro video → 200
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_video", "content_type": "video/mp4"})
        record("media.upload-url mood_video as Pro -> 200", r.status_code == 200,
               f"status={r.status_code}")

        # 2d) Bad photo content type → 400
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_photo", "content_type": "application/x-php"})
        record("media.upload-url bad photo content_type -> 400",
               r.status_code == 400 and "Unsupported" in r.text,
               f"status={r.status_code} body={r.text[:160]}")

        # ============================================================
        # 3. Round-trip: presign -> PUT -> POST /moods with photo_key
        # ============================================================
        client.cookies.clear()
        client.delete(f"{API}/moods/today", headers=hdr(admin_token))

        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_photo", "content_type": "image/jpeg"})
        if r.status_code != 200:
            record("roundtrip presign", False, f"{r.status_code}")
            return
        signed = r.json()
        rt_key = signed["key"]
        rt_url = signed["url"]
        rt_headers = signed["headers"]

        payload_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        with httpx.Client(timeout=30.0) as r2c:
            put_resp = r2c.put(rt_url, content=payload_bytes, headers=rt_headers)
        record("roundtrip R2 PUT bytes", put_resp.status_code in (200, 204),
               f"status={put_resp.status_code} body={put_resp.text[:200]}")

        client.cookies.clear()
        r = client.post(f"{API}/moods", headers=hdr(admin_token),
                        json={"emotion": "joy", "intensity": 3, "photo_key": rt_key})
        body = r.json() if r.status_code == 200 else {}
        mood_doc = body.get("mood", {}) if r.status_code == 200 else {}
        ok = r.status_code == 200
        record("POST /moods with photo_key -> 200", ok,
               f"status={r.status_code} body={r.text[:200] if not ok else ''}")
        signed_photo_url = mood_doc.get("photo_url")
        record("mood.photo_url present and signed",
               bool(signed_photo_url) and "X-Amz-Signature" in (signed_photo_url or ""),
               f"photo_url[:100]={(signed_photo_url or '')[:100]}")

        client.cookies.clear()
        r = client.get(f"{API}/moods/today", headers=hdr(admin_token))
        today_mood = (r.json() or {}).get("mood") or {}
        today_url = today_mood.get("photo_url")
        record("GET /moods/today returns photo_url", bool(today_url),
               f"key={today_mood.get('photo_key')}")

        if signed_photo_url:
            with httpx.Client(timeout=30.0) as r2c:
                gr = r2c.get(signed_photo_url)
            record("GET signed photo_url -> 200", gr.status_code == 200,
                   f"status={gr.status_code} bytes={len(gr.content)}")
            record("photo bytes round-trip integrity",
                   gr.status_code == 200 and gr.content[:3] == b"\xff\xd8\xff",
                   f"first3={gr.content[:3]!r}")

        # ============================================================
        # 4. /api/media/delete
        # ============================================================
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_photo", "content_type": "image/jpeg"})
        del_signed = r.json() if r.status_code == 200 else {}
        del_key = del_signed.get("key")
        if del_key:
            with httpx.Client(timeout=30.0) as r2c:
                r2c.put(del_signed["url"], content=b"\xff\xd8\xff\xe0test", headers=del_signed["headers"])
            client.cookies.clear()
            r = client.post(f"{API}/media/delete", headers=hdr(admin_token), json={"key": del_key})
            record("media.delete own object -> 200",
                   r.status_code == 200 and r.json().get("ok") is True,
                   f"status={r.status_code} body={r.text[:160]}")

        foreign_key = f"media/mood_photo/user_other_user_id_xxx/{uuid.uuid4().hex}.jpg"
        client.cookies.clear()
        r = client.post(f"{API}/media/delete", headers=hdr(admin_token), json={"key": foreign_key})
        record("media.delete foreign object -> 403",
               r.status_code == 403 and "Not your object" in r.text,
               f"status={r.status_code} body={r.text[:160]}")

        # ============================================================
        # 5. Messages with R2 photo_key (luna -> hello)
        # ============================================================
        if luna_token and admin_id:
            client.cookies.clear()
            client.post(f"{API}/friends/add", headers=hdr(luna_token), json={"email": ADMIN_EMAIL})
            client.cookies.clear()
            r = client.post(f"{API}/media/upload-url",
                            headers=hdr(luna_token),
                            json={"kind": "msg_photo", "content_type": "image/jpeg"})
            ok = r.status_code == 200
            msg_signed = r.json() if ok else {}
            record("media.upload-url msg_photo as luna", ok, f"status={r.status_code}")
            if ok:
                msg_key = msg_signed["key"]
                with httpx.Client(timeout=30.0) as r2c:
                    pr = r2c.put(msg_signed["url"], content=b"\xff\xd8\xff\xe0msg", headers=msg_signed["headers"])
                record("messages photo R2 PUT", pr.status_code in (200, 204), f"status={pr.status_code}")
                client.cookies.clear()
                r = client.post(f"{API}/messages/with/{admin_id}",
                                headers=hdr(luna_token),
                                json={"photo_key": msg_key})
                ok2 = r.status_code == 200
                msg_obj = (r.json() or {}).get("message", {}) if ok2 else {}
                record("POST /messages/with photo_key -> 200", ok2,
                       f"status={r.status_code} body={r.text[:200] if not ok2 else ''}")
                record("message.photo_url signed",
                       bool(msg_obj.get("photo_url")) and "X-Amz-Signature" in (msg_obj.get("photo_url") or ""),
                       f"photo_url[:80]={(msg_obj.get('photo_url') or '')[:80]}")
                client.cookies.clear()
                r = client.get(f"{API}/messages/with/{admin_id}", headers=hdr(luna_token))
                ok3 = r.status_code == 200
                msgs = (r.json() or {}).get("messages", []) if ok3 else []
                with_photo = [m for m in msgs if m.get("photo_key")]
                record("GET /messages/with returns photo_url",
                       ok3 and any(m.get("photo_url") for m in with_photo),
                       f"#with_photo={len(with_photo)}")

        # ============================================================
        # 6. Avatar with R2
        # ============================================================
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "avatar", "content_type": "image/jpeg"})
        av_ok = r.status_code == 200
        av_signed = r.json() if av_ok else {}
        record("media.upload-url avatar -> 200", av_ok, f"status={r.status_code}")
        if av_ok:
            av_key = av_signed["key"]
            with httpx.Client(timeout=30.0) as r2c:
                pr = r2c.put(av_signed["url"], content=b"\xff\xd8\xff\xe0avatar", headers=av_signed["headers"])
            record("avatar PUT to R2", pr.status_code in (200, 204), f"status={pr.status_code}")
            client.cookies.clear()
            r = client.post(f"{API}/profile/avatar", headers=hdr(admin_token),
                            json={"avatar_key": av_key})
            record("POST /profile/avatar avatar_key -> 200", r.status_code == 200, f"status={r.status_code}")
            client.cookies.clear()
            r = client.get(f"{API}/auth/me", headers=hdr(admin_token))
            me_user = r.json() if r.status_code == 200 else {}
            record("auth/me user.avatar_url populated",
                   bool(me_user.get("avatar_url")) and "X-Amz-Signature" in (me_user.get("avatar_url") or ""),
                   f"avatar_url[:80]={(me_user.get('avatar_url') or '')[:80]}")

        # ============================================================
        # 7. Mood audio fetch with R2
        # ============================================================
        client.cookies.clear()
        r = client.post(f"{API}/media/upload-url",
                        headers=hdr(admin_token),
                        json={"kind": "mood_audio", "content_type": "audio/m4a"})
        audio_ok = r.status_code == 200
        audio_signed = r.json() if audio_ok else {}
        record("media.upload-url mood_audio -> 200", audio_ok, f"status={r.status_code}")
        if audio_ok:
            audio_key = audio_signed["key"]
            with httpx.Client(timeout=30.0) as r2c:
                pr = r2c.put(audio_signed["url"], content=b"audio_bytes_test_payload", headers=audio_signed["headers"])
            record("audio PUT to R2", pr.status_code in (200, 204), f"status={pr.status_code}")
            client.cookies.clear()
            client.delete(f"{API}/moods/today", headers=hdr(admin_token))
            client.cookies.clear()
            r = client.post(f"{API}/moods", headers=hdr(admin_token),
                            json={"emotion": "joy", "intensity": 3, "audio_key": audio_key, "audio_seconds": 5})
            mood_id = (r.json() or {}).get("mood", {}).get("mood_id") if r.status_code == 200 else None
            record("POST /moods with audio_key -> 200", r.status_code == 200 and bool(mood_id),
                   f"status={r.status_code}")
            if mood_id:
                client.cookies.clear()
                r = client.get(f"{API}/moods/{mood_id}/audio", headers=hdr(admin_token))
                body = r.json() if r.status_code == 200 else {}
                record("GET /moods/{id}/audio returns audio_url (not b64)",
                       r.status_code == 200 and bool(body.get("audio_url")) and not body.get("audio_b64"),
                       f"keys={list(body.keys()) if r.status_code == 200 else r.status_code}")

        # ============================================================
        # 8. REGRESSION SWEEP
        # ============================================================
        log.info("--- REGRESSION SWEEP ---")
        client.cookies.clear()
        r = client.get(f"{API}/auth/me", headers=hdr(admin_token))
        record("regression /auth/me", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/account/export", headers=hdr(admin_token))
        record("regression /account/export", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/moods/today", headers=hdr(admin_token))
        record("regression /moods/today", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/moods/feed", headers=hdr(admin_token))
        record("regression /moods/feed", r.status_code == 200, f"locked={(r.json() or {}).get('locked')}")
        client.cookies.clear()
        r = client.get(f"{API}/moods/stats", headers=hdr(admin_token))
        body = r.json() if r.status_code == 200 else {}
        record("regression /moods/stats Pro ranges",
               r.status_code == 200 and "range_30" in body and "range_90" in body and "range_365" in body,
               f"keys={list(body.keys())[:8]}")
        client.cookies.clear()
        r = client.get(f"{API}/friends", headers=hdr(admin_token))
        record("regression /friends", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/friends/leaderboard", headers=hdr(admin_token))
        record("regression /friends/leaderboard", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/badges", headers=hdr(admin_token))
        record("regression /badges", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/messages/conversations", headers=hdr(admin_token))
        record("regression /messages/conversations", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/messages/unread-count", headers=hdr(admin_token))
        record("regression /messages/unread-count", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/admin/me", headers=hdr(admin_token))
        record("regression /admin/me", r.status_code == 200 and r.json().get("is_admin") is True)
        client.cookies.clear()
        r = client.get(f"{API}/admin/users/search?q=luna", headers=hdr(admin_token))
        record("regression /admin/users/search", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/admin/pro-grants", headers=hdr(admin_token))
        record("regression /admin/pro-grants", r.status_code == 200)
        client.cookies.clear()
        r = client.get(f"{API}/iap/status", headers=hdr(admin_token))
        record("regression /iap/status", r.status_code == 200)
        client.cookies.clear()
        r = client.post(f"{API}/iap/sync", headers=hdr(admin_token))
        record("regression /iap/sync", r.status_code == 200)
        client.cookies.clear()
        r = client.post(f"{API}/iap/webhook",
                        json={"event": {"id": f"evt_test_{uuid.uuid4().hex[:8]}", "type": "INITIAL_PURCHASE",
                                        "app_user_id": "user_xxx"}})
        record("regression /iap/webhook", r.status_code == 200)
        client.cookies.clear()
        r = client.post(f"{API}/payments/checkout", headers=hdr(admin_token), json={})
        body = r.json() if r.status_code == 200 else {}
        record("regression /payments/checkout origin fallback",
               r.status_code == 200 and "url" in body, f"status={r.status_code}")
        client.cookies.clear()
        r = client.get(f"{API}/music/search?q=ocean", headers=hdr(admin_token))
        body = r.json() if r.status_code == 200 else {}
        record("regression /music/search Pro admin",
               r.status_code == 200 and len(body.get("tracks") or []) > 0,
               f"#tracks={len(body.get('tracks') or [])}")
        client.cookies.clear()
        r = client.get(f"{API}/wellness/joy", headers=hdr(admin_token))
        body = r.json() if r.status_code == 200 else {}
        record("regression /wellness/joy",
               r.status_code == 200 and bool(body.get("quote")) and bool(body.get("advice")),
               f"source={body.get('source')}")
        client.cookies.clear()
        r = client.get(f"{API}/notifications/prefs", headers=hdr(admin_token))
        record("regression /notifications/prefs GET", r.status_code == 200)
        client.cookies.clear()
        r = client.post(f"{API}/notifications/prefs", headers=hdr(admin_token),
                        json={"reaction": True})
        record("regression /notifications/prefs POST", r.status_code == 200)

        # ============================================================
        # 9. Purge daemon log line
        # ============================================================
        try:
            with open("/var/log/supervisor/backend.err.log") as f:
                log_text = f.read()[-30000:]
            has_purge = bool(re.search(r"\[purge\]\s*\{", log_text))
            record("purge daemon log line present", has_purge,
                   "found '[purge] {' in backend.err.log" if has_purge else "missing '[purge]' line")
            err_count = len(re.findall(r"ERROR", log_text))
            record("backend.err.log ERROR count low", err_count < 5, f"count={err_count}")
        except Exception as e:
            record("purge daemon log check", False, str(e))


def finalize():
    log.info("\n" + "=" * 70)
    log.info(f"PASS: {len(PASS)}    FAIL: {len(FAIL)}")
    log.info("=" * 70)
    if FAIL:
        log.info("\nFAILURES:")
        for label, detail in FAIL:
            log.info(f"  - {label}  | {detail}")
    total = len(PASS) + len(FAIL)
    if total:
        log.info(f"\nPass rate: {len(PASS)}/{total} = {100.0 * len(PASS) / total:.1f}%")


if __name__ == "__main__":
    try:
        main()
    finally:
        finalize()
