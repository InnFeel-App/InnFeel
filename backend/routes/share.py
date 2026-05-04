"""Share routes — server-side composition of an Instagram-Reel-style MP4 for a user's aura.

Purpose: when the user taps "Share to Stories" we no longer post a plain screenshot; we build
a 1080x1920 MP4 that combines:
  • the aura's photo (static, 15s) OR video (first 15s) as background
  • the chosen music track's 30s preview audio (cut to 15s)
  • an overlay PNG rendered with Pillow showing emotion, word, description and user name

The reel is uploaded to R2 under the key `shares/reel_<mood_id>_<ts>.mp4`, then a presigned
URL is returned to the client, which hands it to the native share sheet (IG Stories / Reels
accept MP4 via the iOS/Android share intent).

CRITICAL: ffmpeg is blocking and can take 8-20s per call. We hand it off to a thread via
`asyncio.to_thread` so the FastAPI event loop stays free — otherwise the k8s ingress proxy
returns 502 because the worker can't ack health pings during encoding.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from typing import Optional

import httpx
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from fastapi import APIRouter, Depends, HTTPException

from app_core import r2 as _r2
from app_core.constants import EMOTIONS
from app_core.db import db
from app_core.deps import get_current_user

router = APIRouter()
logger = logging.getLogger("innfeel.share")

# Bundled ffmpeg binary from the imageio-ffmpeg pip package — survives container rebuilds
# (no apt dependency), lives under site-packages. Cached at import time.
_FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()

REEL_W, REEL_H = 1080, 1920
REEL_DURATION_SEC = 15

_LIB_SANS = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
_LIB_SANS_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def _hex_to_rgb(hx: str) -> tuple[int, int, int]:
    hx = (hx or "#A78BFA").lstrip("#")
    if len(hx) != 6:
        return (167, 139, 250)
    return tuple(int(hx[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        return ImageFont.load_default()


def _render_overlay_png(
    *,
    color_hex: str,
    word: str,
    emotion: str,
    description: str,
    user_name: str,
) -> bytes:
    """Compose the full-frame text + gradient overlay for the reel."""
    rgb = _hex_to_rgb(color_hex)
    img = Image.new("RGBA", (REEL_W, REEL_H), (0, 0, 0, 0))

    # Soft color-tinted gradient at top and bottom to improve text legibility.
    gradient = Image.new("RGBA", (REEL_W, REEL_H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gradient)
    for y in range(260):
        a = int(180 * (1 - y / 260))
        gd.line([(0, y), (REEL_W, y)], fill=(0, 0, 0, a))
    for y in range(480):
        a = int(200 * (y / 480))
        gd.line([(0, REEL_H - 480 + y), (REEL_W, REEL_H - 480 + y)], fill=(0, 0, 0, a))
    img = Image.alpha_composite(img, gradient)

    d = ImageDraw.Draw(img)

    # Top tag: InnFeel logo-style label with color chip.
    f_brand = _load_font(_LIB_SANS, 42)
    chip_r = 22
    cx, cy = 72, 100
    d.ellipse((cx - chip_r, cy - chip_r, cx + chip_r, cy + chip_r), fill=(*rgb, 255))
    d.text((cx + chip_r + 18, cy - 26), "InnFeel ✦", font=f_brand, fill=(255, 255, 255, 255))

    # User name (small) at top-left.
    if user_name:
        f_user = _load_font(_LIB_SANS_REG, 34)
        d.text((72, 160), user_name, font=f_user, fill=(255, 255, 255, 210))

    # Emotion label (centered, small cap-style).
    f_emo = _load_font(_LIB_SANS, 46)
    emo_txt = (emotion or "").upper()
    emo_bbox = d.textbbox((0, 0), emo_txt, font=f_emo)
    emo_w = emo_bbox[2] - emo_bbox[0]
    d.text(((REEL_W - emo_w) / 2, REEL_H - 520), emo_txt, font=f_emo, fill=(*rgb, 255))

    # Headline word (big, bold).
    headline = word or emotion or "Today"
    # Dynamic font size — shrink if long.
    base_size = 180
    if len(headline) > 12:
        base_size = 130
    if len(headline) > 20:
        base_size = 96
    f_word = _load_font(_LIB_SANS, base_size)
    hw_bbox = d.textbbox((0, 0), headline, font=f_word)
    hw = hw_bbox[2] - hw_bbox[0]
    # Drop shadow for readability
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text(((REEL_W - hw) / 2 + 4, REEL_H - 430 + 4), headline, font=f_word, fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)
    d.text(((REEL_W - hw) / 2, REEL_H - 430), headline, font=f_word, fill=(255, 255, 255, 255))

    # Description (wraps under the headline).
    if description:
        f_desc = _load_font(_LIB_SANS_REG, 40)
        # Simple word wrap at ~28 chars per line, max 3 lines.
        words = description.split()
        lines: list[str] = []
        cur = ""
        for w in words:
            test = (cur + " " + w).strip()
            if len(test) <= 32:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = w
            if len(lines) >= 3:
                break
        if cur and len(lines) < 3:
            lines.append(cur)
        y0 = REEL_H - 200
        for ln in lines[:3]:
            lb = d.textbbox((0, 0), ln, font=f_desc)
            lw = lb[2] - lb[0]
            d.text(((REEL_W - lw) / 2, y0), ln, font=f_desc, fill=(255, 255, 255, 230))
            y0 += 52

    # Bottom CTA.
    f_cta = _load_font(_LIB_SANS, 32)
    cta = "innfeel.app"
    cb = d.textbbox((0, 0), cta, font=f_cta)
    cw = cb[2] - cb[0]
    d.text(((REEL_W - cw) / 2, REEL_H - 72), cta, font=f_cta, fill=(255, 255, 255, 190))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _render_fallback_background(color_hex: str) -> bytes:
    """When no photo/video is attached we paint a simple radial-gradient background."""
    rgb = _hex_to_rgb(color_hex)
    img = Image.new("RGB", (REEL_W, REEL_H), (10, 10, 15))
    d = ImageDraw.Draw(img)
    cx, cy = REEL_W // 2, REEL_H // 2
    max_r = int((REEL_W ** 2 + REEL_H ** 2) ** 0.5 / 2)
    for r in range(max_r, 0, -6):
        ratio = 1 - (r / max_r)
        blend = tuple(
            int(rgb[i] * ratio + 10 * (1 - ratio)) for i in range(3)
        )
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=blend)
    img = img.filter(ImageFilter.GaussianBlur(60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


async def _download(url: str, dest: str, timeout: float = 20.0) -> bool:
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as c:
            r = await c.get(url)
            if r.status_code != 200:
                return False
            with open(dest, "wb") as f:
                f.write(r.content)
            return True
    except Exception as e:
        logger.warning(f"[share] download fail {url}: {e}")
        return False


def _ffmpeg_compose(
    *,
    workdir: str,
    has_video: bool,
    has_audio: bool,
    bg_path: str,
    audio_path: Optional[str],
    overlay_path: str,
    out_path: str,
) -> bool:
    """Invoke ffmpeg to compose the final 9:16 MP4. Returns True on success.

    Encoding budget: must stay under ~25s wall-clock to fit ingress proxy timeouts. We use
    `-preset ultrafast` and pre-scale the photo at native target size (1080x1920) so the
    zoompan filter doesn't have to operate on a huge canvas. Subtle Ken-Burns + fades stay.
    """
    if has_video:
        # Use the video stream as-is (cover-fit + crop + 25fps for stable encoding).
        inputs = ["-t", str(REEL_DURATION_SEC), "-i", bg_path, "-i", overlay_path]
        vf = (
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,setsar=1,fps=25,"
            f"fade=t=in:st=0:d=0.6,fade=t=out:st={REEL_DURATION_SEC - 0.6}:d=0.6[bg];"
            "[bg][1:v]overlay=0:0:format=auto[vout]"
        )
    else:
        # Static photo → loop, light Ken-Burns zoom (1.0 → 1.10 over 15s @ 25fps).
        # Pre-scale at 1.5x target keeps zoompan under ~6s wall-clock at ultrafast.
        zoom_frames = REEL_DURATION_SEC * 25
        inputs = ["-loop", "1", "-t", str(REEL_DURATION_SEC), "-i", bg_path, "-i", overlay_path]
        vf = (
            "[0:v]scale=1620:2880:force_original_aspect_ratio=increase,"
            "crop=1620:2880,setsar=1,"
            f"zoompan=z='min(zoom+0.0005,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={zoom_frames}:s=1080x1920:fps=25,"
            f"fade=t=in:st=0:d=0.6,fade=t=out:st={REEL_DURATION_SEC - 0.6}:d=0.6[bg];"
            "[bg][1:v]overlay=0:0:format=auto[vout]"
        )

    if has_audio and audio_path:
        inputs += ["-i", audio_path]
        af = f"[2:a]afade=t=in:st=0:d=0.3,afade=t=out:st={REEL_DURATION_SEC - 0.5}:d=0.5[aout]"
        full_filter = f"{vf};{af}"
        map_args = ["-map", "[vout]", "-map", "[aout]"]
        audio_args = ["-c:a", "aac", "-b:a", "160k", "-shortest"]
    else:
        inputs += ["-f", "lavfi", "-t", str(REEL_DURATION_SEC), "-i", "anullsrc=r=44100:cl=stereo"]
        full_filter = vf
        map_args = ["-map", "[vout]", "-map", "2:a:0"]
        audio_args = ["-c:a", "aac", "-b:a", "96k"]

    cmd = [
        _FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
        # Use multiple threads to get under the proxy's 30s timeout on real photos.
        "-threads", "0",
        *inputs,
        "-filter_complex", full_filter,
        *map_args,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-r", "25",
        "-t", str(REEL_DURATION_SEC),
        *audio_args,
        out_path,
    ]
    try:
        proc = subprocess.run(cmd, cwd=workdir, capture_output=True, timeout=80)
        if proc.returncode != 0:
            logger.warning(f"[share] ffmpeg failed rc={proc.returncode} stderr={proc.stderr.decode()[:800]}")
            return False
        return os.path.exists(out_path) and os.path.getsize(out_path) > 0
    except Exception as e:
        logger.warning(f"[share] ffmpeg exception: {e}")
        return False


@router.post("/share/reel/{mood_id}")
async def build_reel(mood_id: str, user: dict = Depends(get_current_user)):
    """Compose a 9:16 MP4 reel for the given mood and return a presigned URL.

    The expensive bits — Pillow rendering, ffmpeg encoding, and R2 upload — run on a worker
    thread via `asyncio.to_thread` so the FastAPI event loop keeps answering health pings
    and other requests during the 5-25s composition window. Without this, the ingress
    proxy would 502 on long encodes.
    """
    mood = await db.moods.find_one({"mood_id": mood_id}, {"_id": 0})
    if not mood:
        raise HTTPException(status_code=404, detail="Aura not found")
    if mood["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your aura")

    emotion = mood.get("emotion") or "joy"
    color_hex = mood.get("color") or EMOTIONS.get(emotion, "#A78BFA")
    word = (mood.get("word") or "").strip()
    description = (mood.get("text") or "").strip()

    owner = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "name": 1})
    user_name = (owner or {}).get("name") or ""

    work = tempfile.mkdtemp(prefix="innfeel_reel_")
    try:
        bg_path = os.path.join(work, "bg.bin")
        audio_path = os.path.join(work, "music.mp3")
        overlay_path = os.path.join(work, "overlay.png")
        out_path = os.path.join(work, "reel.mp4")

        has_video = False
        has_audio = False

        # Background download stays on the event loop (httpx is async-friendly).
        if mood.get("video_key"):
            url = _r2.generate_get_url(mood["video_key"], expires=600)
            if url and await _download(url, bg_path):
                has_video = True
        if not has_video and mood.get("photo_key"):
            url = _r2.generate_get_url(mood["photo_key"], expires=600)
            if url and await _download(url, bg_path):
                has_video = False  # stays photo
        if not has_video and not os.path.exists(bg_path):
            # paint fallback in a thread (Pillow is CPU-bound)
            fallback = await asyncio.to_thread(_render_fallback_background, color_hex)
            with open(bg_path, "wb") as f:
                f.write(fallback)

        music = mood.get("music") or {}
        preview_url = music.get("preview_url")
        if preview_url and await _download(preview_url, audio_path):
            has_audio = True

        # Pillow overlay rendering is CPU-bound — offload to a thread.
        overlay_bytes = await asyncio.to_thread(
            _render_overlay_png,
            color_hex=color_hex,
            word=word,
            emotion=emotion,
            description=description,
            user_name=user_name,
        )
        with open(overlay_path, "wb") as f:
            f.write(overlay_bytes)

        # ffmpeg is BLOCKING (subprocess.run) — must run in a thread or we 502.
        ok = await asyncio.to_thread(
            _ffmpeg_compose,
            workdir=work,
            has_video=has_video,
            has_audio=has_audio,
            bg_path=bg_path,
            audio_path=audio_path if has_audio else None,
            overlay_path=overlay_path,
            out_path=out_path,
        )
        if not ok:
            raise HTTPException(status_code=500, detail="Reel generation failed")

        with open(out_path, "rb") as f:
            data = f.read()
        key = f"shares/reel_{mood_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}.mp4"
        try:
            await asyncio.to_thread(_r2.upload_bytes, key, data, "video/mp4")
        except Exception as e:
            logger.warning(f"[share] R2 upload failed: {e}")
            raise HTTPException(status_code=500, detail="Upload failed")

        url = _r2.generate_get_url(key, expires=60 * 60)
        return {
            "ok": True,
            "url": url,
            "key": key,
            "duration": REEL_DURATION_SEC,
            "has_audio": has_audio,
            "has_video": has_video,
        }
    finally:
        try:
            shutil.rmtree(work)
        except Exception:
            pass
