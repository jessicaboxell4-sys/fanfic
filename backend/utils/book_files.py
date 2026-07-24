"""Book filesystem + filename helpers.

Extracted from ``routes/books.py`` (Phase 6C slice 4, 2026-08-22).

Public surface (all re-exported from ``routes.books`` so downstream
callers — ``routes.books_links``, ``routes.books_versions``,
``routes.covers``, ``routes.user_prefs``, ``utils.fanfic.apply_refresh``
and the pytest suite — keep resolving from ``routes.books`` unchanged):

  * ``_write_local_and_mirror_to_r2`` — canonical "write bytes to
    disk AND mirror to Cloudflare R2" helper. Local disk is the
    performance cache, R2 is the durable source of truth. Never
    raises on mirror failures — the caller has no idempotent retry
    path so we log + rely on the every-10-min storage backfill cron.
  * ``_safe_folder`` — sanitize a name for use as a directory/zip
    folder entry (bounded, ASCII-safe).
  * ``_safe_filename`` — sanitize a name + append the file extension.
  * ``_templated_filename`` — canonical attachment name
    ``Title_by_Author-shortid.epub`` used for downloads, mail
    attachments, and versioned re-uploads.

Nothing here talks to Mongo; the module is trivially unit-testable
without a running event loop.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Optional

from deps import logger


async def _write_local_and_mirror_to_r2(
    local_path: Path,
    payload: bytes,
    user_id: str,
    book_id: str,
    ext: str,
) -> None:
    """Write ``payload`` to ``local_path`` AND immediately mirror it to
    R2 if cloud storage is enabled.

    Same defensive pattern as ``upload_books``'s bulk mirror — see
    2026-06-21 incident in CHANGELOG.md. Local disk is the cache, R2
    is the source of truth. Pre-2026-06-21, the entire codebase wrote
    bytes to local disk and trusted the every-10-min storage backfill
    cron to push them to R2; pod restarts inside that 10-min window
    destroyed the bytes permanently (we lost 53 of 65 books to this
    on prod).

    Mirror failures here log a warning and rely on the cron retry —
    they MUST NOT raise back to the caller, because the bytes are
    already safely on local disk and the caller has no idempotent
    retry path.
    """
    local_path.write_bytes(payload)
    try:
        from utils.storage_cloud import (
            is_enabled as _cloud_on,
            mirror_up as _r2_mirror_up,
            storage_key_for as _r2_key,
        )
        if _cloud_on():
            await asyncio.to_thread(
                _r2_mirror_up, local_path, _r2_key(user_id, book_id, ext),
            )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "_write_local_and_mirror_to_r2: R2 mirror failed for %s "
            "(book=%s ext=%s): %s — file safe on local disk, cron will retry.",
            local_path.name, book_id, ext, e,
        )


def _safe_folder(name: str) -> str:
    """Mirror of ``routes/exports.py::_safe_folder`` — sanitised dir/file
    name. Collapses anything outside ``[A-Za-z0-9_\\-. ]`` to underscore,
    truncates at 60 chars, defaults to ``'unknown'``.
    """
    out = re.sub(r"[^\w\-. ]+", "_", (name or "").strip())
    return out[:60] or "unknown"


def _safe_filename(name: str, ext: str) -> str:
    """Sanitize a name for use in an HTTP ``Content-Disposition`` or a
    zip entry name. Strips path separators, control characters and the
    common filesystem-unsafe punctuation; caps the base at 120 chars;
    appends ``ext`` verbatim (caller-controlled, e.g. ``.epub``).
    """
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name or 'book').strip().rstrip('.')
    base = base[:120] or 'book'
    return f"{base}{ext}"


def _templated_filename(title: Optional[str], author: Optional[str], book_id: str, ext: str = ".epub") -> str:
    """Build a filename matching the attachment template:
    ``Title_by_Author-shortid.epub``.

    Underscores replace spaces, control and filesystem-unsafe chars are
    stripped, and a short 8-char book_id suffix disambiguates same-name
    fics. Used for download attachments, Send-to-Kindle email
    attachments, and versioned re-uploads.
    """
    def _clean(s: str) -> str:
        s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', s or '')
        s = re.sub(r'\s+', '_', s.strip())
        return s.strip('._') or ''
    title_part = _clean(title or 'Untitled')[:80]
    author_part = _clean(author or 'Unknown')[:50]
    # Take the trailing 8 chars of the book_id for a stable, short,
    # unique suffix (matches the historical output of this helper).
    short_id = (book_id or '').split('_')[-1][:8] or 'x'
    return f"{title_part}_by_{author_part}-{short_id}{ext}"


__all__ = [
    "_write_local_and_mirror_to_r2",
    "_safe_folder",
    "_safe_filename",
    "_templated_filename",
]
