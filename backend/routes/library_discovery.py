"""Library discovery + activity-tracking endpoints.

A grab-bag of small, read-only endpoints that surface "what's new" and
"what should I read next?" UI affordances on the library home page.
Each was shipped as part of the P2 batch on 2026-06-13:

============================================  =====================================
``GET /api/library/random-unread``             W1 — Surprise-me random unread book.
``GET /api/library/unread``                    W2 — Every book the user hasn't opened.
``GET /api/library/queue``                     W3 — Reading queue ("Up next" stack).
``POST /api/library/queue/add``                W3 — Add a book to the queue.
``POST /api/library/queue/remove``             W3 — Remove a book from the queue.
``POST /api/library/queue/reorder``            W3 — Reorder the queue.
``GET /api/dashboard/since-last-login``        S4 — Counts of new things since last login.
``GET /api/fandoms/known``                     Public list of fandoms the classifier knows.
============================================  =====================================
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import List

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from auth_dep import get_current_user
from deps import api_router, db
from models import User
from utils.constants import TRASH_SHELF


# ===========================================================================
# W1 — GET /library/random-unread  (Surprise-me)
# ===========================================================================
@api_router.get("/library/random-unread")
async def random_unread(user: User = Depends(get_current_user)):
    """Return one random book the user hasn't opened yet.

    "Unread" = ``last_opened_at`` is null/missing AND the book isn't in
    Trash. Uses ``$sample`` for an even distribution on every call.
    """
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"last_opened_at": {"$exists": False}},
                {"last_opened_at": None},
                {"last_opened_at": ""},
            ],
        }},
        {"$sample": {"size": 1}},
        {"$project": {"_id": 0}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(1)
    if not rows:
        raise HTTPException(status_code=404, detail="No unread books found")
    return {"book": rows[0]}


# ===========================================================================
# W2 — GET /library/unread  (Books I haven't read filter)
# ===========================================================================
@api_router.get("/library/unread")
async def list_unread(
    limit: int = 500,
    user: User = Depends(get_current_user),
):
    """Every active book the user hasn't opened yet, newest upload first."""
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"last_opened_at": {"$exists": False}},
                {"last_opened_at": None},
                {"last_opened_at": ""},
            ],
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "tags": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1).limit(max(1, min(limit, 2000)))
    books = await cursor.to_list(limit)
    return {"books": books, "count": len(books)}


# ===========================================================================
# W3 — Reading queue / "Up next" stack
# ===========================================================================
class QueueAddBody(BaseModel):
    book_id: str
    position: int | None = None  # default = append


class QueueRemoveBody(BaseModel):
    book_id: str


class QueueReorderBody(BaseModel):
    book_ids: List[str]


@api_router.get("/library/queue")
async def get_queue(user: User = Depends(get_current_user)):
    """Return the user's reading queue (Up Next stack) with hydrated book
    metadata. Stale book_ids (book was deleted) are dropped silently."""
    doc = await db.reading_queues.find_one({"user_id": user.user_id}, {"_id": 0})
    ids = list((doc or {}).get("book_ids") or [])
    if not ids:
        return {"queue": []}
    cursor = db.books.find(
        {"user_id": user.user_id, "book_id": {"$in": ids}},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
         "category": 1, "has_cover": 1, "tags": 1},
    )
    rows = {b["book_id"]: b async for b in cursor}
    queue = [rows[bid] for bid in ids if bid in rows]
    return {"queue": queue}


