"""MoodDrop backend regression tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://charming-wescoff-8.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@mooddrop.app"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "access_token" in j and j["user"]["email"] == ADMIN_EMAIL
    return j["access_token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def free_user(s):
    """Register a fresh free user."""
    email = f"test_{uuid.uuid4().hex[:8]}@mooddrop.app"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pw12345", "name": "Tester"})
    assert r.status_code == 200, r.text
    j = r.json()
    return {"email": email, "token": j["access_token"], "user_id": j["user"]["user_id"]}


@pytest.fixture(scope="module")
def free_h(free_user):
    return {"Authorization": f"Bearer {free_user['token']}"}


# --- Auth ---
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200

def test_login_invalid(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    assert r.status_code == 401

def test_me(s, admin_h):
    r = s.get(f"{API}/auth/me", headers=admin_h)
    assert r.status_code == 200
    assert r.json()["pro"] is True

def test_me_unauth(s):
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 401

def test_register_dup(s):
    r = s.post(f"{API}/auth/register", json={"email": ADMIN_EMAIL, "password": "x12345", "name": "X"})
    assert r.status_code == 400


# --- Free user mood + free-tier enforcement ---
def test_free_intensity_block(s, free_h):
    r = s.post(f"{API}/moods", headers=free_h, json={"word": "pump", "emotion": "joy", "intensity": 8})
    assert r.status_code == 403

def test_free_text_block(s, free_h):
    r = s.post(f"{API}/moods", headers=free_h, json={"word": "calm", "emotion": "calm", "intensity": 3, "text": "hi"})
    assert r.status_code == 403

def test_free_mood_create_ok(s, free_h):
    r = s.post(f"{API}/moods", headers=free_h, json={"word": "okay", "emotion": "calm", "intensity": 3})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["mood"]["emotion"] == "calm" and j["mood"]["color"] == "#60A5FA"
    assert j["streak"] >= 1

def test_idempotent_same_day(s, free_h):
    r = s.post(f"{API}/moods", headers=free_h, json={"word": "again", "emotion": "joy", "intensity": 2})
    assert r.status_code == 400

def test_today(s, free_h):
    r = s.get(f"{API}/moods/today", headers=free_h)
    assert r.status_code == 200 and r.json()["mood"] is not None

def test_feed_unlocked_after_post(s, free_h):
    r = s.get(f"{API}/moods/feed", headers=free_h)
    assert r.status_code == 200 and r.json()["locked"] is False

def test_history_free_limit(s, free_h):
    r = s.get(f"{API}/moods/history", headers=free_h)
    assert r.status_code == 200
    j = r.json()
    assert j["is_pro"] is False
    assert len(j["items"]) <= 7

def test_stats_free(s, free_h):
    r = s.get(f"{API}/moods/stats", headers=free_h)
    assert r.status_code == 200
    j = r.json()
    for k in ("streak", "drops_this_week", "dominant", "distribution", "by_weekday"):
        assert k in j
    assert "range_30" not in j


# --- Friends ---
def test_friends_add(s, free_h):
    r = s.post(f"{API}/friends/add", headers=free_h, json={"email": "luna@mooddrop.app"})
    assert r.status_code == 200, r.text
    assert r.json()["friend"]["name"] == "Luna"

def test_friends_self_block(s, free_h, free_user):
    r = s.post(f"{API}/friends/add", headers=free_h, json={"email": free_user["email"]})
    assert r.status_code == 400

def test_friends_unknown(s, free_h):
    r = s.post(f"{API}/friends/add", headers=free_h, json={"email": "ghost@mooddrop.app"})
    assert r.status_code == 404

def test_friends_list(s, free_h):
    r = s.get(f"{API}/friends", headers=free_h)
    assert r.status_code == 200
    names = [f["name"] for f in r.json()["friends"]]
    assert "Luna" in names


# --- Pro features via dev toggle ---
def test_dev_toggle_pro_and_stats(s, free_h):
    r = s.post(f"{API}/dev/toggle-pro", headers=free_h)
    assert r.status_code == 200 and r.json()["pro"] is True
    r = s.get(f"{API}/moods/stats", headers=free_h)
    j = r.json()
    assert "range_30" in j and "range_90" in j and "range_365" in j
    assert "avg_intensity" in j["range_30"]
    # toggle back off
    r = s.post(f"{API}/dev/toggle-pro", headers=free_h)
    assert r.json()["pro"] is False


# --- Stripe checkout ---
def test_checkout_creates_session(s, admin_h):
    r = s.post(f"{API}/payments/checkout", headers=admin_h, json={"origin_url": BASE_URL})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["url"].startswith("http") and j["session_id"]


# --- Logout ---
def test_logout(s, admin_h):
    r = s.post(f"{API}/auth/logout", headers=admin_h)
    assert r.status_code == 200
