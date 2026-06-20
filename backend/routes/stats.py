from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
import os
import io
import re
import json
import uuid
import zipfile
import asyncio
import tempfile
import secrets
import bcrypt
import resend
import requests as http_requests

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from deps import (
    db, app, api_router, logger, ROOT_DIR, STORAGE_DIR,
    EMERGENT_LLM_KEY, RESET_TOKEN_TTL_HOURS, RESEND_API_KEY,
    SENDER_EMAIL, FRONTEND_URL,
)
from models import User, BookOut
from auth_dep import get_current_user


# Cache the public landing-stats result for a few minutes so a viral
# moment can't hammer the books collection.  Tuple of (cached_at, payload).
_LANDING_STATS_CACHE: Optional[Dict[str, Any]] = None
_LANDING_STATS_CACHE_AT: Optional[datetime] = None
_LANDING_STATS_TTL_SECONDS = 300  # 5 minutes


@api_router.get("/landing/stats")
async def landing_public_stats():
    """Public, unauthenticated counts for the marketing landing page.

    Returns:
        {
          "books_sorted":         int,  # total books ever processed
          "fandoms_recognized":   int,  # distinct non-empty fandom values
          "as_of":                str,  # ISO timestamp when last computed
        }

    Cached for ``_LANDING_STATS_TTL_SECONDS`` seconds so the public
    Landing page can be pre-warmed under load without one query per
    visitor.  No PII leaves the DB — both numbers are scalar aggregates.
    """
    global _LANDING_STATS_CACHE, _LANDING_STATS_CACHE_AT
    now = datetime.now(timezone.utc)
    if (
        _LANDING_STATS_CACHE is not None
        and _LANDING_STATS_CACHE_AT is not None
        and (now - _LANDING_STATS_CACHE_AT).total_seconds() < _LANDING_STATS_TTL_SECONDS
    ):
        return _LANDING_STATS_CACHE
    # Exclude test-account fixtures so the public counters reflect
    # real users only.  Without this filter the homepage social
    # proof strip overstates adoption.
    from utils.test_account_filter import mongo_test_account_filter
    test_filter = mongo_test_account_filter()
    real_user_ids = [
        u["user_id"]
        async for u in db.users.find(
            {"$nor": test_filter["$or"]},
            {"_id": 0, "user_id": 1},
        )
    ]
    books_match = {"user_id": {"$in": real_user_ids}} if real_user_ids else {"_id": None}

    books_sorted = await db.books.count_documents(books_match)
    # Distinct non-empty fandoms.  ``distinct`` skips null but we still
    # filter the empty string just in case.
    fandoms_raw = await db.books.distinct(
        "fandom",
        {**books_match, "fandom": {"$nin": [None, ""]}},
    )
    fandoms_recognized = len([f for f in fandoms_raw if f and str(f).strip()])
    # Readers count for the social-proof strip.  We count *distinct
    # user_ids* in the books collection rather than total users so
    # the number reflects PEOPLE who actually built a library, not
    # abandoned-signup ghost accounts.
    readers_raw = await db.books.distinct("user_id", books_match)
    readers = len([u for u in readers_raw if u])
    payload = {
        "books_sorted": int(books_sorted),
        "fandoms_recognized": int(fandoms_recognized),
        "readers": int(readers),
        "as_of": now.isoformat(),
    }
    _LANDING_STATS_CACHE = payload
    _LANDING_STATS_CACHE_AT = now
    return payload




