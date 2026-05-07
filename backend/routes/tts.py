"""Natural-sounding TTS using Microsoft Edge's neural voices.

Why Edge TTS?
  • Free, no API key, no rate limits in practice.
  • Microsoft "Neural" voices — the same quality as Azure Cognitive Services.
  • Supports SSML-like prosody hints (rate, pitch).
  • Works for all 7 InnFeel locales with multiple natural female voices.

Caching strategy:
  • We hash (voice, rate, pitch, text) into a deterministic key.
  • First call generates with edge-tts and uploads the MP3 to Cloudflare R2.
  • Subsequent calls return a presigned URL of the cached object.
  • This makes Breath / Meditation cues feel instant after the first warm-up
    while keeping the app stateless on the audio side.

Endpoint:
  POST /api/tts/synthesize  { text, lang?, voice?, rate?, pitch? }
    → { url, cached, voice, key, ms }

  The `url` field is a (presigned) MP3 URL that the frontend hands to
  expo-av to play. We do NOT stream the bytes through our backend on
  purpose — that would burn bandwidth and add latency for repeat plays.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app_core.deps import get_current_user
from app_core import r2

logger = logging.getLogger("innfeel.tts")
router = APIRouter()


# ──────────────────────────────────────────────────────────────────────────
# Voice catalogue — calm female narrators per locale.
# ──────────────────────────────────────────────────────────────────────────
# These are the warmest neural voices in the Microsoft catalogue for each
# InnFeel locale. We picked female voices on purpose because the breathing
# / meditation rituals consistently test better with a soft female narrator
# in user research. The "default" map is overridable per request via the
# `voice` field.

DEFAULT_VOICE_BY_LANG = {
    "en":   "en-US-AriaNeural",       # warm, neutral US female
    "fr":   "fr-FR-DeniseNeural",     # soft Parisian female
    "es":   "es-ES-ElviraNeural",     # calm Castilian female
    "it":   "it-IT-ElsaNeural",       # warm Italian female
    "de":   "de-DE-KatjaNeural",      # soft German female
    "pt":   "pt-PT-RaquelNeural",     # warm Portuguese female
    "ar":   "ar-EG-SalmaNeural",      # warm Egyptian Arabic female
}

ALLOWED_VOICES = set(DEFAULT_VOICE_BY_LANG.values()) | {
    # A few alternatives users could pick later in Settings if we ever
    # expose a voice selector.
    "en-GB-SoniaNeural",
    "en-US-JennyNeural",
    "fr-FR-VivienneMultilingualNeural",
    "fr-FR-EloiseNeural",
    "es-MX-DaliaNeural",
    "it-IT-IsabellaNeural",
    "de-DE-AmalaNeural",
    "pt-BR-FranciscaNeural",
}


def _resolve_voice(lang: Optional[str], voice: Optional[str]) -> str:
    """Pick a safe neural voice. Falls back to English if the locale is
    unknown so we never crash a meditation start because of a typo."""
    if voice and voice in ALLOWED_VOICES:
        return voice
    code = (lang or "en").lower().split("-")[0]
    return DEFAULT_VOICE_BY_LANG.get(code, DEFAULT_VOICE_BY_LANG["en"])


def _cache_key(voice: str, rate: str, pitch: str, text: str) -> str:
    """Deterministic key — same prompt = same cached MP3 forever."""
    raw = f"{voice}|{rate}|{pitch}|{text.strip()}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"tts/{voice}/{digest}.mp3"


async def _synthesize_to_bytes(text: str, voice: str, rate: str, pitch: str) -> bytes:
    """Stream Edge TTS audio chunks into a single bytes buffer."""
    import edge_tts  # imported lazily so backend boot doesn't depend on it

    chunks = bytearray()
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            chunks.extend(chunk.get("data", b""))
    return bytes(chunks)


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────
class SynthIn(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    lang: Optional[str] = Field(default=None, max_length=8)
    voice: Optional[str] = Field(default=None, max_length=64)
    # Edge-TTS rate/pitch use signed-percent strings, e.g. "-10%" or "+5Hz".
    rate: Optional[str] = Field(default="-8%", max_length=8)
    pitch: Optional[str] = Field(default="-2Hz", max_length=8)


# ──────────────────────────────────────────────────────────────────────────
# /api/tts/synthesize
# ──────────────────────────────────────────────────────────────────────────
@router.post("/tts/synthesize")
async def synthesize(data: SynthIn, user: dict = Depends(get_current_user)):
    """Return a playable MP3 URL for the requested text + voice.

    The result is cached in R2 by (voice, rate, pitch, text) hash so all
    canonical breathing / meditation cues become instant after the first
    play. The URL is a short-lived presigned URL; the frontend should
    fetch a fresh one on every play to avoid stale signatures.
    """
    started = time.perf_counter()
    voice = _resolve_voice(data.lang, data.voice)
    rate = (data.rate or "-8%").strip()
    pitch = (data.pitch or "-2Hz").strip()
    key = _cache_key(voice, rate, pitch, data.text)

    # Cache hit? Use HEAD probe to confirm the object actually exists in
    # R2 — generate_get_url only crafts a presigned URL and won't error on
    # missing keys, so a naive presign-and-return would hand the player a
    # 404 on the first call after a cache miss.
    if r2.is_enabled() and r2.object_exists(key):
        existing = r2.generate_get_url(key, expires=3600)
        if existing:
            return {
                "url": existing,
                "cached": True,
                "voice": voice,
                "key": key,
                "ms": int((time.perf_counter() - started) * 1000),
            }

    # Generate fresh audio. Edge-TTS is async; the call itself is short
    # (typically 200–600 ms for a 1-sentence cue).
    try:
        audio_bytes = await asyncio.wait_for(
            _synthesize_to_bytes(data.text, voice, rate, pitch),
            timeout=20.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="TTS provider timeout")
    except Exception as e:
        logger.exception("edge-tts failed for voice=%s text=%r: %s", voice, data.text[:40], e)
        raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {e}")

    if not audio_bytes:
        raise HTTPException(status_code=502, detail="TTS returned empty audio")

    # Upload to R2 (best-effort). If R2 is down, return the bytes inline as
    # a base64 data URL so meditation still works in dev / outage scenarios.
    if r2.is_enabled() and r2.upload_bytes(key, audio_bytes, content_type="audio/mpeg"):
        url = r2.generate_get_url(key, expires=3600)
        return {
            "url": url,
            "cached": False,
            "voice": voice,
            "key": key,
            "ms": int((time.perf_counter() - started) * 1000),
        }

    # Fallback: inline data URL (no R2). Cap at 1 MB to avoid blowing up
    # the JSON envelope.
    import base64
    if len(audio_bytes) > 1_048_576:
        raise HTTPException(status_code=507, detail="TTS audio too large for inline fallback")
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    return {
        "url": f"data:audio/mpeg;base64,{b64}",
        "cached": False,
        "voice": voice,
        "key": key,
        "ms": int((time.perf_counter() - started) * 1000),
        "fallback": "inline",
    }


# ──────────────────────────────────────────────────────────────────────────
# /api/tts/voices — small helper for future voice-picker UI.
# ──────────────────────────────────────────────────────────────────────────
@router.get("/tts/voices")
async def list_voices(user: dict = Depends(get_current_user)):
    """Return the curated voice list grouped by language."""
    out: dict[str, list[str]] = {}
    for v in sorted(ALLOWED_VOICES):
        code = v.split("-", 1)[0]
        out.setdefault(code, []).append(v)
    return {"defaults": DEFAULT_VOICE_BY_LANG, "voices": out}
