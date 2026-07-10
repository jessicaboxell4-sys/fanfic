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

from auth_dep import get_current_user, require_admin
from deps import STORAGE_DIR, api_router, db
from models import User

logger = logging.getLogger("upload_jobs")

# Staging area for in-flight async uploads.  Each job gets its own
# subdirectory; we delete it once the worker finishes (success or
# failure) so /app/uploads doesn't fill up with abandoned bytes.
_JOB_STAGING_DIR = STORAGE_DIR / "_upload_jobs"
_JOB_STAGING_DIR.mkdir(parents=True, exist_ok=True)
# Per-user pending uploads subdir name — lives under
# ``STORAGE_DIR / <user_id> / _pending_uploads / <job_id> /``.
# Empirically, per-user storage survives pod restarts on Emergent K8s
# (books don't disappear on redeploy), whereas a top-level
# ``_upload_jobs`` directory has been observed to vanish during a
# deploy bounce — losing in-flight Airdrops to "Staging directory
# vanished" failures.  New jobs land here; the legacy
# ``_JOB_STAGING_DIR`` path is kept readable for backward compat
# with jobs queued before this refactor (2026-06-28).
_PENDING_SUBDIR = "_pending_uploads"


def _user_job_dir(user_id: str, job_id: str) -> Path:
    """Per-user staging directory for an in-flight upload job."""
    return STORAGE_DIR / user_id / _PENDING_SUBDIR / job_id


def _retry_quarantine_dir(user_id: str, failure_id: str) -> Path:
    """Per-user quarantine directory for a single failed upload.

    Bytes that the upload pipeline gave up on (av/classify/extract
    failures, Calibre crash, etc.) get *moved* here BEFORE the
    ``finally`` sweep in ``_run_upload_job`` so the user-facing
    "Retry on server" button has something to re-feed.  Each
    failure gets its own ``<failure_id>/`` so concurrent
    quarantines never collide and the cleanup cron can sweep
    on a per-failure age.
    """
    return STORAGE_DIR / user_id / "_retry_staging" / failure_id

# Cap the size of a single async batch.  Mirrors the operational
# parallel-4-chunks default on the frontend (4 × ~25 = 100), with
# headroom for power users uploading folders of small fanfics.
_MAX_FILES_PER_JOB = 200


