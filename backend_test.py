"""Backend test — Session 26: Meditation endpoints + new Coach quotas (5/day Pro, 20/day Zen)."""
import sys
import httpx
from typing import Optional

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PW = "admin123"
DEMO_EMAIL = "luna@innfeel.app"
DEMO_PW = "demo1234"

VALID_THEMES = ("sleep", "anxiety", "gratitude", "focus")

results = []


def log(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}  {detail}")
    results.append((ok, name, detail))


def login(client: httpx.Client, email: str, password: str) -> str:
    r = client.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["access_token"]


def make_client(token: Optional[str] = None) -> httpx.Client:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(timeout=60.0, headers=headers, cookies=None)


def auth():
    print("\n=== LOGIN ===")
    with httpx.Client(timeout=15.0) as c:
        admin_tok = login(c, ADMIN_EMAIL, ADMIN_PW)
        demo_tok = login(c, DEMO_EMAIL, DEMO_PW)
    print(f"  admin token: {admin_tok[:24]}...")
    print(f"  demo  token: {demo_tok[:24]}...")
    return admin_tok, demo_tok


def test_eligibility(admin_tok: str, demo_tok: str):
    print("\n=== A — /meditation/eligibility ===")
    with make_client(admin_tok) as c:
        r = c.get(f"{BASE}/meditation/eligibility")
    log("A1 admin GET /meditation/eligibility status=200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        b = r.json()
        print(f"  admin body: {b}")
        log("A1.tier == 'pro'", b.get("tier") == "pro", f"tier={b.get('tier')}")
        log("A1.unlimited == True", b.get("unlimited") is True, f"unlimited={b.get('unlimited')}")
        log("A1.used == []", b.get("used") == [], f"used={b.get('used')}")
        log("A1.remaining matches all themes", set(b.get("remaining") or []) == set(VALID_THEMES), f"remaining={b.get('remaining')}")
        log("A1.themes == sleep/anxiety/gratitude/focus", set(b.get("themes") or []) == set(VALID_THEMES), f"themes={b.get('themes')}")

    with make_client(demo_tok) as c:
        r = c.get(f"{BASE}/meditation/eligibility")
    log("A2 demo GET /meditation/eligibility status=200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    demo_used_initial = []
    demo_tier = None
    if r.status_code == 200:
        b = r.json()
        print(f"  demo body: {b}")
        demo_tier = b.get("tier")
        # NOTE: per env note, luna may currently be Pro (admin grant leftovers).
        # We log the actual tier and adapt the rest of the test to whatever the server says.
        log("A2.tier present", demo_tier in ("free", "pro", "zen"), f"tier={demo_tier}")
        log("A2.themes set complete", set(b.get("themes") or []) == set(VALID_THEMES), f"themes={b.get('themes')}")
        demo_used_initial = b.get("used") or []
        if demo_tier == "free":
            log("A2.unlimited == False", b.get("unlimited") is False, f"unlimited={b.get('unlimited')}")
            if demo_used_initial:
                print(f"  ⚠️  demo already has used trials from prior session: {demo_used_initial}")
        else:
            print(f"  ⚠️  demo tier is '{demo_tier}' (expected 'free' per spec). Likely leftover Pro grant in env.")
            log("A2.unlimited == True (since tier=pro)", b.get("unlimited") is True, f"unlimited={b.get('unlimited')}")
        expected_remaining = [t for t in VALID_THEMES if t not in demo_used_initial]
        log(
            "A2.remaining == themes - used",
            set(b.get("remaining") or []) == set(expected_remaining),
            f"remaining={b.get('remaining')} expected={expected_remaining}",
        )
    return demo_used_initial, demo_tier


def test_start(admin_tok: str, demo_tok: str, demo_used_initial: list, demo_tier: str):
    print("\n=== B — /meditation/start ===")

    if demo_tier != "free":
        # Demo is currently Pro — start always returns consumed:false.
        print("  demo is not 'free' — running B as a Pro pass-through assertion")
        with make_client(demo_tok) as c:
            r = c.post(f"{BASE}/meditation/start", json={"theme": "sleep"})
        log("B-pro demo POST start theme=sleep → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            b = r.json()
            log("B-pro.consumed == False", b.get("consumed") is False, f"body={b}")

    else:
        candidates = [t for t in VALID_THEMES if t not in demo_used_initial]
        if not candidates:
            log("B0 demo has at least one fresh theme", False, f"all themes consumed: used={demo_used_initial}")
            theme_to_use = None
        else:
            theme_to_use = candidates[0]
            print(f"  using theme '{theme_to_use}' for demo consumption test")

            # B3 — first POST start
            with make_client(demo_tok) as c:
                r = c.post(f"{BASE}/meditation/start", json={"theme": theme_to_use})
            log(f"B3 demo POST start theme={theme_to_use} → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
            if r.status_code == 200:
                b = r.json()
                print(f"  B3 body: {b}")
                log("B3.ok==True", b.get("ok") is True, "")
                log("B3.tier=='free'", b.get("tier") == "free", f"tier={b.get('tier')}")
                log("B3.consumed==True", b.get("consumed") is True, f"consumed={b.get('consumed')}")
                log(f"B3.theme=='{theme_to_use}'", b.get("theme") == theme_to_use, f"theme={b.get('theme')}")

            # B4 — same theme again → 402
            with make_client(demo_tok) as c:
                r = c.post(f"{BASE}/meditation/start", json={"theme": theme_to_use})
            log(f"B4 re-call theme={theme_to_use} → 402", r.status_code == 402, f"got {r.status_code}: {r.text[:200]}")
            if r.status_code == 402:
                try:
                    detail = r.json().get("detail", "")
                except Exception:
                    detail = r.text
                log("B4 detail mentions 'Upgrade to Pro'", "Upgrade to Pro" in detail, f"detail={detail}")

            # B5 — eligibility now lists the just-used theme
            with make_client(demo_tok) as c:
                r = c.get(f"{BASE}/meditation/eligibility")
            if r.status_code == 200:
                b = r.json()
                used = b.get("used") or []
                log(f"B5.used contains '{theme_to_use}'", theme_to_use in used, f"used={used}")
                log(f"B5.remaining excludes '{theme_to_use}'", theme_to_use not in (b.get("remaining") or []), f"remaining={b.get('remaining')}")

    # B6 — bad theme always 400 regardless of tier
    with make_client(demo_tok) as c:
        r = c.post(f"{BASE}/meditation/start", json={"theme": "badtheme"})
    log("B6 demo POST start theme=badtheme → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 400:
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        log("B6 detail == 'Unknown meditation theme'", "Unknown meditation theme" in detail, f"detail={detail}")

    # B7 — admin (Pro) → consumed:false on any theme
    with make_client(admin_tok) as c:
        r = c.post(f"{BASE}/meditation/start", json={"theme": "focus"})
    log("B7 admin POST start theme=focus → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        b = r.json()
        print(f"  B7 body: {b}")
        log("B7.ok==True", b.get("ok") is True, "")
        log("B7.tier=='pro'", b.get("tier") == "pro", f"tier={b.get('tier')}")
        log("B7.consumed==False", b.get("consumed") is False, f"consumed={b.get('consumed')}")


def test_coach_quota(admin_tok: str):
    print("\n=== C — /coach/chat at 5/day Pro quota (shared with /journal/reflect) ===")

    with make_client(admin_tok) as c:
        r = c.get(f"{BASE}/coach/history")
    log("C0 GET /coach/history → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
    pre_quota_left = None
    if r.status_code == 200:
        b = r.json()
        pre_quota_left = b.get("quota_left")
        log("C0.tier=='pro'", b.get("tier") == "pro", f"tier={b.get('tier')}")
        print(f"  Pre-test admin quota_left = {pre_quota_left} (out of 5/day)")
        # The new quota is 5/day, so quota_left should be ≤ 5
        log("C0 quota_left ≤ 5 (new lower limit)", isinstance(pre_quota_left, int) and pre_quota_left <= 5, f"quota_left={pre_quota_left}")

    if not isinstance(pre_quota_left, int):
        log("C0 quota_left is int", False, "aborting C")
        return

    # Send pre_quota_left messages, expect all 200
    print(f"\n  --- Sending {pre_quota_left} chat messages (should all succeed) ---")
    success_count = 0
    last_quota_left = None
    for i in range(pre_quota_left):
        with make_client(admin_tok) as c:
            r = c.post(f"{BASE}/coach/chat", json={"text": f"Quick hi #{i+1}, just say 'hi'."}, timeout=90.0)
        if r.status_code == 200:
            success_count += 1
            try:
                b = r.json()
                last_quota_left = b.get("quota_left")
                print(f"    msg #{i+1}: 200 → quota_left={last_quota_left}, tier={b.get('tier')}")
            except Exception:
                pass
        else:
            print(f"    msg #{i+1}: {r.status_code} → {r.text[:300]}")
            break
    log(f"C1 sent {pre_quota_left} chat messages, all returned 200", success_count == pre_quota_left, f"got {success_count}/{pre_quota_left}")
    if success_count == pre_quota_left:
        log("C1.final quota_left == 0", last_quota_left == 0, f"quota_left after last successful = {last_quota_left}")

    # Boundary — next call must be 402
    print("\n  --- Boundary: next call should be 402 ---")
    with make_client(admin_tok) as c:
        r = c.post(f"{BASE}/coach/chat", json={"text": "hello"})
    log(f"C2 next /coach/chat → 402 (boundary)", r.status_code == 402, f"got {r.status_code}: {r.text[:300]}")
    detail_402 = ""
    if r.status_code == 402:
        try:
            detail_402 = r.json().get("detail", "")
        except Exception:
            detail_402 = r.text
        print(f"  402 detail: {detail_402!r}")
        log("C10 detail mentions 'AI credits'", "AI credits" in detail_402, f"detail={detail_402}")
        log("C10 detail mentions 'chat + journal'", "chat + journal" in detail_402, f"detail={detail_402}")
        log("C10 detail mentions '5'", "5" in detail_402, f"detail={detail_402}")

    # C9 — Shared counter: /journal/reflect should also 402
    print("\n  --- Shared counter via /journal/reflect ---")
    with make_client(admin_tok) as c:
        r0 = c.post(
            f"{BASE}/journal/checkin",
            json={"kind": "morning", "answers": {"intention": "Calm focus today."}, "note": "test"},
        )
        log("C9 prep: POST /journal/checkin → 200", r0.status_code == 200, f"got {r0.status_code}: {r0.text[:200]}")
        r = c.post(f"{BASE}/journal/reflect", json={"kind": "morning"})
    log("C9 POST /journal/reflect → 402 (shared counter exhausted)", r.status_code == 402, f"got {r.status_code}: {r.text[:300]}")
    if r.status_code == 402:
        try:
            d = r.json().get("detail", "")
        except Exception:
            d = r.text
        print(f"  402 detail: {d!r}")
        log("C9 detail mentions 'AI credits' or 'chat + journal'", ("AI credits" in d) or ("chat + journal" in d), f"detail={d}")


def test_regression(admin_tok: str, demo_tok: str):
    print("\n=== D — Regression /streak/freeze-status ===")
    with make_client(admin_tok) as c:
        r = c.get(f"{BASE}/streak/freeze-status")
    log("D1 admin GET /streak/freeze-status → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        b = r.json()
        for k in ("plan", "quota", "used_this_month", "monthly_remaining", "remaining", "current_streak", "bundle"):
            log(f"D1.{k} present", k in b, "")

    with make_client(demo_tok) as c:
        r = c.get(f"{BASE}/streak/freeze-status")
    log("D2 demo GET /streak/freeze-status → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")


def main():
    try:
        admin_tok, demo_tok = auth()
    except Exception as e:
        print(f"FATAL: login failed: {e}")
        sys.exit(1)

    demo_used, demo_tier = test_eligibility(admin_tok, demo_tok)
    test_start(admin_tok, demo_tok, demo_used, demo_tier)
    test_coach_quota(admin_tok)
    test_regression(admin_tok, demo_tok)

    print("\n" + "=" * 70)
    total = len(results)
    passed = sum(1 for ok, _, _ in results if ok)
    print(f"SUMMARY: {passed}/{total} PASS")
    fails = [(n, d) for ok, n, d in results if not ok]
    if fails:
        print("\nFAILS:")
        for n, d in fails:
            print(f"  - {n}  | {d}")
    print("=" * 70)


if __name__ == "__main__":
    main()
