"""Calibre EPUB conversion pipeline.

Extracted from ``routes/books.py`` (Phase 6C, 2026-08-22) so the upload
flow, the conversions router, and the unit tests can all share one
canonical implementation. Nothing in here holds Mongo state directly
apart from the small ``conversion_jobs`` bookkeeping used by
``_conversion_start`` / ``_conversion_end`` — everything else is a
stateless subprocess call.

Public API re-exported from ``routes.books`` for backwards-compat
with existing tests and callers:

  * ``NEEDS_CONVERSION_EXTS`` — file extensions we send through Calibre.
  * ``NEEDS_CONVERSION_SHELF`` — display shelf name used while a book
    is still awaiting conversion.
  * ``CONVERSION_VISIBILITY_HOURS`` — TTL window for finished jobs.
  * ``_CALIBRE_FRIENDLY_ERRORS`` — stderr-substring → user message
    mapping table (also referenced by the friendly-error tests).
  * ``_friendly_calibre_error`` — collapses a Calibre stderr blob to
    one calm sentence.
  * ``_convert_to_epub_sync`` — blocking subprocess wrapper. Meant to
    be run in an executor.
  * ``convert_to_epub`` — async coroutine that grabs the shared
    Calibre semaphore + honors the ``calibre_convert_enabled`` feature
    flag before shelling out.
  * ``_get_calibre_semaphore`` — lazy-init helper (must be created
    inside a running event loop).
  * ``_ensure_conversion_index`` / ``_conversion_start`` /
    ``_conversion_end`` — job-log bookkeeping.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from deps import db, logger


NEEDS_CONVERSION_EXTS = {
    ".pdf", ".mobi", ".azw", ".azw3", ".kf8", ".kfx",
    ".docx", ".doc", ".rtf", ".fb2", ".lit", ".lrf", ".pdb", ".txt", ".html", ".htm",
}
NEEDS_CONVERSION_SHELF = "Needs conversion"

# 4-hour visibility window on finished conversion jobs; a TTL index on
# ``expires_at`` cleans up completed rows automatically.
CONVERSION_VISIBILITY_HOURS = 4


_CALIBRE_FRIENDLY_ERRORS = (
    # (lowercased substring to look for in stderr, optional second
    # substring that must ALSO be present, friendly message)
    ("indexerror", "list index out of range",
        "This PDF's layout couldn't be auto-parsed (likely an empty page, a scanned page with no extractable text, or an unusual layout)."),
    ("memoryerror", None,
        "This file is too large for our server to convert. Try compressing it first or converting it manually."),
    ("drmerror", None,
        "This file is DRM-protected. We can't convert protected files — please convert it on your own device first."),
    ("is encrypted", None,
        "This PDF is password-protected. Remove the password first, then re-upload."),
    ("not a valid pdf", None,
        "This doesn't look like a valid PDF file. It may be corrupted."),
    ("bad encrypt dict", None,
        "This PDF appears to be corrupted or non-standard. Try re-saving it from the original source."),
    ("no text", None,
        "This PDF appears to be image-only (scanned, no OCR'd text). We can't reflow it into an EPUB."),
)


def _friendly_calibre_error(raw_stderr: str) -> str:
    """Map a Calibre ebook-convert stderr blob to a one-sentence
    end-user message.  Calibre's stack traces are precise but
    intimidating to non-developer readers; we collapse them to a
    single calm sentence and keep the actionable fix.

    Falls back to a generic line when no pattern matches.  The full
    raw stderr is still logged server-side via ``logger.warning`` so
    the operator can debug — only the *displayed* description is
    cleaned up.
    """
    haystack = (raw_stderr or "").lower()
    for needle1, needle2, friendly in _CALIBRE_FRIENDLY_ERRORS:
        if needle1 in haystack and (needle2 is None or needle2 in haystack):
            return friendly
    return "We couldn't auto-convert this file — Calibre returned an error we don't have a friendly explanation for yet."


def _convert_to_epub_sync(src_path: Path, dest_path: Path) -> Optional[str]:
    """Run ``ebook-convert <src> <dest>`` synchronously.

    Returns ``None`` on success, or a *user-friendly* error message on
    failure. Called from an executor so the FastAPI event loop stays
    responsive.

    Raw stderr is logged for the operator (``logger.warning``) but
    only the mapped friendly message is returned to the caller, so
    the user's library description doesn't show a Python stack trace.
    """
    import subprocess
    try:
        proc = subprocess.run(
            ["ebook-convert", str(src_path), str(dest_path)],
            capture_output=True,
            text=True,
            timeout=180,  # 3 min cap per book — heavy PDFs can be slow
        )
        if proc.returncode != 0:
            raw = (proc.stderr or proc.stdout or "")
            # Operator-visible full log for debugging.
            logger.warning(
                "ebook-convert failed for %s (rc=%s): %s",
                src_path.name, proc.returncode, raw[-800:].strip(),
            )
            return _friendly_calibre_error(raw)
        if not dest_path.exists() or dest_path.stat().st_size < 256:
            return "Calibre converted the file but the result was empty — the source may be image-only or otherwise unreadable."
        return None
    except FileNotFoundError:
        return "Our converter isn't ready yet (Calibre is still installing). Please try again in a minute."
    except subprocess.TimeoutExpired:
        return "This file took longer than 3 minutes to convert and was stopped. Try a smaller / compressed version."
    except Exception as e:
        logger.warning("ebook-convert crashed for %s: %s", src_path.name, e)
        return "Something unexpected went wrong while converting this file. Try uploading the EPUB version instead."


# Lazy semaphore init — asyncio.Semaphore must be created inside a
# running event loop, otherwise it captures the wrong loop and raises
# "Future attached to a different loop" under heavy traffic.
_calibre_sem: Optional[asyncio.Semaphore] = None


def _get_calibre_semaphore() -> asyncio.Semaphore:
    global _calibre_sem
    if _calibre_sem is None:
        _calibre_sem = asyncio.Semaphore(2)
    return _calibre_sem


async def convert_to_epub(src_path: Path, dest_path: Path) -> Optional[str]:
    """Async wrapper around ``_convert_to_epub_sync``.

    Honors the ``calibre_convert_enabled`` admin kill-switch and caps
    concurrent Calibre invocations to 2 (see semaphore comment). Any
    non-``None`` return value is a user-facing message safe to store
    on the book's ``description`` field.
    """
    # Feature-flag kill switch — admin can pause Calibre conversions.
    from utils.feature_flags import is_enabled
    if not await is_enabled("calibre_convert_enabled"):
        return "Calibre conversion is temporarily disabled by an administrator."
    # 2026-06-21 — Cap concurrent Calibre invocations to 2 to avoid OOM
    # on the production Launch tier (2 GiB pod limit).  ebook-convert
    # holds ~200-400 MB transiently per conversion, and clamd already
    # claims ~960 MB persistently — Emergent Support flagged in the
    # ClamAV bake-in thread that "concurrent ebook conversions could
    # push the pod past the 2 GiB limit. Cap concurrent conversions to
    # 1 or 2 in your app code."  Chose 2 (not 1) so a single user with
    # a queue doesn't fully block a second user from converting at the
    # same time, while still staying inside the headroom budget.
    sem = _get_calibre_semaphore()
    async with sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _convert_to_epub_sync, src_path, dest_path)


# Persistent conversion-job tracking — backed by MongoDB so jobs survive
# backend restarts, tab closes, and cross-device sessions. A TTL index on
# ``expires_at`` cleans up finished jobs after the 4-hour visibility window.
_conversion_index_ensured = False


async def _ensure_conversion_index() -> None:
    """Lazily create a TTL index on ``conversion_jobs.expires_at``."""
    global _conversion_index_ensured
    if _conversion_index_ensured:
        return
    try:
        await db.conversion_jobs.create_index("expires_at", expireAfterSeconds=0)
        await db.conversion_jobs.create_index([("user_id", 1), ("started_at", -1)])
        _conversion_index_ensured = True
    except Exception as e:
        logger.warning("Failed to create conversion_jobs indexes: %s", e)


async def _conversion_start(user_id: str, job: Dict[str, Any]) -> None:
    await _ensure_conversion_index()
    doc = {
        **job,
        "user_id": user_id,
        "status": "processing",
        # expires_at intentionally omitted so the TTL doesn't apply while
        # the job is still running.
    }
    await db.conversion_jobs.insert_one(doc)


async def _conversion_end(user_id: str, job_id: str, *, error: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=CONVERSION_VISIBILITY_HOURS)
    await db.conversion_jobs.update_one(
        {"id": job_id, "user_id": user_id},
        {
            "$set": {
                "status": "failed" if error else "done",
                "error": error,
                "finished_at": now.isoformat(),
                "expires_at": expires,
            }
        },
    )


__all__ = [
    "NEEDS_CONVERSION_EXTS",
    "NEEDS_CONVERSION_SHELF",
    "CONVERSION_VISIBILITY_HOURS",
    "_CALIBRE_FRIENDLY_ERRORS",
    "_friendly_calibre_error",
    "_convert_to_epub_sync",
    "_get_calibre_semaphore",
    "convert_to_epub",
    "_ensure_conversion_index",
    "_conversion_start",
    "_conversion_end",
]
