"""RevenueCat REST client — fetch subscriber entitlement state server-side.

Used to:
- Sync the user's pro status after a successful client purchase.
- Validate webhook events by cross-checking the authoritative /subscribers endpoint.
"""
import logging
import httpx
from typing import Optional
from .config import REVENUECAT_API_KEY

logger = logging.getLogger("innfeel.revenuecat")

RC_V1_BASE = "https://api.revenuecat.com/v1"


async def get_subscriber(app_user_id: str) -> Optional[dict]:
    """Fetch subscriber info from RevenueCat REST v1. Returns dict or None."""
    if not REVENUECAT_API_KEY:
        logger.info("REVENUECAT_API_KEY not set — subscriber fetch skipped")
        return None
    url = f"{RC_V1_BASE}/subscribers/{app_user_id}"
    headers = {
        "Authorization": f"Bearer {REVENUECAT_API_KEY}",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client_http:
            r = await client_http.get(url, headers=headers)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            logger.warning(f"RevenueCat get_subscriber non-200: {r.status_code} {r.text[:120]}")
            return None
        data = r.json()
        return data.get("subscriber")
    except Exception as e:
        logger.warning(f"RevenueCat get_subscriber failed: {e}")
        return None


def extract_pro_state(subscriber: dict) -> tuple[bool, Optional[str], Optional[str]]:
    """From a RevenueCat subscriber payload, return (is_pro, expires_at_iso, store).

    Looks up the "pro" entitlement. If absent or inactive, returns (False, None, None).
    `store` is one of app_store / play_store / stripe / promotional / None.
    """
    if not subscriber:
        return False, None, None
    ent = (subscriber.get("entitlements") or {}).get("pro") or {}
    expires_at = ent.get("expires_date") or ent.get("expires_at")
    product_id = ent.get("product_identifier")
    # Cross-reference the subscriptions block to find the store
    subs = subscriber.get("subscriptions") or {}
    store = None
    if product_id and product_id in subs:
        store = subs[product_id].get("store")
    # "is_active" is the most reliable signal (RevenueCat precomputes it)
    from datetime import datetime, timezone
    is_active = False
    if expires_at:
        try:
            dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            is_active = dt > datetime.now(timezone.utc)
        except Exception:
            is_active = False
    return is_active, expires_at, store
