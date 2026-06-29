"""``utils/polish_worker.py`` — defer-classifier background queue.

Why this exists
---------------
``routes/books.upload_books`` used to call ``classify_book`` inline for
every uploaded EPUB.  The Claude classifier is the single slowest step
in the per-file pipeline (~1-8s/file), and on big bulk drops it
dominates wall-clock time.

To make uploads feel instant, the classifier is now **deferred**:

1. ``upload_books`` writes a book row with ``classifier: "pending"``,
   ``category: "Pending sort"``, ``fandom: None``.  The book lands in
   the library immediately, with title / author / cover / AO3 tags
   already populated from the EPUB metadata.
2. ``schedule_polish_for_user(user_id)`` fires a fire-and-forget task
   on the running event loop.  The worker reads every
   ``classifier: "pending"`` book for the user, runs ``classify_book``,
   updates the row, and continues to the next.
3. A ``polish_recovery_tick`` cron in ``server.py`` sweeps for any
   pending books across all users that have been stuck for more than
   2 minutes — picks up the slack when the backend restarted
   mid-polish, OR when the user uploaded from a different
   environment that didn't trigger schedule.

Tab-close resilience
--------------------
The polish task runs entirely on the **backend** event loop.  The
browser HTTP connection is irrelevant — closing the tab does not
cancel the work.  Backend restarts are covered by the recovery cron.

Concurrency cap
---------------
Each Claude call holds the event loop for up to 8 seconds (the
classifier's hard timeout).  An unbounded fan-out across hundreds of
pending books would saturate the LLM provider and starve other
requests.  A module-level semaphore caps in-flight classifies at
``POLISH_CONCURRENCY`` (default 4) — same headroom as the AV
background worker.

Public API
----------

==============================  =====================================
``schedule_polish_for_user``    Fire-and-forget polish of one user's
                                pending books.
``polish_one_book``             Polish a single book (used by the
                                per-book "Sort now" button).
``polish_recovery_tick``        Cron entry-point — picks up pending
                                books >2 min old across all users.
``count_pending_for_user``      Cheap count for the UI banner.
==============================  =====================================
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from deps import db
from utils.constants import PENDING_SORT_SHELF, TRASH_SHELF

logger = logging.getLogger(__name__)

POLISH_CONCURRENCY = int(os.environ.get("POLISH_CONCURRENCY", "4"))
_sem: Optional[asyncio.Semaphore] = None

# Per-user "is a polish run currently in flight?" flag.  Prevents the
# upload-end trigger from spawning a second worker on the same user
# while the first is still draining (which would double-classify).
_inflight_users: set[str] = set()


def _get_sem() -> asyncio.Semaphore:
    """Lazy-init on the current event loop so imports don't bind a loop."""
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(POLISH_CONCURRENCY)
    return _sem


async def count_pending_for_user(user_id: str) -> int:
    """Cheap count for the UI banner — ``Polish N pending``."""
    return await db.books.count_documents({
        "user_id": user_id,
        "classifier": "pending",
        "category": {"$ne": TRASH_SHELF},
    })


async def polish_one_book(user_id: str, book: dict) -> dict:
    """Run the classifier on a single book, update the doc, return the
    fields that changed.  Caller has already loaded ``book``; we only
    write the result.

    ``book`` must include the EPUB metadata fields the classifier
    consumes (title, author, description, tags, language, publisher,
    plus the AO3 extras: relationships, rating, warnings, categories,
    ao3_freeform_tags).  The book row produced by
    ``routes/books.upload_books`` always has these.
    """
    # Late import keeps module load light and avoids any
    # circular-import surprise from ``routes.books`` importing us.
    from utils.classifier import classify_book, classify_by_metadata
    from routes.books import _canonicalize_fandom
    from routes.admin import get_global_fandom_aliases_dict

    # Build the same "meta" shape extract_epub_metadata returns so
    # classify_book sees its expected inputs.
    meta = {
        "title": book.get("title") or "",
        "author": book.get("author") or "",
        "description": book.get("description") or "",
        "language": book.get("language") or "",
        "publisher": book.get("publisher") or "",
        "tags": book.get("tags") or [],
        "relationships": book.get("relationships") or [],
        "rating": book.get("rating"),
        "warnings": book.get("warnings") or [],
        "categories": book.get("categories") or [],
        "ao3_freeform_tags": book.get("ao3_freeform_tags") or [],
    }
    try:
        classification = await asyncio.wait_for(classify_book(meta), timeout=8.0)
    except asyncio.TimeoutError:
        logger.warning(
            "polish_one_book: classifier timed out for %s — using rule-based fallback",
            book.get("book_id"),
        )
        try:
            classification = classify_by_metadata(meta) or {}
        except Exception:  # noqa: BLE001
            classification = {}
        classification["classifier"] = "timeout-fallback"

    # Re-apply the same fandom canonicalization upload_books uses so
    # the polished output is indistinguishable from the inline-classify
    # path.
    udoc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "fandom_aliases": 1}) or {}
    user_aliases = udoc.get("fandom_aliases") or {}
    global_aliases = await get_global_fandom_aliases_dict()
    aliases = {**global_aliases, **user_aliases}

    updates = {
        "category": classification.get("category") or PENDING_SORT_SHELF,
        "fandom": _canonicalize_fandom(classification.get("fandom"), aliases),
        "confidence": classification.get("confidence"),
        "classifier": classification.get("classifier") or "claude",
        "classifier_reason": classification.get("reasoning"),
        "polished_at": datetime.now(timezone.utc).isoformat(),
    }
    # Only write what actually changed so we don't churn the doc on
    # repeated polish attempts.
    await db.books.update_one(
        {"book_id": book["book_id"], "user_id": user_id},
        {"$set": updates},
    )
    return updates


