"""Word count + estimated reading time.

Each book's `word_count` is computed at upload time (from the same
fulltext extraction pass that powers search). Two flavours of derived
data hang off this:

  1. Per-book `estimated_reading_minutes` — `word_count / words_per_minute`.
     The wpm is the user's preference (DEFAULT_WORDS_PER_MINUTE if unset).
     We never store the minutes on the doc — they're computed at read
     time so changing wpm doesn't require re-stamping the library.

  2. Aggregate `reading-stats` — sum of remaining reading time across
     unfinished books. Surfaced on the dashboard as "X hours left to read".

Backfill: for books predating the fulltext index, an admin endpoint
walks `book_fulltext` rows (which exist for every indexed book) and
stamps `word_count` from the text — no EPUB re-read needed.

Endpoints:
  GET  /api/user/wpm                       — current pref + default + bounds
  PUT  /api/user/wpm  body={words_per_minute: int}
  GET  /api/books/{book_id}/reading-time   — {word_count, minutes, wpm}
  GET  /api/library/reading-stats          — aggregate dashboard stat
  POST /api/admin/wordcount/backfill       — sync word_count from book_fulltext
"""
from typing import Dict, Any, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from deps import api_router, db, logger
from models import User
from auth_dep import get_current_user, require_admin
from utils.epub_fulltext import (
    DEFAULT_WORDS_PER_MINUTE,
    count_words,
    reading_minutes_for,
)


MIN_WPM = 80
MAX_WPM = 1500


class WpmBody(BaseModel):
    words_per_minute: int = Field(..., ge=MIN_WPM, le=MAX_WPM)


async def get_user_wpm(user_id: str) -> int:
    doc = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "words_per_minute": 1},
    ) or {}
    raw = doc.get("words_per_minute")
    try:
        wpm = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_WORDS_PER_MINUTE
    if wpm < MIN_WPM or wpm > MAX_WPM:
        return DEFAULT_WORDS_PER_MINUTE
    return wpm


@api_router.get("/user/wpm")
async def get_wpm(user: User = Depends(get_current_user)):
    return {
        "words_per_minute": await get_user_wpm(user.user_id),
        "default": DEFAULT_WORDS_PER_MINUTE,
        "min": MIN_WPM,
        "max": MAX_WPM,
    }


@api_router.put("/user/wpm")
async def set_wpm(body: WpmBody, user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"words_per_minute": int(body.words_per_minute)}},
    )
    return await get_wpm(user)


@api_router.get("/books/{book_id}/reading-time")
async def book_reading_time(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "word_count": 1, "progress_percent": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    wc = int(book.get("word_count") or 0)
    wpm = await get_user_wpm(user.user_id)
    total = reading_minutes_for(wc, wpm)
    progress = float(book.get("progress_percent") or 0.0)
    remaining = max(0, int(round(total * (1 - max(0.0, min(progress, 1.0))))))
    return {
        "book_id": book_id,
        "word_count": wc,
        "minutes_total": total,
        "minutes_remaining": remaining,
        "wpm": wpm,
        "progress_percent": progress,
    }


@api_router.get("/library/reading-stats")
async def library_reading_stats(user: User = Depends(get_current_user)):
    """Aggregate stats for the dashboard tile.

    Returns:
      - total_words / total_minutes — every active book combined
      - unfinished_words / unfinished_minutes — only books with progress<0.95
      - finished_words / finished_minutes — what you've already read
      - books_with_wordcount / books_without_wordcount — UX feedback so the
        UI can prompt the user to run an admin backfill if there's lots
        of missing data
    """
    wpm = await get_user_wpm(user.user_id)
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$nin": ["Old stories", "Trash"]},
            "replaced_by": {"$exists": False},
        },
        {"_id": 0, "word_count": 1, "progress_percent": 1},
    )
    total_words = 0
    unfinished_words = 0
    finished_words = 0
    with_wc = 0
    without_wc = 0
    async for b in cursor:
        wc = int(b.get("word_count") or 0)
        if wc <= 0:
            without_wc += 1
            continue
        with_wc += 1
        total_words += wc
        progress = float(b.get("progress_percent") or 0.0)
        progress = max(0.0, min(progress, 1.0))
        if progress >= 0.95:
            finished_words += wc
        else:
            # Count the unread portion only — already-read minutes
            # aren't time you still owe yourself.
            unfinished_words += int(round(wc * (1 - progress)))
    return {
        "wpm": wpm,
        "total_words": total_words,
        "total_minutes": reading_minutes_for(total_words, wpm) if total_words else 0,
        "unfinished_words": unfinished_words,
        "unfinished_minutes": reading_minutes_for(unfinished_words, wpm) if unfinished_words else 0,
        "finished_words": finished_words,
        "finished_minutes": reading_minutes_for(finished_words, wpm) if finished_words else 0,
        "books_with_wordcount": with_wc,
        "books_without_wordcount": without_wc,
    }


@api_router.post("/admin/wordcount/backfill")
async def backfill_wordcount(
    limit: int = Query(2000, ge=1, le=20000),
    _admin: User = Depends(require_admin),
):
    """Stamp `word_count` on every active book that has a fulltext row
    but no/zero word_count. Cheap — no EPUB re-read, just walks the
    `book_fulltext` collection that's already on disk."""
    fts_cursor = db.book_fulltext.find(
        {}, {"_id": 0, "book_id": 1, "text": 1},
    ).limit(limit)
    scanned = 0
    updated = 0
    skipped_empty = 0
    async for ft in fts_cursor:
        scanned += 1
        wc = count_words(ft.get("text") or "")
        if wc <= 0:
            skipped_empty += 1
            continue
        # Only update if the book currently has no/zero word_count (we
        # don't want to overwrite a manually corrected value).
        r = await db.books.update_one(
            {
                "book_id": ft["book_id"],
                "$or": [
                    {"word_count": {"$exists": False}},
                    {"word_count": {"$lte": 0}},
                ],
            },
            {"$set": {"word_count": wc}},
        )
        if r.modified_count:
            updated += 1
    return {
        "scanned": scanned,
        "updated": updated,
        "skipped_empty": skipped_empty,
    }
