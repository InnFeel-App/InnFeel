"""Session 16 backend test — DM upgrades.

Focus:
 1) Reply-to persistence (POST /messages/with/{peer_id} accepts + echoes + GET list retains).
 2) Plain message backward compat.
 3) Validation: reply_preview > 140 chars → 422.
 4) Validation: reply_to > 32 chars → 422.
 5) Reaction emoji set: clap / hundred (replaces) / touched / heart / invalid → 422 / toggle-off.
 6) Regression spot check on core endpoints.
"""
import sys
import asyncio
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
    tok = data.get("access_token")
    user = data.get("user", {})
    return tok, user


def auth_headers(tok):
    return {"Authorization": f"Bearer {tok}"}


async def aget(client, path, tok, **kwargs):
    client.cookies.clear()
    return await client.get(f"{BASE}{path}", headers=auth_headers(tok), **kwargs)


async def apost(client, path, tok, **kwargs):
    client.cookies.clear()
    return await client.post(f"{BASE}{path}", headers=auth_headers(tok), **kwargs)


async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        admin_tok, admin_user = await login(client, ADMIN_EMAIL, ADMIN_PWD)
        luna_tok, luna_user = await login(client, LUNA_EMAIL, LUNA_PWD)
        admin_id = admin_user["user_id"]
        luna_id = luna_user["user_id"]
        log("login.admin", bool(admin_tok) and admin_user.get("email") == ADMIN_EMAIL,
            f"admin_id={admin_id[:8]}…")
        log("login.luna", bool(luna_tok) and luna_user.get("email") == LUNA_EMAIL,
            f"luna_id={luna_id[:8]}…")

        # Ensure luna-admin are friends
        r = await aget(client, "/friends", luna_tok)
        friends = r.json().get("friends", []) if r.status_code == 200 else []
        admin_in_friends = any(f.get("user_id") == admin_id for f in friends)
        if not admin_in_friends:
            await apost(client, "/friends/add", luna_tok, json={"email": ADMIN_EMAIL})

        # ===== 1) Reply-to persistence =====
        fake_reply_to = "msg_xxxxxxxxxxxx"  # 16 chars
        body = {
            "text": "replying!",
            "reply_to": fake_reply_to,
            "reply_preview": "Original msg preview",
            "reply_sender_name": "Admin",
        }
        r = await apost(client, f"/messages/with/{admin_id}", luna_tok, json=body)
        posted_mid = None
        if r.status_code != 200:
            log("s1.post_reply.status", False, f"{r.status_code} {r.text[:200]}")
        else:
            data = r.json()
            msg = data.get("message", {})
            log("s1.post_reply.status", True, f"200 msg_id={msg.get('message_id')}")
            log("s1.reply_to_echo", msg.get("reply_to") == fake_reply_to, f"got={msg.get('reply_to')!r}")
            log("s1.reply_preview_echo", msg.get("reply_preview") == "Original msg preview",
                f"got={msg.get('reply_preview')!r}")
            log("s1.reply_sender_name_echo", msg.get("reply_sender_name") == "Admin",
                f"got={msg.get('reply_sender_name')!r}")
            posted_mid = msg.get("message_id")

            r2 = await aget(client, f"/messages/with/{admin_id}", luna_tok)
            msgs = r2.json().get("messages", []) if r2.status_code == 200 else []
            found = next((m for m in msgs if m.get("message_id") == posted_mid), None)
            log("s1.get_has_msg", found is not None, f"found={bool(found)}")
            if found:
                log("s1.get_reply_to", found.get("reply_to") == fake_reply_to, f"got={found.get('reply_to')!r}")
                log("s1.get_reply_preview", found.get("reply_preview") == "Original msg preview",
                    f"got={found.get('reply_preview')!r}")
                log("s1.get_reply_sender_name", found.get("reply_sender_name") == "Admin",
                    f"got={found.get('reply_sender_name')!r}")

        # ===== 2) Plain message (no reply fields) =====
        r = await apost(client, f"/messages/with/{admin_id}", luna_tok, json={"text": "plain"})
        if r.status_code != 200:
            log("s2.plain.status", False, f"{r.status_code} {r.text[:200]}")
        else:
            msg = r.json().get("message", {})
            log("s2.plain.status", True, "200")
            log("s2.plain.reply_to_null_or_absent", msg.get("reply_to") in (None, "", False),
                f"reply_to={msg.get('reply_to')!r}")
            log("s2.plain.reply_preview_null_or_absent", msg.get("reply_preview") in (None, "", False),
                f"reply_preview={msg.get('reply_preview')!r}")
            log("s2.plain.reply_sender_name_null_or_absent", msg.get("reply_sender_name") in (None, "", False),
                f"reply_sender_name={msg.get('reply_sender_name')!r}")

        # ===== 3) Validation: reply_preview > 140 chars → 422 =====
        r = await apost(
            client, f"/messages/with/{admin_id}", luna_tok,
            json={"text": "hi", "reply_preview": "x" * 200},
        )
        log("s3.reply_preview_too_long_422", r.status_code == 422, f"got {r.status_code} {r.text[:200]}")

        # ===== 4) Validation: reply_to > 32 chars → 422 =====
        r = await apost(
            client, f"/messages/with/{admin_id}", luna_tok,
            json={"text": "hi", "reply_to": "a" * 50},
        )
        log("s4.reply_to_too_long_422", r.status_code == 422, f"got {r.status_code} {r.text[:200]}")

        # ===== 5) Reaction emoji set =====
        r = await aget(client, f"/messages/with/{admin_id}", luna_tok)
        msgs = r.json().get("messages", []) if r.status_code == 200 else []
        if not msgs:
            log("s5.setup", False, "no messages in convo to react to")
        else:
            # Use the most recent message for reactions
            target = msgs[-1]
            mid = target["message_id"]
            log("s5.setup", True, f"target={mid}")

            async def react(emoji):
                return await apost(client, f"/messages/{mid}/react", luna_tok, json={"emoji": emoji})

            # Clean slate: if luna has an existing reaction, toggle it off first
            existing = [x for x in (target.get("reactions") or []) if x.get("user_id") == luna_id]
            if existing:
                # toggle off by posting same emoji
                await react(existing[0]["emoji"])

            # clap
            r = await react("clap")
            if r.status_code != 200:
                log("s5.clap_200", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                has_clap = any(x.get("user_id") == luna_id and x.get("emoji") == "clap" for x in reactions)
                log("s5.clap_200", has_clap, f"luna_clap={has_clap} reactions={reactions}")

            # hundred (replaces clap)
            r = await react("hundred")
            if r.status_code != 200:
                log("s5.hundred_replaces", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                luna_reacts = [x for x in reactions if x.get("user_id") == luna_id]
                only_hundred = len(luna_reacts) == 1 and luna_reacts[0].get("emoji") == "hundred"
                log("s5.hundred_replaces", only_hundred, f"luna_reacts={luna_reacts}")

            # touched
            r = await react("touched")
            if r.status_code != 200:
                log("s5.touched_200", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                luna_reacts = [x for x in reactions if x.get("user_id") == luna_id]
                only_touched = len(luna_reacts) == 1 and luna_reacts[0].get("emoji") == "touched"
                log("s5.touched_200", only_touched, f"luna_reacts={luna_reacts}")

            # heart
            r = await react("heart")
            if r.status_code != 200:
                log("s5.heart_200", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                luna_reacts = [x for x in reactions if x.get("user_id") == luna_id]
                only_heart = len(luna_reacts) == 1 and luna_reacts[0].get("emoji") == "heart"
                log("s5.heart_200", only_heart, f"luna_reacts={luna_reacts}")

            # invalid
            r = await apost(client, f"/messages/{mid}/react", luna_tok, json={"emoji": "xyz"})
            log("s5.invalid_422", r.status_code == 422, f"got {r.status_code} {r.text[:200]}")

            # current is 'heart'. Post touched to set current to touched, then touched again to toggle off.
            r = await react("touched")
            if r.status_code != 200:
                log("s5.prep_touched_for_toggle", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                luna_reacts = [x for x in reactions if x.get("user_id") == luna_id]
                is_touched = len(luna_reacts) == 1 and luna_reacts[0].get("emoji") == "touched"
                log("s5.prep_touched_for_toggle", is_touched, f"luna_reacts={luna_reacts}")

            r = await react("touched")
            if r.status_code != 200:
                log("s5.touched_toggle_off_200", False, f"{r.status_code} {r.text[:200]}")
            else:
                reactions = r.json().get("reactions", [])
                luna_reacts = [x for x in reactions if x.get("user_id") == luna_id]
                log("s5.touched_toggle_off_removed", len(luna_reacts) == 0,
                    f"luna_reacts after toggle-off={luna_reacts}")

        # ===== 6) Regression spot-checks =====
        r = await aget(client, "/auth/me", admin_tok)
        log("s6.auth_me_admin", r.status_code == 200 and r.json().get("email") == ADMIN_EMAIL,
            f"{r.status_code}")

        r = await aget(client, "/moods/today", luna_tok)
        log("s6.moods_today_luna", r.status_code == 200, f"{r.status_code}")

        r = await aget(client, "/moods/feed", luna_tok)
        log("s6.moods_feed_luna", r.status_code == 200, f"{r.status_code}")

        r = await aget(client, "/friends", luna_tok)
        log("s6.friends_luna", r.status_code == 200,
            f"{r.status_code} count={len(r.json().get('friends', []))}")

        r = await aget(client, "/messages/unread-count", luna_tok)
        body = r.json() if r.status_code == 200 else {}
        log("s6.messages_unread_count",
            r.status_code == 200 and "total" in body and "conversations" in body,
            f"{r.status_code} {body}")

        r = await aget(client, "/messages/conversations", luna_tok)
        log("s6.messages_conversations",
            r.status_code == 200 and isinstance(r.json().get("conversations"), list),
            f"{r.status_code}")

    print()
    print(f"=== RESULT: {OK} passed, {FAIL} failed ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
