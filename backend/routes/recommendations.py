"""Friend-recommendations widget — surfaces books my friends loved that I don't own yet.

Signals (combined into a score):
  +3 per friend who FINISHED the book (progress_fraction >= 0.95)
  +1 per friend who put serious reading time in (reading_minutes >= 30, not necessarily finished)
  bonus = capped 50-min weight from total reading_minutes across friends

Filters out:
  - any of my own books (by canonical fanfic URL / source_url / normalized title+author)
  - books I've already dismissed (stored per-user)
  - books from friends who haven't opted into library sharing (library_visible_to_friends)

Grouping: identical books recommended by multiple friends collapse into a
single rec ("Alice + 2 others finished this") via a `rec_key` made from
either the canonical source URL or normalized title+author.

Endpoints:
  GET  /api/recommendations/friends?limit=N
  GET  /api/recommendations/dismissed
  POST /api/recommendations/dismiss      body={"rec_key": "..."}
  POST /api/recommendations/undismiss    body={"rec_key": "..."}

Collection: recommendation_dismissals
    {user_id, rec_key, dismissed_at}
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user
from routes.notifications import create_notification


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _norm_title(t: str) -> str:
    """Lowercase, strip leading articles, collapse whitespace."""
    t = (t or "").strip().lower()
    for p in ("the ", "a ", "an "):
        if t.startswith(p):
            t = t[len(p):]
            break
    return re.sub(r"\s+", " ", t)


def _norm_author(a: str) -> str:
    return re.sub(r"\s+", " ", (a or "").strip().lower())


def _title_author_key(title: str, author: str) -> Optional[str]:
    nt = _norm_title(title)
    na = _norm_author(author)
    if not nt:
        return None
    return f"ta:{nt}|{na}"


def _book_keys(book: Dict[str, Any]) -> List[str]:
    """All matching keys for a single book — used both to compute the
    rec_key for grouping and to check "do I already own this?"."""
    keys: List[str] = []
    # Canonical fanfic URLs win — they're the strongest dedup signal.
    for u in (book.get("fanfic_urls") or []):
        if u:
            keys.append(f"url:{u}")
    src = book.get("source_url")
    if src:
        keys.append(f"url:{src}")
    ta = _title_author_key(book.get("title") or "", book.get("author") or "")
    if ta:
        keys.append(ta)
    return keys


def _primary_rec_key(book: Dict[str, Any]) -> Optional[str]:
    """The single key used to identify this rec across friends. Prefer a
    canonical URL since title-typos shouldn't collapse different works."""
    keys = _book_keys(book)
    if not keys:
        return None
    # First url key, or fall back to title+author.
    for k in keys:
        if k.startswith("url:"):
            return k
    return keys[0]


async def _accepted_friend_ids(me: str) -> List[str]:
    """Return user_ids of every accepted friend. Cheap on indexes."""
    rows = await db.friendships.find(
        {
            "status": "accepted",
            "$or": [{"user_a": me}, {"user_b": me}],
        },
        {"_id": 0, "user_a": 1, "user_b": 1},
    ).to_list(length=2000)
    return [r["user_b"] if r["user_a"] == me else r["user_a"] for r in rows]


# ---------------------------------------------------------------------
# GET /api/recommendations/friends
# ---------------------------------------------------------------------

