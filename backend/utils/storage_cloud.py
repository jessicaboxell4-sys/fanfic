"""Object-storage adapter — local filesystem mirrored to cloud.

Architecture
------------

Shelfsort historically writes user uploads to ``STORAGE_DIR/{user_id}/
{book_id}.{ext}`` on the container's local filesystem.  That works
fine until a redeploy — at which point the entire pod disk is wiped
and every EPUB / cover the user has uploaded vanishes.

This module adds a durable mirror against a managed object store so
the container disk becomes purely a cache:

* Every successful local write → ``mirror_up()`` async-task uploads
  the same bytes to ``shelfsort/users/{user_id}/{book_id}.{ext}``.
* Every local read that finds the file missing → ``restore_to_disk()``
  downloads from object storage and re-caches it on the container.

Backend dispatch
----------------

Controlled by env var ``STORAGE_BACKEND``:
    - ``emergent`` (default) — original Emergent Object Storage
    - ``r2``                 — Cloudflare R2 via S3 API (boto3)

Reads on ``r2`` mode transparently fall back to Emergent when R2 says
"not found", and silently mirror the recovered file back into R2.
This gives a zero-downtime migration: existing files on Emergent are
"lazily" pulled into R2 the first time they're accessed after the
cutover.

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


def _backend() -> str:
    """Which object-store backend is live this request.  Late-bound so
    we read AFTER ``load_dotenv``, and operator can flip via .env hot
    reload (next supervisor restart picks it up)."""
    return (os.environ.get("STORAGE_BACKEND") or "emergent").strip().lower()


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
    """Object storage is opt-in via env: if neither EMERGENT_LLM_KEY
    nor R2 credentials are configured, the adapter silently no-ops so
    the legacy local-FS path keeps working."""
    if _backend() == "r2":
        return bool(
            os.environ.get("R2_ACCOUNT_ID")
            and os.environ.get("R2_ACCESS_KEY_ID")
            and os.environ.get("R2_SECRET_ACCESS_KEY")
            and os.environ.get("R2_BUCKET_NAME")
        )
    return bool(_emergent_key())


# ---------------------------------------------------------------------
# Cloudflare R2 backend (S3 API via boto3)
# ---------------------------------------------------------------------
# Lazily instantiated so the boto3 dependency only runs on R2-mode
# pods, and so we don't try to read R2_* env vars at import time
# (before load_dotenv).

_r2_client = None  # boto3.client('s3', ...) — cached singleton

def _get_r2_client():
    """Cached S3 client pointed at Cloudflare R2.  Reused across calls
    inside the same process so we don't pay boto3's ~150ms client
    construction cost on every read."""
    global _r2_client
    if _r2_client is not None:
        return _r2_client
    try:
        import boto3
        _r2_client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        return _r2_client
    except Exception as e:
        logger.warning("R2 client init failed: %s", e)
        return None


def _r2_head_exists(key: str) -> bool:
    """Lightweight HEAD probe — returns True if ``key`` exists in R2.
    Used by the admin migration-progress sampler.  Cheap (~50ms) so
    safe to call in a 100-key loop."""
    cli = _get_r2_client()
    if cli is None:
        return False
    try:
        bucket = os.environ["R2_BUCKET_NAME"]
        cli.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def _r2_put(local_path: Path, key: str) -> bool:
    """Upload local file to R2 at ``key``. Best-effort, returns bool."""
    cli = _get_r2_client()
    if cli is None or not local_path.exists():
        return False
    try:
        bucket = os.environ["R2_BUCKET_NAME"]
        with local_path.open("rb") as f:
            cli.put_object(
                Bucket=bucket,
                Key=key,
                Body=f,
                ContentType=_content_type_for(key),
            )
        return True
    except Exception as e:
        logger.warning("R2 upload failed for %s: %s", key, e)
        return False


def _r2_get(local_path: Path, key: str) -> bool:
    """Download R2 object into ``local_path``.  Returns False on 404
    (missing) so callers can decide on fallback."""
    cli = _get_r2_client()
    if cli is None:
        return False
    try:
        bucket = os.environ["R2_BUCKET_NAME"]
        resp = cli.get_object(Bucket=bucket, Key=key)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with local_path.open("wb") as f:
            for chunk in resp["Body"].iter_chunks(chunk_size=1024 * 64):
                f.write(chunk)
        return True
    except Exception as e:
        # boto3 throws ClientError with NoSuchKey for 404 — we treat
        # any get failure as "not in R2" and let the caller fall back.
        msg = str(e)
        if "NoSuchKey" not in msg and "404" not in msg:
            logger.warning("R2 download failed for %s: %s", key, msg)
        return False


def _r2_delete(key: str) -> bool:
    """Hard-delete an R2 object.  Idempotent — R2's DeleteObject
    returns 204 even for missing keys."""
    cli = _get_r2_client()
    if cli is None:
        return False
    try:
        bucket = os.environ["R2_BUCKET_NAME"]
        cli.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        logger.warning("R2 delete failed for %s: %s", key, e)
        return False


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
    """Public dispatcher.  Routes to R2 or Emergent based on the
    ``STORAGE_BACKEND`` env var.  Best-effort, never raises."""
    if not is_enabled():
        return False
    if _backend() == "r2":
        return _r2_put(local_path, key)
    return _emergent_mirror_up(local_path, key)


def _emergent_mirror_up(local_path: Path, key: str) -> bool:
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
    """Public dispatcher.  On R2 mode: try R2 first, fall back to
    Emergent (if Emergent creds are still present) — this is the
    zero-downtime migration path.  When a file is recovered from
    Emergent we silently mirror it back to R2 so subsequent reads
    hit the new backend natively.
    """
    if not is_enabled():
        return False
    if _backend() == "r2":
        if _r2_get(local_path, key):
            return True
        # R2 miss — fall back to Emergent for files that haven't been
        # migrated yet.  If Emergent has it, persist the recovered
        # bytes back to R2 silently so next time we don't double-hop.
        if _emergent_key() and _emergent_restore_to_disk(local_path, key):
            try:
                _r2_put(local_path, key)
            except Exception:
                pass
            return True
        return False
    return _emergent_restore_to_disk(local_path, key)


def delete_remote(key: str) -> bool:
    """Public dispatcher.  R2 supports real deletes; Emergent's stub
    no-ops.  Best-effort."""
    if not is_enabled():
        return False
    if _backend() == "r2":
        return _r2_delete(key)
    return _emergent_delete_remote(key)


def _emergent_restore_to_disk(local_path: Path, key: str) -> bool:
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


def _emergent_delete_remote(key: str) -> bool:
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


def backfill_storage_dir(storage_dir: Path, limit: Optional[int] = None, user_id_filter: Optional[str] = None) -> dict:
    """Walk ``storage_dir`` and mirror every book asset to object
    storage.  Idempotent — Emergent returns 409 on re-uploads which
    we treat as success.

    ``limit`` caps the number of files processed in a single call so
    a 100k-file library doesn't deadlock a single tick.  The cron
    scheduler calls this every 10 min until everything is mirrored.

    ``user_id_filter`` scopes the walk to a single ``{user_id}``
    sub-directory — used by the per-user "Back up my library" button
    so a single user can self-trigger a mirror without waiting for
    the next tick or admin involvement.

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
    # Per-user filter restricts the iterator to exactly one sub-dir.
    if user_id_filter:
        target = storage_dir / user_id_filter
        user_dirs = [target] if target.is_dir() else []
    else:
        user_dirs = [d for d in storage_dir.iterdir() if d.is_dir()]
    for user_dir in user_dirs:
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
