"""Object-storage adapter — local filesystem mirrored to Emergent Object
Storage.

Architecture
------------

Shelfsort historically writes user uploads to ``STORAGE_DIR/{user_id}/
{book_id}.{ext}`` on the container's local filesystem.  That works
fine until a redeploy — at which point the entire pod disk is wiped
and every EPUB / cover the user has uploaded vanishes.

This module adds a durable mirror against Emergent's managed object
storage so the container disk becomes purely a cache:

* Every successful local write → ``mirror_up()`` async-task uploads
  the same bytes to ``shelfsort/users/{user_id}/{book_id}.{ext}``.
* Every local read that finds the file missing → ``restore_to_disk()``
  downloads from object storage and re-caches it on the container.

The adapter is intentionally provider-agnostic.  The current
implementation talks to Emergent Object Storage; swapping to
Cloudflare R2 in the future is a single-file change (this one) — no
caller has to know.

API:
    - mirror_up(local_path: Path, key: str) -> bool
    - restore_to_disk(local_path: Path, key: str) -> bool
    - delete_remote(key: str) -> bool
    - storage_key_for(user_id, book_id, ext) -> str
    - is_enabled() -> bool

All functions are sync (run inside threadpool) so callers can choose
to fire-and-forget via ``asyncio.create_task(asyncio.to_thread(...))``.

Failures are logged and *never* raise — object storage being briefly
unreachable should not break uploads or downloads.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)


STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME    = "shelfsort"


def _emergent_key() -> str:
    """Late-bound key read so we get the value AFTER ``load_dotenv``
    in ``deps.py`` has populated the environment.  Reading at import
    time gives an empty string because this module is sometimes
    imported before the dotenv layer."""
    return os.environ.get("EMERGENT_LLM_KEY", "")


# Cached session-scoped storage key — re-init only if it expires.
_storage_key: Optional[str] = None
_init_failed_at: float = 0.0
_INIT_RETRY_AFTER_SECS = 60   # back off after a failed init so we don't
                              # hammer the upstream every request.


def is_enabled() -> bool:
    """Object storage is opt-in via env: if EMERGENT_LLM_KEY is unset
    (e.g., local dev container without integrations) the adapter
    silently no-ops so the legacy local-FS path keeps working."""
    return bool(_emergent_key())


def _init_storage(force: bool = False) -> Optional[str]:
    """Lazily fetch a ``storage_key``.  Cached across calls; refreshed
    on demand when ``force=True`` (e.g., after a 403)."""
    global _storage_key, _init_failed_at
    if not is_enabled():
        return None
    if _storage_key and not force:
        return _storage_key
    if _init_failed_at and (time.time() - _init_failed_at) < _INIT_RETRY_AFTER_SECS:
        return None   # back off
    try:
        resp = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": _emergent_key()},
            timeout=15,
        )
        resp.raise_for_status()
        _storage_key = resp.json()["storage_key"]
        _init_failed_at = 0.0
        return _storage_key
    except Exception as e:
        logger.warning("Object storage init failed: %s", e)
        _init_failed_at = time.time()
        return None


def storage_key_for(user_id: str, book_id: str, ext: str) -> str:
    """Canonical remote object path for a book asset.

    Examples
    --------
    ``storage_key_for('u123', 'bk456', '.epub')`` → ``shelfsort/users/u123/bk456.epub``
    ``storage_key_for('u123', 'bk456', '.cover')`` → ``shelfsort/users/u123/bk456.cover``
    """
    ext = ext if ext.startswith(".") else "." + ext
    return f"{APP_NAME}/users/{user_id}/{book_id}{ext}"


# ---------------------------------------------------------------------
# Sync helpers — caller decides whether to wrap in asyncio.to_thread.
# ---------------------------------------------------------------------

_MIME_OVERRIDE = {
    ".epub":      "application/epub+zip",
    ".cover":     "image/jpeg",
    ".cover.png": "image/png",
    ".links.txt": "text/plain",
    ".pdf":       "application/pdf",
}


def _content_type_for(key: str) -> str:
    for suffix, mime in _MIME_OVERRIDE.items():
        if key.endswith(suffix):
            return mime
    return "application/octet-stream"


def mirror_up(local_path: Path, key: str) -> bool:
    """Best-effort upload of ``local_path`` to remote ``key``.

    Returns ``True`` on success.  Never raises — logs and returns
    ``False`` so callers don't block uploads on transient cloud
    issues.
    """
    if not is_enabled():
        return False
    if not local_path.exists():
        return False
    storage_key = _init_storage()
    if not storage_key:
        return False
    try:
        data = local_path.read_bytes()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{key}",
            headers={"X-Storage-Key": storage_key, "Content-Type": _content_type_for(key)},
            data=data,
            timeout=120,
        )
        if resp.status_code == 403:
            # Stale key — refresh and try once more.
            storage_key = _init_storage(force=True)
            if not storage_key:
                return False
            resp = requests.put(
                f"{STORAGE_URL}/objects/{key}",
                headers={"X-Storage-Key": storage_key, "Content-Type": _content_type_for(key)},
                data=data,
                timeout=120,
            )
        if resp.status_code == 409:
            # 409 = object already exists with the same key.  We're
            # idempotently re-mirroring an existing file (e.g. on a
            # repeated upload after a re-classify).  Object storage
            # has no overwrite endpoint, but the existing copy is
            # already what we wanted, so this is success.
            return True
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.warning("Object storage upload failed for %s: %s", key, e)
        return False


def restore_to_disk(local_path: Path, key: str) -> bool:
    """Fetch ``key`` from object storage and write it to ``local_path``.
    Used when the local cache is missing (e.g., after a redeploy).
    Returns ``True`` on success."""
    if not is_enabled():
        return False
    storage_key = _init_storage()
    if not storage_key:
        return False
    try:
        resp = requests.get(
            f"{STORAGE_URL}/objects/{key}",
            headers={"X-Storage-Key": storage_key},
            timeout=60,
        )
        if resp.status_code == 403:
            storage_key = _init_storage(force=True)
            if not storage_key:
                return False
            resp = requests.get(
                f"{STORAGE_URL}/objects/{key}",
                headers={"X-Storage-Key": storage_key},
                timeout=60,
            )
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(resp.content)
        return True
    except Exception as e:
        logger.warning("Object storage restore failed for %s: %s", key, e)
        return False


def delete_remote(key: str) -> bool:
    """Best-effort delete of a remote object.

    Emergent Object Storage doesn't currently expose a hard-delete
    endpoint — the playbook recommends DB-level soft-delete.  We
    keep this stub so call sites can express intent; if Emergent
    ships a delete endpoint later we just fill this in.  Always
    returns ``True`` so callers don't fail on "expected" no-op.
    """
    # Stub — see module docstring.  Local deletion still happens
    # at the call site; the remote copy is effectively orphaned but
    # the DB row is gone so it'll never be served again.
    return True


# ---------------------------------------------------------------------
# Convenience hooks for the upload + download flow in routes/books.py
# ---------------------------------------------------------------------

def ensure_local_cached(local_path: Path, user_id: str, book_id: str, ext: str) -> bool:
    """Cache-aware read helper.

    Returns ``True`` if ``local_path`` exists on disk after the call.
    If it was missing, attempts to restore from object storage first.
    Used by every read endpoint that historically served files from
    the local filesystem — replaces a bare ``if not fp.exists(): 404``
    with "check cloud first, then 404"."""
    if local_path.exists():
        return True
    key = storage_key_for(user_id, book_id, ext)
    return restore_to_disk(local_path, key)


def mirror_book_asset(local_path: Path, user_id: str, book_id: str, ext: str) -> None:
    """Fire-and-forget mirror for a freshly-written book asset.

    Designed to be called from sync code with ``asyncio.to_thread``
    or scheduled as a background task — never blocks the caller's
    response.  Falls back to a synchronous call from sync contexts
    (e.g., upload helpers that run in a thread already)."""
    if not is_enabled():
        return
    key = storage_key_for(user_id, book_id, ext)
    mirror_up(local_path, key)


# ---------------------------------------------------------------------
# Background backfill — periodic scan of STORAGE_DIR for unmirrored files.
# ---------------------------------------------------------------------

# Counter exposed to the admin-trigger endpoint so the UI can show
# "backfilled X / Y files".  Module-level so the tick can stash
# progress without round-tripping through Mongo.
_LAST_BACKFILL_STATS = {"scanned": 0, "uploaded": 0, "skipped": 0, "errors": 0, "ts": None}


def _last_backfill_stats() -> dict:
    return dict(_LAST_BACKFILL_STATS)


def backfill_storage_dir(storage_dir: Path, limit: Optional[int] = None) -> dict:
    """Walk ``storage_dir`` and mirror every book asset to object
    storage.  Idempotent — Emergent returns 409 on re-uploads which
    we treat as success.

    ``limit`` caps the number of files processed in a single call so
    a 100k-file library doesn't deadlock a single tick.  The cron
    scheduler calls this every 10 min until everything is mirrored.

    Returns: ``{scanned, uploaded, skipped, errors}``.
    """
    import time as _time
    stats = {"scanned": 0, "uploaded": 0, "skipped": 0, "errors": 0}
    if not is_enabled():
        return stats
    if not storage_dir.exists():
        return stats
    suffixes_of_interest = (".epub", ".cover", ".cover.png", ".links.txt", ".pdf")
    count = 0
    for user_dir in storage_dir.iterdir():
        if not user_dir.is_dir():
            continue
        user_id = user_dir.name
        for f in user_dir.iterdir():
            if not f.is_file():
                continue
            name = f.name
            ext: Optional[str] = None
            for s in suffixes_of_interest:
                if name.endswith(s):
                    ext = s
                    break
            if ext is None:
                continue
            book_id = name[: -len(ext)] if name.endswith(ext) else f.stem
            if not book_id:
                continue
            stats["scanned"] += 1
            key = storage_key_for(user_id, book_id, ext)
            try:
                ok = mirror_up(f, key)
                if ok:
                    stats["uploaded"] += 1
                else:
                    stats["skipped"] += 1
            except Exception as e:
                logger.warning("Backfill failed for %s: %s", key, e)
                stats["errors"] += 1
            count += 1
            if limit and count >= limit:
                stats["ts"] = _time.time()
                _LAST_BACKFILL_STATS.update(stats)
                return stats
    stats["ts"] = _time.time()
    _LAST_BACKFILL_STATS.update(stats)
    return stats
