"""``routes/upload_failures.py`` — persistent record of failed uploads.

Background
----------

Today the upload flow surfaces failures as a single dismissible
sticky toast on `UploadZone`.  Once the user navigates away or
the toast times out, the failure list is gone — even though the
user might have wanted to re-drop those specific files.

This module owns a per-user ``upload_failures`` MongoDB collection
that survives across reloads, sessions, and tabs.  It captures
two flavours of failure:

* **Network / 520-class failures** reported by the *frontend* via
  ``POST /uploads/failures``.  The bytes never reached the server,
  so ``bytes_available`` is ``false`` and the only "retry" the UI
  can offer is "drop this file again from your computer".
* **Backend processing failures** (Calibre crash, AV-flagged,
  classifier hang, EPUB malformed) written by ``_run_upload_job``
  when a job flips to ``status="failed"``.  Bytes may or may not
  still live on disk depending on the failure stage; we set
  ``bytes_available`` accordingly so the UI knows whether
  "Retry on server" is offerable (Phase 2 — not wired yet).

Endpoints
---------

* ``POST   /api/uploads/failures``               — record (frontend reports).
* ``GET    /api/uploads/failures``               — list, with ``days`` /
                                                   ``include_dismissed`` filters.
* ``POST   /api/uploads/failures/{id}/dismiss``  — soft-dismiss a row.
* ``POST   /api/uploads/failures/dismiss-all``   — clear the list.
* ``DELETE /api/uploads/failures/{id}``          — hard-delete (privacy).

The frontend banner on ``/library/all`` and the section on
``/account`` both read from ``GET /uploads/failures``.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Body, Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db
from models import User

logger = logging.getLogger("upload_failures")


_MAX_ERROR_LEN = 500       # truncate runaway error strings before persisting.
_MAX_FILENAME_LEN = 280    # filesystem-safe upper bound; mirrors the UI limit.
_LIST_HARD_CAP = 200       # never return more than this in a single GET.
_RETENTION_DAYS = 90       # the cron sweeps rows older than this — see below.


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def record_upload_failure(
    *,
    user_id: str,
    filename: str,
    error: str,
    failure_stage: str = "process",
    size_bytes: int = 0,
    bytes_available: bool = False,
    job_id: Optional[str] = None,
    book_id: Optional[str] = None,
    original_format: Optional[str] = None,
) -> str:
    """Insert a single ``upload_failures`` row.

    Used internally by ``_run_upload_job`` (and any other backend
    code that wants to surface a failure to the user) so we don't
    repeat schema details at the call sites.
    """
    failure_id = uuid.uuid4().hex
    safe_filename = (filename or "(unknown)")[:_MAX_FILENAME_LEN]
    safe_error = (error or "Upload failed")[:_MAX_ERROR_LEN]
    safe_stage = (failure_stage or "process")[:32]
    doc = {
        "failure_id": failure_id,
        "user_id": user_id,
        "filename": safe_filename,
        "size_bytes": max(0, int(size_bytes or 0)),
        "error": safe_error,
        "failure_stage": safe_stage,
        "bytes_available": bool(bytes_available),
        "job_id": job_id,
        "book_id": book_id,
        "original_format": original_format,
        "retry_count": 0,
        "last_retried_at": None,
        "dismissed_at": None,
        "created_at": _now_iso(),
    }
    try:
        await db.upload_failures.insert_one(doc)
    except Exception:  # noqa: BLE001 — non-fatal; the upload itself already failed.
        logger.exception(
            "failed to persist upload_failures row for user=%s file=%s",
            user_id, safe_filename,
        )
    return failure_id


# --------------------------------------------------------------------------- #
# Frontend-facing endpoints                                                    #
# --------------------------------------------------------------------------- #

@api_router.post("/uploads/failures")
async def report_upload_failure(
    payload: dict = Body(...),
    user: User = Depends(get_current_user),
):
    """Frontend hook — called by ``UploadZone.jsx`` when ``sendOne``
    returns ``ok:false``.  Records the per-file failure so the user
    can review it later from ``/account`` or the banner on
    ``/library/all``.

    Expected payload shape::

        { filename: str, error: str, size_bytes: int = 0,
          failure_stage: "network"|"submit", job_id?: str }
    """
    filename = (payload.get("filename") or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")
    error = (payload.get("error") or "Upload failed").strip()
    failure_stage = payload.get("failure_stage") or "network"
    if failure_stage not in {"network", "submit", "process", "convert", "av", "classify", "extract"}:
        failure_stage = "network"
    failure_id = await record_upload_failure(
        user_id=user.user_id,
        filename=filename,
        error=error,
        failure_stage=failure_stage,
        size_bytes=int(payload.get("size_bytes") or 0),
        bytes_available=False,
        job_id=payload.get("job_id"),
    )
    return {"failure_id": failure_id}


@api_router.get("/uploads/failures")
async def list_upload_failures(
    days: int = 30,
    include_dismissed: bool = False,
    user: User = Depends(get_current_user),
):
    """List the current user's upload failures.

    Returns newest-first.  Defaults to 30 days back; banner on
    ``/library/all`` calls with ``days=7`` to keep the inline noise
    short, ``/account`` calls with ``days=30`` for the full
    history view.
    """
    days = max(1, min(int(days or 30), _RETENTION_DAYS))
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query: dict = {
        "user_id": user.user_id,
        "created_at": {"$gte": cutoff_iso},
    }
    if not include_dismissed:
        query["dismissed_at"] = None

    rows = []
    cursor = db.upload_failures.find(
        query,
        {"_id": 0},
    ).sort("created_at", -1).limit(_LIST_HARD_CAP)
    async for r in cursor:
        rows.append(r)
    return {
        "days": days,
        "count": len(rows),
        "failures": rows,
    }


@api_router.post("/uploads/failures/{failure_id}/dismiss")
async def dismiss_upload_failure(
    failure_id: str,
    user: User = Depends(get_current_user),
):
    """Soft-dismiss a single failure row.  The row stays in the
    database (so we can show "dismissed" history if the user opts
    in) but disappears from the default banner / account view.
    """
    result = await db.upload_failures.update_one(
        {"failure_id": failure_id, "user_id": user.user_id, "dismissed_at": None},
        {"$set": {"dismissed_at": _now_iso()}},
    )
    return {"dismissed": result.modified_count}


@api_router.post("/uploads/failures/dismiss-all")
async def dismiss_all_upload_failures(user: User = Depends(get_current_user)):
    """Bulk-clear the banner — soft-dismisses every undismissed row
    for the current user.  Useful after the user has manually
    re-uploaded the failed files.
    """
    result = await db.upload_failures.update_many(
        {"user_id": user.user_id, "dismissed_at": None},
        {"$set": {"dismissed_at": _now_iso()}},
    )
    return {"dismissed": result.modified_count}


@api_router.post("/uploads/failures/dismiss-by-filenames")
async def dismiss_upload_failures_by_filenames(
    payload: dict = Body(...),
    user: User = Depends(get_current_user),
):
    """Auto-cleanup hook called by the upload flow after a successful
    drop.  Pass ``{filenames: ["a.epub", "b.epub", ...]}`` — every
    undismissed failure row for the current user whose filename is
    in the list flips to dismissed.

    This is what makes the user-visible flow feel magic: the user
    sees "5 uploads failed" → re-drops them via the picker → as the
    new copies upload successfully, their rows quietly disappear
    from the banner without the user having to click Dismiss.
    """
    filenames = payload.get("filenames") or []
    if not isinstance(filenames, list):
        raise HTTPException(status_code=400, detail="filenames must be a list")
    # Soft cap so a malicious / runaway client can't blow up the
    # query.  Mirrors ``_LIST_HARD_CAP``.
    filenames = [str(f) for f in filenames if isinstance(f, str)][:_LIST_HARD_CAP]
    if not filenames:
        return {"dismissed": 0}
    result = await db.upload_failures.update_many(
        {
            "user_id": user.user_id,
            "dismissed_at": None,
            "filename": {"$in": filenames},
        },
        {"$set": {"dismissed_at": _now_iso()}},
    )
    return {"dismissed": result.modified_count}


@api_router.delete("/uploads/failures/{failure_id}")
async def delete_upload_failure(
    failure_id: str,
    user: User = Depends(get_current_user),
):
    """Hard-delete a single failure row.  Used by the privacy /
    GDPR delete-everything flow and the user-facing trash icon."""
    result = await db.upload_failures.delete_one(
        {"failure_id": failure_id, "user_id": user.user_id},
    )
    return {"deleted": result.deleted_count}