@api_router.get("/recommendations/friends")
async def friend_recommendations(
    limit: int = 24,
    user: User = Depends(get_current_user),
):
    limit = max(1, min(int(limit or 24), 100))

    friend_ids = await _accepted_friend_ids(user.user_id)
    if not friend_ids:
        return {"recommendations": [], "friend_count": 0, "shared_friend_count": 0}

    # Only consider friends who opted into library sharing.
    sharing_friends = await db.users.find(
        {"user_id": {"$in": friend_ids}, "library_visible_to_friends": True},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1},
    ).to_list(length=2000)
    if not sharing_friends:
        return {"recommendations": [], "friend_count": len(friend_ids), "shared_friend_count": 0}

    friend_meta = {f["user_id"]: f for f in sharing_friends}
    sharing_ids = list(friend_meta.keys())

    # Pull "interesting" books from sharing friends. Cheap initial filter
    # (any of: finished, 30+ minutes, or recently opened) so the in-app
    # ranking loop has a tight working set.
    candidates = await db.books.find(
        {
            "user_id": {"$in": sharing_ids},
            "$or": [
                {"progress_fraction": {"$gte": 0.95}},
                {"reading_minutes": {"$gte": 30}},
            ],
            # Exclude archived versions ("Old stories") and the trash.
            "category": {"$nin": ["Old stories", "Trash"]},
            "replaced_by": {"$exists": False},
        },
        {
            "_id": 0,
            "book_id": 1, "user_id": 1,
            "title": 1, "author": 1, "fandom": 1, "category": 1,
            "description": 1, "source_url": 1, "fanfic_urls": 1,
            "progress_fraction": 1, "reading_minutes": 1,
            "last_opened_at": 1, "has_cover": 1,
        },
    ).to_list(length=5000)

    # Build my own ownership key set so we can filter out books I already have.
    my_books = await db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$nin": ["Old stories", "Trash"]},
        },
        {"_id": 0, "title": 1, "author": 1, "source_url": 1, "fanfic_urls": 1},
    ).to_list(length=20000)
    my_keys = set()
    for b in my_books:
        for k in _book_keys(b):
            my_keys.add(k)

    # Pull my dismissals.
    dismissed_rows = await db.recommendation_dismissals.find(
        {"user_id": user.user_id}, {"_id": 0, "rec_key": 1},
    ).to_list(length=10000)
    dismissed = {r["rec_key"] for r in dismissed_rows}

    # Group candidates by rec_key. Each rec aggregates signal from every
    # friend who has it.
    groups: Dict[str, Dict[str, Any]] = {}
    for c in candidates:
        rkey = _primary_rec_key(c)
        if not rkey:
            continue
        # Skip if I own any version of this book.
        if any(k in my_keys for k in _book_keys(c)):
            continue
        if rkey in dismissed:
            continue

        finished = float(c.get("progress_fraction") or 0) >= 0.95
        minutes = int(c.get("reading_minutes") or 0)
        opened = c.get("last_opened_at")

        g = groups.get(rkey)
        if not g:
            fmeta = friend_meta.get(c["user_id"], {})
            g = {
                "rec_key": rkey,
                "title": c.get("title", ""),
                "author": c.get("author", ""),
                "fandom": c.get("fandom") or "",
                "category": c.get("category") or "",
                "description": (c.get("description") or "")[:300],
                "source_url": c.get("source_url") or "",
                "fanfic_urls": c.get("fanfic_urls") or [],
                "friends": [],   # [{user_id, name, book_id, finished, minutes, opened_at, has_cover}]
                "finished_count": 0,
                "total_minutes": 0,
                "last_activity": "",
                "_score": 0.0,
            }
            groups[rkey] = g

        # Avoid double-counting the same friend (very rare — they'd have
        # to own two copies of the same book) by checking user_id.
        if any(fr["user_id"] == c["user_id"] for fr in g["friends"]):
            continue

        fmeta = friend_meta.get(c["user_id"], {})
        g["friends"].append({
            "user_id": c["user_id"],
            "name": fmeta.get("name") or fmeta.get("email") or "A friend",
            "book_id": c["book_id"],
            "finished": finished,
            "minutes": minutes,
            "opened_at": opened.isoformat() if isinstance(opened, datetime) else (opened or ""),
            "has_cover": bool(c.get("has_cover", False)),
        })
        if finished:
            g["finished_count"] += 1
        g["total_minutes"] += minutes
        # Track the most recent opened_at across all friends as last_activity.
        when = c.get("last_opened_at")
        when_iso = when.isoformat() if isinstance(when, datetime) else (when or "")
        if when_iso and when_iso > g["last_activity"]:
            g["last_activity"] = when_iso

    # Score: +3 per finisher, +1 per serious reader (>=30 min, even if not finished),
    # +min(total_minutes/60, 5.0) so a single very-invested friend can compete
    # with multiple shallow finishers.
    for g in groups.values():
        serious_non_finishers = sum(
            1 for fr in g["friends"]
            if not fr["finished"] and fr["minutes"] >= 30
        )
        score = (
            3.0 * g["finished_count"]
            + 1.0 * serious_non_finishers
            + min(g["total_minutes"] / 60.0, 5.0)
        )
        # Tie-break: recent activity wins.
        g["_score"] = score
        g["friend_count"] = len(g["friends"])

    ranked = sorted(
        groups.values(),
        key=lambda x: (x["_score"], x["last_activity"]),
        reverse=True,
    )[:limit]
    # Hide the internal score in the API surface but expose the user-friendly stats.
    for g in ranked:
        g.pop("_score", None)

    return {
        "recommendations": ranked,
        "friend_count": len(friend_ids),
        "shared_friend_count": len(sharing_ids),
    }


