"""Duplicate detection + auto-resolution policy.

Extracted from ``routes/books.py`` (Phase 6C slice 2, 2026-08-22).

Public surface (all re-exported from ``routes.books`` for
backwards-compat with existing tests + importers):

  * ``_clean_author_string`` — tidy raw EPUB author fields before storing.
  * ``_normalize_title_for_match`` — lowercase + whitespace-collapse.
  * ``_normalize_author_for_match`` — case + initials-run normalizer.
  * ``_updated_shelf_name`` — canonical date-stamped shelf label for
    the "new version" duplicate policy and the fanfic refresh flow.
  * ``find_duplicate_candidates`` — surfaces existing library rows
    that look like duplicates of a new upload.
  * ``_apply_duplicate_policy`` — apply the auto-resolution policy
    (keep_both / discard / historical / new_version) picked by the
    user's default duplicate preference.

Nothing here talks to the filesystem or FanFicFare — it's pure Mongo
+ string handling, so it stays trivially unit-testable.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from deps import db
from utils.constants import OLD_STORIES_SHELF, TRASH_SHELF, TRASH_GRACE_DAYS, TRASH_REASON_UPLOAD_DUPLICATE


def _clean_author_string(raw: Optional[str]) -> str:
    """Tidy up messy author fields before storing.

    Handles common EPUB metadata patterns that make dedup + display worse:
      - 'by John Smith' → 'John Smith'
      - 'Smith, John & Doe, Jane' → 'Smith, John & Doe, Jane' (preserved,
        but trailing/leading separators stripped)
      - 'John Smith (a.k.a. Pseudonym)' → 'John Smith' (drop parenthetical)
      - 'Pseudonym [pen name]' → 'Pseudonym' (drop bracketed annotation)
      - 'anonymous', 'unknown author', '' → 'Unknown'
      - Collapse internal whitespace.

    We deliberately do NOT lowercase or reformat the case — only the
    matching helper does that, so display stays human-friendly.
    """
    s = (raw or "").strip()
    if not s:
        return "Unknown"
    # Drop parenthetical and bracketed annotations like "(pen name)" or "[a.k.a. X]"
    s = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", s).strip()
    # Strip leading "by " (case-insensitive)
    s = re.sub(r"^(?:by|written by|author[:\s])\s+", "", s, flags=re.IGNORECASE).strip()
    # Trim stray separators ("John Smith, " or "& Jane")
    s = s.strip(" ,&;|/")
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s)
    # Canonicalize common "unknown" sentinels
    low = s.lower()
    if low in ("anonymous", "anon", "anon.", "unknown", "unknown author", "n/a", "na", "various", "various authors"):
        return {"various": "Various", "various authors": "Various"}.get(low, "Unknown")
    return s


def _normalize_title_for_match(title: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (title or "").strip()).lower()


def _normalize_author_for_match(author: Optional[str]) -> str:
    """Normalize for cross-row comparison: lowercase, drop dots, collapse
    whitespace, and merge runs of single-letter "initials" so 'J. K. Rowling'
    and 'JK Rowling' compare equal. Empty stays empty so callers can detect
    missing-author and fall back to title-only matching."""
    s = re.sub(r"\.", "", (author or "")).strip()
    s = re.sub(r"\s+", " ", s).lower()
    # Concatenate runs of single-letter words: 'j k rowling' → 'jk rowling'
    s = re.sub(
        r"\b([a-z])(\s+[a-z]\b)+",
        lambda m: m.group(0).replace(" ", ""),
        s,
    )
    return s


def _updated_shelf_name(now: Optional[datetime] = None) -> str:
    """Return the date-stamped 'Updated stories' shelf name for refreshes today.

    Each refresh batch gets its own dated bucket, so every run of updates is
    clearly separated. Example: 'Updated stories 2026-03-01'.
    """
    now = now or datetime.now(timezone.utc)
    return f"Updated stories {now.strftime('%Y-%m-%d')}"


async def find_duplicate_candidates(
    user_id: str,
    *,
    title: Optional[str],
    author: Optional[str] = None,
    source_url: Optional[str],
    fanfic_urls: Optional[List[str]] = None,
    exclude_book_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Find existing books in the user's library that look like duplicates.

    Match rules (any of):
      - normalized title + author equality (case-insensitive, whitespace-collapsed,
        dots stripped from author). When either side has no author on file we
        fall back to title-only matching so books that legitimately lack an
        author still dedupe.
      - exact source_url equality
      - any shared canonical fanfic URL (intersection on `fanfic_urls`)

    Archived versions are searched too — when a match lands on an archived
    book we walk the `replaced_by` chain to its current head and surface the
    head as the match (with `historical_version` added to match_reasons),
    so the upload can be offered as a historical version of a current copy.

    Returns a list of `{book_id, title, author, match_reasons: [...]}` dicts.
    """
    norm_title = _normalize_title_for_match(title)
    norm_author = _normalize_author_for_match(author)
    urls = [u for u in (fanfic_urls or []) if u]

    # Honor "not a duplicate" dismissals — the user has previously said this
    # (title, author, url) is NOT a dupe of certain keepers.  Skip those.
    try:
        from routes.library_quarantine import _get_dismissed_keeper_ids  # WPS433
        dismissed_ids = await _get_dismissed_keeper_ids(user_id, title, author, source_url)
    except Exception:  # noqa: BLE001 — dismissals are best-effort
        dismissed_ids = set()

    or_clauses: List[Dict[str, Any]] = []
    if norm_title:
        # Narrow the title regex pre-filter; we still verify title+author
        # equality in Python below.
        escaped = re.escape(norm_title)
        or_clauses.append({"title": {"$regex": f"^\\s*{escaped}\\s*$", "$options": "i"}})
    if source_url:
        or_clauses.append({"source_url": source_url})
    if urls:
        or_clauses.append({"fanfic_urls": {"$in": urls}})

    if not or_clauses:
        return []

    query: Dict[str, Any] = {"user_id": user_id, "$or": or_clauses}
    if exclude_book_id:
        query["book_id"] = {"$ne": exclude_book_id}

    projection = {"_id": 0, "book_id": 1, "title": 1, "author": 1, "source_url": 1, "fanfic_urls": 1, "category": 1, "replaced_by": 1}
    matches_by_head: Dict[str, Dict[str, Any]] = {}

    async def _walk_to_head(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Follow `replaced_by` until we hit a current (non-archived) copy."""
        current = doc
        seen: set = set()
        while current.get("replaced_by"):
            if current["book_id"] in seen:
                return None  # cycle guard
            seen.add(current["book_id"])
            nxt = await db.books.find_one(
                {"book_id": current["replaced_by"], "user_id": user_id},
                projection,
            )
            if not nxt:
                return None
            current = nxt
        if current.get("category") == OLD_STORIES_SHELF:
            return None  # orphaned archived chain
        return current

    async for doc in db.books.find(query, projection):
        is_archived = doc.get("category") == OLD_STORIES_SHELF or bool(doc.get("replaced_by"))
        head_doc = doc if not is_archived else await _walk_to_head(doc)
        if not head_doc:
            continue

        reasons: List[str] = []
        if norm_title and _normalize_title_for_match(doc.get("title")) == norm_title:
            # Tightened rule: when both sides have an author, they must
            # match too — otherwise two different books with the same title
            # (e.g. retellings, generic titles like "Untitled") get
            # falsely paired. Fall back to title-only when either side is
            # missing an author.
            doc_norm_author = _normalize_author_for_match(doc.get("author"))
            if not norm_author or not doc_norm_author:
                reasons.append("title")
            elif doc_norm_author == norm_author:
                reasons.append("title+author")
        if source_url and doc.get("source_url") == source_url:
            reasons.append("source_url")
        if urls:
            shared = [u for u in (doc.get("fanfic_urls") or []) if u in urls]
            if shared:
                reasons.append("url")
        if not reasons:
            continue
        if is_archived:
            reasons.append("historical_version")

        head_id = head_doc["book_id"]
        if head_id == exclude_book_id:
            continue
        if head_id in dismissed_ids:
            continue
        existing = matches_by_head.get(head_id)
        if existing:
            # Merge reasons (de-duped)
            existing["match_reasons"] = sorted(set(existing["match_reasons"]) | set(reasons))
        else:
            matches_by_head[head_id] = {
                "book_id": head_id,
                "title": head_doc.get("title") or "",
                "author": head_doc.get("author") or "",
                "match_reasons": sorted(set(reasons)),
            }

    return list(matches_by_head.values())


async def _apply_duplicate_policy(
    user_id: str,
    new_book_id: str,
    target_book_id: Optional[str],
    policy: str,
) -> Optional[Dict[str, Any]]:
    """Apply a default-policy auto-resolution to a freshly-uploaded book.

    Returns a dict describing what was done, or None if the policy couldn't
    apply (e.g., no target). The expensive chapter-diff step from the
    interactive resolve flow is skipped for batch uploads — users running on
    a stand policy chose convenience over the bell badge.

    Side effect: every change is recorded under the book's `dupe_action_meta`
    field with the previous values so the action can be undone via
    `POST /api/books/{book_id}/undo-resolve`.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    if policy == "keep_both":
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
                "$set": {"dupe_action_meta": {"action": "keep_both", "applied_at": now_iso}},
            },
        )
        return {"action": "keep_both", "undoable": False}

    if policy == "discard":
        # Soft-delete: move to Trash shelf with a 30-day grace window so the
        # user can restore. A background sweep hard-deletes books whose
        # `trash_expires_at` is in the past.
        new_doc_before = await db.books.find_one({"book_id": new_book_id, "user_id": user_id})
        if not new_doc_before:
            return None
        expires_at = (datetime.now(timezone.utc) + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    # 2026-08-24 — canonical audit fields so /api/trash
                    # can render "Trashed X · Reason Y" per row.
                    "trashed_at": now_iso,
                    "trash_reason": TRASH_REASON_UPLOAD_DUPLICATE,
                    "trash_prev_category": new_doc_before.get("category"),
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": new_doc_before.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {"action": "discard", "undoable": True, "trash_expires_at": expires_at}

    # The remaining two need a current head; bail if there isn't one
    if not target_book_id:
        return None
    target = await db.books.find_one({"book_id": target_book_id, "user_id": user_id})
    if not target or target.get("category") == OLD_STORIES_SHELF or target.get("replaced_by"):
        return None

    new_doc_before = await db.books.find_one({"book_id": new_book_id, "user_id": user_id})
    if not new_doc_before:
        return None

    if policy == "historical":
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": target_book_id,
                    "replaced_at": now_iso,
                    "dupe_action_meta": {
                        "action": "historical",
                        "target_book_id": target_book_id,
                        "prev_category_new": new_doc_before.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {
            "action": "historical",
            "target_book_id": target_book_id,
            "undoable": True,
        }

    if policy == "new_version":
        now_dt = datetime.now(timezone.utc)
        updated_shelf = _updated_shelf_name(now_dt)
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": updated_shelf,
                    "replaces": target_book_id,
                    "last_refreshed_at": now_iso,
                    "update_seen": False,
                    "dupe_action_meta": {
                        "action": "new_version",
                        "target_book_id": target_book_id,
                        "prev_category_new": new_doc_before.get("category"),
                        "prev_category_target": target.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        await db.categories.update_one(
            {"user_id": user_id, "name": updated_shelf},
            {"$setOnInsert": {
                "user_id": user_id,
                "name": updated_shelf,
                "created_at": now_iso,
                "auto_created": True,
            }},
            upsert=True,
        )
        await db.books.update_one(
            {"book_id": target_book_id, "user_id": user_id},
            {"$set": {
                "category": OLD_STORIES_SHELF,
                "replaced_by": new_book_id,
                "replaced_at": now_iso,
            }},
        )
        return {
            "action": "new_version",
            "target_book_id": target_book_id,
            "updated_shelf": updated_shelf,
            "undoable": True,
        }

    return None


__all__ = [
    "_clean_author_string",
    "_normalize_title_for_match",
    "_normalize_author_for_match",
    "_updated_shelf_name",
    "find_duplicate_candidates",
    "_apply_duplicate_policy",
]
