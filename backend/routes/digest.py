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
from utils.email_log import log_email_send
from routes.year import _send_year_email
from routes.books import _probe_fanfic_now, _sweep_user_unavailable, _fanfic_status_cache
from routes.trash import sweep_expired_trash


# ============================================================
# WEEKLY READING DIGEST (Resend + APScheduler)
# ============================================================
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: E402

DEFAULT_DIGEST = {
    "enabled": False,
    "day_of_week": 6,   # 0=Mon ... 6=Sun (Python weekday convention)
    "hour": 8,          # 0..23, UTC
    "last_sent_at": None,
}
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class DigestSettingsBody(BaseModel):
    enabled: Optional[bool] = None
    day_of_week: Optional[int] = None  # 0..6
    hour: Optional[int] = None         # 0..23


def _get_digest_prefs(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(DEFAULT_DIGEST)
    d.update(user_doc.get("digest") or {})
    return d


async def _build_digest_payload(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return {subject, html, text, summary} for the user's last-7-days reading."""
    uid = user_doc["user_id"]
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]

    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=6)
    iso_from = week_start.isoformat()
    iso_to = today.isoformat()

    # Reading activity (last 7 days)
    activity = await db.reading_activity.find(
        {"user_id": uid, "date": {"$gte": iso_from, "$lte": iso_to}},
        {"_id": 0, "date": 1, "book_ids": 1},
    ).to_list(100)

    opened_book_ids: set = set()
    active_days = 0
    for a in activity:
        bids = a.get("book_ids") or []
        if bids:
            active_days += 1
            for b in bids:
                opened_book_ids.add(b)

    # Fetch books opened this week and overall library
    books_this_week = await db.books.find(
        {"user_id": uid, "book_id": {"$in": list(opened_book_ids)}},
        {"_id": 0},
    ).to_list(200) if opened_book_ids else []

    all_books = await db.books.find({"user_id": uid}, {"_id": 0}).to_list(5000)

    # Stats for this week
    finished_this_week = 0
    pages_this_week = 0
    fandom_counts: Dict[str, int] = {}
    for b in books_this_week:
        # finished this week heuristic: progress_percent >= 0.99 AND last_opened within window
        last_open = b.get("last_opened_at")
        try:
            lo_dt = datetime.fromisoformat(last_open.replace("Z", "+00:00")) if isinstance(last_open, str) else last_open
        except (ValueError, AttributeError):
            lo_dt = None
        if (b.get("progress_percent") or 0) >= 0.99 and lo_dt and lo_dt.date() >= week_start:
            finished_this_week += 1
        # Pages this week: approximate as (current_progress - 0) * total_pages distributed across active days
        # We don't have per-day progress deltas, so use a simpler heuristic:
        # estimate pages opened this week as len(text or chapters) * progress_percent for newly opened
        total = b.get("words") or 0
        pages = max(1, total // 250) if total else 0
        pct = float(b.get("progress_percent") or 0)
        pages_this_week += int(pages * pct)
        f = b.get("fandom")
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1

    top_fandom = sorted(fandom_counts.items(), key=lambda x: -x[1])[0][0] if fandom_counts else None

    # Books in progress >50% but not opened in the last 3 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=3)
    nudges: List[Dict[str, Any]] = []
    for b in all_books:
        pct = float(b.get("progress_percent") or 0)
        if 0.5 <= pct < 0.99:
            last_open = b.get("last_opened_at")
            try:
                lo_dt = datetime.fromisoformat(last_open.replace("Z", "+00:00")) if isinstance(last_open, str) else last_open
            except (ValueError, AttributeError):
                lo_dt = None
            if not lo_dt or lo_dt < cutoff:
                nudges.append({"title": b.get("title") or "Untitled",
                               "author": b.get("author") or "",
                               "progress": int(pct * 100),
                               "book_id": b["book_id"]})
    # Top 3 nudges by progress (closest to done first)
    nudges = sorted(nudges, key=lambda x: -x["progress"])[:3]

    # Build URLs
    base = FRONTEND_URL or os.environ.get("REACT_APP_BACKEND_URL", "")
    library_url = f"{base}/library" if base else "/library"
    stats_url = f"{base}/library/stats" if base else "/library/stats"

    # Summary line + subject
    if opened_book_ids:
        subject = f"Shelfsort weekly: {len(opened_book_ids)} book{'s' if len(opened_book_ids) != 1 else ''}, {active_days}/7 active days"
    else:
        subject = "Shelfsort weekly: a quiet reading week"
    summary = {
        "books_opened": len(opened_book_ids),
        "active_days": active_days,
        "finished_this_week": finished_this_week,
        "pages_this_week": pages_this_week,
        "top_fandom": top_fandom,
        "nudges": nudges,
        "library_total": len(all_books),
        "week_start": iso_from,
        "week_end": iso_to,
    }

    nudge_rows_html = ""
    for n in nudges:
        nudge_rows_html += (
            f'<tr><td style="padding:10px 0;border-top:1px solid #E8E6E1;">'
            f'<p style="margin:0;font-size:14px;color:#2C2C2C;font-weight:600;">{n["title"]}</p>'
            f'<p style="margin:2px 0 0 0;font-size:12px;color:#6B705C;">{n["author"]} · {n["progress"]}% done</p>'
            f'</td></tr>'
        )

    nudges_block_html = ""
    if nudges:
        nudges_block_html = (
            '<div style="margin-top:32px;background:#FDF3E1;padding:20px;border-radius:12px;">'
            '<p style="margin:0 0 8px 0;font-size:11px;letter-spacing:2px;color:#B87A00;font-weight:bold;text-transform:uppercase;">Don\'t forget…</p>'
            '<p style="margin:0 0 12px 0;font-size:14px;color:#2C2C2C;">Books you started but haven\'t finished:</p>'
            '<table width="100%" cellpadding="0" cellspacing="0">' + nudge_rows_html + '</table>'
            '</div>'
        )

    quiet_block_html = ""
    if not opened_book_ids:
        quiet_block_html = (
            '<div style="margin:24px 0;padding:20px;background:#F5F3EC;border-radius:12px;text-align:center;">'
            f'<p style="margin:0 0 8px 0;font-size:15px;color:#2C2C2C;">A quiet week — that\'s okay.</p>'
            f'<p style="margin:0;font-size:13px;color:#6B705C;">Your library has {len(all_books)} book{"s" if len(all_books) != 1 else ""} waiting.</p>'
            '</div>'
        )

    top_fandom_html = (
        f'<p style="margin:8px 0 0 0;font-size:14px;color:#6B705C;">'
        f'Most-opened fandom: <strong style="color:#E07A5F;">{top_fandom}</strong></p>'
        if top_fandom else ""
    )

    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 0;font-family:Georgia,serif;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#6B46C1;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Shelfsort · weekly digest</p>
            <h1 style="margin:0 0 8px 0;color:#2C2C2C;font-size:30px;line-height:1.15;">Hi {name},</h1>
            <p style="margin:0 0 24px 0;color:#6B705C;font-size:15px;line-height:1.6;">
              Here's how your reading week ({week_start.strftime('%b %d')} – {today.strftime('%b %d')}) went.
            </p>
            {quiet_block_html}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 8px 0;font-family:Helvetica,Arial,sans-serif;">
              <tr>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#E07A5F;font-family:Georgia,serif;line-height:1;">{len(opened_book_ids)}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Books opened</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#6B46C1;font-family:Georgia,serif;line-height:1;">{active_days}<span style="font-size:18px;color:#6B705C;">/7</span></p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Active days</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#B87A00;font-family:Georgia,serif;line-height:1;">{finished_this_week}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Finished</p>
                </td>
              </tr>
            </table>
            {top_fandom_html}
            {nudges_block_html}
            <p style="margin:32px 0 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              <a href="{library_url}" style="display:inline-block;background:#E07A5F;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;font-size:14px;">Open your library</a>
              <a href="{stats_url}" style="display:inline-block;margin-left:8px;background:#FFFFFF;color:#6B46C1;text-decoration:none;padding:13px 22px;border:1px solid #6B46C1;border-radius:10px;font-weight:600;font-size:14px;">See full stats</a>
            </p>
            <p style="margin:28px 0 0 0;color:#6B705C;font-size:11px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              You're receiving this because you turned on the weekly digest in Shelfsort.
              Change your settings any time in <a href="{base}/account" style="color:#6B46C1;">your account</a>.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

    text_lines = [
        f"Hi {name},",
        "",
        f"Your Shelfsort week ({week_start.strftime('%b %d')} – {today.strftime('%b %d')}):",
        f"  - Books opened: {len(opened_book_ids)}",
        f"  - Active days: {active_days}/7",
        f"  - Finished: {finished_this_week}",
    ]
    if top_fandom:
        text_lines.append(f"  - Most-opened fandom: {top_fandom}")
    if nudges:
        text_lines.append("")
        text_lines.append("Books you started but haven't finished:")
        for n in nudges:
            text_lines.append(f"  - {n['title']} by {n['author']} ({n['progress']}% done)")
    text_lines.append("")
    text_lines.append(f"Open your library: {library_url}")
    text_lines.append(f"Full stats: {stats_url}")
    text_lines.append("")
    text_lines.append("— Shelfsort")
    text = "\n".join(text_lines)

    return {"subject": subject, "html": html, "text": text, "summary": summary}


async def _send_digest_email(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    payload = await _build_digest_payload(user_doc)
    to_email = user_doc["email"]
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent digest to %s", to_email)
        return {"delivered": False, "logged": True, "summary": payload["summary"]}
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
        await log_email_send("digest", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id"), "summary": payload["summary"]}
    except Exception as e:
        logger.error("Digest Resend send failed for %s: %s", to_email, e)
        await log_email_send("digest", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e), "summary": payload["summary"]}


# ---- Settings endpoints ----
@api_router.get("/user/digest-settings")
async def get_digest_settings(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_digest_prefs(user_doc)
    last_sent = prefs.get("last_sent_at")
    return {
        "enabled": bool(prefs.get("enabled")),
        "day_of_week": int(prefs.get("day_of_week", 6)),
        "hour": int(prefs.get("hour", 8)),
        "last_sent_at": last_sent.isoformat() if isinstance(last_sent, datetime) else last_sent,
        "email_configured": bool(RESEND_API_KEY),
    }


@api_router.put("/user/digest-settings")
async def update_digest_settings(body: DigestSettingsBody, user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_digest_prefs(user_doc)
    if body.enabled is not None:
        prefs["enabled"] = bool(body.enabled)
    if body.day_of_week is not None:
        if not (0 <= int(body.day_of_week) <= 6):
            raise HTTPException(status_code=400, detail="day_of_week must be between 0 (Monday) and 6 (Sunday)")
        prefs["day_of_week"] = int(body.day_of_week)
    if body.hour is not None:
        if not (0 <= int(body.hour) <= 23):
            raise HTTPException(status_code=400, detail="hour must be between 0 and 23")
        prefs["hour"] = int(body.hour)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"digest": prefs}},
    )
    return {
        "enabled": prefs["enabled"],
        "day_of_week": prefs["day_of_week"],
        "hour": prefs["hour"],
    }


@api_router.post("/user/digest-preview")
async def send_digest_preview(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    result = await _send_digest_email(user_doc)
    return result


@api_router.post("/user/email-test")
async def send_email_test(user: User = Depends(get_current_user)):
    """Sends a tiny "delivery is working" email. Useful for confirming the
    Resend pipeline without having to wait for a digest cron or have any
    refreshed books on file."""
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    to_email = user_doc.get("email", "")
    if not to_email:
        raise HTTPException(status_code=400, detail="Your account has no email on file")

    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent test email to %s", to_email)
        return {"delivered": False, "logged": True, "to": to_email}

    display_name = user_doc.get("name") or to_email.split("@")[0]
    subject = "Shelfsort — delivery test ✉️"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FBF7EE; border-radius: 12px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #FDF3E1; border: 1px solid rgba(184,122,0,0.3); border-radius: 999px; margin-bottom: 16px; font-size: 12px; font-weight: 600; color: #B87A00; letter-spacing: 0.5px;">
        ✓ DELIVERY TEST
      </div>
      <h1 style="color: #2C2C2C; margin: 0 0 12px; font-size: 22px; font-family: Georgia, serif;">Hi {display_name},</h1>
      <p style="color: #4A4A4A; line-height: 1.6; font-size: 15px; margin: 0 0 16px;">
        This is a one-shot test email from Shelfsort. If you are reading this, your Resend
        delivery pipeline is configured correctly and the following channels will now reach
        your inbox at <strong>{to_email}</strong>:
      </p>
      <ul style="color: #4A4A4A; line-height: 1.9; font-size: 14px; padding-left: 18px;">
        <li><strong>Weekly digest</strong> &mdash; opens, top fandom, current bookmark</li>
        <li><strong>Fanfic updates</strong> &mdash; new chapters on watched stories</li>
        <li><strong>Account deletion reminders</strong> &mdash; 7 days before final purge</li>
      </ul>
      <p style="color: #6B705C; font-size: 12px; margin: 28px 0 0; padding-top: 16px; border-top: 1px solid #E8E6E1;">
        You triggered this from Account &rarr; Email preferences. No further action needed.
      </p>
    </div>
    """
    text = (
        f"Hi {display_name},\n\n"
        f"This is a test email from Shelfsort. If you're reading this, delivery to {to_email} "
        f"is working. Weekly digests, fanfic updates, and account-deletion reminders will all "
        f"arrive here from now on.\n\n— Shelfsort"
    )

    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("test_email", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id"), "to": to_email}
    except Exception as e:
        logger.error("Test email Resend send failed for %s: %s", to_email, e)
        await log_email_send("test_email", to_email, "error", error=str(e))
        raise HTTPException(status_code=502, detail=f"Resend rejected the send: {e}")


# ---- Scheduler tick ----
_scheduler: Optional[AsyncIOScheduler] = None


async def _digest_tick():
    """Runs every hour at minute 0. Find users due for a digest and send.

    On January 1 at the user's chosen hour, additionally send a "Year in Books"
    recap for the previous year (only if digest is enabled and the recap has
    any reading data).
    """
    now = datetime.now(timezone.utc)
    weekday = now.weekday()
    hour = now.hour
    # Find users with matching schedule
    cursor = db.users.find({
        "digest.enabled": True,
        "digest.day_of_week": weekday,
        "digest.hour": hour,
    })
    cooldown = now - timedelta(days=6)  # avoid double-sending within the same week
    sent = 0
    async for user_doc in cursor:
        prefs = _get_digest_prefs(user_doc)
        last_sent = prefs.get("last_sent_at")
        try:
            ls_dt = datetime.fromisoformat(last_sent.replace("Z", "+00:00")) if isinstance(last_sent, str) else last_sent
        except (ValueError, AttributeError):
            ls_dt = None
        if ls_dt and ls_dt > cooldown:
            continue
        try:
            await _send_digest_email(user_doc)
            prefs["last_sent_at"] = now.isoformat()
            await db.users.update_one(
                {"user_id": user_doc["user_id"]},
                {"$set": {"digest": prefs}},
            )
            sent += 1
        except Exception as e:
            logger.error("Digest send failed for %s: %s", user_doc.get("email"), e)
    if sent:
        logger.info("Weekly digest tick: sent %d emails (weekday=%d, hour=%d)", sent, weekday, hour)

    # Year-in-Books: January 1, user's chosen hour.
    if now.month == 1 and now.day == 1:
        prev_year = now.year - 1
        year_cursor = db.users.find({
            "digest.enabled": True,
            "digest.hour": hour,
            "digest.last_year_sent": {"$ne": prev_year},
        })
        year_sent = 0
        async for user_doc in year_cursor:
            try:
                result = await _send_year_email(user_doc, prev_year)
                if result.get("has_data"):
                    await db.users.update_one(
                        {"user_id": user_doc["user_id"]},
                        {"$set": {"digest.last_year_sent": prev_year}},
                    )
                    year_sent += 1
            except Exception as e:
                logger.error("Year-in-books send failed for %s: %s", user_doc.get("email"), e)
        if year_sent:
            logger.info("Year-in-books tick: sent %d emails for %d (hour=%d)", year_sent, prev_year, hour)

    # FanFicFare auto-sweep: if status flips down->up, retry every user's flagged books.
    try:
        previous_ok = _fanfic_status_cache.get("ok")
        ok, detail = await _probe_fanfic_now()
        _fanfic_status_cache["previous_ok"] = previous_ok
        _fanfic_status_cache["checked_at"] = now
        _fanfic_status_cache["ok"] = ok
        _fanfic_status_cache["detail"] = detail
        if ok and previous_ok is False:
            logger.info("Fanfic source recovered (was down, now up). Auto-sweeping unavailable books...")
            # Find every user with at least one flagged book
            user_ids = await db.books.distinct(
                "user_id", {"unavailable": True}
            )
            for uid in user_ids:
                try:
                    result = await _sweep_user_unavailable(uid)
                    if result["refreshed"]:
                        logger.info(
                            "Auto-sweep: user=%s refreshed=%d still_unavailable=%d",
                            uid, result["refreshed"], result["still_unavailable"],
                        )
                except Exception as e:
                    logger.warning("Auto-sweep failed for user %s: %s", uid, e)
    except Exception as e:
        logger.warning("Fanfic source recovery probe failed: %s", e)

    # Trash sweep: hard-delete books whose 30-day grace window expired
    try:
        removed = await sweep_expired_trash()
        if removed:
            logger.info("Trash sweep: hard-deleted %d expired book(s)", removed)
    except Exception as e:
        logger.warning("Trash sweep failed: %s", e)

    # "From friends" weekly notification digest — fires once per ISO-week
    # for every user, gated by their friends_finished.enabled flag (default
    # True). Independent of the email digest schedule: we fire on a fixed
    # Sunday at 18:00 UTC sweep so it lands at a quiet, predictable time.
    try:
        if weekday == 6 and hour == 18:
            from routes.recommendations import maybe_send_friends_finished_digest  # noqa: WPS433
            ff_cursor = db.users.find(
                {"$or": [
                    {"friends_finished.enabled": True},
                    {"friends_finished.enabled": {"$exists": False}},
                ]},
                {"_id": 0},
            )
            ff_sent = 0
            async for ud in ff_cursor:
                try:
                    if await maybe_send_friends_finished_digest(ud):
                        ff_sent += 1
                except Exception as e:
                    logger.warning("From-friends digest failed for %s: %s", ud.get("email"), e)
            if ff_sent:
                logger.info("From-friends digest tick: notified %d user(s)", ff_sent)
    except Exception as e:
        logger.warning("From-friends digest sweep failed: %s", e)



# ============================================================
# FANFIC UPDATE DIGEST (sent after refresh-all runs)
# ============================================================

class UpdateEmailBody(BaseModel):
    enabled: Optional[bool] = None


def _get_update_email_prefs(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    return {"enabled": bool((user_doc.get("update_email") or {}).get("enabled", False))}


async def _build_update_digest_payload(
    user_doc: Dict[str, Any],
    new_book_ids: List[str],
) -> Optional[Dict[str, Any]]:
    """Build a 'your fics just updated' email payload. Returns None if no eligible books."""
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]
    books = await db.books.find(
        {"user_id": user_doc["user_id"], "book_id": {"$in": new_book_ids}},
        {"_id": 0},
    ).to_list(len(new_book_ids))
    # Sort: biggest "new chapters" first, then by most-recent refresh
    books.sort(
        key=lambda b: (
            -(b.get("refresh_summary") or {}).get("chapters_added", 0),
            -(b.get("refresh_summary") or {}).get("chapters_changed", 0),
            b.get("last_refreshed_at", ""),
        )
    )
    if not books:
        return None

    base = (FRONTEND_URL or "").rstrip("/")
    total_added = sum((b.get("refresh_summary") or {}).get("chapters_added", 0) for b in books)
    total_changed = sum((b.get("refresh_summary") or {}).get("chapters_changed", 0) for b in books)

    headline = f"{len(books)} fic{'s' if len(books) != 1 else ''} updated"
    if total_added > 0:
        headline += f" · +{total_added} new chapter{'s' if total_added != 1 else ''}"
    subject = f"Shelfsort · {headline}"

    rows_html: List[str] = []
    for b in books:
        rs = b.get("refresh_summary") or {}
        added = rs.get("chapters_added", 0)
        changed = rs.get("chapters_changed", 0)
        compare_url = f"{base}/book/{b['book_id']}/compare"
        pill_parts: List[str] = []
        if added > 0:
            pill_parts.append(
                f'<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#EDE7FB;color:#6B46C1;font-size:11px;font-weight:600;margin-right:6px;">+{added} new</span>'
            )
        if changed > 0:
            pill_parts.append(
                f'<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#FDF3E1;color:#B87A00;font-size:11px;font-weight:600;margin-right:6px;">{changed} edited</span>'
            )
        if not pill_parts:
            pill_parts.append(
                '<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#F1EFE8;color:#6E6E6E;font-size:11px;font-weight:600;margin-right:6px;">Refreshed</span>'
            )
        fandom_html = f' · {b.get("fandom")}' if b.get("fandom") else ""
        rows_html.append(f"""
            <tr><td style="padding:14px 0;border-bottom:1px solid #F1EFE8;">
              <p style="margin:0 0 4px 0;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">{b.get("title","")}</p>
              <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#6B705C;">{b.get("author","")}{fandom_html}</p>
              <p style="margin:0 0 8px 0;">{"".join(pill_parts)}</p>
              <a href="{compare_url}" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#6B46C1;text-decoration:underline;font-weight:600;">See what changed →</a>
            </td></tr>
        """)
    rows_html_str = "".join(rows_html)

    library_url = f"{base}/library"

    html = f"""
    <!DOCTYPE html>
    <html><body style="margin:0;padding:0;background:#FBF7EE;font-family:Helvetica,Arial,sans-serif;color:#2C2C2C;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7EE;padding:32px 16px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#6B46C1;font-weight:bold;text-transform:uppercase;">Shelfsort · fic updates</p>
            <h1 style="margin:0 0 8px 0;color:#2C2C2C;font-size:28px;line-height:1.2;font-family:Georgia,serif;">Hi {name}, your fics just updated</h1>
            <p style="margin:0 0 24px 0;color:#6B705C;font-size:15px;line-height:1.6;">
              {headline}. Jump straight to what's new — your reading progress on the old version stays intact.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">{rows_html_str}</table>
            <p style="margin:32px 0 0 0;text-align:center;">
              <a href="{library_url}" style="display:inline-block;background:#6B46C1;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;font-size:14px;">Open your library</a>
            </p>
            <p style="margin:28px 0 0 0;color:#6B705C;font-size:11px;text-align:center;">
              You're receiving this because you turned on fic-update emails.
              Change your settings any time in <a href="{base}/account" style="color:#6B46C1;">your account</a>.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    </body></html>
    """

    text_lines = [f"Hi {name},", "", f"{headline}.", ""]
    for b in books:
        rs = b.get("refresh_summary") or {}
        parts: List[str] = []
        if rs.get("chapters_added"):
            parts.append(f"+{rs['chapters_added']} new")
        if rs.get("chapters_changed"):
            parts.append(f"{rs['chapters_changed']} edited")
        bits = (" (" + ", ".join(parts) + ")") if parts else ""
        text_lines.append(f"  · {b.get('title','')}{bits} — {base}/book/{b['book_id']}/compare")
    text_lines += ["", f"Open your library: {library_url}", "", "— Shelfsort"]

    summary = {
        "book_count": len(books),
        "total_added": total_added,
        "total_changed": total_changed,
    }
    return {"subject": subject, "html": html, "text": text_lines and "\n".join(text_lines), "summary": summary}


async def _send_update_digest_email(
    user_doc: Dict[str, Any],
    new_book_ids: List[str],
) -> Dict[str, Any]:
    """Send the update digest email. Caller should have already checked the user's preference."""
    payload = await _build_update_digest_payload(user_doc, new_book_ids)
    if not payload:
        return {"delivered": False, "reason": "no_books"}
    to_email = user_doc["email"]
    if not RESEND_API_KEY:
        logger.warning(
            "RESEND_API_KEY not set — would have sent fic-update digest to %s (%d books)",
            to_email, payload["summary"]["book_count"],
        )
        return {"delivered": False, "logged": True, "summary": payload["summary"]}
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
        await log_email_send("update_digest", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id"), "summary": payload["summary"]}
    except Exception as e:
        logger.error("Update-digest Resend send failed for %s: %s", to_email, e)
        await log_email_send("update_digest", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e), "summary": payload["summary"]}


async def _send_grace_reminder_email(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    """7-day "your account will be deleted soon" warning. Mirrors the
    digest sender: returns delivered=False/logged=True when the API key
    isn't configured so the cron tick can still flip
    `grace_reminder_sent_at`.
    """
    to_email = user_doc.get("email") or ""
    name = (user_doc.get("name") or "").strip()
    greeting = f"Hi {name}," if name else "Hi,"
    sched_at = user_doc.get("scheduled_deletion_at")
    if isinstance(sched_at, datetime):
        sched_str = sched_at.strftime("%A, %B %d, %Y")
    else:
        sched_str = "in about a week"
    base = (FRONTEND_URL or "").rstrip("/")
    cancel_link = f"{base}/settings" if base else "/settings"
    subject = "Your Shelfsort account is scheduled for deletion in 7 days"
    text = (
        f"{greeting}\n\n"
        f"Heads-up: your Shelfsort account is scheduled for hard deletion on {sched_str}.\n"
        f"Once that happens, your library, tags, shelves, and reading history will be gone for good.\n\n"
        f"If you want to keep your library, you can cancel the deletion at any time before then:\n"
        f"{cancel_link}\n\n"
        f"Just open the Settings page and click \"Cancel deletion\".\n\n"
        f"— Shelfsort"
    )
    html = (
        f"<div style=\"font-family:system-ui,-apple-system,sans-serif;color:#2a2a2a;line-height:1.55;max-width:560px\">"
        f"<p>{greeting}</p>"
        f"<p>Heads-up: your <strong>Shelfsort</strong> account is scheduled for hard deletion on "
        f"<strong>{sched_str}</strong>. Once that happens, your library, tags, shelves, and reading history "
        f"will be gone for good.</p>"
        f"<p>If you want to keep your library, you can cancel the deletion any time before then:</p>"
        f"<p><a href=\"{cancel_link}\" style=\"display:inline-block;padding:10px 18px;background:#5b3a99;"
        f"color:#fff;text-decoration:none;border-radius:6px\">Cancel deletion</a></p>"
        f"<p style=\"color:#666;font-size:13px;margin-top:24px\">If you meant to delete your account, "
        f"you don't have to do anything — we'll take care of it on {sched_str}.</p>"
        f"<p style=\"color:#999;font-size:12px\">— Shelfsort</p>"
        f"</div>"
    )
    if not RESEND_API_KEY:
        logger.warning(
            "RESEND_API_KEY not set — would have sent grace reminder to %s (scheduled %s)",
            to_email, sched_str,
        )
        return {"delivered": False, "logged": True}
    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("grace_reminder", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id")}
    except Exception as e:
        logger.error("Grace-reminder Resend send failed for %s: %s", to_email, e)
        await log_email_send("grace_reminder", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e)}


async def maybe_send_update_digest(user_id: str, new_book_ids: List[str]) -> None:
    """If the user opted in, send a fic-update digest. Failures are logged, not raised."""
    if not new_book_ids:
        return
    try:
        user_doc = await db.users.find_one({"user_id": user_id})
        if not user_doc:
            return
        prefs = _get_update_email_prefs(user_doc)
        if not prefs["enabled"]:
            return
        await _send_update_digest_email(user_doc, new_book_ids)
    except Exception as e:
        logger.warning("maybe_send_update_digest failed for user %s: %s", user_id, e)


@api_router.get("/user/update-email-settings")
async def get_update_email_settings(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_update_email_prefs(user_doc)
    return {
        "enabled": prefs["enabled"],
        "email_configured": bool(RESEND_API_KEY),
    }


@api_router.put("/user/update-email-settings")
async def update_update_email_settings(
    body: UpdateEmailBody,
    user: User = Depends(get_current_user),
):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = _get_update_email_prefs(user_doc)
    if body.enabled is not None:
        prefs["enabled"] = bool(body.enabled)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"update_email": prefs}},
    )
    return {"enabled": prefs["enabled"]}


@api_router.post("/user/update-email-preview")
async def send_update_email_preview(user: User = Depends(get_current_user)):
    """Send a preview using the user's 10 most-recent refreshed books."""
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    # Pull the 10 most recent refreshed books regardless of seen-state
    recent = await db.books.find(
        {"user_id": user.user_id, "replaces": {"$ne": None, "$exists": True}},
        {"_id": 0, "book_id": 1},
    ).sort("last_refreshed_at", -1).limit(10).to_list(10)
    bids = [b["book_id"] for b in recent]
    if not bids:
        raise HTTPException(
            status_code=400,
            detail="No refreshed books yet — run a refresh to generate sample data, then try again.",
        )
    return await _send_update_digest_email(user_doc, bids)


@api_router.get("/user/email-overview")
async def email_overview(user: User = Depends(get_current_user)):
    """One-stop summary of all three email channels for the preferences page."""
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    digest_prefs = _get_digest_prefs(user_doc)
    update_prefs = _get_update_email_prefs(user_doc)
    last_year_sent = (user_doc.get("digest") or {}).get("last_year_sent")
    last_sent = digest_prefs.get("last_sent_at")

    # Count of available refreshed books (for the update-email preview affordance)
    refreshed_count = await db.books.count_documents({
        "user_id": user.user_id,
        "replaces": {"$ne": None, "$exists": True},
    })

    return {
        "email": user_doc.get("email", ""),
        "sender_email": SENDER_EMAIL,
        "email_configured": bool(RESEND_API_KEY),
        "weekly_digest": {
            "enabled": bool(digest_prefs.get("enabled")),
            "day_of_week": int(digest_prefs.get("day_of_week", 6)),
            "hour": int(digest_prefs.get("hour", 8)),
            "last_sent_at": last_sent.isoformat() if isinstance(last_sent, datetime) else last_sent,
        },
        "fic_updates": {
            "enabled": update_prefs["enabled"],
            "refreshed_book_count": refreshed_count,
        },
        "year_recap": {
            # Tied to weekly digest opt-in; fires once on Jan 1 per year
            "enabled": bool(digest_prefs.get("enabled")),
            "last_year_sent": last_year_sent,
            "note": "Fires automatically each Jan 1 at your chosen hour, while the weekly digest is on.",
        },
    }






def start_digest_scheduler():
    global _scheduler
    if _scheduler:
        return
    from utils.cron_health import wrap_cron_job

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        wrap_cron_job(_digest_tick, "weekly_digest_tick"),
        "cron",
        minute=0,
        id="weekly_digest_tick",
        replace_existing=True,
    )
    # Account grace-period sweep — runs daily at 03:17 UTC (off-peak) and
    # hard-deletes any user whose `scheduled_deletion_at` is in the past.
    # Logic lives in `routes.auth._hard_delete_user`; the trigger lives
    # here so it shares the same AsyncIOScheduler instance.
    from routes.auth import _hard_delete_user

    async def _account_grace_tick():
        cutoff = datetime.now(timezone.utc)
        # 1) Hard-delete anyone past their grace window.
        cursor = db.users.find(
            {"scheduled_deletion_at": {"$lte": cutoff}},
            {"_id": 0, "user_id": 1, "email": 1},
        )
        async for u in cursor:
            try:
                await _hard_delete_user(u["user_id"])
                logger.info("Grace-tick hard-deleted account %s (%s)", u["user_id"], u.get("email"))
            except Exception as e:
                logger.exception("Grace-tick failed for %s: %s", u["user_id"], e)

        # 2) Send a "7 days left" reminder to anyone whose deletion is
        # between 6 and 8 days away and who hasn't been notified yet.
        # Wide window (6-8d) handles the edge case where the daily tick
        # runs once per day but the 7-day mark might fall between runs.
        reminder_low = cutoff + timedelta(days=6)
        reminder_high = cutoff + timedelta(days=8)
        cursor2 = db.users.find(
            {
                "scheduled_deletion_at": {"$gte": reminder_low, "$lte": reminder_high},
                "grace_reminder_sent_at": {"$exists": False},
                "email": {"$exists": True, "$ne": ""},
            },
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "scheduled_deletion_at": 1},
        )
        async for u in cursor2:
            try:
                await _send_grace_reminder_email(u)
                await db.users.update_one(
                    {"user_id": u["user_id"]},
                    {"$set": {"grace_reminder_sent_at": cutoff}},
                )
                logger.info("Sent 7-day grace reminder to %s", u.get("email"))
            except Exception as e:
                logger.exception("Grace-reminder send failed for %s: %s", u["user_id"], e)

    sched.add_job(
        wrap_cron_job(_account_grace_tick, "account_grace_tick"),
        "cron",
        hour=3,
        minute=17,
        id="account_grace_tick",
        replace_existing=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("Schedulers started (weekly digest + daily account grace tick).")


# ============================================================
# YEAR IN BOOKS