# ---------------------------------------------------------------------
# Dismissals
# ---------------------------------------------------------------------

class DismissBody(BaseModel):
    rec_key: str = Field(..., min_length=1, max_length=500)


@api_router.get("/recommendations/dismissed")
async def list_dismissed(user: User = Depends(get_current_user)):
    rows = await db.recommendation_dismissals.find(
        {"user_id": user.user_id}, {"_id": 0, "rec_key": 1, "dismissed_at": 1, "title": 1, "author": 1},
    ).sort("dismissed_at", -1).to_list(length=500)
    return {
        "dismissed": [
            {
                "rec_key": r["rec_key"],
                "title": r.get("title", ""),
                "author": r.get("author", ""),
                "dismissed_at": r["dismissed_at"].isoformat() if isinstance(r.get("dismissed_at"), datetime) else r.get("dismissed_at"),
            }
            for r in rows
        ]
    }


@api_router.post("/recommendations/dismiss")
async def dismiss_rec(body: DismissBody, user: User = Depends(get_current_user)):
    # Idempotent upsert. Stash title/author too so the dismissed list is readable.
    # We don't have those here — fetch a best-effort title from any friend's
    # book that still matches the key.
    best_title = ""
    best_author = ""
    friend_ids = await _accepted_friend_ids(user.user_id)
    if friend_ids:
        candidates = await db.books.find(
            {"user_id": {"$in": friend_ids}},
            {"_id": 0, "title": 1, "author": 1, "source_url": 1, "fanfic_urls": 1},
        ).limit(5000).to_list(length=5000)
        for c in candidates:
            for k in _book_keys(c):
                if k == body.rec_key:
                    best_title = c.get("title", "")
                    best_author = c.get("author", "")
                    break
            if best_title:
                break
    await db.recommendation_dismissals.update_one(
        {"user_id": user.user_id, "rec_key": body.rec_key},
        {
            "$set": {
                "user_id": user.user_id,
                "rec_key": body.rec_key,
                "title": best_title,
                "author": best_author,
                "dismissed_at": datetime.now(timezone.utc),
            },
        },
        upsert=True,
    )
    return {"dismissed": body.rec_key}


@api_router.post("/recommendations/undismiss")
async def undismiss_rec(body: DismissBody, user: User = Depends(get_current_user)):
    await db.recommendation_dismissals.delete_one(
        {"user_id": user.user_id, "rec_key": body.rec_key},
    )
    return {"undismissed": body.rec_key}


# =====================================================================
# Weekly "From friends" digest
# =====================================================================
#
# Drops a single grouped in-app notification per user per week summarising
# every book their sharing friends finished in the last 7 days that the
# user doesn't already own. The IN-APP notification ALWAYS fires when there
# are matches — no user toggle. Only the OPTIONAL email copy is opt-in.
#
# Hooked from `routes/digest.py:_digest_tick` (fires on Sunday at 18:00 UTC).
# Idempotent per ISO-year-week via `friends_finished.last_year_week`.
#
# Preferences live on the user doc:
#   friends_finished: {
#     email_enabled: bool=False,  # opt-in email copy (default OFF)
#     last_year_week: str|null,
#     last_sent_at: iso str|null,
#     last_email_sent_at: iso str|null,
#   }

FRIENDS_FINISHED_LOOKBACK_DAYS = 7


