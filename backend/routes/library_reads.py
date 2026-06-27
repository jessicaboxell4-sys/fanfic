"""Library read-path endpoints, extracted from ``routes/books.py`` as
part of Phase 6D (2026-06-27).

These are the high-frequency GET routes the dashboard and library
pages call to render lists, stats, and search results.  They don't
mutate state, so the boundary with ``books.py`` is clean — only
helpers are imported one-way (no cycles).

Routes:
    GET  /api/books                     — paginated/filtered list
    GET  /api/books/stats               — totals + category/fandom/relationship aggregates
    GET  /api/books/export/unavailable  — .txt download of "can't find" books
    GET  /api/books/recent              — Continue Reading rail
    GET  /api/books/recent-updates      — bell-badge feed of refreshed fics
    POST /api/books/{id}/mark-update-seen
    POST /api/books/mark-updates-seen   — clear bell badge
    GET  /api/books/quick-search        — typeahead title/author search
    GET  /api/fandoms                   — distinct fandoms + crossover count
    GET  /api/authors/{name}            — all books by author

The two ``mark-update-seen`` writes live alongside the reads because
they're a UI-side acknowledgement (no data transformation, no
fan-out), and pairing them with ``recent-updates`` keeps the
notification cluster cohesive.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from fastapi import Depends, HTTPException, Request, Response

from deps import db, api_router
from models import User
from auth_dep import get_current_user
from utils.constants import TRASH_SHELF


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _suggest_search_url(source_url: Optional[str], title: str, author: str) -> Optional[str]:
    """Build a 'find it again' search URL on the same site as the dead source.

    Used by the unavailable-books export so the reader can manually
    look up a renamed/orphaned fic on the same host.
    """
    q = quote_plus(f"{title or ''} {author or ''}".strip())
    if not q:
        return None
    host = (source_url or "").lower()
    if "archiveofourown.org" in host:
        return f"https://archiveofourown.org/works/search?work_search%5Bquery%5D={q}"
    if "fanfiction.net" in host:
        return f"https://www.fanfiction.net/search/?keywords={q}&type=story"
    if "fictionpress.com" in host:
        return f"https://www.fictionpress.com/search/?keywords={q}&type=story"
    if "royalroad.com" in host:
        return f"https://www.royalroad.com/fictions/search?title={q}"
    if (
        "spacebattles.com" in host
        or "sufficientvelocity.com" in host
        or "questionablequesting.com" in host
    ):
        base = host.split("/")[2] if "://" in host else host
        return f"https://www.google.com/search?q=site%3A{base}+{q}"
    # Generic fallback: Google
    return f"https://www.google.com/search?q={q}"


# ---------------------------------------------------------------------------
# Main library list
# ---------------------------------------------------------------------------

@api_router.get("/books")
async def list_books(
    request: Request,  # noqa: ARG001 — kept for future per-request features
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    relationship: Optional[str] = None,
    character: Optional[str] = None,
    q: Optional[str] = None,
    smart: Optional[str] = None,
    include_originals: bool = False,
    rating: Optional[str] = None,
    ao3_category: Optional[str] = None,
    warning: Optional[str] = None,
    exclude_warning: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query['category'] = category
    else:
        # Trash is opt-in — only show when the user explicitly asks for it
        query['category'] = {"$ne": TRASH_SHELF}
    if fandom:
        query['fandom'] = fandom
    if relationship:
        query['relationships'] = relationship
    if character and character.strip():
        # Match any relationship string that mentions this character.
        # Characters aren't stored as a first-class field — they're
        # derived from the canonical ``relationships`` array (see
        # ``routes/characters.py``).  A case-insensitive regex on
        # the escaped name is enough: chip clicks always pass the
        # full derived name (e.g. "Harry Potter"), so partial-name
        # collisions like "Harry" vs "Harry Potter" don't happen in
        # the normal navigation flow.
        import re as _re
        query['relationships'] = {
            "$regex": _re.escape(character.strip()),
            "$options": "i",
        }
    # AO3 metadata filters (added 2026-06-13). Each is exact-match on a
    # canonical value (e.g. "Mature", "M/M", "Graphic Depictions Of Violence").
    if rating:
        query['rating'] = rating
    if ao3_category:
        query['categories'] = ao3_category
    if warning:
        query['warnings'] = warning
    if exclude_warning:
        # "Hide books warned for X" — content-safety filter. Returns books
        # whose ``warnings`` array does NOT contain the given value.
        query.setdefault('warnings', {})
        if isinstance(query['warnings'], dict):
            query['warnings']['$ne'] = exclude_warning
        else:
            # warning was also set — combine into $and so both apply.
            query['$and'] = query.get('$and', []) + [
                {'warnings': query['warnings']},
                {'warnings': {'$ne': exclude_warning}},
            ]
            del query['warnings']
    # Originals (kept-as-is non-EPUBs) live on /library/originals — exclude
    # them from the main library unless explicitly asked.
    if not include_originals and not (category == "Originals"):
        query['original_only'] = {"$ne": True}

    or_clauses: List[List[Dict[str, Any]]] = []
    if q:
        or_clauses.append([
            {"title": {"$regex": q, "$options": "i"}},
            {"author": {"$regex": q, "$options": "i"}},
        ])

    if smart == "reading":
        query['progress_fraction'] = {"$gte": 0.05, "$lt": 0.95}
    elif smart == "finished":
        query['progress_fraction'] = {"$gte": 0.99}
    elif smart == "unavailable":
        query['unavailable'] = True
    elif smart == "unread":
        or_clauses.append([
            {"progress_fraction": {"$exists": False}},
            {"progress_fraction": None},
            {"progress_fraction": {"$lt": 0.05}},
        ])

    if len(or_clauses) == 1:
        query["$or"] = or_clauses[0]
    elif len(or_clauses) > 1:
        query["$and"] = [{"$or": clauses} for clauses in or_clauses]

    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"books": books}


# ---------------------------------------------------------------------------
# Stats overview
# ---------------------------------------------------------------------------

@api_router.get("/books/stats")
async def book_stats(user: User = Depends(get_current_user)):
    pipeline_cat = [
        {"$match": {"user_id": user.user_id}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]
    pipeline_fandom = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    pipeline_rel = [
        {"$match": {"user_id": user.user_id, "relationships": {"$exists": True, "$ne": []}}},
        {"$unwind": "$relationships"},
        {"$group": {"_id": "$relationships", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    cats = await db.books.aggregate(pipeline_cat).to_list(100)
    fandoms = await db.books.aggregate(pipeline_fandom).to_list(100)
    relationships = await db.books.aggregate(pipeline_rel).to_list(200)
    total = await db.books.count_documents({"user_id": user.user_id})
    reading = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_fraction": {"$gte": 0.05, "$lt": 0.95},
    })
    finished = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_fraction": {"$gte": 0.99},
    })
    unreadable = await db.books.count_documents({
        "user_id": user.user_id,
        "epub_unreadable": True,
    })
    return {
        "total": total,
        "reading": reading,
        "finished": finished,
        "unreadable": unreadable,
        "categories": [{"name": c['_id'], "count": c['count']} for c in cats],
        "fandoms": [{"name": f['_id'], "count": f['count']} for f in fandoms],
        "relationships": [{"name": r['_id'], "count": r['count']} for r in relationships],
        "crossover_count": sum(
            1 for f in fandoms
            if f.get('_id') and len([p for p in str(f['_id']).split(' / ') if p.strip()]) >= 2
        ),
    }


# ---------------------------------------------------------------------------
# Unavailable-books export (.txt)
# ---------------------------------------------------------------------------

@api_router.get("/books/export/unavailable")
async def export_unavailable_list(user: User = Depends(get_current_user)):
    """A plain .txt list of every book FanFicFare couldn't find — for manual lookup."""
    books = await db.books.find(
        {"user_id": user.user_id, "unavailable": True},
        {"_id": 0},
    ).sort("title", 1).to_list(5000)

    lines: List[str] = []
    lines.append("Shelfsort — books we couldn't fetch online")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"Count: {len(books)}")
    lines.append("=" * 70)
    lines.append("")
    if not books:
        lines.append("(none — every refreshable book updated successfully)")
    else:
        for i, b in enumerate(books, 1):
            shelf = b.get("category") or "Uncategorized"
            if shelf == "Fanfiction" and b.get("fandom"):
                shelf = f"Fanfiction / {b['fandom']}"
            lines.append(f"{i}. {b.get('title') or '(untitled)'}")
            lines.append(f"   Author:      {b.get('author') or 'Unknown'}")
            lines.append(f"   Shelf:       {shelf}")
            if b.get("source_url"):
                lines.append(f"   Source URL:  {b['source_url']}")
            if b.get("last_fetch_error"):
                lines.append(f"   Source said: {b['last_fetch_error']}")
            if b.get("last_fetch_attempt_at"):
                lines.append(f"   Last tried:  {b['last_fetch_attempt_at']}")
            search = _suggest_search_url(
                b.get("source_url"), b.get("title", ""), b.get("author", "")
            )
            if search:
                lines.append(f"   How to fix:  {search}")
            lines.append("")
    body = "\n".join(lines) + "\n"
    headers = {"Content-Disposition": "attachment; filename=shelfsort_cant_find_online.txt"}
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)


