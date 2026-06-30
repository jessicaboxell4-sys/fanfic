"""Staged-upload drafts (2026-06-30).

When a user has the "Stage before upload" toggle on, the dropzone
accumulates files into an in-memory tray.  If they refresh the
tab or close the laptop, that tray vanishes — File bytes can't be
persisted to localStorage and storing them in IndexedDB would
mean hundreds of MB of EPUBs sitting in the browser.

This module persists the *intent* instead: filenames, sizes, and
the picked folder roots.  Just enough that on return we can say::

    "You had 47 files staged 12 minutes ago from `Books/Kindle/Fantasy`
     — re-pick that folder to restore them."

The bytes still have to be re-picked by the user — there's no
backend storage of the actual file content.  But the friction of
"which folder did I pick last time?" is what kills recovery, and
that's exactly what we can fix without storing bytes.

Schema (one row per user, upserted)::

    {
        user_id: str,               # primary key
        files: [
            { name: str, size: int, rel_path: str }
        ],
        source_hints: [str],        # ["Books/Kindle", "Downloads/AO3"]
        total_bytes: int,
        created_at: ISO,
        updated_at: ISO,
    }
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import Body, Depends

from auth_dep import get_current_user
from deps import api_router, db
from models import User

logger = logging.getLogger(__name__)

# Hard caps so a malicious / runaway client can't dump GBs of metadata.
_MAX_FILES_PER_DRAFT = 5_000
_MAX_FILENAME_LEN = 280
_MAX_REL_PATH_LEN = 1_024
_MAX_HINTS = 25


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _derive_source_hint(rel_path: str) -> Optional[str]:
    """Pull the picked-folder root out of a relative path.

    ``"Books/Kindle/Fantasy/Tolkien/lotr.epub"`` → ``"Books/Kindle/Fantasy"``
    (up to 3 segments — enough to be useful, short enough to fit a banner).

    Bare filenames (no separator) return ``None`` so we don't fabricate
    a folder name from a single-file drop.
    """
    if not rel_path:
        return None
    parts = [p for p in rel_path.replace("\\", "/").split("/") if p]
    if len(parts) <= 1:
        return None
    # Drop the final segment (the filename), keep up to 3 leading dirs.
    folder_parts = parts[:-1][:3]
    return "/".join(folder_parts) if folder_parts else None


@api_router.put("/uploads/staged-drafts")
async def put_staged_draft(
    payload: dict = Body(default=None),
    user: User = Depends(get_current_user),
):
    """Upsert the current user's staged-draft.

    Body::

        {
            files: [{name, size, rel_path}],
        }

    ``rel_path`` is optional per-file — drag-dropped folders fill it
    from ``FileSystemEntry.fullPath``, folder-picker uploads fill it
    from ``File.webkitRelativePath``, single-file picks leave it
    empty.  The server derives ``source_hints`` so the restore banner
    doesn't need to recompute on every render.
    """
    body = payload if isinstance(payload, dict) else {}
    raw_files = body.get("files") or []
    if not isinstance(raw_files, list) or len(raw_files) == 0:
        # Empty draft → delete instead of writing an empty row.
        await db.staged_drafts.delete_one({"user_id": user.user_id})
        return {"saved": 0, "cleared": True}

    files: list[dict] = []
    hints_set: list[str] = []
    seen_hints: set[str] = set()
    total_bytes = 0
    for entry in raw_files[:_MAX_FILES_PER_DRAFT]:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "")[:_MAX_FILENAME_LEN]
        if not name:
            continue
        try:
            size = max(0, int(entry.get("size") or 0))
        except (TypeError, ValueError):
            size = 0
        rel_path = str(entry.get("rel_path") or "")[:_MAX_REL_PATH_LEN]
        files.append({"name": name, "size": size, "rel_path": rel_path})
        total_bytes += size
        hint = _derive_source_hint(rel_path)
        if hint and hint not in seen_hints and len(seen_hints) < _MAX_HINTS:
            seen_hints.add(hint)
            hints_set.append(hint)

    now = _now_iso()
    await db.staged_drafts.update_one(
        {"user_id": user.user_id},
        {
            "$set": {
                "user_id": user.user_id,
                "files": files,
                "source_hints": hints_set,
                "total_bytes": total_bytes,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {
        "saved": len(files),
        "cleared": False,
        "source_hints": hints_set,
        "total_bytes": total_bytes,
    }


@api_router.get("/uploads/staged-drafts")
async def get_staged_draft(user: User = Depends(get_current_user)):
    """Return the current user's draft, or ``{ "draft": null }`` if none."""
    row = await db.staged_drafts.find_one({"user_id": user.user_id})
    if not row:
        return {"draft": None}
    row.pop("_id", None)
    return {"draft": row}


@api_router.delete("/uploads/staged-drafts")
async def delete_staged_draft(user: User = Depends(get_current_user)):
    """Clear the current user's draft.

    Called both when the user dismisses the restore banner and when
    they successfully start an upload (the draft has done its job).
    """
    result = await db.staged_drafts.delete_one({"user_id": user.user_id})
    return {"deleted": result.deleted_count}
