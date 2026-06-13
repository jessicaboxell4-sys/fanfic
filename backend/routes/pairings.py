"""Pairing / "ship" browser endpoints.

Each book's ``relationships`` array is populated at upload time by the
EPUB parser (see ``routes/books.py``) and canonicalized via
``_canonicalize_relationship``. These endpoints aggregate that field
into a ship-browser experience.

Endpoints
---------
=====================================  ==================================
``GET /api/library/pairings``           Every canonical pairing + count.
``GET /api/library/by-pairing``         Every book featuring one pairing.
=====================================  ==================================
"""
from __future__ import annotations

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db
from models import User
from utils.constants import TRASH_SHELF
from utils.status_detector import effective_status


@api_router.get("/library/pairings")
async def list_pairings(user: User = Depends(get_current_user)):
    """Every canonical relationship across the user's library with a
    book count and up to 3 sample titles, sorted by count DESC.
    """
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "relationships": {"$exists": True, "$ne": []},
        }},
        {"$unwind": "$relationships"},
        {"$group": {
            "_id": "$relationships",
            "count": {"$sum": 1},
            "sample_titles": {"$push": "$title"},
        }},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": 500},
    ]
    rows = await db.books.aggregate(pipeline).to_list(500)
    pairings = [
        {
            "pairing": r["_id"],
            "count": r["count"],
            # Cap samples at 3 client-side so MongoDB doesn't have to do
            # a $slice — keeps the pipeline simple and works on any version.
            "sample_titles": (r.get("sample_titles") or [])[:3],
        }
        for r in rows
    ]
    return {"count": len(pairings), "pairings": pairings}


@api_router.get("/library/by-pairing")
async def list_books_by_pairing(
    pairing: str,
    user: User = Depends(get_current_user),
):
    """Every book whose ``relationships`` array contains ``pairing``.

    The pairing string must be in canonical form (the listing endpoint
    above provides them).
    """
    if not pairing or not pairing.strip():
        raise HTTPException(status_code=400, detail="Pairing is required")
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "relationships": pairing,
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "series_name": 1,
            "series_index": 1, "size_bytes": 1, "relationships": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    for b in books:
        b["effective_status"] = effective_status(b)
    return {"pairing": pairing, "count": len(books), "books": books}
