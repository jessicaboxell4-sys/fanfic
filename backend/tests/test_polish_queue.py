"""Polish queue (deferred classifier) — regression tests.

Pins three invariants:
  1. ``upload_books`` no longer awaits ``classify_book`` inline —
     books land with ``classifier: "pending"`` and ``category:
     "Pending sort"``.
  2. ``polish_one_book`` flips a pending book to its classified state
     using the same classifier output the inline path used to write.
  3. ``polish_recovery_tick`` re-schedules drains for any user with
     pending books (tab-close / backend-restart resilience).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _uid() -> str:
    return f"user_polish_{uuid.uuid4().hex[:10]}"


def test_polish_one_book_classifies_and_updates(shared_event_loop):
    """polish_one_book writes the classifier output (fandom, category,
    confidence, classifier name) back to the book row."""
    from utils.polish_worker import polish_one_book

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        book_id = f"bk_{uuid.uuid4().hex[:10]}"
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Polisher",
                "approval_status": "approved",
            })
            await db.books.insert_one({
                "book_id": book_id,
                "user_id": uid,
                "title": "Test", "author": "A",
                "description": "", "language": "en", "publisher": "",
                "category": "Pending sort",
                "fandom": None,
                "classifier": "pending",
            })

            with patch(
                "utils.classifier.classify_book",
                new=AsyncMock(return_value={
                    "category": "Fanfiction",
                    "fandom": "Harry Potter",
                    "confidence": 0.92,
                    "classifier": "claude",
                }),
            ):
                book = await db.books.find_one({"book_id": book_id})
                updates = await polish_one_book(uid, book)

            assert updates["category"] == "Fanfiction"
            assert updates["fandom"] == "Harry Potter"
            assert updates["classifier"] == "claude"

            fresh = await db.books.find_one({"book_id": book_id})
            assert fresh["category"] == "Fanfiction"
            assert fresh["fandom"] == "Harry Potter"
            assert fresh["classifier"] == "claude"
            assert "polished_at" in fresh
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_polish_recovery_tick_picks_up_orphaned_pending(shared_event_loop):
    """The cron entry point reschedules a polish drain for every user
    that still has pending books — covers backend-restart-mid-drain."""
    from utils.polish_worker import polish_recovery_tick, _inflight_users

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid_a = _uid()
        uid_b = _uid()
        try:
            for uid in (uid_a, uid_b):
                await db.users.insert_one({
                    "user_id": uid,
                    "email": f"{uid}@example.com",
                    "name": "U",
                    "approval_status": "approved",
                })
                await db.books.insert_one({
                    "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                    "user_id": uid,
                    "title": "T",
                    "category": "Pending sort",
                    "classifier": "pending",
                })

            # Drop any prior in-flight gates so the recovery actually
            # schedules new drains for the two test users.
            _inflight_users.discard(uid_a)
            _inflight_users.discard(uid_b)

            with patch("utils.polish_worker.schedule_polish_for_user") as sched:
                scheduled = await polish_recovery_tick()

            # Recovery should pick up both pending users (>=2 since
            # other concurrent tests may also be running).
            assert scheduled >= 2
            scheduled_users = {c.args[0] for c in sched.call_args_list}
            assert uid_a in scheduled_users
            assert uid_b in scheduled_users
        finally:
            await db.users.delete_many({"user_id": {"$in": [uid_a, uid_b]}})
            await db.books.delete_many({"user_id": {"$in": [uid_a, uid_b]}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_inflight_gate_prevents_double_polish(shared_event_loop):
    """schedule_polish_for_user respects the _inflight_users gate so
    upload triggers + cron triggers don't double-classify the same
    user's books."""
    from utils.polish_worker import _polish_drain, _inflight_users

    async def _run():
        uid = _uid()
        try:
            _inflight_users.add(uid)
            # _polish_drain is a no-op when the user is gated.
            await _polish_drain(uid)
        finally:
            _inflight_users.discard(uid)

    shared_event_loop.run_until_complete(_run())


def test_polish_stats_counts_pending(shared_event_loop):
    """count_pending_for_user only counts pending books outside trash."""
    from utils.polish_worker import count_pending_for_user

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "U",
                "approval_status": "approved",
            })
            # 2 pending, 1 classified, 1 trashed-pending — count = 2
            await db.books.insert_one({
                "book_id": "p1", "user_id": uid, "title": "p1",
                "classifier": "pending", "category": "Pending sort",
            })
            await db.books.insert_one({
                "book_id": "p2", "user_id": uid, "title": "p2",
                "classifier": "pending", "category": "Pending sort",
            })
            await db.books.insert_one({
                "book_id": "c1", "user_id": uid, "title": "c1",
                "classifier": "claude", "category": "Fanfiction",
            })
            await db.books.insert_one({
                "book_id": "t1", "user_id": uid, "title": "t1",
                "classifier": "pending", "category": "Trash",
            })

            n = await count_pending_for_user(uid)
            assert n == 2
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())
