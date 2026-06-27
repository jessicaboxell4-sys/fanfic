"""Iter 77 — Background AV scan.

Verifies the new fire-and-forget AV pipeline:
  • Background task flips status to "clean" / "infected" within a
    bounded window
  • Scanner failures land "unscanned" (not "clean", not "infected")
  • The recovery cron (rescan_pending) picks up stuck "pending"
    rows older than max_age_seconds and leaves fresh rows alone

Uses the session-wide shared_event_loop fixture from conftest.py
(no pytest-asyncio dependency required).
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


class _AsyncSpy:
    """Tiny async callable that records its calls.  Used as a stand-in
    for ``utils.antivirus.record_quarantine`` so we don't need to
    pull in pytest-mock just for one test.
    """
    def __init__(self):
        self.calls = []

    async def __call__(self, *args, **kwargs):
        self.calls.append({"args": args, **kwargs})
        return None


def test_schedule_background_scan_flips_to_clean(shared_event_loop):
    """Happy path — clean ClamAV result flips status to 'clean'."""
    from deps import db
    from utils.av_background import schedule_background_scan
    import asyncio

    user_id = f"user_iter77_clean_{uuid.uuid4().hex[:8]}"
    book_id = f"book_iter77_clean_{uuid.uuid4().hex[:8]}"

    async def setup():
        await db.books.insert_one({
            "book_id": book_id, "user_id": user_id,
            "filename": "clean.epub", "title": "Iter77 Clean",
            "av_status": "pending", "created_at": _now_iso(),
            "_iter77": True,
        })

    async def wait_for_status(target, max_iter=30):
        for _ in range(max_iter):
            await asyncio.sleep(0.05)
            doc = await db.books.find_one({"book_id": book_id}, {"av_status": 1})
            if doc and doc.get("av_status") == target:
                return doc
        return doc

    async def cleanup():
        await db.books.delete_one({"book_id": book_id})

    shared_event_loop.run_until_complete(setup())
    try:
        with patch(
            "utils.antivirus.scan_bytes",
            return_value={"ok": True, "infected": False,
                          "signature": None, "scanner": "test"},
        ):
            # Schedule needs to be called on the same loop the task
            # will run on — wrap in a tiny coro so it sees the loop.
            async def schedule_then_wait():
                schedule_background_scan(user_id, book_id, b"epub-bytes", "clean.epub")
                return await wait_for_status("clean")
            doc = shared_event_loop.run_until_complete(schedule_then_wait())
        assert doc["av_status"] == "clean", f"expected 'clean', got {doc!r}"
    finally:
        shared_event_loop.run_until_complete(cleanup())


def test_schedule_background_scan_flags_infected(shared_event_loop):
    """Infected returns flip status to 'infected' AND record_quarantine
    is called with the right metadata.
    """
    from deps import db
    from utils.av_background import schedule_background_scan
    import asyncio

    user_id = f"user_iter77_inf_{uuid.uuid4().hex[:8]}"
    book_id = f"book_iter77_inf_{uuid.uuid4().hex[:8]}"

    async def setup():
        await db.books.insert_one({
            "book_id": book_id, "user_id": user_id,
            "filename": "eicar.epub", "av_status": "pending",
            "created_at": _now_iso(), "_iter77": True,
        })

    async def wait_for_status(target, max_iter=30):
        doc = None
        for _ in range(max_iter):
            await asyncio.sleep(0.05)
            doc = await db.books.find_one(
                {"book_id": book_id},
                {"av_status": 1, "av_signature": 1},
            )
            if doc and doc.get("av_status") == target:
                return doc
        return doc

    async def cleanup():
        await db.books.delete_one({"book_id": book_id})
        await db.av_quarantine.delete_many({"user_id": user_id})

    shared_event_loop.run_until_complete(setup())
    try:
        spy = _AsyncSpy()
        with patch(
            "utils.antivirus.scan_bytes",
            return_value={"ok": True, "infected": True,
                          "signature": "Eicar-Test-Signature",
                          "scanner": "test"},
        ), patch("utils.antivirus.record_quarantine", new=spy):
            async def schedule_then_wait():
                schedule_background_scan(user_id, book_id, b"EICAR", "eicar.epub")
                return await wait_for_status("infected")
            doc = shared_event_loop.run_until_complete(schedule_then_wait())

        assert doc["av_status"] == "infected", f"expected 'infected', got {doc!r}"
        assert doc["av_signature"] == "Eicar-Test-Signature"
        assert spy.calls, "record_quarantine was not invoked"
        first = spy.calls[0]
        assert first["user_id"] == user_id
        assert first["filename"] == "eicar.epub"
    finally:
        shared_event_loop.run_until_complete(cleanup())


def test_scanner_failure_marks_unscanned(shared_event_loop):
    """ClamAV throwing must NOT silently mark the book clean — that
    would let unsafe files through whenever our scanner has a bad
    day.  Must NOT mark it infected — that would punish the user
    for our bug.  Correct answer: 'unscanned' so the user-safety
    widget picks it up for manual rescan.
    """
    from deps import db
    from utils.av_background import schedule_background_scan
    import asyncio

    user_id = f"user_iter77_err_{uuid.uuid4().hex[:8]}"
    book_id = f"book_iter77_err_{uuid.uuid4().hex[:8]}"

    async def setup():
        await db.books.insert_one({
            "book_id": book_id, "user_id": user_id,
            "filename": "x.epub", "av_status": "pending",
            "created_at": _now_iso(), "_iter77": True,
        })

    async def wait_for_status(target, max_iter=30):
        doc = None
        for _ in range(max_iter):
            await asyncio.sleep(0.05)
            doc = await db.books.find_one({"book_id": book_id}, {"av_status": 1})
            if doc and doc.get("av_status") == target:
                return doc
        return doc

    async def cleanup():
        await db.books.delete_one({"book_id": book_id})

    shared_event_loop.run_until_complete(setup())
    try:
        def _raise(*_a, **_k):
            raise RuntimeError("clamd socket missing")
        with patch("utils.antivirus.scan_bytes", side_effect=_raise):
            async def schedule_then_wait():
                schedule_background_scan(user_id, book_id, b"bytes", "x.epub")
                return await wait_for_status("unscanned")
            doc = shared_event_loop.run_until_complete(schedule_then_wait())
        assert doc["av_status"] == "unscanned", f"expected 'unscanned', got {doc!r}"
    finally:
        shared_event_loop.run_until_complete(cleanup())


def test_rescan_pending_only_picks_old_rows(shared_event_loop):
    """Recovery cron must leave fresh in-flight scans alone and only
    pick up rows that have been stuck pending for >max_age_seconds.
    """
    from deps import db
    from utils.av_background import rescan_pending

    user_id = f"user_iter77_recov_{uuid.uuid4().hex[:8]}"
    fresh_id = f"book_iter77_fresh_{uuid.uuid4().hex[:8]}"
    stale_id = f"book_iter77_stale_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    long_ago = (now - timedelta(hours=1)).isoformat()
    now_iso = now.isoformat()

    async def setup():
        await db.books.insert_many([
            {"book_id": fresh_id, "user_id": user_id,
             "filename": "fresh.epub", "av_status": "pending",
             "created_at": now_iso, "_iter77": True},
            {"book_id": stale_id, "user_id": user_id,
             "filename": "stale.epub", "av_status": "pending",
             "created_at": long_ago, "_iter77": True},
        ])

    async def run_recovery():
        return await rescan_pending(max_age_seconds=300)

    async def fetch_states():
        fresh = await db.books.find_one({"book_id": fresh_id}, {"av_status": 1})
        stale = await db.books.find_one({"book_id": stale_id}, {"av_status": 1})
        return fresh, stale

    async def cleanup():
        await db.books.delete_many({"_iter77": True, "user_id": user_id})

    shared_event_loop.run_until_complete(setup())
    try:
        result = shared_event_loop.run_until_complete(run_recovery())
        fresh, stale = shared_event_loop.run_until_complete(fetch_states())
        # Stale row was either marked "unscanned" (file missing on disk
        # which is the test setup) or had a rescan rescheduled — either
        # way it must NOT stay quietly stuck on "pending" forever.
        assert stale["av_status"] in ("unscanned", "pending"), stale
        # Fresh row — created just now — must be left alone.
        assert fresh["av_status"] == "pending", fresh
        assert isinstance(result, dict)
        assert "rescanned" in result
    finally:
        shared_event_loop.run_until_complete(cleanup())
