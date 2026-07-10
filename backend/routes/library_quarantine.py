"""Duplicate-quarantine endpoints (2026-07-09 reconstruction).

The upload pipeline in ``routes/books.py`` flags likely-duplicate uploads with
``duplicate_pending: True`` + ``duplicate_of: [{book_id, title, author,
match_reasons, ...}]``.  Instead of interrupting a bulk drop with modals, we
"auto-quarantine" every flagged upload so the operator can review them at
their own pace.

This module owns:

    GET    /api/library/quarantine
    POST   /api/library/quarantine/{book_id}/resolve
    POST   /api/library/quarantine/{book_id}/not-duplicate
    GET    /api/user/duplicate-dismissals
    DELETE /api/user/duplicate-dismissals/{dismissal_id}

The "not-duplicate" action writes to a per-user ``duplicate_dismissals``
collection keyed on a normalized (title, author, source_url) signature so
future uploads matching the same pair are silently un-flagged.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router
from models import User
from auth_dep import get_current_user
from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS
from routes.books import (
    OLD_STORIES_SHELF,
    _normalize_title_for_match,
    _normalize_author_for_match,
)

logger = logging.getLogger(__name__)


# --- request bodies ---------------------------------------------------------

class QuarantineResolveBody(BaseModel):
    action: str  # "keep_both" | "new_version" | "historical" | "discard"
    target_book_id: Optional[str] = None


# --- helpers ----------------------------------------------------------------

def _dismissal_signature(title: Optional[str], author: Optional[str], source_url: Optional[str]) -> str:
    """Stable signature used to match future uploads against dismissed pairs.

    We hash on the normalized title+author+source_url tuple so trivial
    rewrites (whitespace, casing, "The" prefixes) still collide.  Missing
    fields are collapsed to empty strings so any of the three signals alone
    is enough to trigger a hit.
    """
    t = _normalize_title_for_match(title) or ""
    a = _normalize_author_for_match(author) or ""
    u = (source_url or "").strip().lower()
    return f"t={t}|a={a}|u={u}"


async def _get_dismissed_keeper_ids(
    user_id: str,
    title: Optional[str],
    author: Optional[str],
    source_url: Optional[str],
) -> set:
    """Return the set of keeper book_ids the user has previously said are
    NOT duplicates of this (title, author, source_url) signature.

    ``routes.books.find_duplicate_candidates`` calls this to filter out
    keepers the user already dismissed.
    """
    sig = _dismissal_signature(title, author, source_url)
    ids: set = set()
    async for row in db.duplicate_dismissals.find(
        {"user_id": user_id, "signature": sig},
        {"_id": 0, "keeper_book_id": 1},
    ):
        kid = row.get("keeper_book_id")
        if kid:
            ids.add(kid)
    return ids


# --- routes -----------------------------------------------------------------

@api_router.get("/library/quarantine")
async def list_quarantine(user: User = Depends(get_current_user)):
    """Return duplicate-pending uploads grouped by keeper.

    Response shape::

        {
          "count": <int>,
          "groups": [
            {
              "keeper": {"book_id", "title", "author", "has_cover", "source_url"},
              "duplicates": [
                {"book_id", "title", "author", "has_cover",
                 "match_reasons", "shared_fanfic_urls", "source_url"}
              ]
            }
          ]
        }
    """
    cursor = db.books.find(
        {"user_id": user.user_id, "duplicate_pending": True},
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "has_cover": 1,
            "source_url": 1,
            "fanfic_urls": 1,
            "duplicate_of": 1,
        },
    )
    dupe_docs: List[Dict[str, Any]] = []
    async for d in cursor:
        dupe_docs.append(d)

    # Collect keeper ids so we can batch-fetch keeper metadata
    keeper_ids: set = set()
    for d in dupe_docs:
        for k in (d.get("duplicate_of") or []):
            kid = k.get("book_id")
            if kid:
                keeper_ids.add(kid)

    keeper_map: Dict[str, Dict[str, Any]] = {}
    if keeper_ids:
        async for k in db.books.find(
            {"user_id": user.user_id, "book_id": {"$in": list(keeper_ids)}},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "has_cover": 1, "source_url": 1, "fanfic_urls": 1},
        ):
            keeper_map[k["book_id"]] = k

    groups_by_keeper: Dict[str, Dict[str, Any]] = {}
    for d in dupe_docs:
        first_keeper = None
        for k in (d.get("duplicate_of") or []):
            kid = k.get("book_id")
            if kid and kid in keeper_map:
                first_keeper = keeper_map[kid]
                break
        if not first_keeper:
            # Keeper deleted or missing — skip this dupe pending row so the UI
            # doesn't render an orphan group.  The upload stays in the library
            # (still flagged) but out of the quarantine view.
            continue

        keeper_fanfic_urls = set(first_keeper.get("fanfic_urls") or [])
        dupe_fanfic_urls = set(d.get("fanfic_urls") or [])
        shared = sorted(keeper_fanfic_urls & dupe_fanfic_urls)

        match_reasons: List[str] = []
        for k in (d.get("duplicate_of") or []):
            if k.get("book_id") == first_keeper["book_id"]:
                match_reasons = list(k.get("match_reasons") or [])
                break

        entry = {
            "book_id": d["book_id"],
            "title": d.get("title") or "",
            "author": d.get("author") or "",
            "has_cover": bool(d.get("has_cover")),
            "match_reasons": match_reasons,
            "shared_fanfic_urls": shared,
            "source_url": d.get("source_url") or "",
        }

        group = groups_by_keeper.setdefault(first_keeper["book_id"], {
            "keeper": {
                "book_id": first_keeper["book_id"],
                "title": first_keeper.get("title") or "",
                "author": first_keeper.get("author") or "",
                "has_cover": bool(first_keeper.get("has_cover")),
                "source_url": first_keeper.get("source_url") or "",
            },
            "duplicates": [],
        })
        group["duplicates"].append(entry)

    groups = list(groups_by_keeper.values())
    # Biggest groups first so the worst offenders are visible
    groups.sort(key=lambda g: len(g["duplicates"]), reverse=True)
    count = sum(len(g["duplicates"]) for g in groups)
    return {"count": count, "groups": groups}


@api_router.post("/library/quarantine/{book_id}/resolve")
async def resolve_quarantine(
    book_id: str,
    body: QuarantineResolveBody,
    user: User = Depends(get_current_user),
):
    """Resolve a quarantined duplicate.

    Actions:
      * ``keep_both``   — clear the ``duplicate_pending`` flag, no other change
      * ``new_version`` — new upload becomes primary; keeper archived to
                          "Old stories" (needs ``target_book_id``)
      * ``historical``  — archive this new upload under the keeper
                          (needs ``target_book_id``)
      * ``discard``     — soft-delete to Trash (30-day grace)
    """
    if body.action not in ("keep_both", "new_version", "historical", "discard"):
        raise HTTPException(
            status_code=400,
            detail="action must be one of keep_both/new_version/historical/discard",
        )

    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()

    if body.action == "keep_both":
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
        )
        return {"ok": True, "action": "keep_both", "book_id": book_id}

    if body.action == "discard":
        expires_at = (now_dt + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": book.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {"ok": True, "action": "discard", "book_id": book_id, "trash_expires_at": expires_at}

    # new_version / historical both need a target
    if not body.target_book_id:
        raise HTTPException(status_code=400, detail="target_book_id is required")
    if body.target_book_id == book_id:
        raise HTTPException(status_code=400, detail="target_book_id cannot equal the uploaded book")

    target = await db.books.find_one({"book_id": body.target_book_id, "user_id": user.user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Target book not found")

    if body.action == "historical":
        # Archive the just-uploaded book under the target (current head).
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": target["book_id"],
                    "replaced_at": now_iso,
                    "dupe_action_meta": {
                        "action": "historical",
                        "target_book_id": target["book_id"],
                        "prev_category_new": book.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {
            "ok": True,
            "action": "historical",
            "old_book_id": book_id,
            "head_book_id": target["book_id"],
        }

    # new_version — promote this upload to primary, archive the target
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {
                "replaces": target["book_id"],
                "last_refreshed_at": now_iso,
                "update_seen": False,
                "dupe_action_meta": {
                    "action": "new_version",
                    "target_book_id": target["book_id"],
                    "prev_category_new": book.get("category"),
                    "prev_category_target": target.get("category"),
                    "applied_at": now_iso,
                },
            },
            "$unset": {"duplicate_pending": "", "duplicate_of": ""},
        },
    )
    await db.books.update_one(
        {"book_id": target["book_id"], "user_id": user.user_id},
        {"$set": {
            "category": OLD_STORIES_SHELF,
            "replaced_by": book_id,
            "replaced_at": now_iso,
        }},
    )
    return {
        "ok": True,
        "action": "new_version",
        "new_book_id": book_id,
        "old_book_id": target["book_id"],
    }


@api_router.post("/library/quarantine/{book_id}/not-duplicate")
async def not_duplicate(book_id: str, user: User = Depends(get_current_user)):
    """Mark the quarantined upload as NOT a duplicate of its keepers.

    Writes one ``duplicate_dismissals`` row per (dismissed_book, keeper)
    pair so future uploads with the same signature won't re-flag against
    the same keeper.  Clears ``duplicate_pending`` on the book so it lands
    in the main library grid.
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    keepers = book.get("duplicate_of") or []
    dismissed_at = datetime.now(timezone.utc).isoformat()
    sig = _dismissal_signature(book.get("title"), book.get("author"), book.get("source_url"))
    written = 0
    for k in keepers:
        kid = k.get("book_id")
        if not kid:
            continue
        # Idempotent: same (user, signature, keeper) tuple only writes once.
        res = await db.duplicate_dismissals.update_one(
            {"user_id": user.user_id, "signature": sig, "keeper_book_id": kid},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": user.user_id,
                    "signature": sig,
                    "keeper_book_id": kid,
                    "dismissed_book_id": book_id,
                    "dismissed_title": book.get("title") or "",
                    "dismissed_author": book.get("author") or "",
                    "dismissed_source_url": book.get("source_url") or "",
                    "dismissed_at": dismissed_at,
                }
            },
            upsert=True,
        )
        if res.upserted_id is not None:
            written += 1

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
    )
    return {"ok": True, "book_id": book_id, "dismissals_written": written}


