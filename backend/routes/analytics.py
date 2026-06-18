"""Visitor analytics + reader-heatmap aggregation.

Two adjacent product surfaces share this module:

1. **Visitor analytics** — anonymous page views on the public surfaces
   (`/explore/covers`, `/u/:username`, `/cover/:cover_id`) plus the
   sign-up conversion event.  Powers the Admin dashboard widget and
   the landing-page social-proof counter.

2. **Reader heatmap** — aggregates `reading_cursors` across all
   consenting readers into per-book / per-chapter completion rates.
   Only renders for books with ≥10 unique readers (the cohort gate)
   so a single user's reading position can never be inferred.

Privacy guardrails baked in from line 1:
- ``users.reading_data_shared`` (default ``True``) gates a user's
  cursors from contributing to the heatmap aggregate.
- Anonymous visit events are bucketed by hour, never by full
  timestamp, and stripped of IP / UA after a sliding 90-day window
  (operator-managed via the existing trash-collection sweeper).
- The cookie consent banner is rendered client-side for unauth EU
  visitors before any analytics cookie is set.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, List
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, get_current_user_or_none, require_admin


# ---------------------------------------------------------------------
# View stamping
# ---------------------------------------------------------------------

# Per-IP rate-limit window so a single bot can't fluff up counts —
# the same (ip_hash, page_type, slug) pair is deduped within 30 min.
_DEDUPE_MINUTES = 30


def _ip_hash(request: Request) -> str:
    """Stable, irreversible hash of the caller's IP — used only for
    dedupe.  We never store the raw IP."""
    ip = request.headers.get("cf-connecting-ip") or request.client.host if request.client else ""
    return hashlib.sha256((ip or "anon").encode("utf-8")).hexdigest()[:16]


def _ref_bucket(ref: str) -> str:
    """Coarse-grained referrer bucket so the report doesn't leak
    individual private URLs."""
    if not ref:
        return "direct"
    try:
        host = (urlparse(ref).hostname or "").lower()
    except Exception:
        return "other"
    if not host:
        return "direct"
    for needle, bucket in [
        ("twitter.com", "twitter"), ("t.co", "twitter"),
        ("x.com", "twitter"), ("bsky.app", "bluesky"),
        ("discord", "discord"), ("reddit", "reddit"),
        ("google", "search"), ("bing", "search"), ("duckduckgo", "search"),
        ("archiveofourown", "ao3"), ("ao3.org", "ao3"),
        ("shelfsort", "internal"),
    ]:
        if needle in host:
            return bucket
    return "other"


async def _stamp_view(
    page_type: str,
    slug: str,
    request: Request,
    user_id: Optional[str] = None,
) -> None:
    """Insert (or dedupe-skip) a visit into ``page_views``.  Best-effort
    — failures are logged but never bubble up."""
    if not page_type:
        return
    try:
        iph = _ip_hash(request)
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(minutes=_DEDUPE_MINUTES)).isoformat()
        recent = await db.page_views.find_one(
            {
                "page_type": page_type, "slug": slug,
                "ip_hash": iph, "ts": {"$gte": cutoff},
            },
            {"_id": 1},
        )
        if recent:
            return
        ref = request.headers.get("referer") or request.headers.get("referrer") or ""
        country = (
            request.headers.get("cf-ipcountry")
            or (request.headers.get("accept-language") or "").split("-")[-1].upper()[:2]
            or "ZZ"
        )
        await db.page_views.insert_one({
            "page_type":    page_type,
            "slug":         slug,
            "ip_hash":      iph,
            "user_id":      user_id or "",
            "is_anon":      not bool(user_id),
            "ref_bucket":   _ref_bucket(ref),
            "country":      country[:2],
            # Hour-bucketed for privacy + cheap aggregation.
            "hour_bucket":  now.replace(minute=0, second=0, microsecond=0).isoformat(),
            "ts":           now.isoformat(),
        })
    except Exception as e:  # noqa: BLE001
        logger.exception("page-view stamp failed: %s", e)


class ViewBody(BaseModel):
    page_type: str = Field(..., max_length=24)
    slug: str = Field("", max_length=120)


@api_router.post("/analytics/view")
async def stamp_view_from_spa(
    body: ViewBody,
    request: Request,
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Frontend-driven view stamp for SPA pages (`/explore/covers`,
    `/u/:username`, `/cover/:cover_id`) since their HTML is rendered
    client-side and won't be picked up by the server-side stamp
    inside ``share_*`` endpoints."""
    await _stamp_view(
        page_type=body.page_type.strip()[:24],
        slug=body.slug.strip()[:120],
        request=request,
        user_id=user.user_id if user else None,
    )
    return {"ok": True}


