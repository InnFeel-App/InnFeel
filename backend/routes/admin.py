"""Admin user-management routes.

All endpoints here require `is_admin: true` on the calling user. They power
the admin panel at `/admin` in the app — search, grant/revoke tier, view
detailed user info, see global stats, and run support operations like
quota resets.

Backward compat: legacy endpoints (`/admin/grant-pro`, `/admin/revoke-pro`,
etc.) live in server.py and have been updated to delegate to the same
helpers. New code should use the tier-aware variants below.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from app_core.db import db
from app_core.deps import get_current_user, now_utc, today_key

router = APIRouter()


def _require_admin(user: dict):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


def _require_owner(user: dict):
    """Owner-only operations: promote/demote admins, anything that touches
    other admins. The owner is the founder account (hello@innfeel.app) and
    is the only role that can change admin membership."""
    if not user.get("is_owner"):
        raise HTTPException(status_code=403, detail="Owner access required")


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _iso(d) -> Optional[str]:
    if not d:
        return None
    if isinstance(d, datetime):
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.isoformat()
    if isinstance(d, str):
        return d
    return None


def _resolve_tier(u: dict) -> str:
    """zen | pro | free | admin (admin > zen > pro > free for display)."""
    if u.get("is_admin"):
        return "admin"
    if u.get("zen"):
        return "zen"
    if u.get("pro"):
        return "pro"
    return "free"


def _public_user(u: dict) -> dict:
    """Compact user representation for list rendering. Kept *small*: the
    detail panel is the place to show everything."""
    return {
        "user_id": u.get("user_id"),
        "email": u.get("email"),
        "name": u.get("name", ""),
        "tier": _resolve_tier(u),
        "is_admin": bool(u.get("is_admin", False)),
        "is_owner": bool(u.get("is_owner", False)),
        "pro": bool(u.get("pro", False)),
        "zen": bool(u.get("zen", False)),
        "pro_expires_at": _iso(u.get("pro_expires_at")),
        "pro_source": u.get("pro_source"),
        "created_at": _iso(u.get("created_at")),
        "last_active_at": _iso(u.get("last_active_at")),
        "verified": bool(u.get("email_verified_at")),
        "language": u.get("language") or "en",
        "current_streak": int(u.get("current_streak", 0) or 0),
    }


# ──────────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────────
class GrantTierIn(BaseModel):
    """Either email OR user_id is required (admin can target by either)."""
    email: Optional[EmailStr] = None
    user_id: Optional[str] = Field(default=None, min_length=4, max_length=64)
    tier: str = Field(pattern="^(pro|zen)$")
    days: int = Field(ge=1, le=3650, default=30)
    note: Optional[str] = Field(default=None, max_length=200)


class RevokeTierIn(BaseModel):
    email: Optional[EmailStr] = None
    user_id: Optional[str] = Field(default=None, min_length=4, max_length=64)


class ResetQuotaIn(BaseModel):
    user_id: str = Field(min_length=4, max_length=64)


class AdminTargetIn(BaseModel):
    """Identifies a user for admin promote/demote. Either email or user_id."""
    email: Optional[EmailStr] = None
    user_id: Optional[str] = Field(default=None, min_length=4, max_length=64)
    note: Optional[str] = Field(default=None, max_length=200)


# ──────────────────────────────────────────────────────────────────────────
# /admin/stats/overview — global KPIs
# ──────────────────────────────────────────────────────────────────────────
@router.get("/admin/stats/overview")
async def admin_stats_overview(user: dict = Depends(get_current_user)):
    """High-level numbers shown at the top of the admin panel.

    Counts are computed from the live collections — for a small/medium app
    these are O(few thousand) docs which Mongo handles in single-digit ms.
    Cache later if needed.
    """
    _require_admin(user)
    now = now_utc()
    week_ago = now - timedelta(days=7)
    day_ago = now - timedelta(days=1)
    month_ago = now - timedelta(days=30)

    total_users = await db.users.count_documents({})
    pro_users = await db.users.count_documents({"pro": True, "zen": {"$ne": True}})
    zen_users = await db.users.count_documents({"zen": True})
    admin_users = await db.users.count_documents({"is_admin": True})
    verified_users = await db.users.count_documents({"email_verified_at": {"$exists": True, "$ne": None}})
    new_users_7d = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    new_users_30d = await db.users.count_documents({"created_at": {"$gte": month_ago}})
    dau = await db.users.count_documents({"last_active_at": {"$gte": day_ago}})
    wau = await db.users.count_documents({"last_active_at": {"$gte": week_ago}})

    total_moods = await db.moods.count_documents({})
    moods_today = await db.moods.count_documents({"day_key": today_key(now)})
    moods_7d = await db.moods.count_documents({"created_at": {"$gte": week_ago}})

    active_grants = await db.pro_grants.count_documents({"revoked": False, "expires_at": {"$gt": now}})

    return {
        "users": {
            "total": total_users,
            "free": max(0, total_users - pro_users - zen_users - admin_users),
            "pro": pro_users,
            "zen": zen_users,
            "admin": admin_users,
            "verified": verified_users,
            "new_7d": new_users_7d,
            "new_30d": new_users_30d,
            "dau": dau,
            "wau": wau,
        },
        "moods": {
            "total": total_moods,
            "today": moods_today,
            "last_7d": moods_7d,
        },
        "grants": {
            "active": active_grants,
        },
        "as_of": now.isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────
# /admin/users/list — paginated, filterable
# ──────────────────────────────────────────────────────────────────────────
@router.get("/admin/users/list")
async def admin_users_list(
    user: dict = Depends(get_current_user),
    q: str = Query("", max_length=120),
    tier: str = Query("all", pattern="^(all|free|pro|zen|admin)$"),
    sort: str = Query("recent", pattern="^(recent|active|name|email)$"),
    page: int = Query(0, ge=0, le=200),
    page_size: int = Query(40, ge=1, le=100),
):
    """Paginated list of users for the admin table view.

    Filters:
      • q        — substring match against email or name (case-insensitive)
      • tier     — free | pro | zen | admin | all
      • sort     — recent (created_at desc) | active | name | email
    """
    _require_admin(user)

    mongo_filter: dict = {}
    if q.strip():
        safe = re.escape(q.strip())
        mongo_filter["$or"] = [
            {"email": {"$regex": safe, "$options": "i"}},
            {"name":  {"$regex": safe, "$options": "i"}},
        ]
    if tier == "free":
        mongo_filter["pro"] = {"$ne": True}
        mongo_filter["zen"] = {"$ne": True}
        mongo_filter["is_admin"] = {"$ne": True}
    elif tier == "pro":
        mongo_filter["pro"] = True
        mongo_filter["zen"] = {"$ne": True}
        # Admins carry pro=True for feature gating but are conceptually a
        # separate tier; exclude them from the Pro filter to match the
        # admin panel's user expectation.
        mongo_filter["is_admin"] = {"$ne": True}
    elif tier == "zen":
        mongo_filter["zen"] = True
    elif tier == "admin":
        mongo_filter["is_admin"] = True

    sort_map = {
        "recent": [("created_at", -1)],
        "active": [("last_active_at", -1)],
        "name":   [("name",  1)],
        "email":  [("email", 1)],
    }
    sort_spec = sort_map.get(sort, sort_map["recent"])

    total = await db.users.count_documents(mongo_filter)
    cursor = db.users.find(
        mongo_filter,
        {"_id": 0, "password_hash": 0},
    ).sort(sort_spec).skip(page * page_size).limit(page_size)
    docs = await cursor.to_list(page_size)
    return {
        "users": [_public_user(u) for u in docs],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page + 1) * page_size < total,
    }


# ──────────────────────────────────────────────────────────────────────────
# /admin/users/{user_id} — full detail panel
# ──────────────────────────────────────────────────────────────────────────
@router.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, user: dict = Depends(get_current_user)):
    """Everything the admin needs about one user, in a single round-trip.

    Includes computed stats: mood count, friends count, last 5 mood
    timestamps, active grants, coach quota usage today.
    """
    _require_admin(user)
    target = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "password_hash": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    moods_total = await db.moods.count_documents({"user_id": user_id})
    moods_7d = await db.moods.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": now_utc() - timedelta(days=7)},
    })
    last_mood_doc = await db.moods.find_one(
        {"user_id": user_id},
        {"_id": 0, "created_at": 1, "emotion": 1, "intensity": 1},
        sort=[("created_at", -1)],
    )
    friends_count = await db.friendships.count_documents({
        "$or": [{"user_a": user_id}, {"user_b": user_id}],
        "status": "accepted",
    })

    # Coach + journal credits used today (Pro/Zen) or lifetime (Free).
    today = today_key(now_utc())
    daily = await db.coach_limits.find_one({"user_id": user_id, "kind": "daily", "day_key": today})
    lifetime = await db.coach_limits.find_one({"user_id": user_id, "kind": "free_trial"})
    coach_used_today = (daily or {}).get("count", 0)
    coach_used_lifetime = (lifetime or {}).get("count", 0)

    grants_cursor = db.pro_grants.find(
        {"granted_to_user_id": user_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(20)
    grants = []
    for g in await grants_cursor.to_list(20):
        g["created_at"] = _iso(g.get("created_at"))
        g["expires_at"] = _iso(g.get("expires_at"))
        g["revoked_at"] = _iso(g.get("revoked_at"))
        g["is_active"] = (
            not g.get("revoked", False)
            and isinstance(g.get("expires_at"), str)
        )
        grants.append(g)

    meditation_used = list(target.get("meditation_trials_used") or [])

    detail = _public_user(target)
    detail.update({
        "tier_label": _resolve_tier(target).upper(),
        "device_locale": target.get("device_locale"),
        "timezone": target.get("timezone"),
        "push_token_present": bool(target.get("push_token")),
        "friend_code": target.get("friend_code"),
        "bio": target.get("bio", ""),
        "avatar_url": target.get("avatar_url"),
        "pro_grant_note": target.get("pro_grant_note"),
        "pro_granted_by": target.get("pro_granted_by"),
        "stats": {
            "moods_total": moods_total,
            "moods_7d": moods_7d,
            "friends": friends_count,
            "current_streak": int(target.get("current_streak", 0) or 0),
            "longest_streak": int(target.get("longest_streak", 0) or 0),
            "last_mood": {
                "at": _iso((last_mood_doc or {}).get("created_at")),
                "emotion": (last_mood_doc or {}).get("emotion"),
                "intensity": (last_mood_doc or {}).get("intensity"),
            } if last_mood_doc else None,
            "coach_used_today": coach_used_today,
            "coach_used_lifetime": coach_used_lifetime,
        },
        "grants": grants,
        "meditation_trials_used": meditation_used,
    })
    return detail


# ──────────────────────────────────────────────────────────────────────────
# /admin/grant-tier — Pro or Zen
# ──────────────────────────────────────────────────────────────────────────
async def _resolve_target(data: GrantTierIn | RevokeTierIn) -> dict:
    if getattr(data, "user_id", None):
        target = await db.users.find_one({"user_id": data.user_id})
        if not target:
            raise HTTPException(status_code=404, detail=f"No user with id {data.user_id}")
        return target
    if getattr(data, "email", None):
        target = await db.users.find_one({"email": str(data.email).lower()})
        if not target:
            raise HTTPException(status_code=404, detail=f"No user with email {data.email}")
        return target
    raise HTTPException(status_code=400, detail="Either email or user_id required")


@router.post("/admin/grant-tier")
async def admin_grant_tier(data: GrantTierIn, user: dict = Depends(get_current_user)):
    """Grant Pro or Zen for N days. Creates a `pro_grants` audit row."""
    _require_admin(user)
    target = await _resolve_target(data)
    expires_at = now_utc() + timedelta(days=data.days)

    # Both Pro and Zen unlock the Pro feature gates (zen is a strict
    # superset of pro), so we always set pro=True. Zen flag is added on top.
    update_set = {
        "pro": True,
        "pro_expires_at": expires_at,
        "pro_source": "admin_grant",
        "pro_granted_by": user["user_id"],
        "pro_grant_note": data.note,
    }
    if data.tier == "zen":
        update_set["zen"] = True
    else:
        # Granting Pro after a Zen grant should NOT silently leave zen=true.
        # Admin's intent is "this person is now Pro for N days". Strip zen.
        update_set["zen"] = False

    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": update_set},
    )
    await db.pro_grants.insert_one({
        "grant_id": f"grant_{uuid.uuid4().hex[:12]}",
        "tier": data.tier,
        "granted_to_user_id": target["user_id"],
        "granted_to_email": target["email"],
        "granted_to_name": target.get("name", ""),
        "granted_by_user_id": user["user_id"],
        "granted_by_email": user["email"],
        "days": data.days,
        "expires_at": expires_at,
        "note": data.note,
        "created_at": now_utc(),
        "revoked": False,
    })
    return {
        "ok": True,
        "tier": data.tier,
        "user": {
            "user_id": target["user_id"],
            "email": target["email"],
            "name": target.get("name", ""),
        },
        "expires_at": expires_at.isoformat(),
    }


@router.post("/admin/revoke-tier")
async def admin_revoke_tier(data: RevokeTierIn, user: dict = Depends(get_current_user)):
    """Revoke Pro AND Zen flags. Marks all active grants as revoked.

    Owner accounts are immutable here — only the owner themselves can
    edit their own subscription state, and even then not via this endpoint.
    Other admins cannot be downgraded by their peers either; only the owner
    can demote an admin (via /admin/revoke-admin).
    """
    _require_admin(user)
    target = await _resolve_target(data)
    if target.get("is_owner"):
        raise HTTPException(status_code=400, detail="The owner cannot be revoked.")
    if target.get("is_admin") and not user.get("is_owner"):
        raise HTTPException(
            status_code=403,
            detail="Only the owner can modify another admin's subscription.",
        )
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {
            "pro": False,
            "zen": False,
            "pro_expires_at": None,
            "pro_source": None,
            "pro_granted_by": None,
            "pro_grant_note": None,
        }},
    )
    await db.pro_grants.update_many(
        {"granted_to_user_id": target["user_id"], "revoked": False},
        {"$set": {"revoked": True, "revoked_at": now_utc(), "revoked_by": user["user_id"]}},
    )
    return {"ok": True, "user_id": target["user_id"]}


@router.post("/admin/reset-quota")
async def admin_reset_quota(data: ResetQuotaIn, user: dict = Depends(get_current_user)):
    """Support tool: reset the coach quota for a single user.

    Wipes both today's daily counter and the lifetime free-trial counter.
    Useful when an LLM error penalised the user, or when refunding goodwill
    credits during support tickets.
    """
    _require_admin(user)
    target = await db.users.find_one({"user_id": data.user_id}, {"_id": 0, "user_id": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    res = await db.coach_limits.delete_many({"user_id": data.user_id})
    return {"ok": True, "user_id": data.user_id, "deleted": res.deleted_count}


# ──────────────────────────────────────────────────────────────────────────
# /admin/grant-admin & /admin/revoke-admin — OWNER-ONLY operations
# ──────────────────────────────────────────────────────────────────────────
async def _resolve_admin_target(data: AdminTargetIn) -> dict:
    if data.user_id:
        target = await db.users.find_one({"user_id": data.user_id})
        if not target:
            raise HTTPException(status_code=404, detail=f"No user with id {data.user_id}")
        return target
    if data.email:
        target = await db.users.find_one({"email": str(data.email).lower()})
        if not target:
            raise HTTPException(status_code=404, detail=f"No user with email {data.email}")
        return target
    raise HTTPException(status_code=400, detail="Either email or user_id required")


@router.post("/admin/grant-admin")
async def admin_grant_admin(data: AdminTargetIn, user: dict = Depends(get_current_user)):
    """Promote a user to admin. OWNER-ONLY.

    Promoting a user automatically grants them lifetime Zen access (full
    feature unlock) so they aren't bottlenecked by quotas while doing
    support work. They keep this access until they are demoted.
    """
    _require_owner(user)
    target = await _resolve_admin_target(data)
    if target.get("is_admin"):
        return {"ok": True, "already_admin": True, "user_id": target["user_id"]}

    expires_at = now_utc() + timedelta(days=3650)  # effectively forever
    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {
            "is_admin": True,
            "pro": True,
            "zen": True,
            "pro_expires_at": expires_at,
            "pro_source": "admin_promotion",
            "pro_granted_by": user["user_id"],
            "pro_grant_note": data.note or "Promoted to admin",
        }},
    )
    await db.pro_grants.insert_one({
        "grant_id": f"grant_{uuid.uuid4().hex[:12]}",
        "tier": "zen",
        "granted_to_user_id": target["user_id"],
        "granted_to_email": target["email"],
        "granted_to_name": target.get("name", ""),
        "granted_by_user_id": user["user_id"],
        "granted_by_email": user["email"],
        "days": 3650,
        "expires_at": expires_at,
        "note": (data.note or "Admin promotion (auto-Zen)"),
        "created_at": now_utc(),
        "revoked": False,
    })
    return {
        "ok": True,
        "user_id": target["user_id"],
        "email": target["email"],
        "is_admin": True,
    }


@router.post("/admin/revoke-admin")
async def admin_revoke_admin(data: AdminTargetIn, user: dict = Depends(get_current_user)):
    """Demote an admin back to a regular Free user. OWNER-ONLY.

    Cannot demote the owner. Removes admin flag plus auto-granted Zen so
    the demoted user reverts to whatever paid tier they had bought outside
    of the promotion (none, in most cases).
    """
    _require_owner(user)
    target = await _resolve_admin_target(data)
    if target.get("is_owner"):
        raise HTTPException(status_code=400, detail="The owner cannot be demoted.")
    if not target.get("is_admin"):
        return {"ok": True, "was_admin": False, "user_id": target["user_id"]}

    await db.users.update_one(
        {"user_id": target["user_id"]},
        {"$set": {
            "is_admin": False,
            "pro": False,
            "zen": False,
            "pro_expires_at": None,
            "pro_source": None,
            "pro_granted_by": None,
            "pro_grant_note": None,
        }},
    )
    await db.pro_grants.update_many(
        {"granted_to_user_id": target["user_id"], "revoked": False},
        {"$set": {"revoked": True, "revoked_at": now_utc(), "revoked_by": user["user_id"]}},
    )
    return {"ok": True, "user_id": target["user_id"], "is_admin": False}

