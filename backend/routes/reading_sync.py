"""Cross-device reading-cursor sync + stuck-book / pace / DNF helpers.

Powers the "open a book on laptop, resume on phone" flow plus the
stuck-book intelligence (smart shelf, pace forecast, DNF filter) that
sits on top of the cursor data.

Collection: ``reading_cursors``::

    {
      user_id:        str,
      book_id:        str,
      cfi:            str,        # opaque location handle
      percent:        float,      # 0..1, mirror of books.progress_fraction
      chapter_label:  str,
      device_id:      str,        # browser-stamped, see :ref:`device_id`
      device_label:   str,        # "Chrome on Mac" etc., client-supplied
      updated_at:     iso str,
    }

The compound index ``(user_id, book_id)`` lets us upsert by reader+book
in a single round-trip.  ``device_id`` is a stable random string the
client mints once and stores in localStorage so the handoff prompt can
say "you were reading on your phone" without ever knowing the device's
real identity.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


# ---------------------------------------------------------------------
# Cursor sync
# ---------------------------------------------------------------------

class CursorPushBody(BaseModel):
    cfi: str = Field("", max_length=600)
    percent: float = Field(0.0, ge=0.0, le=1.0)
    chapter_label: str = Field("", max_length=200)
    device_id: str = Field("", max_length=64)
    device_label: str = Field("", max_length=120)


@api_router.post("/books/{book_id}/cursor")
async def push_reading_cursor(
    book_id: str,
    body: CursorPushBody,
    user: User = Depends(get_current_user),
):
    """Upsert the user's current cursor for this book.  Fires from
    the Reader on every debounced progress update (1.2 s after the
    user stops turning pages) so the cloud copy stays roughly in sync
    with localStorage."""
    # Confirm the book belongs to the caller — no cross-user writes.
    own = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1},
    )
    if own is None:
        raise HTTPException(status_code=404, detail="Book not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.reading_cursors.update_one(
        {"user_id": user.user_id, "book_id": book_id},
        {"$set": {
            "user_id":       user.user_id,
            "book_id":       book_id,
            "cfi":           body.cfi,
            "percent":       float(body.percent or 0),
            "chapter_label": body.chapter_label,
            "device_id":     body.device_id,
            "device_label":  body.device_label,
            "updated_at":    now_iso,
        }},
        upsert=True,
    )
    return {"ok": True, "updated_at": now_iso}


@api_router.get("/books/{book_id}/cursor")
async def get_reading_cursor(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Read the latest cursor for this (user, book).  Returns 404 when
    the user never opened the book on any device — the client falls
    back to its own localStorage / `?at=` jump in that case."""
    doc = await db.reading_cursors.find_one(
        {"user_id": user.user_id, "book_id": book_id},
        {"_id": 0},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="No cursor yet")
    return doc


@api_router.get("/reading-sync/hints")
async def cross_device_hints(
    device_id: str = "",
    hours: int = 24,
    user: User = Depends(get_current_user),
):
    """Return a per-book "you started this on another device — pick up?"
    hint set.  The library page calls this once and tags each ``BookCard``
    when its ``book_id`` is in the result, so the user discovers
    cross-device sync passively without enabling push.

    A book qualifies if its ``reading_cursors`` row was updated in the
    last ``hours`` window by ANY device other than the caller's current
    ``device_id`` (mint-once stable id from localStorage).  Books
    already finished (>=99%) are excluded so we don't badge them.
    """
    hours = max(1, min(int(hours or 24), 24 * 30))
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q: Dict[str, Any] = {"user_id": user.user_id, "updated_at": {"$gte": cutoff}}
    if device_id:
        q["device_id"] = {"$ne": device_id}
    cursor = db.reading_cursors.find(
        q,
        {"_id": 0, "book_id": 1, "device_label": 1, "updated_at": 1, "percent": 1},
    )
    hints: List[Dict[str, Any]] = []
    async for c in cursor:
        if float(c.get("percent") or 0) >= 0.99:
            continue   # already finished — no nudge
        hints.append({
            "book_id":      c.get("book_id"),
            "device_label": c.get("device_label") or "another device",
            "updated_at":   c.get("updated_at"),
            "percent":      float(c.get("percent") or 0),
        })
    return {"hints": hints, "count": len(hints)}


