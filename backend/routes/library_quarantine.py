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
from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS, TRASH_REASON_QUARANTINE_DISCARD, TRASH_REASON_QUARANTINE_BATCH
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
            "created_at": 1,
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
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "has_cover": 1, "source_url": 1, "fanfic_urls": 1, "created_at": 1},
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
            "created_at": d.get("created_at") or "",
        }

        group = groups_by_keeper.setdefault(first_keeper["book_id"], {
            "keeper": {
                "book_id": first_keeper["book_id"],
                "title": first_keeper.get("title") or "",
                "author": first_keeper.get("author") or "",
                "has_cover": bool(first_keeper.get("has_cover")),
                "source_url": first_keeper.get("source_url") or "",
                "created_at": first_keeper.get("created_at") or "",
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
                    # 2026-08-24 — audit fields for /api/trash renderer.
                    "trashed_at": now_iso,
                    "trash_reason": TRASH_REASON_QUARANTINE_DISCARD,
                    "trash_prev_category": book.get("category"),
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


# ---------------------------------------------------------------------------
# Group-level "keep only the latest" (2026-07-12)
# ---------------------------------------------------------------------------
# One-click cleanup: given a keeper's book_id, look at the keeper + every
# quarantined duplicate that references it and keep only the copy with the
# most recent ``created_at``.  Everything else in the group goes to Trash.
# If the winner is a duplicate (not the keeper), we promote it via the
# same "new_version" flow so the old keeper is archived to Old stories,
# preserving reading progress and history.
# ---------------------------------------------------------------------------
def _created_at_key(v: Any) -> str:
    """Sort key that treats missing/invalid created_at as oldest."""
    if isinstance(v, str) and v:
        return v
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat()
    return ""


async def _apply_keep_latest_to_group(
    user_id: str, keeper_book_id: str
) -> Dict[str, Any]:
    """Core "keep the newest copy in this quarantine group" logic.

    Returns per-group summary. Raises ``HTTPException(404)`` if the keeper
    doesn't exist, or returns ``{"skipped": True, "reason": ...}`` if the
    keeper exists but has no quarantined duplicates pointing at it (safe
    to call inside a bulk loop that races other resolutions).
    """
    keeper = await db.books.find_one({"book_id": keeper_book_id, "user_id": user_id})
    if not keeper:
        return {"skipped": True, "reason": "keeper_missing", "keeper_book_id": keeper_book_id}

    dupes: List[Dict[str, Any]] = []
    async for d in db.books.find(
        {
            "user_id": user_id,
            "duplicate_pending": True,
            "duplicate_of.book_id": keeper_book_id,
        },
    ):
        dupes.append(d)

    if not dupes:
        return {"skipped": True, "reason": "no_duplicates", "keeper_book_id": keeper_book_id}

    ranked = [{"row": keeper, "is_keeper": True}] + [
        {"row": d, "is_keeper": False} for d in dupes
    ]
    ranked.sort(
        key=lambda x: _created_at_key(x["row"].get("created_at")),
        reverse=True,
    )
    winner = ranked[0]
    losers = ranked[1:]

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    expires_at = (now_dt + timedelta(days=TRASH_GRACE_DAYS)).isoformat()

    trashed_ids: List[str] = []
    promoted = False
    keeper_archived = False

    if winner["is_keeper"]:
        for L in losers:
            bid = L["row"]["book_id"]
            await db.books.update_one(
                {"book_id": bid, "user_id": user_id},
                {
                    "$set": {
                        "category": TRASH_SHELF,
                        "trash_expires_at": expires_at,
                        # 2026-08-24 — audit fields for /api/trash.
                        "trashed_at": now_iso,
                        "trash_reason": TRASH_REASON_QUARANTINE_BATCH,
                        "trash_prev_category": L["row"].get("category"),
                        "dupe_action_meta": {
                            "action": "discard",
                            "via": "group_keep_latest",
                            "prev_category_new": L["row"].get("category"),
                            "applied_at": now_iso,
                        },
                    },
                    "$unset": {"duplicate_pending": "", "duplicate_of": ""},
                },
            )
            trashed_ids.append(bid)
    else:
        winner_id = winner["row"]["book_id"]
        await db.books.update_one(
            {"book_id": winner_id, "user_id": user_id},
            {
                "$set": {
                    "replaces": keeper_book_id,
                    "last_refreshed_at": now_iso,
                    "update_seen": False,
                    "dupe_action_meta": {
                        "action": "new_version",
                        "via": "group_keep_latest",
                        "target_book_id": keeper_book_id,
                        "prev_category_new": winner["row"].get("category"),
                        "prev_category_target": keeper.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        await db.books.update_one(
            {"book_id": keeper_book_id, "user_id": user_id},
            {"$set": {
                "category": OLD_STORIES_SHELF,
                "replaced_by": winner_id,
                "replaced_at": now_iso,
            }},
        )
        promoted = True
        keeper_archived = True

        for L in losers:
            if L["is_keeper"]:
                continue
            bid = L["row"]["book_id"]
            await db.books.update_one(
                {"book_id": bid, "user_id": user_id},
                {
                    "$set": {
                        "category": TRASH_SHELF,
                        "trash_expires_at": expires_at,
                        # 2026-08-24 — audit fields for /api/trash.
                        "trashed_at": now_iso,
                        "trash_reason": TRASH_REASON_QUARANTINE_BATCH,
                        "trash_prev_category": L["row"].get("category"),
                        "dupe_action_meta": {
                            "action": "discard",
                            "via": "group_keep_latest",
                            "prev_category_new": L["row"].get("category"),
                            "applied_at": now_iso,
                        },
                    },
                    "$unset": {"duplicate_pending": "", "duplicate_of": ""},
                },
            )
            trashed_ids.append(bid)

    return {
        "ok": True,
        "keeper_book_id": keeper_book_id,
        "winner_book_id": winner["row"]["book_id"],
        "promoted": promoted,
        "keeper_archived": keeper_archived,
        "trashed_ids": trashed_ids,
        "trashed_count": len(trashed_ids),
    }


@api_router.post("/library/quarantine/group/{keeper_book_id}/keep-latest")
async def keep_latest_in_group(
    keeper_book_id: str,
    user: User = Depends(get_current_user),
):
    """Resolve an entire quarantine group by keeping only the latest copy."""
    result = await _apply_keep_latest_to_group(user.user_id, keeper_book_id)
    if result.get("skipped"):
        reason = result.get("reason")
        if reason == "keeper_missing":
            raise HTTPException(status_code=404, detail="Keeper not found")
        if reason == "no_duplicates":
            raise HTTPException(
                status_code=400,
                detail="No quarantined duplicates reference this keeper.",
            )
    return result


@api_router.post("/library/quarantine/keep-latest-all")
async def keep_latest_all_groups(
    limit: int = 100,
    user: User = Depends(get_current_user),
):
    """Bulk-resolve quarantine groups by keeping the newest copy in each.

    Cloudflare's 120 s edge timeout kills a single request that walks
    every group for large accounts (382 groups on the operator's
    account = ~1.5 k Mongo round-trips).  We now cap each call at
    ``limit`` groups (default 100) and return ``has_more: true`` when
    more remain, so the caller can loop with live progress.

    Returns::

        {
          ok, groups_processed, groups_resolved, groups_skipped,
          trashed_count, promoted_count, has_more, remaining
        }
    """
    limit = max(1, min(limit, 500))

    # Discover keepers with pending duplicates.  We only need the first
    # ``limit`` unique keeper IDs — no reason to page through every
    # duplicate row.
    keeper_ids: List[str] = []
    seen: set = set()
    async for d in db.books.find(
        {"user_id": user.user_id, "duplicate_pending": True},
        {"_id": 0, "duplicate_of": 1},
    ):
        for k in (d.get("duplicate_of") or []):
            kid = k.get("book_id")
            if kid and kid not in seen:
                seen.add(kid)
                keeper_ids.append(kid)
                if len(keeper_ids) >= limit:
                    break
        if len(keeper_ids) >= limit:
            break

    if not keeper_ids:
        return {
            "ok": True,
            "groups_processed": 0,
            "groups_resolved": 0,
            "groups_skipped": 0,
            "trashed_count": 0,
            "promoted_count": 0,
            "has_more": False,
            "remaining": 0,
        }

    groups_resolved = 0
    groups_skipped = 0
    trashed_count = 0
    promoted_count = 0
    skipped_reasons: Dict[str, int] = {}

    for keeper_id in keeper_ids:
        r = await _apply_keep_latest_to_group(user.user_id, keeper_id)
        if r.get("skipped"):
            groups_skipped += 1
            reason = r.get("reason") or "unknown"
            skipped_reasons[reason] = skipped_reasons.get(reason, 0) + 1
            continue
        groups_resolved += 1
        trashed_count += r.get("trashed_count", 0)
        if r.get("promoted"):
            promoted_count += 1

    # Post-batch, count how many quarantined dupes remain so the client
    # can decide whether to keep looping.  Cheap: a single count with an
    # index on duplicate_pending.
    remaining = await db.books.count_documents(
        {"user_id": user.user_id, "duplicate_pending": True},
    )

    return {
        "ok": True,
        "groups_processed": len(keeper_ids),
        "groups_resolved": groups_resolved,
        "groups_skipped": groups_skipped,
        "trashed_count": trashed_count,
        "promoted_count": promoted_count,
        "skipped_reasons": skipped_reasons,
        "has_more": remaining > 0,
        "remaining": remaining,
    }



# ---------------------------------------------------------------------------
# On-demand duplicate rescan (2026-07-12)
# ---------------------------------------------------------------------------
# Upload-time duplicate detection can miss cases where the metadata changed
# between uploads (e.g. author normalization tweaks, source_url added later,
# or a book restored from Old stories).  This endpoint sweeps the caller's
# entire non-trash library, computes normalized (title, author) + source_url
# groups, and quarantines every non-primary member so the existing
# Quarantine / keep-latest UI can resolve them.
#
# The oldest ``created_at`` in each group is elected as the "keeper".
# ``duplicate_dismissals`` are respected — a group that only exists because
# of a pair the user explicitly dismissed is skipped entirely.
# ---------------------------------------------------------------------------
@api_router.post("/library/quarantine/rescan")
async def rescan_library_for_duplicates(user: User = Depends(get_current_user)):
    """Sweep the caller's non-trash library and quarantine likely duplicates
    that weren't caught at upload time.

    Delegates to :func:`_run_rescan_for_user` so the same logic can be
    triggered by the weekly cron in ``utils/duplicate_rescan_cron.py``.
    """
    return await _run_rescan_for_user(user.user_id)


async def _run_rescan_for_user(user_id: str) -> Dict[str, Any]:
    """Rescan logic factored out for both the API endpoint and the
    weekly cron.  Returns::

        {
            scanned, groups_found, new_flagged, already_flagged,
            skipped_by_dismissal, note
        }
    """
    # 1. Pull every candidate (non-trash, non-Old-stories, not already
    #    flagged, not already replaced by another book). Filter is
    #    centralized in ``utils.dupe_queries`` so admin diagnostics and
    #    this endpoint stay in sync.
    from utils.dupe_queries import active_dupe_candidates_query
    cursor = db.books.find(
        active_dupe_candidates_query(user_id),
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "source_url": 1,
            "created_at": 1,
            "category": 1,
        },
    )
    books: List[Dict[str, Any]] = [b async for b in cursor]

    # 2. Bucket by (normalized title + normalized author) and by source_url.
    #    We union-find the two so books sharing either signal collapse into
    #    one group.
    by_title_author: Dict[str, List[int]] = {}
    by_source: Dict[str, List[int]] = {}
    for i, b in enumerate(books):
        nt = _normalize_title_for_match(b.get("title"))
        if not nt:
            continue
        na = _normalize_author_for_match(b.get("author"))
        key = f"{nt}||{na}" if na else f"{nt}||"
        by_title_author.setdefault(key, []).append(i)
        s = b.get("source_url")
        if s:
            by_source.setdefault(s, []).append(i)

    parent = list(range(len(books)))

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: int, b: int) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[rb] = ra

    for group in list(by_title_author.values()) + list(by_source.values()):
        if len(group) < 2:
            continue
        head = group[0]
        for j in group[1:]:
            _union(head, j)

    # 3. Reduce to true groups of 2+.
    groups: Dict[int, List[int]] = {}
    for i in range(len(books)):
        r = _find(i)
        groups.setdefault(r, []).append(i)
    groups_2plus: List[List[int]] = [ids for ids in groups.values() if len(ids) >= 2]

    # 4. Load the caller's duplicate_dismissals so we can respect them.
    #    Dismissals are keyed on a normalized (title, author, source_url)
    #    tuple → per pair.  We drop any candidate pair the user
    #    already told us to ignore.
    dismissals_cursor = db.duplicate_dismissals.find(
        {"user_id": user_id},
        {"_id": 0, "signature": 1},
    )
    dismissed_sigs: set = set()
    async for d in dismissals_cursor:
        sig = d.get("signature")
        if sig:
            dismissed_sigs.add(sig)

    def _pair_sig(a: Dict[str, Any], b: Dict[str, Any]) -> str:
        # Match the same signature format ``resolve/not_duplicate`` uses.
        ta = _normalize_title_for_match(a.get("title")) or ""
        aa = _normalize_author_for_match(a.get("author")) or ""
        sa = (a.get("source_url") or "").strip()
        tb = _normalize_title_for_match(b.get("title")) or ""
        ab = _normalize_author_for_match(b.get("author")) or ""
        sb = (b.get("source_url") or "").strip()
        # Order-independent
        pair = tuple(sorted([f"{ta}|{aa}|{sa}", f"{tb}|{ab}|{sb}"]))
        return f"{pair[0]}::{pair[1]}"

    now_iso = datetime.now(timezone.utc).isoformat()
    new_flagged = 0
    already_flagged = 0
    skipped_by_dismissal = 0
    real_groups = 0

    for idxs in groups_2plus:
        members = [books[i] for i in idxs]
        # Elect the oldest as keeper.
        members.sort(key=lambda m: (m.get("created_at") or "", m.get("book_id") or ""))
        keeper = members[0]
        dupes = members[1:]
        real_groups += 1
        for dup in dupes:
            sig = _pair_sig(keeper, dup)
            if sig in dismissed_sigs:
                skipped_by_dismissal += 1
                continue
            reasons: List[str] = []
            if _normalize_title_for_match(keeper.get("title")) == _normalize_title_for_match(dup.get("title")):
                reasons.append("title+author")
            if keeper.get("source_url") and keeper.get("source_url") == dup.get("source_url"):
                reasons.append("source_url")
            if not reasons:
                reasons = ["title+author"]
            res = await db.books.update_one(
                {"book_id": dup["book_id"], "user_id": user_id},
                {
                    "$set": {
                        "duplicate_pending": True,
                        "duplicate_of": [{
                            "book_id": keeper["book_id"],
                            "title": keeper.get("title"),
                            "author": keeper.get("author"),
                            "match_reasons": reasons,
                        }],
                        "quarantined_via": "rescan",
                        "quarantined_at": now_iso,
                    },
                },
            )
            if res.modified_count:
                new_flagged += 1
            else:
                already_flagged += 1

    return {
        "scanned": len(books),
        "groups_found": real_groups,
        "new_flagged": new_flagged,
        "already_flagged": already_flagged,
        "skipped_by_dismissal": skipped_by_dismissal,
        "note": (
            "Newly flagged books are now visible on the Duplicates page. "
            "Use the per-group buttons or 'Keep the latest in all N groups' "
            "to resolve them in bulk."
        ),
    }
