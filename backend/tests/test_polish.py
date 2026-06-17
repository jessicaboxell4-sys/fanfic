"""Tests for the Polish-my-library bulk action (2026-06-16)."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]


@pytest.fixture
def session_user():
    user_id = f"user_polish_{uuid.uuid4().hex[:8]}"
    session = f"sess_polish_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@polish.test",
        "name": "Polish Tester",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    headers = {"Authorization": f"Bearer {session}"}
    yield {"user_id": user_id, "headers": headers}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.books.delete_many({"user_id": user_id})


def _seed_book(user_id: str, **fields) -> str:
    bid = fields.get("book_id") or f"book_p_{uuid.uuid4().hex[:8]}"
    doc = {
        "book_id": bid,
        "user_id": user_id,
        "title": "Default Title",
        "author": "Default Author",
        "category": "Original Fiction",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    doc.update(fields)
    doc["book_id"] = bid
    doc["user_id"] = user_id
    db.books.insert_one(doc)
    return bid


class TestPolishPreview:
    def test_clean_library_returns_empty(self, session_user):
        _seed_book(session_user["user_id"], title="Pride and Prejudice", author="Jane Austen")
        r = requests.get(f"{BASE}/api/books/polish/preview", headers=session_user["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["suggestions"] == []
        assert body["candidates_scanned"] == 0

    def test_messy_title_gets_suggestion(self, session_user):
        bid = _seed_book(
            session_user["user_id"],
            title="harry_potter_and_the_chamber_of_secrets.epub",
            author="J.K. Rowling",
        )
        r = requests.get(f"{BASE}/api/books/polish/preview", headers=session_user["headers"])
        assert r.status_code == 200
        s = [x for x in r.json()["suggestions"] if x["book_id"] == bid]
        assert len(s) == 1
        assert s[0]["suggested_title"] == "Harry Potter and the Chamber of Secrets"
        assert s[0]["suggested_author"] is None
        assert s[0]["reasons"]["title"] == "filename"

    def test_unknown_author_filled_from_ao3_source(self, session_user):
        bid = _seed_book(
            session_user["user_id"],
            title="A Real Fic Title",
            author="Unknown",
            source_url="https://archiveofourown.org/users/Coolhandle_123/works/9999",
        )
        r = requests.get(f"{BASE}/api/books/polish/preview", headers=session_user["headers"])
        s = [x for x in r.json()["suggestions"] if x["book_id"] == bid]
        assert len(s) == 1
        assert s[0]["suggested_author"] == "Coolhandle 123"
        assert s[0]["suggested_title"] is None

    def test_book_id_as_title_gets_cleanup(self, session_user):
        bid = _seed_book(
            session_user["user_id"],
            book_id="polish_messy_xyz",
            title="polish_messy_xyz",
            author="Unknown",
        )
        r = requests.get(f"{BASE}/api/books/polish/preview", headers=session_user["headers"])
        s = [x for x in r.json()["suggestions"] if x["book_id"] == bid]
        assert len(s) == 1
        assert s[0]["suggested_title"]
        assert "Polish" in s[0]["suggested_title"]


class TestPolishApply:
    def test_apply_writes_db(self, session_user):
        bid = _seed_book(
            session_user["user_id"],
            title="some_filename.epub",
            author="Unknown",
            source_url="https://www.fanfiction.net/u/123/cool_writer",
        )
        # Apply both
        r = requests.post(
            f"{BASE}/api/books/polish/apply",
            headers=session_user["headers"],
            json={"items": [{"book_id": bid, "apply_title": True, "apply_author": True}]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["updated"] == 1
        # Confirm DB state
        b = db.books.find_one({"book_id": bid})
        assert b["title"] == "Some Filename"
        assert b["author"] == "cool writer"

    def test_apply_respects_per_field_opt_in(self, session_user):
        bid = _seed_book(
            session_user["user_id"],
            title="some_filename.epub",
            author="Unknown",
            source_url="https://www.fanfiction.net/u/123/the_author",
        )
        # Only apply author
        r = requests.post(
            f"{BASE}/api/books/polish/apply",
            headers=session_user["headers"],
            json={"items": [{"book_id": bid, "apply_title": False, "apply_author": True}]},
        )
        assert r.status_code == 200
        b = db.books.find_one({"book_id": bid})
        assert b["title"] == "some_filename.epub"  # unchanged
        assert b["author"] == "the author"

    def test_apply_skips_books_no_longer_polishable(self, session_user):
        # Clean book — server-side recheck will refuse to apply.
        bid = _seed_book(session_user["user_id"], title="Pride and Prejudice", author="Jane Austen")
        r = requests.post(
            f"{BASE}/api/books/polish/apply",
            headers=session_user["headers"],
            json={"items": [{"book_id": bid, "apply_title": True, "apply_author": True}]},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["updated"] == 0
        assert body["skipped"] == 1
        assert body["details"][0]["error"] == "no_longer_polishable"

    def test_apply_isolates_user(self, session_user):
        # Another user's book — must not be touched even if id is known.
        other_id = f"user_other_{uuid.uuid4().hex[:8]}"
        db.users.insert_one({"user_id": other_id, "email": f"{other_id}@x", "name": "Other"})
        other_bid = _seed_book(other_id, title="other_messy.epub", author="Unknown")
        try:
            r = requests.post(
                f"{BASE}/api/books/polish/apply",
                headers=session_user["headers"],
                json={"items": [{"book_id": other_bid, "apply_title": True, "apply_author": True}]},
            )
            assert r.status_code == 200
            body = r.json()
            assert body["updated"] == 0
            # Other user's book unchanged
            ob = db.books.find_one({"book_id": other_bid})
            assert ob["title"] == "other_messy.epub"
        finally:
            db.users.delete_one({"user_id": other_id})
            db.books.delete_one({"book_id": other_bid})

    def test_empty_payload(self, session_user):
        r = requests.post(
            f"{BASE}/api/books/polish/apply",
            headers=session_user["headers"],
            json={"items": []},
        )
        assert r.status_code == 200
        assert r.json()["updated"] == 0
