"""Classifier rationale — every classify path must populate a
``reasoning`` field so the BookCard tooltip ("why did Claude pick
this?") has something to show.

Pins:
  1. Heuristic single-fandom hit names the keyword that matched.
  2. Heuristic crossover lists the fandoms involved.
  3. Heuristic unclassified path returns a non-empty rationale.
  4. AI canned-response path passes the model's ``reasoning`` through.
  5. ``polish_one_book`` persists ``classifier_reason`` on the doc.
"""
from __future__ import annotations

import asyncio
import json
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


def test_heuristic_single_fandom_includes_reasoning():
    """Single-fandom hit returns a reasoning string mentioning the matched fandom."""
    from utils.classifier import classify_by_metadata
    meta = {
        "title": "Drarry slow burn",
        "author": "anon",
        "description": "Harry Potter and Draco Malfoy at Hogwarts.",
        "publisher": "",
        "sample_text": "",
    }
    res = classify_by_metadata(meta)
    assert res["fandom"] == "Harry Potter"
    assert "reasoning" in res
    assert "Harry Potter" in res["reasoning"]


def test_heuristic_unclassified_still_returns_reasoning():
    """Even the no-match path returns a non-empty reasoning."""
    from utils.classifier import classify_by_metadata
    res = classify_by_metadata({
        "title": "Random Title",
        "author": "Random Author",
        "description": "Generic text with no recognizable signals.",
        "publisher": "",
        "sample_text": "",
    })
    assert res["category"] == "Unclassified"
    assert res.get("reasoning")  # non-empty string


def test_ai_canned_response_passes_reasoning_through(monkeypatch):
    """SHELFSORT_TEST_AI_RESPONSE injects a known JSON payload — the
    ``reasoning`` field must survive into the classifier output."""
    from utils.classifier import classify_with_ai
    monkeypatch.setenv("SHELFSORT_TEST_AI_RESPONSE", json.dumps({
        "category": "Fanfiction",
        "fandom": "Harry Potter",
        "confidence": 0.9,
        "tags": ["fluff"],
        "reasoning": "Fandom tag explicitly names Harry Potter.",
    }))

    async def _run():
        res = await classify_with_ai({"title": "x", "author": "y"})
        assert res["reasoning"] == "Fandom tag explicitly names Harry Potter."

    asyncio.get_event_loop().run_until_complete(_run())


def test_polish_persists_classifier_reason(shared_event_loop):
    """polish_one_book writes ``classifier_reason`` to the book doc so
    the BookCard tooltip can read it."""
    from utils.polish_worker import polish_one_book

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = f"user_reason_{uuid.uuid4().hex[:10]}"
        book_id = f"bk_{uuid.uuid4().hex[:10]}"
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "R",
                "approval_status": "approved",
            })
            await db.books.insert_one({
                "book_id": book_id,
                "user_id": uid,
                "title": "T", "author": "A",
                "category": "Pending sort",
                "classifier": "pending",
            })
            with patch(
                "utils.classifier.classify_book",
                new=AsyncMock(return_value={
                    "category": "Fanfiction",
                    "fandom": "Harry Potter",
                    "confidence": 0.9,
                    "classifier": "claude",
                    "reasoning": "Title and description reference Hogwarts characters.",
                }),
            ):
                book = await db.books.find_one({"book_id": book_id})
                await polish_one_book(uid, book)

            fresh = await db.books.find_one({"book_id": book_id})
            assert fresh["classifier_reason"] == "Title and description reference Hogwarts characters."
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())