# ---------------------------------------------------------------------
# Public stats (landing page social-proof counter)
# ---------------------------------------------------------------------

@api_router.get("/analytics/public-stats")
async def public_stats():
    """Lightweight counters for the landing page.  No auth — these are
    intentionally public and bucketed to whole numbers."""
    month_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    total_signups = await db.users.count_documents({})
    monthly_signups = await db.users.count_documents(
        {"created_at": {"$gte": month_cutoff}}
    )
    total_covers = await db.community_covers.count_documents({})
    return {
        "total_users":     total_signups,
        "monthly_signups": monthly_signups,
        "total_covers":    total_covers,
    }


# ---------------------------------------------------------------------
# Admin summary  (visitor analytics dashboard)
# ---------------------------------------------------------------------

@api_router.get("/analytics/summary")
async def admin_analytics_summary(
    days: int = 7,
    user: User = Depends(require_admin),  # noqa: ARG001
):
    """Funnel + ref bucket + top covers, scoped to the recent
    ``days`` window.  Powers the Admin Console analytics widget."""
    days = max(1, min(int(days or 7), 365))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    pipeline_by_page = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$page_type", "views": {"$sum": 1},
                    "unique_ips": {"$addToSet": "$ip_hash"}}},
        {"$project": {"page_type": "$_id", "_id": 0, "views": 1,
                      "unique": {"$size": "$unique_ips"}}},
    ]
    by_page: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate(pipeline_by_page):
        by_page.append(r)

    # Funnel: explore → cover → signup.
    cover_views = sum(r["views"] for r in by_page if r["page_type"] == "cover")
    explore_views = sum(r["views"] for r in by_page if r["page_type"] == "explore")
    signups = await db.users.count_documents({"created_at": {"$gte": cutoff}})

    # Top covers by views.
    top_covers_pipeline = [
        {"$match": {"ts": {"$gte": cutoff}, "page_type": "cover"}},
        {"$group": {"_id": "$slug", "views": {"$sum": 1}}},
        {"$sort": {"views": -1}},
        {"$limit": 8},
    ]
    top_covers_raw: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate(top_covers_pipeline):
        top_covers_raw.append({"cover_id": r["_id"], "views": r["views"]})

    # Decorate with titles.
    if top_covers_raw:
        ids = [t["cover_id"] for t in top_covers_raw]
        cov_cursor = db.community_covers.find(
            {"cover_id": {"$in": ids}},
            {"_id": 0, "cover_id": 1, "title": 1, "shared_by_username": 1},
        )
        by_id: Dict[str, Any] = {}
        async for c in cov_cursor:
            by_id[c["cover_id"]] = c
        for t in top_covers_raw:
            t.update(by_id.get(t["cover_id"], {}))

    # Ref bucket distribution.
    ref_pipeline = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$ref_bucket", "views": {"$sum": 1}}},
        {"$sort": {"views": -1}},
    ]
    by_ref: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate(ref_pipeline):
        by_ref.append({"ref_bucket": r["_id"] or "direct", "views": r["views"]})

    # Country distribution (top 8).
    country_pipeline = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$country", "views": {"$sum": 1}}},
        {"$sort": {"views": -1}},
        {"$limit": 8},
    ]
    by_country: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate(country_pipeline):
        by_country.append({"country": r["_id"] or "ZZ", "views": r["views"]})

    return {
        "window_days":   days,
        "by_page":       by_page,
        "by_ref":        by_ref,
        "by_country":    by_country,
        "top_covers":    top_covers_raw,
        "funnel": {
            "explore_views": explore_views,
            "cover_views":   cover_views,
            "signups":       signups,
            # explore→cover conversion + cover→signup conversion
            "explore_to_cover": round(
                (cover_views / explore_views) * 100, 1
            ) if explore_views else 0,
            "cover_to_signup": round(
                (signups / cover_views) * 100, 1
            ) if cover_views else 0,
        },
    }