# ---------------------------------------------------------------------------
# Recently-opened (Continue Reading) + Recent updates bell badge
# ---------------------------------------------------------------------------

@api_router.get("/books/recent")
async def list_recent(limit: int = 8, user: User = Depends(get_current_user)):
    """Recently-opened books for the dashboard's Continue Reading rail.

    For each book we also attach the latest ``reading_cursors`` entry
    (`last_device_id`, `last_device_label`, `last_cursor_updated_at`)
    so the rail can render a "📱 Last on iPhone · 2h ago" caption when
    the most recent reading happened on a different device than the
    one currently viewing the dashboard.  This turns the cross-device
    sync from invisible plumbing into a visible delight.
    """
    cursor = db.books.find(
        {"user_id": user.user_id, "last_opened_at": {"$ne": None, "$exists": True}},
        {"_id": 0},
    ).sort("last_opened_at", -1).limit(max(1, min(int(limit), 24)))
    books = await cursor.to_list(24)

    if not books:
        return {"books": books}

    # Side-fetch the latest cursor per book in a single Mongo round trip.
    book_ids = [b["book_id"] for b in books]
    cursor_rows = await db.reading_cursors.find(
        {"user_id": user.user_id, "book_id": {"$in": book_ids}},
        {"_id": 0, "book_id": 1, "device_id": 1, "device_label": 1, "updated_at": 1},
    ).to_list(length=len(book_ids))
    cursor_by_book = {c["book_id"]: c for c in cursor_rows}
    for b in books:
        c = cursor_by_book.get(b["book_id"])
        if c:
            b["last_device_id"]         = c.get("device_id")
            b["last_device_label"]      = c.get("device_label") or ""
            ts = c.get("updated_at")
            if isinstance(ts, datetime):
                ts = ts.isoformat()
            b["last_cursor_updated_at"] = ts
    return {"books": books}


