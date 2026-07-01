"""Full-text search + admin backfill endpoints.

- `GET /api/library/search/fulltext?q=...&limit=20` — user-scoped search
  across the body text of their own books. Uses the Mongo `$text` index
  on `book_fulltext.text`; results are joined back to `books` so the
  caller gets title/author/cover alongside the snippet.

- `POST /api/admin/fulltext/backfill` — admin-only. Walks every active
  book that lacks a `book_fulltext` row and indexes it. Streams the work
  in batches so a 5k-book tenant doesn't block a request thread.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Query

from deps import api_router, db, STORAGE_DIR
from models import User
from auth_dep import get_current_user, require_admin
from utils.epub_fulltext import (
    count_words,
    ensure_text_index,
    extract_epub_text,
    make_snippet,
    upsert_fulltext,
)

logger = logging.getLogger(__name__)


@api_router.get("/library/search/fulltext")
async def search_fulltext(
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user),
):
    """Return books in the caller's library whose body text matches `q`."""
    await ensure_text_index(db)
    cursor = (
        db.book_fulltext.find(
            {"user_id": user.user_id, "$text": {"$search": q}},
            {"_id": 0, "book_id": 1, "text": 1, "score": {"$meta": "textScore"}},
        )
        .sort([("score", {"$meta": "textScore"})])
        .limit(limit)
    )
    rows = await cursor.to_list(length=limit)
    if not rows:
        return {"q": q, "count": 0, "results": []}
    # Join back to books for the metadata the UI needs.
    ids = [r["book_id"] for r in rows]
    books_cursor = db.books.find(
        {"user_id": user.user_id, "book_id": {"$in": ids}},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1, "category": 1},
    )
    books = {b["book_id"]: b async for b in books_cursor}
    out = []
    for r in rows:
        meta = books.get(r["book_id"])
        if not meta:
            # Book deleted / trashed but fulltext row lingered — skip.
            continue
        out.append({
            **meta,
            "score": round(float(r.get("score") or 0.0), 3),
            "snippet": make_snippet(r.get("text") or "", q, window=120),
        })
    return {"q": q, "count": len(out), "results": out}


@api_router.get("/admin/fulltext/stats")
async def fulltext_stats(_user: User = Depends(require_admin)):
    """Cheap Mongo-count summary so the admin card can render a live
    progress bar (indexed / total_active, %) between backfill clicks.

    * ``total_active`` = books not in the Trash category (mirrors what
      the backfill routine actually walks).
    * ``indexed`` = rows in ``book_fulltext``.  Trash rows may still
      have a fulltext entry from before deletion, so we count against
      the ``$in`` intersection to keep the ratio honest.
    * ``remaining`` = total_active minus indexed (clamped at 0).
    * ``pct`` = 100 when total_active == 0, otherwise the rounded ratio.
    """
    total_active = await db.books.count_documents({"category": {"$ne": "Trash"}})
    # Count of fulltext rows that still map to an active book.  We do
    # this as a distinct-with-lookup so a stale ``book_fulltext`` row
    # for a Trashed book doesn't inflate the "indexed" count.
    active_ids = {
        r["book_id"] async for r in db.books.find(
            {"category": {"$ne": "Trash"}}, {"_id": 0, "book_id": 1},
        )
    }
    if not active_ids:
        indexed = 0
    else:
        indexed = await db.book_fulltext.count_documents(
            {"book_id": {"$in": list(active_ids)}}
        )
    remaining = max(0, total_active - indexed)
    pct = 100 if total_active == 0 else round((indexed / total_active) * 100, 1)
    return {
        "total_active": total_active,
        "indexed": indexed,
        "remaining": remaining,
        "pct": pct,
    }


@api_router.post("/admin/fulltext/backfill")
async def backfill_fulltext(
    limit: int = Query(500, ge=1, le=5000),
    _user: User = Depends(require_admin),
):
    """Index up to `limit` active books that don't yet have a fulltext row.

    Runs synchronously inside the request — admins explicitly trigger
    this, so we'd rather return a real count than fire-and-forget. Tune
    `limit` down if a single call ever stalls.
    """
    await ensure_text_index(db)
    indexed = {row["book_id"] async for row in db.book_fulltext.find({}, {"_id": 0, "book_id": 1})}
    cursor = db.books.find(
        {"category": {"$ne": "Trash"}, "book_id": {"$nin": list(indexed)}},
        {"_id": 0, "book_id": 1, "user_id": 1},
    ).limit(limit)
    candidates = await cursor.to_list(length=limit)
    if not candidates:
        return {"scanned": 0, "indexed": 0, "errors": 0, "skipped_missing_file": 0}

    indexed_n = 0
    errors_n = 0
    missing_n = 0
    for b in candidates:
        book_id = b["book_id"]
        user_id = b["user_id"]
        epub_path = STORAGE_DIR / user_id / f"{book_id}.epub"
        # 2026-06-21 R2 migration fix: bare ``.exists()`` was treating
        # every R2-hosted book as "missing file" and writing an empty
        # fulltext row, which meant search returned zero results
        # post-migration even though the EPUB content is sitting in
        # R2 perfectly intact.
        from utils.storage_cloud import ensure_local_cached
        ok = await asyncio.to_thread(
            ensure_local_cached, epub_path, user_id, book_id, ".epub",
        )
        if not ok:
            missing_n += 1
            # Write an empty row so we don't keep retrying this file
            await upsert_fulltext(db, book_id, user_id, "")
            continue
        try:
            # Heavy work — push to a thread so we don't pin the loop.
            text = await asyncio.to_thread(extract_epub_text, epub_path)
            await upsert_fulltext(db, book_id, user_id, text)
            # Also stamp word_count so the reading-time estimate is fresh.
            wc = count_words(text)
            if wc > 0:
                await db.books.update_one(
                    {"book_id": book_id},
                    {"$set": {"word_count": wc}},
                )
            indexed_n += 1
        except Exception as exc:
            logger.warning("backfill: %s failed: %s", book_id, exc)
            errors_n += 1
    return {
        "scanned": len(candidates),
        "indexed": indexed_n,
        "errors": errors_n,
        "skipped_missing_file": missing_n,
    }
