"""Session 18 backend test — DM reaction emoji expansion + close-friends-first feed sort."""
import asyncio
import sys
from typing import Optional
import httpx

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"
ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"

results = []


def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name} :: {detail}")


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def login(client: httpx.AsyncClient, email: str, password: str) -> Optional[dict]:
    r = await client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        rec(f"login {email}", False, f"status={r.status_code} body={r.text[:200]}")
        return None
    body = r.json()
    rec(f"login {email}", True, f"user_id={body.get('user',{}).get('user_id','?')}")
    client.cookies.clear()
    return body


async def get_me(client: httpx.AsyncClient, token: str) -> dict:
    client.cookies.clear()
    r = await client.get(f"{BASE}/auth/me", headers=H(token))
    return r.json() if r.status_code == 200 else {}


async def ensure_pro(client: httpx.AsyncClient, token: str, who: str):
    me = await get_me(client, token)
    if me.get("pro"):
        rec(f"{who} already Pro", True, f"pro_source={me.get('pro_source')}")
        return
    client.cookies.clear()
    r = await client.post(f"{BASE}/dev/toggle-pro", headers=H(token))
    rec(f"{who} dev/toggle-pro to Pro",
        r.status_code == 200 and r.json().get("pro") is True,
        f"status={r.status_code} body={r.text[:160]}")


async def ensure_today_mood(client: httpx.AsyncClient, token: str, who: str,
                            emotion="joy", word="ok"):
    client.cookies.clear()
    r = await client.get(f"{BASE}/moods/today", headers=H(token))
    if r.status_code == 200 and (r.json() or {}).get("mood"):
        rec(f"{who} today mood exists", True,
            f"mood_id={r.json()['mood'].get('mood_id')}")
        return r.json()["mood"]
    client.cookies.clear()
    r = await client.post(
        f"{BASE}/moods", headers=H(token),
        json={"word": word, "emotion": emotion, "intensity": 3, "privacy": "friends"},
    )
    ok = r.status_code == 200
    rec(f"{who} POST /moods today", ok, f"status={r.status_code} body={r.text[:160]}")
    return r.json().get("mood") if ok else None


async def ensure_friends(client: httpx.AsyncClient, admin_tok: str):
    client.cookies.clear()
    r = await client.post(f"{BASE}/friends/add", headers=H(admin_tok),
                          json={"email": LUNA_EMAIL})
    rec("admin /friends/add luna (idempotent)",
        r.status_code in (200, 400),
        f"status={r.status_code} body={r.text[:160]}")


async def get_or_create_message_luna_to_friend(client: httpx.AsyncClient,
                                               luna_tok: str, peer_id: str):
    client.cookies.clear()
    r = await client.post(f"{BASE}/messages/with/{peer_id}", headers=H(luna_tok),
                          json={"text": "session 18 reaction test"})
    if r.status_code != 200:
        rec("luna POST /messages/with/peer", False,
            f"status={r.status_code} body={r.text[:200]}")
        return None
    msg_id = r.json().get("message", {}).get("message_id")
    rec("luna POST /messages/with/peer", bool(msg_id), f"message_id={msg_id}")
    return msg_id


async def react(client: httpx.AsyncClient, tok: str, msg_id: str, emoji: str):
    client.cookies.clear()
    return await client.post(f"{BASE}/messages/{msg_id}/react",
                             headers=H(tok), json={"emoji": emoji})


