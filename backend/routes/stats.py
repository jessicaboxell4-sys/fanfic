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


@api_router.get("/stats/overview")
async def stats_overview(user: User = Depends(get_current_user)):
    """Aggregate reading stats for the dashboard / stats card."""
    # Field projection: only fetch what the aggregation actually reads.
    # On large libraries this cuts the response size and memory pressure
    # (e.g. cover bytes, tags, fanfic-URL arrays) by an order of magnitude.
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "progress_percent": 1, "source_meta": 1, "size_bytes": 1},
    ).to_list(5000)
    finished = sum(1 for b in books if (b.get("progress_percent") or 0) >= 0.99)
    reading = sum(1 for b in books if 0.05 <= (b.get("progress_percent") or 0) < 0.95)

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
        pages_read += pages * float(b.get("progress_percent") or 0)

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
        if (b.get("progress_percent") or 0) < 0.99:
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
        if (b.get("progress_percent") or 0) >= 0.99:
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

