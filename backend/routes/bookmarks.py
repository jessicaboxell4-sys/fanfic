"""Reader bookmarks.

Each bookmark captures an EPUB CFI location (the canonical
position-in-book pointer epub.js gives us) plus optional user-supplied
label so the reader can jump straight to that page.

Endpoints
---------
=========================================  =======================================
``GET    /api/books/{book_id}/bookmarks``   List bookmarks for one book.
``POST   /api/books/{book_id}/bookmarks``   Add (idempotent on cfi+book).
``DELETE /api/books/{book_id}/bookmarks/{bookmark_id}``  Remove one.
``GET    /api/bookmarks``                   Cross-library list (newest first).
=========================================  =======================================

Schema (``db.bookmarks``)
-------------------------
``{
    bookmark_id: str,
    user_id: str,
    book_id: str,
    cfi: str,             # epub.js CFI
    percent: float|None,  # 0..1, precomputed for sortability
    chapter_label: str,   # human-readable hint ("Chapter 7")
    note: str,            # user-typed note (max 280 chars)
    created_at: datetime,
}``
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from auth_dep import get_current_user
from deps import api_router, db
from models import User

# 280 chars — Twitter-like cap. Anything longer is overkill for a margin
# note and would bloat the API payload.
NOTE_MAX_LENGTH = 280


def _serialize(doc: dict) -> dict:
    """Strip Mongo's ``_id`` + ISO-format ``created_at`` for the wire."""
    out = {k: v for k, v in doc.items() if k != "_id"}
    ca = out.get("created_at")
    if isinstance(ca, datetime):
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        out["created_at"] = ca.isoformat()
    return out


class BookmarkAddBody(BaseModel):
    cfi: str = Field(..., min_length=1)
    note: Optional[str] = ""
    chapter_label: Optional[str] = ""
    percent: Optional[float] = None


class BookmarkPatchBody(BaseModel):
    """Editable fields for an existing bookmark.  Only ``note`` is exposed
    today (chapter_label is computed server/client-side from the EPUB TOC
    so users don't have to retype it)."""
    note: Optional[str] = None


@api_router.get("/books/{book_id}/bookmarks")
async def list_book_bookmarks(book_id: str, user: User = Depends(get_current_user)):
    """List every bookmark the user has set on this book, oldest first
    so the order in the panel matches reading order."""
    cursor = db.bookmarks.find(
        {"user_id": user.user_id, "book_id": book_id},
        {"_id": 0},
    ).sort([("percent", 1), ("created_at", 1)])
    rows = [_serialize(r) async for r in cursor]
    return {"bookmarks": rows, "count": len(rows)}


@api_router.post("/books/{book_id}/bookmarks")
async def add_book_bookmark(
    book_id: str,
    body: BookmarkAddBody,
    user: User = Depends(get_current_user),
):
    """Add a bookmark. Idempotent on (user, book, cfi) — re-bookmarking
    the same spot updates the note instead of duplicating the row.
    """
    cfi = (body.cfi or "").strip()
    if not cfi:
        raise HTTPException(status_code=400, detail="cfi is required")
    # Confirm the user owns the book — defense against tampering.
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    note = (body.note or "").strip()[:NOTE_MAX_LENGTH]
    chapter = (body.chapter_label or "").strip()[:120]
    pct = body.percent if isinstance(body.percent, (int, float)) else None
    now = datetime.now(timezone.utc)

    existing = await db.bookmarks.find_one(
        {"user_id": user.user_id, "book_id": book_id, "cfi": cfi},
        {"_id": 0},
    )
    if existing:
        # Update note + chapter if the user supplied something new.
        await db.bookmarks.update_one(
            {"bookmark_id": existing["bookmark_id"]},
            {"$set": {
                "note": note or existing.get("note") or "",
                "chapter_label": chapter or existing.get("chapter_label") or "",
                "percent": pct if pct is not None else existing.get("percent"),
            }},
        )
        return {"bookmark": {**existing, "note": note or existing.get("note") or ""}}

    doc = {
        "bookmark_id": f"bm_{uuid.uuid4().hex[:16]}",
        "user_id": user.user_id,
        "book_id": book_id,
        "cfi": cfi,
        "percent": pct,
        "chapter_label": chapter,
        "note": note,
        "created_at": now,
    }
    await db.bookmarks.insert_one(doc)
    return {"bookmark": _serialize(doc)}


@api_router.patch("/books/{book_id}/bookmarks/{bookmark_id}")
async def patch_book_bookmark(
    book_id: str,
    bookmark_id: str,
    body: BookmarkPatchBody,
    user: User = Depends(get_current_user),
):
    """Update an existing bookmark's note. Passing ``note=""`` clears it
    (which the POST endpoint can't do — POST treats empty notes as
    "keep the existing one" for legacy callers)."""
    update: dict = {}
    if body.note is not None:
        update["note"] = body.note.strip()[:NOTE_MAX_LENGTH]
    if not update:
        return {"updated": 0}
    res = await db.bookmarks.update_one(
        {"bookmark_id": bookmark_id, "user_id": user.user_id, "book_id": book_id},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    doc = await db.bookmarks.find_one(
        {"bookmark_id": bookmark_id, "user_id": user.user_id},
        {"_id": 0},
    )
    return {"bookmark": _serialize(doc), "updated": res.modified_count}


@api_router.delete("/books/{book_id}/bookmarks/{bookmark_id}")
async def delete_book_bookmark(
    book_id: str,
    bookmark_id: str,
    user: User = Depends(get_current_user),
):
    """Delete one bookmark. Returns ``deleted: 0`` (not 404) if the
    bookmark doesn't exist so the UI can be optimistic about clicking
    delete twice."""
    res = await db.bookmarks.delete_one({
        "bookmark_id": bookmark_id,
        "user_id": user.user_id,
        "book_id": book_id,
    })
    return {"deleted": res.deleted_count}


@api_router.get("/bookmarks")
async def list_all_bookmarks(
    limit: int = 200,
    user: User = Depends(get_current_user),
):
    """Cross-library bookmark feed — newest first. Hydrates each row
    with the book title + author so the page can render rich cards
    without N+1 lookups."""
    cursor = db.bookmarks.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(max(1, min(limit, 500)))
    bms = [_serialize(r) async for r in cursor]
    if not bms:
        return {"bookmarks": [], "count": 0}
    book_ids = list({b["book_id"] for b in bms})
    book_cursor = db.books.find(
        {"user_id": user.user_id, "book_id": {"$in": book_ids}},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1, "has_cover": 1},
    )
    book_map = {b["book_id"]: b async for b in book_cursor}
    for bm in bms:
        bm["book"] = book_map.get(bm["book_id"])
    return {"bookmarks": bms, "count": len(bms)}