async def main():
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
        admin_body = await login(client, ADMIN_EMAIL, ADMIN_PASS)
        luna_body = await login(client, LUNA_EMAIL, LUNA_PASS)
        if not admin_body or not luna_body:
            print("FATAL: login failed")
            return
        admin_tok = admin_body["access_token"]
        luna_tok = luna_body["access_token"]
        admin_id = admin_body["user"]["user_id"]
        luna_id = luna_body["user"]["user_id"]

        await ensure_friends(client, admin_tok)

        # ----- (a) DM reactions: 4 new emojis + invalid -----
        msg_id = await get_or_create_message_luna_to_friend(client, luna_tok, admin_id)
        if msg_id:
            for emoji in ("love_eyes", "pray", "rainbow", "hug_arms"):
                r = await react(client, luna_tok, msg_id, emoji)
                ok = r.status_code == 200
                if ok:
                    body = r.json()
                    reactions = body.get("reactions") or []
                    has_luna = any(
                        rr.get("user_id") == luna_id and rr.get("emoji") == emoji
                        for rr in reactions
                    )
                    luna_count = sum(1 for rr in reactions if rr.get("user_id") == luna_id)
                    rec(f"react emoji={emoji}",
                        ok and has_luna and luna_count == 1,
                        f"status={r.status_code} luna_count={luna_count} has={has_luna}")
                else:
                    rec(f"react emoji={emoji}", False,
                        f"status={r.status_code} body={r.text[:200]}")
            r = await react(client, luna_tok, msg_id, "bad_key_xyz")
            rec("react emoji=bad_key_xyz → 422",
                r.status_code == 422,
                f"status={r.status_code} body={r.text[:200]}")
        else:
            rec("DM reactions block", False, "no message_id")

        # ----- (b) Feed close-first sort -----
        await ensure_pro(client, luna_tok, "luna")
        await ensure_today_mood(client, luna_tok, "luna", "joy", "luna-test")
        await ensure_today_mood(client, admin_tok, "admin", "calm", "admin-test")

        # Toggle close on admin (we may need to call twice if it was already off after un-mark in earlier sessions)
        client.cookies.clear()
        r1 = await client.post(f"{BASE}/friends/close/{admin_id}", headers=H(luna_tok))
        rec("luna POST /friends/close/admin (toggle 1)",
            r1.status_code == 200,
            f"status={r1.status_code} body={r1.text[:200]}")
        is_close = (r1.json() or {}).get("is_close") if r1.status_code == 200 else None
        if is_close is False:
            client.cookies.clear()
            r1b = await client.post(f"{BASE}/friends/close/{admin_id}", headers=H(luna_tok))
            rec("luna POST /friends/close/admin (toggle ON)",
                r1b.status_code == 200 and (r1b.json() or {}).get("is_close") is True,
                f"status={r1b.status_code} body={r1b.text[:200]}")

        client.cookies.clear()
        r = await client.get(f"{BASE}/moods/feed", headers=H(luna_tok))
        if r.status_code == 200:
            items = (r.json() or {}).get("items") or []
            has_field = all("author_is_close" in it for it in items) if items else False
            first_admin_close = (
                len(items) > 0
                and items[0].get("user_id") == admin_id
                and items[0].get("author_is_close") is True
            )
            rec("GET /moods/feed → 200 (with items)", len(items) > 0,
                f"items={len(items)}")
            rec("All items carry author_is_close", has_field,
                f"missing={sum(1 for it in items if 'author_is_close' not in it)}")
            rec("items[0] is admin & author_is_close=true",
                first_admin_close,
                f"first={{user_id:{items[0].get('user_id') if items else None},"
                f" close:{items[0].get('author_is_close') if items else None}}}")
        else:
            rec("GET /moods/feed (close-first)", False,
                f"status={r.status_code} body={r.text[:200]}")

        # ----- (c) Fallback: un-mark close, all author_is_close=false -----
        client.cookies.clear()
        r2 = await client.post(f"{BASE}/friends/close/{admin_id}", headers=H(luna_tok))
        rec("luna POST /friends/close/admin (un-mark)",
            r2.status_code == 200 and (r2.json() or {}).get("is_close") is False,
            f"status={r2.status_code} body={r2.text[:200]}")

        client.cookies.clear()
        r = await client.get(f"{BASE}/moods/feed", headers=H(luna_tok))
        if r.status_code == 200:
            items = (r.json() or {}).get("items") or []
            all_false = all(it.get("author_is_close") is False for it in items)
            rec("Feed items all author_is_close=false after un-mark",
                all_false, f"items={len(items)}")
        else:
            rec("GET /moods/feed (fallback)", False,
                f"status={r.status_code} body={r.text[:200]}")

        # ----- (d) Regression spot-check -----
        client.cookies.clear()
        r = await client.get(f"{BASE}/auth/me", headers=H(admin_tok))
        rec("GET /auth/me (admin)",
            r.status_code == 200 and (r.json() or {}).get("email") == ADMIN_EMAIL,
            f"status={r.status_code}")

        client.cookies.clear()
        r = await client.get(f"{BASE}/friends", headers=H(luna_tok))
        if r.status_code == 200:
            friends = (r.json() or {}).get("friends") or []
            any_email = any("email" in f for f in friends)
            rec("/friends (luna) — no email field on rows",
                not any_email, f"count={len(friends)} any_email={any_email}")
        else:
            rec("/friends (luna)", False, f"status={r.status_code}")

        client.cookies.clear()
        r = await client.get(f"{BASE}/moods/today", headers=H(luna_tok))
        luna_mood = (r.json() or {}).get("mood") if r.status_code == 200 else None
        if luna_mood:
            mid = luna_mood.get("mood_id")
            client.cookies.clear()
            r = await client.post(f"{BASE}/share/reel/{mid}", headers=H(luna_tok))
            ok = r.status_code == 200 and (r.json() or {}).get("ok") is True
            rec("POST /share/reel/{luna_mood_id} (owner)", ok,
                f"status={r.status_code} body={r.text[:240]}")
        else:
            rec("POST /share/reel owner check", False, "luna mood not available")

        client.cookies.clear()
        r = await client.get(f"{BASE}/notifications/prefs", headers=H(luna_tok))
        if r.status_code == 200:
            body = r.json() or {}
            prefs = body.get("prefs") if "prefs" in body else body
            rec("/notifications/prefs (luna) includes weekly_recap",
                "weekly_recap" in prefs,
                f"keys={list(prefs.keys())}")
        else:
            rec("/notifications/prefs (luna)", False, f"status={r.status_code}")

        # ----- SUMMARY -----
        passed = sum(1 for _, ok, _ in results if ok)
        total = len(results)
        print("\n" + "=" * 78)
        print(f"SESSION 18 RESULTS: {passed}/{total} PASS")
        print("=" * 78)
        for name, ok, detail in results:
            mark = "OK " if ok else "BAD"
            print(f"  [{mark}] {name}  -- {detail}")


if __name__ == "__main__":
    asyncio.run(main())
