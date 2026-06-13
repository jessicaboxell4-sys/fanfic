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