def _job_dir(job_id: str, user_id: str | None = None) -> Path:
    """Return the staging directory for a job.

    Resolution order (2026-06-28 refactor):
      1. If ``user_id`` is supplied and the per-user path exists →
         return it.  This is the path NEW jobs use.
      2. Fall back to the legacy top-level path so jobs queued
         before the refactor still resolve.
      3. If neither exists and ``user_id`` is supplied, return the
         per-user path (the caller is about to create it).
      4. No ``user_id`` provided → legacy path for back-compat.
    """
    if user_id:
        new_path = _user_job_dir(user_id, job_id)
        if new_path.exists():
            return new_path
        legacy = _JOB_STAGING_DIR / job_id
        if legacy.exists():
            return legacy
        return new_path
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

    staging = _job_dir(job_id, user_id=user_id)
    preserve_staging = False  # flipped True on transient Mongo errors so the
    # recovery cron still has the bytes to retry the pipeline.
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

        # Big-batch push notification — if the batch produced ≥10 books,
        # ping every device the user has Web Push registered on so they
        # see a system notification ("📚 12 books finished sorting on
        # Shelfsort") even when the tab is closed.  Small batches are
        # noisy if pushed — the in-app toast + bell are enough.
        try:
            books_added = [b for b in (response.get("books") or []) if not b.get("failed")]
            if len(books_added) >= 10:
                from routes.push import send_push_to_user
                first_titles = [b.get("title") or "untitled" for b in books_added[:3]]
                preview = ", ".join(t for t in first_titles if t)
                more = len(books_added) - len(first_titles)
                body_lines = f"{preview}" + (f" and {more} more" if more > 0 else "")
                await send_push_to_user(
                    user_id,
                    title=f"📚 {len(books_added)} books finished sorting",
                    body=body_lines or f"{len(books_added)} new books are in your library.",
                    url="/library/all",
                )
        except Exception:  # noqa: BLE001
            # Push failures must NEVER fail the upload job — the books
            # are already saved, the user can still see them in-app.
            logger.exception("upload job %s: push notification failed", job_id)

        await _persist_job(job_id, {
            "status": "done",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "response": response,
            "processed": len(staged_files),
        })
    except Exception as exc:  # noqa: BLE001
        # 2026-06-27 — Transient Mongo errors (Atlas primary election,
        # network blip, autoscale roll) should NOT mark the job
        # failed.  Leave it as "queued" with a friendly error blurb
        # so the 5-min recover_stuck_upload_jobs cron picks it up
        # once Atlas recovers.  Real bugs still land in "failed".
        from utils.db_retry import is_transient_mongo_error, friendly_mongo_message
        if is_transient_mongo_error(exc):
            logger.warning(
                "upload job %s hit transient Mongo error (%s) — leaving as queued for recovery cron",
                job_id, type(exc).__name__,
            )
            await _persist_job(job_id, {
                "status": "queued",
                "started_at": None,
                "error": friendly_mongo_message(exc),
            })
            # ``finally`` runs even after ``return``, so we can't rely
            # on returning early to skip the rmtree — flip a flag the
            # ``finally`` block honours instead.
            preserve_staging = True
            return
        logger.exception("upload job %s failed", job_id)
        await _persist_job(job_id, {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc) or exc.__class__.__name__,
        })
        # 2026-06-28 — Persist per-file failures so the user has a
        # visible record on /account and the banner on /library/all.
        # When the whole job dies (Calibre crash, unhandled exception
        # in the handler) every staged file is effectively a failure;
        # we emit one row per file so the UI can show their actual
        # names instead of an opaque job id.
        #
        # 2026-06-30 — Before recording the failures, MOVE the staged
        # bytes into a per-failure quarantine dir under
        # ``_retry_staging/<failure_id>/``.  This is what powers the
        # "Retry on server" button on the failed-uploads banner —
        # the user no longer has to re-drop the files from disk.
        # The ``finally`` block's sweep is intentionally tolerant of
        # the now-empty original staging dir.
        try:
            from routes.upload_failures import record_upload_failure
            friendly = (
                str(exc).strip()[:280]
                or exc.__class__.__name__
                or "Upload pipeline failed."
            )
            for sf in staged_files:
                src = Path(sf.get("path") or "")
                # Per-failure quarantine dir.  We need the failure_id
                # before we have it — generate locally via the same
                # uuid scheme record_upload_failure uses and pass it
                # in explicitly to keep the path ↔ row link tight.
                failure_id = uuid.uuid4().hex
                quarantine_path: str | None = None
                try:
                    if src.is_file():
                        q_dir = _retry_quarantine_dir(user_id, failure_id)
                        q_dir.mkdir(parents=True, exist_ok=True)
                        q_target = q_dir / src.name
                        shutil.move(str(src), str(q_target))
                        quarantine_path = str(q_dir)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "upload job %s: failed to quarantine %s — bytes lost",
                        job_id, src,
                    )
                    quarantine_path = None

                # Insert directly with the pre-generated failure_id so
                # the on-disk path and the Mongo row reference each
                # other unambiguously.
                from datetime import datetime as _dt, timezone as _tz
                await db.upload_failures.insert_one({
                    "failure_id": failure_id,
                    "user_id": user_id,
                    "filename": (sf.get("original_name") or "(unknown)")[:280],
                    "size_bytes": int(sf.get("size") or 0),
                    "error": friendly[:500],
                    "failure_stage": "process",
                    "bytes_available": quarantine_path is not None,
                    "job_id": job_id,
                    "book_id": None,
                    "original_format": None,
                    "retry_staging_path": quarantine_path,
                    "retry_count": 0,
                    "last_retried_at": None,
                    "dismissed_at": None,
                    "created_at": _dt.now(_tz.utc).isoformat(),
                })
        except Exception:  # noqa: BLE001 — telemetry must never re-raise.
            logger.exception("upload job %s: failed to persist upload_failures rows", job_id)
    finally:
        # Always sweep the staging directory — the bytes have either
        # been mirrored into the per-user store by the handler, or
        # they're junk from a failure we don't want lingering.
        # Exception: transient Mongo errors set ``preserve_staging``
        # so the 5-min recovery cron has the bytes to retry.
        if preserve_staging:
            return
        try:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
        # 2026-06-28 — Sweep the cloud mirror of the staged bytes.
        # They were only stored there for pod-restart resilience; the
        # worker has either successfully ingested them (book bytes now
        # live under the user's permanent storage prefix) or recorded
        # the failure.  Either way, the _staging/ mirror is now junk.
        try:
            from utils import storage_cloud as _storage
            if _storage.is_enabled():
                for sf in staged_files:
                    key = sf.get("cloud_key")
                    if key:
                        try:
                            _storage.delete_remote(key)
                        except Exception:  # noqa: BLE001
                            pass
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
    staging = _job_dir(job_id, user_id=user.user_id)
    staging.mkdir(parents=True, exist_ok=True)

    # 2026-06-28 — Mirror staged bytes to R2/Emergent object storage
    # in addition to the local disk.  Production has shown that even
    # the per-user ``_pending_uploads`` directory can vanish across
    # pod restarts under certain conditions; without a durable
    # mirror, an interrupted upload is unrecoverable.  R2 is the
    # source of truth — disk is just the fast scratch area for the
    # worker.  Cost is trivial (~$0.0000045 per file PUT, deleted
    # immediately after the worker processes it).
    try:
        from utils import storage_cloud as _storage
        _cloud_enabled = _storage.is_enabled()
    except Exception:  # noqa: BLE001
        _storage = None
        _cloud_enabled = False

    staged_files: list[dict] = []
    total_bytes = 0
    try:
        for idx, f in enumerate(files):
            safe_basename = (f.filename or f"file_{idx}.bin").replace("/", "_")[:200]
            target = staging / f"{idx:04d}__{safe_basename}"
            content = await f.read()
            target.write_bytes(content)
            total_bytes += len(content)
            cloud_key: str | None = None
            if _cloud_enabled and _storage is not None:
                # Key shape: ``_staging/<user_id>/<job_id>/<idx>__<name>``.
                # The leading ``_staging`` prefix lets a sweeper hard-cap
                # transient junk later, separately from permanent books.
                cloud_key = f"_staging/{user.user_id}/{job_id}/{idx:04d}__{safe_basename}"
                # 2026-07-01 — Retry the R2 mirror up to 3× with
                # exponential backoff.  During last night's OOM crisis
                # a transient blip on the first attempt caused files to
                # be recorded with ``cloud_key=None``, and the ensuing
                # pod restart wiped local staging → 8 "Staging directory
                # vanished" failures because there was no cloud copy to
                # restore from.  Retries turn "one blip = permanent loss"
                # into "one blip = 100 ms delay".  See ROOT_CAUSE:
                # ``routes/upload_failures.retry_from_server``.
                mirrored = False
                last_exc: Exception | None = None
                for attempt in range(3):
                    try:
                        if _storage.mirror_up(target, cloud_key):
                            mirrored = True
                            break
                    except Exception as _e:  # noqa: BLE001
                        last_exc = _e
                    await asyncio.sleep(0.1 * (2 ** attempt))  # 100ms, 200ms, 400ms
                if not mirrored:
                    logger.warning(
                        "upload_jobs: cloud mirror failed after 3 retries for %s (last error: %s) — file is disk-only until backfill_cloud_staging cron catches up",
                        cloud_key, last_exc,
                    )
                    cloud_key = None  # don't lie about it being there.
                    # 2026-07-01 — Strict-mode toggle.  Setting
                    # ``UPLOAD_REQUIRE_CLOUD_STAGING=1`` in .env flips
                    # the failure semantics: instead of accepting the
                    # upload with disk-only durability (and gambling
                    # that the backfill cron catches up before a pod
                    # restart), we return 503 and ask the user to retry
                    # in a moment.  Slower feedback loop but zero
                    # chance of losing bytes to a restart.
                    if os.environ.get("UPLOAD_REQUIRE_CLOUD_STAGING", "").lower() in ("1", "true", "yes"):
                        # Clean up the partial staging dir before failing.
                        shutil.rmtree(staging, ignore_errors=True)
                        raise HTTPException(
                            status_code=503,
                            detail=(
                                "Our storage layer is having a hiccup — we can't "
                                "guarantee your upload will survive a pod restart. "
                                "Please try again in ~30 seconds."
                            ),
                        )
            staged_files.append({
                "original_name": f.filename or safe_basename,
                "path": str(target),
                "size": len(content),
                "cloud_key": cloud_key,
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


@api_router.get("/books/upload/queue-summary")
async def upload_queue_summary(
    user: User = Depends(get_current_user),
):
    """Live counts for the in-upload "real progress" strip.

    Powers the UploadZone secondary status line: "Saved 47 to library
    · 14 still sorting · 168 queued".  Cheap aggregate — every count
    is an indexed equality match on already-existing collections, so
    polling this every 2 s during an active drop is fine.

    Returns ``{ polish_pending, polish_failed, jobs_queued,
    jobs_processing, jobs_done_recent }`` — see the comments below
    for the exact semantics so the SPA can render them honestly.
    """
    from utils.constants import PENDING_SORT_SHELF, TRASH_SHELF
    from utils.polish_worker import count_pending_for_user

    # Books still waiting on the deferred classifier.  Same query the
    # polish_worker uses internally, so the count exactly mirrors what
    # the worker still has on its plate.
    polish_pending = await count_pending_for_user(user.user_id)

    # Books the polish worker tried and gave up on (Claude raised,
    # timeout fallback failed too).  Stays "Pending sort" in the
    # library; surfaced separately so the strip can call them out.
    polish_failed = await db.books.count_documents({
        "user_id": user.user_id,
        "classifier": "polish-failed",
        "category": {"$ne": TRASH_SHELF},
    })

    # Async upload jobs not yet picked up by the worker (just staged).
    jobs_queued = await db.upload_jobs.count_documents({
        "user_id": user.user_id,
        "status": "queued",
    })
    # Currently mid-flight in the worker.
    jobs_processing = await db.upload_jobs.count_documents({
        "user_id": user.user_id,
        "status": "processing",
    })
    # Jobs the worker finished in the last 5 minutes — gives the user
    # a "sorted X" line that grows as books land in the library, even
    # in airdrop mode where the per-file poller is skipped.
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    jobs_done_recent_pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "status": "done",
            "completed_at": {"$gte": cutoff_iso},
        }},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$processed", 0]}}}},
    ]
    rows = await db.upload_jobs.aggregate(jobs_done_recent_pipeline).to_list(length=1)
    jobs_done_recent = rows[0]["total"] if rows else 0

    return {
        "polish_pending": polish_pending,
        "polish_failed": polish_failed,
        "jobs_queued": jobs_queued,
        "jobs_processing": jobs_processing,
        "jobs_done_recent": jobs_done_recent,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def recover_stuck_upload_jobs() -> int:
    """Resume any upload_jobs whose async worker died mid-flight.

    Two scenarios:
      1. **Backend restart** while a job was queued or processing — the
         in-memory ``_run_upload_job`` task vanished but the staging
         files are still on disk and the row is still
         ``queued``/``processing`` in Mongo.
      2. **Airdrop-mode upload** where the frontend POSTed bytes and
         returned immediately without polling.  If the backend crashed
         between accepting bytes and finishing the pipeline, the user
         has no way to retry from the SPA — the bytes are stranded.

    This sweeper finds rows older than 5 min still in non-terminal
    state, verifies the staging directory still has the bytes, and
    re-kicks ``_run_upload_job`` for each one.  Idempotent — running
    it twice is safe because the worker re-reads job state on entry.

    Returns the number of jobs re-kicked.  Logged in server.py.
    """
    from datetime import datetime, timedelta, timezone as _tz

    cutoff_iso = (datetime.now(_tz.utc) - timedelta(minutes=5)).isoformat()
    cursor = db.upload_jobs.find({
        "status": {"$in": ["queued", "processing"]},
        "$or": [
            {"started_at": {"$lt": cutoff_iso}},
            {"created_at": {"$lt": cutoff_iso}, "started_at": None},
            {"created_at": {"$lt": cutoff_iso}, "started_at": {"$exists": False}},
        ],
    }).limit(50)
    recovered = 0
    async for job in cursor:
        job_id = job.get("job_id")
        user_id = job.get("user_id")
        if not job_id or not user_id:
            continue
        # Sanity-check the staging directory — if the bytes are gone
        # the worker would just no-op.  Stamp the row as failed so the
        # SPA shows a real error rather than spinning forever.
        staging = _job_dir(job_id, user_id=user_id)
        if not any(staging.iterdir()) if staging.exists() else True:
            if not staging.exists():
                # 2026-06-28 — Before declaring the bytes lost, try to
                # restore them from the cloud mirror.  Production has
                # shown that the per-user staging dir can disappear
                # across pod restarts; the R2 mirror is the durable
                # source of truth.
                cloud_recovered = False
                try:
                    from utils import storage_cloud as _storage
                    if _storage.is_enabled():
                        staged_files_raw = job.get("staged_files") or []
                        cloud_keys = [sf.get("cloud_key") for sf in staged_files_raw if sf.get("cloud_key")]
                        if cloud_keys:
                            staging.mkdir(parents=True, exist_ok=True)
                            restored = 0
                            for sf in staged_files_raw:
                                key = sf.get("cloud_key")
                                path = sf.get("path")
                                if not key or not path:
                                    continue
                                target = Path(path)
                                target.parent.mkdir(parents=True, exist_ok=True)
                                if _storage.restore_to_disk(target, key):
                                    restored += 1
                            if restored == len(cloud_keys):
                                cloud_recovered = True
                                logger.info(
                                    "recover_stuck_upload_jobs: restored %d staged file(s) for job %s from cloud mirror",
                                    restored, job_id,
                                )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "recover_stuck_upload_jobs: cloud-restore attempt failed for job %s",
                        job_id,
                    )

                if not cloud_recovered:
                    friendly = "Staging directory vanished — bytes lost to a restart before processing."
                    await _persist_job(job_id, {
                        "status": "failed",
                        "completed_at": datetime.now(_tz.utc).isoformat(),
                        "error": friendly,
                    })
                    # 2026-06-28 — also emit upload_failures rows so the
                    # user-visible dashboard on /library/all and /account
                    # surfaces these (otherwise they only existed as a
                    # transient toast via BackgroundJobsBell).
                    try:
                        from routes.upload_failures import record_upload_failure
                        for sf in (job.get("staged_files") or []):
                            await record_upload_failure(
                                user_id=user_id,
                                filename=sf.get("original_name") or "(unknown)",
                                error=friendly,
                                failure_stage="process",
                                size_bytes=int(sf.get("size") or 0),
                                bytes_available=False,
                                job_id=job_id,
                            )
                    except Exception:  # noqa: BLE001 — telemetry must never re-raise.
                        logger.exception(
                            "recover_stuck_upload_jobs: failed to persist upload_failures for %s",
                            job_id,
                        )
                    continue
        try:
            asyncio.create_task(_run_upload_job(job_id, user_id))
            recovered += 1
        except RuntimeError:
            logger.warning("recover_stuck_upload_jobs: no event loop available")
            break
    if recovered > 0:
        logger.info("recover_stuck_upload_jobs: re-kicked %d job(s)", recovered)
    return recovered