def _year_week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _get_friends_finished_prefs(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    p = user_doc.get("friends_finished") or {}
    # Back-compat: older docs may have `enabled` from the first ship; we
    # ignore that field now (in-app is unconditional). Email defaults to off.
    return {
        "email_enabled": bool(p.get("email_enabled", False)),
        "last_year_week": p.get("last_year_week"),
        "last_sent_at": p.get("last_sent_at"),
        "last_email_sent_at": p.get("last_email_sent_at"),
    }


async def _collect_friends_finished_payload(
    user_id: str, lookback_days: int = FRIENDS_FINISHED_LOOKBACK_DAYS,
) -> Dict[str, Any]:
    """Build {books: [{title, author, friend_names, finished_at, source_url}], total}
    summarising recent finishes from sharing friends, filtered against the
    caller's owned library and prior dismissals."""
    friend_ids = await _accepted_friend_ids(user_id)
    if not friend_ids:
        return {"books": [], "total": 0, "friend_count": 0, "shared_friend_count": 0}

    sharing = await db.users.find(
        {"user_id": {"$in": friend_ids}, "library_visible_to_friends": True},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1},
    ).to_list(length=2000)
    if not sharing:
        return {"books": [], "total": 0, "friend_count": len(friend_ids), "shared_friend_count": 0}
    fmeta = {f["user_id"]: f for f in sharing}
    sharing_ids = list(fmeta.keys())

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    # "Newly finished" = progress >= 0.95 AND last_opened_at >= cutoff.
    # last_opened_at is set by the heartbeat path so this approximates "I just finished".
    candidates = await db.books.find(
        {
            "user_id": {"$in": sharing_ids},
            "progress_fraction": {"$gte": 0.95},
            "last_opened_at": {"$gte": cutoff},
            "category": {"$nin": ["Old stories", "Trash"]},
            "replaced_by": {"$exists": False},
        },
        {
            "_id": 0, "book_id": 1, "user_id": 1,
            "title": 1, "author": 1, "fandom": 1, "source_url": 1,
            "fanfic_urls": 1, "last_opened_at": 1, "finished_at": 1,
        },
    ).to_list(length=2000)

    if not candidates:
        return {"books": [], "total": 0, "friend_count": len(friend_ids), "shared_friend_count": len(sharing_ids)}

    # Filter out caller's owned books.
    my_books = await db.books.find(
        {
            "user_id": user_id,
            "category": {"$nin": ["Old stories", "Trash"]},
        },
        {"_id": 0, "title": 1, "author": 1, "source_url": 1, "fanfic_urls": 1},
    ).to_list(length=20000)
    my_keys = set()
    for b in my_books:
        for k in _book_keys(b):
            my_keys.add(k)

    dismissed_rows = await db.recommendation_dismissals.find(
        {"user_id": user_id}, {"_id": 0, "rec_key": 1},
    ).to_list(length=10000)
    dismissed = {r["rec_key"] for r in dismissed_rows}

    # Group by rec_key.
    groups: Dict[str, Dict[str, Any]] = {}
    for c in candidates:
        rkey = _primary_rec_key(c)
        if not rkey or rkey in dismissed:
            continue
        if any(k in my_keys for k in _book_keys(c)):
            continue
        g = groups.get(rkey)
        if not g:
            g = {
                "rec_key": rkey,
                "title": c.get("title", ""),
                "author": c.get("author", ""),
                "fandom": c.get("fandom") or "",
                "source_url": c.get("source_url") or "",
                "friend_names": [],
                "most_recent_at": "",
            }
            groups[rkey] = g
        fmeta_row = fmeta.get(c["user_id"], {})
        name = fmeta_row.get("name") or fmeta_row.get("email") or "A friend"
        if name not in g["friend_names"]:
            g["friend_names"].append(name)
        when = c.get("finished_at") or c.get("last_opened_at")
        when_iso = when.isoformat() if isinstance(when, datetime) else (when or "")
        if when_iso and when_iso > g["most_recent_at"]:
            g["most_recent_at"] = when_iso

    books = sorted(groups.values(), key=lambda g: g["most_recent_at"], reverse=True)
    return {
        "books": books,
        "total": len(books),
        "friend_count": len(friend_ids),
        "shared_friend_count": len(sharing_ids),
    }


