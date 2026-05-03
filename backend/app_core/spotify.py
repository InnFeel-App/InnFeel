"""Spotify Web API client (Client Credentials flow) — search tracks only.

We cache the access token in memory (valid ~60 min). If no credentials are set,
all functions return empty lists safely.
"""
import time
import base64
import logging
from typing import List, Optional
import httpx
from .config import SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

logger = logging.getLogger("innfeel.spotify")

_token_cache = {"access_token": None, "expires_at": 0.0}


async def _get_token() -> Optional[str]:
    """Fetch (or return cached) a Spotify client-credentials token."""
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        return None
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 30:
        return _token_cache["access_token"]
    try:
        basic = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode("utf-8")).decode("ascii")
        async with httpx.AsyncClient(timeout=6.0) as client_http:
            r = await client_http.post(
                "https://accounts.spotify.com/api/token",
                headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials"},
            )
        if r.status_code != 200:
            logger.warning(f"Spotify token non-200: {r.status_code} {r.text[:120]}")
            return None
        payload = r.json()
        tok = payload.get("access_token")
        exp = float(payload.get("expires_in", 3600))
        _token_cache["access_token"] = tok
        _token_cache["expires_at"] = now + exp
        return tok
    except Exception as e:
        logger.warning(f"Spotify token fetch failed: {e}")
        return None


async def search_tracks(q: str, limit: int = 10) -> List[dict]:
    """Search Spotify for tracks matching q. Returns unified track dicts or [] if unavailable.

    Note: only tracks with a non-null `preview_url` are returned (30s MP3 preview).
    """
    q = (q or "").strip()
    if len(q) < 2:
        return []
    token = await _get_token()
    if not token:
        return []
    try:
        async with httpx.AsyncClient(timeout=6.0) as client_http:
            r = await client_http.get(
                "https://api.spotify.com/v1/search",
                params={"q": q, "type": "track", "limit": max(1, min(50, limit))},
                headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code != 200:
            logger.warning(f"Spotify search non-200: {r.status_code} {r.text[:120]}")
            return []
        data = r.json()
        items = (data.get("tracks") or {}).get("items") or []
        out = []
        for t in items:
            prev = t.get("preview_url")
            if not prev:
                continue
            artists = ", ".join(a.get("name", "") for a in (t.get("artists") or []) if a.get("name"))
            imgs = ((t.get("album") or {}).get("images") or [])
            # Pick a mid-size image (~300px) if available, else the first
            art = ""
            if imgs:
                mid = [i for i in imgs if 200 <= int(i.get("height", 0)) <= 400]
                art = (mid[0] if mid else imgs[0]).get("url", "")
            out.append({
                "track_id": f"spotify:{t.get('id')}",
                "name": t.get("name") or "",
                "artist": artists,
                "artwork_url": art,
                "preview_url": prev,
                "source": "spotify",
            })
        return out
    except Exception as e:
        logger.warning(f"Spotify search failed: {e}")
        return []