# ---------------------------------------------------------------------------
# Backfill cloud staging (2026-07-01)
# ---------------------------------------------------------------------------
# When R2 hiccups at upload time and even our 3× retry fails, files land
# with ``cloud_key=None`` and local-disk-only durability.  If the pod
# survives long enough to process them, no harm done.  If it restarts
# BEFORE processing, the bytes vanish and the user sees the dreaded
# "Staging directory vanished" failure.
#
# This cron closes the window: every 2 minutes it walks upload_jobs
# that are still queued/processing, finds ``staged_files`` where
# ``cloud_key is None`` but the local file still exists, and mirrors
# them up.  Idempotent — a file that succeeds gets its ``cloud_key``
# written back to the job's ``staged_files`` array so the recovery
# cron can find it after the next pod restart.
async def backfill_cloud_staging() -> int:
    """Return the number of files newly mirrored to R2."""
    try:
        from utils import storage_cloud as _storage
        if not _storage.is_enabled():
            return 0
    except Exception:  # noqa: BLE001
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
    cursor = db.upload_jobs.find(
        {
            "status": {"$in": ["queued", "processing"]},
            "created_at": {"$gte": cutoff.isoformat()},
            "staged_files.cloud_key": None,
        },
        {"_id": 0, "job_id": 1, "user_id": 1, "staged_files": 1},
    )
    mirrored_total = 0
    async for job in cursor:
        staged = job.get("staged_files") or []
        changed = False
        for idx, sf in enumerate(staged):
            if sf.get("cloud_key"):
                continue
            path = sf.get("path")
            if not path:
                continue
            p = Path(path)
            if not p.exists():
                continue
            # Reconstruct the canonical staging key so both the
            # upload-time mirror and the backfill land in the same
            # place → the recovery cron finds it either way.
            filename_slug = p.name  # already prefixed with idx.
            key = f"_staging/{job['user_id']}/{job['job_id']}/{filename_slug}"
            try:
                if _storage.mirror_up(p, key):
                    staged[idx]["cloud_key"] = key
                    changed = True
                    mirrored_total += 1
            except Exception:  # noqa: BLE001 — best effort; next tick will retry.
                logger.debug("backfill_cloud_staging: mirror_up failed for %s", key)
        if changed:
            try:
                await db.upload_jobs.update_one(
                    {"job_id": job["job_id"]},
                    {"$set": {"staged_files": staged, "updated_at": datetime.now(timezone.utc).isoformat()}},
                )
            except Exception:  # noqa: BLE001
                logger.warning("backfill_cloud_staging: failed to persist cloud_keys for job %s", job.get("job_id"))
    if mirrored_total > 0:
        logger.info("backfill_cloud_staging: mirrored %d staged file(s) after transient R2 hiccup", mirrored_total)
    return mirrored_total




