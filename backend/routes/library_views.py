"""Library-view endpoints, extracted from ``routes/books.py`` as part of
Phase 5E (2026-06-14).

These are pure-GET shelf views — counts, status-filtered listings, and
specialty buckets the user can drill into from the dashboard.  Each route
queries Mongo, applies a category filter, and returns a list of book
documents.  They don't mutate state, so the boundary with ``books.py`` is
clean.

Routes:
    GET /api/library/trends         — N-day new-content delta
    GET /api/library/status-counts  — complete vs ongoing chip totals
    GET /api/library/complete       — every book with effective-status complete
    GET /api/library/ongoing        — every book with effective-status ongoing
    GET /api/library/linkless       — books with no source URL or fanfic-urls
    GET /api/library/unreadable     — books that failed parsing / conversion

The ``PATCH /books/{id}/status`` mutator and the helpers it shares with
``upload_books`` stay in ``books.py`` — they're write-paths, not views.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import Depends

from deps import db, api_router
from models import User
from auth_dep import get_current_user
from utils.status_detector import (
    effective_status,
    COMPLETE as STATUS_COMPLETE,
    ONGOING as STATUS_ONGOING,
)
from utils.constants import TRASH_SHELF


# --- helpers ----------------------------------------------------------------

def _status_query(user_id: str, target: str) -> Dict[str, Any]:
    """Mongo query matching books whose EFFECTIVE status equals `target`.

    "Effective" = manual_status if set, else status, else "complete"
    (the default for unknown/old books per user choice 3b).
    """
    if target == STATUS_COMPLETE:
        # Book is complete when:
        #   manual_status == complete
        #   OR (manual_status not set AND status != ongoing)
        #     — the "!= ongoing" covers default-to-complete behaviour.
        return {
            "user_id": user_id,
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"manual_status": STATUS_COMPLETE},
                {"$and": [
                    {"manual_status": {"$nin": [STATUS_ONGOING]}},
                    {"status": {"$ne": STATUS_ONGOING}},
                ]},
            ],
        }
    # target == ongoing — explicit hit on either field.
    return {
        "user_id": user_id,
        "category": {"$ne": TRASH_SHELF},
        "$or": [
            {"manual_status": STATUS_ONGOING},
            {"$and": [
                {"manual_status": {"$nin": [STATUS_COMPLETE]}},
                {"status": STATUS_ONGOING},
            ]},
        ],
    }


async def _list_status_shelf(user_id: str, target: str) -> Dict[str, Any]:
    cursor = db.books.find(
        _status_query(user_id, target),
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "size_bytes": 1,
            "relationships": 1, "tags": 1, "series_name": 1, "series_index": 1,
            "source_url": 1, "fanfic_urls": 1, "links_count": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    # Annotate each row with the effective status + an `is_manual` flag so
    # the UI can show a small "Manually set" indicator on overrides.
    by_category: Dict[str, int] = {}
    for b in books:
        b["effective_status"] = effective_status(b)
        b["is_manual_status"] = bool(b.get("manual_status"))
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "books": books,
        "count": len(books),
        "by_category": by_category,
        "status": target,
    }


# --- routes -----------------------------------------------------------------

@api_router.get("/library/trends")
async def library_trends(days: int = 7, user: User = Depends(get_current_user)):
    """Counts of brand-new items in the user's library over the last `days`.

    Returns deltas for books / fandoms / crossovers / pairings — "brand-new"
    means the item didn't appear in any pre-window book (e.g. a fandom counts
    only if no older book in the library was already on that fandom).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()

    recent_cursor = db.books.find(
        {"user_id": user.user_id, "created_at": {"$gte": cutoff}, "original_only": {"$ne": True}},
        {"_id": 0, "book_id": 1, "fandom": 1, "relationships": 1},
    )
    recent = await recent_cursor.to_list(5000)
    older_cursor = db.books.find(
        {"user_id": user.user_id, "created_at": {"$lt": cutoff}, "original_only": {"$ne": True}},
        {"_id": 0, "fandom": 1, "relationships": 1},
    )
    older = await older_cursor.to_list(20000)

    older_fandoms = {b.get("fandom") for b in older if b.get("fandom")}
    older_pairings: set = set()
    for b in older:
        for r in (b.get("relationships") or []):
            if r:
                older_pairings.add(r)

    new_fandoms = set()
    new_crossovers = set()
    new_pairings = set()
    for b in recent:
        f = b.get("fandom")
        if f and f not in older_fandoms:
            new_fandoms.add(f)
            if " / " in f:
                new_crossovers.add(f)
        for r in (b.get("relationships") or []):
            if r and r not in older_pairings:
                new_pairings.add(r)

    return {
        "window_days": days,
        "books": len(recent),
        "fandoms": len(new_fandoms),
        "crossovers": len(new_crossovers),
        "pairings": len(new_pairings),
    }


