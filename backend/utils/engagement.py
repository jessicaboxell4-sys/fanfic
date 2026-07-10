"""Engagement / re-engagement helpers.

Scheduler ticks that pull readers back into the app:

* ``stuck_books_reengagement_tick`` — Sunday 17:00 UTC.  Finds books
  every user started but hasn't touched in 14+ days and pushes a
  single in-app notification with the top 3.  Users who have no
  stuck books get no ping (quiet weeks stay quiet).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict

from deps import db, logger
from routes.notifications import create_notification


async def stuck_books_reengagement_tick() -> Dict[str, Any]:
    """Per-user roundup of stuck books → one in-app notification each."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    # Pull every stuck (book_id, user_id, title, last_opened_at, percent).
    cursor = db.books.find(
        {
            "last_opened_at": {"$lt": cutoff, "$exists": True},
            "progress_fraction": {"$gt": 0.01, "$lt": 0.30},
            "trashed": {"$ne": True},
            "is_dnf": {"$ne": True},
        },
        {"_id": 0, "user_id": 1, "title": 1, "last_opened_at": 1, "progress_fraction": 1},
    ).sort("last_opened_at", 1)

    by_user: Dict[str, list] = {}
    async for b in cursor:
        uid = b.get("user_id")
        if not uid:
            continue
        bucket = by_user.setdefault(uid, [])
        if len(bucket) < 3:   # only need the worst 3 per user
            bucket.append(b)

    sent = 0
    for uid, books in by_user.items():
        if not books:
            continue
        names = ", ".join(
            (f"\u201c{b.get('title', 'a book')}\u201d") for b in books[:3]
        )
        body = (
            f"You started {len(books)} "
            f"{'book' if len(books) == 1 else 'books'} more than 14 days "
            f"ago but haven\u2019t come back to "
            f"{'it' if len(books) == 1 else 'them'}: {names}. "
            "Pick one back up — or mark it DNF and clear it from your shelf."
        )
        try:
            await create_notification(
                uid,
                kind="reengagement_stuck",
                title="\U0001F4DA  Stuck books from earlier this month",
                body=body,
                link="/library/stuck",
            )
            sent += 1
        except Exception as e:
            logger.exception("stuck_books_reengagement notify failed for %s: %s", uid, e)
    return {"recipients": sent}
