"""Community Recommendations — Phase 1 of the community-library idea.

A social bulletin board where users mark books from their own library
as "recommended to the community."  Other signed-in members browse
these recommendations and can heart them.  Discovery flows through
the existing public-library plumbing — clicking a rec routes the
viewer to the recommender's public library so they can find the
book in context (and hopefully discover more from the same reader).

Phase 1 explicitly does NOT share files.  No EPUB is uploaded,
downloaded, or duplicated by this endpoint.  Every rec is a pointer
into the existing private/public library structure.  Risk surface
matches the existing public-library feature.

Eligibility gates (designed 2026-06-27 with the user):

* Recommender must have ``completeness_score >= 2``.  In practice
  that means a bio AND ``library_visible_to_public = True``.  Both
  the book and the recommender are surfaced publicly, so we want
  presentable profiles.

* Recommender must OWN the book and the book must be AV-clean.

* Rate limit: 20 recommendations per user per rolling 24h.

* Signed-in members only — same posture as ``/users`` and
  ``/u/<handle>/library``.

Collections
-----------
``community_recommendations``::

    {
      rec_id:        str           # uuid hex
      book_id:       str           # FK → books.book_id (owner's copy)
      owner_user_id: str           # FK → users.user_id
      note:          str           # ≤200 chars, "why I love it"
      fandom:        str           # denorm copy for fast filtering
      title_lower:   str           # denorm for sort tie-break
      author_lower:  str           # denorm
      created_at:    datetime      # for "recent" sort
      hearts_count:  int           # denorm of recommendation_reactions
      hidden:        bool          # admin moderation flag
    }

``recommendation_reactions``::

    {
      rec_id:        str
      viewer_user_id: str
      created_at:    datetime
    }

Indexes are created at startup in ``server.py`` (added below).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth_dep import get_current_user, require_admin
from deps import api_router, db, logger
from models import User


# ---------------------------------------------------------------------
# Eligibility helper — score >= 2 (bio + library_visible_to_public).
# ---------------------------------------------------------------------
async def _can_recommend(user_id: str) -> tuple[bool, str]:
    """Check completeness score >= 2 for the given user.

    Returns ``(eligible, reason_if_not)``.  ``reason_if_not`` is a
    short, user-facing string the endpoint will pass straight through
    in the 403 detail.
    """
    doc = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "username": 1, "bio": 1, "library_visible_to_public": 1},
    )
    if not doc:
        return False, "User record not found"
    if not (doc.get("username") or "").strip():
        return False, "Claim a @handle before recommending"
    if not (doc.get("bio") or "").strip():
        return False, "Add a bio to your profile before recommending"
    if not doc.get("library_visible_to_public"):
        return False, "Share your library publicly before recommending"
    return True, ""


# ---------------------------------------------------------------------
# Rate limit — 20 recs per rolling 24h.
# ---------------------------------------------------------------------
RATE_LIMIT_PER_24H = 20

async def _within_rate_limit(user_id: str) -> tuple[bool, int]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    used = await db.community_recommendations.count_documents({
        "owner_user_id": user_id,
        "created_at": {"$gte": cutoff},
        "hidden": {"$ne": True},
    })
    return used < RATE_LIMIT_PER_24H, used


# ---------------------------------------------------------------------
# POST /api/community/recommend
# ---------------------------------------------------------------------
class _RecommendBody(BaseModel):
    book_id: str = Field(min_length=1, max_length=200)
    note: str    = Field(default="", max_length=200)


@api_router.post("/community/recommend")
async def create_recommendation(
    body: _RecommendBody,
    user: User = Depends(get_current_user),
):
    """Create (or update the note on) a community recommendation.

    Idempotent: a user recommending the same book twice updates the
    note in place rather than creating a duplicate.  This means the
    rate-limit only counts *distinct* recommendations.
    """
    ok, why = await _can_recommend(user.user_id)
    if not ok:
        raise HTTPException(status_code=403, detail=why)

    book = await db.books.find_one(
        {"book_id": body.book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
         "av_status": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found in your library")
    if book.get("av_status") in ("infected", "scanning", "error"):
        raise HTTPException(
            status_code=400,
            detail="Book hasn't passed antivirus scanning yet",
        )

    # Idempotency check FIRST so an "update note" doesn't hit the
    # rate limit.
    existing = await db.community_recommendations.find_one(
        {"book_id": body.book_id, "owner_user_id": user.user_id},
        {"_id": 0, "rec_id": 1, "hidden": 1},
    )
    if existing and existing.get("hidden"):
        # An admin hid this rec — don't let the user resurrect it.
        raise HTTPException(
            status_code=409,
            detail="This recommendation was removed by a moderator",
        )

    note = (body.note or "").strip()
    if existing:
        await db.community_recommendations.update_one(
            {"rec_id": existing["rec_id"]},
            {"$set": {"note": note, "updated_at": datetime.now(timezone.utc)}},
        )
        return {"rec_id": existing["rec_id"], "updated": True}

    # New rec — enforce rate limit.
    within, used = await _within_rate_limit(user.user_id)
    if not within:
        raise HTTPException(
            status_code=429,
            detail=f"Recommendation limit reached ({RATE_LIMIT_PER_24H}/24h)",
        )

    rec_id = uuid.uuid4().hex
    await db.community_recommendations.insert_one({
        "rec_id":        rec_id,
        "book_id":       book["book_id"],
        "owner_user_id": user.user_id,
        "note":          note,
        "fandom":        (book.get("fandom") or "").strip(),
        "title_lower":   (book.get("title") or "").strip().lower(),
        "author_lower":  (book.get("author") or "").strip().lower(),
        "created_at":    datetime.now(timezone.utc),
        "hearts_count":  0,
        "hidden":        False,
    })
    logger.info("community_rec: %s recommended %s", user.user_id, book["book_id"])
    return {"rec_id": rec_id, "created": True, "rate_used": used + 1, "rate_limit": RATE_LIMIT_PER_24H}


# ---------------------------------------------------------------------
# DELETE /api/community/recommend/{rec_id} — owner-only retract
# ---------------------------------------------------------------------
@api_router.delete("/community/recommend/{rec_id}")
async def delete_recommendation(rec_id: str, user: User = Depends(get_current_user)):
    rec = await db.community_recommendations.find_one(
        {"rec_id": rec_id},
        {"_id": 0, "owner_user_id": 1},
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if rec["owner_user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Not your recommendation")
    await db.community_recommendations.delete_one({"rec_id": rec_id})
    await db.recommendation_reactions.delete_many({"rec_id": rec_id})
    return {"deleted": True, "rec_id": rec_id}


# ---------------------------------------------------------------------
# GET /api/community/feed — paginated, signed-in only
# ---------------------------------------------------------------------
@api_router.get("/community/feed")
async def community_feed(
    sort: str       = Query("recent", pattern="^(recent|hearted)$"),
    fandom: Optional[str] = None,
    page: int       = Query(1, ge=1),
    limit: int      = Query(20, ge=1, le=50),
    _user: User      = Depends(get_current_user),  # signed-in only
):
    """List community recommendations, joined with owner + book details.

    Only surfaces recs whose owner still has
    ``library_visible_to_public = True``.  If a recommender opts out
    of public visibility later, their recs are automatically
    suppressed from the feed (privacy invariant).
    """
    skip = (page - 1) * limit
    q: Dict[str, Any] = {"hidden": {"$ne": True}}
    if fandom:
        q["fandom"] = fandom

    sort_spec = (
        [("hearts_count", -1), ("created_at", -1)]
        if sort == "hearted"
        else [("created_at", -1)]
    )

    total = await db.community_recommendations.count_documents(q)
    rows = await db.community_recommendations.find(
        q, {"_id": 0},
    ).sort(sort_spec).skip(skip).limit(limit).to_list(length=limit)

    if not rows:
        return {"items": [], "page": page, "limit": limit, "total": total, "has_more": False}

    # Bulk-fetch owners + filter out any whose visibility has flipped
    # off since the rec was created.
    owner_ids = list({r["owner_user_id"] for r in rows})
    owners = {
        u["user_id"]: u
        for u in await db.users.find(
            {"user_id": {"$in": owner_ids}},
            {"_id": 0, "user_id": 1, "username": 1, "name": 1, "picture": 1,
             "bio": 1, "library_visible_to_public": 1, "approval_status": 1},
        ).to_list(length=len(owner_ids))
    }

    # Bulk-fetch books for cover/metadata enrichment.
    book_ids = list({r["book_id"] for r in rows})
    books = {
        b["book_id"]: b
        for b in await db.books.find(
            {"book_id": {"$in": book_ids}},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
             "cover_url": 1, "av_status": 1},
        ).to_list(length=len(book_ids))
    }

    items: List[Dict[str, Any]] = []
    for r in rows:
        owner = owners.get(r["owner_user_id"])
        book = books.get(r["book_id"])
        # Privacy invariant: drop recs from users who've opted out OR
        # whose book is no longer AV-clean OR who got de-approved.
        if not owner or not owner.get("library_visible_to_public"):
            continue
        if owner.get("approval_status") not in (None, "approved"):
            continue
        if not book or book.get("av_status") in ("infected", "scanning", "error"):
            continue
        items.append({
            "rec_id":      r["rec_id"],
            "note":        r.get("note") or "",
            "created_at":  r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else r.get("created_at"),
            "hearts_count": int(r.get("hearts_count") or 0),
            "book": {
                "book_id":  book["book_id"],
                "title":    book.get("title") or "",
                "author":   book.get("author") or "",
                "fandom":   book.get("fandom") or "",
                "cover_url": book.get("cover_url") or "",
            },
            "owner": {
                "user_id":  owner["user_id"],
                "username": owner.get("username") or "",
                "name":     owner.get("name") or "",
                "picture":  owner.get("picture") or "",
                "bio":      owner.get("bio") or "",
            },
        })

    return {
        "items":    items,
        "page":     page,
        "limit":    limit,
        "total":    total,
        "has_more": skip + len(rows) < total,
    }


# ---------------------------------------------------------------------
# POST /api/community/recommend/{rec_id}/heart — toggle
# ---------------------------------------------------------------------
@api_router.post("/community/recommend/{rec_id}/heart")
async def toggle_rec_heart(rec_id: str, user: User = Depends(get_current_user)):
    rec = await db.community_recommendations.find_one(
        {"rec_id": rec_id, "hidden": {"$ne": True}},
        {"_id": 0, "owner_user_id": 1},
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    # Self-hearts don't count — same posture as book_reactions.
    if rec["owner_user_id"] == user.user_id:
        return {"hearted": False, "self_react": True}

    existing = await db.recommendation_reactions.find_one(
        {"rec_id": rec_id, "viewer_user_id": user.user_id},
        {"_id": 1},
    )
    if existing:
        await db.recommendation_reactions.delete_one({"_id": existing["_id"]})
        await db.community_recommendations.update_one(
            {"rec_id": rec_id}, {"$inc": {"hearts_count": -1}},
        )
        return {"hearted": False, "self_react": False}

    await db.recommendation_reactions.update_one(
        {"rec_id": rec_id, "viewer_user_id": user.user_id},
        {"$setOnInsert": {
            "rec_id":         rec_id,
            "viewer_user_id": user.user_id,
            "created_at":     datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    await db.community_recommendations.update_one(
        {"rec_id": rec_id}, {"$inc": {"hearts_count": 1}},
    )
    return {"hearted": True, "self_react": False}


# ---------------------------------------------------------------------
# GET /api/community/my-recommendations — owner sees their own list
# ---------------------------------------------------------------------
@api_router.get("/community/my-recommendations")
async def my_recommendations(user: User = Depends(get_current_user)):
    """List of book_ids the signed-in user has already recommended.

    The library UI uses this to render the "Recommended" state on the
    one-click Recommend button so the user doesn't try to add the
    same book twice.
    """
    rows = await db.community_recommendations.find(
        {"owner_user_id": user.user_id, "hidden": {"$ne": True}},
        {"_id": 0, "rec_id": 1, "book_id": 1},
    ).to_list(length=500)
    return {
        # Two parallel structures: a flat list of book_ids (fast
        # membership check on the FE) and a map of book_id → rec_id
        # so the per-book Recommend button can retract without an
        # extra round-trip.
        "book_ids":  [r["book_id"] for r in rows],
        "rec_ids":   {r["book_id"]: r["rec_id"] for r in rows},
        "rec_count": len(rows),
        "rate_limit": RATE_LIMIT_PER_24H,
    }


# ---------------------------------------------------------------------
# Admin: POST /api/admin/community/{rec_id}/hide
# ---------------------------------------------------------------------
@api_router.post("/admin/community/{rec_id}/hide")
async def admin_hide_recommendation(rec_id: str, _admin: User = Depends(require_admin)):
    """Admin moderation: hide a community recommendation.

    Idempotent.  Hidden recs are excluded from the feed and from the
    rate-limit count, and re-creating them by the owner returns 409.
    """
    res = await db.community_recommendations.update_one(
        {"rec_id": rec_id},
        {"$set": {"hidden": True, "hidden_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return {"hidden": True, "rec_id": rec_id}
