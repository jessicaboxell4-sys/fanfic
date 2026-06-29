"""``routes/polish.py`` — endpoints around the deferred-classifier
polish queue.

The heavy lifting lives in ``utils.polish_worker``; this module is
just the thin HTTP surface so the SPA can:

  * count pending books for the banner       (``GET  /polish/stats``)
  * kick off / re-kick the user's drain      (``POST /polish``)
  * polish one specific book inline          (``POST /polish/{book_id}``)

The drain itself is fire-and-forget on the backend event loop, so
all three endpoints return in well under a second.
"""
from __future__ import annotations

import logging

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db
from models import User
from utils.constants import TRASH_SHELF
from utils.polish_worker import (
    count_pending_for_user,
    polish_one_book,
    schedule_polish_for_user,
    _inflight_users,
)

logger = logging.getLogger(__name__)


@api_router.get("/polish/stats")
async def polish_stats(user: User = Depends(get_current_user)):
    """Cheap snapshot for the "Polish N pending" banner on
    `/library/all`.  Returns the count of books waiting on the
    deferred classifier + whether a drain is currently running.

    Also bundles the count of upload_jobs currently in flight
    (``arriving``) so a single banner on the library page can
    represent the entire "books still moving through the pipeline"
    state — uploads coming in, then polish draining.
    """
    pending = await count_pending_for_user(user.user_id)
    failed = await db.books.count_documents({
        "user_id": user.user_id,
        "classifier": "polish-failed",
        "category": {"$ne": TRASH_SHELF},
    })
    # Books that have been POSTed but haven't finished server-side
    # processing yet (metadata extraction, Calibre conversion, R2
    # mirror).  Once these finish they land in db.books as
    # ``classifier: "pending"`` and are then counted by the polish
    # stats above — so the user sees a smooth "arriving → polish →
    # done" flow on the banner.
    arriving = await db.upload_jobs.count_documents({
        "user_id": user.user_id,
        "status": {"$in": ["queued", "processing"]},
    })
    return {
        "pending": pending,
        "failed": failed,
        "arriving": arriving,
        "in_progress": user.user_id in _inflight_users,
    }


@api_router.post("/polish")
async def polish_all(user: User = Depends(get_current_user)):
    """Kick (or re-kick) the polish drain for the current user.  The
    response returns immediately — the actual classifier work runs in
    the background.  Polls `/polish/stats` for progress.
    """
    pending = await count_pending_for_user(user.user_id)
    # Also reset any "polish-failed" rows so the user can retry them
    # via the same button.  Failed status is a sentinel set when
    # classify_book raised mid-drain; once cleared they get re-queued.
    # Reset the attempt counter too so the worker treats them as
    # fresh — the inbox is an explicit user action, not an auto-retry.
    await db.books.update_many(
        {
            "user_id": user.user_id,
            "classifier": "polish-failed",
            "category": {"$ne": TRASH_SHELF},
        },
        {
            "$set": {"classifier": "pending"},
            "$unset": {"polish_attempts": "", "polish_last_error": "", "polish_failed_at": ""},
        },
    )
    schedule_polish_for_user(user.user_id)
    return {"queued": pending, "in_progress": True}


@api_router.get("/polish/failed")
async def polish_failed_inbox(user: User = Depends(get_current_user)):
    """Retry inbox — list books the polish worker gave up on.

    Powers the modal that opens from the "N couldn't classify" chip
    on the upload-progress strip + a permanent entry-point in the
    library.  Returns lightweight rows so the modal renders fast even
    for users with hundreds of failures.  POST /polish (above) is the
    bulk-retry button — clearing the sentinel + re-queueing happens
    there, so this endpoint stays a pure read.
    """
    rows = await db.books.find(
        {
            "user_id": user.user_id,
            "classifier": "polish-failed",
            "category": {"$ne": TRASH_SHELF},
        },
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "fandom": 1,
            "filename": 1,
            "polish_attempts": 1,
            "polish_last_error": 1,
            "polish_failed_at": 1,
        },
    ).sort("polish_failed_at", -1).limit(200).to_list(200)
    return {
        "count": len(rows),
        "books": rows,
    }


@api_router.post("/polish/{book_id}")
async def polish_one(book_id: str, user: User = Depends(get_current_user)):
    """Polish one specific book inline — used by the per-book
    "Sort now" mini-button.  Runs the classifier synchronously so the
    UI can flip the card to its final state immediately.
    """
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    updates = await polish_one_book(user.user_id, book)
    return {"book_id": book_id, **updates}
