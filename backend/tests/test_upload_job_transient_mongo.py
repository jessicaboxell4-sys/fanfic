"""Upload-job transient-Mongo handling — pins the friendly-message
+ keep-queued behaviour added 2026-06-27.

When Atlas does a primary election (or the connection pool blips),
``_run_upload_job`` can hit a ``ServerSelectionTimeoutError``,
``NetworkTimeout``, ``AutoReconnect``, etc.  We MUST NOT mark the
job ``"failed"`` in that case — the recovery cron is supposed to
pick it back up.  We MUST also surface a user-friendly error
string instead of the raw topology dump.

These tests lock that contract:

* ``test_transient_mongo_error_keeps_job_queued`` — mocks
  ``routes.books.upload_books`` to raise ``ServerSelectionTimeoutError``,
  asserts the job row ends with ``status='queued'``, the staging
  directory is preserved (so the recovery cron has bytes to retry),
  and the ``error`` field is the friendly message, not the raw
  Mongo trace.
* ``test_non_transient_error_marks_job_failed`` — same scaffold,
  but raises a plain ``RuntimeError``: asserts ``status='failed'``
  and the staging directory is swept.
* ``test_friendly_mongo_message_covers_all_transient_types`` —
  unit test for the message translator; guards against accidental
  removal of a branch when new transient types are added.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from dotenv import load_dotenv
from pymongo.errors import (
    AutoReconnect,
    ConnectionFailure,
    NetworkTimeout,
    NotPrimaryError,
    ServerSelectionTimeoutError,
    WaitQueueTimeoutError,
)

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _seed_user_doc(user_id: str) -> dict:
    """Build a minimal but schema-valid ``users`` row."""
    return {
        "user_id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Transient Test",
        "picture": "",
        "is_admin": False,
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _seed_upload_job(job_id: str, user_id: str, staging: Path) -> dict:
    fake = staging / "0000__fake.epub"
    fake.write_bytes(b"PK\x03\x04fake")
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "job_id": job_id,
        "user_id": user_id,
        "status": "queued",
        "total": 1,
        "processed": 0,
        "total_bytes": len(b"PK\x03\x04fake"),
        "staged_files": [{
            "original_name": "fake.epub",
            "path": str(fake),
            "size": 5,
        }],
        "keep_originals": [],
        "response": None,
        "error": None,
        "created_at": now_iso,
        "updated_at": now_iso,
        "started_at": None,
        "completed_at": None,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
    }


def test_friendly_mongo_message_covers_all_transient_types():
    """Every transient type in the union must yield a non-empty,
    user-safe message — no raw topology JSON, no class names."""
    from utils.db_retry import friendly_mongo_message, is_transient_mongo_error

    samples = [
        ServerSelectionTimeoutError("no primary"),
        NetworkTimeout("read timed out"),
        AutoReconnect("reconnect"),
        NotPrimaryError("not master"),
        ConnectionFailure("dropped"),
        WaitQueueTimeoutError("pool exhausted"),
    ]
    for exc in samples:
        assert is_transient_mongo_error(exc), f"{type(exc).__name__} should be transient"
        msg = friendly_mongo_message(exc)
        assert msg and isinstance(msg, str)
        assert "Shelfsort will retry" in msg
        # No raw class names should leak into the user-facing text.
        assert type(exc).__name__ not in msg


def test_is_transient_mongo_error_rejects_real_bugs():
    """Real bugs (RuntimeError, ValueError, OperationFailure with a
    real code) must NOT be classified as transient — otherwise the
    recovery cron would loop forever on a real bug."""
    from utils.db_retry import is_transient_mongo_error

    assert not is_transient_mongo_error(RuntimeError("boom"))
    assert not is_transient_mongo_error(ValueError("bad input"))
    assert not is_transient_mongo_error(KeyError("missing"))


def test_transient_mongo_error_keeps_job_queued(shared_event_loop):
    """A transient Mongo error in the upload pipeline leaves the
    row recoverable: status='queued', started_at=None, friendly
    error string, staging dir preserved."""
    from routes.upload_jobs import _run_upload_job, _JOB_STAGING_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        staging = _JOB_STAGING_DIR / job_id
        try:
            staging.mkdir(parents=True, exist_ok=True)
            await db.users.insert_one(_seed_user_doc(user_id))
            await db.upload_jobs.insert_one(_seed_upload_job(job_id, user_id, staging))

            # Patch the late-imported handler to raise a transient
            # Mongo error mid-pipeline.
            async def _boom(*args, **kwargs):
                raise ServerSelectionTimeoutError(
                    "No replica set members available for replica set 'shelfsort-rs'"
                )

            with patch("routes.books.upload_books", new=AsyncMock(side_effect=_boom)):
                await _run_upload_job(job_id, user_id)

            row = await db.upload_jobs.find_one({"job_id": job_id})
            assert row is not None
            assert row["status"] == "queued", (
                f"transient errors must leave status=queued so the "
                f"recovery cron retries, got {row['status']!r}"
            )
            assert row.get("started_at") is None, (
                "started_at must be cleared so the cron's "
                "'started_at < cutoff OR started_at is None' filter matches"
            )
            assert row.get("error")
            assert "Shelfsort will retry" in row["error"]
            # Raw replica-set name must NOT leak into the error blurb.
            assert "shelfsort-rs" not in row["error"]
            # Bytes must still be on disk for the recovery cron.
            assert staging.exists()
            assert any(staging.iterdir())
        finally:
            await db.upload_jobs.delete_many({"job_id": job_id})
            await db.users.delete_many({"user_id": user_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_non_transient_error_marks_job_failed(shared_event_loop):
    """A real bug (RuntimeError) still terminates the job — we don't
    want infinite retries on a real bug."""
    from routes.upload_jobs import _run_upload_job, _JOB_STAGING_DIR

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        staging = _JOB_STAGING_DIR / job_id
        try:
            staging.mkdir(parents=True, exist_ok=True)
            await db.users.insert_one(_seed_user_doc(user_id))
            await db.upload_jobs.insert_one(_seed_upload_job(job_id, user_id, staging))

            async def _boom(*args, **kwargs):
                raise RuntimeError("genuine bug")

            with patch("routes.books.upload_books", new=AsyncMock(side_effect=_boom)):
                await _run_upload_job(job_id, user_id)

            row = await db.upload_jobs.find_one({"job_id": job_id})
            assert row is not None
            assert row["status"] == "failed"
            assert "genuine bug" in (row.get("error") or "")
            # Real-bug path runs the finally-block sweep.
            assert not staging.exists() or not any(staging.iterdir())
        finally:
            await db.upload_jobs.delete_many({"job_id": job_id})
            await db.users.delete_many({"user_id": user_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())
