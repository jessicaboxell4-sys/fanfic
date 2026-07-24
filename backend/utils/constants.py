"""Shared constants used across multiple ``routes/`` modules.

Kept tiny on purpose — these are simple values that need to stay in
sync across modules (e.g. the canonical name of the soft-delete shelf).
"""
from __future__ import annotations

# Soft-delete shelf. Books moved here are hidden from every library
# view + count but their EPUB and metadata are preserved so the user
# can restore from ``/api/trash/restore``.
TRASH_SHELF = "Trash"

# Grace window before a book in Trash is hard-deleted by the daily
# sweep (``routes/trash.sweep_expired_trash``).
TRASH_GRACE_DAYS = 30

# 2026-08-24 — Canonical trash reasons.  Every code path that moves a
# book to TRASH_SHELF should tag it with one of these strings on the
# ``trash_reason`` field so ``/api/trash`` can surface a human-readable
# explanation to the user ("Why is this book in my Trash?").  Keep the
# copy short (≤ 60 chars) and user-facing — this text appears in the
# per-row card on the Trash page.
TRASH_REASON_UPLOAD_DUPLICATE = "Duplicate discarded during upload"
TRASH_REASON_QUARANTINE_DISCARD = "Discarded from Quarantine"
TRASH_REASON_QUARANTINE_BATCH = "Batch-discarded from Quarantine"
TRASH_REASON_DUPLICATE_RESOLVED = "Chose to discard when resolving a duplicate"
TRASH_REASON_BULK_DELETE = "Removed via bulk delete"
TRASH_REASON_MANUAL = "Removed from library"  # legacy fallback

# Interim shelf for books that have been uploaded but not yet
# classified.  Set by ``routes/books.upload_books`` when classifier
# work is deferred to the background polish worker (see
# ``utils/polish_worker.py`` + 2026-06-27 changelog).  Books move
# out of this shelf the moment the worker fills in ``fandom`` /
# ``category`` from Claude's response.
PENDING_SORT_SHELF = "Pending sort"

# Historical-versions shelf. When a fanfic is re-fetched via
# ``routes.fanfic.apply_refresh`` or a user picks
# ``historical`` in the duplicate resolver, the older copy is moved
# here so it stays discoverable but off the main library grid. Kept
# canonical here so ``utils/duplicates`` and ``utils/fanfic`` can both
# reference it without importing each other.
OLD_STORIES_SHELF = "Old stories"