@api_router.get("/books/{book_id}/active-devices")
async def active_devices_for_book(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Returns any device(s) that pushed a cursor for this book in the
    last 10 minutes — used by the "Now reading on iPhone" indicator on
    the book detail page.  Always at most one cursor per (user, book)
    in the collection, but this endpoint exists so the client doesn't
    have to know the cursor schema."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    doc = await db.reading_cursors.find_one(
        {"user_id": user.user_id, "book_id": book_id, "updated_at": {"$gte": cutoff}},
        {"_id": 0, "device_id": 1, "device_label": 1, "updated_at": 1},
    )
    return {"active": [doc] if doc else []}


# ---------------------------------------------------------------------
# Stuck books smart shelf
# ---------------------------------------------------------------------

@api_router.get("/books/stuck")
async def list_stuck_books(
    days: int = 30,
    max_percent: float = 0.30,
    limit: int = 50,
    user: User = Depends(get_current_user),
):
    """Books the user started but hasn't finished — last opened more
    than ``days`` days ago AND progress < ``max_percent``.

    Powers the "Stuck books" smart shelf and the re-engagement
    digest's body."""
    days = max(1, min(int(days or 30), 365))
    max_percent = max(0.0, min(float(max_percent or 0.3), 0.9))
    limit = max(1, min(int(limit or 50), 200))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = (
        db.books.find(
            {
                "user_id": user.user_id,
                "last_opened_at": {"$lt": cutoff, "$exists": True},
                "progress_fraction": {"$gt": 0.01, "$lt": max_percent},
                "trashed": {"$ne": True},
            },
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
             "progress_fraction": 1, "last_opened_at": 1, "category": 1, "has_cover": 1},
        )
        .sort("last_opened_at", 1)   # most-stuck first
        .limit(limit)
    )
    rows: List[Dict[str, Any]] = []
    async for b in cursor:
        rows.append(b)
    return {"books": rows, "count": len(rows), "window_days": days}


# ---------------------------------------------------------------------
# Pace forecast — estimated finish date based on reading speed
# ---------------------------------------------------------------------

