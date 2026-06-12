"""E2E tests for /api/announcements/* endpoints."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://genre-sort.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_ann_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_ann_{uuid.uuid4().hex}"


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": f"{USER_ID}@example.com",
        "name": "Ann User",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID,
        "session_token": TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    # Drop any leftover announcements from previous test runs so we get a
    # deterministic "empty" baseline.
    db.announcements.delete_many({"version": {"$regex": "^test_"}})
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.announcements.delete_many({"version": {"$regex": "^test_"}})


def test_get_latest_requires_auth():
    r = requests.get(f"{BASE}/api/announcements/latest")
    assert r.status_code == 401


def test_post_requires_auth():
    r = requests.post(f"{BASE}/api/announcements", json={
        "version": "test_unauth", "title": "x", "items": [{"label": "a", "desc": "b", "to": "/x"}],
    })
    assert r.status_code == 401


def test_create_and_fetch_latest():
    v = f"test_{uuid.uuid4().hex[:8]}"
    payload = {
        "version": v,
        "title": "Test What's New",
        "items": [
            {"label": "First", "desc": "— first item desc", "to": "/library/unreadable"},
            {"label": "Second & Third", "desc": "combo item", "to": "/library/ongoing", "link_to_2": "/library/complete"},
        ],
    }
    r = requests.post(f"{BASE}/api/announcements", json=payload, headers=H())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == v
    assert body["title"] == "Test What's New"
    assert len(body["items"]) == 2
    assert body["items"][1]["link_to_2"] == "/library/complete"
    assert "created_at" in body

    # GET should return what we just posted (latest by created_at).
    r2 = requests.get(f"{BASE}/api/announcements/latest", headers=H())
    assert r2.status_code == 200
    latest = r2.json()
    assert latest["version"] == v


def test_duplicate_version_rejected():
    v = f"test_dup_{uuid.uuid4().hex[:8]}"
    payload = {"version": v, "title": "Dup", "items": [{"label": "x", "desc": "y", "to": "/z"}]}
    r1 = requests.post(f"{BASE}/api/announcements", json=payload, headers=H())
    assert r1.status_code == 200
    r2 = requests.post(f"{BASE}/api/announcements", json=payload, headers=H())
    assert r2.status_code == 409


def test_delete_announcement():
    v = f"test_del_{uuid.uuid4().hex[:8]}"
    payload = {"version": v, "title": "Delete me", "items": [{"label": "x", "desc": "y", "to": "/z"}]}
    requests.post(f"{BASE}/api/announcements", json=payload, headers=H())
    r = requests.delete(f"{BASE}/api/announcements/{v}", headers=H())
    assert r.status_code == 200
    assert r.json()["deleted"] == v
    # Second delete is 404.
    r2 = requests.delete(f"{BASE}/api/announcements/{v}", headers=H())
    assert r2.status_code == 404


def test_validation_rejects_empty_items():
    r = requests.post(f"{BASE}/api/announcements", json={
        "version": f"test_empty_{uuid.uuid4().hex[:6]}", "title": "x", "items": [],
    }, headers=H())
    assert r.status_code == 422
