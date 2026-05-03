"""Cloudflare R2 helper module.

Exposes:
  · upload_bytes(key, data, content_type)   — server-side upload (used by migrations)
  · generate_get_url(key, expires)          — pre-signed GET url for mobile playback
  · generate_put_url(key, content_type, expires) — pre-signed PUT url for direct-from-mobile upload
  · delete_object(key)
  · is_enabled()                            — True if R2 credentials are configured

All media URLs returned to the mobile app are short-lived signed URLs so the bucket
can stay fully private (no public-read policy required). URL TTL defaults to 24 h.
"""
import base64
import logging
import os
import uuid
from typing import Optional

logger = logging.getLogger("innfeel.r2")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "")
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL", "")
# Optional: custom domain for cleaner signed URLs (e.g. https://cdn.innfeel.app).
# When set, every generated GET URL is host-rewritten to use this base. R2 validates
# the S3v4 signature against BOTH the S3 endpoint and the connected custom hostname.
R2_PUBLIC_BASE_URL = os.environ.get("R2_PUBLIC_BASE_URL", "").rstrip("/")
try:
    R2_PRESIGN_TTL = int(os.environ.get("R2_PRESIGN_TTL_SECONDS", "86400"))
except Exception:
    R2_PRESIGN_TTL = 86400

_client = None


def is_enabled() -> bool:
    return all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT_URL])


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not is_enabled():
        return None
    try:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
        return _client
    except Exception as e:
        logger.warning(f"R2 init failed: {e}")
        return None


def make_key(kind: str, user_id: str, ext: str) -> str:
    """Build a predictable object key: media/<kind>/<user_id>/<uuid>.<ext>"""
    safe_ext = (ext or "bin").lstrip(".")
    return f"media/{kind}/{user_id}/{uuid.uuid4().hex}.{safe_ext}"


def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> bool:
    c = _get_client()
    if not c:
        return False
    try:
        c.put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type)
        return True
    except Exception as e:
        logger.warning(f"R2 upload failed ({key}): {e}")
        return False


def upload_b64(key: str, b64: str, content_type: str) -> bool:
    try:
        data = base64.b64decode(b64)
    except Exception as e:
        logger.warning(f"upload_b64: bad base64 for {key}: {e}")
        return False
    return upload_bytes(key, data, content_type)


def generate_get_url(key: str, expires: Optional[int] = None) -> Optional[str]:
    c = _get_client()
    if not c or not key:
        return None
    try:
        url = c.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=int(expires or R2_PRESIGN_TTL),
        )
        # If a custom domain (CNAME) is configured, rewrite the hostname. R2 accepts
        # S3v4-signed requests on the connected custom hostname too.
        if R2_PUBLIC_BASE_URL:
            try:
                from urllib.parse import urlparse, urlunparse
                parsed = urlparse(url)
                base = urlparse(R2_PUBLIC_BASE_URL)
                # Replace scheme + netloc; keep path + query (signature) intact.
                # Strip the leading bucket segment from the path (path-style → virtual-hosted style).
                path = parsed.path
                if path.startswith(f"/{R2_BUCKET}/"):
                    path = path[len(R2_BUCKET) + 1:]
                rewritten = urlunparse((base.scheme or "https", base.netloc, path, "", parsed.query, ""))
                return rewritten
            except Exception as e:
                logger.warning(f"R2 URL rewrite failed ({e}); returning original")
        return url
    except Exception as e:
        logger.warning(f"R2 generate_get_url failed ({key}): {e}")
        return None


def generate_put_url(key: str, content_type: str, expires: int = 900) -> Optional[dict]:
    """Return a dict {url, method, headers, key} that the mobile app uses to upload directly.

    The client must send a `Content-Type: <content_type>` header when PUTing the bytes;
    R2 validates the header against the pre-signed signature.
    """
    c = _get_client()
    if not c or not key:
        return None
    try:
        url = c.generate_presigned_url(
            "put_object",
            Params={"Bucket": R2_BUCKET, "Key": key, "ContentType": content_type},
            ExpiresIn=expires,
        )
        return {
            "url": url,
            "method": "PUT",
            "key": key,
            "headers": {"Content-Type": content_type},
            "expires_in": expires,
        }
    except Exception as e:
        logger.warning(f"R2 generate_put_url failed ({key}): {e}")
        return None


def delete_object(key: str) -> bool:
    c = _get_client()
    if not c or not key:
        return False
    try:
        c.delete_object(Bucket=R2_BUCKET, Key=key)
        return True
    except Exception as e:
        logger.warning(f"R2 delete failed ({key}): {e}")
        return False
