"""Character browser endpoints.

AO3 export EPUBs pile every metadata tag into ``<dc:subject>`` with no
characters-vs-tags distinction.  The ``utils/ao3_metadata`` classifier
buckets the obvious ones (ratings, warnings, categories,
relationships) and dumps everything else into ``tags`` — which means
the canonical "characters" axis (e.g. ``Hermione Granger``) is not
stored as a first-class field on the book document.

Rather than re-parse every EPUB to extract a characters field, we
derive characters at query time from the existing
``relationships`` array.  An AO3 relationship like
``"Harry Potter/Hermione Granger"`` or ``"Harry Potter & Ron Weasley"``
already lists the characters involved — splitting on ``/`` and ``&``
gives a deterministic, retroactive characters dimension that works on
every book in the database today.

Endpoints
---------
======================================  ===================================
``GET  /api/library/characters``         Every character + book count.
``GET  /api/library/by-character``       Every book featuring one character.
======================================  ===================================

Sort order for the directory listing: ``count DESC, name ASC`` —
matches `/api/library/pairings` so ties are deterministic instead of
relying on MongoDB's insertion order.
"""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import Depends, HTTPException, Query

from auth_dep import get_current_user
from deps import api_router, db
from models import User
from utils.constants import TRASH_SHELF
from utils.status_detector import effective_status

# AO3 uses "/" for romantic pairings and " & " for gen / platonic.
# A few sources use "x" (e.g. "Harry x Hermione") so we tolerate that
# too when the separator is space-padded — bare 'x' inside a name
# (e.g. "Alex") must not match.
_SPLIT_RE = re.compile(r"\s*/\s*|\s+&\s+|\s+[xX]\s+")


def _split_characters(relationship: str) -> List[str]:
    """Tokenize a canonical relationship into the characters it lists.

    Pure function; trims whitespace, drops empty fragments, leaves
    case as-is so 'Harry Potter' from a pairing matches the same name
    elsewhere.  Returns an empty list for blank input.
    """
    if not relationship:
        return []
    return [t for t in (frag.strip() for frag in _SPLIT_RE.split(relationship)) if t]


@api_router.get("/library/characters")
async def list_characters(
    user: User = Depends(get_current_user),
    fandom: Optional[str] = Query(None, description="If provided, only count books on this fandom shelf"),
    limit: int = Query(500, ge=1, le=500),
):
    """Every character across the user's library with a book count, the
    fandoms they appear in, and up to 3 sample titles.  Derived from
    the ``relationships`` field — characters that only show up in
    freeform tags are not included.

    When ``fandom`` is supplied, the aggregation is scoped to books on
    that fandom shelf — this is what powers the "Top characters" rail
    on `/library/fandom/:fandom`.
    """
    match = {
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "relationships": {"$exists": True, "$ne": []},
    }
    if fandom and isinstance(fandom, str) and fandom.strip():
        match["fandom"] = fandom.strip()
    pipeline = [
        {"$match": match},
        # Keep one row per (book, relationship) so we can fold them
        # into characters in Python below — doing the split in $map
        # would require a $regex split inside an aggregation
        # expression, which only landed in Mongo 7.
        {"$project": {
            "_id": 0,
            "title": 1,
            "fandom": 1,
            "relationships": 1,
        }},
    ]
    by_character: dict = {}
    async for row in db.books.aggregate(pipeline):
        for rel in row.get("relationships") or []:
            for char in _split_characters(rel):
                bucket = by_character.setdefault(char, {
                    "name": char,
                    "count": 0,
                    "fandoms": set(),
                    "sample_titles": [],
                    "_seen_books": set(),
                })
                book_key = row.get("title") or ""
                # Same character can appear in multiple relationships of
                # the same book ("Harry/Draco" + "Harry & Hermione" —
                # one Harry, not two).  Dedupe via the book identity.
                if book_key in bucket["_seen_books"]:
                    continue
                bucket["_seen_books"].add(book_key)
                bucket["count"] += 1
                if row.get("fandom"):
                    bucket["fandoms"].add(row["fandom"])
                if len(bucket["sample_titles"]) < 3 and book_key:
                    bucket["sample_titles"].append(book_key)

    characters = sorted(
        (
            {
                "name": v["name"],
                "count": v["count"],
                "fandoms": sorted(v["fandoms"]),
                "sample_titles": v["sample_titles"],
            }
            for v in by_character.values()
        ),
        # count DESC, name ASC — matches /api/library/pairings so ties
        # are deterministic.
        key=lambda c: (-c["count"], c["name"].casefold()),
    )
    # Resolve the FastAPI Query default if the function is called
    # directly from a test (where dependency injection isn't run).
    cap = limit if isinstance(limit, int) else 500
    return {"count": len(characters), "characters": characters[:cap]}


@api_router.get("/library/by-character")
async def list_books_by_character(
    character: str,
    user: User = Depends(get_current_user),
):
    """Every book whose ``relationships`` array references ``character``.

    Match is case-insensitive on the character name so "Harry Potter"
    finds books regardless of the casing the source used.
    """
    needle = (character or "").strip()
    if not needle:
        raise HTTPException(status_code=400, detail="Character is required")

    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "relationships": {"$exists": True, "$ne": []},
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "series_name": 1,
            "series_index": 1, "size_bytes": 1, "relationships": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    matched = []
    needle_cf = needle.casefold()
    async for b in cursor:
        chars_in_book = set()
        for rel in b.get("relationships") or []:
            for ch in _split_characters(rel):
                chars_in_book.add(ch.casefold())
        if needle_cf in chars_in_book:
            b["effective_status"] = effective_status(b)
            matched.append(b)
    return {"character": needle, "count": len(matched), "books": matched}
