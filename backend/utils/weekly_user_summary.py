"""Per-user weekly email digest — Resend quota brake.

Background
----------
Before today (2026-06-22) every Shelfsort signal sent its own email:

* Sunday — weekly stats digest (opt-in)
* Sunday 18:00 UTC — friends-finished digest (opt-in email; in-app
  notification always fires)
* Monday 08:00 UTC — bookclub-week digest (opt-in email)
* Ad-hoc — fic-update digest after a refresh batch (opt-in)
* Ad-hoc — cover top-of-week email when a user's shared cover wins
* Jan 1 — year-in-books recap (tied to digest opt-in)

For a fairly engaged reader on a 100/day Resend free tier, that's
3-5 emails per week per user.  Multiply by 100 users and you've
roasted the daily cap before noon on Sunday.

Fix — a single opt-in pref ``weekly_summary.enabled``:

* When True, the kind-specific senders early-return (in-app
  notifications still fire — those don't cost quota).
* Every Friday 09:00 UTC, ``user_weekly_summary_tick`` walks each
  opt-in user, gathers all five sections fresh from the DB, and
  sends ONE consolidated "Your week on Shelfsort" email.

The opt-in is intentionally OFF by default so we don't change
behaviour for anyone who hasn't explicitly asked for it.  The
user can flip it on from /account/emails.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from deps import db
from utils.test_account_filter import is_test_account

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Opt-in helper — exported so every kind-sender can use the SAME check.
# ---------------------------------------------------------------------
def is_in_weekly_summary_mode(user_doc: Dict[str, Any]) -> bool:
    """Return True when the user has explicitly opted into the
    consolidated Friday digest.  Default OFF.

    Pure / sync — safe to call from any kind-sender without an
    extra round-trip to Mongo (the caller already has the user
    doc in hand for its own send-prefs check).
    """
    if not user_doc:
        return False
    prefs = user_doc.get("weekly_summary") or {}
    return bool(prefs.get("enabled"))


# ---------------------------------------------------------------------
# Section gatherers — each returns a small JSON-able dict the renderer
# consumes.  Empty results are returned as falsy dicts so the renderer
# can skip empty sections cleanly.
# ---------------------------------------------------------------------
async def _gather_reading_section(uid: str, since: datetime) -> Dict[str, Any]:
    """Stats for the past week: books opened, minutes read, top fandom."""
    activity_cursor = db.reading_activity.find(
        {"user_id": uid, "occurred_at": {"$gte": since.isoformat()}},
        {"_id": 0, "book_id": 1, "minutes": 1, "fandom": 1},
    )
    minutes = 0
    by_fandom: Dict[str, int] = {}
    books_set: set[str] = set()
    async for r in activity_cursor:
        minutes += int(r.get("minutes") or 0)
        books_set.add(r.get("book_id") or "")
        f = r.get("fandom") or ""
        if f:
            by_fandom[f] = by_fandom.get(f, 0) + int(r.get("minutes") or 0)
    top_fandom = max(by_fandom.items(), key=lambda x: x[1])[0] if by_fandom else None
    return {
        "minutes":     minutes,
        "books_opened": len(books_set),
        "top_fandom":   top_fandom,
    } if minutes or books_set else {}


async def _gather_stuck_books(uid: str) -> List[Dict[str, Any]]:
    """Up to 3 stuck books (>14d since open, 1-30% progress)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    cursor = db.books.find(
        {
            "user_id":          uid,
            "last_opened_at":   {"$lt": cutoff, "$exists": True},
            "progress_fraction": {"$gt": 0.01, "$lt": 0.30},
            "trashed":          {"$ne": True},
            "is_dnf":           {"$ne": True},
        },
        {"_id": 0, "book_id": 1, "title": 1, "progress_fraction": 1},
    ).sort("last_opened_at", 1).limit(3)
    return await cursor.to_list(length=3)


