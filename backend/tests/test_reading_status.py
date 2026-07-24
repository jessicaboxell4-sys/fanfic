"""Tests for POST /api/books/{book_id}/status tri-state reading status.

Self-contained: seeds its own user, session token, and book directly in
Mongo — no dependency on the admin-smoke-test account existing in the
target DB.  Runs identically against local (http://localhost:8001) and
the deployed preview.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

_mc = MongoClient(MONGO_URL)
_db = _mc[DB_NAME]


@pytest.fixture(scope="module")
def seeded():
    """Seed a user + session token + one book.  Yields (session, book_id)."""
    uid = f"user_readstatus_{uuid.uuid4().hex[:8]}"
    token = f"sess_readstatus_{uuid.uuid4().hex}"
    book_id = f"book_readstatus_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc)

    _db.users.insert_one({
        "user_id": uid,
        "email": f"readstatus-{uid[-8:]}@shelfsort-e2e.net",
        "name": "Read Status Test",
        "is_admin": False,
        "approval_status": "approved",
    })
    _db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": now + timedelta(days=1),
        "created_at": now,
    })
    _db.books.insert_one({
        "book_id": book_id,
        "user_id": uid,
        "title": "Read-status fixture book",
        "author": "Test",
        "category": "Fanfiction",
        "progress_fraction": 0.0,
    })

    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    yield s, book_id

    _db.books.delete_many({"book_id": book_id})
    _db.user_sessions.delete_many({"user_id": uid})
    _db.users.delete_many({"user_id": uid})


class TestReadingStatus:
    def test_unauthenticated_401(self):
        r = requests.post(f"{BASE_URL}/api/books/anybook/status", json={"status": "reading"}, timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403 got {r.status_code}"

    def test_404_missing_book(self, seeded):
        s, _ = seeded
        r = s.post(f"{BASE_URL}/api/books/does_not_exist_xyz/status", json={"status": "reading"}, timeout=15)
        assert r.status_code == 404, r.text

    def test_400_bad_status(self, seeded):
        s, book_id = seeded
        r = s.post(f"{BASE_URL}/api/books/{book_id}/status", json={"status": "banana"}, timeout=15)
        assert r.status_code == 400, r.text

    def test_set_unread(self, seeded):
        s, book_id = seeded
        r = s.post(f"{BASE_URL}/api/books/{book_id}/status", json={"status": "unread"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["status"] == "unread"
        assert data["progress_fraction"] == 0.0
        doc = _db.books.find_one({"book_id": book_id})
        assert doc["progress_fraction"] == 0.0

    def test_set_reading(self, seeded):
        s, book_id = seeded
        r = s.post(f"{BASE_URL}/api/books/{book_id}/status", json={"status": "reading"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "reading"
        assert data["progress_fraction"] == 0.5
        assert _db.books.find_one({"book_id": book_id})["progress_fraction"] == 0.5

    def test_set_finished(self, seeded):
        s, book_id = seeded
        r = s.post(f"{BASE_URL}/api/books/{book_id}/status", json={"status": "finished"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "finished"
        assert data["progress_fraction"] == 1.0
        assert _db.books.find_one({"book_id": book_id})["progress_fraction"] == 1.0

    def test_mark_endpoint_still_works(self, seeded):
        s, book_id = seeded
        # Backward compat: /mark should still respond
        r = s.post(f"{BASE_URL}/api/books/{book_id}/mark", json={"read": False}, timeout=15)
        assert r.status_code in (200, 201), r.text
