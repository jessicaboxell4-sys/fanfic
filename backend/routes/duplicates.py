"""Duplicate-resolution routes, extracted from ``routes/books.py`` as part of
the Phase 4 refactor (2026-06-14).

The *detection* helpers (``find_duplicate_candidates``) and *application*
helper (``_apply_duplicate_policy``) stay in ``books.py`` because
``upload_books`` calls them inline. This module owns only the user-facing
``undo`` route — a thin reversal of whatever policy was applied.

Route:
    POST /api/books/{book_id}/undo-resolve
"""
from fastapi import Depends, HTTPException

from deps import db, api_router
from models import User
from auth_dep import get_current_user


@api_router.post("/books/{book_id}/undo-resolve")
async def undo_resolve(book_id: str, user: User = Depends(get_current_user)):
    """Undo a recent policy-driven duplicate resolution.

    Reads ``dupe_action_meta`` from the book and reverses the field changes.
    For ``historical`` and ``new_version`` we restore the previous categories
    and unset ``replaced_by`` / ``replaces``. ``keep_both`` is a no-op (nothing
    to undo); ``discard`` is reversible only while the book is still in trash.
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    meta = book.get("dupe_action_meta") or {}
    action = meta.get("action")
    if action not in ("historical", "new_version", "discard"):
        raise HTTPException(status_code=400, detail=f"Action '{action}' is not undoable")

    if action == "discard":
        prev_cat = meta.get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
            },
        )
        return {"ok": True, "undone": "discard", "book_id": book_id}

    if action == "historical":
        prev_cat = meta.get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"replaced_by": "", "replaced_at": "", "dupe_action_meta": ""},
            },
        )
        return {"ok": True, "undone": "historical", "book_id": book_id}

    # new_version
    target_id = meta.get("target_book_id")
    prev_cat_new = meta.get("prev_category_new") or "Unclassified"
    prev_cat_target = meta.get("prev_category_target") or "Fanfiction"
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {"category": prev_cat_new},
            "$unset": {"replaces": "", "last_refreshed_at": "", "update_seen": "", "dupe_action_meta": ""},
        },
    )
    if target_id:
        await db.books.update_one(
            {"book_id": target_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat_target},
                "$unset": {"replaced_by": "", "replaced_at": ""},
            },
        )
    return {"ok": True, "undone": "new_version", "book_id": book_id, "target_book_id": target_id}