@api_router.post("/library/queue/add")
async def queue_add(body: QueueAddBody, user: User = Depends(get_current_user)):
    """Add a book to the queue. Idempotent — already-queued books are
    moved to the requested position (or appended) instead of duplicated."""
    bid = (body.book_id or "").strip()
    if not bid:
        raise HTTPException(status_code=400, detail="book_id required")
    book = await db.books.find_one(
        {"book_id": bid, "user_id": user.user_id}, {"_id": 0, "book_id": 1}
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    doc = await db.reading_queues.find_one({"user_id": user.user_id}) or {}
    ids = list(doc.get("book_ids") or [])
    # Remove existing copy if present (idempotent insert / move).
    ids = [x for x in ids if x != bid]
    if body.position is None or body.position >= len(ids):
        ids.append(bid)
    else:
        ids.insert(max(0, body.position), bid)
    await db.reading_queues.update_one(
        {"user_id": user.user_id},
        {"$set": {"book_ids": ids, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"queue": ids}


@api_router.post("/library/queue/remove")
async def queue_remove(body: QueueRemoveBody, user: User = Depends(get_current_user)):
    bid = (body.book_id or "").strip()
    if not bid:
        raise HTTPException(status_code=400, detail="book_id required")
    await db.reading_queues.update_one(
        {"user_id": user.user_id},
        {"$pull": {"book_ids": bid}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    doc = await db.reading_queues.find_one({"user_id": user.user_id}, {"_id": 0, "book_ids": 1})
    return {"queue": (doc or {}).get("book_ids") or []}


@api_router.post("/library/queue/reorder")
async def queue_reorder(body: QueueReorderBody, user: User = Depends(get_current_user)):
    """Overwrite the queue with the provided ordering. Drops any
    book_ids that don't belong to the user (defense against tampering)."""
    raw = body.book_ids or []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="book_ids must be a list")
    cursor = db.books.find(
        {"user_id": user.user_id, "book_id": {"$in": raw}},
        {"_id": 0, "book_id": 1},
    )
    owned = {b["book_id"] async for b in cursor}
    cleaned = [x for x in raw if x in owned]
    await db.reading_queues.update_one(
        {"user_id": user.user_id},
        {"$set": {"book_ids": cleaned, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"queue": cleaned}


# ===========================================================================
# S4 — GET /dashboard/since-last-login  (Activity since you were last here)
# ===========================================================================
@api_router.get("/dashboard/since-last-login")
async def since_last_login(user: User = Depends(get_current_user)):
    """Counts of new things since the user's previous login.

    The auth layer stores ``previous_login_at`` on the user doc the
    moment a new session is created (see ``routes/auth.py``). If it's
    missing (brand-new user) we fall back to the past 24 hours.
    """
    udoc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "previous_login_at": 1, "created_at": 1},
    )
    since = (udoc or {}).get("previous_login_at") or (udoc or {}).get("created_at")
    if not since:
        return {
            "since": None,
            "new_books": 0,
            "friend_requests": 0,
            "new_messages": 0,
            "unread_notifications": 0,
        }

    new_books = await db.books.count_documents({
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "created_at": {"$gte": since},
    })
    # Unread friend requests since last login.
    friend_requests = await db.notifications.count_documents({
        "user_id": user.user_id,
        "kind": "friend_request",
        "is_read": {"$ne": True},
        "created_at": {"$gte": since},
    })
    # New chat messages addressed to the user (across all rooms).
    rooms = [r["room_id"] async for r in db.chat_rooms.find(
        {"member_user_ids": user.user_id}, {"_id": 0, "room_id": 1}
    )]
    new_messages = 0
    if rooms:
        new_messages = await db.chat_messages.count_documents({
            "room_id": {"$in": rooms},
            "author_id": {"$ne": user.user_id},
            "created_at": {"$gte": since},
        })
    unread_notifications = await db.notifications.count_documents({
        "user_id": user.user_id,
        "is_read": {"$ne": True},
        "created_at": {"$gte": since},
    })

    return {
        "since": since,
        "new_books": new_books,
        "friend_requests": friend_requests,
        "new_messages": new_messages,
        "unread_notifications": unread_notifications,
    }


# ===========================================================================
# GET /fandoms/known — list of fandoms the heuristic classifier knows.
# Surfaced on the Help page so users can see what auto-sorts and what
# would land in Original Fiction / unknown until added.
# ===========================================================================
@api_router.get("/fandoms/known")
async def list_known_fandoms():
    """Return every fandom the EPUB-upload classifier currently routes
    a book into. Pure data, no auth required (the list is not sensitive
    and the Help page renders it for anonymous-curious visitors too)."""
    from data.ao3_top_fandoms import AO3_TOP_FANDOMS
    fandoms = sorted(AO3_TOP_FANDOMS.keys(), key=lambda s: s.lower())
    return {"count": len(fandoms), "fandoms": fandoms}

