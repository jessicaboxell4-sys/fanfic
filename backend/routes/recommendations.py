"""Friend-recommendations widget — surfaces books my friends loved that I don't own yet.

Signals (combined into a score):
  +3 per friend who FINISHED the book (progress_percent >= 0.95)
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
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


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
                {"progress_percent": {"$gte": 0.95}},
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
            "progress_percent": 1, "reading_minutes": 1,
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

        finished = float(c.get("progress_percent") or 0) >= 0.95
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
