"""Object-storage admin endpoints + scheduler tick.

Exposes a single admin-only POST endpoint that backfills the on-disk
``STORAGE_DIR`` to Emergent Object Storage, plus an idempotent cron
tick that runs the same backfill every 10 minutes so new uploads
land in the cloud without modifying the upload pipeline itself.

The design keeps the existing local-FS code path intact — every
write still lands at ``STORAGE_DIR/{user_id}/{book_id}.{ext}`` first.
The cloud mirror is purely additive:

* The 10-min tick walks the directory tree and re-uploads any file
  Emergent doesn't already have (idempotent via 409 = "already
  exists" treated as success).
* Read endpoints check the cloud mirror when the local cache is
  missing (post-redeploy hot-restore — see
  ``utils.storage_cloud.ensure_local_cached``).

Trade-offs (vs. inline upload-flow mirror):
* + Zero changes to the 20+ STORAGE_DIR write sites in ``books.py``.
* + Already-mirrored files are skipped via Emergent's 409 response.
* - Up to 10-min delay between local write and cloud durability — for
    a brand-new beta this is acceptable; if a user uploads and the
    pod dies within the same 10-min window, their EPUB is lost.
    Tightening this is one cron-frequency change away.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends
from datetime import datetime, timezone

from deps import api_router, logger, STORAGE_DIR, db
from models import User
from auth_dep import require_admin, get_current_user
from utils.storage_cloud import (
    backfill_storage_dir,
    is_enabled as cloud_is_enabled,
    _last_backfill_stats,
)


@api_router.post("/admin/storage/backfill")
async def trigger_storage_backfill(
    limit: Optional[int] = 2000,
    user: User = Depends(require_admin),  # noqa: ARG001
):
    """Manually trigger an object-storage backfill.

    Admins click this from the Admin Console (or curl it before a
    deploy) to be confident every file is mirrored to durable
    storage before redeploys wipe the container disk.

    ``limit`` caps the number of files processed in a single call
    (default 2 000) so a giant library can't lock the response
    thread for minutes — repeated calls just continue from where
    the previous one left off because Emergent's 409 short-circuits
    already-mirrored files.
    """
    if not cloud_is_enabled():
        return {
            "ok":      False,
            "reason":  "object_storage_disabled",
            "hint":    "EMERGENT_LLM_KEY is unset in backend/.env",
        }
    import asyncio as _asyncio
    stats = await _asyncio.to_thread(backfill_storage_dir, STORAGE_DIR, limit)
    return {"ok": True, "stats": stats}


@api_router.get("/admin/storage/status")
async def storage_backfill_status(
    user: User = Depends(require_admin),  # noqa: ARG001
):
    """Return the most recent backfill counters so the Admin Console
    can show "X files mirrored at Y" without re-running the scan."""
    return {
        "enabled": cloud_is_enabled(),
        "stats":   _last_backfill_stats(),
    }


# ---------------------------------------------------------------------
# Scheduler tick — registered from routes.digest._setup_scheduler.
# ---------------------------------------------------------------------

async def storage_backfill_tick() -> None:
    """Background cron job — runs every 10 min so new uploads land
    in the cloud without modifying the 20+ upload code paths."""
    if not cloud_is_enabled():
        return
    import asyncio as _asyncio
    try:
        stats = await _asyncio.to_thread(backfill_storage_dir, STORAGE_DIR, 5000)
        if stats.get("uploaded"):
            logger.info(
                "Storage backfill tick: uploaded=%d skipped=%d errors=%d (scanned=%d)",
                stats["uploaded"], stats["skipped"], stats["errors"], stats["scanned"],
            )
    except Exception as e:
        logger.warning("Storage backfill tick failed: %s", e)


__all__ = ["storage_backfill_tick"]


# ---------------------------------------------------------------------
# User-facing "Back up my library" — per-user backfill.
# ---------------------------------------------------------------------

@api_router.post("/account/backup-library")
async def backup_my_library(user: User = Depends(get_current_user)):
    """One-click per-user backfill.

    Triggered from Account Settings to give the user a visible trust
    signal: "your X EPUBs + covers are durably backed up as of HH:MM".
    Repeated clicks are cheap (Emergent returns 409 for already-
    mirrored files which we count as success).
    """
    if not cloud_is_enabled():
        return {
            "ok":     False,
            "reason": "object_storage_disabled",
        }
    import asyncio as _asyncio
    stats = await _asyncio.to_thread(
        backfill_storage_dir, STORAGE_DIR, 5000, user.user_id,
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"library_backup": {
            "last_run_at": now_iso, "stats": stats,
        }}},
    )
    return {"ok": True, "last_run_at": now_iso, "stats": stats}


@api_router.get("/account/backup-library")
async def get_backup_library_state(user: User = Depends(get_current_user)):
    """Returns the user's last per-user backup state so Account
    Settings can render "✓ backed up at 2026-06-18 14:32 UTC"."""
    udoc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "library_backup": 1},
    ) or {}
    prev = udoc.get("library_backup") or {}
    return {
        "enabled":     cloud_is_enabled(),
        "last_run_at": prev.get("last_run_at"),
        "stats":       prev.get("stats") or {},
    }
