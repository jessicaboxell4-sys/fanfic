"""Tests for Year-in-Books PUBLIC SHARE feature (iteration 6).

Covered endpoints:
- GET    /api/year-in-books/{year}/share        (auth)
- POST   /api/year-in-books/{year}/share        (auth, idempotent)
- DELETE /api/year-in-books/{year}/share        (auth)
- GET    /api/public/year/{token}                (NO AUTH, increments views, sanitised)

Also regression: include_router was moved AGAIN. Smoke-check a few endpoints.
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

USER_ID = f"user_share_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_share_{uuid.uuid4().hex}"
USER_EMAIL = f"{USER_ID}@example.com"
TARGET_YEAR = 2025


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def seed_user_with_book():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": USER_EMAIL,
        "name": "Share Tester",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID,
        "session_token": TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    bid = f"book_share_{uuid.uuid4().hex[:8]}"
    db.books.insert_one({
        "book_id": bid,
        "user_id": USER_ID,
        "title": "Public Share Book",
        "author": "Share Author",
        "fandom": "Harry Potter",
        "category": "Fanfiction",
        "progress_percent": 0.99,
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
    # cleanup
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.reading_activity.delete_many({"user_id": USER_ID})
    db.year_in_books_shares.delete_many({"user_id": USER_ID})


# ---------- AUTH GATES ----------
class TestShareAuthRequired:
    def test_get_share_requires_auth(self):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share")
        assert r.status_code == 401

    def test_post_share_requires_auth(self):
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share")
        assert r.status_code == 401

    def test_delete_share_requires_auth(self):
        r = requests.delete(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share")
        assert r.status_code == 401


# ---------- YEAR VALIDATION ----------
class TestShareYearValidation:
    def test_get_year_low(self):
        r = requests.get(f"{BASE}/api/year-in-books/1800/share", headers=H())
        assert r.status_code == 400

    def test_get_year_high(self):
        r = requests.get(f"{BASE}/api/year-in-books/2999/share", headers=H())
        assert r.status_code == 400

    def test_post_year_low(self):
        r = requests.post(f"{BASE}/api/year-in-books/1800/share", headers=H())
        assert r.status_code == 400

    def test_post_year_high(self):
        r = requests.post(f"{BASE}/api/year-in-books/2999/share", headers=H())
        assert r.status_code == 400

    def test_delete_year_low(self):
        r = requests.delete(f"{BASE}/api/year-in-books/1800/share", headers=H())
        assert r.status_code == 400


# ---------- HAPPY PATH ----------
class TestShareLifecycle:
    """Full create -> get -> public-view -> idempotency -> revoke -> 404 flow."""

    def test_initial_get_returns_shared_false(self):
        # Clear any pre-existing share for this user/year
        db.year_in_books_shares.delete_many({"user_id": USER_ID, "year": TARGET_YEAR})
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["shared"] is False
        assert body["token"] is None
        assert body["url"] is None
        assert body["view_count"] == 0

    def test_post_creates_share(self):
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["shared"] is True
        assert isinstance(body["token"], str) and len(body["token"]) >= 16
        assert body["url"].endswith(f"/share/yib/{body['token']}")
        assert body["view_count"] == 0
        # stash for module reuse via module-level dict
        TestShareLifecycle._token = body["token"]
        TestShareLifecycle._url = body["url"]

    def test_post_is_idempotent(self):
        r1 = TestShareLifecycle._token
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        assert r.json()["token"] == r1, "Second POST minted a new token (should be idempotent)"

    def test_get_share_returns_existing(self):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["shared"] is True
        assert body["token"] == TestShareLifecycle._token
        assert body["created_at"] is not None

    def test_public_endpoint_no_auth_returns_payload(self):
        tok = TestShareLifecycle._token
        r = requests.get(f"{BASE}/api/public/year/{tok}")  # NO auth header
        assert r.status_code == 200, r.text
        body = r.json()
        # Required shape
        assert "summary" in body
        assert "has_data" in body
        assert "display_name" in body
        assert "year" in body
        assert body["year"] == TARGET_YEAR
        # Privacy: email must NOT appear anywhere in payload
        raw = r.text
        assert USER_EMAIL not in raw, "Email leaked in public payload!"
        # display_name should be "Share Tester" (the user.name)
        assert body["display_name"] == "Share Tester"
        # Privacy: book_id stripped from first_book / last_book
        s = body["summary"]
        if s.get("first_book"):
            assert "book_id" not in s["first_book"], "first_book.book_id leaked"
        if s.get("last_book"):
            assert "book_id" not in s["last_book"], "last_book.book_id leaked"

    def test_view_count_increments(self):
        tok = TestShareLifecycle._token
        # First, fetch share to know baseline
        before = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H()).json()
        baseline = int(before.get("view_count") or 0)
        # Hit public endpoint twice
        requests.get(f"{BASE}/api/public/year/{tok}")
        requests.get(f"{BASE}/api/public/year/{tok}")
        after = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H()).json()
        assert after["view_count"] >= baseline + 2, f"view_count did not increment ({baseline} -> {after['view_count']})"
        assert after["last_viewed_at"] is not None

    def test_public_endpoint_404_for_bad_token(self):
        r = requests.get(f"{BASE}/api/public/year/this-token-does-not-exist-xyz")
        assert r.status_code == 404

    def test_revoke_share(self):
        r = requests.delete(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        assert r.json().get("revoked") is True

    def test_get_after_revoke_returns_shared_false(self):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        assert r.json()["shared"] is False

    def test_public_endpoint_404_after_revoke(self):
        tok = TestShareLifecycle._token
        r = requests.get(f"{BASE}/api/public/year/{tok}")
        assert r.status_code == 404

    def test_revoke_again_returns_false(self):
        """Deleting an already-revoked share should return revoked:false (no-op)."""
        r = requests.delete(f"{BASE}/api/year-in-books/{TARGET_YEAR}/share", headers=H())
        assert r.status_code == 200
        assert r.json().get("revoked") is False


# ---------- REGRESSION (include_router moved AGAIN) ----------
class TestRegression:
    def test_auth_me(self):
        r = requests.get(f"{BASE}/api/auth/me", headers=H())
        assert r.status_code == 200

    def test_books_list(self):
        r = requests.get(f"{BASE}/api/books", headers=H())
        assert r.status_code == 200

    def test_stats_overview(self):
        r = requests.get(f"{BASE}/api/stats/overview", headers=H())
        assert r.status_code == 200

    def test_digest_settings(self):
        r = requests.get(f"{BASE}/api/user/digest-settings", headers=H())
        assert r.status_code == 200

    def test_year_in_books_get_still_works(self):
        r = requests.get(f"{BASE}/api/year-in-books/{TARGET_YEAR}", headers=H())
        assert r.status_code == 200

    def test_year_in_books_email_still_works(self):
        r = requests.post(f"{BASE}/api/year-in-books/{TARGET_YEAR}/email", headers=H())
        assert r.status_code == 200
