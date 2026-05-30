"""
End-to-end HTTP tests for /api/books/reset-state and /api/books/wipe-library
against the live preview backend (REACT_APP_BACKEND_URL).

Uses ephemeral users created via /api/auth/register so it never collides with
existing data. Each test class registers its own user.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")


def _register_user():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"test_reset_{uuid.uuid4().hex[:10]}@example.com"
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw_test", "name": "Reset Test"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "user_id" in data or "user" in data
    # Session cookie should now be set on `s`
    return s, email


# -------- Authentication guard --------
class TestAuthGuard:
    def test_reset_state_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/books/reset-state",
            json={"reset_progress": True},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_wipe_library_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/books/wipe-library",
            json={"confirm": "DELETE_EVERYTHING"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# -------- /books/reset-state validation --------
class TestResetStateValidation:
    @classmethod
    def setup_class(cls):
        cls.session, cls.email = _register_user()

    def test_no_flags_returns_400(self):
        r = self.session.post(f"{BASE_URL}/api/books/reset-state", json={}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        assert "detail" in body
        assert "at least one" in body["detail"].lower()

    def test_all_flags_false_returns_400(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={
                "reset_progress": False,
                "reset_tags": False,
                "reset_smart_shelves": False,
                "reset_versions": False,
            },
            timeout=15,
        )
        assert r.status_code == 400


# -------- /books/reset-state individual flags --------
class TestResetStateFlags:
    @classmethod
    def setup_class(cls):
        cls.session, cls.email = _register_user()

    def test_reset_progress_only(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={"reset_progress": True},
            timeout=30,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert "books_progress_cleared" in data
        assert "activity_rows_deleted" in data
        # Should NOT touch tags / smart shelves / versions
        assert "books_tags_cleared" not in data
        assert "smart_shelves_deleted" not in data
        assert "versions_collapsed" not in data

    def test_reset_tags_only(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={"reset_tags": True},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "books_tags_cleared" in data
        assert "books_progress_cleared" not in data

    def test_reset_smart_shelves_only(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={"reset_smart_shelves": True},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "smart_shelves_deleted" in data
        assert isinstance(data["smart_shelves_deleted"], int)

    def test_reset_versions_only(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={"reset_versions": True},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "versions_collapsed" in data

    def test_reset_all_flags(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/reset-state",
            json={
                "reset_progress": True,
                "reset_tags": True,
                "reset_smart_shelves": True,
                "reset_versions": True,
            },
            timeout=60,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        for k in ("books_progress_cleared", "books_tags_cleared",
                  "smart_shelves_deleted", "versions_collapsed",
                  "activity_rows_deleted"):
            assert k in data, f"missing key {k} in response: {data}"


# -------- /books/wipe-library --------
class TestWipeLibrary:
    @classmethod
    def setup_class(cls):
        cls.session, cls.email = _register_user()

    def test_wipe_without_confirm_field_422(self):
        # WipeLibraryBody requires `confirm` field — missing → pydantic 422
        r = self.session.post(f"{BASE_URL}/api/books/wipe-library", json={}, timeout=15)
        assert r.status_code in (400, 422), f"expected validation error, got {r.status_code}"

    def test_wipe_with_wrong_phrase_400(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/wipe-library",
            json={"confirm": "delete_everything"},  # wrong case
            timeout=15,
        )
        assert r.status_code == 400
        body = r.json()
        assert "DELETE_EVERYTHING" in body.get("detail", "")

    def test_wipe_with_random_phrase_400(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/wipe-library",
            json={"confirm": "yes"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_wipe_with_correct_phrase_succeeds(self):
        r = self.session.post(
            f"{BASE_URL}/api/books/wipe-library",
            json={"confirm": "DELETE_EVERYTHING"},
            timeout=60,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert "files_removed" in data
        assert "books" in data
        assert "reading_activity" in data
        assert "smart_shelves" in data
        assert "categories" in data
        assert "message" in data
        # New user → 0 books should have been there
        assert data["books"] == 0

    def test_books_endpoint_returns_empty_after_wipe(self):
        # Verify post-wipe state: GET /api/books should return empty list
        r = self.session.get(f"{BASE_URL}/api/books", timeout=15)
        assert r.status_code == 200
        body = r.json()
        # response could be {"books": []} or just a list — handle both
        if isinstance(body, dict):
            books = body.get("books", body.get("items", []))
        else:
            books = body
        assert len(books) == 0, f"expected 0 books after wipe, got {len(books)}"