@api_router.get("/books/{book_id}/pace")
async def pace_forecast(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Project when the user will finish this book at their recent
    reading pace.  Uses the reading_activity collection (minutes per
    day per book) for the last 14 days and the progress delta over
    that window to estimate days-to-finish."""
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "progress_fraction": 1, "title": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    pct = float(book.get("progress_fraction") or 0)
    if pct >= 0.995:
        return {"finished": True, "days_to_finish": 0, "current_percent": pct}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    cursor = db.reading_activity.find(
        {"user_id": user.user_id, "book_id": book_id, "day": {"$gte": cutoff[:10]}},
        {"_id": 0, "minutes": 1},
    )
    minutes_total = 0
    days_with_activity = 0
    async for r in cursor:
        m = int(r.get("minutes") or 0)
        if m > 0:
            minutes_total += m
            days_with_activity += 1

    if minutes_total < 10:
        return {
            "finished":         False,
            "current_percent":  pct,
            "days_to_finish":   None,
            "reason":           "not_enough_data",
            "minutes_last_14d": minutes_total,
        }

    # Naive linear projection — assume the same minutes/day cadence
    # converts roughly the same percentage points per day going forward.
    # We don't know how much percent ÷ minute the user reads at without
    # snapshotting progress over time, so we approximate from total
    # progress so far ÷ all reading minutes ever (less noisy than the
    # 14-day window for the per-minute rate).
    total_minutes_cursor = db.reading_activity.find(
        {"user_id": user.user_id, "book_id": book_id},
        {"_id": 0, "minutes": 1},
    )
    lifetime_minutes = 0
    async for r in total_minutes_cursor:
        lifetime_minutes += int(r.get("minutes") or 0)
    if lifetime_minutes < 10 or pct <= 0:
        return {
            "finished":         False,
            "current_percent":  pct,
            "days_to_finish":   None,
            "reason":           "not_enough_data",
        }
    pct_per_minute = pct / lifetime_minutes
    avg_minutes_per_day = minutes_total / max(days_with_activity or 1, 1)
    remaining_pct = max(0.0, 1.0 - pct)
    days_to_finish = remaining_pct / (pct_per_minute * avg_minutes_per_day)
    return {
        "finished":            False,
        "current_percent":     pct,
        "days_to_finish":      round(days_to_finish, 1),
        "minutes_last_14d":    minutes_total,
        "avg_minutes_per_day": round(avg_minutes_per_day, 1),
        "reason":              "ok",
    }


# ---------------------------------------------------------------------
# DNF mark — light-weight extension of /books/{id}/mark
# ---------------------------------------------------------------------

class DnfBody(BaseModel):
    is_dnf: bool = True


@api_router.post("/books/{book_id}/dnf")
async def mark_book_dnf(
    book_id: str,
    body: DnfBody,
    user: User = Depends(get_current_user),
):
    """Flag a book as Did-Not-Finish.  The affinity-recommendations
    endpoint excludes authors of DNF'd books so the user isn't
    nagged with more by an author they already gave up on."""
    own = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "author": 1},
    )
    if own is None:
        raise HTTPException(status_code=404, detail="Book not found")
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"is_dnf": bool(body.is_dnf)}},
    )
    return {"ok": True, "is_dnf": bool(body.is_dnf), "author": own.get("author", "")}


# ---------------------------------------------------------------------
# Friends-reading-this badge (C1 — opt-in via friends sharing)
# ---------------------------------------------------------------------

@api_router.get("/books/{book_id}/friends-reading")
async def friends_reading_this_book(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Number of accepted friends with a recent cursor on a book that
    matches this canonical title+author.  Privacy-preserving: returns
    only the count + handles, never the friend's exact position.

    Only friends with ``library_visible_to_friends == True`` are
    counted so we don't leak data from friends who opted out."""
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "title": 1, "author": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    cursor = db.friendships.find(
        {
            "status": "accepted",
            "$or": [
                {"user_a": user.user_id},
                {"user_b": user.user_id},
            ],
        },
        {"_id": 0, "user_a": 1, "user_b": 1},
    )
    friend_ids: List[str] = []
    async for f in cursor:
        a, b = f.get("user_a"), f.get("user_b")
        friend_ids.append(b if a == user.user_id else a)
    if not friend_ids:
        return {"count": 0, "friends": []}

    # Restrict to friends who opted into library sharing.
    visible_cursor = db.users.find(
        {"user_id": {"$in": friend_ids}, "library_visible_to_friends": True},
        {"_id": 0, "user_id": 1, "username": 1, "name": 1},
    )
    visible: Dict[str, Dict[str, Any]] = {}
    async for u in visible_cursor:
        visible[u["user_id"]] = u

    if not visible:
        return {"count": 0, "friends": []}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    # Friends' books matching this title+author (case-insensitive).
    title = (book.get("title") or "").strip().lower()
    author = (book.get("author") or "").strip().lower()
    match_query: Dict[str, Any] = {"user_id": {"$in": list(visible.keys())}}
    if title:
        match_query["title"] = {"$regex": f"^{title}$", "$options": "i"}
    if author:
        match_query["author"] = {"$regex": f"^{author}$", "$options": "i"}
    matching_books = db.books.find(match_query, {"_id": 0, "user_id": 1, "book_id": 1})
    relevant_pairs: List = []
    async for mb in matching_books:
        relevant_pairs.append((mb["user_id"], mb["book_id"]))
    if not relevant_pairs:
        return {"count": 0, "friends": []}

    # Now check which of those (user, book) pairs have a recent cursor.
    recent_cursor = db.reading_cursors.find(
        {
            "$or": [{"user_id": uid, "book_id": bid} for uid, bid in relevant_pairs],
            "updated_at": {"$gte": cutoff},
        },
        {"_id": 0, "user_id": 1},
    )
    actively_reading: set = set()
    async for r in recent_cursor:
        actively_reading.add(r["user_id"])

    out = []
    for uid in actively_reading:
        v = visible.get(uid)
        if v:
            out.append({
                "username": v.get("username") or "",
                "name":     v.get("name") or v.get("username") or "Friend",
            })
    return {"count": len(out), "friends": out[:6]}


__all__ = []
