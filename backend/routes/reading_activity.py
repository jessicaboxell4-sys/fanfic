"""Reading-activity endpoints, extracted from ``routes/books.py`` as part of
Phase 5F (2026-06-14).

Owns the four small endpoints that record what the user is *doing* with a
book — marking finished, ticking off reading time, persisting position,
and the lightweight "I just opened this" touch ping that fuels the
Continue-Reading rail.

Routes:
    POST /api/books/{book_id}/mark        — set finished / unfinished
    POST /api/books/{book_id}/heartbeat   — log a minute of reading time
    POST /api/books/{book_id}/progress    — persist 0.0–1.0 fraction + CFI
    POST /api/books/{book_id}/touch       — mark as just opened

Each writes both the per-book document (``books`` collection) and the
daily streak/digest aggregator (``reading_activity`` collection) so the
dashboard widgets, streak badge, and weekly digest stay in sync.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router
from models import User
from auth_dep import get_current_user


# --- helpers ----------------------------------------------------------------

async def _log_activity(user_id: str, book_id: str, minutes: float = 0.0):
    """Append today's reading activity for streak calculations.

    `minutes` adds to:
      - the day's total accumulated reading time (for streak/digest aggregates)
      - the day's per-book accumulator (for per-book sparklines)

    Pass 0 for plain "opened" events (progress updates, touch) so we don't
    double-count time but still register the day as active.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    update: Dict[str, Any] = {
        "$addToSet": {"book_ids": book_id},
        "$set": {"last_ts": datetime.now(timezone.utc).isoformat()},
    }
    if minutes and minutes > 0:
        update["$inc"] = {
            "minutes": float(minutes),
            # Per-book accumulator (book_id is safe — alphanumeric + underscore)
            f"book_minutes.{book_id}": float(minutes),
        }
    await db.reading_activity.update_one(
        {"user_id": user_id, "date": today},
        update,
        upsert=True,
    )


# --- request models ---------------------------------------------------------

class MarkBody(BaseModel):
    read: bool


class HeartbeatBody(BaseModel):
    seconds: float = Field(..., ge=0, le=600)  # cap at 10 min per ping (sanity)


class ProgressBody(BaseModel):
    percent: float
    cfi: Optional[str] = None


# --- routes -----------------------------------------------------------------

@api_router.post("/books/{book_id}/mark")
async def mark_book(book_id: str, body: MarkBody, user: User = Depends(get_current_user)):
    """Mark a book as fully read or unread (sets progress to 100% / 0%)."""
    update: Dict[str, Any] = {
        "progress_fraction": 1.0 if body.read else 0.0,
    }
    if body.read:
        update["last_opened_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "read": body.read}


@api_router.post("/books/{book_id}/heartbeat")
async def reading_heartbeat(
    book_id: str,
    body: HeartbeatBody,
    user: User = Depends(get_current_user),
):
    """Record reading time for the Reader page. Frontend sends one ping per
    minute (with `seconds`=60) while the tab is focused and the user is active.
    Server caps each ping at 10 min to defend against clock-skew / replay."""
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id}, {"_id": 0, "book_id": 1}
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    minutes = float(body.seconds) / 60.0
    await _log_activity(user.user_id, book_id, minutes=minutes)
    # Mirror onto the book itself for per-book stats
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$inc": {"reading_minutes": minutes}},
    )
    return {"ok": True, "minutes_added": minutes}


@api_router.post("/books/{book_id}/progress")
async def update_progress(book_id: str, body: ProgressBody, user: User = Depends(get_current_user)):
    """Persist reading progress (0.0-1.0) and last CFI for this book."""
    pct = max(0.0, min(1.0, float(body.percent)))
    update: Dict[str, Any] = {
        "progress_fraction": pct,
        "last_opened_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.cfi:
        update["progress_cfi"] = body.cfi
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True, "percent": pct}


@api_router.post("/books/{book_id}/touch")
async def touch_book(book_id: str, user: User = Depends(get_current_user)):
    """Mark the book as opened just now (used for the Continue Reading rail)."""
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"last_opened_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True}