@api_router.get("/stats/overview")
async def stats_overview(user: User = Depends(get_current_user)):
    """Aggregate reading stats for the dashboard / stats card."""
    # Field projection: only fetch what the aggregation actually reads.
    # On large libraries this cuts the response size and memory pressure
    # (e.g. cover bytes, tags, fanfic-URL arrays) by an order of magnitude.
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "progress_fraction": 1, "source_meta": 1, "size_bytes": 1},
    ).to_list(5000)
    finished = sum(1 for b in books if (b.get("progress_fraction") or 0) >= 0.99)
    reading = sum(1 for b in books if 0.05 <= (b.get("progress_fraction") or 0) < 0.95)

    # Estimate pages: word counts when known, else size_bytes / 2500
    WORDS_PER_PAGE = 250
    BYTES_PER_PAGE = 2500
    pages_read = 0.0
    pages_total = 0.0
    for b in books:
        words = None
        if isinstance(b.get("source_meta"), dict):
            words = b["source_meta"].get("words")
        if isinstance(words, (int, float)) and words > 0:
            pages = float(words) / WORDS_PER_PAGE
        else:
            pages = max(1.0, float(b.get("size_bytes") or 0) / BYTES_PER_PAGE)
        pages_total += pages
        pages_read += pages * float(b.get("progress_fraction") or 0)

    # Streak from reading_activity collection (one doc per active day)
    activity = await db.reading_activity.find(
        {"user_id": user.user_id}, {"_id": 0, "date": 1}
    ).to_list(2000)
    from datetime import date as _date, timedelta as _td
    active_dates = set()
    for a in activity:
        try:
            y, m, d = a["date"].split("-")
            active_dates.add(_date(int(y), int(m), int(d)))
        except Exception:
            continue
    today = datetime.now(timezone.utc).date()
    streak = 0
    if today in active_dates:
        cur = today
    elif (today - _td(days=1)) in active_dates:
        cur = today - _td(days=1)
    else:
        cur = None
    while cur and cur in active_dates:
        streak += 1
        cur = cur - _td(days=1)

    return {
        "books_total": len(books),
        "books_finished": finished,
        "books_reading": reading,
        "pages_read": int(pages_read),
        "pages_total": int(pages_total),
        "reading_streak_days": streak,
        "active_days_count": len(active_dates),
        "reading_minutes_total": int(sum(float(a.get("minutes") or 0) for a in
            await db.reading_activity.find(
                {"user_id": user.user_id}, {"_id": 0, "minutes": 1}
            ).to_list(2000)
        )),
    }


@api_router.get("/stats/streak")
async def streak_only(user: User = Depends(get_current_user)):
    """Lightweight endpoint for the navbar streak badge (no aggregation cost)."""
    from datetime import date as _date, timedelta as _td
    activity = await db.reading_activity.find(
        {"user_id": user.user_id}, {"_id": 0, "date": 1, "minutes": 1}
    ).to_list(2000)
    active_dates = set()
    for a in activity:
        try:
            y, m, d = a["date"].split("-")
            active_dates.add(_date(int(y), int(m), int(d)))
        except Exception:
            continue
    today = datetime.now(timezone.utc).date()
    streak = 0
    grace_today = False  # True if user hasn't read today yet but streak is still alive from yesterday
    if today in active_dates:
        cur = today
    elif (today - timedelta(days=1)) in active_dates:
        cur = today - timedelta(days=1)
        grace_today = True
    else:
        cur = None
    while cur and cur in active_dates:
        streak += 1
        cur = cur - timedelta(days=1)
    today_minutes = 0.0
    today_key = today.isoformat()
    for a in activity:
        if a.get("date") == today_key:
            today_minutes = float(a.get("minutes") or 0)
            break
    return {
        "streak_days": streak,
        "grace_today": grace_today,
        "today_minutes": int(today_minutes),
        "today_active": (today in active_dates),
    }


