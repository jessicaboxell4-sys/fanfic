"""Duplicate-resolution endpoints, extracted from ``routes/books.py`` as part
of Phase 5D (2026-06-14).

This is the heaviest cluster in the refactor — four endpoints + the union-
find scanner that powers the "Find duplicates" UI:

    POST /api/books/{book_id}/resolve-duplicate
    GET  /api/library/duplicates/count
    GET  /api/library/duplicates
    POST /api/books/resolve-group

Helpers (`_updated_shelf_name`, `_normalize_title_for_match`,
`extract_chapters`, `diff_chapters`, `extract_epub_metadata`,
`format_links_txt`) stay in ``routes/books.py`` because they're shared
with the upload + refresh pipelines.  We import them from there.  No
circular dependency — ``books.py`` doesn't reach back into this module.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router, STORAGE_DIR
from models import User
from auth_dep import get_current_user
from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS
from utils.url_canonical import FANFIC_SOURCE_PATTERNS, _URL_RE

# Helpers live in books.py — pull them in.  These names are stable per the
# Phase 5 refactor contract; do not rename without updating the import.
from routes.books import (
    OLD_STORIES_SHELF,
    _updated_shelf_name,
    _normalize_title_for_match,
    extract_chapters,
    diff_chapters,
    extract_epub_metadata,
)

logger = logging.getLogger(__name__)

# Cap legacy-backfill cost on a single duplicates-scan call so libraries
# with thousands of sidecar files don't time out the request.
FIND_DUPES_BACKFILL_LIMIT = 1000


# --- request bodies ---------------------------------------------------------

class ResolveDuplicateBody(BaseModel):
    action: str  # "keep" | "discard" | "new_version_of" | "link_as_old_version"
    target_book_id: Optional[str] = None


class GroupDecision(BaseModel):
    book_id: str
    action: str  # "keep" | "discard" | "archive"


class ResolveGroupBody(BaseModel):
    keeper_id: str
    decisions: List[GroupDecision]


# --- helpers ----------------------------------------------------------------

def _parse_urls_from_sidecar(path: Path) -> List[str]:
    """Pull URLs out of a `<book_id>.links.txt` sidecar.

    `format_links_txt` writes each URL with a leading ordinal (`1. http://...`)
    so we use a permissive URL regex rather than `startswith("http://")`.
    """
    if not path.exists():
        return []
    out: List[str] = []
    seen: set = set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    for m in _URL_RE.finditer(text):
        url = m.group(0).rstrip('.,);]>')
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


# --- routes -----------------------------------------------------------------

@api_router.post("/books/{book_id}/resolve-duplicate")
async def resolve_duplicate(
    book_id: str,
    body: ResolveDuplicateBody,
    user: User = Depends(get_current_user),
):
    """Resolve a pending-duplicate upload.

    Actions:
      * `keep`                — clear the `duplicate_pending` flag (keep both copies)
      * `discard`             — soft-delete (move to Trash with 30-day grace)
      * `new_version_of`      — archive `target_book_id` to "Old stories" and
                                move the new book to a dated "Updated stories"
                                shelf with a proper chapter-diff refresh_summary
      * `link_as_old_version` — archive the just-uploaded book under
                                `target_book_id` (the current head). Use this
                                when the upload is actually an older snapshot
                                of a fic you've since re-fetched.
    """
    if body.action not in ("keep", "discard", "new_version_of", "link_as_old_version"):
        raise HTTPException(status_code=400, detail="action must be one of keep/discard/new_version_of/link_as_old_version")

    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    user_dir = STORAGE_DIR / user.user_id

    if body.action == "keep":
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
        )
        return {"ok": True, "action": "keep", "book_id": book_id}

    if body.action == "discard":
        # Soft-delete: move to Trash shelf with a 30-day grace window. Files
        # stay on disk so the user can restore from /library/trash.
        now_iso = datetime.now(timezone.utc).isoformat()
        expires_at = (datetime.now(timezone.utc) + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
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

    # link_as_old_version + new_version_of both need a target
    if not body.target_book_id:
        raise HTTPException(status_code=400, detail="target_book_id is required")
    if body.target_book_id == book_id:
        raise HTTPException(status_code=400, detail="target_book_id cannot equal the uploaded book")

    target = await db.books.find_one({"book_id": body.target_book_id, "user_id": user.user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Target book not found")
    if target.get("category") == OLD_STORIES_SHELF or target.get("replaced_by"):
        raise HTTPException(status_code=400, detail="Target book is already archived; pick its current version instead")

    if body.action == "link_as_old_version":
        # Archive the just-uploaded book under the target (current head).
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": target["book_id"],
                    "replaced_at": now_iso,
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {
            "ok": True,
            "action": "link_as_old_version",
            "old_book_id": book_id,
            "head_book_id": target["book_id"],
            "message": f'Linked as a historical version of "{target.get("title") or "the current copy"}".',
        }

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    updated_shelf = _updated_shelf_name(now_dt)

    # Carry over user-curated fields from the target onto the new book so the
    # user's tagging/shelving doesn't get lost.
    carry = {
        "fandom": book.get("fandom") or target.get("fandom"),
        "series_name": book.get("series_name") or target.get("series_name"),
        "series_index": book.get("series_index") or target.get("series_index"),
        "tags": list({*(book.get("tags") or []), *(target.get("tags") or [])}),
        "source_url": book.get("source_url") or target.get("source_url"),
    }

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {
                "category": updated_shelf,
                "replaces": target["book_id"],
                "last_refreshed_at": now_iso,
                "update_seen": False,
                **{k: v for k, v in carry.items() if v is not None},
            },
            "$unset": {"duplicate_pending": "", "duplicate_of": ""},
        },
    )

    # Register the dated shelf as a custom category
    await db.categories.update_one(
        {"user_id": user.user_id, "name": updated_shelf},
        {"$setOnInsert": {
            "user_id": user.user_id,
            "name": updated_shelf,
            "created_at": now_iso,
            "auto_created": True,
        }},
        upsert=True,
    )

    # Archive the target
    await db.books.update_one(
        {"book_id": target["book_id"], "user_id": user.user_id},
        {"$set": {
            "category": OLD_STORIES_SHELF,
            "replaced_by": book_id,
            "replaced_at": now_iso,
        }},
    )

    # Chapter diff for refresh_summary so the bell badge + Compare page work
    refresh_summary: Optional[Dict[str, Any]] = None
    try:
        loop = asyncio.get_event_loop()
        old_epub = user_dir / f"{target['book_id']}.epub"
        new_epub = user_dir / f"{book_id}.epub"
        if old_epub.exists() and new_epub.exists():
            old_chapters = await loop.run_in_executor(None, extract_chapters, old_epub)
            new_chapters = await loop.run_in_executor(None, extract_chapters, new_epub)
            d = diff_chapters(old_chapters, new_chapters)
            refresh_summary = {
                "chapters_added": d["summary"]["chapters_added"],
                "chapters_changed": d["summary"]["chapters_changed"],
                "chapters_removed": d["summary"]["chapters_removed"],
                "words_delta": d["summary"]["words_delta"],
                "first_changed_href": (d.get("first_changed_chapter") or {}).get("new_href", ""),
                "first_changed_title": (d.get("first_changed_chapter") or {}).get("title", ""),
                "first_changed_kind": (d.get("first_changed_chapter") or {}).get("kind", ""),
            }
    except Exception as e:
        logger.warning("resolve_duplicate diff failed for %s -> %s: %s", target["book_id"], book_id, e)

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"refresh_summary": refresh_summary}},
    )

    return {
        "ok": True,
        "action": "new_version_of",
        "new_book_id": book_id,
        "old_book_id": target["book_id"],
        "updated_shelf": updated_shelf,
        "message": f'Saved as a new version in "{updated_shelf}". The previous copy moved to Old stories.',
    }


@api_router.get("/library/duplicates/count")
async def find_duplicates_count(user: User = Depends(get_current_user)):
    """Cheap pre-flight count of likely duplicates without the expensive
    backfill step. Used by the Account-page card to nudge users when there's
    cleanup to be done. Counts groups by:
      * normalized title equality
      * exact `source_url` equality
      * shared `fanfic_urls` (only on books that already have the field; no
        sidecar backfill — that's reserved for the full scan)
    """
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": OLD_STORIES_SHELF},
            "replaced_by": {"$exists": False},
        },
        {"_id": 0, "book_id": 1, "title": 1, "source_url": 1, "fanfic_urls": 1},
    )

    by_title: Dict[str, List[int]] = {}
    by_source: Dict[str, List[int]] = {}
    by_url: Dict[str, List[int]] = {}
    books: List[Dict[str, Any]] = []
    async for b in cursor:
        i = len(books)
        books.append(b)
        nt = _normalize_title_for_match(b.get("title"))
        if nt:
            by_title.setdefault(nt, []).append(i)
        s = b.get("source_url")
        if s:
            by_source.setdefault(s, []).append(i)
        for u in (b.get("fanfic_urls") or []):
            by_url.setdefault(u, []).append(i)

    parent = list(range(len(books)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for indexes in list(by_title.values()) + list(by_source.values()) + list(by_url.values()):
        if len(indexes) < 2:
            continue
        head = indexes[0]
        for j in indexes[1:]:
            union(head, j)

    counts_by_root: Dict[int, int] = {}
    for i in range(len(books)):
        counts_by_root[find(i)] = counts_by_root.get(find(i), 0) + 1

    total_groups = sum(1 for c in counts_by_root.values() if c >= 2)
    total_dupe_books = sum(c for c in counts_by_root.values() if c >= 2)
    return {"total_groups": total_groups, "total_dupe_books": total_dupe_books}


@api_router.get("/library/duplicates")
async def find_duplicates(user: User = Depends(get_current_user)):
    """Group the user's library by potential duplicate signal.

    Returns `{groups: [...], total_groups, total_dupe_books, backfilled}`.
    Archived (`Old stories` / `replaced_by`) books are excluded.
    """
    user_dir = STORAGE_DIR / user.user_id

    # 1) Load all non-archived books for the user
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": OLD_STORIES_SHELF},
            "replaced_by": {"$exists": False},
        },
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "category": 1,
            "fandom": 1,
            "source_url": 1,
            "fanfic_urls": 1,
            "created_at": 1,
            "reading_minutes": 1,
            "progress_fraction": 1,
        },
    )
    books: List[Dict[str, Any]] = []
    async for b in cursor:
        books.append(b)

    # 2) Opportunistic backfill of `fanfic_urls` for legacy books (capped)
    backfilled = 0
    for b in books:
        if "fanfic_urls" in b:
            continue
        if backfilled >= FIND_DUPES_BACKFILL_LIMIT:
            break
        urls_raw = _parse_urls_from_sidecar(user_dir / f"{b['book_id']}.links.txt")
        canonical: List[str] = []
        seen: set = set()
        for u in urls_raw:
            for pat in FANFIC_SOURCE_PATTERNS:
                m = re.search(pat, u, re.IGNORECASE)
                if m and m.group(0) not in seen:
                    seen.add(m.group(0))
                    canonical.append(m.group(0))
                    break
        b["fanfic_urls"] = canonical
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {"$set": {"fanfic_urls": canonical}},
        )
        backfilled += 1

    # 3) Build inverted indexes for fast grouping
    by_title: Dict[str, List[int]] = {}
    by_source: Dict[str, List[int]] = {}
    by_url: Dict[str, List[int]] = {}
    for i, b in enumerate(books):
        nt = _normalize_title_for_match(b.get("title"))
        if nt:
            by_title.setdefault(nt, []).append(i)
        s = b.get("source_url")
        if s:
            by_source.setdefault(s, []).append(i)
        for u in (b.get("fanfic_urls") or []):
            by_url.setdefault(u, []).append(i)

    # 4) Union-find across the three indexes
    parent = list(range(len(books)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    reasons_for_group: Dict[int, set] = {}

    def link_group(indexes: List[int], reason: str):
        if len(indexes) < 2:
            return
        head = indexes[0]
        for j in indexes[1:]:
            union(head, j)
        reasons_for_group.setdefault(find(head), set()).add(reason)

    for nt, idxs in by_title.items():
        link_group(idxs, "title")
    for src, idxs in by_source.items():
        link_group(idxs, "source_url")
    for url, idxs in by_url.items():
        link_group(idxs, "url")

    # 5) Materialise groups (only those with >1 member)
    groups_by_root: Dict[int, List[int]] = {}
    for i in range(len(books)):
        r = find(i)
        groups_by_root.setdefault(r, []).append(i)

    out_groups: List[Dict[str, Any]] = []
    for root, member_ids in groups_by_root.items():
        if len(member_ids) < 2:
            continue
        reasons = sorted(reasons_for_group.get(root, set()))
        # Stable ordering: oldest first so the "keeper" defaults to the
        # original copy.
        member_books = [books[i] for i in member_ids]
        member_books.sort(key=lambda b: b.get("created_at") or "")
        out_groups.append({
            "match_reasons": reasons,
            "books": [
                {
                    "book_id": b["book_id"],
                    "title": b.get("title") or "",
                    "author": b.get("author") or "",
                    "category": b.get("category") or "",
                    "fandom": b.get("fandom") or "",
                    "created_at": b.get("created_at") or "",
                    "reading_minutes": int(b.get("reading_minutes") or 0),
                    "progress_fraction": float(b.get("progress_fraction") or 0.0),
                }
                for b in member_books
            ],
        })

    # Largest groups first so the worst offenders are visible
    out_groups.sort(key=lambda g: len(g["books"]), reverse=True)

    return {
        "groups": out_groups,
        "total_groups": len(out_groups),
        "total_dupe_books": sum(len(g["books"]) for g in out_groups),
        "backfilled": backfilled,
    }


@api_router.post("/books/resolve-group")
async def resolve_group(body: ResolveGroupBody, user: User = Depends(get_current_user)):
    """Resolve a single duplicate group.

    The caller picks a `keeper_id` (the book that should stay current) and a
    per-book action for every other book in the group:
      * `keep`      — leave it alone (sit alongside the keeper)
      * `discard`   — delete the book + its on-disk files
      * `archive`   — move it to "Old stories" with `replaced_by = keeper_id`
                      so the keeper becomes its current version

    The keeper itself is implicitly kept and must appear in `decisions` as
    `keep` (or be omitted — we ignore any decision referring to the keeper).
    """
    keeper = await db.books.find_one({"book_id": body.keeper_id, "user_id": user.user_id})
    if not keeper:
        raise HTTPException(status_code=404, detail="Keeper book not found")
    if keeper.get("category") == OLD_STORIES_SHELF or keeper.get("replaced_by"):
        raise HTTPException(status_code=400, detail="Keeper is already archived; pick a current copy instead")

    user_dir = STORAGE_DIR / user.user_id
    now_iso = datetime.now(timezone.utc).isoformat()

    summary = {"kept": 1, "discarded": 0, "archived": 0, "skipped": 0}

    for d in body.decisions:
        if d.book_id == body.keeper_id:
            continue
        if d.action not in ("keep", "discard", "archive"):
            raise HTTPException(status_code=400, detail=f"Unknown action '{d.action}' for {d.book_id}")

        b = await db.books.find_one({"book_id": d.book_id, "user_id": user.user_id})
        if not b:
            summary["skipped"] += 1
            continue

        if d.action == "keep":
            summary["kept"] += 1
            continue

        if d.action == "discard":
            for ext in (".epub", ".cover", ".links.txt"):
                p = user_dir / f"{d.book_id}{ext}"
                if p.exists():
                    try:
                        p.unlink()
                    except OSError:
                        pass
            await db.books.delete_one({"book_id": d.book_id, "user_id": user.user_id})
            summary["discarded"] += 1
            continue

        # archive
        await db.books.update_one(
            {"book_id": d.book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": body.keeper_id,
                    "replaced_at": now_iso,
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        summary["archived"] += 1

    # Clear any lingering duplicate_pending flag on the keeper
    await db.books.update_one(
        {"book_id": body.keeper_id, "user_id": user.user_id},
        {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
    )

    return {"ok": True, **summary}