def _build_friends_finished_email_payload(
    user_doc: Dict[str, Any], payload: Dict[str, Any], base_url: str,
) -> Dict[str, str]:
    """Build the Resend email payload (subject + html + text) from the
    collected books payload. Returns simple dict ready to splat into
    Resend.Emails.send."""
    total = payload["total"]
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]
    subject = f"{total} book{'s' if total != 1 else ''} your friends just finished"
    text_lines = [
        f"Hi {name},",
        "",
        "Here are the books your sharing friends finished this past week:",
        "",
    ]
    html_rows = []
    for b in payload["books"][:25]:
        names = ", ".join(b["friend_names"][:3])
        more = max(0, len(b["friend_names"]) - 3)
        suffix = f" +{more} more" if more else ""
        line = f"• {b['title']}"
        if b.get("author"):
            line += f" — {b['author']}"
        line += f"  ({names}{suffix})"
        text_lines.append(line)
        html_rows.append(
            f'<tr><td style="padding:8px 0;border-bottom:1px solid #EFEAE0;">'
            f'<div style="font-weight:600;color:#2C2C2C;">{b["title"]}</div>'
            f'<div style="font-size:13px;color:#6B705C;">{b.get("author") or ""}'
            f'{" · " + b["fandom"] if b.get("fandom") else ""}</div>'
            f'<div style="font-size:12px;color:#6B46C1;margin-top:2px;">{names}{suffix}</div>'
            f'</td></tr>'
        )
    if total > 25:
        text_lines.append(f"…and {total - 25} more.")
    text_lines += [
        "",
        f"Open in Shelfsort: {base_url}/library/recommendations",
        "",
        "Manage email preferences:",
        f"  {base_url}/account/emails",
        "",
        "— Shelfsort",
    ]
    text = "\n".join(text_lines)
    html = (
        '<div style="font-family:Georgia,serif;color:#2C2C2C;line-height:1.5;max-width:560px;">'
        f'<h2 style="font-size:22px;color:#2C2C2C;margin:0 0 6px 0;">From your friends</h2>'
        f'<p style="color:#6B705C;font-size:14px;margin:0 0 14px 0;">'
        f'{total} book{"s" if total != 1 else ""} your sharing friends finished this past week.'
        '</p>'
        '<table style="width:100%;border-collapse:collapse;">'
        + "".join(html_rows) +
        '</table>'
        f'<p style="margin:20px 0 0 0;"><a href="{base_url}/library/recommendations" '
        'style="background:#6B46C1;color:white;text-decoration:none;padding:10px 18px;'
        'border-radius:8px;font-weight:600;display:inline-block;">'
        'See all in Shelfsort</a></p>'
        f'<p style="font-size:11px;color:#6B705C;margin-top:24px;">'
        f'You\'re getting this because you opted into the "From friends" email channel. '
        f'<a href="{base_url}/account/emails" style="color:#6B46C1;">Manage email preferences</a>.'
        '</p>'
        '</div>'
    )
    return {"subject": subject, "html": html, "text": text}


async def _send_friends_finished_email(user_doc: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    """Send the opt-in email. Best-effort; logs to email_log."""
    from deps import RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL  # local import to avoid heavy startup deps
    import asyncio
    import resend
    from utils.email_log import log_email_send

    to_email = user_doc.get("email") or ""
    if not to_email:
        return {"delivered": False, "reason": "no_email"}
    base = (FRONTEND_URL or "").rstrip("/")
    msg = _build_friends_finished_email_payload(user_doc, payload, base)
    if not RESEND_API_KEY:
        logger.warning(
            "RESEND_API_KEY not set — would have sent friends-finished email to %s (%d books)",
            to_email, payload["total"],
        )
        return {"delivered": False, "logged": True}
    try:
        resend.api_key = RESEND_API_KEY
        params = {"from": SENDER_EMAIL, "to": [to_email], **msg}
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("friends_finished", to_email, "ok", resend_id=(result or {}).get("id"))
        return {"delivered": True, "id": (result or {}).get("id")}
    except Exception as e:
        logger.error("Friends-finished email send failed for %s: %s", to_email, e)
        await log_email_send("friends_finished", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e)}


