"""Author directory + per-author book listing endpoints.

These are pure read-only aggregations against ``db.books`` filtered
by ``user_id``. They were extracted from the monolithic
``routes/books.py`` in the Phase-2 refactor.

Endpoints
---------
=====================================  ==================================
``GET /api/authors``                    Distinct authors + book counts.
``GET /api/library/authors``            Same data shaped for the Authors
                                        directory page (extra ``latest_at``).
``GET /api/library/by-author``          Every active book by one author.
=====================================  ==================================
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db
from models import User
from utils.constants import TRASH_SHELF
from utils.status_detector import effective_status


# ---------------------------------------------------------------------------
# GET /authors  — minimal "name + count" aggregation
# ---------------------------------------------------------------------------
@api_router.get("/authors")
async def list_authors(user: User = Depends(get_current_user)):
    """Distinct authors in the user's library with book counts.

    Filters out blank names and the placeholder ``"Unknown"`` author so
    the dropdown stays clean.
    """
    pipeline = [
        {"$match": {"user_id": user.user_id, "author": {"$ne": None, "$exists": True}}},
        {"$group": {"_id": "$author", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    authors = [
        {"name": r["_id"], "count": r["count"]}
        for r in rows
        if r.get("_id") and r["_id"].strip() and r["_id"].strip().lower() != "unknown"
    ]
    return {"authors": authors}


# ---------------------------------------------------------------------------
# GET /library/authors  — directory shape (includes latest upload timestamp)
# ---------------------------------------------------------------------------
@api_router.get("/library/authors")
async def list_authors_directory(user: User = Depends(get_current_user)):
    """Return every distinct author in the user's library with a book
    count and ``latest_at`` (most recent upload by that author).

    Used by the Authors directory page. Excludes trashed books.
    """
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "author": {"$nin": [None, "", "Unknown"]},
        }},
        {"$group": {
            "_id": "$author",
            "count": {"$sum": 1},
            "latest_at": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": 2000},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    authors = [
        {"author": r["_id"], "count": r["count"], "latest_at": r.get("latest_at")}
        for r in rows
    ]
    return {"count": len(authors), "authors": authors}


# ---------------------------------------------------------------------------
# GET /library/by-author  — books written by one author
# ---------------------------------------------------------------------------
@api_router.get("/library/by-author")
async def list_books_by_author(
    author: str,
    user: User = Depends(get_current_user),
):
    """Return every active book by a given author.

    Case-sensitive exact match — the listing endpoint above gives the
    canonical name so the frontend doesn't have to guess. Each row is
    annotated with ``effective_status`` so the page can group
    finished vs. ongoing without a second roundtrip.
    """
    if not author or not author.strip():
        raise HTTPException(status_code=400, detail="Author is required")
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "author": author,
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "series_name": 1,
            "series_index": 1, "size_bytes": 1, "relationships": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    by_category: Dict[str, int] = {}
    for b in books:
        b["effective_status"] = effective_status(b)
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "author": author,
        "count": len(books),
        "books": books,
        "by_category": by_category,
    }
