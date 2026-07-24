"""Upload skip digest + R2 storage admin endpoints.

The `/admin/storage/*` endpoints do a **real** boto3 sweep against the
configured Cloudflare R2 bucket (via the already-cached client in
`utils.storage_cloud`) so the R2 dashboard card reflects actual remote
usage instead of a Mongo aggregate.

Key layout expected in R2 (see `utils.storage_cloud.storage_key_for`):

    shelfsort/users/{user_id}/{book_id}{ext}

Anything under that prefix whose `{book_id}` is not present (or is
tombstoned) in Mongo `books` is treated as an orphan.  Cover files
(`.cover`, `.cover.png`) piggyback on the same key so they are only
purged when the parent book is gone — never independently.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, Query

from auth_dep import require_admin
from deps import api_router, db
from models import User
from utils import storage_cloud

logger = logging.getLogger(__name__)

# Cap the sweep so a runaway bucket never turns into a 30-minute
# request.  Real R2 buckets stay well under this; the frontend runs
# the scan on-demand from a button click so a cap is fine.
_MAX_KEYS_PER_SWEEP = 25_000
_R2_PRICE_PER_GB_MONTH = 0.015  # Cloudflare R2 flat storage price.
_KEY_PREFIX = "shelfsort/users/"

# 60-second in-memory TTL cache for the storage report so back-to-back
# admin dashboard visits don't each burn ~14s paginating R2.  Orphan
# scans intentionally skip this cache since a fresh sweep is what
# makes the "purge" list trustworthy.
_REPORT_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_REPORT_CACHE_TTL_SEC = 60


# ---------------------------------------------------------------------
# Upload skip digest (unchanged from the iter-89 stub — real events
# are written by upload_skip_events on the hot path).
# ---------------------------------------------------------------------
@api_router.get("/admin/upload-skip-digest")
async def upload_skip_digest(days: int = 7, _user: User = Depends(require_admin)):
    days = max(1, min(int(days or 7), 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        cur = db.upload_skip_events.find(
            {"ts": {"$gte": since.isoformat()}},
            projection={"_id": 0, "reason": 1, "filename": 1},
        )
        rows = await cur.to_list(length=100_000)
    except Exception:  # noqa: BLE001
        rows = []
    reasons: dict[str, int] = {}
    extensions: dict[str, int] = {}
    corrupt = 0
    for r in rows:
        rsn = str(r.get("reason") or "unknown")
        reasons[rsn] = reasons.get(rsn, 0) + 1
        if rsn in ("corrupt", "zero_bytes"):
            corrupt += 1
        fn = str(r.get("filename") or "").lower()
        if "." in fn:
            ext = "." + fn.rsplit(".", 1)[-1][:10]
            extensions[ext] = extensions.get(ext, 0) + 1
    return {
        "window_days": days,
        "since": since.isoformat(),
        "total": len(rows),
        "reasons": sorted(
            ({"reason": k, "count": v} for k, v in reasons.items()),
            key=lambda x: x["count"], reverse=True,
        ),
        "extensions": sorted(
            ({"ext": k, "count": v} for k, v in extensions.items()),
            key=lambda x: x["count"], reverse=True,
        )[:10],
        "corrupt_zero_bytes": corrupt,
    }


# ---------------------------------------------------------------------
# R2 sweep helpers (sync — call inside asyncio.to_thread).
# ---------------------------------------------------------------------
def _iter_r2_objects(prefix: str = _KEY_PREFIX) -> list[dict[str, Any]]:
    """Paginated list of R2 objects under ``prefix``.  Returns each
    object as ``{"Key": ..., "Size": ..., "LastModified": ...}``.
    Capped at ``_MAX_KEYS_PER_SWEEP``."""
    cli = storage_cloud._get_r2_client()
    if cli is None:
        return []
    try:
        bucket = os.environ["R2_BUCKET_NAME"]
    except KeyError:
        return []
    out: list[dict[str, Any]] = []
    paginator = cli.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents") or []:
            out.append({
                "Key": obj.get("Key"),
                "Size": int(obj.get("Size") or 0),
                "LastModified": obj.get("LastModified"),
            })
            if len(out) >= _MAX_KEYS_PER_SWEEP:
                return out
    return out


def _parse_key(key: str) -> tuple[str | None, str | None]:
    """Extract ``(user_id, book_id)`` from a canonical R2 key.  Returns
    ``(None, None)`` for keys that don't match the app's layout so
    we don't accidentally purge unrelated buckets that share the
    R2 bucket.

    Example: ``shelfsort/users/user_abc/book_xyz.epub`` →
    ``('user_abc', 'book_xyz')``.  Cover files
    (``book_xyz.cover``, ``book_xyz.cover.png``) collapse to the
    same ``book_xyz`` so both files share the same book-id lookup.
    """
    if not key or not key.startswith(_KEY_PREFIX):
        return None, None
    remainder = key[len(_KEY_PREFIX):]
    parts = remainder.split("/", 1)
    if len(parts) != 2:
        return None, None
    user_id, fname = parts[0], parts[1]
    if not user_id or not fname:
        return None, None
    # Strip extension(s): book_xyz.cover.png → book_xyz.
    book_id = fname.split(".", 1)[0]
    return user_id, (book_id or None)


# ---------------------------------------------------------------------
# GET /admin/storage/report — real R2 usage snapshot.
# ---------------------------------------------------------------------
@api_router.get("/admin/storage/report")
async def storage_report(_user: User = Depends(require_admin)):
    if not storage_cloud.is_enabled():
        return {
            "total_bytes": 0,
            "total_objects": 0,
            "est_monthly_cost": 0.0,
            "top_users": [],
            "backend": "disabled",
            "note": "R2 credentials not configured — showing zeroes.",
        }
    # Serve from the 60s TTL cache if it's fresh — R2 buckets don't
    # move fast enough to justify a per-visit re-scan.
    now = time.monotonic()
    cached = _REPORT_CACHE.get("data")
    if cached is not None and (now - _REPORT_CACHE["ts"]) < _REPORT_CACHE_TTL_SEC:
        return {**cached, "cached": True, "cache_age_sec": int(now - _REPORT_CACHE["ts"])}
    try:
        objects = await asyncio.to_thread(_iter_r2_objects)
    except Exception as e:  # noqa: BLE001
        logger.warning("R2 sweep failed: %s", e)
        raise HTTPException(status_code=502, detail=f"R2 sweep failed: {e}") from e

    total_bytes = 0
    total_objects = 0
    per_user: dict[str, dict[str, int]] = {}
    for obj in objects:
        size = obj["Size"]
        uid, _bid = _parse_key(obj["Key"])
        if uid is None:
            # Ignore stray keys that don't fit our app layout.
            continue
        total_bytes += size
        total_objects += 1
        row = per_user.setdefault(uid, {"bytes": 0, "objects": 0})
        row["bytes"] += size
        row["objects"] += 1

    top = sorted(per_user.items(), key=lambda kv: kv[1]["bytes"], reverse=True)[:10]
    est_monthly_cost = round((total_bytes / (1024 ** 3)) * _R2_PRICE_PER_GB_MONTH, 2)
    payload = {
        "total_bytes": total_bytes,
        "total_objects": total_objects,
        "est_monthly_cost": est_monthly_cost,
        "top_users": [
            {"user_id": uid, "bytes": row["bytes"], "objects": row["objects"]}
            for uid, row in top
        ],
        "backend": "r2",
        "sweep_capped": total_objects >= _MAX_KEYS_PER_SWEEP,
    }
    _REPORT_CACHE["data"] = payload
    _REPORT_CACHE["ts"] = time.monotonic()
    return payload


# ---------------------------------------------------------------------
# POST /admin/storage/orphans/scan — find R2 keys with no live book.
# ---------------------------------------------------------------------
@api_router.post("/admin/storage/orphans/scan")
async def orphan_scan(_user: User = Depends(require_admin)):
    if not storage_cloud.is_enabled():
        return {"orphans_found": 0, "bytes_recoverable": 0, "sample": [], "backend": "disabled"}
    try:
        objects = await asyncio.to_thread(_iter_r2_objects)
    except Exception as e:  # noqa: BLE001
        logger.warning("R2 sweep failed: %s", e)
        raise HTTPException(status_code=502, detail=f"R2 sweep failed: {e}") from e

    # Collect every book_id that is still known to Mongo (regardless of
    # trash state — Trash keeps the file for the 30-day grace period).
    known_ids: set[str] = set()
    async for row in db.books.find({}, projection={"_id": 0, "book_id": 1}):
        bid = row.get("book_id")
        if bid:
            known_ids.add(bid)

    orphan_keys: list[dict[str, Any]] = []
    bytes_recoverable = 0
    per_user_orphans: dict[str, dict[str, int]] = {}
    now_utc = datetime.now(timezone.utc)
    for obj in objects:
        uid, bid = _parse_key(obj["Key"])
        if not bid:
            continue  # unrelated key — leave alone
        if bid in known_ids:
            continue  # book still exists, keep the file
        # LastModified from boto3 is a timezone-aware datetime.  If it
        # somehow arrives without a tzinfo, treat it as UTC (Cloudflare
        # is UTC anyway).  age_days is stored on the snapshot so the
        # confirm modal can filter "purge only files older than N days"
        # without a re-scan.
        lm = obj.get("LastModified")
        if lm is not None and getattr(lm, "tzinfo", None) is None:
            lm = lm.replace(tzinfo=timezone.utc)
        age_days = int((now_utc - lm).total_seconds() // 86400) if lm else 0
        orphan_keys.append({"key": obj["Key"], "bytes": obj["Size"], "age_days": age_days})
        bytes_recoverable += obj["Size"]
        if uid:
            row = per_user_orphans.setdefault(uid, {"bytes": 0, "objects": 0})
            row["bytes"] += obj["Size"]
            row["objects"] += 1

    top_affected = sorted(
        per_user_orphans.items(),
        key=lambda kv: kv[1]["bytes"],
        reverse=True,
    )[:10]

    # 2026-08-18 — Age bucket histogram so the confirm modal can show
    # "purge only files older than N days" chips (0/7/30/90/365) with
    # a live count + byte total, without shipping the full 25k-item
    # orphan list to the browser.  Buckets are cumulative-from-above
    # (i.e. bucket "30d" = orphans that are ≥30 days old).
    def _bucket_stats(min_days: int) -> dict[str, int]:
        count = 0
        b = 0
        for row in orphan_keys:
            if int(row.get("age_days") or 0) >= min_days:
                count += 1
                b += int(row.get("bytes") or 0)
        return {"count": count, "bytes": b}

    age_buckets = {
        "0":   _bucket_stats(0),
        "7":   _bucket_stats(7),
        "30":  _bucket_stats(30),
        "90":  _bucket_stats(90),
        "365": _bucket_stats(365),
    }

    # Persist the scan snapshot so a subsequent purge acts on exactly
    # the keys the admin just saw.  Overwrites any older scan doc.
    await db.storage_orphan_scans.replace_one(
        {"_id": "latest"},
        {
            "_id": "latest",
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "orphan_keys": orphan_keys,
            "bytes_recoverable": bytes_recoverable,
        },
        upsert=True,
    )
    return {
        "orphans_found": len(orphan_keys),
        "bytes_recoverable": bytes_recoverable,
        "sample": [row["key"] for row in orphan_keys[:5]],
        "top_affected_users": [
            {"user_id": uid, "bytes": row["bytes"], "objects": row["objects"]}
            for uid, row in top_affected
        ],
        "age_buckets": age_buckets,
        "backend": "r2",
        "sweep_capped": len(objects) >= _MAX_KEYS_PER_SWEEP,
    }


# ---------------------------------------------------------------------
# POST /admin/storage/orphans/purge — delete the last scan's orphans.
# ---------------------------------------------------------------------
@api_router.post("/admin/storage/orphans/purge")
async def orphan_purge(
    min_age_days: int = Query(0, ge=0, le=3650, description="Only delete orphans whose LastModified is at least this many days ago"),
    _user: User = Depends(require_admin),
):
    if not storage_cloud.is_enabled():
        return {"purged": 0, "bytes_freed": 0, "backend": "disabled"}
    scan = await db.storage_orphan_scans.find_one({"_id": "latest"})
    if not scan or not scan.get("orphan_keys"):
        return {"purged": 0, "bytes_freed": 0, "backend": "r2", "note": "No pending orphan scan — run Scan first."}

    orphan_keys: list[dict[str, Any]] = scan["orphan_keys"]
    # 2026-08-18 — Age filter: honour a per-purge min_age_days so an
    # admin can wipe only long-abandoned junk (30d+) without touching
    # recent uploads that may still be mid-processing on the app side.
    if min_age_days > 0:
        orphan_keys = [row for row in orphan_keys if int(row.get("age_days") or 0) >= min_age_days]
    if not orphan_keys:
        return {"purged": 0, "bytes_freed": 0, "backend": "r2", "note": "No orphans meet the age filter."}

    def _purge_all() -> tuple[int, int]:
        cli = storage_cloud._get_r2_client()
        if cli is None:
            return 0, 0
        bucket = os.environ["R2_BUCKET_NAME"]
        purged = 0
        bytes_freed = 0
        # DeleteObjects handles up to 1000 keys per call — batch to
        # keep the round-trip count low for big cleanups.
        for i in range(0, len(orphan_keys), 1000):
            batch = orphan_keys[i:i + 1000]
            try:
                cli.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": [{"Key": row["key"]} for row in batch], "Quiet": True},
                )
                purged += len(batch)
                bytes_freed += sum(int(row.get("bytes") or 0) for row in batch)
            except Exception as e:  # noqa: BLE001
                logger.warning("R2 batch delete failed on batch %d: %s", i // 1000, e)
        return purged, bytes_freed

    try:
        purged, bytes_freed = await asyncio.to_thread(_purge_all)
    except Exception as e:  # noqa: BLE001
        logger.warning("Orphan purge failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Orphan purge failed: {e}") from e

    # Clear the snapshot so a second click doesn't re-run against
    # already-deleted keys.  Also bust the storage-report cache so
    # the admin dashboard reflects the newly-freed bytes on refresh.
    await db.storage_orphan_scans.delete_one({"_id": "latest"})
    _REPORT_CACHE["data"] = None
    _REPORT_CACHE["ts"] = 0.0
    return {"purged": purged, "bytes_freed": bytes_freed, "backend": "r2"}
