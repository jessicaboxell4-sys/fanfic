"""Library social discovery, reactions, and read-receipt endpoints.

Bundles four loosely-related but flywheel-adjacent features shipped
together as Group B + D + E on 2026-06-26 (late):

  * ``GET  /api/library/featured`` — 3-5 random opted-in libraries
    rotated on each call.  Used by the landing-page social-proof
    carousel.

  * ``GET  /api/library/discover/by-fandom/{fandom}`` — opted-in users
    who have ≥1 book in the given fandom.  Powers /explore/fandom/...

  * ``POST /api/books/{book_id}/react`` — toggle a heart on someone
    else's book (signed-in only).  Idempotent — calling twice deletes
    the heart.

  * ``GET  /api/books/trending`` — most-hearted books across all
    public libraries in the last 7 days.

  * ``POST /api/users/{username}/public-library/view-ping`` — when a
    different signed-in user views ``/u/<handle>/library``, fire a
    rate-limited "@<viewer> viewed your library" notification to the
    owner.  Rate-limit: at most one per (viewer, owner) pair per 24h.

Privacy invariants
------------------
All endpoints return data only for users with
``library_visible_to_public == True`` and ``approval_status`` in
``(None, "approved")``.  No book/fandom data leaves the server for
users who haven't opted in.  AV-infected books are excluded
everywhere.  The view-ping endpoint NEVER notifies the owner when
they view their own library.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db, logger
from models import User
from routes.notifications import create_notification


# ---------------------------------------------------------------------
# Featured public libraries (anon).
# ---------------------------------------------------------------------
@api_router.get("/library/featured")
async def featured_libraries(limit: int = 5):
    limit = max(1, min(int(limit or 5), 10))
    candidates: List[Dict[str, Any]] = await db.users.aggregate([
        {"$match": {
            "library_visible_to_public": True,
            "approval_status": {"$in": [None, "approved"]},
            "username": {"$exists": True, "$nin": [None, ""]},
        }},
        {"$sample": {"size": limit * 2}},  # over-fetch; we drop empty libs
        {"$project": {
            "_id": 0,
            "user_id": 1, "username": 1, "name": 1, "picture": 1, "bio": 1,
        }},
    ]).to_list(length=limit * 2)
    if not candidates:
        return {"featured": []}
    out: List[Dict[str, Any]] = []
    for u in candidates:
        books = await db.books.find(
            {"user_id": u["user_id"], "av_status": {"$ne": "infected"}},
            {"_id": 0, "fandom": 1},
        ).limit(500).to_list(length=500)
        total = len(books)
        if total == 0:
            continue
        fandom_counts: Dict[str, int] = {}
        for b in books:
            f = (b.get("fandom") or "").strip()
            if f:
                fandom_counts[f] = fandom_counts.get(f, 0) + 1
        top_fandom = (
            max(fandom_counts.items(), key=lambda kv: kv[1])[0]
            if fandom_counts else ""
        )
        out.append({
            "username": u.get("username") or "",
            "display_name": u.get("name") or u.get("username") or "",
            "picture": u.get("picture") or "",
            "bio": (u.get("bio") or "").strip(),
            "total_books": total,
            "top_fandom": top_fandom,
        })
        if len(out) >= limit:
            break
    return {"featured": out}


# ---------------------------------------------------------------------
# Fandom-based discovery (anon).
# ---------------------------------------------------------------------
@api_router.get("/library/discover/by-fandom/{fandom}")
async def discover_by_fandom(fandom: str, limit: int = 30):
    fname = (fandom or "").strip()
    if not fname or len(fname) > 120:
        raise HTTPException(status_code=404, detail="Not found")
    limit = max(1, min(int(limit or 30), 50))
    pat = re.compile(f"^{re.escape(fname)}$", re.IGNORECASE)
    user_book_counts: List[Dict[str, Any]] = await db.books.aggregate([
        {"$match": {"fandom": {"$regex": pat}, "av_status": {"$ne": "infected"}}},
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit * 2},
    ]).to_list(length=limit * 2)
    if not user_book_counts:
        return {"fandom": fname, "users": [], "total": 0}
    user_ids = [r["_id"] for r in user_book_counts]
    owners = await db.users.find(
        {
            "user_id": {"$in": user_ids},
            "library_visible_to_public": True,
            "approval_status": {"$in": [None, "approved"]},
            "username": {"$exists": True, "$nin": [None, ""]},
        },
        {"_id": 0, "user_id": 1, "username": 1, "name": 1, "picture": 1, "bio": 1},
    ).to_list(length=len(user_ids))
    by_id = {o["user_id"]: o for o in owners}
    out: List[Dict[str, Any]] = []
    for r in user_book_counts:
        owner = by_id.get(r["_id"])
        if not owner:
            continue
        out.append({
            "username": owner.get("username") or "",
            "display_name": owner.get("name") or owner.get("username") or "",
            "picture": owner.get("picture") or "",
            "bio": (owner.get("bio") or "").strip(),
            "books_in_fandom": int(r["count"]),
        })
        if len(out) >= limit:
            break
    return {"fandom": fname, "users": out, "total": len(out)}


# ---------------------------------------------------------------------
# Heart-a-book — signed-in reactions.
# ---------------------------------------------------------------------
@api_router.post("/books/{book_id}/react")
async def toggle_book_reaction(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one(
        {"book_id": book_id},
        {"_id": 0, "book_id": 1, "user_id": 1, "title": 1, "author": 1,
         "av_status": 1},
    )
    if not book or book.get("av_status") == "infected":
        raise HTTPException(status_code=404, detail="Not found")
    if book["user_id"] == user.user_id:
        return {"hearted": False, "self_react": True}
    owner = await db.users.find_one(
        {"user_id": book["user_id"]},
        {"_id": 0, "library_visible_to_public": 1, "approval_status": 1,
         "username": 1},
    )
    if (not owner
            or not owner.get("library_visible_to_public")
            or owner.get("approval_status") not in (None, "approved")):
        raise HTTPException(status_code=404, detail="Not found")
    existing = await db.book_reactions.find_one(
        {"book_id": book_id, "viewer_user_id": user.user_id}, {"_id": 1},
    )
    if existing:
        await db.book_reactions.delete_one({"_id": existing["_id"]})
        return {"hearted": False, "self_react": False}
    # Use upsert so simultaneous double-clicks from the same viewer
    # can't produce two reaction docs (per iteration_52 code-review).
    # The {book_id, viewer_user_id} pair is the natural primary key
    # — set on insert only, never overwritten.
    await db.book_reactions.update_one(
        {"book_id": book_id, "viewer_user_id": user.user_id},
        {"$setOnInsert": {
            "book_id": book_id,
            "owner_user_id": book["user_id"],
            "viewer_user_id": user.user_id,
            "title_lower": (book.get("title") or "").strip().lower(),
            "author_lower": (book.get("author") or "").strip().lower(),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {"hearted": True, "self_react": False}


@api_router.get("/books/{book_id}/reaction-status")
async def book_reaction_status(book_id: str, user: User = Depends(get_current_user)):
    existing = await db.book_reactions.find_one(
        {"book_id": book_id, "viewer_user_id": user.user_id}, {"_id": 1},
    )
    count = await db.book_reactions.count_documents({"book_id": book_id})
    return {"hearted": bool(existing), "heart_count": count}


@api_router.get("/books/trending")
async def trending_books(limit: int = 12, days: int = 7):
    limit = max(1, min(int(limit or 12), 30))
    days = max(1, min(int(days or 7), 90))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows: List[Dict[str, Any]] = await db.book_reactions.aggregate([
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": {"t": "$title_lower", "a": "$author_lower"},
            "heart_count": {"$sum": 1},
            "any_book_id": {"$first": "$book_id"},
            "any_owner_user_id": {"$first": "$owner_user_id"},
        }},
        {"$sort": {"heart_count": -1, "_id": 1}},
        {"$limit": limit * 2},  # over-fetch in case some owners de-opted
    ]).to_list(length=limit * 2)
    if not rows:
        return {"trending": [], "window_days": days}
    out: List[Dict[str, Any]] = []
    for r in rows:
        book = await db.books.find_one(
            {"book_id": r["any_book_id"]},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1,
             "fandom": 1, "category": 1},
        )
        if not book:
            continue
        owner = await db.users.find_one(
            {"user_id": r["any_owner_user_id"]},
            {"_id": 0, "username": 1, "library_visible_to_public": 1,
             "approval_status": 1},
        )
        if (not owner
                or not owner.get("library_visible_to_public")
                or owner.get("approval_status") not in (None, "approved")):
            continue
        out.append({
            "title": book.get("title") or "Untitled",
            "author": book.get("author") or "",
            "fandom": book.get("fandom") or "",
            "category": book.get("category") or "",
            "heart_count": int(r["heart_count"]),
            "sample_owner_handle": owner.get("username") or "",
        })
        if len(out) >= limit:
            break
    return {"trending": out, "window_days": days}


# ---------------------------------------------------------------------
# View-ping — "@viewer peeked at your library" notification.
# ---------------------------------------------------------------------
@api_router.post("/users/{username}/public-library/view-ping")
async def public_library_view_ping(
    username: str, user: User = Depends(get_current_user),
):
    uname = (username or "").strip().lstrip("@").lower()
    if not uname:
        return {"notified": False}
    owner = await db.users.find_one(
        {"username": uname},
        {"_id": 0, "user_id": 1, "username": 1,
         "library_visible_to_public": 1, "approval_status": 1},
    )
    if (not owner
            or not owner.get("library_visible_to_public")
            or owner.get("approval_status") not in (None, "approved")):
        return {"notified": False}
    if owner["user_id"] == user.user_id:
        return {"notified": False, "self": True}
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = await db.library_view_pings.find_one({
        "viewer_user_id": user.user_id,
        "owner_user_id": owner["user_id"],
        "created_at": {"$gte": cutoff},
    })
    if recent:
        return {"notified": False, "rate_limited": True}
    await db.library_view_pings.insert_one({
        "viewer_user_id": user.user_id,
        "owner_user_id": owner["user_id"],
        "created_at": datetime.now(timezone.utc),
    })
    viewer_handle = (user.username or "").strip()
    viewer_display = f"@{viewer_handle}" if viewer_handle else (user.name or "Someone")
    try:
        await create_notification(
            user_id=owner["user_id"],
            kind="library_viewed",
            title=f"{viewer_display} peeked at your library",
            body="Someone is browsing your shelves on Shelfsort.",
            link=f"/u/{viewer_handle}" if viewer_handle else "/users",
        )
    except Exception:
        logger.warning("library-viewed notif failed", exc_info=True)
    return {"notified": True}
