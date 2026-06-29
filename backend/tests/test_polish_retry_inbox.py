"""Iter57 — polish retry inbox + transient-Mongo guard.

Covers:
  * GET /api/polish/failed — auth-gated, user-isolated, lists
    polish-failed books with the expected shape, sorted desc by
    polish_failed_at.
  * POST /api/polish — resets polish-failed→pending AND unsets
    polish_attempts/polish_last_error/polish_failed_at.
  * GET /api/polish/stats — still returns {pending,failed,arriving,
    in_progress}.
  * POST /api/polish/{book_id} — still polishes one book inline.
  * Queue-summary integration — polish_failed count matches
    /polish/failed.count and /polish/stats.failed.
  * _polish_drain transient-vs-permanent split — AutoReconnect leaves
    the book as classifier='pending'; permanent exception sentinels
    polish-failed with attempts/last_error/failed_at populated.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient
from pymongo.errors import AutoReconnect

# Ensure backend package importable for direct-async tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
mdb = mc[DB_NAME]


# ---------- helpers --------------------------------------------------


def _register_session() -> tuple[requests.Session, str]:
    """Register a fresh user and return (session-with-Bearer, user_id)."""
    s = requests.Session()
    email = f"TEST_polish-{uuid.uuid4().hex[:8]}@example.com"
    pw = "hunter2pw!"
    r = s.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": pw, "name": "Polish Retry"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    user_doc = body.get("user", body)
    user_id = user_doc.get("user_id")
    assert user_id, f"no user_id in register response: {body}"

    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, f"no session_token in Set-Cookie: {cookies[:200]}"
    s.headers.update({"Authorization": f"Bearer {m.group(1)}"})
    return s, user_id


def _seed_failed_book(
    user_id: str, *, attempts: int = 2, error: str = "boom",
    failed_at: datetime | None = None, **extra,
) -> str:
    bid = f"TEST_book_{uuid.uuid4().hex[:8]}"
    doc = {
        "book_id": bid,
        "user_id": user_id,
        "title": extra.get("title", f"Failed Book {bid[-4:]}"),
        "author": extra.get("author", "Test Author"),
        "fandom": extra.get("fandom", "Marvel"),
        "filename": extra.get("filename", f"{bid}.epub"),
        "classifier": "polish-failed",
        "category": "Pending sort",
        "polish_attempts": attempts,
        "polish_last_error": error,
        "polish_failed_at": (failed_at or datetime.now(timezone.utc)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    mdb.books.insert_one(doc)
    return bid


def _cleanup(user_id: str) -> None:
    mdb.books.delete_many({"user_id": user_id})
    mdb.users.delete_many({"user_id": user_id})
    mdb.user_sessions.delete_many({"user_id": user_id})


# ---------- fixtures -------------------------------------------------


@pytest.fixture
def user_a():
    s, uid = _register_session()
    yield {"session": s, "user_id": uid}
    _cleanup(uid)


@pytest.fixture
def user_b():
    s, uid = _register_session()
    yield {"session": s, "user_id": uid}
    _cleanup(uid)


# ---------- GET /polish/failed ---------------------------------------


class TestPolishFailedEndpoint:
    def test_requires_auth(self):
        r = requests.get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_returns_shape_and_fields(self, user_a):
        bid = _seed_failed_book(
            user_a["user_id"],
            attempts=3,
            error="classifier returned dict",
            title="Iron Man",
            author="Stan Lee",
            fandom="Marvel",
            filename="iron_man.epub",
        )
        r = user_a["session"].get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert "count" in body and "books" in body
        assert body["count"] == 1
        assert isinstance(body["books"], list) and len(body["books"]) == 1
        b = body["books"][0]
        # Required fields present
        for k in ("book_id", "title", "author", "fandom", "filename",
                  "polish_attempts", "polish_last_error", "polish_failed_at"):
            assert k in b, f"missing {k} in {b}"
        # _id is NOT leaked
        assert "_id" not in b
        # Values match seed
        assert b["book_id"] == bid
        assert b["title"] == "Iron Man"
        assert b["author"] == "Stan Lee"
        assert b["fandom"] == "Marvel"
        assert b["filename"] == "iron_man.epub"
        assert b["polish_attempts"] == 3
        assert b["polish_last_error"] == "classifier returned dict"

    def test_sorted_desc_by_failed_at(self, user_a):
        now = datetime.now(timezone.utc)
        b_old = _seed_failed_book(user_a["user_id"], failed_at=now - timedelta(hours=2),
                                  title="Older")
        b_new = _seed_failed_book(user_a["user_id"], failed_at=now,
                                  title="Newer")
        b_mid = _seed_failed_book(user_a["user_id"], failed_at=now - timedelta(hours=1),
                                  title="Middle")
        r = user_a["session"].get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 200
        ids = [b["book_id"] for b in r.json()["books"]]
        assert ids == [b_new, b_mid, b_old], f"sort wrong: {ids}"

    def test_user_isolation(self, user_a, user_b):
        _seed_failed_book(user_b["user_id"], title="B's failure")
        r = user_a["session"].get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 0, f"leaked: {body}"
        assert body["books"] == []

    def test_excludes_trash(self, user_a):
        # Seed one in Trash, one not.
        _seed_failed_book(user_a["user_id"], title="Trashed")
        # Update the trashed book's category to Trash.
        mdb.books.update_one(
            {"user_id": user_a["user_id"], "title": "Trashed"},
            {"$set": {"category": "Trash"}},
        )
        _seed_failed_book(user_a["user_id"], title="Live")
        r = user_a["session"].get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1, f"expected 1 (excl trash), got {body}"
        assert body["books"][0]["title"] == "Live"

    def test_empty_inbox(self, user_a):
        r = user_a["session"].get(f"{BASE}/api/polish/failed", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body == {"count": 0, "books": []}


# ---------- POST /polish reset behavior ------------------------------


class TestPolishBulkResetClearsSentinelFields:
    def test_reset_clears_polish_attempts_and_error(self, user_a):
        bid = _seed_failed_book(
            user_a["user_id"], attempts=4, error="prior error",
        )
        # Confirm seeded state
        pre = mdb.books.find_one({"book_id": bid})
        assert pre["classifier"] == "polish-failed"
        assert pre["polish_attempts"] == 4
        assert pre["polish_last_error"] == "prior error"
        assert "polish_failed_at" in pre

        r = user_a["session"].post(f"{BASE}/api/polish", timeout=15)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert "queued" in body and "in_progress" in body

        # The book should now be classifier='pending' AND the sentinel
        # fields should be unset (not just blanked).
        post = mdb.books.find_one({"book_id": bid})
        assert post["classifier"] == "pending", f"classifier not reset: {post.get('classifier')}"
        assert "polish_attempts" not in post, f"polish_attempts not unset: {post}"
        assert "polish_last_error" not in post, f"polish_last_error not unset: {post}"
        assert "polish_failed_at" not in post, f"polish_failed_at not unset: {post}"

    def test_reset_only_touches_polish_failed(self, user_a):
        # A polish-failed book and a pending book — only the former
        # should be reset; pending should remain untouched.
        bid_failed = _seed_failed_book(user_a["user_id"], attempts=2)
        bid_pending = f"TEST_book_{uuid.uuid4().hex[:8]}"
        mdb.books.insert_one({
            "book_id": bid_pending,
            "user_id": user_a["user_id"],
            "title": "Pending one",
            "classifier": "pending",
            "category": "Pending sort",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = user_a["session"].post(f"{BASE}/api/polish", timeout=15)
        assert r.status_code == 200
        f = mdb.books.find_one({"book_id": bid_failed})
        p = mdb.books.find_one({"book_id": bid_pending})
        assert f["classifier"] == "pending"
        assert "polish_attempts" not in f
        # Pending book untouched
        assert p["classifier"] == "pending"
        assert "polish_attempts" not in p


# ---------- /polish/stats shape preserved ----------------------------


class TestPolishStatsShape:
    def test_stats_returns_expected_keys(self, user_a):
        r = user_a["session"].get(f"{BASE}/api/polish/stats", timeout=10)
        assert r.status_code == 200
        body = r.json()
        for k in ("pending", "failed", "arriving", "in_progress"):
            assert k in body, f"missing {k} in {body}"
        assert isinstance(body["pending"], int)
        assert isinstance(body["failed"], int)
        assert isinstance(body["arriving"], int)
        assert isinstance(body["in_progress"], bool)
        # Fresh user => all zero
        assert body["pending"] == 0
        assert body["failed"] == 0
        assert body["arriving"] == 0

    def test_stats_counts_failed(self, user_a):
        _seed_failed_book(user_a["user_id"])
        _seed_failed_book(user_a["user_id"])
        r = user_a["session"].get(f"{BASE}/api/polish/stats", timeout=10)
        assert r.status_code == 200
        assert r.json()["failed"] == 2


# ---------- Queue-summary integration --------------------------------


class TestQueueSummaryIntegration:
    def test_polish_failed_count_matches_inbox(self, user_a):
        # Seed 3 failed books.
        for _ in range(3):
            _seed_failed_book(user_a["user_id"])

        s = user_a["session"]
        qs = s.get(f"{BASE}/api/books/upload/queue-summary", timeout=10)
        inbox = s.get(f"{BASE}/api/polish/failed", timeout=10)
        stats = s.get(f"{BASE}/api/polish/stats", timeout=10)
        assert qs.status_code == 200 and inbox.status_code == 200 and stats.status_code == 200

        qs_failed = qs.json()["polish_failed"]
        inbox_count = inbox.json()["count"]
        stats_failed = stats.json()["failed"]
        assert qs_failed == inbox_count == stats_failed == 3, (
            f"mismatch: qs={qs_failed} inbox={inbox_count} stats={stats_failed}"
        )


# ---------- POST /polish/{book_id} inline polish ---------------------


class TestPolishOneStillWorks:
    def test_unknown_book_returns_404(self, user_a):
        r = user_a["session"].post(
            f"{BASE}/api/polish/does-not-exist-xyz", timeout=10,
        )
        assert r.status_code == 404


# ---------- _polish_drain transient vs permanent ---------------------
# Direct async tests against the worker function with monkeypatched
# polish_one_book. These bypass HTTP and exercise the exception
# handler's new transient/permanent split.


class TestPolishDrainTransientVsPermanent:
    def test_transient_mongo_error_leaves_book_pending(self, shared_event_loop):
        """AutoReconnect during polish should NOT sentinel the book."""
        from utils import polish_worker as pw

        uid = f"user_drain_{uuid.uuid4().hex[:8]}"
        bid = f"TEST_book_{uuid.uuid4().hex[:8]}"
        mdb.users.insert_one({
            "user_id": uid, "email": f"{uid}@x", "name": "drain test",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mdb.books.insert_one({
            "book_id": bid, "user_id": uid,
            "title": "transient", "author": "x",
            "classifier": "pending", "category": "Pending sort",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            original = pw.polish_one_book

            async def boom_transient(user_id, book):
                raise AutoReconnect("simulated atlas failover")

            pw.polish_one_book = boom_transient
            # Reset any inflight state from prior runs.
            pw._inflight_users.discard(uid)

            async def _bounded():
                # The drain loops while pending books remain.  In the
                # transient branch we deliberately keep the book
                # pending, so the loop would spin forever — wrap in a
                # short wait_for so we just exercise one iteration
                # and then cancel.
                try:
                    await asyncio.wait_for(pw._polish_drain(uid), timeout=2.0)
                except asyncio.TimeoutError:
                    pass

            try:
                shared_event_loop.run_until_complete(_bounded())
            finally:
                pw.polish_one_book = original
                pw._inflight_users.discard(uid)

            doc = mdb.books.find_one({"book_id": bid})
            assert doc is not None
            # Book must remain pending — NOT sentinelized.
            assert doc["classifier"] == "pending", (
                f"transient error wrongly sentinelized book: {doc.get('classifier')}"
            )
            assert "polish_attempts" not in doc, f"polish_attempts set: {doc}"
            assert "polish_last_error" not in doc, f"polish_last_error set: {doc}"
            assert "polish_failed_at" not in doc, f"polish_failed_at set: {doc}"
        finally:
            mdb.books.delete_many({"user_id": uid})
            mdb.users.delete_many({"user_id": uid})

    def test_permanent_error_sentinels_with_attempt_metadata(self, shared_event_loop):
        """A non-transient exception should mark the book polish-failed
        and populate polish_attempts/polish_last_error/polish_failed_at.
        """
        from utils import polish_worker as pw

        uid = f"user_drain_{uuid.uuid4().hex[:8]}"
        bid = f"TEST_book_{uuid.uuid4().hex[:8]}"
        mdb.users.insert_one({
            "user_id": uid, "email": f"{uid}@x", "name": "drain test perm",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mdb.books.insert_one({
            "book_id": bid, "user_id": uid,
            "title": "permanent", "author": "x",
            "classifier": "pending", "category": "Pending sort",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            original = pw.polish_one_book

            async def boom_permanent(user_id, book):
                raise ValueError("classifier returned a dict")

            pw.polish_one_book = boom_permanent
            pw._inflight_users.discard(uid)

            try:
                shared_event_loop.run_until_complete(pw._polish_drain(uid))
            finally:
                pw.polish_one_book = original

            doc = mdb.books.find_one({"book_id": bid})
            assert doc is not None
            assert doc["classifier"] == "polish-failed", (
                f"permanent error did NOT sentinel: {doc.get('classifier')}"
            )
            assert doc.get("polish_attempts") == 1, (
                f"polish_attempts wrong: {doc.get('polish_attempts')}"
            )
            assert isinstance(doc.get("polish_last_error"), str) and doc["polish_last_error"], (
                f"polish_last_error missing: {doc.get('polish_last_error')}"
            )
            assert "classifier returned a dict" in doc["polish_last_error"]
            assert isinstance(doc.get("polish_failed_at"), str), (
                f"polish_failed_at missing: {doc.get('polish_failed_at')}"
            )
            # Parses as ISO timestamp.
            datetime.fromisoformat(doc["polish_failed_at"])
        finally:
            mdb.books.delete_many({"user_id": uid})
            mdb.users.delete_many({"user_id": uid})


# ---------- db_retry predicate sanity --------------------------------


class TestIsTransientPredicate:
    def test_autoreconnect_is_transient(self):
        from utils.db_retry import is_transient_mongo_error
        assert is_transient_mongo_error(AutoReconnect("x")) is True

    def test_value_error_not_transient(self):
        from utils.db_retry import is_transient_mongo_error
        assert is_transient_mongo_error(ValueError("bad")) is False
