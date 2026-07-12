"""Shared helper: hydrate an EPUB (or cover / links) sidecar from R2 if
the local pod doesn't have it yet.

Why this exists
---------------
After the R2 storage migration, most sidecar files live in cloud storage.
Endpoints that read the local file silently no-op when the file isn't on
the pod — that was the root cause of the July 2026 "AI sorted 0 of N"
production bug and one earlier fulltext-backfill bug.  Every reader has
to remember to call ``ensure_local_cached`` first, and the same 4-line
try/except was being copy-pasted at ~10 sites.

This helper centralizes the pattern.  Callers just do::

    fp = await hydrate_epub_if_missing(user_id, book_id)
    if fp is None:
        # genuine missing file, R2 also doesn't have it
        continue
    do_stuff(fp)

Failures inside R2 hydration are logged as warnings so silent-skip
regressions stay visible in the log.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from deps import STORAGE_DIR

logger = logging.getLogger(__name__)


async def hydrate_epub_if_missing(
    user_id: str,
    book_id: str,
    ext: str = ".epub",
) -> Optional[Path]:
    """Ensure ``{STORAGE_DIR}/{user_id}/{book_id}{ext}`` exists locally.

    If the file is already on the pod, returns its path.  Otherwise
    attempts to restore from R2 via ``ensure_local_cached``.  Returns
    ``None`` if the file still isn't available after hydration (genuine
    404 or R2 outage).

    Parameters
    ----------
    user_id:
        The book owner's user_id.
    book_id:
        The book's book_id.
    ext:
        File extension including the leading dot.  Defaults to
        ``.epub``.  Use ``.cover`` or ``.links.txt`` for other sidecars.
    """
    fp = STORAGE_DIR / user_id / f"{book_id}{ext}"
    if fp.exists():
        return fp
    try:
        # Late import — utils.storage_cloud has a lazy R2 client that
        # shouldn't spin up at module load.
        from utils.storage_cloud import ensure_local_cached  # noqa: WPS433
        await asyncio.to_thread(ensure_local_cached, fp, user_id, book_id, ext)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "hydrate_epub_if_missing failed for %s/%s%s: %s",
            user_id, book_id, ext, exc,
        )
    return fp if fp.exists() else None


def hydrate_epub_if_missing_sync(
    user_id: str,
    book_id: str,
    ext: str = ".epub",
) -> Optional[Path]:
    """Sync variant for callers already running on a worker thread
    (e.g. ``run_in_executor`` bodies).  Same contract as the async
    version — returns the path if the file is available after
    hydration, ``None`` otherwise.
    """
    fp = STORAGE_DIR / user_id / f"{book_id}{ext}"
    if fp.exists():
        return fp
    try:
        from utils.storage_cloud import ensure_local_cached  # noqa: WPS433
        ensure_local_cached(fp, user_id, book_id, ext)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "hydrate_epub_if_missing_sync failed for %s/%s%s: %s",
            user_id, book_id, ext, exc,
        )
    return fp if fp.exists() else None