@api_router.get("/stats/detailed")
async def stats_detailed(user: User = Depends(get_current_user)):
    """Deeper breakdown for the dedicated stats page:
       - daily activity (last 30 days), book count per day
       - top fandoms, top authors
       - books finished per month (last 12)
       - category breakdown
    """
    from datetime import date as _date, timedelta as _td

    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    today = datetime.now(timezone.utc).date()

    # ---- Daily activity: last 30 days ----
    cutoff = today - _td(days=29)
    activity = await db.reading_activity.find(
        {"user_id": user.user_id, "date": {"$gte": cutoff.isoformat()}},
        {"_id": 0, "date": 1, "book_ids": 1},
    ).to_list(2000)
    by_date: Dict[str, int] = {}
    for a in activity:
        # number of distinct book_ids opened that day
        by_date[a["date"]] = len(set(a.get("book_ids") or []))
    daily: List[Dict[str, Any]] = []
    for i in range(30):
        d = cutoff + _td(days=i)
        key = d.isoformat()
        daily.append({"date": key, "label": d.strftime("%b %d"), "books_opened": by_date.get(key, 0)})

    # ---- Top fandoms ----
    fandom_counts: Dict[str, int] = {}
    for b in books:
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
    top_fandoms = sorted(
        [{"name": k, "count": v} for k, v in fandom_counts.items()],
        key=lambda x: (-x["count"], x["name"]),
    )[:8]

    # ---- Top authors (exclude "Unknown") ----
    author_counts: Dict[str, int] = {}
    for b in books:
        a = (b.get("author") or "").strip()
        if a and a.lower() != "unknown":
            author_counts[a] = author_counts.get(a, 0) + 1
    top_authors = sorted(
        [{"name": k, "count": v} for k, v in author_counts.items()],
        key=lambda x: (-x["count"], x["name"]),
    )[:8]

    # ---- Books finished per month (last 12 months) ----
    finished_by_month: Dict[str, int] = {}
    for b in books:
        if (b.get("progress_fraction") or 0) < 0.99:
            continue
        ts = b.get("last_opened_at") or b.get("created_at")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) if isinstance(ts, str) else ts
        except ValueError:
            continue
        key = dt.strftime("%Y-%m")
        finished_by_month[key] = finished_by_month.get(key, 0) + 1
    # Walk back 12 months
    monthly: List[Dict[str, Any]] = []
    yy, mm = today.year, today.month
    backlog: List[tuple] = []
    for _ in range(12):
        backlog.append((yy, mm))
        mm -= 1
        if mm == 0:
            mm = 12
            yy -= 1
    for (yy_, mm_) in reversed(backlog):
        key = f"{yy_:04d}-{mm_:02d}"
        label = _date(yy_, mm_, 1).strftime("%b %Y")
        monthly.append({"month": key, "label": label, "finished": finished_by_month.get(key, 0)})

    # ---- Category breakdown ----
    cat_counts: Dict[str, int] = {}
    for b in books:
        c = b.get("category") or "Unclassified"
        cat_counts[c] = cat_counts.get(c, 0) + 1
    categories = sorted(
        [{"name": k, "count": v} for k, v in cat_counts.items()],
        key=lambda x: -x["count"],
    )

    return {
        "daily": daily,
        "top_fandoms": top_fandoms,
        "top_authors": top_authors,
        "monthly_finished": monthly,
        "categories": categories,
        "books_total": len(books),
    }