@api_router.get("/user/duplicate-dismissals")
async def list_duplicate_dismissals(user: User = Depends(get_current_user)):
    """List every "not-duplicate" dismissal the user has recorded.

    Includes keeper metadata (title/author) so the UI can render a
    readable pair.  If a keeper has since been deleted, we return
    ``keeper.is_deleted = true`` and omit title/author so the row still
    renders without a broken link.
    """
    rows: List[Dict[str, Any]] = []
    keeper_ids: set = set()
    async for r in db.duplicate_dismissals.find({"user_id": user.user_id}, {"_id": 0}):
        rows.append(r)
        if r.get("keeper_book_id"):
            keeper_ids.add(r["keeper_book_id"])

    keeper_map: Dict[str, Dict[str, Any]] = {}
    if keeper_ids:
        async for k in db.books.find(
            {"user_id": user.user_id, "book_id": {"$in": list(keeper_ids)}},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1},
        ):
            keeper_map[k["book_id"]] = k

    # Most recent first
    rows.sort(key=lambda r: r.get("dismissed_at") or "", reverse=True)

    out: List[Dict[str, Any]] = []
    for r in rows:
        kid = r.get("keeper_book_id")
        k = keeper_map.get(kid) if kid else None
        if k:
            keeper_view = {
                "book_id": k["book_id"],
                "title": k.get("title") or "",
                "author": k.get("author") or "",
                "is_deleted": False,
            }
        else:
            keeper_view = {"book_id": kid or "", "is_deleted": True}
        out.append({
            "id": r.get("id"),
            "dismissed_title": r.get("dismissed_title") or "",
            "dismissed_author": r.get("dismissed_author") or "",
            "dismissed_at": r.get("dismissed_at") or "",
            "keeper": keeper_view,
        })
    return {"dismissals": out}


@api_router.delete("/user/duplicate-dismissals/{dismissal_id}")
async def delete_duplicate_dismissal(
    dismissal_id: str,
    user: User = Depends(get_current_user),
):
    """Delete a single dismissal row.  Re-arms dupe detection for the
    (title, author, url) → keeper pair the user had previously accepted.
    """
    res = await db.duplicate_dismissals.delete_one(
        {"user_id": user.user_id, "id": dismissal_id}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Dismissal not found")
    return {"ok": True, "id": dismissal_id}
