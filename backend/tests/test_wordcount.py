"""E2E tests for word count + reading time.

Covers:
- count_words / reading_minutes_for helpers (pure)
- GET /api/user/wpm — default 250, bounds, persist via PUT
- GET /api/books/{book_id}/reading-time
- GET /api/library/reading-stats aggregates unfinished / finished correctly
- POST /api/admin/wordcount/backfill stamps word_count from book_fulltext
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

USER = {
    "user_id": f"user_wc_{uuid.uuid4().hex[:8]}",
    "email": f"wc_{uuid.uuid4().hex[:6]}@example.com",
    "token": f"sess_wc_{uuid.uuid4().hex}",
    "name": "WordCount User",
}
ADMIN = {
    "user_id": f"admin_wc_{uuid.uuid4().hex[:8]}",
    "email": f"admin_wc_{uuid.uuid4().hex[:6]}@example.com",
    "token": f"sess_admin_wc_{uuid.uuid4().hex}",
    "name": "WC Admin",
}

# Three books for the same user:
#  - unread_long (50_000 words, progress 0) — drives unfinished tally
#  - half_read (10_000 words, progress 0.5) — partial unfinished
#  - finished (3_000 words, progress 1.0) — drives finished tally
BOOKS = [
    {"id": f"wc_unread_{uuid.uuid4().hex[:6]}",   "word_count": 50000, "progress": 0.0,  "title": "Unread Long"},
    {"id": f"wc_half_{uuid.uuid4().hex[:6]}",     "word_count": 10000, "progress": 0.5,  "title": "Half Read"},
    {"id": f"wc_done_{uuid.uuid4().hex[:6]}",     "word_count": 3000,  "progress": 1.0,  "title": "Finished"},
]


def H(name="user"):
    u = USER if name == "user" else ADMIN
    return {"Authorization": f"Bearer {u['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": USER["user_id"], "email": USER["email"], "name": USER["name"],
        "is_admin": False, "created_at": now.isoformat(),
    })
    db.users.insert_one({
        "user_id": ADMIN["user_id"], "email": ADMIN["email"], "name": ADMIN["name"],
        "is_admin": True, "created_at": now.isoformat(),
    })
    for u in (USER, ADMIN):
        db.user_sessions.insert_one({
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
    for b in BOOKS:
        db.books.insert_one({
            "book_id": b["id"], "user_id": USER["user_id"],
            "title": b["title"], "author": "Test",
            "category": "Fanfiction", "fandom": "Test Fandom",
            "word_count": b["word_count"], "progress_fraction": b["progress"],
            "created_at": now,
        })
    yield
    db.users.delete_many({"user_id": {"$in": [USER["user_id"], ADMIN["user_id"]]}})
    db.user_sessions.delete_many({"user_id": {"$in": [USER["user_id"], ADMIN["user_id"]]}})
    db.books.delete_many({"user_id": USER["user_id"]})
    db.book_fulltext.delete_many({"user_id": USER["user_id"]})


class TestPureHelpers:
    def test_count_words_and_minutes(self):
        from utils.epub_fulltext import count_words, reading_minutes_for, DEFAULT_WORDS_PER_MINUTE
        assert count_words("") == 0
        assert count_words("the quick brown fox") == 4
        assert reading_minutes_for(0) == 0
        # 250 wpm default → 1000 words = 4 min
        assert reading_minutes_for(1000) == 4
        # Custom wpm
        assert reading_minutes_for(1000, 500) == 2
        # Floor minimum to 1
        assert reading_minutes_for(50) == 1
        assert DEFAULT_WORDS_PER_MINUTE == 250

    def test_wpm_bounds_clamp_inside_helper(self):
        # Out-of-range wpm should clamp to safe bounds inside the helper.
        from utils.epub_fulltext import reading_minutes_for
        # Excessively low wpm clamps at 80 → 1000 words = 13
        assert reading_minutes_for(1000, 1) == 13
        # Excessively high wpm clamps at 1500 → 30000 = 20
        assert reading_minutes_for(30000, 100000) == 20


class TestWpmPref:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/user/wpm")
        assert r.status_code == 401

    def test_default(self):
        r = requests.get(f"{BASE}/api/user/wpm", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert data["words_per_minute"] == 250
        assert data["default"] == 250

    def test_set_and_persist(self):
        r = requests.put(f"{BASE}/api/user/wpm", json={"words_per_minute": 400}, headers=H())
        assert r.status_code == 200
        assert r.json()["words_per_minute"] == 400
        r2 = requests.get(f"{BASE}/api/user/wpm", headers=H())
        assert r2.json()["words_per_minute"] == 400

    def test_rejects_out_of_range(self):
        for bad in (10, 5000):
            r = requests.put(f"{BASE}/api/user/wpm", json={"words_per_minute": bad}, headers=H())
            assert r.status_code == 422


class TestBookReadingTime:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/books/{BOOKS[0]['id']}/reading-time")
        assert r.status_code == 401

    def test_missing(self):
        r = requests.get(f"{BASE}/api/books/does-not-exist/reading-time", headers=H())
        assert r.status_code == 404

    def test_half_read_returns_half_remaining(self):
        # Reset wpm to 250 first.
        requests.put(f"{BASE}/api/user/wpm", json={"words_per_minute": 250}, headers=H())
        half = BOOKS[1]  # 10_000 words, progress 0.5
        r = requests.get(f"{BASE}/api/books/{half['id']}/reading-time", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert data["word_count"] == 10000
        assert data["minutes_total"] == 40  # 10_000 / 250
        # 50% remaining = 20 minutes (allow ±1 for rounding)
        assert 19 <= data["minutes_remaining"] <= 21


class TestLibraryReadingStats:
    def test_aggregate(self):
        # Reset wpm to 250 (previous test may have changed it).
        requests.put(f"{BASE}/api/user/wpm", json={"words_per_minute": 250}, headers=H())
        r = requests.get(f"{BASE}/api/library/reading-stats", headers=H())
        assert r.status_code == 200
        data = r.json()
        # total words = 50_000 + 10_000 + 3_000 = 63_000
        assert data["total_words"] == 63000
        # unfinished words = 50_000 (Unread Long, 0% read) + 5_000 (half) = 55_000
        assert data["unfinished_words"] == 55000
        # finished words = 3_000
        assert data["finished_words"] == 3000
        # books with word_count = 3, without = 0
        assert data["books_with_wordcount"] == 3
        assert data["books_without_wordcount"] == 0
        # total minutes = ceil(63000 / 250) = 252
        assert data["total_minutes"] == 252


class TestBackfill:
    def test_admin_only(self):
        r = requests.post(f"{BASE}/api/admin/wordcount/backfill", headers=H("user"))
        assert r.status_code == 403

    def test_backfill_from_fulltext_row(self):
        # Insert a book WITHOUT word_count, plus its fulltext row with a known text length.
        bid = f"wc_backfill_{uuid.uuid4().hex[:6]}"
        # 1000 words exactly.
        text = " ".join([f"w{i}" for i in range(1000)])
        db.books.insert_one({
            "book_id": bid, "user_id": USER["user_id"], "title": "Backfill book",
            "author": "T", "category": "Fanfiction", "created_at": datetime.now(timezone.utc),
        })
        db.book_fulltext.insert_one({
            "book_id": bid, "user_id": USER["user_id"],
            "text": text, "indexed_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            # Use the maximum scan window so the test's freshly-inserted
            # fulltext row is guaranteed to be in the scanned set even on
            # a shared dev DB that already has thousands of rows.
            r = requests.post(
                f"{BASE}/api/admin/wordcount/backfill?limit=20000",
                headers=H("admin"),
            )
            assert r.status_code == 200
            data = r.json()
            assert data["scanned"] >= 1
            assert data["updated"] >= 1
            # The book now has word_count = 1000.
            b = db.books.find_one({"book_id": bid}, {"_id": 0, "word_count": 1})
            assert b["word_count"] == 1000
        finally:
            db.books.delete_one({"book_id": bid})
            db.book_fulltext.delete_one({"book_id": bid})

    def test_backfill_does_not_overwrite_existing(self):
        # The existing books already have word_count → backfill should skip them.
        before = list(db.books.find({"user_id": USER["user_id"]}, {"_id": 0, "book_id": 1, "word_count": 1}))
        # Insert a fulltext row matching one of them with a wrong word count.
        target = BOOKS[0]
        db.book_fulltext.update_one(
            {"book_id": target["id"]},
            {"$set": {"book_id": target["id"], "user_id": USER["user_id"], "text": "only three words here"}},
            upsert=True,
        )
        try:
            r = requests.post(f"{BASE}/api/admin/wordcount/backfill", headers=H("admin"))
            assert r.status_code == 200
            # Original word_count preserved.
            doc = db.books.find_one({"book_id": target["id"]}, {"_id": 0, "word_count": 1})
            assert doc["word_count"] == target["word_count"]  # 50_000 unchanged
        finally:
            db.book_fulltext.delete_one({"book_id": target["id"]})