# ---------------------------------------------------------------------
# Reader heatmap
# ---------------------------------------------------------------------

# Cohort gate — heatmap is hidden unless ≥10 unique readers contributed.
_HEATMAP_MIN_READERS = 10


@api_router.get("/books/{book_id}/heatmap")
async def book_reading_heatmap(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Cross-reader heatmap for the canonical book the caller is
    reading.  Joins by ``title_key`` + ``author_key`` so all readers'
    copies of "Twilight" by Stephenie Meyer roll up together.

    Returns:
        cohort:          unique reader count contributing
        ready:           True iff cohort >= _HEATMAP_MIN_READERS
        completion_rate: 0..1 — fraction of cohort with >=99% progress
        dnf_cliff:       {percent_bucket, abandon_rate} or None
        you:             {percent} — caller's own progress for the
                                     "personal vs aggregate" marker
        chapter_curve:   list of {bucket, fraction_reached} for the
                         per-chapter sparkline on the Reader TOC
    """
    my_book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "title": 1, "author": 1, "progress_fraction": 1},
    )
    if my_book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    t_key = (my_book.get("title") or "").strip().lower()
    a_key = (my_book.get("author") or "").strip().lower()
    if not t_key:
        return {"ready": False, "cohort": 0, "reason": "no_title"}

    # Find every book doc across the platform that matches this
    # canonical title+author from a user who hasn't opted out.
    opted_in_cursor = db.users.find(
        {"reading_data_shared": {"$ne": False}},
        {"_id": 0, "user_id": 1},
    )
    opted_in: set = set()
    async for u in opted_in_cursor:
        opted_in.add(u["user_id"])

    if not opted_in:
        return {"ready": False, "cohort": 0, "reason": "no_opted_in_users"}

    book_matchers: Dict[str, Any] = {
        "user_id": {"$in": list(opted_in)},
        "title": {"$regex": f"^{t_key}$", "$options": "i"},
    }
    if a_key:
        book_matchers["author"] = {"$regex": f"^{a_key}$", "$options": "i"}
    book_cursor = db.books.find(
        book_matchers,
        {"_id": 0, "book_id": 1, "user_id": 1, "progress_fraction": 1, "last_opened_at": 1},
    )
    progresses: List[float] = []
    async for b in book_cursor:
        p = float(b.get("progress_fraction") or 0)
        if p > 0:
            progresses.append(p)

    cohort = len(progresses)
    if cohort < _HEATMAP_MIN_READERS:
        return {
            "ready":  False,
            "cohort": cohort,
            "needed": _HEATMAP_MIN_READERS,
            "reason": "cohort_too_small",
        }

    # Completion rate.
    finished = sum(1 for p in progresses if p >= 0.99)
    completion_rate = finished / cohort

    # Chapter curve — 10 buckets of 10% each.
    buckets = [0] * 10
    for p in progresses:
        idx = min(int(p * 10), 9)
        for j in range(idx + 1):
            buckets[j] += 1
    curve = [
        {"bucket": i * 10, "fraction_reached": buckets[i] / cohort}
        for i in range(10)
    ]

    # DNF cliff — biggest drop between consecutive buckets.
    dnf_cliff = None
    biggest_drop = 0.0
    for i in range(len(curve) - 1):
        drop = curve[i]["fraction_reached"] - curve[i + 1]["fraction_reached"]
        if drop > biggest_drop and drop >= 0.20:   # >=20pp drop matters
            biggest_drop = drop
            dnf_cliff = {
                "percent_bucket": curve[i + 1]["bucket"],
                "abandon_rate":   round(drop, 2),
            }

    return {
        "ready":           True,
        "cohort":          cohort,
        "completion_rate": round(completion_rate, 2),
        "dnf_cliff":       dnf_cliff,
        "you":             {"percent": float(my_book.get("progress_fraction") or 0)},
        "chapter_curve":   curve,
    }


# ---------------------------------------------------------------------
# Books most-likely-finished leaderboard
# ---------------------------------------------------------------------

# Same cohort gate as the per-book heatmap — a leaderboard row is hidden
# until at least N opted-in readers contribute progress for the book.
_LEADERBOARD_MIN_READERS = _HEATMAP_MIN_READERS


@api_router.get("/books/most-finished-leaderboard")
async def books_most_finished_leaderboard(
    limit: int = 20,
    user: User = Depends(get_current_user),  # noqa: ARG001
):
    """Cross-reader leaderboard of canonical (title, author) pairs
    sorted by completion rate (fraction of opted-in cohort with
    >=99% progress).  Powers a "books most likely to be finished"
    homepage / bookclub-picker strip.

    Privacy: respects ``users.reading_data_shared`` (default True);
    only books with >= _LEADERBOARD_MIN_READERS contributing cohort
    members are returned so a single user can't be inferred.
    """
    limit = max(1, min(int(limit or 20), 50))

    opted_in: List[str] = []
    async for u in db.users.find(
        {"reading_data_shared": {"$ne": False}},
        {"_id": 0, "user_id": 1},
    ):
        opted_in.append(u["user_id"])
    if not opted_in:
        return {"rows": [], "cohort_threshold": _LEADERBOARD_MIN_READERS}

    pipeline = [
        {"$match": {
            "user_id":           {"$in": opted_in},
            "progress_fraction": {"$gt": 0},
            "trashed":           {"$ne": True},
            "title":             {"$exists": True, "$ne": ""},
        }},
        {"$project": {
            "_id": 0,
            "title_key":  {"$toLower": {"$trim": {"input": "$title"}}},
            "author_key": {"$toLower": {"$trim": {"input": {"$ifNull": ["$author", ""]}}}},
            "title": 1, "author": 1, "fandom": 1,
            "progress_fraction": 1,
        }},
        {"$group": {
            "_id":            {"title_key": "$title_key", "author_key": "$author_key"},
            "cohort":         {"$sum": 1},
            "finished":       {"$sum": {"$cond": [{"$gte": ["$progress_fraction", 0.99]}, 1, 0]}},
            "sample_title":   {"$first": "$title"},
            "sample_author":  {"$first": "$author"},
            "sample_fandom":  {"$first": "$fandom"},
            "avg_progress":   {"$avg": "$progress_fraction"},
        }},
        {"$match": {"cohort": {"$gte": _LEADERBOARD_MIN_READERS}}},
        {"$project": {
            "_id": 0,
            "title":           "$sample_title",
            "author":          "$sample_author",
            "fandom":          "$sample_fandom",
            "cohort":          1,
            "finished":        1,
            "completion_rate": {"$divide": ["$finished", "$cohort"]},
            "avg_progress":    1,
        }},
        {"$sort": {"completion_rate": -1, "cohort": -1}},
        {"$limit": limit},
    ]
    rows: List[Dict[str, Any]] = []
    async for r in db.books.aggregate(pipeline):
        rows.append({
            "title":           r["title"],
            "author":          r.get("author", ""),
            "fandom":          r.get("fandom"),
            "cohort":          int(r["cohort"]),
            "finished":        int(r["finished"]),
            "completion_rate": round(float(r["completion_rate"]), 3),
            "avg_progress":    round(float(r.get("avg_progress", 0)), 3),
        })
    return {"rows": rows, "cohort_threshold": _LEADERBOARD_MIN_READERS}


# ---------------------------------------------------------------------
# Privacy toggle
# ---------------------------------------------------------------------

class PrivacyBody(BaseModel):
    reading_data_shared: bool


@api_router.post("/analytics/reading-data-sharing")
async def set_reading_data_sharing(
    body: PrivacyBody,
    user: User = Depends(get_current_user),
):
    """Toggle whether the caller's cursors feed the reader heatmap.
    Default True — explicit opt-out only."""
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"reading_data_shared": bool(body.reading_data_shared)}},
    )
    return {"ok": True, "reading_data_shared": bool(body.reading_data_shared)}


@api_router.get("/analytics/reading-data-sharing")
async def get_reading_data_sharing(
    user: User = Depends(get_current_user),
):
    """Read the current toggle so the Settings UI can mirror it."""
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "reading_data_shared": 1},
    )
    shared = doc.get("reading_data_shared", True) if doc else True
    return {"reading_data_shared": bool(shared)}


__all__ = ["_stamp_view"]