@api_router.get("/books/recent-updates")
async def recent_updates(limit: int = 8, user: User = Depends(get_current_user)):
    """Fanfics that have been refreshed and haven't been marked as seen.
    Powers the "fics updated" navbar bell badge."""
    limit = max(1, min(int(limit), 24))
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "replaces": {"$ne": None, "$exists": True},
            "update_seen": {"$ne": True},
        },
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "fandom": 1,
            "category": 1,
            "last_refreshed_at": 1,
            "replaces": 1,
            "refresh_summary": 1,
            "has_cover": 1,
        },
    ).sort("last_refreshed_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    # Total unseen (so the badge can say "8+" if there are more)
    total_unseen = await db.books.count_documents({
        "user_id": user.user_id,
        "replaces": {"$ne": None, "$exists": True},
        "update_seen": {"$ne": True},
    })
    return {"updates": items, "total_unseen": total_unseen}


@api_router.post("/books/{book_id}/mark-update-seen")
async def mark_update_seen(book_id: str, user: User = Depends(get_current_user)):
    """Mark a single refreshed book as seen — removes it from the bell badge."""
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"update_seen": True, "update_seen_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.post("/books/mark-updates-seen")
async def mark_all_updates_seen(user: User = Depends(get_current_user)):
    """Mark every pending refreshed book as seen — clears the bell badge."""
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.books.update_many(
        {
            "user_id": user.user_id,
            "replaces": {"$ne": None, "$exists": True},
            "update_seen": {"$ne": True},
        },
        {"$set": {"update_seen": True, "update_seen_at": now_iso}},
    )
    return {"ok": True, "marked": result.modified_count}


# ---------------------------------------------------------------------------
# Quick-search typeahead
# ---------------------------------------------------------------------------

@api_router.get("/books/quick-search")
async def quick_search_books(q: str, limit: int = 8, user: User = Depends(get_current_user)):
    """Lightweight title/author typeahead — feeds the navbar quick-search dropdown.

    Case-insensitive *substring* match against title + author (NOT full-body
    text — see `/library/search/fulltext` for the heavier search). Excludes
    trashed / replaced books.  Returns minimal fields so the dropdown stays
    snappy.
    """
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"books": []}
    limit = max(1, min(limit, 20))
    safe = re.escape(needle)
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": "Trash"},
            "replaced_by": {"$exists": False},
            "$or": [
                {"title": {"$regex": safe, "$options": "i"}},
                {"author": {"$regex": safe, "$options": "i"}},
            ],
        },
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "category": 1, "fandom": 1},
    ).sort([("last_opened_at", -1), ("title", 1)]).limit(limit)
    out = []
    async for b in cursor:
        out.append({
            "book_id":  b["book_id"],
            "title":    b.get("title", ""),
            "author":   b.get("author", ""),
            "category": b.get("category", ""),
            "fandom":   b.get("fandom", []),
        })
    return {"books": out}


