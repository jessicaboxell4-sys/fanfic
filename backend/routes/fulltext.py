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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

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


# ---------------------------------------------------------------------------
# Fulltext backfill — background job
#
# Historically this endpoint ran synchronously inside the request.  That
# meant admins had to keep the tab open for the entire batch, and closing
# the page mid-run cancelled uvicorn's task handler.  With 4k+ books
# in prod that was a real papercut.
#
# The state below is a *single* in-process runner: only one backfill runs
# at a time (an admin double-clicking gets a "already_running" reply
# instead of two overlapping walks).  Progress is updated after every
# book so ``/admin/fulltext/stats`` can render the live counter.
#
# Deliberately not persisted to Mongo — a pod restart mid-run just means
# the counter resets to zero and the admin clicks "Run" again.  The
# ``indexed`` count in the stats endpoint is derived from the actual
# ``book_fulltext`` collection, so no progress is ever lost.
# ---------------------------------------------------------------------------
_backfill_state: Dict[str, Any] = {
    "running": False,
    "started_at": None,        # ISO-8601 str or None
    "finished_at": None,       # ISO-8601 str or None
    "batch_target": 0,         # how many books this batch will attempt
    "batch_scanned": 0,        # incremented as we walk
    "batch_indexed": 0,
    "batch_missing_file": 0,
    "batch_errors": 0,
    "last_error": None,
}


async def _run_backfill_batch(limit: int) -> None:
    """Actual worker that walks up to ``limit`` unindexed books and
    writes their fulltext rows.  Updates ``_backfill_state`` as it goes
    so ``/admin/fulltext/stats`` can serve a live progress payload.

    Runs as an ``asyncio.create_task`` — the HTTP handler returns
    immediately, so the admin can close the tab and this keeps going.
    """
    try:
        await ensure_text_index(db)
        indexed = {row["book_id"] async for row in db.book_fulltext.find({}, {"_id": 0, "book_id": 1})}
        cursor = db.books.find(
            {"category": {"$ne": "Trash"}, "book_id": {"$nin": list(indexed)}},
            {"_id": 0, "book_id": 1, "user_id": 1},
        ).limit(limit)
        candidates = await cursor.to_list(length=limit)
        _backfill_state["batch_target"] = len(candidates)

        from utils.storage_cloud import ensure_local_cached
        for b in candidates:
            book_id = b["book_id"]
            user_id = b["user_id"]
            epub_path = STORAGE_DIR / user_id / f"{book_id}.epub"
            ok = await asyncio.to_thread(
                ensure_local_cached, epub_path, user_id, book_id, ".epub",
            )
            if not ok:
                _backfill_state["batch_missing_file"] += 1
                # Empty stub row so we don't keep retrying this file.
                await upsert_fulltext(db, book_id, user_id, "")
                _backfill_state["batch_scanned"] += 1
                continue
            try:
                text = await asyncio.to_thread(extract_epub_text, epub_path)
                await upsert_fulltext(db, book_id, user_id, text)
                wc = count_words(text)
                if wc > 0:
                    await db.books.update_one(
                        {"book_id": book_id},
                        {"$set": {"word_count": wc}},
                    )
                _backfill_state["batch_indexed"] += 1
            except Exception as exc:
                logger.warning("backfill: %s failed: %s", book_id, exc)
                _backfill_state["batch_errors"] += 1
            _backfill_state["batch_scanned"] += 1
    except Exception as exc:
        logger.exception("fulltext backfill task crashed")
        _backfill_state["last_error"] = str(exc)[:200]
    finally:
        _backfill_state["running"] = False
        _backfill_state["finished_at"] = datetime.now(timezone.utc).isoformat()


@api_router.get("/admin/fulltext/stats")
async def fulltext_stats(_user: User = Depends(require_admin)):
    """Cheap Mongo-count summary + live in-process progress so the admin
    card can render a progress bar that keeps ticking even after the
    admin closes their tab.

    Fields:
      * ``total_active`` — books not in Trash (matches what the walker sees).
      * ``indexed`` — rows in ``book_fulltext`` that still map to an
        active book.  Survives pod restarts (comes straight from Mongo).
      * ``remaining`` — ``total_active - indexed``, clamped at 0.
      * ``pct`` — 100 when total is 0, else rounded ratio.
      * ``running`` — True iff a background batch is in-flight in *this*
        process.  A pod restart flips this back to False even if there
        was a running batch — the ``indexed`` count still reflects
        whatever the crashed batch managed to write.
      * ``batch_*`` — per-run counters, useful for the "X of Y this run"
        sub-line under the main progress bar.
    """
    total_active = await db.books.count_documents({"category": {"$ne": "Trash"}})
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
        # Live in-process runner state — safe to expose to the admin UI.
        "running": bool(_backfill_state["running"]),
        "started_at": _backfill_state["started_at"],
        "finished_at": _backfill_state["finished_at"],
        "batch_target": _backfill_state["batch_target"],
        "batch_scanned": _backfill_state["batch_scanned"],
        "batch_indexed": _backfill_state["batch_indexed"],
        "batch_missing_file": _backfill_state["batch_missing_file"],
        "batch_errors": _backfill_state["batch_errors"],
        "last_error": _backfill_state["last_error"],
    }


@api_router.post("/admin/fulltext/backfill")
async def backfill_fulltext(
    limit: int = Query(500, ge=1, le=5000),
    _user: User = Depends(require_admin),
):
    """Kick off a background backfill of up to ``limit`` un-indexed books.

    Returns immediately (HTTP 202-esque semantics via a normal 200 body
    with ``started: True``).  The actual walk runs as an asyncio task so
    the admin can close the tab and the indexing continues.

    If a run is already in-flight, returns ``already_running: True``
    with the current batch progress — clients should poll
    ``/admin/fulltext/stats`` for updates instead of spawning a second
    worker.
    """
    if _backfill_state["running"]:
        return {
            "started": False,
            "already_running": True,
            "batch_target":  _backfill_state["batch_target"],
            "batch_scanned": _backfill_state["batch_scanned"],
            "batch_indexed": _backfill_state["batch_indexed"],
        }
    # Reset per-batch counters, mark running BEFORE spawning so an
    # immediate follow-up POST sees the guard flag.
    _backfill_state.update({
        "running": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "batch_target": 0,
        "batch_scanned": 0,
        "batch_indexed": 0,
        "batch_missing_file": 0,
        "batch_errors": 0,
        "last_error": None,
    })
    asyncio.create_task(_run_backfill_batch(limit))
    return {"started": True, "limit": limit}
