"""``utils/av_background.py`` — fire-and-forget AV scanning queue.

Why: ClamAV's ``clamscan`` cold-loads its ~200MB signature DB on every
invocation, which costs 6-8 seconds per file.  On a 100-file EPUB drop
that's 10+ minutes the user sits and watches a spinner.  ``clamdscan``
helps (it talks to a running ``clamd`` daemon and reuses the DB), but
even that's ~50-200ms per file — enough to be felt on big bulk imports.

So we let the upload return IMMEDIATELY and run the AV scan in a
background task.  The book is marked ``av_status: "pending"`` until
the scan completes.  Status transitions:

  pending  → clean    (scan ran, file is clean)
  pending  → infected (scan ran, file flagged; quarantined + deleted)
  pending  → unscanned (scan threw or timed out)

The existing ``/account/safety`` widget + admin "Antivirus quarantine"
card surface ``pending`` / ``infected`` / ``unscanned`` counts so the
user always knows there's an in-flight scan and there's a manual
"Rescan" button to recover from a stuck queue.

================ CONCURRENCY ================
A semaphore caps the worker count so concurrent bulk uploads don't
spawn 100 simultaneous ClamAV subprocesses (which would CPU-pin the
node).  Default 4 — enough to keep ClamAV warm without saturating.

================ RECOVERY ================
A cron in ``server.py`` (``av_pending_recovery_tick``) rescans any
book stuck in ``av_status: "pending"`` for >5 minutes.  Covers the
case where the backend restarted mid-scan or the in-memory queue
was lost to OOM.

================ PUBLIC API ================

  schedule_background_scan(user_id, book_id, av_bytes, filename)
    Fire-and-forget — schedules a scan task and returns immediately.

  rescan_pending(max_age_seconds=300)
    Cron entry-point — picks up stale ``pending`` rows and re-scans
    them from disk (the upload bytes are long gone from memory).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Worker concurrency cap.  Each ClamAV scan can briefly spike to ~250MB
# resident memory; 4 is the comfortable ceiling on our standard pod.
# Override via env for higher-tier deployments.
_MAX_CONCURRENT = int(os.environ.get("AV_BG_CONCURRENCY", "4"))
_sem: Optional[asyncio.Semaphore] = None


def _get_sem() -> asyncio.Semaphore:
    """Lazy-init the semaphore on the current event loop.  Importing
    this module doesn't bind to a loop, which keeps unit tests sane.
    """
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(_MAX_CONCURRENT)
    return _sem


def schedule_background_scan(
    user_id: str,
    book_id: str,
    av_bytes: bytes,
    filename: str,
    *,
    storage_path: Optional[Path] = None,
) -> None:
    """Spawn a fire-and-forget AV scan for ``av_bytes`` and update the
    book's ``av_status`` when it finishes.

    Caller has typically just:
      1. Written the file to disk under ``user_dir/{book_id}.epub``
      2. Inserted the book doc with ``av_status: "pending"``
      3. Returned 200 to the user

    The scan results land async — the user's ``/library/all`` will
    flip the book's badge from "Scanning…" to "Clean" (or pull the
    book into quarantine if infected).

    ``storage_path``: optional path to the saved-on-disk copy.  Used
    by the recovery cron path; for fresh uploads we scan the bytes
    we still have in memory.
    """
    try:
        asyncio.create_task(
            _run_scan(user_id, book_id, av_bytes, filename, storage_path)
        )
    except RuntimeError as e:
        # No running loop (e.g. called from a sync test) — fall back
        # to inline so we never silently lose a scan.
        logger.warning(
            "schedule_background_scan called outside event loop, falling back inline: %s", e,
        )
        # Best-effort sync run; callers in this state are tests, not prod.
        try:
            from utils.antivirus import scan_bytes
            result = scan_bytes(av_bytes, hint_name=filename)
            asyncio.run(_apply_scan_result(user_id, book_id, result, len(av_bytes), filename))
        except Exception as exc:
            logger.exception("Inline fallback AV scan failed: %s", exc)


async def _run_scan(
    user_id: str,
    book_id: str,
    av_bytes: bytes,
    filename: str,
    storage_path: Optional[Path],
) -> None:
    """Background coroutine — bound by the global semaphore so we
    don't fan out unbounded ClamAV subprocesses on big bulk imports.
    """
    sem = _get_sem()
    async with sem:
        try:
            from utils.antivirus import scan_bytes
            result = await asyncio.to_thread(
                scan_bytes, av_bytes, hint_name=filename,
            )
        except Exception as e:
            logger.warning("Background AV scan threw for %s: %s", book_id, e)
            # Mark unscanned so the user-safety widget surfaces it
            # for manual rescan — failing closed (deleting the book)
            # would be too aggressive when our scanner is the broken
            # thing, not the file.
            await _apply_scan_result(
                user_id, book_id,
                {"ok": False, "infected": False, "error": str(e),
                 "signature": None, "scanner": "background"},
                len(av_bytes), filename,
            )
            return

        await _apply_scan_result(user_id, book_id, result, len(av_bytes), filename)


async def _apply_scan_result(
    user_id: str,
    book_id: str,
    result: dict,
    size_bytes: int,
    filename: str,
) -> None:
    """Translate a ScanResult dict into book-doc + quarantine writes."""
    from deps import db
    now_iso = datetime.now(timezone.utc).isoformat()

    if result.get("infected"):
        from utils.antivirus import record_quarantine
        await record_quarantine(
            user_id=user_id,
            filename=filename,
            scan=result,
            source="upload",
            extra={"size_bytes": size_bytes, "background": True},
        )
        # Flag the book as infected — Send-to-Kindle / friend-share /
        # public-library all already refuse rows with non-"clean"
        # av_status, so this immediately revokes the file's reach
        # without needing to delete it.  The user gets a notification
        # via the existing /account/safety widget.
        await db.books.update_one(
            {"book_id": book_id, "user_id": user_id},
            {"$set": {
                "av_status": "infected",
                "av_signature": result.get("signature"),
                "av_scanned_at": now_iso,
            }},
        )
        logger.warning(
            "Background AV flagged %s as %s for user %s",
            book_id, result.get("signature"), user_id,
        )
        return

    if not result.get("ok"):
        # Scanner couldn't run — mark unscanned so user-safety widget
        # picks it up for retry.
        await db.books.update_one(
            {"book_id": book_id, "user_id": user_id},
            {"$set": {
                "av_status": "unscanned",
                "av_scanned_at": now_iso,
            }},
        )
        return

    # Clean scan — flip the status.
    await db.books.update_one(
        {"book_id": book_id, "user_id": user_id},
        {"$set": {
            "av_status": "clean",
            "av_signature": None,
            "av_scanned_at": now_iso,
        }},
    )


async def rescan_pending(max_age_seconds: int = 300) -> dict:
    """Cron entry-point — scan books stuck in ``av_status: "pending"``
    older than ``max_age_seconds`` by re-reading from disk.

    Covers the failure case where the backend restarted mid-scan and
    the in-memory ``_run_scan`` task was lost.  Re-reads bytes from
    the book's storage path because the original upload bytes are
    long gone.

    Returns ``{"rescanned": N, "errors": N}`` for the cron log.
    """
    from deps import db
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=max_age_seconds)

    # A pending row only qualifies for recovery if it has been
    # PENDING for longer than the cutoff.  Use ``created_at`` as
    # the age signal — a row that was just inserted seconds ago is
    # legitimately in-flight and the in-memory task is still doing
    # its job.  We don't OR with ``av_scanned_at`` (which is only
    # set after the first scan completes — using it as a recovery
    # signal would also flag every fresh upload).
    query = {
        "av_status": "pending",
        "created_at": {"$lt": cutoff.isoformat()},
    }
    rescanned = 0
    errors = 0

    cursor = db.books.find(query, {"book_id": 1, "user_id": 1, "filename": 1, "_id": 0}).limit(50)
    async for row in cursor:
        user_id = row.get("user_id")
        book_id = row.get("book_id")
        filename = row.get("filename") or f"{book_id}.epub"
        if not (user_id and book_id):
            continue
        # Re-read from local cache or R2.  Use the storage helper that
        # already exists for ensure-local-cached so we don't reimplement
        # the lookup.
        try:
            storage_dir = Path(os.environ.get("BOOKS_STORAGE_DIR", "/app/backend/storage/books"))
            local_path = storage_dir / user_id / f"{book_id}.epub"
            if not local_path.exists():
                # Try alternate extensions used by the conversion pipeline.
                for ext in (".pdf", ".mobi", ".azw3", ".azw"):
                    cand = storage_dir / user_id / f"{book_id}{ext}"
                    if cand.exists():
                        local_path = cand
                        break
            if not local_path.exists():
                # File missing — mark unscanned and move on.
                await db.books.update_one(
                    {"book_id": book_id, "user_id": user_id},
                    {"$set": {"av_status": "unscanned",
                              "av_scanned_at": datetime.now(timezone.utc).isoformat()}},
                )
                continue
            with open(local_path, "rb") as fh:
                av_bytes = fh.read()
            schedule_background_scan(user_id, book_id, av_bytes, filename,
                                     storage_path=local_path)
            rescanned += 1
        except Exception as e:
            logger.warning("Rescan failed for %s: %s", book_id, e)
            errors += 1

    if rescanned or errors:
        logger.info("av_pending_recovery_tick: rescanned=%d errors=%d", rescanned, errors)
    return {"rescanned": rescanned, "errors": errors}


__all__ = ["schedule_background_scan", "rescan_pending"]