async def _polish_drain(user_id: str) -> None:
    """Inner worker — drain every pending book for ``user_id`` then
    release the in-flight slot."""
    if user_id in _inflight_users:
        return
    _inflight_users.add(user_id)
    try:
        sem = _get_sem()
        # Re-query each round so books uploaded mid-drain also get
        # picked up.  Cap at 1000/round to avoid an unbounded cursor.
        while True:
            batch = await db.books.find(
                {"user_id": user_id, "classifier": "pending", "category": {"$ne": TRASH_SHELF}},
                {"_id": 0},
            ).limit(50).to_list(50)
            if not batch:
                break

            async def _one(b):
                async with sem:
                    try:
                        await polish_one_book(user_id, b)
                    except Exception as exc:  # noqa: BLE001
                        # 2026-06-28 — distinguish transient (Mongo blip,
                        # Atlas failover, AutoReconnect) from permanent
                        # (bad metadata, classifier bug).  Transient
                        # errors leave the book as ``pending`` so the
                        # recovery cron picks it up next tick — the
                        # original code permanently sentinelized them,
                        # which was the most likely cause of the "a few
                        # books wouldn't polish" complaint.
                        from utils.db_retry import is_transient_mongo_error
                        if is_transient_mongo_error(exc):
                            logger.warning(
                                "polish_one_book transient-Mongo for %s: %s — leaving as pending for recovery cron",
                                b.get("book_id"), type(exc).__name__,
                            )
                            return
                        logger.exception(
                            "polish_one_book failed for %s — marking polish-failed (attempt %d)",
                            b.get("book_id"), (b.get("polish_attempts") or 0) + 1,
                        )
                        # Best-effort sentinel write; wrap in retry so a
                        # second blip doesn't lose the book's audit
                        # trail.  Records attempt count + last error so
                        # the retry inbox can show the user something
                        # actionable instead of a mystery.
                        from utils.db_retry import retry_on_transient
                        attempts = (b.get("polish_attempts") or 0) + 1
                        try:
                            await retry_on_transient(
                                lambda: db.books.update_one(
                                    {"book_id": b["book_id"], "user_id": user_id},
                                    {"$set": {
                                        "classifier": "polish-failed",
                                        "polish_attempts": attempts,
                                        "polish_last_error": (str(exc) or type(exc).__name__)[:200],
                                        "polish_failed_at": datetime.now(timezone.utc).isoformat(),
                                    }},
                                ),
                                label="polish-sentinel-write",
                            )
                        except Exception:  # noqa: BLE001
                            logger.exception(
                                "polish-sentinel write also failed for %s — book stays pending",
                                b.get("book_id"),
                            )

            await asyncio.gather(*[_one(b) for b in batch])
    finally:
        _inflight_users.discard(user_id)


def schedule_polish_for_user(user_id: str) -> None:
    """Fire-and-forget polish for a user's pending books.

    Safe to call repeatedly — internal _inflight_users gate ensures
    only one polish drain runs per user at a time.  Subsequent calls
    are no-ops; the running drain naturally re-queries and picks up
    any books inserted in the meantime.
    """
    try:
        asyncio.create_task(_polish_drain(user_id))
    except RuntimeError:
        # No running event loop (e.g. called from a sync admin script);
        # silently no-op — the recovery cron will pick up the work.
        logger.warning("schedule_polish_for_user: no event loop, deferring to recovery cron")


async def polish_recovery_tick() -> int:
    """Cron entry-point — scan every user with pending books and
    re-schedule polish for them.  Catches:

      • backend restarted mid-polish (the in-memory task died)
      • uploads imported via admin scripts that didn't trigger schedule
      • polish-failed books retried after operator intervention

    Returns the number of users scheduled.  Logged in server.py so the
    operator can confirm the cron is alive.
    """
    pipeline = [
        {"$match": {"classifier": "pending", "category": {"$ne": TRASH_SHELF}}},
        {"$group": {"_id": "$user_id"}},
        {"$limit": 200},
    ]
    scheduled = 0
    async for row in db.books.aggregate(pipeline):
        uid = row.get("_id")
        if not uid:
            continue
        if uid in _inflight_users:
            continue
        schedule_polish_for_user(uid)
        scheduled += 1
    if scheduled > 0:
        logger.info("polish_recovery_tick: scheduled polish for %d user(s)", scheduled)
    return scheduled
