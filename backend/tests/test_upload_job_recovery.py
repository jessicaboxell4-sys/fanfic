"""Upload-job recovery — pins the tab-close + backend-restart safety
net for airdrop-mode uploads.

When the frontend drops more than 20 files at once, the SPA shifts
into airdrop mode: it POSTs the bytes and walks away the moment the
backend returns 202.  If the backend crashes between accepting the
bytes and finishing the pipeline, the only way that work resumes is
``recover_stuck_upload_jobs`` — either as a startup hook or via the
5-min cron.

This test simulates that crash by inserting a stale upload_jobs row
with no asyncio task running for it, then verifies the recovery
function re-kicks ``_run_upload_job`` for it.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def test_recover_stuck_upload_jobs_rekicks_stale_rows(shared_event_loop):
    """A queued/processing row older than 5 min with a non-empty
    staging dir gets `_run_upload_job` re-kicked."""
    from routes.upload_jobs import recover_stuck_upload_jobs, _JOB_STAGING_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        staging = _JOB_STAGING_DIR / job_id
        try:
            staging.mkdir(parents=True, exist_ok=True)
            # Plant a fake staged file so the staging-empty guard
            # doesn't trip.
            (staging / "fake.epub").write_bytes(b"PK\x03\x04")
            await db.upload_jobs.insert_one({
                "job_id": job_id,
                "user_id": user_id,
                "status": "queued",
                "total": 1,
                "processed": 0,
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
                "started_at": None,
                "staged_files": [{"path": str(staging / "fake.epub"), "original_name": "fake.epub"}],
                "keep_originals": [],
            })

            with patch("routes.upload_jobs._run_upload_job") as worker_mock:
                worker_mock.return_value = None
                n = await recover_stuck_upload_jobs()

            assert n >= 1
            # At least one of the re-kick calls must be for OUR job.
            kicked_ids = {c.args[0] for c in worker_mock.call_args_list}
            assert job_id in kicked_ids
        finally:
            await db.upload_jobs.delete_many({"job_id": job_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_recover_stuck_upload_jobs_skips_fresh_rows(shared_event_loop):
    """A row younger than 5 min is left alone — the original worker
    is still expected to finish on its own."""
    from routes.upload_jobs import recover_stuck_upload_jobs, _JOB_STAGING_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        staging = _JOB_STAGING_DIR / job_id
        try:
            staging.mkdir(parents=True, exist_ok=True)
            (staging / "fake.epub").write_bytes(b"PK\x03\x04")
            await db.upload_jobs.insert_one({
                "job_id": job_id,
                "user_id": user_id,
                "status": "queued",
                "total": 1,
                "processed": 0,
                # 2 min ago — well under the 5-min cutoff.
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(),
                "started_at": None,
                "staged_files": [],
                "keep_originals": [],
            })

            with patch("routes.upload_jobs._run_upload_job") as worker_mock:
                worker_mock.return_value = None
                await recover_stuck_upload_jobs()

            kicked_ids = {c.args[0] for c in worker_mock.call_args_list}
            assert job_id not in kicked_ids
        finally:
            await db.upload_jobs.delete_many({"job_id": job_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())