# ---------------------------------------------------------------------------
# Per-library fandom + author aggregates
# ---------------------------------------------------------------------------

@api_router.get("/fandoms")
async def list_fandoms(user: User = Depends(get_current_user)):
    """Distinct fandoms in the user's library with book counts.

    Used by the Download page so all fandoms appear (not just the top 8 that
    /stats/overview returns for the dashboard). Each row is annotated with
    `is_crossover` + `parts` so the UI can render the crossover treatment
    without re-parsing strings.
    """
    pipeline = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)
    fandoms: List[Dict[str, Any]] = []
    crossover_count = 0
    for r in rows:
        name = r.get("_id")
        if not name or not str(name).strip():
            continue
        parts = [p.strip() for p in str(name).split(" / ") if p.strip()]
        is_x = len(parts) >= 2
        if is_x:
            crossover_count += 1
        fandoms.append({
            "name":         name,
            "count":        r["count"],
            "is_crossover": is_x,
            "parts":        parts if is_x else [],
        })
    return {"fandoms": fandoms, "crossover_count": crossover_count}


@api_router.get("/authors/{name}")
async def get_author(name: str, user: User = Depends(get_current_user)):
    """All books by this author, newest first."""
    books = await db.books.find(
        {"user_id": user.user_id, "author": name},
        {"_id": 0},
    ).sort("created_at", -1).to_list(2000)
    return {"name": name, "books": books}
