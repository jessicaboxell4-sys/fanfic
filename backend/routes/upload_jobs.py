"""``routes/upload_jobs.py`` — async upload job pipeline (P0, 2026-06-24).

The synchronous ``POST /api/books/upload`` endpoint blocks the HTTP
connection for the full duration of parsing + Claude classification +
R2 mirroring.  When R2 is slow or the LLM stalls, that 100s Cloudflare
proxy ceiling triggers a 524 timeout and the whole upload fails
mid-flight.

This module fixes the class of bug by inverting the flow:

1. ``POST /api/books/upload/async``  buffers the multipart files to a
   per-job staging directory on local disk, writes an ``upload_jobs``
   record in Mongo, schedules an ``asyncio.create_task`` to process
   the batch, and returns ``202 Accepted`` with the ``job_id`` in
   ~1–2 seconds — guaranteed to never approach the proxy ceiling.

2. ``GET  /api/books/upload/jobs/{job_id}`` lets the SPA poll the
   job's progress (``queued`` → ``processing`` → ``done`` / ``failed``)
   and read the final payload once the batch is finished.

The actual per-file work re-uses the existing ``upload_books`` handler
in ``books.py`` — we just call it as a regular ``async`` function with
in-memory ``UploadFile`` shims reading from the staging directory, so
all the per-book classification, deduplication, R2 mirror, and friend-
notification logic stays in one place.  No refactor of the 600-line
handler body required.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, File, Form, HTTPException, UploadFile
from starlette.datastructures import Headers

from auth_dep import get_current_user
from deps import STORAGE_DIR, api_router, db
from models import User

logger = logging.getLogger("upload_jobs")

# Staging area for in-flight async uploads.  Each job gets its own
# subdirectory; we delete it once the worker finishes (success or
# failure) so /app/uploads doesn't fill up with abandoned bytes.
_JOB_STAGING_DIR = STORAGE_DIR / "_upload_jobs"
_JOB_STAGING_DIR.mkdir(parents=True, exist_ok=True)

# Cap the size of a single async batch.  Mirrors the operational
# parallel-4-chunks default on the frontend (4 × ~25 = 100), with
# headroom for power users uploading folders of small fanfics.
_MAX_FILES_PER_JOB = 200


def _job_dir(job_id: str) -> Path:
    return _JOB_STAGING_DIR / job_id


async def _persist_job(job_id: str, patch: dict) -> None:
    """Write a partial update to the ``upload_jobs`` record."""
    patch = dict(patch)
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.upload_jobs.update_one({"job_id": job_id}, {"$set": patch})


class _StagedUploadFile(UploadFile):
    """``UploadFile`` shim that streams a file from disk.

    FastAPI's ``UploadFile`` wraps a ``SpooledTemporaryFile`` by default;
    we replace that with a regular file handle opened against the
    staging path.  ``upload_books`` only ever calls ``read``, ``seek``,
    and reads ``.filename`` — all of which work unchanged.
    """

    def __init__(self, path: Path, filename: str):
        # FastAPI's UploadFile.__init__ signature has shifted across
        # versions; setting attributes directly keeps us version-agnostic.
        super().__init__(file=open(path, "rb"), filename=filename)


async def _run_upload_job(job_id: str, user_id: str) -> None:
    """Background worker: replay the staged files through ``upload_books``."""
    job = await db.upload_jobs.find_one({"job_id": job_id})
    if not job:
        logger.warning("_run_upload_job: job %s missing", job_id)
        return

    staging = _job_dir(job_id)
    try:
        await _persist_job(job_id, {"status": "processing", "started_at": datetime.now(timezone.utc).isoformat()})

        # Re-hydrate the user so the handler's `Depends(get_current_user)`
        # signature is satisfied by a real model instance, not a stub.
        user_doc = await db.users.find_one({"user_id": user_id})
        if not user_doc:
            raise RuntimeError(f"User {user_id} disappeared between submit and process")
        user = User(**{k: v for k, v in user_doc.items() if k != "_id"})

        # Build UploadFile shims in the original submission order so
        # the handler's ordering invariants hold (e.g. dupes within
        # the same batch).
        staged_files: list[dict] = list(job.get("staged_files") or [])
        shims: list[UploadFile] = []
        for entry in staged_files:
            p = Path(entry["path"])
            if not p.exists():
                logger.warning("staged file vanished: %s", p)
                continue
            shims.append(_StagedUploadFile(p, entry["original_name"]))

        keep_originals: list[str] = list(job.get("keep_originals") or [])

        # Late import — `routes.books` imports `deps`, which imports a
        # bunch of optional integrations.  Importing at call time keeps
        # cold-start lean and avoids any circular-import surprise.
        from routes.books import upload_books as _upload_books_handler

        response = await _upload_books_handler(
            files=shims,
            keep_originals=keep_originals,
            user=user,
        )

        for shim in shims:
            try:
                await shim.close()
            except Exception:  # noqa: BLE001
                pass

        await _persist_job(job_id, {
            "status": "done",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "response": response,
            "processed": len(staged_files),
        })
    except Exception as exc:  # noqa: BLE001
        logger.exception("upload job %s failed", job_id)
        await _persist_job(job_id, {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc) or exc.__class__.__name__,
        })
    finally:
        # Always sweep the staging directory — the bytes have either
        # been mirrored into the per-user store by the handler, or
        # they're junk from a failure we don't want lingering.
        try:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


@api_router.post("/books/upload/async", status_code=202)
async def upload_books_async(
    files: List[UploadFile] = File(...),
    keep_originals: List[str] = Form([]),
    user: User = Depends(get_current_user),
):
    """Queue a multi-file upload for background processing.

    Returns immediately with ``{job_id, total, status}`` — the SPA
    polls ``GET /books/upload/jobs/{job_id}`` until ``status`` is
    ``done`` or ``failed``.
    """
    from utils.feature_flags import is_enabled
    if not await is_enabled("uploads_enabled"):
        raise HTTPException(status_code=503, detail="Uploads are temporarily disabled by an administrator.")
    if not files:
        raise HTTPException(status_code=400, detail="No files were attached to this upload.")
    if len(files) > _MAX_FILES_PER_JOB:
        raise HTTPException(
            status_code=413,
            detail=f"Too many files in one batch — max {_MAX_FILES_PER_JOB}. "
                   f"The frontend already chunks large drops; this guards against bypass.",
        )

    job_id = uuid.uuid4().hex
    staging = _job_dir(job_id)
    staging.mkdir(parents=True, exist_ok=True)

    staged_files: list[dict] = []
    total_bytes = 0
    try:
        for idx, f in enumerate(files):
            safe_basename = (f.filename or f"file_{idx}.bin").replace("/", "_")[:200]
            target = staging / f"{idx:04d}__{safe_basename}"
            content = await f.read()
            target.write_bytes(content)
            total_bytes += len(content)
            staged_files.append({
                "original_name": f.filename or safe_basename,
                "path": str(target),
                "size": len(content),
            })
    except Exception as exc:
        # Failed during staging — clean up the partial directory so
        # /app/uploads/_upload_jobs doesn't grow unbounded.
        shutil.rmtree(staging, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Couldn't buffer upload to disk: {exc}") from exc

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.upload_jobs.insert_one({
        "job_id": job_id,
        "user_id": user.user_id,
        "status": "queued",
        "total": len(staged_files),
        "processed": 0,
        "total_bytes": total_bytes,
        "staged_files": staged_files,
        "keep_originals": list(keep_originals),
        "response": None,
        "error": None,
        "created_at": now_iso,
        "updated_at": now_iso,
        "started_at": None,
        "completed_at": None,
        # TTL hint — a sweeper can clean records older than this.
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
    })

    # Fire-and-forget — the response goes out immediately. We DON'T
    # await this; the task lives on the running event loop and is
    # tracked via the Mongo record.
    asyncio.create_task(_run_upload_job(job_id, user.user_id))

    return {"job_id": job_id, "total": len(staged_files), "status": "queued"}


@api_router.get("/books/upload/jobs/{job_id}")
async def get_upload_job(
    job_id: str,
    user: User = Depends(get_current_user),
):
    """Poll the status of an async upload job."""
    job = await db.upload_jobs.find_one({"job_id": job_id, "user_id": user.user_id})
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    # Strip Mongo-internal + bulky internals; the SPA only needs the
    # status fields and the response payload once done.
    return {
        "job_id": job["job_id"],
        "status": job.get("status"),
        "total": job.get("total", 0),
        "processed": job.get("processed", 0),
        "total_bytes": job.get("total_bytes", 0),
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
        "error": job.get("error"),
        "response": job.get("response"),
    }
