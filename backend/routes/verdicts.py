"""``routes/verdicts.py`` — private per-user "Verdicts" axis on books.

A reader's private take on each EPUB.  Two fields persisted on each
book doc:

* ``reading_state`` — single-select, mutually-exclusive position in
  the reader's queue.  One of ``to_read``, ``reading``, ``read``,
  ``dnf``, or ``None`` (unset).  Different from ``progress_fraction``
  (the position within the book) — reading_state is the reader's
  *commitment*, progress is *how far they've gone*.

* ``verdicts`` — multi-select set of sentiment tags.  Includes
  built-in slots (``favorite``, ``least_favorite``, ``never_again``,
  ``reread_material``, ``recommend``) plus any custom slots the user
  has defined on their account (max 10 customs to keep the chip row
  scannable).

================ ENDPOINTS IN THIS FILE ================
  GET    /api/verdicts/taxonomy          — built-in + user's custom verdicts
  PATCH  /api/books/{book_id}/verdict    — update one book's verdict + state
  POST   /api/books/bulk/verdicts        — set/add/remove across many books
  POST   /api/verdicts/custom            — add a custom verdict slot
  DELETE /api/verdicts/custom/{key}      — remove a custom verdict slot

Custom verdicts live on the user doc under ``custom_verdicts: list``.
Adding a custom verdict does NOT retroactively scan books; deleting
one DOES pull the key off every book the user owns (kept consistent
because deleted custom verdicts would otherwise show up as raw keys
on the book card with no label or emoji).

Pairs with the FE ``components/VerdictBadges.jsx`` + the filter chip
row on ``AllBooksPage.jsx`` + the bulk-toolbar action when select
mode is active.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger  # noqa: F401  (logger reserved for failure paths)
from models import User
from auth_dep import get_current_user


# ---------------------------------------------------------------------
# Taxonomy — single source of truth.  Mirrored to FE via /taxonomy
# rather than duplicated as a frontend constant, so adding a built-in
# slot here doesn't require a coordinated FE deploy.
# ---------------------------------------------------------------------

READING_STATES: List[Dict[str, str]] = [
    {"key": "to_read", "label": "Need to read", "emoji": "📖"},
    {"key": "reading", "label": "Reading", "emoji": "👀"},
    {"key": "read", "label": "Read", "emoji": "✅"},
    {"key": "dnf", "label": "DNF (did not finish)", "emoji": "🪦"},
]
READING_STATE_KEYS = {s["key"] for s in READING_STATES}

BUILTIN_VERDICTS: List[Dict[str, str]] = [
    {"key": "favorite",        "label": "Favorite",         "emoji": "⭐"},
    {"key": "least_favorite",  "label": "Least favorite",   "emoji": "💀"},
    {"key": "never_again",     "label": "Never again",      "emoji": "🚫"},
    {"key": "reread_material", "label": "Reread material",  "emoji": "♻️"},
    {"key": "recommend",       "label": "Would recommend",  "emoji": "🫶"},
]
BUILTIN_VERDICT_KEYS = {v["key"] for v in BUILTIN_VERDICTS}

CUSTOM_VERDICT_MAX = 10
# Keep custom keys tame so they don't collide with current/future built-ins
# and stay JSON-safe in URL paths (DELETE /custom/{key}).
CUSTOM_KEY_PATTERN = re.compile(r"^custom_[a-z0-9_]{1,28}$")
CUSTOM_LABEL_MAX = 32
CUSTOM_EMOJI_MAX = 4   # one grapheme cluster fits in <=4 UTF-16 code units


# ---------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------

class VerdictUpdateBody(BaseModel):
    """Per-book verdict patch.  Every field is optional; only sent
    fields are applied so the FE can toggle one chip at a time without
    accidentally clearing siblings.

    To CLEAR ``reading_state`` send ``reading_state: ""`` (empty
    string).  ``None`` is interpreted as "leave alone".
    """
    reading_state: Optional[str] = None
    verdicts: Optional[List[str]] = None            # set verdicts to this exact list
    verdicts_add: Optional[List[str]] = None        # OR add to existing
    verdicts_remove: Optional[List[str]] = None     # OR remove from existing


class BulkVerdictsBody(BaseModel):
    book_ids: List[str] = Field(default_factory=list)
    reading_state: Optional[str] = None       # "" clears, None leaves alone
    verdicts_add: Optional[List[str]] = None
    verdicts_remove: Optional[List[str]] = None


class CustomVerdictBody(BaseModel):
    label: str
    emoji: str
    # Caller may omit ``key`` and we'll mint a stable slug from the
    # label.  Letting the FE pin a key (e.g. ``custom_pride_month``)
    # is useful for deep-linking later but not required for MVP.
    key: Optional[str] = None


# ---------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------

async def _valid_verdict_keys_for(user: User) -> set[str]:
    """The full set of verdict keys this user is allowed to apply —
    built-ins + their own customs.  Used to reject typo'd/forged keys
    before they end up persisted on a book.
    """
    keys = set(BUILTIN_VERDICT_KEYS)
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "custom_verdicts": 1},
    )
    if doc and isinstance(doc.get("custom_verdicts"), list):
        keys.update(c.get("key") for c in doc["custom_verdicts"] if c.get("key"))
    return keys


def _validate_reading_state(value: Optional[str]) -> tuple[bool, Optional[str]]:
    """Returns (apply, value_to_store).
    apply=False → caller didn't touch the field, leave the DB alone.
    apply=True, value=None → clear the field via $unset.
    apply=True, value=<key> → $set it.
    """
    if value is None:
        return (False, None)
    if value == "":
        return (True, None)
    if value not in READING_STATE_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid reading_state: {value!r}")
    return (True, value)


def _mint_custom_key(label: str, existing: set[str]) -> str:
    """Slug a label down to a snake_case custom_* key.  Falls back to
    a random suffix if the slug would collide with an existing key —
    avoids the user silently overwriting their own slot when they add
    two custom verdicts with the same label.
    """
    base = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")[:24]
    if not base:
        base = "verdict"
    candidate = f"custom_{base}"
    if candidate not in existing and candidate not in BUILTIN_VERDICT_KEYS:
        return candidate
    # Try numbered suffixes, then a random fallback.
    for n in range(2, 100):
        c = f"custom_{base}_{n}"
        if c not in existing:
            return c
    return f"custom_{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@api_router.get("/verdicts/taxonomy")
async def verdicts_taxonomy(user: User = Depends(get_current_user)):
    """Return the canonical taxonomy for this user — built-in reading
    states + built-in verdicts + the user's custom verdict slots.

    Frontend hydrates its label/emoji lookup tables from this so the
    backend stays the source of truth and we don't ship two parallel
    constant files that drift.
    """
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "custom_verdicts": 1},
    )
    customs = (doc or {}).get("custom_verdicts") or []
    return {
        "reading_states": READING_STATES,
        "builtin_verdicts": BUILTIN_VERDICTS,
        "custom_verdicts": customs,
        "custom_verdict_max": CUSTOM_VERDICT_MAX,
    }


@api_router.patch("/books/{book_id}/verdict")
async def update_book_verdict(
    book_id: str,
    body: VerdictUpdateBody,
    user: User = Depends(get_current_user),
):
    """Update a single book's verdict + reading_state.  Every field
    in the body is optional; only sent fields are applied.

    To toggle a single chip without clobbering siblings, the FE
    typically sends one of:
      • ``{reading_state: "read"}``  — set state
      • ``{reading_state: ""}``      — clear state
      • ``{verdicts_add: ["favorite"]}``    — add one verdict
      • ``{verdicts_remove: ["favorite"]}`` — remove one verdict
      • ``{verdicts: ["favorite", "recommend"]}`` — set the entire list
    """
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 1, "verdicts": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    allowed = await _valid_verdict_keys_for(user)
    now = datetime.now(timezone.utc).isoformat()
    set_ops: Dict[str, Any] = {}
    unset_ops: Dict[str, Any] = {}
    add_to_set: Dict[str, Any] = {}
    pull_from_set: Dict[str, Any] = {}

    apply_state, state_value = _validate_reading_state(body.reading_state)
    if apply_state:
        if state_value is None:
            unset_ops["reading_state"] = ""
        else:
            set_ops["reading_state"] = state_value
        set_ops["reading_state_updated_at"] = now

    if body.verdicts is not None:
        # Full set: replace the array.  Reject any unknown keys.
        unknown = [v for v in body.verdicts if v not in allowed]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown verdicts: {unknown}")
        set_ops["verdicts"] = list(dict.fromkeys(body.verdicts))  # dedupe, preserve order
        set_ops["verdicts_updated_at"] = now

    if body.verdicts_add:
        unknown = [v for v in body.verdicts_add if v not in allowed]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown verdicts: {unknown}")
        add_to_set["verdicts"] = {"$each": list(dict.fromkeys(body.verdicts_add))}
        set_ops["verdicts_updated_at"] = now

    if body.verdicts_remove:
        # No need to validate — pulling a non-existent key is a no-op.
        pull_from_set["verdicts"] = {"$in": list(dict.fromkeys(body.verdicts_remove))}
        set_ops["verdicts_updated_at"] = now

    if not (set_ops or unset_ops or add_to_set or pull_from_set):
        # Nothing to do; mirror the existing state back so the FE can
        # still re-render from the response without an extra round-trip.
        return await _serialize_verdict(book_id, user.user_id)

    # Mongo refuses $set + $unset of the same field in one op; ditto
    # $addToSet + $pull of the same array.  Split into ordered ops if
    # both are present.  In practice the FE never sends a conflict.
    ops: Dict[str, Any] = {}
    if set_ops:
        ops["$set"] = set_ops
    if unset_ops:
        ops["$unset"] = unset_ops
    if add_to_set:
        ops["$addToSet"] = add_to_set
    if pull_from_set:
        # If we already need $set/$unset, run pull first as a separate update.
        if ops:
            await db.books.update_one(
                {"book_id": book_id, "user_id": user.user_id},
                {"$pull": pull_from_set},
            )
        else:
            ops["$pull"] = pull_from_set
    if ops:
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            ops,
        )

    return await _serialize_verdict(book_id, user.user_id)


async def _serialize_verdict(book_id: str, user_id: str) -> Dict[str, Any]:
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user_id},
        {"_id": 0, "book_id": 1, "reading_state": 1, "verdicts": 1,
         "reading_state_updated_at": 1, "verdicts_updated_at": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Book not found")
    doc.setdefault("verdicts", [])
    return doc


@api_router.post("/books/bulk/verdicts")
async def bulk_verdicts(body: BulkVerdictsBody, user: User = Depends(get_current_user)):
    """Apply the same verdict / state edit to many books at once.

    Returns ``{"updated": N}`` — the count is the MAX of the
    individual operation modified-counts (matching the pattern used
    by ``/books/bulk/metadata`` so the FE can show one consistent
    "Updated N books" toast).
    """
    if not body.book_ids:
        return {"updated": 0}

    allowed = await _valid_verdict_keys_for(user)
    now = datetime.now(timezone.utc).isoformat()
    updated = 0

    apply_state, state_value = _validate_reading_state(body.reading_state)
    if apply_state:
        match = {"book_id": {"$in": body.book_ids}, "user_id": user.user_id}
        if state_value is None:
            result = await db.books.update_many(
                match,
                {"$unset": {"reading_state": ""},
                 "$set": {"reading_state_updated_at": now}},
            )
        else:
            result = await db.books.update_many(
                match,
                {"$set": {"reading_state": state_value,
                          "reading_state_updated_at": now}},
            )
        updated = max(updated, result.modified_count)

    if body.verdicts_add:
        unknown = [v for v in body.verdicts_add if v not in allowed]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown verdicts: {unknown}")
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$addToSet": {"verdicts": {"$each": list(dict.fromkeys(body.verdicts_add))}},
             "$set": {"verdicts_updated_at": now}},
        )
        updated = max(updated, result.modified_count)

    if body.verdicts_remove:
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$pull": {"verdicts": {"$in": list(dict.fromkeys(body.verdicts_remove))}},
             "$set": {"verdicts_updated_at": now}},
        )
        updated = max(updated, result.modified_count)

    return {"updated": updated}


@api_router.post("/verdicts/custom")
async def add_custom_verdict(body: CustomVerdictBody, user: User = Depends(get_current_user)):
    """Add a custom verdict slot to this user's taxonomy.

    Returns the canonical doc that was stored (with a minted ``key``
    if the caller didn't pin one), so the FE can immediately add it
    to its lookup tables without a refetch.
    """
    label = (body.label or "").strip()
    emoji = (body.emoji or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="label is required")
    if len(label) > CUSTOM_LABEL_MAX:
        raise HTTPException(status_code=400, detail=f"label too long (max {CUSTOM_LABEL_MAX})")
    if not emoji:
        raise HTTPException(status_code=400, detail="emoji is required")
    if len(emoji) > CUSTOM_EMOJI_MAX:
        raise HTTPException(status_code=400, detail="emoji must be a single character")

    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "custom_verdicts": 1},
    )
    customs: List[Dict[str, str]] = (doc or {}).get("custom_verdicts") or []
    existing_keys = {c["key"] for c in customs if c.get("key")}

    if len(customs) >= CUSTOM_VERDICT_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"You can only have {CUSTOM_VERDICT_MAX} custom verdicts. Delete one first.",
        )

    if body.key:
        if not CUSTOM_KEY_PATTERN.match(body.key):
            raise HTTPException(
                status_code=400,
                detail="Custom keys must start with 'custom_' followed by lowercase "
                       "letters, digits, or underscores (e.g. custom_pride_month).",
            )
        if body.key in BUILTIN_VERDICT_KEYS:
            raise HTTPException(
                status_code=400,
                detail=f"'{body.key}' conflicts with a built-in verdict.",
            )
        if body.key in existing_keys:
            raise HTTPException(status_code=409, detail=f"'{body.key}' already exists.")
        new_key = body.key
    else:
        new_key = _mint_custom_key(label, existing_keys)

    new_doc = {
        "key": new_key,
        "label": label,
        "emoji": emoji,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$push": {"custom_verdicts": new_doc}},
    )
    return new_doc


@api_router.delete("/verdicts/custom/{key}")
async def delete_custom_verdict(key: str, user: User = Depends(get_current_user)):
    """Delete a custom verdict slot AND pull it off every book the
    user owns — orphan keys on books would render as empty chips
    after deletion, which is confusing.
    """
    if not key.startswith("custom_"):
        raise HTTPException(
            status_code=400,
            detail="Only custom verdicts (custom_*) can be deleted.",
        )
    pull_result = await db.users.update_one(
        {"user_id": user.user_id},
        {"$pull": {"custom_verdicts": {"key": key}}},
    )
    if pull_result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Custom verdict not found")
    # Clean the key off any of this user's books that carried it.
    await db.books.update_many(
        {"user_id": user.user_id, "verdicts": key},
        {"$pull": {"verdicts": key}},
    )
    return {"deleted": True, "key": key}


__all__ = []