async def _gather_friends_finished(uid: str, since: datetime) -> List[Dict[str, Any]]:
    """Friends who finished a book this week."""
    # Pull the user's friends list once
    me = await db.users.find_one({"user_id": uid}, {"_id": 0, "friends": 1}) or {}
    friend_ids = [f.get("user_id") for f in (me.get("friends") or []) if f.get("user_id")]
    if not friend_ids:
        return []
    cursor = db.books.find(
        {
            "user_id":      {"$in": friend_ids},
            "finished_at":  {"$gte": since.isoformat()},
            "share_finished_to_friends": {"$ne": False},
        },
        {"_id": 0, "user_id": 1, "title": 1, "fandom": 1, "finished_at": 1},
    ).sort("finished_at", -1).limit(10)
    return await cursor.to_list(length=10)


async def _gather_bookclub_activity(uid: str, since: datetime) -> List[Dict[str, Any]]:
    """Bookclub rooms the user is in that had >=1 message in the past week."""
    member_rooms = await db.bookclub_members.find(
        {"user_id": uid}, {"_id": 0, "room_id": 1},
    ).to_list(length=100)
    room_ids = [r["room_id"] for r in member_rooms if r.get("room_id")]
    if not room_ids:
        return []
    cursor = db.bookclub_messages.aggregate([
        {"$match": {
            "room_id":    {"$in": room_ids},
            "created_at": {"$gte": since.isoformat()},
        }},
        {"$group": {"_id": "$room_id", "n": {"$sum": 1}}},
        {"$sort":  {"n": -1}},
        {"$limit": 5},
    ])
    rows = await cursor.to_list(length=5)
    out: List[Dict[str, Any]] = []
    for r in rows:
        room = await db.bookclubs.find_one({"room_id": r["_id"]}, {"_id": 0, "name": 1, "book_title": 1})
        if not room:
            continue
        out.append({
            "room_id":    r["_id"],
            "name":       room.get("name", "(unnamed)"),
            "book_title": room.get("book_title", ""),
            "messages":   r["n"],
        })
    return out


async def _gather_fic_updates(uid: str, since: datetime) -> List[Dict[str, Any]]:
    """Refreshed-fic count and a sample of titles in the past week."""
    cursor = db.books.find(
        {
            "user_id":           uid,
            "last_refreshed_at": {"$gte": since.isoformat()},
            "replaces":          {"$exists": True, "$ne": None},
        },
        {"_id": 0, "book_id": 1, "title": 1, "author": 1},
    ).sort("last_refreshed_at", -1).limit(10)
    return await cursor.to_list(length=10)


async def _gather_cover_recap(uid: str, since: datetime) -> Dict[str, Any]:
    """Total votes the user's shared covers earned this week."""
    pipeline = [
        {"$match": {"shared_by_user_id": uid}},
        {"$lookup": {
            "from":         "community_cover_votes",
            "localField":   "cover_id",
            "foreignField": "cover_id",
            "as":           "votes",
        }},
        {"$project": {
            "_id":          0,
            "cover_id":     1,
            "week_votes":   {"$size": {"$filter": {
                "input": "$votes",
                "cond":  {"$gte": ["$$this.created_at", since.isoformat()]},
            }}},
        }},
        {"$match": {"week_votes": {"$gt": 0}}},
        {"$sort":  {"week_votes": -1}},
        {"$limit": 3},
    ]
    try:
        rows = await db.community_covers.aggregate(pipeline).to_list(length=3)
    except Exception:
        return {}
    if not rows:
        return {}
    total = sum(r["week_votes"] for r in rows)
    return {"total_votes": total, "top_covers": rows}