@api_router.get("/stats/export.csv")
async def stats_export_csv(user: User = Depends(get_current_user)):
    """Download author / fandom / category analytics as a single CSV file.

    Each section is separated by a blank line + header row, so it imports
    cleanly into Excel / Sheets / Numbers."""
    import csv as _csv
    from io import StringIO as _SIO

    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)

    # Aggregate
    fandom_counts: Dict[str, int] = {}
    author_counts: Dict[str, int] = {}
    cat_counts: Dict[str, int] = {}
    finished_total = 0
    minutes_total = 0.0
    for b in books:
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
        a = (b.get("author") or "").strip()
        if a:
            author_counts[a] = author_counts.get(a, 0) + 1
        c = b.get("category") or "Unclassified"
        cat_counts[c] = cat_counts.get(c, 0) + 1
        if (b.get("progress_fraction") or 0) >= 0.99:
            finished_total += 1
        minutes_total += float(b.get("reading_minutes") or 0)

    buf = _SIO()
    w = _csv.writer(buf)

    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w.writerow(["Shelfsort analytics export", today_iso])
    w.writerow([])
    w.writerow(["Summary"])
    w.writerow(["metric", "value"])
    w.writerow(["books_total", len(books)])
    w.writerow(["books_finished", finished_total])
    w.writerow(["reading_minutes_total", int(minutes_total)])
    w.writerow([])

    w.writerow(["Authors"])
    w.writerow(["author", "book_count"])
    for name, count in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        w.writerow([name, count])
    w.writerow([])

    w.writerow(["Fandoms"])
    w.writerow(["fandom", "book_count"])
    for name, count in sorted(fandom_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        w.writerow([name, count])
    w.writerow([])

    w.writerow(["Categories"])
    w.writerow(["category", "book_count"])
    for name, count in sorted(cat_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        w.writerow([name, count])

    content = buf.getvalue()
    filename = f"shelfsort-analytics-{today_iso}.csv"
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )



# ---------------------------------------------------------------------
# Reader DNA + trending re-reads  (2026-06-20)
# ---------------------------------------------------------------------
# Combined "Insights" rollup for the dashboard.  Two complementary
# datasets:
#   • Reader DNA — top 3 fandoms by book count, fanfic-vs-original
#     ratio, average word count.  A one-glance summary of "what kind
#     of reader am I?".
#   • Trending re-reads — books the user has finished AND re-opened
#     in the last 30 days.  Approximated cheaply by joining
#     ``cursor_history`` (sessions in last 30 days) with the books
#     collection (where ``progress_fraction >= 0.95``).
#
# Why combine?  Both feed a single "Insights" card on the stats /
# dashboard surface — fewer round trips, simpler client code.
@api_router.get("/insights/reader-dna")
async def reader_dna(user: User = Depends(get_current_user)):
    """Return Reader DNA + trending re-reads for the calling user.

    Cheap aggregations only — all queries run against indexed fields
    (``user_id`` is indexed on ``books`` and ``cursor_history``).
    """
    # ---- Reader DNA -----------------------------------------------
    fandoms_pipe = [
        {"$match": {
            "user_id": user.user_id,
            "fandom": {"$nin": [None, ""]},
            "category": {"$nin": ["Trash"]},
        }},
        {"$group": {"_id": "$fandom", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 3},
    ]
    top_fandoms = []
    async for r in db.books.aggregate(fandoms_pipe):
        top_fandoms.append({"fandom": r["_id"], "count": r["n"]})

    # Category split — used to derive the fanfic ratio.  We treat
    # the "Fanfiction" category as fanfic and everything else
    # (Original, Non-fiction, etc.) as original works.
    cat_pipe = [
        {"$match": {"user_id": user.user_id, "category": {"$nin": ["Trash"]}}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]
    cats: Dict[str, int] = {}
    async for r in db.books.aggregate(cat_pipe):
        cats[r["_id"] or "Uncategorized"] = r["n"]
    total_books = sum(cats.values())
    fanfic_count = cats.get("Fanfiction", 0)
    original_count = max(0, total_books - fanfic_count)
    fanfic_pct = round(100 * fanfic_count / total_books) if total_books else 0

    # Average word count — read from ``source_meta.words``, fall
    # back to size_bytes / 6 as a rough heuristic when missing.
    samples = await db.books.find(
        {"user_id": user.user_id, "category": {"$nin": ["Trash"]}},
        {"_id": 0, "source_meta": 1, "size_bytes": 1},
    ).to_list(length=5000)
    total_words = 0
    counted = 0
    for b in samples:
        words = None
        if isinstance(b.get("source_meta"), dict):
            words = b["source_meta"].get("words")
        if isinstance(words, (int, float)) and words > 0:
            total_words += int(words)
            counted += 1
        elif (b.get("size_bytes") or 0) > 0:
            total_words += int(b["size_bytes"]) // 6
            counted += 1
    avg_words = int(total_words / counted) if counted else 0

    # ---- Trending re-reads ---------------------------------------
    # Books the user has finished (>= 95% progress) AND opened a
    # session in the last 30 days.  This is a cheap approximation
    # of "re-reading" that doesn't need the expensive backward-jump
    # detector to run server-wide.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent_book_ids = await db.cursor_history.distinct(
        "book_id",
        {"user_id": user.user_id, "ts": {"$gte": cutoff}},
    )
    rereads: List[Dict[str, Any]] = []
    if recent_book_ids:
        async for b in db.books.find(
            {
                "user_id": user.user_id,
                "book_id": {"$in": recent_book_ids},
                "progress_fraction": {"$gte": 0.95},
                "category": {"$nin": ["Trash"]},
            },
            {
                "_id": 0, "book_id": 1, "title": 1, "author": 1,
                "fandom": 1, "has_cover": 1, "last_opened_at": 1,
                "progress_fraction": 1,
            },
        ):
            lo = b.get("last_opened_at")
            if hasattr(lo, "isoformat"):
                lo = lo.isoformat()
            rereads.append({
                "book_id":       b["book_id"],
                "title":         b.get("title") or "(untitled)",
                "author":        b.get("author") or "",
                "fandom":        b.get("fandom") or "",
                "has_cover":     bool(b.get("has_cover")),
                "last_opened_at": lo,
            })
    # Sort most-recently-opened first so the card surfaces the
    # comfort-reads the user actually returned to recently.
    rereads.sort(key=lambda x: x.get("last_opened_at") or "", reverse=True)
    rereads = rereads[:5]

    return {
        "top_fandoms":      top_fandoms,
        "total_books":      total_books,
        "fanfic_count":     fanfic_count,
        "original_count":   original_count,
        "fanfic_pct":       fanfic_pct,
        "avg_words":        avg_words,
        "trending_rereads": rereads,
    }
