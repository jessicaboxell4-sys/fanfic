"""Retry-from-server flow (2026-06-30).

When a job-level upload failure occurs, ``_run_upload_job`` now
moves the staged bytes to ``_retry_staging/<failure_id>/`` and
sets ``bytes_available=True`` on the resulting ``upload_failures``
row.  ``POST /uploads/failures/retry-server`` re-runs those bytes
through the async upload pipeline without the user re-dropping
anything.

These tests pin the end-to-end behaviour:

* Quarantined bytes survive into a fresh ``upload_jobs`` row.
* The retried ``upload_failures`` rows are soft-dismissed
  optimistically and ``retry_count`` is incremented.
* The cleanup cron drops quarantine dirs older than the
  retention cutoff and flips ``bytes_available`` to ``False``.
"""
from __future__ import annotations

import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from models import User  # noqa: E402


def _user_stub(user_id: str) -> User:
    return User(
        user_id=user_id,
        email=f"{user_id}@example.com",
        name="Retry Test",
        is_admin=False,
    )


def test_retry_server_promotes_quarantined_bytes_into_new_job(shared_event_loop):
    """Happy path: a failure row with quarantined bytes flows back
    through the async upload pipeline as a fresh ``upload_jobs`` row.
    """
    from routes.upload_failures import retry_upload_failures_server
    from deps import STORAGE_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        failure_id = uuid.uuid4().hex
        quarantine = STORAGE_DIR / user_id / "_retry_staging" / failure_id
        try:
            # Stage a quarantined file as ``_run_upload_job`` would.
            quarantine.mkdir(parents=True, exist_ok=True)
            (quarantine / "0042__novel.epub").write_bytes(b"PK\x03\x04quarantined")

            await db.upload_failures.insert_one({
                "failure_id": failure_id,
                "user_id": user_id,
                "filename": "novel.epub",
                "size_bytes": 12,
                "error": "Calibre crashed",
                "failure_stage": "process",
                "bytes_available": True,
                "job_id": "old_job",
                "book_id": None,
                "original_format": None,
                "retry_staging_path": str(quarantine),
                "retry_count": 0,
                "last_retried_at": None,
                "dismissed_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

            res = await retry_upload_failures_server(
                payload={"failure_ids": [failure_id]},
                user=_user_stub(user_id),
            )
            assert res["retried"] == 1
            assert res["skipped"] == 0
            new_job_id = res["job_id"]
            assert new_job_id

            # Quarantine dir is now empty / removed; bytes moved
            # to the new staging dir.
            assert not quarantine.exists()
            staging = STORAGE_DIR / user_id / "_pending_uploads" / new_job_id
            assert staging.exists()
            staged_files = list(staging.iterdir())
            assert len(staged_files) == 1
            assert staged_files[0].read_bytes() == b"PK\x03\x04quarantined"

            # New upload_jobs row references the failure and the
            # bytes.
            job_row = await db.upload_jobs.find_one({"job_id": new_job_id})
            assert job_row is not None
            assert job_row["user_id"] == user_id
            assert job_row["total"] == 1
            assert job_row["retry_of_failure_ids"] == [failure_id]
            assert job_row["staged_files"][0]["original_name"] == "novel.epub"

            # Failure row updated: retry counted + soft-dismissed.
            fr = await db.upload_failures.find_one({"failure_id": failure_id})
            assert fr["retry_count"] == 1
            assert fr["last_retried_at"] is not None
            assert fr["dismissed_at"] is not None
        finally:
            await db.upload_failures.delete_many({"user_id": user_id})
            await db.upload_jobs.delete_many({"user_id": user_id})
            user_root = STORAGE_DIR / user_id
            if user_root.exists():
                shutil.rmtree(user_root, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_retry_server_skips_rows_without_quarantined_bytes(shared_event_loop):
    """Rows with ``bytes_available=False`` (network failures, swept
    quarantine) must NOT block the retry pipeline — they're simply
    excluded, and the response reports ``retried=0``."""
    from routes.upload_failures import retry_upload_failures_server

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            await db.upload_failures.insert_one({
                "failure_id": uuid.uuid4().hex,
                "user_id": user_id,
                "filename": "lost.epub",
                "size_bytes": 0,
                "error": "Cloudflare 520",
                "failure_stage": "network",
                "bytes_available": False,
                "retry_staging_path": None,
                "retry_count": 0,
                "last_retried_at": None,
                "dismissed_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

            res = await retry_upload_failures_server(payload=None, user=_user_stub(user_id))
            assert res["retried"] == 0
            assert res["job_id"] is None
        finally:
            await db.upload_failures.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_cleanup_retry_staging_sweeps_old_dirs_and_flips_flag(shared_event_loop):
    """The daily cron drops quarantine dirs older than the cutoff
    and reflects the GC in Mongo so the UI stops offering Retry."""
    from routes.upload_failures import cleanup_retry_staging
    from deps import STORAGE_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        old_failure = uuid.uuid4().hex
        fresh_failure = uuid.uuid4().hex
        old_dir = STORAGE_DIR / user_id / "_retry_staging" / old_failure
        fresh_dir = STORAGE_DIR / user_id / "_retry_staging" / fresh_failure
        try:
            old_dir.mkdir(parents=True, exist_ok=True)
            (old_dir / "old.epub").write_bytes(b"ancient")
            # Backdate mtime past the 7-day cutoff.
            stale_ts = time.time() - (10 * 24 * 60 * 60)
            os.utime(old_dir, (stale_ts, stale_ts))

            fresh_dir.mkdir(parents=True, exist_ok=True)
            (fresh_dir / "fresh.epub").write_bytes(b"recent")

            for fid, path, available in [
                (old_failure, str(old_dir), True),
                (fresh_failure, str(fresh_dir), True),
            ]:
                await db.upload_failures.insert_one({
                    "failure_id": fid,
                    "user_id": user_id,
                    "filename": Path(path).name + ".epub",
                    "size_bytes": 0,
                    "error": "boom",
                    "failure_stage": "process",
                    "bytes_available": available,
                    "retry_staging_path": path,
                    "retry_count": 0,
                    "last_retried_at": None,
                    "dismissed_at": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

            swept = await cleanup_retry_staging()
            assert swept >= 1
            assert not old_dir.exists(), "expired quarantine dir should be deleted"
            assert fresh_dir.exists(), "fresh quarantine dir must survive"

            old_row = await db.upload_failures.find_one({"failure_id": old_failure})
            assert old_row["bytes_available"] is False
            assert old_row["retry_staging_path"] is None

            fresh_row = await db.upload_failures.find_one({"failure_id": fresh_failure})
            assert fresh_row["bytes_available"] is True
            assert fresh_row["retry_staging_path"] == str(fresh_dir)
        finally:
            await db.upload_failures.delete_many({"user_id": user_id})
            user_root = STORAGE_DIR / user_id
            if user_root.exists():
                shutil.rmtree(user_root, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())
