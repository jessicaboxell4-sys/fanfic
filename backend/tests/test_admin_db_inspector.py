"""Backend regression tests for the read-only Mongo inspector.

Mirrors the pattern used by `test_admin_console.py` — hits the live
backend via `requests` and seeds users/sessions directly in Mongo.

Covers:
- Admin auth gate on both endpoints
- Sensitive collections (`user_sessions`) are invisible (404 + absent from list)
- Password hashes never appear in document responses
- Pagination respects skip/limit caps (422 above 50)
- Search filters by email/_id/name without leaking other docs
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://genre-sort.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

ADMIN_ID = f"user_mdbi_{uuid.uuid4().hex[:8]}"
ADMIN_TOKEN = f"sess_mdbi_{uuid.uuid4().hex}"
ADMIN_EMAIL = f"mdbi-admin-{uuid.uuid4().hex[:6]}@pytest.local"
ADMIN_HEADERS = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

NON_ADMIN_ID = f"user_mdbiN_{uuid.uuid4().hex[:8]}"
NON_ADMIN_TOKEN = f"sess_mdbiN_{uuid.uuid4().hex}"
NON_ADMIN_HEADERS = {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def _seed_users():
    # Admin
    db.users.update_one(
        {"user_id": ADMIN_ID},
        {"$set": {
            "user_id": ADMIN_ID,
            "email": ADMIN_EMAIL,
            "name": "Mongo Inspector Pytest",
            "is_admin": True,
            "password_hash": "$2b$12$pytestfakehashpytestfakehashpytestfakehashpytestfakehash",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    db.user_sessions.update_one(
        {"session_token": ADMIN_TOKEN},
        {"$set": {
            "user_id": ADMIN_ID,
            "session_token": ADMIN_TOKEN,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        }},
        upsert=True,
    )
    # Non-admin
    db.users.update_one(
        {"user_id": NON_ADMIN_ID},
        {"$set": {
            "user_id": NON_ADMIN_ID,
            "email": f"{NON_ADMIN_ID}@pytest.local",
            "name": "Mongo Inspector Non-Admin",
            "is_admin": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    db.user_sessions.update_one(
        {"session_token": NON_ADMIN_TOKEN},
        {"$set": {
            "user_id": NON_ADMIN_ID,
            "session_token": NON_ADMIN_TOKEN,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        }},
        upsert=True,
    )
    yield
    db.user_sessions.delete_many({"session_token": {"$in": [ADMIN_TOKEN, NON_ADMIN_TOKEN]}})
    db.users.delete_many({"user_id": {"$in": [ADMIN_ID, NON_ADMIN_ID]}})


def test_collections_requires_auth():
    r = requests.get(f"{BASE}/api/admin/db/collections")
    assert r.status_code in (401, 403)


def test_collections_blocks_non_admin():
    r = requests.get(f"{BASE}/api/admin/db/collections", headers=NON_ADMIN_HEADERS)
    assert r.status_code == 403


def test_collections_list_hides_user_sessions():
    r = requests.get(f"{BASE}/api/admin/db/collections", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    names = {c["name"] for c in r.json()["collections"]}
    assert "users" in names
    assert "user_sessions" not in names, "sensitive collection leaked into manifest"


def test_collection_redacts_password_hash():
    r = requests.get(
        f"{BASE}/api/admin/db/collection/users",
        params={"q": ADMIN_EMAIL, "limit": 5},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 1
    doc = next((d for d in data["docs"] if d.get("email") == ADMIN_EMAIL), None)
    assert doc is not None, f"seed admin not found in response: {[d.get('email') for d in data['docs']]}"
    assert doc.get("password_hash") == "[redacted]"
    assert "session_token" not in doc


def test_collection_user_sessions_is_404():
    r = requests.get(
        f"{BASE}/api/admin/db/collection/user_sessions",
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 404


def test_collection_search_narrows():
    unfiltered = requests.get(
        f"{BASE}/api/admin/db/collection/users", params={"limit": 1}, headers=ADMIN_HEADERS
    )
    filtered = requests.get(
        f"{BASE}/api/admin/db/collection/users",
        params={"q": ADMIN_EMAIL, "limit": 1},
        headers=ADMIN_HEADERS,
    )
    assert unfiltered.status_code == 200 and filtered.status_code == 200
    assert filtered.json()["total"] <= unfiltered.json()["total"]
    assert filtered.json()["total"] >= 1


def test_collection_limit_cap():
    r = requests.get(
        f"{BASE}/api/admin/db/collection/users",
        params={"limit": 9999},
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 422, f"expected 422 for limit > 50, got {r.status_code}"
