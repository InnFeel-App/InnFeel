"""
Backend test for OWNER role + admin promote/demote endpoints (Jun 2025).
"""
from __future__ import annotations
import sys
import httpx


def _read_env(path: str, key: str) -> str:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith(f"{key}="):
                v = line.split("=", 1)[1].strip()
                return v.strip('"').strip("'")
    return ""


BASE = _read_env("/app/frontend/.env", "EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"
print(f"[test] BASE = {BASE}", flush=True)

OWNER_EMAIL = "hello@innfeel.app"
OWNER_PASS = "admin123"
LUNA_EMAIL = "luna@innfeel.app"
LUNA_PASS = "demo1234"
RIO_EMAIL = "rio@innfeel.app"

PASS = 0
FAIL = 0
FAILED: list[str] = []


def check(label: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label} -- {detail}")


def login(email: str, password: str) -> tuple[httpx.Client, str, dict]:
    """Fresh httpx.Client per identity to avoid cookie cross-talk; Bearer header pinned."""
    c = httpx.Client(base_url=BASE, timeout=20.0)
    r = c.post("/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        raise RuntimeError(f"Login failed for {email}: {r.status_code} {r.text}")
    body = r.json()
    c.headers["Authorization"] = f"Bearer {body['access_token']}"
    # Strip cookies so the Authorization header is the sole auth path on subsequent calls.
    c.cookies.clear()
    return c, body["access_token"], body["user"]


def main():
    print("\n=== 1. Owner /me shape ===")
    owner, owner_token, owner_user = login(OWNER_EMAIL, OWNER_PASS)
    r = owner.get("/auth/me")
    check("GET /auth/me 200 (owner)", r.status_code == 200, f"status={r.status_code}")
    me = r.json() if r.status_code == 200 else {}
    check("owner me.is_owner==True", me.get("is_owner") is True, f"got {me.get('is_owner')!r}")
    check("owner me.is_admin==True", me.get("is_admin") is True, f"got {me.get('is_admin')!r}")
    check("owner me.zen==True",      me.get("zen") is True,      f"got {me.get('zen')!r}")
    check("owner me.pro==True",      me.get("pro") is True,      f"got {me.get('pro')!r}")

    print("\n=== 2a. Owner blocks /admin/revoke-tier on owner (self) ===")
    r = owner.post("/admin/revoke-tier", json={"email": OWNER_EMAIL})
    check("owner-target revoke-tier → 400", r.status_code == 400, f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 400 else ""
    check("owner-target detail==The owner cannot be revoked.",
          detail == "The owner cannot be revoked.", f"detail={detail!r}")

    print("\n=== 3a. Owner promotes luna to admin ===")
    r = owner.post("/admin/grant-admin", json={"email": LUNA_EMAIL})
    check("owner /admin/grant-admin luna → 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    check("grant-admin ok==True", body.get("ok") is True, f"body={body}")
    check("grant-admin is_admin==True", body.get("is_admin") is True, f"body={body}")
    luna_id = body.get("user_id")
    check("grant-admin returned user_id",
          isinstance(luna_id, str) and luna_id.startswith("user_"), f"user_id={luna_id!r}")

    print("\n=== 3b. Verify luna detail after promotion ===")
    if luna_id:
        r = owner.get(f"/admin/users/{luna_id}")
        check("GET /admin/users/{luna_id} 200", r.status_code == 200, f"status={r.status_code}")
        d = r.json() if r.status_code == 200 else {}
        check("luna detail is_admin==True", d.get("is_admin") is True, f"got {d.get('is_admin')!r}")
        check("luna detail zen==True", d.get("zen") is True, f"got {d.get('zen')!r}")
        check("luna detail pro==True", d.get("pro") is True, f"got {d.get('pro')!r}")
        check("luna detail pro_source=='admin_promotion'",
              d.get("pro_source") == "admin_promotion", f"got {d.get('pro_source')!r}")

    print("\n=== 3c. grant-admin idempotent ===")
    r = owner.post("/admin/grant-admin", json={"email": LUNA_EMAIL})
    check("owner re-grant-admin luna → 200", r.status_code == 200, f"status={r.status_code}")
    body = r.json() if r.status_code == 200 else {}
    check("re-grant-admin already_admin==True", body.get("already_admin") is True, f"body={body}")

    print("\n=== 3d. Non-owner admin (luna) cannot grant-admin ===")
    luna_admin, _, luna_user = login(LUNA_EMAIL, LUNA_PASS)
    check("luna /me is_admin==True (post-promotion)", luna_user.get("is_admin") is True,
          f"got {luna_user.get('is_admin')!r}")
    check("luna /me is_owner==False", luna_user.get("is_owner") is False,
          f"got {luna_user.get('is_owner')!r}")
    r = luna_admin.post("/admin/grant-admin", json={"email": RIO_EMAIL})
    check("non-owner admin grant-admin → 403", r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 403 else ""
    check("non-owner grant-admin detail=='Owner access required'",
          detail == "Owner access required", f"detail={detail!r}")

    print("\n=== 2b. Non-owner admin can't revoke-tier on owner (400) ===")
    r = luna_admin.post("/admin/revoke-tier", json={"email": OWNER_EMAIL})
    check("non-owner admin revoke-tier OWNER → 400", r.status_code == 400,
          f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 400 else ""
    check("owner-target detail==The owner cannot be revoked.",
          detail == "The owner cannot be revoked.", f"detail={detail!r}")

    print("\n=== 4. Cross-admin guard: non-owner admin cannot revoke-tier on another admin ===")
    r = owner.post("/admin/grant-admin", json={"email": RIO_EMAIL})
    check("owner grant-admin rio → 200 (setup)", r.status_code == 200,
          f"status={r.status_code} body={r.text[:200]}")
    rio_id = (r.json() or {}).get("user_id") if r.status_code == 200 else None
    r = luna_admin.post("/admin/revoke-tier", json={"email": RIO_EMAIL})
    check("non-owner admin revoke-tier on another admin → 403", r.status_code == 403,
          f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 403 else ""
    check("cross-admin detail=='Only the owner can modify another admin's subscription.'",
          detail == "Only the owner can modify another admin's subscription.", f"detail={detail!r}")

    print("\n=== 5a. Non-owner admin (luna) cannot revoke-admin ===")
    r = luna_admin.post("/admin/revoke-admin", json={"email": RIO_EMAIL})
    check("non-owner revoke-admin → 403", r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 403 else ""
    check("non-owner revoke-admin detail=='Owner access required'",
          detail == "Owner access required", f"detail={detail!r}")

    print("\n=== 5b. Owner cannot demote owner ===")
    r = owner.post("/admin/revoke-admin", json={"email": OWNER_EMAIL})
    check("owner revoke-admin self → 400", r.status_code == 400,
          f"status={r.status_code} body={r.text[:200]}")
    detail = (r.json() or {}).get("detail", "") if r.status_code == 400 else ""
    check("self-demote detail=='The owner cannot be demoted.'",
          detail == "The owner cannot be demoted.", f"detail={detail!r}")

    print("\n=== 5c. Owner demotes luna ===")
    r = owner.post("/admin/revoke-admin", json={"email": LUNA_EMAIL})
    check("owner revoke-admin luna → 200", r.status_code == 200,
          f"status={r.status_code} body={r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    check("revoke-admin luna ok==True", body.get("ok") is True, f"body={body}")
    check("revoke-admin luna is_admin==False", body.get("is_admin") is False, f"body={body}")

    if luna_id:
        r = owner.get(f"/admin/users/{luna_id}")
        d = r.json() if r.status_code == 200 else {}
        check("post-demote luna is_admin==False", d.get("is_admin") is False, f"got {d.get('is_admin')!r}")
        check("post-demote luna pro==False",      d.get("pro") is False,      f"got {d.get('pro')!r}")
        check("post-demote luna zen==False",      d.get("zen") is False,      f"got {d.get('zen')!r}")

    print("\n=== 5d. revoke-admin idempotent on already-demoted user ===")
    r = owner.post("/admin/revoke-admin", json={"email": LUNA_EMAIL})
    check("owner re-revoke-admin luna → 200", r.status_code == 200, f"status={r.status_code}")
    body = r.json() if r.status_code == 200 else {}
    check("re-revoke-admin was_admin==False", body.get("was_admin") is False, f"body={body}")

    print("\n=== Cleanup: demote rio (he was promoted in step 4 setup) ===")
    if rio_id:
        r = owner.post("/admin/revoke-admin", json={"email": RIO_EMAIL})
        check("cleanup rio demote → 200", r.status_code == 200,
              f"status={r.status_code} body={r.text[:200]}")

    print("\n=== 6. Auth gate ===")
    naked = httpx.Client(base_url=BASE, timeout=20.0)
    r = naked.post("/admin/grant-admin", json={"email": LUNA_EMAIL})
    check("no-auth grant-admin → 401", r.status_code == 401, f"status={r.status_code} body={r.text[:200]}")

    print("\n=== 7. Regression — admin stats overview + user list ===")
    r = owner.get("/admin/stats/overview")
    check("/admin/stats/overview 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        ov = r.json()
        admin_count = (ov.get("users") or {}).get("admin", 0)
        check("admin_users count >= 1",
              isinstance(admin_count, int) and admin_count >= 1, f"admin={admin_count}")

    r = owner.get("/admin/users/list", params={"tier": "admin"})
    check("/admin/users/list?tier=admin 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        lst = (r.json() or {}).get("users", []) or []
        owner_in_list = any(u.get("email") == OWNER_EMAIL and u.get("is_owner") for u in lst)
        check("owner appears in tier=admin list", owner_in_list,
              f"emails={[u.get('email') for u in lst]}")

    print("\n" + "=" * 60)
    print(f"PASS: {PASS}   FAIL: {FAIL}")
    if FAILED:
        print("\nFailed checks:")
        for f in FAILED:
            print(f"  - {f}")
    print("=" * 60)
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
