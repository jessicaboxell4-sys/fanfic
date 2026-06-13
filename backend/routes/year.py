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
    db, api_router, logger, ROOT_DIR, STORAGE_DIR,
    EMERGENT_LLM_KEY, RESET_TOKEN_TTL_HOURS, RESEND_API_KEY,
    SENDER_EMAIL, FRONTEND_URL,
)
from models import User, BookOut
from auth_dep import get_current_user
from utils.email_log import log_email_send


async def _build_year_payload(user_doc: Dict[str, Any], year: int) -> Dict[str, Any]:
    """Return {subject, html, text, summary, has_data} for a year-recap email/page."""
    uid = user_doc["user_id"]
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    # Reading activity in this year
    activity = await db.reading_activity.find(
        {"user_id": uid, "date": {"$gte": year_start.isoformat(), "$lte": year_end.isoformat()}},
        {"_id": 0, "date": 1, "book_ids": 1},
    ).to_list(500)

    opened: set = set()
    active_dates: set = set()
    daily_counts: Dict[str, int] = {}
    monthly_opens: Dict[int, int] = {m: 0 for m in range(1, 13)}
    for a in activity:
        ds = a.get("date")
        bids = a.get("book_ids") or []
        if bids:
            active_dates.add(ds)
            daily_counts[ds] = len(set(bids))
            try:
                mm = int(ds.split("-")[1])
                monthly_opens[mm] += len(set(bids))
            except (ValueError, IndexError):
                pass
        for b in bids:
            opened.add(b)

    # Books finished this year (progress >= 99% AND last_opened_at falls in year)
    all_books = await db.books.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    finished_books: List[Dict[str, Any]] = []
    fandom_counts: Dict[str, int] = {}
    author_counts: Dict[str, int] = {}
    cat_counts: Dict[str, int] = {}
    monthly_finished: Dict[int, int] = {m: 0 for m in range(1, 13)}
    first_opened_book: Optional[Dict[str, Any]] = None
    last_opened_book: Optional[Dict[str, Any]] = None
    first_opened_ts: Optional[datetime] = None
    last_opened_ts: Optional[datetime] = None

    for b in all_books:
        if b["book_id"] not in opened:
            continue
        last_open = b.get("last_opened_at")
        try:
            lo_dt = datetime.fromisoformat(last_open.replace("Z", "+00:00")) if isinstance(last_open, str) else last_open
        except (ValueError, AttributeError):
            lo_dt = None
        # first/last opened tracking — best-effort using last_opened_at
        if lo_dt and year_start <= lo_dt.date() <= year_end:
            if first_opened_ts is None or lo_dt < first_opened_ts:
                first_opened_ts = lo_dt
                first_opened_book = b
            if last_opened_ts is None or lo_dt > last_opened_ts:
                last_opened_ts = lo_dt
                last_opened_book = b
        # finished this year?
        if (b.get("progress_percent") or 0) >= 0.99 and lo_dt and year_start <= lo_dt.date() <= year_end:
            finished_books.append(b)
            monthly_finished[lo_dt.month] += 1
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
        a_name = (b.get("author") or "").strip()
        if a_name and a_name.lower() != "unknown":
            author_counts[a_name] = author_counts.get(a_name, 0) + 1
        c = b.get("category") or "Unclassified"
        cat_counts[c] = cat_counts.get(c, 0) + 1

    # Best month — by books opened
    best_month_idx = max(monthly_opens, key=lambda m: monthly_opens[m]) if any(monthly_opens.values()) else 0
    month_names = ["", "January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]
    best_month = {"name": month_names[best_month_idx], "opens": monthly_opens.get(best_month_idx, 0)} if best_month_idx else None

    # Longest streak inside this year
    sorted_dates = sorted(active_dates)
    longest = 0
    cur = 0
    prev_d: Optional[date] = None
    for ds in sorted_dates:
        try:
            d = date.fromisoformat(ds)
        except ValueError:
            continue
        if prev_d is None or (d - prev_d).days == 1:
            cur += 1
        else:
            cur = 1
        if cur > longest:
            longest = cur
        prev_d = d

    # Approximate pages read
    pages = 0
    for b in all_books:
        if b["book_id"] in opened:
            words = b.get("words") or 0
            total_pages = max(1, words // 250) if words else 0
            pages += int(total_pages * float(b.get("progress_percent") or 0))

    top_fandoms = sorted(
        [{"name": k, "count": v} for k, v in fandom_counts.items()],
        key=lambda x: -x["count"],
    )[:5]
    top_authors = sorted(
        [{"name": k, "count": v} for k, v in author_counts.items()],
        key=lambda x: -x["count"],
    )[:5]
    categories = sorted(
        [{"name": k, "count": v} for k, v in cat_counts.items()],
        key=lambda x: -x["count"],
    )

    monthly_chart = [
        {"month": m, "label": month_names[m][:3], "opens": monthly_opens[m], "finished": monthly_finished[m]}
        for m in range(1, 13)
    ]

    summary = {
        "year": year,
        "books_opened": len(opened),
        "books_finished": len(finished_books),
        "active_days": len(active_dates),
        "longest_streak": longest,
        "pages_read": pages,
        "top_fandoms": top_fandoms,
        "top_authors": top_authors,
        "categories": categories,
        "monthly": monthly_chart,
        "best_month": best_month,
        "first_book": {
            "title": first_opened_book.get("title") if first_opened_book else None,
            "author": first_opened_book.get("author") if first_opened_book else None,
            "book_id": first_opened_book.get("book_id") if first_opened_book else None,
            "date": first_opened_ts.strftime("%b %d") if first_opened_ts else None,
        } if first_opened_book else None,
        "last_book": {
            "title": last_opened_book.get("title") if last_opened_book else None,
            "author": last_opened_book.get("author") if last_opened_book else None,
            "book_id": last_opened_book.get("book_id") if last_opened_book else None,
            "date": last_opened_ts.strftime("%b %d") if last_opened_ts else None,
        } if last_opened_book else None,
    }
    has_data = len(opened) > 0 or len(finished_books) > 0

    # Build email HTML
    base = FRONTEND_URL or os.environ.get("REACT_APP_BACKEND_URL", "")
    page_url = f"{base}/library/year/{year}" if base else f"/library/year/{year}"

    top_fandom_rows = ""
    max_f = max([f["count"] for f in top_fandoms], default=1)
    for f in top_fandoms:
        pct = max(8, int((f["count"] / max_f) * 100))
        top_fandom_rows += (
            f'<tr><td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;">'
            f'<table width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td width="50%" style="font-size:13px;color:#2C2C2C;">{f["name"]}</td>'
            f'<td width="40%"><div style="background:#F5F3EC;border-radius:4px;height:8px;">'
            f'<div style="background:#E07A5F;height:8px;border-radius:4px;width:{pct}%;"></div></div></td>'
            f'<td width="10%" style="text-align:right;font-size:13px;color:#6B705C;font-weight:600;">{f["count"]}</td>'
            f'</tr></table></td></tr>'
        )
    top_fandoms_html = (
        f'<div style="margin-top:24px;"><p style="margin:0 0 8px 0;font-size:11px;letter-spacing:2px;color:#3A5A40;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Top fandoms</p>'
        f'<table width="100%" cellpadding="0" cellspacing="0">{top_fandom_rows}</table></div>'
        if top_fandoms else ""
    )

    top_authors_html = ""
    if top_authors:
        rows = ""
        max_a = max([a["count"] for a in top_authors], default=1)
        for a in top_authors:
            pct = max(8, int((a["count"] / max_a) * 100))
            rows += (
                f'<tr><td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;">'
                f'<table width="100%" cellpadding="0" cellspacing="0"><tr>'
                f'<td width="50%" style="font-size:13px;color:#2C2C2C;">{a["name"]}</td>'
                f'<td width="40%"><div style="background:#F5F3EC;border-radius:4px;height:8px;">'
                f'<div style="background:#3A5A40;height:8px;border-radius:4px;width:{pct}%;"></div></div></td>'
                f'<td width="10%" style="text-align:right;font-size:13px;color:#6B705C;font-weight:600;">{a["count"]}</td>'
                f'</tr></table></td></tr>'
            )
        top_authors_html = (
            f'<div style="margin-top:24px;"><p style="margin:0 0 8px 0;font-size:11px;letter-spacing:2px;color:#3A5A40;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Most-read authors</p>'
            f'<table width="100%" cellpadding="0" cellspacing="0">{rows}</table></div>'
        )

    best_month_html = (
        f'<p style="margin:6px 0 0 0;font-size:14px;color:#6B705C;">Your best month was <strong style="color:#3A5A40;">{best_month["name"]}</strong> with {best_month["opens"]} book opens.</p>'
        if best_month else ""
    )

    bookends_html = ""
    if first_opened_book or last_opened_book:
        f_part = (
            f'<p style="margin:0;font-size:13px;color:#2C2C2C;"><strong>First book of the year:</strong> {first_opened_book.get("title", "—")}<br><span style="color:#6B705C;font-size:12px;">{first_opened_ts.strftime("%B %d") if first_opened_ts else ""}</span></p>'
            if first_opened_book else ""
        )
        l_part = (
            f'<p style="margin:14px 0 0 0;font-size:13px;color:#2C2C2C;"><strong>Last book of the year:</strong> {last_opened_book.get("title", "—")}<br><span style="color:#6B705C;font-size:12px;">{last_opened_ts.strftime("%B %d") if last_opened_ts else ""}</span></p>'
            if last_opened_book and (not first_opened_book or last_opened_book.get("book_id") != first_opened_book.get("book_id")) else ""
        )
        bookends_html = (
            f'<div style="margin-top:32px;padding:20px;background:#FDF3E1;border-radius:12px;font-family:Helvetica,Arial,sans-serif;">'
            f'<p style="margin:0 0 10px 0;font-size:11px;letter-spacing:2px;color:#B87A00;font-weight:bold;text-transform:uppercase;">Bookends</p>'
            f'{f_part}{l_part}</div>'
        )

    if has_data:
        subject = f"Your {year} in books — {len(opened)} read, {longest}-day streak"
    else:
        subject = f"Your {year} in books"

    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 0;font-family:Georgia,serif;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#E07A5F;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Shelfsort · year in books</p>
            <h1 style="margin:0 0 8px 0;color:#2C2C2C;font-size:38px;line-height:1.1;font-family:Georgia,serif;">Hi {name},</h1>
            <h2 style="margin:0 0 24px 0;color:#3A5A40;font-size:22px;font-family:Georgia,serif;font-style:italic;font-weight:normal;">Here's your {year} in books.</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;font-family:Helvetica,Arial,sans-serif;">
              <tr>
                <td width="33%" style="text-align:center;padding:14px;">
                  <p style="margin:0;font-size:38px;color:#E07A5F;font-family:Georgia,serif;line-height:1;">{len(opened)}</p>
                  <p style="margin:6px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Books opened</p>
                </td>
                <td width="33%" style="text-align:center;padding:14px;">
                  <p style="margin:0;font-size:38px;color:#3A5A40;font-family:Georgia,serif;line-height:1;">{len(finished_books)}</p>
                  <p style="margin:6px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Finished</p>
                </td>
                <td width="33%" style="text-align:center;padding:14px;">
                  <p style="margin:0;font-size:38px;color:#B87A00;font-family:Georgia,serif;line-height:1;">{longest}</p>
                  <p style="margin:6px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Longest streak</p>
                </td>
              </tr>
            </table>
            {best_month_html}
            {top_fandoms_html}
            {top_authors_html}
            {bookends_html}
            <p style="margin:32px 0 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              <a href="{page_url}" style="display:inline-block;background:#E07A5F;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:600;font-size:14px;">See the full recap</a>
            </p>
            <p style="margin:28px 0 0 0;color:#6B705C;font-size:11px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              You're receiving this because you turned on the weekly digest in Shelfsort. We send one Year in Books email per year, in early January.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

    text_lines = [
        f"Hi {name},",
        f"Your {year} in books:",
        f"  - Books opened: {len(opened)}",
        f"  - Finished: {len(finished_books)}",
        f"  - Active days: {len(active_dates)}",
        f"  - Longest streak: {longest} days",
        f"  - Pages read (est.): {pages}",
    ]
    if best_month:
        text_lines.append(f"  - Best month: {best_month['name']} ({best_month['opens']} opens)")
    if top_fandoms:
        text_lines.append("")
        text_lines.append("Top fandoms:")
        for f in top_fandoms:
            text_lines.append(f"  - {f['name']} ({f['count']})")
    if top_authors:
        text_lines.append("")
        text_lines.append("Most-read authors:")
        for a in top_authors:
            text_lines.append(f"  - {a['name']} ({a['count']})")
    if first_opened_book:
        text_lines.append("")
        text_lines.append(f"First book: {first_opened_book.get('title')} ({first_opened_ts.strftime('%b %d') if first_opened_ts else ''})")
    if last_opened_book and (not first_opened_book or last_opened_book.get('book_id') != first_opened_book.get('book_id')):
        text_lines.append(f"Last book: {last_opened_book.get('title')} ({last_opened_ts.strftime('%b %d') if last_opened_ts else ''})")
    text_lines.append("")
    text_lines.append(f"Full recap: {page_url}")
    text = "\n".join(text_lines)

    return {"subject": subject, "html": html, "text": text, "summary": summary, "has_data": has_data}


async def _send_year_email(user_doc: Dict[str, Any], year: int) -> Dict[str, Any]:
    payload = await _build_year_payload(user_doc, year)
    to_email = user_doc["email"]
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent year-in-books to %s", to_email)
        return {"delivered": False, "logged": True, "summary": payload["summary"], "has_data": payload["has_data"]}
    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": payload["subject"],
            "html": payload["html"],
            "text": payload["text"],
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("year_in_books", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id"), "summary": payload["summary"], "has_data": payload["has_data"]}
    except Exception as e:
        logger.error("Year-in-books Resend send failed for %s: %s", to_email, e)
        await log_email_send("year_in_books", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e), "summary": payload["summary"], "has_data": payload["has_data"]}


@api_router.get("/year-in-books/{year}")
async def get_year_in_books(year: int, user: User = Depends(get_current_user)):
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Year out of range")
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    payload = await _build_year_payload(user_doc, year)
    return {"summary": payload["summary"], "has_data": payload["has_data"]}


@api_router.post("/year-in-books/{year}/email")
async def send_year_in_books_email(year: int, user: User = Depends(get_current_user)):
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Year out of range")
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return await _send_year_email(user_doc, year)


# ---- Public sharing ----
def _share_public_url(token: str) -> str:
    base = FRONTEND_URL or os.environ.get("REACT_APP_BACKEND_URL", "")
    return f"{base}/share/yib/{token}" if base else f"/share/yib/{token}"


@api_router.get("/year-in-books/{year}/share")
async def get_year_share(year: int, user: User = Depends(get_current_user)):
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Year out of range")
    doc = await db.year_in_books_shares.find_one({"user_id": user.user_id, "year": year})
    if not doc:
        return {"shared": False, "token": None, "url": None, "view_count": 0, "created_at": None, "last_viewed_at": None}
    return {
        "shared": True,
        "token": doc["share_token"],
        "url": _share_public_url(doc["share_token"]),
        "view_count": int(doc.get("view_count") or 0),
        "created_at": doc.get("created_at"),
        "last_viewed_at": doc.get("last_viewed_at"),
    }


@api_router.post("/year-in-books/{year}/share")
async def create_year_share(year: int, user: User = Depends(get_current_user)):
    """Create-or-return the share token for this user+year (idempotent)."""
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Year out of range")
    existing = await db.year_in_books_shares.find_one({"user_id": user.user_id, "year": year})
    if existing:
        return {
            "shared": True,
            "token": existing["share_token"],
            "url": _share_public_url(existing["share_token"]),
            "view_count": int(existing.get("view_count") or 0),
            "created_at": existing.get("created_at"),
        }
    token = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc).isoformat()
    await db.year_in_books_shares.insert_one({
        "share_token": token,
        "user_id": user.user_id,
        "year": year,
        "created_at": now,
        "view_count": 0,
        "last_viewed_at": None,
    })
    return {
        "shared": True,
        "token": token,
        "url": _share_public_url(token),
        "view_count": 0,
        "created_at": now,
    }


@api_router.delete("/year-in-books/{year}/share")
async def revoke_year_share(year: int, user: User = Depends(get_current_user)):
    if year < 1900 or year > 2200:
        raise HTTPException(status_code=400, detail="Year out of range")
    result = await db.year_in_books_shares.delete_one({"user_id": user.user_id, "year": year})
    return {"revoked": result.deleted_count > 0}


# Public endpoint — no auth required
@api_router.get("/public/year/{token}")
async def get_public_year(token: str):
    doc = await db.year_in_books_shares.find_one({"share_token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    user_doc = await db.users.find_one({"user_id": doc["user_id"]})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    payload = await _build_year_payload(user_doc, int(doc["year"]))
    # Increment view counter (fire & forget)
    try:
        await db.year_in_books_shares.update_one(
            {"share_token": token},
            {
                "$inc": {"view_count": 1},
                "$set": {"last_viewed_at": datetime.now(timezone.utc).isoformat()},
            },
        )
    except Exception:
        pass
    # Sanitize: don't expose email or last_book/first_book book_ids
    summary = dict(payload["summary"])
    for k in ("first_book", "last_book"):
        v = summary.get(k)
        if v:
            v = dict(v)
            v.pop("book_id", None)
            summary[k] = v
    display_name = (user_doc.get("name") or "").strip() or user_doc.get("email", "").split("@")[0]
    return {
        "summary": summary,
        "has_data": payload["has_data"],
        "display_name": display_name,
        "year": int(doc["year"]),
    }

