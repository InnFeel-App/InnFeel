"""Session: NEW admin user-management endpoints validation.

Read-only style validation against the live preview backend. We only mutate
luna's tier (which is expected — the spec restores it at the end) and
luna's coach_limits collection via /admin/reset-quota. We do NOT modify
any code.
"""
from __future__ import annotations

import sys
from typing import Dict, Optional

import httpx

BASE = "https://charming-wescoff-8.preview.emergentagent.com/api"

ADMIN_EMAIL = "hello@innfeel.app"
ADMIN_PASSWORD = "admin123"
DEMO_EMAIL = "luna@innfeel.app"
DEMO_PASSWORD = "demo1234"

PASS = []
FAIL = []


def log(tag, name, ok, info=""):
    bullet = "PASS" if ok else "FAIL"
    msg = f"[{bullet}] {tag}: {name}"
    if info:
        msg += f"  | {info}"
    print(msg)
    (PASS if ok else FAIL).append((tag, name, info))


def login(client: httpx.Client, email: str, password: str) -> Optional[str]:
    r = client.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        print(f"login failed for {email}: {r.status_code} {r.text}")
        return None
    return r.json().get("access_token")


def H(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def main():
    admin = httpx.Client(timeout=30)
    demo = httpx.Client(timeout=30)
    naked = httpx.Client(timeout=30)

    admin_token = login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
    demo_token = login(demo, DEMO_EMAIL, DEMO_PASSWORD)

    if not admin_token or not demo_token:
        print("Cannot login — abort")
        sys.exit(1)

    AH = H(admin_token)
    DH = H(demo_token)

    # ── A) Stats overview ──────────────────────────────────────────────
    r = admin.get(f"{BASE}/admin/stats/overview", headers=AH)
    body = r.json() if r.status_code == 200 else {}
    log("A1", "GET /admin/stats/overview returns 200",
        r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        u = body.get("users", {})
        m = body.get("moods", {})
        g = body.get("grants", {})
        for k in ["total", "free", "pro", "zen", "admin", "verified", "new_7d", "new_30d", "dau", "wau"]:
            log("A1", f"users.{k} present and int",
                isinstance(u.get(k), int), f"value={u.get(k)}")
        for k in ["total", "today", "last_7d"]:
            log("A1", f"moods.{k} present and int",
                isinstance(m.get(k), int), f"value={m.get(k)}")
        log("A1", "grants.active present and int",
            isinstance(g.get("active"), int), f"value={g.get('active')}")
        log("A1", "as_of present (ISO string)",
            isinstance(body.get("as_of"), str) and "T" in body.get("as_of", ""),
            f"as_of={body.get('as_of')}")
        log("A1", "users.total >= 1", u.get("total", 0) >= 1, f"total={u.get('total')}")
        log("A1", "users.admin >= 1", u.get("admin", 0) >= 1, f"admin={u.get('admin')}")

    stats_admin_count = body.get("users", {}).get("admin", 0)

    # ── B) Users list ──────────────────────────────────────────────────
    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"page": 0, "page_size": 10})
    body = r.json() if r.status_code == 200 else {}
    log("B2", "GET /admin/users/list (no filter) → 200", r.status_code == 200,
        f"status={r.status_code}")
    if r.status_code == 200:
        for k in ["users", "total", "page", "page_size", "has_more"]:
            log("B2", f"key {k} present", k in body, f"keys={list(body.keys())}")
        log("B2", "users is a list", isinstance(body.get("users"), list))
        log("B2", "page_size honoured (≤10)", len(body.get("users", [])) <= 10,
            f"len={len(body.get('users', []))}")

    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"tier": "admin", "page_size": 50})
    body = r.json() if r.status_code == 200 else {}
    log("B3", "tier=admin → 200", r.status_code == 200, f"status={r.status_code}")
    users = body.get("users", [])
    if users:
        all_admin = all(u.get("is_admin") and u.get("tier") == "admin" for u in users)
        log("B3", "every returned user has tier=admin & is_admin=true",
            all_admin, f"n={len(users)}")
        log("B3", "count matches stats.users.admin",
            body.get("total") == stats_admin_count,
            f"list.total={body.get('total')} stats.admin={stats_admin_count}")

    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"tier": "pro", "page_size": 50})
    body = r.json() if r.status_code == 200 else {}
    log("B4", "tier=pro → 200", r.status_code == 200, f"status={r.status_code}")
    users = body.get("users", [])
    if users:
        ok = all(u.get("pro") and not u.get("zen") and not u.get("is_admin") for u in users)
        log("B4", "every row pro=true zen=false admin=false", ok, f"n={len(users)}")
        tiers = {u.get("tier") for u in users}
        log("B4", "all tiers == 'pro'", tiers == {"pro"}, f"tiers={tiers}")
    else:
        log("B4", "tier=pro returned empty (acceptable)", True, f"total={body.get('total')}")

    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"tier": "zen", "page_size": 50})
    body = r.json() if r.status_code == 200 else {}
    log("B5", "tier=zen → 200", r.status_code == 200, f"status={r.status_code}")
    users = body.get("users", [])
    if users:
        ok = all(u.get("zen") for u in users)
        log("B5", "every row zen=true", ok, f"n={len(users)}")
    else:
        log("B5", "tier=zen returned empty (acceptable)", True, f"total={body.get('total')}")

    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"q": "hello", "page_size": 20})
    body = r.json() if r.status_code == 200 else {}
    log("B6", "q=hello → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        emails = [u.get("email") for u in body.get("users", [])]
        log("B6", "admin email present in q=hello result",
            ADMIN_EMAIL in emails, f"emails={emails}")

    r = admin.get(f"{BASE}/admin/users/list", headers=AH,
                  params={"sort": "name", "page": 0, "page_size": 5})
    body = r.json() if r.status_code == 200 else {}
    log("B7", "sort=name → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        names = [u.get("name") or "" for u in body.get("users", [])]
        is_sorted = names == sorted(names, key=lambda s: (s or ""))
        log("B7", "results sorted ascending by name", is_sorted, f"names={names}")

    # ── C) User detail ─────────────────────────────────────────────────
    r = admin.get(f"{BASE}/auth/me", headers=AH)
    admin_uid = r.json().get("user_id") if r.status_code == 200 else None
    log("C-pre", "fetched admin user_id", bool(admin_uid), f"admin_uid={admin_uid}")

    r = admin.get(f"{BASE}/admin/users/{admin_uid}", headers=AH)
    body = r.json() if r.status_code == 200 else {}
    log("C8", "GET /admin/users/{admin_id} → 200", r.status_code == 200,
        f"status={r.status_code}")
    if r.status_code == 200:
        for k in ["user_id", "email", "name", "tier", "is_admin", "stats", "grants",
                  "meditation_trials_used"]:
            log("C8", f"key {k} present", k in body, f"keys={list(body.keys())[:25]}")
        stats = body.get("stats", {})
        for k in ["moods_total", "moods_7d", "friends", "current_streak",
                  "longest_streak", "last_mood", "coach_used_today", "coach_used_lifetime"]:
            log("C8", f"stats.{k} present", k in stats, f"stats keys={list(stats.keys())}")
        last_mood = stats.get("last_mood")
        log("C8", "stats.last_mood is dict-or-null",
            last_mood is None or isinstance(last_mood, dict),
            f"last_mood={type(last_mood).__name__}")
        log("C8", "grants is list", isinstance(body.get("grants"), list))
        log("C8", "meditation_trials_used is list",
            isinstance(body.get("meditation_trials_used"), list))

    r = admin.get(f"{BASE}/admin/users/nonexistent_id_12345", headers=AH)
    log("C9", "GET /admin/users/nonexistent_id_12345 → 404",
        r.status_code == 404, f"status={r.status_code} body={r.text[:200]}")

    # ── D) Grant / Revoke cycle on luna ────────────────────────────────
    r = admin.get(f"{BASE}/admin/users/list", headers=AH, params={"q": "luna", "page_size": 5})
    body = r.json() if r.status_code == 200 else {}
    luna_uid = None
    for u in body.get("users", []):
        if u.get("email") == DEMO_EMAIL:
            luna_uid = u.get("user_id")
            break
    log("D10", "discovered luna user_id via q=luna", bool(luna_uid),
        f"luna_uid={luna_uid}")

    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"user_id": luna_uid, "tier": "zen", "days": 30,
                         "note": "test grant via deep-testing"})
    body = r.json() if r.status_code == 200 else {}
    log("D11", "POST /admin/grant-tier zen 30d → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:300]}")
    log("D11", "response.expires_at present (ISO)",
        isinstance(body.get("expires_at"), str) and "T" in body.get("expires_at", ""),
        f"expires_at={body.get('expires_at')}")

    r = admin.get(f"{BASE}/admin/users/{luna_uid}", headers=AH)
    body = r.json() if r.status_code == 200 else {}
    log("D12", "luna detail tier=zen", body.get("tier") == "zen",
        f"tier={body.get('tier')}")
    log("D12", "luna pro=True", body.get("pro") is True, f"pro={body.get('pro')}")
    log("D12", "luna zen=True", body.get("zen") is True, f"zen={body.get('zen')}")

    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"user_id": luna_uid, "tier": "pro", "days": 7})
    log("D13", "POST /admin/grant-tier pro 7d → 200",
        r.status_code == 200, f"status={r.status_code}")

    r = admin.get(f"{BASE}/admin/users/{luna_uid}", headers=AH)
    body = r.json() if r.status_code == 200 else {}
    log("D14", "luna detail tier=pro", body.get("tier") == "pro",
        f"tier={body.get('tier')}")
    log("D14", "luna pro=True", body.get("pro") is True, f"pro={body.get('pro')}")
    log("D14", "luna zen=False (cleared by pro grant)",
        body.get("zen") is False, f"zen={body.get('zen')}")

    r = admin.post(f"{BASE}/admin/revoke-tier", headers=AH, json={"user_id": luna_uid})
    log("D15", "POST /admin/revoke-tier → 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")

    r = admin.get(f"{BASE}/admin/users/{luna_uid}", headers=AH)
    body = r.json() if r.status_code == 200 else {}
    log("D16", "luna detail tier=free", body.get("tier") == "free",
        f"tier={body.get('tier')}")
    log("D16", "luna pro=False", body.get("pro") is False, f"pro={body.get('pro')}")
    log("D16", "luna zen=False", body.get("zen") is False, f"zen={body.get('zen')}")
    grants = body.get("grants") or []
    if grants:
        log("D16", "last grant revoked=true", grants[0].get("revoked") is True,
            f"first grant revoked={grants[0].get('revoked')}")

    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"user_id": luna_uid, "tier": "zen", "days": 3650, "note": "restored"})
    log("D17", "POST /admin/grant-tier zen 3650d (restore) → 200",
        r.status_code == 200, f"status={r.status_code}")

    # ── E) Cannot revoke admin ─────────────────────────────────────────
    r = admin.post(f"{BASE}/admin/revoke-tier", headers=AH, json={"user_id": admin_uid})
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    log("E18", "revoke admin → 400", r.status_code == 400,
        f"status={r.status_code} detail={body.get('detail')}")
    log("E18", "detail == 'Cannot revoke an admin'",
        body.get("detail") == "Cannot revoke an admin",
        f"detail={body.get('detail')}")

    # ── F) Reset quota ─────────────────────────────────────────────────
    r = admin.post(f"{BASE}/admin/reset-quota", headers=AH, json={"user_id": luna_uid})
    body = r.json() if r.status_code == 200 else {}
    log("F19", "reset-quota luna → 200", r.status_code == 200,
        f"status={r.status_code} body={body}")
    log("F19", "response ok=true & deleted is int",
        body.get("ok") is True and isinstance(body.get("deleted"), int),
        f"body={body}")

    r = admin.post(f"{BASE}/admin/reset-quota", headers=AH,
                   json={"user_id": "nonexistent_id_xxx"})
    log("F20", "reset-quota nonexistent → 404",
        r.status_code == 404, f"status={r.status_code} body={r.text[:200]}")

    # ── G) Auth gate ───────────────────────────────────────────────────
    r = demo.get(f"{BASE}/admin/stats/overview", headers=DH)
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    log("G21", "demo GET /admin/stats/overview → 403",
        r.status_code == 403, f"status={r.status_code} detail={body.get('detail')}")
    log("G21", "detail == 'Admin access required'",
        body.get("detail") == "Admin access required",
        f"detail={body.get('detail')}")

    r = demo.post(f"{BASE}/admin/grant-tier", headers=DH,
                  json={"user_id": luna_uid, "tier": "pro", "days": 7})
    log("G22", "demo POST /admin/grant-tier → 403",
        r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")

    r = naked.get(f"{BASE}/admin/stats/overview")
    log("G23", "no token GET /admin/stats/overview → 401",
        r.status_code == 401, f"status={r.status_code} body={r.text[:200]}")

    # ── H) Models / validation ─────────────────────────────────────────
    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"user_id": luna_uid, "tier": "platinum", "days": 5})
    log("H24", "tier=platinum → 422", r.status_code == 422,
        f"status={r.status_code}")

    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"tier": "pro", "days": 7})
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    log("H25", "neither email nor user_id → 400", r.status_code == 400,
        f"status={r.status_code} detail={body.get('detail')}")
    log("H25", "detail == 'Either email or user_id required'",
        body.get("detail") == "Either email or user_id required",
        f"detail={body.get('detail')}")

    r = admin.post(f"{BASE}/admin/grant-tier", headers=AH,
                   json={"user_id": luna_uid, "tier": "pro", "days": 0})
    log("H26", "days=0 → 422", r.status_code == 422,
        f"status={r.status_code}")

    print()
    print(f"PASS: {len(PASS)}    FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFAILURES:")
        for tag, name, info in FAIL:
            print(f"  [{tag}] {name}  | {info}")


if __name__ == "__main__":
    main()
