"""Backend tests for the opt-in public library feature (iteration_48).

Covers:
- GET /api/users/{username}/public-library (anon) — 404 for fake AND not-opted-in users
- GET/PUT /api/account/public-library-visibility (auth required)
- Public library returns owner/books/top_fandoms/category_counts when opted in
- AV-infected books are omitted
- q substring filter (>=2 chars)
- limit min/max bounds
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _register(email_prefix="testpub"):
    """Register a fresh user and return (session_cookies, user)."""
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:8]}@example.com"
    password = "hunter2pw!"
    s = requests.Session()
    r = s.post(f"{API}/auth/register",
               json={"email": email, "password": password, "name": "Tester Pub"},
               timeout=15)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    user = r.json().get("user") or r.json()
    return s, user, email, password


def _set_username(session, handle):
    r = session.patch(f"{API}/auth/username", json={"username": handle}, timeout=15)
    assert r.status_code == 200, f"set username failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def opted_in_user():
    """User with @handle, opted in, and one library book inserted directly."""
    handle = f"testpub{uuid.uuid4().hex[:6]}"
    s, user, _email, _pw = _register("opted")
    _set_username(s, handle)
    # Flip the public visibility ON via the actual API.
    r = s.put(f"{API}/account/public-library-visibility",
              json={"library_visible_to_public": True}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("library_visible_to_public") is True
    # Insert two books directly into mongo.
    user_id = user["user_id"]
    db.books.insert_many([
        {"book_id": f"TEST_bk_{uuid.uuid4().hex[:8]}", "user_id": user_id,
         "title": "Harry Potter and the Test Stone", "author": "J. K. Rowling",
         "fandom": "Harry Potter", "category": "Fanfic", "av_status": "clean"},
        {"book_id": f"TEST_bk_{uuid.uuid4().hex[:8]}", "user_id": user_id,
         "title": "Iron Man Origins", "author": "Stan Lee",
         "fandom": "Marvel", "category": "Comic", "av_status": "clean"},
        {"book_id": f"TEST_bk_infected_{uuid.uuid4().hex[:8]}", "user_id": user_id,
         "title": "Infected Manuscript", "author": "Bad Actor",
         "fandom": "Harry Potter", "category": "Fanfic", "av_status": "infected"},
    ])
    yield {"session": s, "user": user, "handle": handle}
    # Cleanup
    db.books.delete_many({"user_id": user_id})
    db.users.delete_one({"user_id": user_id})


@pytest.fixture(scope="module")
def not_opted_in_user():
    """User WITH a handle but library_visible_to_public stays False."""
    handle = f"testpriv{uuid.uuid4().hex[:6]}"
    s, user, _e, _p = _register("priv")
    _set_username(s, handle)
    yield {"session": s, "user": user, "handle": handle}
    db.users.delete_one({"user_id": user["user_id"]})


@pytest.fixture(scope="module")
def no_handle_user():
    """User without a handle set."""
    s, user, _e, _p = _register("nohandle")
    yield {"session": s, "user": user}
    db.users.delete_one({"user_id": user["user_id"]})


# ---------------- Public endpoint (anonymous) ----------------

class TestPublicLibraryAnon:
    def test_fake_handle_returns_404(self):
        r = requests.get(f"{API}/users/zzz_nonexistent_{uuid.uuid4().hex[:6]}/public-library", timeout=15)
        assert r.status_code == 404

    def test_existing_but_not_opted_in_returns_404(self, not_opted_in_user):
        # Critical security assertion: same 404 as fake handle.
        r = requests.get(f"{API}/users/{not_opted_in_user['handle']}/public-library", timeout=15)
        assert r.status_code == 404

    def test_opted_in_returns_200_no_auth(self, opted_in_user):
        # Use a bare session (no cookies) to confirm anonymous access.
        r = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "owner" in data
        assert data["owner"]["username"] == opted_in_user["handle"]
        for key in ("display_name", "joined_at", "picture"):
            assert key in data["owner"]
        assert isinstance(data.get("books"), list)
        assert isinstance(data.get("top_fandoms"), list)
        assert isinstance(data.get("category_counts"), dict)
        assert "total_returned" in data
        # 2 clean books inserted, 1 infected omitted.
        assert data["total_returned"] == 2
        titles = [b["title"] for b in data["books"]]
        assert "Infected Manuscript" not in titles

    def test_infected_books_omitted(self, opted_in_user):
        r = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library", timeout=15)
        assert r.status_code == 200
        assert all(b["title"] != "Infected Manuscript" for b in r.json()["books"])

    def test_q_filter_case_insensitive(self, opted_in_user):
        r = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library",
                         params={"q": "iron"}, timeout=15)
        assert r.status_code == 200
        books = r.json()["books"]
        assert len(books) == 1
        assert "Iron Man" in books[0]["title"]

    def test_q_too_short_ignored(self, opted_in_user):
        # 1 char q is ignored (>=2 chars required)
        r = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library",
                         params={"q": "i"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["total_returned"] == 2

    def test_limit_bounds(self, opted_in_user):
        # limit=9999 should clamp to <=500 (we have 2 docs, but ensure no 422)
        r = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library",
                         params={"limit": 9999}, timeout=15)
        assert r.status_code == 200
        # limit=0 should clamp to >=1
        r2 = requests.get(f"{API}/users/{opted_in_user['handle']}/public-library",
                          params={"limit": 0}, timeout=15)
        assert r2.status_code == 200
        # 1 book max
        assert r2.json()["total_returned"] <= 2


# ---------------- Auth-required visibility endpoints ----------------

class TestVisibilityEndpoint:
    def test_get_requires_auth(self):
        # Bare requests.get without cookies.
        r = requests.get(f"{API}/account/public-library-visibility", timeout=15)
        assert r.status_code == 401

    def test_put_requires_auth(self):
        r = requests.put(f"{API}/account/public-library-visibility",
                         json={"library_visible_to_public": True}, timeout=15)
        assert r.status_code == 401

    def test_default_false_for_new_user(self, no_handle_user):
        s = no_handle_user["session"]
        r = s.get(f"{API}/account/public-library-visibility", timeout=15)
        assert r.status_code == 200
        assert r.json() == {"library_visible_to_public": False}

    def test_put_flips_flag(self, no_handle_user):
        s = no_handle_user["session"]
        r1 = s.put(f"{API}/account/public-library-visibility",
                   json={"library_visible_to_public": True}, timeout=15)
        assert r1.status_code == 200
        assert r1.json()["library_visible_to_public"] is True
        r2 = s.get(f"{API}/account/public-library-visibility", timeout=15)
        assert r2.json()["library_visible_to_public"] is True
        r3 = s.put(f"{API}/account/public-library-visibility",
                   json={"library_visible_to_public": False}, timeout=15)
        assert r3.json()["library_visible_to_public"] is False
        r4 = s.get(f"{API}/account/public-library-visibility", timeout=15)
        assert r4.json()["library_visible_to_public"] is False