async def maybe_send_friends_finished_digest(user_doc: Dict[str, Any]) -> bool:
    """Called from the weekly digest tick.

    In-app notification ALWAYS fires when there are matches (no user toggle).
    Email fires alongside if and only if `friends_finished.email_enabled=True`.
    Idempotent per ISO-year-week.

    Returns True if a notification fired (regardless of email outcome).
    """
    prefs = _get_friends_finished_prefs(user_doc)
    now = datetime.now(timezone.utc)
    yw = _year_week_key(now)
    if prefs.get("last_year_week") == yw:
        return False
    payload = await _collect_friends_finished_payload(user_doc["user_id"])
    if payload["total"] == 0:
        # Mark this week handled so we don't re-check 24x the same day.
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {"friends_finished.last_year_week": yw}},
        )
        return False

    total = payload["total"]
    sample = payload["books"][:3]
    headline = f"{total} book{'s' if total != 1 else ''} your friends just finished"
    body_lines = []
    for b in sample:
        names = ", ".join(b["friend_names"][:2])
        more = max(0, len(b["friend_names"]) - 2)
        suffix = f" +{more} more" if more else ""
        body_lines.append(f"{b['title']} — {names}{suffix}")
    if total > len(sample):
        body_lines.append(f"…and {total - len(sample)} more.")
    body = " · ".join(body_lines)

    set_updates: Dict[str, Any] = {
        "friends_finished.last_year_week": yw,
        "friends_finished.last_sent_at": now.isoformat(),
    }
    try:
        await create_notification(
            user_doc["user_id"],
            kind="friends_finished_digest",
            title=headline,
            body=body,
            link="/library/recommendations",
        )
    except Exception as e:
        logger.warning("Friends-finished in-app notification failed for %s: %s", user_doc.get("email"), e)
        return False

    # Email is opt-in and runs only if the user explicitly enabled it.
    if prefs.get("email_enabled"):
        try:
            result = await _send_friends_finished_email(user_doc, payload)
            if result.get("delivered"):
                set_updates["friends_finished.last_email_sent_at"] = now.isoformat()
        except Exception as e:
            logger.warning("Friends-finished email failed for %s: %s", user_doc.get("email"), e)

    await db.users.update_one(
        {"user_id": user_doc["user_id"]},
        {"$set": set_updates},
    )
    return True


# ---------------------------------------------------------------------
# Preferences + manual preview
# ---------------------------------------------------------------------

class FriendsFinishedPrefsBody(BaseModel):
    email_enabled: bool


@api_router.get("/recommendations/friends-finished/settings")
async def get_friends_finished_settings(user: User = Depends(get_current_user)):
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "friends_finished": 1},
    ) or {}
    from deps import RESEND_API_KEY  # local import
    prefs = _get_friends_finished_prefs(doc)
    prefs["email_configured"] = bool(RESEND_API_KEY)
    return prefs


@api_router.put("/recommendations/friends-finished/settings")
async def update_friends_finished_settings(
    body: FriendsFinishedPrefsBody, user: User = Depends(get_current_user),
):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"friends_finished.email_enabled": bool(body.email_enabled)}},
    )
    return await get_friends_finished_settings(user)


@api_router.post("/recommendations/friends-finished/preview")
async def preview_friends_finished(
    send_email: bool = False, user: User = Depends(get_current_user),
):
    """Force-fire the digest right now (bypassing the per-week cooldown).

    Always sends the in-app notification when there's at least one matching
    book. Set `?send_email=true` to also send the email — used by the
    "Send sample email" button. Honours the email_enabled prefs irrelevant
    of the send_email query (so users can preview emails before enabling).
    """
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    payload = await _collect_friends_finished_payload(user.user_id)
    if payload["total"] == 0:
        return {"fired": False, "email_sent": False, "reason": "no_new_finishes", **payload}

    # In-app: bypass weekly cooldown for previews.
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$unset": {"friends_finished.last_year_week": ""}},
    )
    user_doc.pop("friends_finished", None)
    fired = await maybe_send_friends_finished_digest(user_doc)

    email_result: Dict[str, Any] = {"delivered": False, "skipped": True}
    if send_email:
        # Direct call — don't gate on the user pref since this is an explicit preview action.
        email_result = await _send_friends_finished_email(user_doc, payload)

    return {
        "fired": fired,
        "email_sent": bool(email_result.get("delivered")),
        "email_logged": bool(email_result.get("logged")),
        "email_error": email_result.get("error"),
        **payload,
    }



# ---------------------------------------------------------------------
# Affinity-based recommendations  (2026-06-18)
#
# Looks at the user's own library, picks their top 3 fandoms + top 3
# authors, then surfaces community covers from the shared pool that
# match those affinities and aren't already in the user's library.
# A "you might also like…" surface backed by the existing community-
# cover catalogue — no external book API needed.
# ---------------------------------------------------------------------

