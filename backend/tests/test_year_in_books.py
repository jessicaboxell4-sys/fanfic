"""Tests for Year-in-Books feature (iteration 5):
- GET  /api/year-in-books/{year}              -> {summary, has_data}
- POST /api/year-in-books/{year}/email        -> {delivered, summary, has_data}
- Year validation (1800/2999 -> 400)
- Auth required (401)
- Regression of pre-existing endpoints after include_router was moved again
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_yib_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_yib_{uuid.uuid4().hex}"
TARGET_YEAR = 2025


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": f"{USER_ID}@example.com",
        "name": "YIB User",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID,
        "session_token": TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.reading_activity.delete_many({"user_id": USER_ID})


@pytest.fixture(scope="module")
def seeded_book():
    """Insert a finished book + reading_activity in the target year for has_data=True."""
    bid = f"book_yib_{uuid.uuid4().hex[:10]}"
    db.books.insert_one({
        "book_id": bid,
        "user_id": USER_ID,
        "title": "Test Year Book",
        "author": "Test Author",
        "fandom": "Harry Potter",
        "category": "Fanfiction",
        "progress_fraction": 0.99,
        "page_count": 250,
        "last_opened_at": f"{TARGET_YEAR}-06-15T12:00:00+00:00",
        "created_at": f"{TARGET_YEAR}-06-01T12:00:00+00:00",
    })
    db.reading_activity.insert_one({
        "user_id": USER_ID,
        "date": f"{TARGET_YEAR}-06-15",
        "book_ids": [bid],
    })
    yield bid
    db.books.delete_many({"book_id": bid})
    db.reading_activity.delete_many({"user_id": USER_ID, "date": f"{TARGET_YEAR}-06-15"})


# ---------------------------------------------------------------------------
# YEAR IN BOOKS — primary endpoint
# ---------------------------------------------------------------------------
class TestYearInBooks:
    def test_requires_auth(self):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}")
        assert r.status_code == 401

    def test_year_validation_low(self):
        r = requests.get(f"{BASE}/api/year-in-books/1800", headers=H())
        assert r.status_code == 400

    def test_year_validation_high(self):
        r = requests.get(f"{BASE}/api/year-in-books/2999", headers=H())
        assert r.status_code == 400

    def test_empty_user_returns_has_data_false(self):
        # Before any books are seeded
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["has_data"] is False
        # summary keys still present even when empty
        s = body["summary"]
        for key in ("year", "books_opened", "books_finished", "active_days",
                    "longest_streak", "pages_read", "top_fandoms", "top_authors",
                    "categories", "monthly", "best_month", "first_book", "last_book"):
            assert key in s, f"Missing key: {key}"
        assert s["year"] == TARGET_YEAR
        assert len(s["monthly"]) == 12

    def test_has_data_with_seeded_book(self, seeded_book):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["has_data"] is True
        s = body["summary"]
        assert s["year"] == TARGET_YEAR
        assert s["books_opened"] >= 1
        assert s["books_finished"] >= 1
        assert s["active_days"] >= 1
        assert isinstance(s["top_fandoms"], list)
        assert len(s["top_fandoms"]) <= 5
        assert isinstance(s["top_authors"], list)
        assert len(s["top_authors"]) <= 5
        # monthly is 12 entries
        assert len(s["monthly"]) == 12
        for m in s["monthly"]:
            assert "month" in m and "label" in m and "opens" in m and "finished" in m
        # Top fandom should include Harry Potter
        fnames = [f.get("name") or f.get("fandom") for f in s["top_fandoms"]]
        assert "Harry Potter" in fnames
        # Top author should include Test Author
        anames = [a.get("name") or a.get("author") for a in s["top_authors"]]
        assert "Test Author" in anames
        # bookends present
        assert s["first_book"] is not None
        assert s["last_book"] is not None

    def test_email_post_returns_delivered_false(self, seeded_book):
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/email", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert "delivered" in body
        assert "summary" in body
        assert "has_data" in body
        # RESEND_API_KEY empty in preview env -> delivered=false (logged=true expected)
        assert body["delivered"] is False
        # logged flag may or may not be present depending on implementation
        if "logged" in body:
            assert body["logged"] is True

    def test_email_requires_auth(self):
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/email")
        assert r.status_code == 401

    def test_email_year_validation(self):
        r = requests.post(f"{BASE}/api/year-in-books/1800/email", headers=H())
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# REGRESSION — endpoints after include_router move
# ---------------------------------------------------------------------------
class TestRegressionEndpoints:
    def test_auth_me_unauthenticated(self):
        r = requests.get(f"{BASE}/api/auth/me")
        assert r.status_code == 401

    def test_auth_me_with_token(self):
        r = requests.get(f"{BASE}/api/auth/me", headers=H())
        assert r.status_code == 200
        assert r.json().get("email") == f"{USER_ID}@example.com"

    def test_digest_settings_get(self):
        r = requests.get(f"{BASE}/api/user/digest-settings", headers=H())
        assert r.status_code == 200

    def test_digest_preview_post(self):
        r = requests.post(f"{BASE}/api/user/digest-preview", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert "delivered" in body
        assert body["delivered"] is False  # RESEND empty

    def test_books_list(self):
        r = requests.get(f"{BASE}/api/books", headers=H())
        assert r.status_code == 200

    def test_stats_overview(self):
        r = requests.get(f"{BASE}/api/stats/overview", headers=H())
        assert r.status_code == 200

    def test_stats_detailed(self):
        r = requests.get(f"{BASE}/api/stats/detailed", headers=H())
        assert r.status_code == 200

    def test_authors_list(self):
        r = requests.get(f"{BASE}/api/authors", headers=H())
        assert r.status_code == 200

    def test_series_list(self):
        r = requests.get(f"{BASE}/api/series", headers=H())
        assert r.status_code == 200

    def test_bulk_metadata_requires_auth(self):
        r = requests.post(f"{BASE}/api/books/bulk/metadata",
                          json={"book_ids": ["x"], "author": "Y"})
        assert r.status_code == 401

    def test_bulk_move_requires_auth(self):
        r = requests.post(f"{BASE}/api/books/bulk/move",
                          json={"book_ids": ["x"], "category": "Fiction"})
        assert r.status_code == 401

    def test_bulk_delete_requires_auth(self):
        r = requests.post(f"{BASE}/api/books/bulk/delete",
                          json={"book_ids": ["x"]})
        assert r.status_code == 401

    def test_register_login_logout_flow(self):
        """Full register → me → logout → login flow.

        After the 2026-06-15 approval-gate rollout, every new sign-up
        lands in ``pending`` and the register response no longer issues
        a session — so we promote the user to ``"approved"`` directly in
        Mongo (mimicking the admin approval step) before exercising the
        login + logout path.
        """
        email = f"test_reg_{uuid.uuid4().hex[:8]}@example.com"
        pwd = "hunter2pw"
        s = requests.Session()
        r = s.post(f"{BASE}/api/auth/register",
                   json={"email": email, "password": pwd, "name": "Reg"})
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Pending sign-up: no session, response is the pending placeholder.
        assert body.get("pending") is True
        assert not s.cookies.get("session_token")

        # Simulate admin approval — flip the row to ``"approved"``.
        db.users.update_one({"email": email}, {"$set": {"approval_status": "approved"}})

        # Now login should succeed and /me + /logout should work.
        li = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pwd})
        assert li.status_code == 200, li.text
        assert s.cookies.get("session_token")
        me = s.get(f"{BASE}/api/auth/me")
        assert me.status_code == 200
        assert me.json().get("approval_status") == "approved"
        lo = s.post(f"{BASE}/api/auth/logout")
        assert lo.status_code == 200
        # Login again from a fresh session — round-trip works.
        s2 = requests.Session()
        li = s2.post(f"{BASE}/api/auth/login", json={"email": email, "password": pwd})
        assert li.status_code == 200
        db.users.delete_many({"email": email})
