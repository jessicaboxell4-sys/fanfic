"""User-facing tag management.

Tags are short, lowercase, hyphenated slugs the user (or the AI
classifier) attaches to books. This module owns every endpoint under
``/api/tags/*`` and ``/api/books/{book_id}/tags*``. The actual slug
normalization logic lives in :mod:`utils.tags` because the upload
pipeline and the bulk-edit endpoint in ``routes/books.py`` reuse it.

Endpoints
---------
========================================================  =====================================
``GET    /api/tags``                                       Distinct tags + counts.
``POST   /api/books/{book_id}/tags``                       Idempotent add (capped at 20/book).
``DELETE /api/books/{book_id}/tags/{tag}``                 Remove one tag from one book.
``PUT    /api/tags/{old_name}``                            Rename across the whole library.
``POST   /api/tags/merge``                                 Merge N source tags into one target.
``DELETE /api/tags/{name}``                                Remove from every book in the library.
``POST   /api/books/{book_id}/suggest-tags``               AI-suggested tags for one book.
========================================================  =====================================
"""
from __future__ import annotations

import asyncio
import os
from typing import List

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from auth_dep import get_current_user
from deps import api_router, db, logger, STORAGE_DIR, EMERGENT_LLM_KEY
from models import User
from utils.tags import (
    TAG_MAX_PER_BOOK,
    normalize_tag,
    normalize_tags,
)


# ---------------------------------------------------------------------------
# GET /tags  — distinct tags across the library + per-tag counts
# ---------------------------------------------------------------------------
@api_router.get("/tags")
async def list_tags(user: User = Depends(get_current_user)):
    """Distinct tags across the user's library with counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "tags": {"$exists": True, "$ne": []}}},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    return {
        "tags": [
            {"name": r["_id"], "count": r["count"]}
            for r in rows if r.get("_id")
        ]
    }


# ---------------------------------------------------------------------------
# POST /books/{book_id}/tags  — add one or more tags (idempotent, capped)
# ---------------------------------------------------------------------------
class TagAddBody(BaseModel):
    tags: List[str]


@api_router.post("/books/{book_id}/tags")
async def add_book_tags(book_id: str, body: TagAddBody, user: User = Depends(get_current_user)):
    """Add one or more tags to a book (idempotent)."""
    new_tags = normalize_tags(body.tags)
    if not new_tags:
        raise HTTPException(status_code=400, detail="No valid tags provided")
    # NOTE: use `is None` not `not book` — projection ``{"_id": 0, "tags": 1}``
    # returns an empty dict ``{}`` (falsy) when the doc exists but has no
    # ``tags`` field yet. That bit us once and the bug took down 8 tests.
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "tags": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Not found")
    current = list(book.get("tags") or [])
    remaining = max(0, TAG_MAX_PER_BOOK - len(current))
    if remaining == 0:
        raise HTTPException(
            status_code=400,
            detail=f"This book already has the maximum of {TAG_MAX_PER_BOOK} tags",
        )
    to_add = [t for t in new_tags if t not in current][:remaining]
    if not to_add:
        return {"tags": current}
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$addToSet": {"tags": {"$each": to_add}}},
    )
    return {"tags": current + to_add}


# ---------------------------------------------------------------------------
# DELETE /books/{book_id}/tags/{tag}  — remove one tag from one book
# ---------------------------------------------------------------------------
@api_router.delete("/books/{book_id}/tags/{tag}")
async def remove_book_tag(book_id: str, tag: str, user: User = Depends(get_current_user)):
    norm = normalize_tag(tag)
    if not norm:
        raise HTTPException(status_code=400, detail="Invalid tag")
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$pull": {"tags": norm}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# PUT /tags/{old_name}  — rename a tag across the entire library
# ---------------------------------------------------------------------------
class TagRenameBody(BaseModel):
    new_name: str


@api_router.put("/tags/{old_name}")
async def rename_tag(old_name: str, body: TagRenameBody, user: User = Depends(get_current_user)):
    """Rename a tag across all of the user's books."""
    old = normalize_tag(old_name)
    new = normalize_tag(body.new_name)
    if not old or not new:
        raise HTTPException(status_code=400, detail="Invalid tag name")
    if old == new:
        return {"updated": 0}
    # Books that have ``old`` but NOT yet ``new`` → safely swap via the
    # positional ``$`` operator.
    r1 = await db.books.update_many(
        {
            "user_id": user.user_id,
            "$and": [{"tags": old}, {"tags": {"$nin": [new]}}],
        },
        {"$set": {"tags.$": new}},
    )
    # Books that already had BOTH ``old`` and ``new`` → just remove ``old``.
    r2 = await db.books.update_many(
        {"user_id": user.user_id, "tags": old},
        {"$pull": {"tags": old}},
    )
    return {"updated": (r1.modified_count or 0) + (r2.modified_count or 0)}


