"""Trash shelf — soft-delete with a 30-day grace window before hard delete.

When a book is removed from the library it lands in a special
``Trash`` shelf. The user can restore it (individually or in bulk)
or empty the shelf to free up storage. A background sweep (called
from the daily digest cron in ``routes/digest.py``) hard-deletes
books whose ``trash_expires_at`` has passed.

Endpoints
---------
=====================================  ==================================
``GET    /api/trash``                  List everything in Trash.
``POST   /api/trash/restore/{bid}``    Restore one book.
``POST   /api/trash/restore-all``      Restore every book in Trash.
``POST   /api/trash/empty``            Hard-delete every book in Trash.
=====================================  ==================================

Background helper
-----------------
``sweep_expired_trash()`` is exported as a coroutine so the daily
digest cron can call it. It walks the user-storage dirs to remove the
EPUB/cover/links sidecar files in addition to the Mongo row.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db, STORAGE_DIR
from models import User
from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS


@api_router.get("/trash")
async def list_trash(user: User = Depends(get_current_user)):
    """List every book currently sitting in Trash for the user."""
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1,
            "trash_expires_at": 1, "dupe_action_meta": 1,
        },
    ).sort("trash_expires_at", 1)
    books = [b async for b in cursor]
    return {"books": books, "count": len(books), "grace_days": TRASH_GRACE_DAYS}


@api_router.post("/trash/restore/{book_id}")
async def restore_from_trash(book_id: str, user: User = Depends(get_current_user)):
    """Restore a book from Trash to its previous category."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.get("category") != TRASH_SHELF:
        raise HTTPException(status_code=400, detail="Book is not in Trash")
    prev_cat = (book.get("dupe_action_meta") or {}).get("prev_category_new") or "Unclassified"
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {"category": prev_cat},
            "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
        },
    )
    return {"ok": True, "book_id": book_id, "restored_to": prev_cat}


@api_router.post("/trash/restore-all")
async def restore_all_trash(user: User = Depends(get_current_user)):
    """Restore every book in the user's Trash to its previous category."""
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {"_id": 0, "book_id": 1, "dupe_action_meta": 1},
    )
    restored = 0
    async for b in cursor:
        prev_cat = (b.get("dupe_action_meta") or {}).get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
            },
        )
        restored += 1
    return {"restored": restored}


@api_router.post("/trash/empty")
async def empty_trash(user: User = Depends(get_current_user)):
    """Hard-delete every book currently in Trash for the user. Also
    removes the EPUB/cover/links sidecar files from disk."""
    user_dir = STORAGE_DIR / user.user_id
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {"_id": 0, "book_id": 1},
    )
    book_ids = [b["book_id"] async for b in cursor]
    for bid in book_ids:
        for ext in (".epub", ".cover", ".links.txt"):
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass
    result = await db.books.delete_many(
        {"user_id": user.user_id, "category": TRASH_SHELF},
    )
    return {"deleted": result.deleted_count}


async def sweep_expired_trash() -> int:
    """Background sweep — hard-delete books whose Trash grace window expired.

    Returns the total number of books removed. Walks every user's storage
    dir to also drop the EPUB/cover/links sidecar.

    Called from the daily digest cron in ``routes/digest.py``.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.books.find(
        {"category": TRASH_SHELF, "trash_expires_at": {"$lt": now_iso}},
        {"_id": 0, "book_id": 1, "user_id": 1},
    )
    to_delete = [b async for b in cursor]
    removed = 0
    for b in to_delete:
        uid = b.get("user_id")
        bid = b.get("book_id")
        if not uid or not bid:
            continue
        user_dir = STORAGE_DIR / uid
        for ext in (".epub", ".cover", ".links.txt"):
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass
        res = await db.books.delete_one({"book_id": bid, "user_id": uid})
        removed += res.deleted_count
    return removed