@api_router.get("/admin/upload-jobs/stuck")
async def list_stuck_upload_jobs(
    user: User = Depends(require_admin),
    threshold_minutes: int = 10,
):
    """Admin diagnostic: surface upload jobs that have been sitting
    in ``queued`` / ``processing`` for longer than ``threshold_minutes``.

    Operator value: during the next Atlas failover we want a
    one-glance answer to "is the 5-min recovery cron actually keeping
    up?".  A healthy system has an empty list here — jobs flicker
    through "queued" and are gone in under a minute.  A growing list
    is a leading indicator of either (a) sustained Mongo instability,
    (b) staging-disk loss, or (c) the recovery cron itself being down.

    Defaults to a 10-min cutoff (vs the 5-min recovery cron) so a
    job is only "stuck" if it has *already* missed one recovery
    window.  Returns the same fields the user-facing poll endpoint
    returns, plus an ``age_minutes`` convenience for the UI.
    """
    threshold_minutes = max(1, min(int(threshold_minutes if threshold_minutes is not None else 10), 240))
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)
    cutoff_iso = cutoff.isoformat()

    cursor = db.upload_jobs.find(
        {
            "status": {"$in": ["queued", "processing"]},
            "created_at": {"$lt": cutoff_iso},
        },
        {
            "_id": 0,
            "job_id": 1, "user_id": 1, "status": 1,
            "total": 1, "processed": 1, "total_bytes": 1,
            "created_at": 1, "started_at": 1,
            "error": 1,
        },
    ).sort("created_at", 1).limit(50)

    now = datetime.now(timezone.utc)
    jobs: list[dict] = []
    async for row in cursor:
        created_at_iso = row.get("created_at")
        age_min: float | None = None
        if created_at_iso:
            try:
                age_min = round((now - datetime.fromisoformat(created_at_iso)).total_seconds() / 60.0, 1)
            except ValueError:
                pass
        jobs.append({
            "job_id":       row.get("job_id"),
            "user_id":      row.get("user_id"),
            "status":       row.get("status"),
            "total":        row.get("total", 0),
            "processed":    row.get("processed", 0),
            "total_bytes":  row.get("total_bytes", 0),
            "created_at":   created_at_iso,
            "started_at":   row.get("started_at"),
            "age_minutes":  age_min,
            "error":        row.get("error"),
        })

    return {
        "threshold_minutes": threshold_minutes,
        "count": len(jobs),
        "jobs": jobs,
    }