# ---------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------
def _render(user_doc: Dict[str, Any], sections: Dict[str, Any], when: datetime) -> tuple[str, str, str]:
    name = (user_doc.get("name") or "").strip() or "reader"
    base = (os.environ.get("FRONTEND_URL") or "").rstrip("/")
    library_url = f"{base}/library" if base else "/library"
    subject = f"Your week on Shelfsort — {when.strftime('%b %d')}"

    blocks_html: List[str] = []
    blocks_text: List[str] = []

    r = sections.get("reading") or {}
    if r.get("minutes") or r.get("books_opened"):
        line = f"{r.get('minutes', 0)} min reading across {r.get('books_opened', 0)} book(s)"
        if r.get("top_fandom"):
            line += f" — top fandom: <strong>{r['top_fandom']}</strong>"
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Your reading</h3><p style='margin:0;color:#262626'>{line}</p>")
        blocks_text.append(f"Your reading\n  {r.get('minutes', 0)} min across {r.get('books_opened', 0)} book(s)" + (f"; top fandom: {r['top_fandom']}" if r.get('top_fandom') else ""))

    stuck = sections.get("stuck_books") or []
    if stuck:
        items_html = "".join(
            f"<li style='margin:2px 0'>{s['title']} — {int((s.get('progress_fraction') or 0)*100)}% done</li>"
            for s in stuck
        )
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Stuck books</h3><ul style='margin:0;padding-left:20px;color:#262626'>{items_html}</ul>")
        blocks_text.append("Stuck books\n" + "\n".join(f"  - {s['title']} ({int((s.get('progress_fraction') or 0)*100)}% done)" for s in stuck))

    friends = sections.get("friends_finished") or []
    if friends:
        items_html = "".join(
            f"<li style='margin:2px 0'>{f.get('title', 'a book')}" + (f" <span style='color:#6B705C'>({f['fandom']})</span>" if f.get("fandom") else "") + "</li>"
            for f in friends[:5]
        )
        more = f"<li style='color:#9b9b9b;font-size:13px'>+{len(friends)-5} more</li>" if len(friends) > 5 else ""
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Your friends finished</h3><ul style='margin:0;padding-left:20px;color:#262626'>{items_html}{more}</ul>")
        blocks_text.append("Your friends finished\n" + "\n".join(f"  - {f.get('title','a book')}" + (f" ({f['fandom']})" if f.get('fandom') else "") for f in friends[:5]))

    rooms = sections.get("bookclubs") or []
    if rooms:
        items_html = "".join(
            f"<li style='margin:2px 0'>{rm['name']} — {rm['messages']} message(s)" + (f" · {rm['book_title']}" if rm.get('book_title') else "") + "</li>"
            for rm in rooms
        )
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Bookclub activity</h3><ul style='margin:0;padding-left:20px;color:#262626'>{items_html}</ul>")
        blocks_text.append("Bookclub activity\n" + "\n".join(f"  - {rm['name']} ({rm['messages']} msg)" for rm in rooms))

    fic = sections.get("fic_updates") or []
    if fic:
        items_html = "".join(f"<li style='margin:2px 0'>{b.get('title','a book')} — {b.get('author','')}</li>" for b in fic[:5])
        more = f"<li style='color:#9b9b9b;font-size:13px'>+{len(fic)-5} more</li>" if len(fic) > 5 else ""
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Fic updates</h3><ul style='margin:0;padding-left:20px;color:#262626'>{items_html}{more}</ul>")
        blocks_text.append("Fic updates\n" + "\n".join(f"  - {b.get('title','a book')} — {b.get('author','')}" for b in fic[:5]))

    covers = sections.get("cover_recap") or {}
    if covers.get("total_votes"):
        blocks_html.append(f"<h3 style='margin:18px 0 4px;font-size:15px;color:#6B46C1'>Cover votes</h3><p style='margin:0;color:#262626'>Your shared covers picked up <strong>{covers['total_votes']}</strong> vote(s) this week.</p>")
        blocks_text.append(f"Cover votes\n  {covers['total_votes']} vote(s) on your shared covers")

    if not blocks_html:
        # The cron only ever invokes the renderer when at least one
        # section has content — but keep a safety net so we don't
        # send a body-less email if a future caller misuses it.
        blocks_html.append("<p style='color:#6B705C;font-style:italic'>A quiet week — your library is waiting whenever you are.</p>")
        blocks_text.append("A quiet week — your library is waiting whenever you are.")

    body_blocks = "".join(blocks_html)
    body_text = "\n\n".join(blocks_text)
    html = f"""
<div style='font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;line-height:1.55;color:#262626;background:#FBFAF6;padding:24px;border-radius:12px;border:1px solid #E5DDC5'>
  <p style='margin:0 0 4px;color:#6B705C;font-size:13px'>{when.strftime('%A, %b %d')}</p>
  <h2 style='margin:0 0 12px;color:#6B46C1'>Hey {name} — here's your week 📚</h2>
  {body_blocks}
  <p style='margin:24px 0 4px;font-size:13px;color:#5b5b5b'>
    Open <a href='{library_url}' style='color:#6B46C1'>your library</a> to keep going.
    To switch back to per-event emails, head to <a href='{base}/account/emails' style='color:#6B46C1'>Email preferences</a>.
  </p>
</div>
"""
    text = (
        f"{when.strftime('%A, %b %d')}\n"
        f"Hey {name} — here's your week\n\n"
        + body_text +
        f"\n\nOpen your library: {library_url}\n"
        f"Switch back to per-event emails: {base}/account/emails\n"
    )
    return subject, html, text