@api_router.get("/library/status-counts")
async def get_status_counts(user: User = Depends(get_current_user)):
    """Tiny endpoint the dashboard polls to size the complete/ongoing
    chips before either shelf is opened. Trashed books are excluded."""
    complete_n = await db.books.count_documents(_status_query(user.user_id, STATUS_COMPLETE))
    ongoing_n = await db.books.count_documents(_status_query(user.user_id, STATUS_ONGOING))
    return {"complete": complete_n, "ongoing": ongoing_n}


@api_router.get("/library/complete")
async def get_complete_library(user: User = Depends(get_current_user)):
    """Every active book whose effective status is `complete`. Includes
    Originals + any book without a detected ongoing signal (user chose
    default-to-complete in scoping question 3)."""
    return await _list_status_shelf(user.user_id, STATUS_COMPLETE)


@api_router.get("/library/ongoing")
async def get_ongoing_library(user: User = Depends(get_current_user)):
    """Every active book whose effective status is `ongoing` —
    explicitly marked WIP/in-progress/hiatus/abandoned/etc."""
    return await _list_status_shelf(user.user_id, STATUS_ONGOING)


@api_router.get("/library/linkless")
async def get_linkless_library(user: User = Depends(get_current_user)):
    """Return every active book that has NO embedded fanfic URLs.

    A book counts as "linkless" when either field is empty:
      * `source_url` is null / missing / empty string
      * `fanfic_urls` is missing / empty array

    These are books we have no source-side identity for — typically
    scanned originals, hand-curated EPUBs, or imports from outside the
    supported fanfic source list. Useful when the user wants to find
    everything that wouldn't dedupe against a pasted URL list.
    """
    query = {
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "$and": [
            {"$or": [
                {"source_url": {"$exists": False}},
                {"source_url": None},
                {"source_url": ""},
            ]},
            {"$or": [
                {"fanfic_urls": {"$exists": False}},
                {"fanfic_urls": []},
            ]},
        ],
    }
    cursor = db.books.find(
        query,
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "filename": 1, "has_cover": 1, "size_bytes": 1,
            "created_at": 1, "tags": 1, "original_format": 1, "links_count": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    # Breakdown by category for the dashboard chip.
    by_category: Dict[str, int] = {}
    for b in books:
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "books": books,
        "count": len(books),
        "by_category": by_category,
    }


@api_router.get("/library/unreadable")
async def get_unreadable_library(user: User = Depends(get_current_user)):
    """Return every active book that couldn't be parsed at upload time.

    Two flavors land here, both already filed by the upload pipeline:
      * `epub_unreadable=True` — EPUB zip is corrupt / can't be opened
        by ebooklib. The bytes are still on disk at `{book_id}.epub`.
      * `needs_conversion=True` — non-EPUB source (PDF/Kindle/DOCX/…)
        that Calibre's `ebook-convert` couldn't process. The original
        bytes are kept on disk at `{book_id}.{original_format}`.

    Per-book the response includes the `reason` (`corrupt_epub` or
    `failed_conversion`), the underlying parser/converter error text, and
    the `download_path` the frontend should hit — either the standard
    `/api/books/{id}/download` for corrupt EPUBs, or
    `/api/books/{id}/download-original` for failed conversions.
    """
    query = {
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "$or": [
            {"epub_unreadable": True},
            {"needs_conversion": True},
        ],
    }
    cursor = db.books.find(
        query,
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "filename": 1,
            "category": 1, "size_bytes": 1, "created_at": 1,
            "original_format": 1, "epub_unreadable": 1, "epub_parse_error": 1,
            "needs_conversion": 1, "conversion_error": 1,
        },
    ).sort("created_at", -1)
    raw = await cursor.to_list(5000)

    books: List[Dict[str, Any]] = []
    by_reason: Dict[str, int] = {"corrupt_epub": 0, "failed_conversion": 0}
    for b in raw:
        if b.get("epub_unreadable"):
            reason = "corrupt_epub"
            error = b.get("epub_parse_error") or "EPUB could not be opened."
            download_path = f"/books/{b['book_id']}/download"
        else:
            reason = "failed_conversion"
            error = b.get("conversion_error") or "Conversion to EPUB failed."
            download_path = f"/books/{b['book_id']}/download-original"
        by_reason[reason] += 1
        books.append({
            "book_id": b["book_id"],
            "title": b.get("title") or b.get("filename") or "Untitled",
            "author": b.get("author") or "Unknown",
            "filename": b.get("filename"),
            "original_format": b.get("original_format") or "epub",
            "size_bytes": b.get("size_bytes") or 0,
            "created_at": b.get("created_at"),
            "category": b.get("category"),
            "reason": reason,
            "error": (error or "")[:240],
            "download_path": download_path,
        })
    return {
        "books": books,
        "count": len(books),
        "by_reason": by_reason,
    }