@api_router.get("/recommendations/by-affinity")
async def affinity_recommendations(
    limit: int = 12,
    user: User = Depends(get_current_user),
):
    """Returns community covers whose title+author matches one of the
    user's top fandoms / top authors but that the user doesn't
    already have a book for.  Powers the "More from authors you read"
    rail on the recommendations page."""
    limit = max(1, min(int(limit or 12), 60))

    # Aggregate the user's library by fandom and author to find their
    # top three of each.
    own_books = db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "title": 1, "author": 1, "fandom": 1, "category": 1},
    )
    fandom_counts: Dict[str, int] = {}
    author_counts: Dict[str, int] = {}
    own_keys: set = set()
    async for b in own_books:
        f = (b.get("fandom") or "").strip()
        a = (b.get("author") or "").strip()
        t = (b.get("title") or "").strip().lower()
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
        if a:
            author_counts[a] = author_counts.get(a, 0) + 1
        if t and a:
            own_keys.add((t, a.lower()))

    top_fandoms = [k for k, _ in sorted(fandom_counts.items(), key=lambda x: -x[1])[:3]]
    top_authors = [k for k, _ in sorted(author_counts.items(), key=lambda x: -x[1])[:3]]

    # Build the DNF blocklist: any author whose books the user has
    # explicitly marked Did-Not-Finish.  Stops the rec engine from
    # nagging the user with more by an author they've given up on.
    dnf_cursor = db.books.find(
        {"user_id": user.user_id, "is_dnf": True},
        {"_id": 0, "author": 1},
    )
    dnf_authors: set = set()
    async for b in dnf_cursor:
        a = (b.get("author") or "").strip().lower()
        if a:
            dnf_authors.add(a)

    if not top_fandoms and not top_authors:
        return {"top_fandoms": [], "top_authors": [], "recommendations": []}

    # Build an OR query against the community pool.  Use the normalised
    # *_key fields so casing differences don't matter.
    or_clauses: List[Dict[str, Any]] = []
    for f in top_fandoms:
        or_clauses.append({"fandom_key": f.lower()})
    for a in top_authors:
        or_clauses.append({"author_key": a.lower()})
    if not or_clauses:
        return {"top_fandoms": top_fandoms, "top_authors": top_authors, "recommendations": []}

    cursor = (
        db.community_covers.find(
            {"$or": or_clauses, "shared_by_user_id": {"$ne": user.user_id}},
            {"_id": 0},
        )
        .sort([("votes", -1), ("import_count", -1), ("shared_at", -1)])
        .limit(limit * 3)   # over-fetch to allow filtering own books
    )
    import base64
    from pathlib import Path
    cov_dir = Path("/app/community_covers")
    out: List[Dict[str, Any]] = []
    async for c in cursor:
        # Skip if user already owns a book with this title+author.
        key = ((c.get("title") or "").strip().lower(), (c.get("author") or "").strip().lower())
        if key in own_keys:
            continue
        # Skip DNF'd authors entirely — user already abandoned them.
        if key[1] in dnf_authors:
            continue
        path = cov_dir / c["file"]
        if not path.exists():
            continue
        f_match = c.get("fandom", "") in top_fandoms
        a_match = c.get("author", "") in top_authors
        reason = []
        if f_match:
            reason.append(f"fandom: {c.get('fandom', '')}")
        if a_match:
            reason.append(f"author: {c.get('author', '')}")
        out.append({
            "cover_id":     c["cover_id"],
            "title":        c.get("title", ""),
            "author":       c.get("author", ""),
            "fandom":       c.get("fandom", ""),
            "shared_by":    c.get("shared_by_username", "anon"),
            "votes":        int(c.get("votes", 0)),
            "import_count": int(c.get("import_count", 0)),
            "match_reason": " · ".join(reason) or "you might also like",
            "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "mime_type":    "image/png",
        })
        if len(out) >= limit:
            break

    return {
        "top_fandoms":     top_fandoms,
        "top_authors":     top_authors,
        "recommendations": out,
    }