# ---------------------------------------------------------------------
# Send + cron
# ---------------------------------------------------------------------
async def _send_one(user_doc: Dict[str, Any], when: datetime) -> Dict[str, Any]:
    """Build + send the digest for a single user.  Returns
    ``{"sent": bool, "reason": str, "sections": int}``."""
    uid = user_doc["user_id"]
    since = when - timedelta(days=7)
    sections = {
        "reading":          await _gather_reading_section(uid, since),
        "stuck_books":      await _gather_stuck_books(uid),
        "friends_finished": await _gather_friends_finished(uid, since),
        "bookclubs":        await _gather_bookclub_activity(uid, since),
        "fic_updates":      await _gather_fic_updates(uid, since),
        "cover_recap":      await _gather_cover_recap(uid, since),
    }
    populated = sum(1 for v in sections.values() if v)
    if populated == 0:
        return {"sent": False, "reason": "nothing_to_say", "sections": 0}

    to_email = (user_doc.get("email") or "").strip()
    if not to_email:
        return {"sent": False, "reason": "no_email", "sections": populated}

    resend_key = os.environ.get("RESEND_API_KEY") or ""
    sender = os.environ.get("SENDER_EMAIL") or ""
    if not resend_key or not sender:
        return {"sent": False, "reason": "resend_not_configured", "sections": populated}

    subject, html, text = _render(user_doc, sections, when)
    import asyncio as _asyncio
    import resend  # noqa: WPS433
    resend.api_key = resend_key
    params = {
        "from":    sender,
        "to":      [to_email],
        "subject": subject,
        "html":    html,
        "text":    text,
        "_kind":   "weekly_summary",
    }
    try:
        result = await _asyncio.to_thread(resend.Emails.send, params)
        await db.users.update_one(
            {"user_id": uid},
            {"$set": {
                "weekly_summary.last_sent_at": when,
                "weekly_summary.last_sections": populated,
            }},
        )
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "weekly_summary", to_email, "ok",
                resend_id=result.get("id") if isinstance(result, dict) else None,
                extra={"sections": populated},
            )
        except Exception:
            pass
        return {"sent": True, "sections": populated}
    except Exception as exc:  # noqa: BLE001
        logger.warning("weekly_summary: send to %s failed: %s", to_email, exc)
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "weekly_summary", to_email, "error",
                error=str(exc),
                extra={"sections": populated},
            )
        except Exception:
            pass
        return {"sent": False, "reason": "resend_error", "sections": populated, "error": str(exc)}


async def user_weekly_summary_tick() -> Dict[str, Any]:
    """Fridays 09:00 UTC.  Send one consolidated digest per opt-in user.

    Test-fixture accounts are filtered out (their addresses bounce
    hard and waste Resend quota).  Each user is debounced for 6
    days so the cron is safe to call manually for a sanity check
    even on a Friday.
    """
    now = datetime.now(timezone.utc)
    cooldown = now - timedelta(days=6)
    cursor = db.users.find(
        {"weekly_summary.enabled": True, "email": {"$exists": True, "$ne": ""}},
        {"_id": 0},
    )
    ok = 0
    skipped = 0
    errors = 0
    async for u in cursor:
        if is_test_account(u.get("email")):
            skipped += 1
            continue
        last = (u.get("weekly_summary") or {}).get("last_sent_at")
        if isinstance(last, datetime) and last > cooldown:
            skipped += 1
            continue
        try:
            r = await _send_one(u, now)
            if r.get("sent"):
                ok += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001
            errors += 1
            logger.warning("weekly_summary: tick failed for %s: %s", u.get("user_id"), exc)
    return {"ok": ok, "skipped": skipped, "errors": errors, "tick_at": now.isoformat()}
