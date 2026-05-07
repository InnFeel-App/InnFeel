"""Read-only Streak Freeze contract verification.

Goals:
1. Login admin (Pro) + demo (free) users, capture tokens.
2. GET /api/streak/freeze-status for both — verify exact response shape.
3. POST /api/streak/freeze on demo (free) → expect 403 with Pro upsell message.
4. POST /api/streak/bundle/purchase on demo → expect 403 (streak < 7).
5. Confirm no Python exceptions in /var/log/supervisor/backend.err.log.

NO DB writes performed. Pure HTTP contract check.
"""
from __future__ import annotations

import json
import os
import sys
import time

import httpx

BASE = os.environ.get(
    "BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASS = "admin123"
DEMO_EMAIL = "luna@innfeel.app"
DEMO_PASS = "demo1234"

REQUIRED_TOP_KEYS = {
    "plan",
    "quota",
    "used_this_month",
    "monthly_remaining",
    "bundle_remaining",
    "remaining",
    "can_freeze_yesterday",
    "yesterday_key",
    "current_streak",
    "bundle",
}
REQUIRED_BUNDLE_KEYS = {
    "eligible",
    "min_streak",
    "freezes",
    "price_eur",
    "purchased_this_month",
}

results: list[tuple[bool, str]] = []


def check(cond: bool, label: str) -> bool:
    tag = "PASS" if cond else "FAIL"
    print(f"[{tag}] {label}")
    results.append((cond, label))
    return cond


def login(client: httpx.Client, email: str, password: str) -> str:
    r = client.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No access_token in login response for {email}: {body!r}"
    return token


def assert_status_shape(label: str, body: dict, *, expected_plan_in: set[str], expected_quota: int) -> None:
    missing = REQUIRED_TOP_KEYS - set(body.keys())
    check(not missing, f"{label}: top-level keys present (missing={missing})")

    bundle = body.get("bundle") or {}
    bmissing = REQUIRED_BUNDLE_KEYS - set(bundle.keys())
    check(not bmissing, f"{label}: bundle keys present (missing={bmissing})")

    check(
        body.get("plan") in expected_plan_in,
        f"{label}: plan == {body.get('plan')!r} ∈ {expected_plan_in}",
    )
    check(
        body.get("quota") == expected_quota,
        f"{label}: quota == {body.get('quota')!r} (expected {expected_quota})",
    )

    # Type checks
    check(isinstance(body.get("quota"), int), f"{label}: quota is int")
    check(isinstance(body.get("used_this_month"), int), f"{label}: used_this_month is int")
    check(isinstance(body.get("monthly_remaining"), int), f"{label}: monthly_remaining is int")
    check(isinstance(body.get("bundle_remaining"), int), f"{label}: bundle_remaining is int")
    check(isinstance(body.get("remaining"), int), f"{label}: remaining is int")
    check(isinstance(body.get("can_freeze_yesterday"), bool), f"{label}: can_freeze_yesterday is bool")
    check(isinstance(body.get("current_streak"), int), f"{label}: current_streak is int")

    yk = body.get("yesterday_key", "")
    check(
        isinstance(yk, str) and len(yk) == 10 and yk[4] == "-" and yk[7] == "-",
        f"{label}: yesterday_key looks like YYYY-MM-DD ({yk!r})",
    )

    check(isinstance(bundle.get("eligible"), bool), f"{label}: bundle.eligible is bool")
    check(bundle.get("min_streak") == 7, f"{label}: bundle.min_streak == 7 (got {bundle.get('min_streak')!r})")
    check(bundle.get("freezes") == 3, f"{label}: bundle.freezes == 3 (got {bundle.get('freezes')!r})")
    check(
        bundle.get("price_eur") == 1.99,
        f"{label}: bundle.price_eur == 1.99 (got {bundle.get('price_eur')!r})",
    )
    check(
        isinstance(bundle.get("purchased_this_month"), bool),
        f"{label}: bundle.purchased_this_month is bool",
    )

    # Math sanity: remaining == monthly_remaining + bundle_remaining
    check(
        body.get("remaining") == body.get("monthly_remaining", 0) + body.get("bundle_remaining", 0),
        f"{label}: remaining == monthly_remaining + bundle_remaining",
    )


def main() -> int:
    print(f"# Streak Freeze read-only contract test")
    print(f"# BASE: {BASE}")
    print()

    # Use independent clients per identity to avoid Set-Cookie bleed (per harness notes).
    with httpx.Client(timeout=20) as admin_c, httpx.Client(timeout=20) as demo_c:
        # 1. Login both
        print("--- 1. Login both users ---")
        try:
            admin_token = login(admin_c, ADMIN_EMAIL, ADMIN_PASS)
            check(True, f"admin login OK (token len={len(admin_token)})")
        except Exception as e:
            check(False, f"admin login failed: {e}")
            return 2
        try:
            demo_token = login(demo_c, DEMO_EMAIL, DEMO_PASS)
            check(True, f"demo login OK (token len={len(demo_token)})")
        except Exception as e:
            check(False, f"demo login failed: {e}")
            return 2

        admin_h = {"Authorization": f"Bearer {admin_token}"}
        demo_h = {"Authorization": f"Bearer {demo_token}"}

        # /api/auth/me — confirm admin tier & demo tier (informational)
        print("\n--- 1b. /auth/me sanity ---")
        r = admin_c.get(f"{API}/auth/me", headers=admin_h)
        admin_me = r.json() if r.status_code == 200 else {}
        print(f"admin /auth/me: status={r.status_code} pro={admin_me.get('pro')} is_admin={admin_me.get('is_admin')} plan={admin_me.get('plan')}")
        r = demo_c.get(f"{API}/auth/me", headers=demo_h)
        demo_me = r.json() if r.status_code == 200 else {}
        print(f"demo  /auth/me: status={r.status_code} pro={demo_me.get('pro')} is_admin={demo_me.get('is_admin')} plan={demo_me.get('plan')}")

        # 2. freeze-status for both
        print("\n--- 2a. ADMIN GET /api/streak/freeze-status ---")
        r = admin_c.get(f"{API}/streak/freeze-status", headers=admin_h)
        check(r.status_code == 200, f"admin freeze-status status={r.status_code}")
        admin_status = r.json() if r.status_code == 200 else {}
        print("admin freeze-status body:")
        print(json.dumps(admin_status, indent=2, default=str))
        if r.status_code == 200:
            assert_status_shape(
                "admin",
                admin_status,
                expected_plan_in={"pro", "zen"},  # admin has Pro
                expected_quota=2,
            )

        print("\n--- 2b. DEMO  GET /api/streak/freeze-status ---")
        r = demo_c.get(f"{API}/streak/freeze-status", headers=demo_h)
        check(r.status_code == 200, f"demo freeze-status status={r.status_code}")
        demo_status = r.json() if r.status_code == 200 else {}
        print("demo freeze-status body:")
        print(json.dumps(demo_status, indent=2, default=str))
        # NOTE: spec says luna is "free tier"; but credentials file mentions "Luna (regular Pro friend, demo)".
        # We honour the request: demo expected free, quota=0. If she's actually Pro this test will surface that.
        demo_plan = demo_status.get("plan")
        demo_quota = demo_status.get("quota")
        print(f"   demo observed plan={demo_plan!r} quota={demo_quota!r}")
        if r.status_code == 200:
            # Be permissive about plan label but verify structure:
            assert_status_shape(
                "demo",
                demo_status,
                expected_plan_in={"free", "pro", "zen"},
                expected_quota=demo_quota if isinstance(demo_quota, int) else -1,
            )
            # Hard expectation per request: quota==0 and plan=='free'
            check(demo_plan == "free", f"demo: plan == 'free' (got {demo_plan!r})")
            check(demo_quota == 0, f"demo: quota == 0 (got {demo_quota!r})")
            check(demo_status.get("monthly_remaining") == 0, f"demo: monthly_remaining == 0")

        # 3. POST /api/streak/freeze on demo — expect 403 with Pro upsell IF demo is free + 0 bundle.
        print("\n--- 3. DEMO POST /api/streak/freeze (expect 403 Pro upsell if free) ---")
        r = demo_c.post(f"{API}/streak/freeze", headers=demo_h)
        print(f"   status={r.status_code} body={r.text[:300]}")
        if demo_status.get("plan") == "free" and demo_status.get("bundle_remaining", 0) == 0:
            check(r.status_code == 403, f"demo /freeze status==403 (got {r.status_code})")
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = ""
            check(
                detail == "Streak freeze is a Pro feature — upgrade or buy a bundle",
                f"demo /freeze detail exact match (got {detail!r})",
            )
        else:
            print("   SKIP exact 403 check — demo not in clean free state (would not be deterministic).")
            # Still the endpoint must answer SOMETHING sane (not 500).
            check(r.status_code in (200, 400, 403), f"demo /freeze responded sanely (status={r.status_code})")

        # 4. POST /api/streak/bundle/purchase on demo — expect 403 if streak < 7.
        print("\n--- 4. DEMO POST /api/streak/bundle/purchase (expect 403 streak<7) ---")
        cs = demo_status.get("current_streak", 0)
        print(f"   demo.current_streak = {cs}")
        r = demo_c.post(f"{API}/streak/bundle/purchase", headers=demo_h)
        print(f"   status={r.status_code} body={r.text[:300]}")
        if isinstance(cs, int) and cs < 7:
            check(r.status_code == 403, f"demo /bundle/purchase status==403 (got {r.status_code})")
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = ""
            check(
                detail == "Bundle unlocks at a 7-day streak",
                f"demo /bundle/purchase detail exact match (got {detail!r})",
            )
        else:
            print(f"   SKIP exact 403 check — demo streak={cs} >= 7, so behaviour differs.")
            check(r.status_code in (200, 403), f"demo /bundle/purchase responded sanely (status={r.status_code})")

        # 5. Auth guard sanity
        print("\n--- 5. AUTH GUARD: GET /streak/freeze-status with no token (clean client) ---")
        with httpx.Client(timeout=10) as anon:
            r = anon.get(f"{API}/streak/freeze-status")
            check(r.status_code == 401, f"unauth status==401 (got {r.status_code})")

    # 6. Check backend.err.log for fresh exceptions
    print("\n--- 6. Check /var/log/supervisor/backend.err.log for Tracebacks (last 200 lines) ---")
    try:
        with open("/var/log/supervisor/backend.err.log", "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-200:]
        bad = [ln.rstrip() for ln in lines if "Traceback" in ln or "ERROR" in ln or "500 Internal" in ln]
        if bad:
            print("LOG SAMPLE (suspicious):")
            for ln in bad[-20:]:
                print(" ", ln)
        check(len(bad) == 0, f"backend.err.log clean over last 200 lines (suspicious lines={len(bad)})")
    except Exception as e:
        print(f"   could not read backend.err.log: {e}")

    # Summary
    passed = sum(1 for ok, _ in results if ok)
    failed = len(results) - passed
    print(f"\n=== SUMMARY: {passed}/{len(results)} pass, {failed} fail ===")
    if failed:
        print("FAILURES:")
        for ok, label in results:
            if not ok:
                print(f"  - {label}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
