"""Persistent upload-failures collection — pins the user-visible
failed-uploads dashboard added 2026-06-28.

Tests cover:

* ``record_upload_failure`` writes a schema-correct row.
* ``GET /uploads/failures`` returns only the calling user's rows,
  filters by ``days``, hides dismissed rows by default.
* ``POST /uploads/failures/{id}/dismiss`` is per-user (can't
  dismiss someone else's row).
* ``POST /uploads/failures/dismiss-all`` only touches undismissed
  rows for the calling user.
* ``DELETE /uploads/failures/{id}`` hard-deletes.
* Job-level failures in ``_run_upload_job`` emit one row per
  staged file with the friendly error blurb.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

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
        name="Failure Test",
        is_admin=False,
    )


def test_record_upload_failure_persists_schema_correct_row(shared_event_loop):
    from routes.upload_failures import record_upload_failure

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            fid = await record_upload_failure(
                user_id=user_id,
                filename="ghost-in-the-shell.epub",
                error="Calibre conversion crashed: list index out of range",
                failure_stage="convert",
                size_bytes=12345,
                bytes_available=False,
                job_id="job_test",
            )
            row = await db.upload_failures.find_one({"failure_id": fid})
            assert row is not None
            assert row["user_id"] == user_id
            assert row["filename"] == "ghost-in-the-shell.epub"
            assert row["failure_stage"] == "convert"
            assert row["size_bytes"] == 12345
            assert row["bytes_available"] is False
            assert row["retry_count"] == 0
            assert row["dismissed_at"] is None
            assert "list index" in row["error"]
            # ISO datetime sanity check
            datetime.fromisoformat(row["created_at"])
        finally:
            await db.upload_failures.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_record_upload_failure_truncates_runaway_error(shared_event_loop):
    """Don't let a 50KB Cloudflare HTML body bloat the row."""
    from routes.upload_failures import record_upload_failure

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            fid = await record_upload_failure(
                user_id=user_id,
                filename="x.epub",
                error="X" * 10_000,
                failure_stage="network",
            )
            row = await db.upload_failures.find_one({"failure_id": fid})
            assert len(row["error"]) == 500
        finally:
            await db.upload_failures.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_list_upload_failures_filters_by_user_days_and_dismissed(shared_event_loop):
    from routes.upload_failures import list_upload_failures, record_upload_failure

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        other_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            f_fresh = await record_upload_failure(
                user_id=user_id, filename="fresh.epub",
                error="net blip", failure_stage="network",
            )
            f_dismissed = await record_upload_failure(
                user_id=user_id, filename="dismissed.epub",
                error="net blip", failure_stage="network",
            )
            f_other = await record_upload_failure(
                user_id=other_id, filename="otheruser.epub",
                error="net blip", failure_stage="network",
            )
            # Backdate one row beyond the 30-day cutoff.
            f_old = await record_upload_failure(
                user_id=user_id, filename="old.epub",
                error="net blip", failure_stage="network",
            )
            await db.upload_failures.update_one(
                {"failure_id": f_old},
                {"$set": {"created_at": (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()}},
            )
            await db.upload_failures.update_one(
                {"failure_id": f_dismissed},
                {"$set": {"dismissed_at": datetime.now(timezone.utc).isoformat()}},
            )

            res = await list_upload_failures(days=30, include_dismissed=False, user=_user_stub(user_id))
            ids = {r["failure_id"] for r in res["failures"]}
            assert f_fresh in ids
            assert f_dismissed not in ids, "dismissed rows hidden by default"
            assert f_other not in ids, "other user's rows must never leak"
            assert f_old not in ids, "rows past the days cutoff must be hidden"

            res2 = await list_upload_failures(days=30, include_dismissed=True, user=_user_stub(user_id))
            ids2 = {r["failure_id"] for r in res2["failures"]}
            assert f_fresh in ids2 and f_dismissed in ids2
        finally:
            await db.upload_failures.delete_many({"user_id": {"$in": [user_id, other_id]}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_dismiss_upload_failure_is_per_user(shared_event_loop):
    from routes.upload_failures import dismiss_upload_failure, record_upload_failure

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        other_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            fid = await record_upload_failure(
                user_id=user_id, filename="x.epub", error="boom",
            )
            # Other user can't dismiss your row.
            r1 = await dismiss_upload_failure(fid, user=_user_stub(other_id))
            assert r1["dismissed"] == 0
            row = await db.upload_failures.find_one({"failure_id": fid})
            assert row["dismissed_at"] is None

            # Owner can.
            r2 = await dismiss_upload_failure(fid, user=_user_stub(user_id))
            assert r2["dismissed"] == 1
            row = await db.upload_failures.find_one({"failure_id": fid})
            assert row["dismissed_at"] is not None
        finally:
            await db.upload_failures.delete_many({"user_id": {"$in": [user_id, other_id]}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_dismiss_all_clears_only_calling_user(shared_event_loop):
    from routes.upload_failures import dismiss_all_upload_failures, record_upload_failure

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        other_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            for n in range(3):
                await record_upload_failure(user_id=user_id, filename=f"u{n}.epub", error="boom")
            await record_upload_failure(user_id=other_id, filename="other.epub", error="boom")

            res = await dismiss_all_upload_failures(user=_user_stub(user_id))
            assert res["dismissed"] == 3

            still_active = await db.upload_failures.count_documents({
                "user_id": other_id, "dismissed_at": None,
            })
            assert still_active == 1
        finally:
            await db.upload_failures.delete_many({"user_id": {"$in": [user_id, other_id]}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_run_upload_job_records_per_file_failures_on_real_bug(shared_event_loop):
    """When the job pipeline raises a real (non-transient) error,
    every staged file gets a ``upload_failures`` row with the
    friendly error blurb — so the user sees the per-file names on
    /account, not an opaque job id."""
    from routes.upload_jobs import _JOB_STAGING_DIR, _run_upload_job

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        staging = _JOB_STAGING_DIR / job_id
        try:
            staging.mkdir(parents=True, exist_ok=True)
            # Two staged files.
            fnames = ["alpha.epub", "beta.epub"]
            staged = []
            for name in fnames:
                p = staging / name
                p.write_bytes(b"PK\x03\x04")
                staged.append({"original_name": name, "path": str(p), "size": 5})

            await db.users.insert_one({
                "user_id": user_id, "email": f"{user_id}@x.com",
                "name": "T", "is_admin": False,
                "approval_status": "approved",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.upload_jobs.insert_one({
                "job_id": job_id, "user_id": user_id,
                "status": "queued", "total": len(fnames),
                "processed": 0, "total_bytes": 10,
                "staged_files": staged, "keep_originals": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "started_at": None,
            })

            async def _boom(*args, **kwargs):
                raise RuntimeError("Calibre died: list index out of range")

            with patch("routes.books.upload_books", new=AsyncMock(side_effect=_boom)):
                await _run_upload_job(job_id, user_id)

            # One failure row per staged file, all linked to this job_id.
            rows = []
            async for r in db.upload_failures.find({"job_id": job_id}):
                rows.append(r)
            assert len(rows) == 2
            names = {r["filename"] for r in rows}
            assert names == set(fnames)
            for r in rows:
                assert r["user_id"] == user_id
                assert r["failure_stage"] == "process"
                assert "list index" in r["error"]
                # 2026-06-30: bytes are now quarantined under
                # _retry_staging/<failure_id>/ before the finally
                # sweep, so the row advertises them as available
                # for server-side retry.
                assert r["bytes_available"] is True
                assert r["retry_staging_path"] is not None
                from pathlib import Path as _P
                q_dir = _P(r["retry_staging_path"])
                assert q_dir.exists() and q_dir.is_dir()
                # The single quarantined file should be readable.
                files = list(q_dir.iterdir())
                assert len(files) == 1
                assert files[0].read_bytes() == b"PK\x03\x04"
        finally:
            # Cleanup quarantine dirs we created.
            from deps import STORAGE_DIR
            user_retry_root = STORAGE_DIR / user_id / "_retry_staging"
            if user_retry_root.exists():
                import shutil as _sh
                _sh.rmtree(user_retry_root, ignore_errors=True)
            await db.upload_failures.delete_many({"job_id": job_id})
            await db.upload_jobs.delete_many({"job_id": job_id})
            await db.users.delete_many({"user_id": user_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())