# ---------------------------------------------------------------------------
# POST /tags/merge  — merge N source tags into one target
# ---------------------------------------------------------------------------
class TagMergeBody(BaseModel):
    sources: List[str]
    target: str


@api_router.post("/tags/merge")
async def merge_tags(body: TagMergeBody, user: User = Depends(get_current_user)):
    """Merge multiple tags into a single target tag across the user's books."""
    target = normalize_tag(body.target)
    sources = normalize_tags(body.sources)
    if not target or not sources:
        raise HTTPException(status_code=400, detail="Provide non-empty sources and target")
    sources = [s for s in sources if s != target]
    if not sources:
        return {"updated": 0}
    match = {"user_id": user.user_id, "tags": {"$in": sources}}
    r1 = await db.books.update_many(match, {"$addToSet": {"tags": target}})
    r2 = await db.books.update_many(match, {"$pull": {"tags": {"$in": sources}}})
    return {"updated": (r1.modified_count or 0) + (r2.modified_count or 0)}


# ---------------------------------------------------------------------------
# DELETE /tags/{name}  — remove a tag from every book in the library
# ---------------------------------------------------------------------------
@api_router.delete("/tags/{name}")
async def delete_tag(name: str, user: User = Depends(get_current_user)):
    """Remove a tag from every book in the user's library."""
    norm = normalize_tag(name)
    if not norm:
        raise HTTPException(status_code=400, detail="Invalid tag")
    result = await db.books.update_many(
        {"user_id": user.user_id, "tags": norm},
        {"$pull": {"tags": norm}},
    )
    return {"updated": result.modified_count}


# ---------------------------------------------------------------------------
# POST /books/{book_id}/suggest-tags  — AI-suggested tags for one book
# ---------------------------------------------------------------------------
@api_router.post("/books/{book_id}/suggest-tags")
async def suggest_book_tags(book_id: str, user: User = Depends(get_current_user)):
    """Use the AI classifier to suggest tags for an existing book.

    Returns up to 5 suggestions that the book doesn't already have.
    Falls back gracefully when the EPUB file or the AI key are missing.
    """
    # ``extract_epub_metadata`` + ``classify_with_ai`` live in
    # ``routes/books.py``. The import is deferred to avoid a circular
    # import at module load (books.py also references some helpers in
    # this module mid-refactor).
    from routes.books import extract_epub_metadata, classify_with_ai

    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    # Try to grab a sample of body text if the EPUB is still on disk.
    sample_text = ""
    try:
        epub_path = STORAGE_DIR / book["user_id"] / f"{book_id}.epub"
        # 2026-06-21 R2 migration fix: tag-suggestion used to read body
        # text only if the EPUB was on local disk, which skipped every
        # R2-hosted book post-migration and made the AI suggest tags
        # off title/description alone (much worse quality).
        from utils.storage_cloud import ensure_local_cached
        ok = await asyncio.to_thread(
            ensure_local_cached, epub_path, book["user_id"], book_id, ".epub",
        )
        if ok:
            meta = extract_epub_metadata(epub_path)
            sample_text = (
                (meta or {}).get("sample_text", "") if isinstance(meta, dict) else ""
            )
    except Exception as e:
        logger.warning("suggest-tags: epub read failed: %s", e)

    meta_for_ai = {
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "publisher": book.get("publisher", ""),
        "description": book.get("description", ""),
        "sample_text": sample_text,
    }
    ai = await classify_with_ai(meta_for_ai)
    suggested = normalize_tags(ai.get("tags") or [])
    existing = set(book.get("tags") or [])
    filtered = [t for t in suggested if t not in existing][:5]
    return {
        "suggested": filtered,
        "all": suggested,
        "ai_used": bool(EMERGENT_LLM_KEY) or bool(os.environ.get("SHELFSORT_TEST_AI_RESPONSE")),
    }
