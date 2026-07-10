"""``routes/bulk_ops.py`` — destructive / mass-edit endpoints.

Extracted from ``routes/books.py`` 2026-06-25 (Phase 6B refactor).
Behavior-preserving split: 6 endpoints + their request models moved
verbatim.  Grouping them gives us a coherent surface for future
audit-logging + rate-limiting (see ROADMAP Phase 6B follow-ups).

================ ENDPOINTS IN THIS FILE ================
  POST /api/books/reclassify-all
  POST /api/books/bulk/delete
  POST /api/books/bulk/move
  POST /api/books/bulk/metadata
  POST /api/books/reset-state
  POST /api/books/wipe-library

Shared helpers stay in ``routes/books.py`` because the rest of the
codebase depends on them too; this module imports them one-way
(same pattern as routes/covers.py).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router, logger, STORAGE_DIR
from models import User
from auth_dep import get_current_user

from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS
from utils.epub_metadata import extract_epub_metadata
from utils.classifier import classify_with_ai

# Shared helpers + constant from routes.books — one-way import.
from routes.books import (
    OLD_STORIES_SHELF,
    _canonicalize_fandom,
    _normalize_tags,
)


# ---------------------------------------------------------------------
# Reclassify-all — run the AI classifier across many books at once.
# ---------------------------------------------------------------------

class ReclassifyAllBody(BaseModel):
    only_unclassified: bool = True
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/reclassify-all")
async def reclassify_all(body: ReclassifyAllBody, user: User = Depends(get_current_user)):
    """Run the AI classifier on every matching book, then persist the new labels."""
    query: Dict[str, Any] = {"user_id": user.user_id}
    if body.only_unclassified:
        query["category"] = "Unclassified"
    else:
        if body.category:
            query["category"] = body.category
        if body.fandom:
            query["fandom"] = body.fandom

    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        return {"processed": 0, "changed": 0}

    user_dir = STORAGE_DIR / user.user_id
    sem = asyncio.Semaphore(3)  # cap concurrent AI calls

    async def process(b):
        async with sem:
            fp = user_dir / f"{b['book_id']}.epub"
            if not fp.exists():
                return None
            try:
                meta = extract_epub_metadata(fp)
                cls = await classify_with_ai(meta)
            except Exception as e:
                logger.error(f"AI reclass error for {b['book_id']}: {e}")
                return None
            if cls['confidence'] <= 0:
                return None
            return (b['book_id'], cls)

    results = await asyncio.gather(*[process(b) for b in books])
    changed = 0
    for r in results:
        if not r:
            continue
        bid, cls = r
        await db.books.update_one(
            {"book_id": bid, "user_id": user.user_id},
            {"$set": {
                "category": cls['category'],
                "fandom": _canonicalize_fandom(cls.get('fandom')),
                "confidence": cls['confidence'],
                "classifier": cls['classifier'],
            }},
        )
        changed += 1
    return {"processed": len(books), "changed": changed}


# ---------------------------------------------------------------------
# Bulk delete (soft) — books → Trash with a 30-day grace window.
# ---------------------------------------------------------------------

class BulkIdsBody(BaseModel):
    book_ids: List[str]


@api_router.post("/books/bulk/delete")
async def bulk_delete(body: BulkIdsBody, user: User = Depends(get_current_user)):
    """Bulk soft-delete — books move to Trash with a 30-day grace window so
    accidental "select all → delete" mishaps are reversible. Use
    `/api/trash/empty` if you want immediate hard deletion afterwards.
    """
    if not body.book_ids:
        return {"deleted": 0}
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    expires_at = (now_dt + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
    # Record each book's prior category so it can be restored from Trash
    cursor = db.books.find(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
        {"_id": 0, "book_id": 1, "category": 1},
    )
    moved = 0
    async for b in cursor:
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": b.get("category"),
                        "applied_at": now_iso,
                    },
                },
            },
        )
        moved += 1
    return {"deleted": moved, "trashed": moved, "trash_expires_at": expires_at}


# ---------------------------------------------------------------------
# Reset state — selectively wipe non-book metadata (keeps EPUBs).
# ---------------------------------------------------------------------

class ResetStateBody(BaseModel):
    reset_progress: bool = False         # progress_fraction, last_opened_at, reading_minutes, reading_activity
    reset_tags: bool = False             # clear book.tags
    reset_smart_shelves: bool = False    # drop user's smart_shelves
    reset_versions: bool = False         # collapse Old/Updated stories shelves


@api_router.post("/books/reset-state")
async def reset_state(body: ResetStateBody, user: User = Depends(get_current_user)):
    """Selectively wipe non-book metadata while keeping every EPUB intact.

    Each flag is independent — pass `true` only on the dimensions you want to clear.
    All books and their files stay on disk; only DB metadata is touched.
    """
    if not any([body.reset_progress, body.reset_tags, body.reset_smart_shelves, body.reset_versions]):
        raise HTTPException(status_code=400, detail="Pick at least one thing to reset.")

    summary: Dict[str, int] = {}

    if body.reset_progress:
        r = await db.books.update_many(
            {"user_id": user.user_id},
            {"$unset": {
                "progress_fraction": "",
                "last_opened_at": "",
                "reading_minutes": "",
                "manually_uploaded_at": "",
            }},
        )
        ra = await db.reading_activity.delete_many({"user_id": user.user_id})
        summary["books_progress_cleared"] = r.modified_count
        summary["activity_rows_deleted"] = ra.deleted_count

    if body.reset_tags:
        r = await db.books.update_many(
            {"user_id": user.user_id},
            {"$set": {"tags": []}},
        )
        summary["books_tags_cleared"] = r.modified_count

    if body.reset_smart_shelves:
        ss = await db.smart_shelves.delete_many({"user_id": user.user_id})
        summary["smart_shelves_deleted"] = ss.deleted_count

    if body.reset_versions:
        # Collapse old/updated shelves back to their best-guess category.
        # If a book has a fandom we send it to "Fanfiction", else to "Unclassified".
        cursor = db.books.find(
            {
                "user_id": user.user_id,
                "$or": [
                    {"category": OLD_STORIES_SHELF},
                    {"category": {"$regex": r"^Updated stories \d{4}-\d{2}-\d{2}$"}},
                ],
            },
            {"_id": 0, "book_id": 1, "fandom": 1},
        )
        count = 0
        async for b in cursor:
            target = "Fanfiction" if b.get("fandom") else "Unclassified"
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {
                    "$set": {"category": target},
                    "$unset": {"replaced_by": "", "replaces": "", "replaced_at": "", "refresh_summary": "", "update_seen": "", "manually_uploaded_at": ""},
                },
            )
            count += 1
        # And remove any auto-created dated-shelf entries in `categories`
        await db.categories.delete_many({
            "user_id": user.user_id,
            "auto_created": True,
            "name": {"$regex": r"^Updated stories \d{4}-\d{2}-\d{2}$"},
        })
        summary["versions_collapsed"] = count

    return {"ok": True, **summary}


# ---------------------------------------------------------------------
# Wipe library — nuclear option, guarded by an explicit confirm string.
# ---------------------------------------------------------------------

class WipeLibraryBody(BaseModel):
    confirm: str  # must equal "DELETE_EVERYTHING"


@api_router.post("/books/wipe-library")
async def wipe_library(body: WipeLibraryBody, user: User = Depends(get_current_user)):
    """Delete every book the user owns — DB rows, EPUBs, covers, link sidecars.
    Requires `confirm == "DELETE_EVERYTHING"` so an accidental POST won't nuke a library.

    Note: also clears reading_activity, smart_shelves, and the templated-onboarding
    flag so the user effectively starts fresh.
    """
    if body.confirm != "DELETE_EVERYTHING":
        raise HTTPException(
            status_code=400,
            detail='Confirmation required. Pass {"confirm": "DELETE_EVERYTHING"} to proceed.',
        )

    # Drop every on-disk file under the user's storage dir
    user_dir = STORAGE_DIR / user.user_id
    files_removed = 0
    if user_dir.exists():
        for p in user_dir.iterdir():
            try:
                if p.is_file():
                    p.unlink()
                    files_removed += 1
            except Exception as e:
                logger.warning("wipe_library couldn't delete %s: %s", p, e)

    # Drop collections scoped to this user
    deletes = {
        "books": (await db.books.delete_many({"user_id": user.user_id})).deleted_count,
        "reading_activity": (await db.reading_activity.delete_many({"user_id": user.user_id})).deleted_count,
        "smart_shelves": (await db.smart_shelves.delete_many({"user_id": user.user_id})).deleted_count,
        "categories": (await db.categories.delete_many({"user_id": user.user_id})).deleted_count,
    }
    # Reset onboarding so the user-prompt can show again on fresh re-upload
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$unset": {
            "template_prompt_dismissed": "",
            "template_prompt_accepted": "",
            "template_prompt_dismissed_at": "",
        }},
    )

    return {
        "ok": True,
        "files_removed": files_removed,
        **deletes,
        "message": f"Library wiped: {deletes['books']} books and {files_removed} files removed.",
    }


# ---------------------------------------------------------------------
# Bulk move — assign category/fandom to many books at once.
# ---------------------------------------------------------------------

class BulkMoveBody(BaseModel):
    book_ids: List[str]
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/bulk/move")
async def bulk_move(body: BulkMoveBody, user: User = Depends(get_current_user)):
    if not body.book_ids:
        return {"updated": 0}
    update: Dict[str, Any] = {"classifier": "manual", "confidence": 1.0}
    if body.category is not None:
        update["category"] = body.category
    if body.fandom is not None:
        update["fandom"] = _canonicalize_fandom(body.fandom) if body.fandom else None
    if len(update) == 2:  # only classifier+confidence — nothing to move to
        raise HTTPException(status_code=400, detail="No category or fandom provided")
    result = await db.books.update_many(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
        {"$set": update},
    )
    return {"updated": result.modified_count}


# ---------------------------------------------------------------------
# Bulk metadata — set author/category/series + tag operations across N books.
# ---------------------------------------------------------------------

class BulkMetadataBody(BaseModel):
    book_ids: List[str]
    author: Optional[str] = None                # if provided & non-empty, sets author on all
    fandom: Optional[str] = None                # "" => clear fandom (None); None => leave as-is
    category: Optional[str] = None              # category to set on all
    series_name: Optional[str] = None           # "" => clear series; None => leave as-is
    series_start_index: Optional[float] = None  # if set, assigns series_index sequentially starting at this value
    title_prefix_strip: Optional[str] = None    # if provided & non-empty, strips this prefix from each book's title
    add_tags: Optional[List[str]] = None        # tags to ADD to every selected book
    remove_tags: Optional[List[str]] = None     # tags to REMOVE from every selected book


@api_router.post("/books/bulk/metadata")
async def bulk_metadata(body: BulkMetadataBody, user: User = Depends(get_current_user)):
    """Edit metadata across many books at once.

    Use cases: fix a misspelled author across a series, drop everything into a
    new fandom shelf, group books into a series and number them in upload order,
    or strip a common prefix from titles (e.g. "[OLD] ").
    """
    if not body.book_ids:
        return {"updated": 0}

    # Fields that apply identically to every selected book
    set_common: Dict[str, Any] = {}
    unset_common: Dict[str, Any] = {}
    if body.author and body.author.strip():
        set_common["author"] = body.author.strip()
    if body.category is not None:
        set_common["category"] = body.category
        set_common["classifier"] = "manual"
        set_common["confidence"] = 1.0
    if body.fandom is not None:
        if body.fandom.strip():
            set_common["fandom"] = _canonicalize_fandom(body.fandom.strip())
        else:
            unset_common["fandom"] = ""
    if body.series_name is not None and body.series_start_index is None:
        if body.series_name.strip():
            set_common["series_name"] = body.series_name.strip()
        else:
            unset_common["series_name"] = ""
            unset_common["series_index"] = ""

    updated = 0

    if set_common or unset_common:
        ops: Dict[str, Any] = {}
        if set_common:
            ops["$set"] = set_common
        if unset_common:
            ops["$unset"] = unset_common
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            ops,
        )
        updated = max(updated, result.modified_count)

    # Series numbering: assign sequentially in the order book_ids was provided
    if body.series_name is not None and body.series_start_index is not None and body.series_name.strip():
        idx = float(body.series_start_index)
        for bid in body.book_ids:
            await db.books.update_one(
                {"book_id": bid, "user_id": user.user_id},
                {"$set": {"series_name": body.series_name.strip(), "series_index": idx}},
            )
            idx += 1
        updated = max(updated, len(body.book_ids))

    # Title prefix strip (per-book, since each title is different)
    if body.title_prefix_strip and body.title_prefix_strip.strip():
        prefix = body.title_prefix_strip
        books = await db.books.find(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"_id": 0, "book_id": 1, "title": 1},
        ).to_list(5000)
        for b in books:
            t = b.get("title") or ""
            if t.startswith(prefix):
                new_t = t[len(prefix):].lstrip()
                if new_t and new_t != t:
                    await db.books.update_one(
                        {"book_id": b["book_id"], "user_id": user.user_id},
                        {"$set": {"title": new_t}},
                    )
                    updated += 1

    # Bulk tag add/remove
    add = _normalize_tags(body.add_tags or [])
    rm = _normalize_tags(body.remove_tags or [])
    if add:
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$addToSet": {"tags": {"$each": add}}},
        )
        updated = max(updated, result.modified_count)
    if rm:
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$pull": {"tags": {"$in": rm}}},
        )
        updated = max(updated, result.modified_count)

    return {"updated": updated}


__all__ = []
