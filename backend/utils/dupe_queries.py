"""Shared Mongo filter helpers for duplicate detection.

The rescan endpoint and the admin diagnostics endpoint both need to
scan the caller's *active* books when computing duplicate groups.
"Active" means: not in Trash, not archived to Old stories, not
already quarantined for review, and not superseded by a newer copy.

Historically these filters lived inline at both call sites and drifted
apart — the drift caused the July 2026 "diagnostic shows 19 excess
but rescan says 0" production bug.  This module centralizes the
shared filter so any future change lands in one place.
"""
from __future__ import annotations

from typing import Any, Dict

# Kept in sync with the constants used across the routes module tree.
# These are string categories on the books collection.
TRASH_SHELF = "Trash"
OLD_STORIES_SHELF = "Old stories"


def active_dupe_candidates_query(user_id: str) -> Dict[str, Any]:
    """Return the Mongo filter for books that should be *considered*
    when scanning for likely duplicates.

    Excludes:
      * Trash                    → soft-deleted, will be purged
      * Old stories              → archived old version of a promoted duplicate
      * ``duplicate_pending``    → already flagged, awaiting operator review
      * ``replaced_by`` set      → superseded by a newer copy
    """
    return {
        "user_id": user_id,
        "category": {"$nin": [TRASH_SHELF, OLD_STORIES_SHELF]},
        "duplicate_pending": {"$ne": True},
        "replaced_by": {"$exists": False},
    }
