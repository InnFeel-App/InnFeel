"""Expo Push integration — send_push + webhook helpers."""
import logging
from typing import Optional
import httpx
from .db import db

logger = logging.getLogger("innfeel")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(target_user_id: str, category: str, title: str, body: str, data: Optional[dict] = None) -> bool:
    """Fire an Expo Push notification to a user if they have a token and the category is enabled.

    `category` is one of: reaction, message, friend, reminder.
    Respects the recipient's notif_prefs (all default ON).
    """
    try:
        target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "push_token": 1, "notif_prefs": 1})
        if not target:
            return False
        token = target.get("push_token")
        if not token:
            return False
        prefs = target.get("notif_prefs") or {}
        if prefs.get(category) is False:
            return False
        payload = {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "priority": "high",
            "channelId": category,
        }
        async with httpx.AsyncClient(timeout=6.0) as client_http:
            r = await client_http.post(EXPO_PUSH_URL, json=payload, headers={"Accept": "application/json", "Content-Type": "application/json"})
        ok = r.status_code == 200
        if not ok:
            logger.warning(f"Expo push non-200: {r.status_code} {r.text[:120]}")
        else:
            try:
                body_json = r.json()
                tickets = body_json.get("data") or []
                if isinstance(tickets, dict):
                    tickets = [tickets]
                for t in tickets:
                    if isinstance(t, dict) and t.get("status") == "error" and (t.get("details") or {}).get("error") == "DeviceNotRegistered":
                        await db.users.update_one({"user_id": target_user_id}, {"$unset": {"push_token": "", "push_platform": ""}})
                        logger.info(f"Pruned DeviceNotRegistered token for {target_user_id}")
            except Exception:
                pass
        return ok
    except Exception as e:
        logger.warning(f"send_push failed: {e}")
        return False
