"""Regression tests for the `PATCH /api/books/{book_id}/source-url` endpoint.

Specifically guards the Linkless / "Can't find online" claim flow against
the silent-duplicate-URL edge case: two books in the same library should
never be allowed to share a source_url, because that breaks URL-list
dedupe later on.

Covers:
- Happy path (claim a URL on a linkless book)
- Idempotent re-claim with the same URL on the same book
- Collision: 409 with structured conflict_book payload when another
  ACTIVE book already owns the canonical form of the URL
- Trash collision: claiming a URL that a TRASHED book owns is allowed
  (legitimate "restore via URL" workflow)
- Rejection of unrecognised hosts
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_claim_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_claim_{uuid.uuid4().hex}"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

LINKLESS_BOOK = f"book_linkless_{uuid.uuid4().hex[:8]}"
EXISTING_BOOK = f"book_existing_{uuid.uuid4().hex[:8]}"
TRASHED_BOOK = f"book_trashed_{uuid.uuid4().hex[:8]}"

# AO3 work URL — canonicalises to https://archiveofourown.org/works/12345
EXISTING_URL = "https://archiveofourown.org/works/12345"
TRASHED_URL = "https://archiveofourown.org/works/99999"
NEW_URL = "https://archiveofourown.org/works/77777"


@pytest.fixture(scope="module", autouse=True)
def _seed():
    db.users.update_one(
        {"user_id": USER_ID},
        {"$set": {
            "user_id": USER_ID, "email": f"{USER_ID}@pytest.local",
            "name": "Claim Edge", "is_admin": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    db.user_sessions.update_one(
        {"session_token": TOKEN},
        {"$set": {"user_id": USER_ID, "session_token": TOKEN, "expires_at": datetime.now(timezone.utc) + timedelta(days=1)}},
        upsert=True,
    )
    # Active "existing" book that already owns EXISTING_URL.
    db.books.update_one(
        {"book_id": EXISTING_BOOK},
        {"$set": {
            "book_id": EXISTING_BOOK, "user_id": USER_ID,
            "title": "Already Claimed", "author": "Other Author",
            "category": "Fanfiction", "fandom": "Harry Potter",
            "source_url": EXISTING_URL, "fanfic_urls": [EXISTING_URL],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    # Trashed book also bears a URL — collisions against it are allowed.
    db.books.update_one(
        {"book_id": TRASHED_BOOK},
        {"$set": {
            "book_id": TRASHED_BOOK, "user_id": USER_ID,
            "title": "Trashed Old Copy", "author": "Old Author",
            "category": "Trash", "fandom": "Harry Potter",
            "source_url": TRASHED_URL, "fanfic_urls": [TRASHED_URL],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    # The linkless book we'll be claiming URLs on.
    db.books.update_one(
        {"book_id": LINKLESS_BOOK},
        {"$set": {
            "book_id": LINKLESS_BOOK, "user_id": USER_ID,
            "title": "Linkless Story", "author": "Someone",
            "category": "Fanfiction", "fandom": None,
            "source_url": None, "fanfic_urls": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    yield
    db.books.delete_many({"book_id": {"$in": [LINKLESS_BOOK, EXISTING_BOOK, TRASHED_BOOK]}})
    db.user_sessions.delete_many({"session_token": TOKEN})
    db.users.delete_many({"user_id": USER_ID})


def _reset_linkless_book():
    """Restore the linkless book to its empty state between tests."""
    db.books.update_one(
        {"book_id": LINKLESS_BOOK},
        {"$set": {"source_url": None, "fanfic_urls": []}},
    )


def test_claim_happy_path():
    _reset_linkless_book()
    r = requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": NEW_URL},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert NEW_URL in body["fanfic_urls"]
    assert body["source_url"] == NEW_URL


def test_claim_is_idempotent_on_same_book():
    _reset_linkless_book()
    requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": NEW_URL},
        headers=HEADERS,
    )
    # Submit again — must succeed and not duplicate the URL in fanfic_urls.
    r = requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": NEW_URL},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    assert r.json()["fanfic_urls"].count(NEW_URL) == 1


def test_claim_collision_with_active_book_returns_409():
    _reset_linkless_book()
    r = requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": EXISTING_URL},
        headers=HEADERS,
    )
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "url_already_claimed"
    assert detail["conflict_book"]["book_id"] == EXISTING_BOOK
    assert detail["conflict_book"]["title"] == "Already Claimed"
    # And the linkless book must be UNTOUCHED — still null URLs.
    fresh = db.books.find_one({"book_id": LINKLESS_BOOK})
    assert fresh["source_url"] in (None, "")
    assert fresh["fanfic_urls"] == []


def test_claim_collision_with_trashed_book_is_allowed():
    """Trashed books don't reserve their URLs — claiming the same URL on a
    different book is the standard "restore via URL" workflow."""
    _reset_linkless_book()
    r = requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": TRASHED_URL},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    assert r.json()["source_url"] == TRASHED_URL


def test_claim_rejects_unknown_host():
    _reset_linkless_book()
    r = requests.patch(
        f"{BASE}/api/books/{LINKLESS_BOOK}/source-url",
        json={"url": "https://random-blog.example.com/post/42"},
        headers=HEADERS,
    )
    assert r.status_code == 400