@api_router.post("/admin/upload-jobs/recover-now")
async def recover_upload_jobs_now(user: User = Depends(require_admin)):
    """Admin-triggered: run ``recover_stuck_upload_jobs`` on demand
    instead of waiting up to 5 min for the next cron tick.

    Useful during a brief Atlas blip when the operator wants
    recovery to happen *right now* in front of a user reporting
    their upload "stuck".  Idempotent — the recovery sweeper
    re-reads job state on entry, so calling it twice in a row is
    safe.
    """
    recovered = await recover_stuck_upload_jobs()
    logger.info("admin %s manually re-kicked %d stuck upload job(s)", user.user_id, recovered)
    return {"recovered": recovered}



@api_router.get("/admin/upload-jobs/in-flight")
async def count_in_flight_upload_jobs(user: User = Depends(require_admin)):
    """Admin diagnostic — returns the count of upload jobs that are
    currently ``queued`` or ``processing``.

    Used by a sticky banner on /admin to warn the operator
    "Don't redeploy right now — N user uploads are in-flight".
    A redeploy interrupts the asyncio worker; if the staging
    directory doesn't survive (it should now, post-refactor) the
    in-flight bytes are lost and the jobs flip to "Staging
    directory vanished" via the recovery cron.

    Cheap to call (single ``count_documents`` with a covered
    index on ``status``).  The frontend polls it every 30s.
    """
    queued = await db.upload_jobs.count_documents({"status": "queued"})
    processing = await db.upload_jobs.count_documents({"status": "processing"})
    total = queued + processing
    return {
        "queued":     queued,
        "processing": processing,
        "total":      total,
        # Distinct user count is a useful operator signal too —
        # a single user with 200 in-flight uploads is a different
        # decision than 50 different users with 1-2 each.
        "users": len(await db.upload_jobs.distinct(
            "user_id",
            {"status": {"$in": ["queued", "processing"]}},
        )),
    }