# ---------------------------------------------------------------------
# Similar-from-your-library suggestions  (2026-06-20)
# ---------------------------------------------------------------------
# Powers the "Finished on device. Want a similar one?" strip on the
# Book Detail page.  Given a seed book, returns up to ``limit`` other
# books from the *same* user's library that share the seed's fandom
# or author, prioritising unfinished ones so the user has somewhere
# to go after they close the cover.
#
# Why library-local instead of community/embedding-based?  The user
# explicitly wants their own catalogue resurfaced — these are books
# they've already chosen to keep but might have forgotten about.
# Embedding-based community recs already live behind
# ``/recommendations/by-affinity``.
@api_router.get("/recommendations/similar/{book_id}")
async def similar_in_library(
    book_id: str,
    limit: int = 6,
    user: User = Depends(get_current_user),
):
    """Return books from the user's library similar to ``book_id``.

    Match priority (highest score first):
      score = (fandom_match × 3) + (author_match × 2)
            + (unfinished ? 1 : 0)
            + recency_bonus       # max 1.0
    """
    limit = max(1, min(int(limit or 6), 20))

    seed = await db.books.find_one(
        {"user_id": user.user_id, "book_id": book_id},
        {
            "_id": 0, "book_id": 1, "user_id": 1,
            "title": 1, "author": 1, "fandom": 1, "category": 1,
        },
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Book not found")

    seed_fandom = (seed.get("fandom") or "").strip().lower()
    seed_author = (seed.get("author") or "").strip().lower()
    if not seed_fandom and not seed_author:
        return {"seed": {"book_id": book_id}, "recommendations": []}

    # Pull every other book in the library — we filter+rank in-process.
    # Excludes the seed itself, the Old Stories archive, and the Trash.
    candidates = await db.books.find(
        {
            "user_id": user.user_id,
            "book_id": {"$ne": book_id},
            "category": {"$nin": ["Trash", "Old stories"]},
        },
        {
            "_id": 0, "book_id": 1,
            "title": 1, "author": 1, "fandom": 1, "category": 1,
            "progress_fraction": 1, "has_cover": 1,
            "last_opened_at": 1, "created_at": 1,
        },
    ).to_list(length=5000)

    now = datetime.now(timezone.utc)
    ranked: List[Dict[str, Any]] = []
    for c in candidates:
        f = (c.get("fandom") or "").strip().lower()
        a = (c.get("author") or "").strip().lower()
        fandom_match = bool(seed_fandom) and f == seed_fandom
        author_match = bool(seed_author) and a == seed_author
        if not fandom_match and not author_match:
            continue

        pf = float(c.get("progress_fraction") or 0.0)
        unfinished = pf < 0.95

        # Recency: prefer books the user hasn't opened in a while
        # (re-discovery) — but not so old they've forgotten them.
        # Cap at +1.0 so it never dominates the fandom/author signal.
        recency_bonus = 0.0
        last_opened = c.get("last_opened_at")
        if isinstance(last_opened, datetime):
            days = (now - last_opened.replace(tzinfo=last_opened.tzinfo or timezone.utc)).days
            # Sweet spot: 30–180 days untouched.
            if 30 <= days <= 180:
                recency_bonus = 1.0
            elif days > 180:
                recency_bonus = 0.5
        elif last_opened is None:
            # Never opened — perfect candidate for "you should try this".
            recency_bonus = 1.0

        score = (
            (3.0 if fandom_match else 0.0)
            + (2.0 if author_match else 0.0)
            + (1.0 if unfinished else 0.0)
            + recency_bonus
        )

        # Build the reason chip the UI shows below the title.
        reasons: List[str] = []
        if fandom_match:
            reasons.append(f"same fandom: {c.get('fandom') or ''}")
        if author_match:
            reasons.append(f"same author: {c.get('author') or ''}")

        ranked.append({
            "book_id": c["book_id"],
            "title": c.get("title") or "(untitled)",
            "author": c.get("author") or "",
            "fandom": c.get("fandom") or "",
            "category": c.get("category") or "",
            "progress_fraction": pf,
            "has_cover": bool(c.get("has_cover", False)),
            "match_reason": " · ".join(reasons) or "you might enjoy this",
            "_score": score,
        })

    ranked.sort(key=lambda x: x["_score"], reverse=True)
    out = ranked[:limit]
    for r in out:
        r.pop("_score", None)

    return {
        "seed": {
            "book_id": seed["book_id"],
            "title":   seed.get("title") or "",
            "fandom":  seed.get("fandom") or "",
            "author":  seed.get("author") or "",
        },
        "recommendations": out,
    }
