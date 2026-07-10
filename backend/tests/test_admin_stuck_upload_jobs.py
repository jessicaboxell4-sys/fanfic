"""Admin diagnostic: ``GET /admin/upload-jobs/stuck`` pin.

Locks the operator-visible upload-recovery dashboard added 2026-06-27.
Tests the underlying function directly (auth dependency is a thin
``require_admin`` gate that's covered by other tests).
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from models import User  # noqa: E402


def _admin_stub(user_id: str) -> User:
    return User(
        user_id=user_id,
        email=f"{user_id}@example.com",
        name="Admin Stub",
        is_admin=True,
    )


def test_list_stuck_upload_jobs_surfaces_stale_rows(shared_event_loop):
    """An upload job older than 10 min with a friendly transient
    error shows up in the admin diagnostic — exact friendly message
    intact, age_minutes computed, status preserved."""
    from routes.upload_jobs import list_stuck_upload_jobs

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        stuck_id = f"job_{uuid.uuid4().hex[:10]}"
        fresh_id = f"job_{uuid.uuid4().hex[:10]}"
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            # Stuck for 20 min, transient Mongo error blurb
            await db.upload_jobs.insert_one({
                "job_id": stuck_id,
                "user_id": user_id,
                "status": "queued",
                "total": 3,
                "processed": 0,
                "total_bytes": 12345,
                "staged_files": [],
                "keep_originals": [],
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(),
                "started_at": None,
                "error": "Our database briefly had no primary node — Shelfsort will retry automatically.",
            })
            # Younger than threshold — should NOT appear.
            await db.upload_jobs.insert_one({
                "job_id": fresh_id,
                "user_id": user_id,
                "status": "queued",
                "total": 1,
                "processed": 0,
                "total_bytes": 100,
                "staged_files": [],
                "keep_originals": [],
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(),
                "started_at": None,
                "error": None,
            })

            result = await list_stuck_upload_jobs(user=_admin_stub(user_id), threshold_minutes=10)
            assert result["threshold_minutes"] == 10
            ids = {j["job_id"] for j in result["jobs"]}
            assert stuck_id in ids, "20-min-old job must surface"
            assert fresh_id not in ids, "2-min-old job must NOT surface"

            stuck = next(j for j in result["jobs"] if j["job_id"] == stuck_id)
            assert stuck["status"] == "queued"
            assert stuck["total"] == 3
            assert "Shelfsort will retry" in (stuck["error"] or "")
            assert stuck["age_minutes"] is not None
            assert 19 <= stuck["age_minutes"] <= 22
        finally:
            await db.upload_jobs.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_list_stuck_upload_jobs_empty_when_healthy(shared_event_loop):
    """When no jobs are older than the threshold, the response is an
    empty list with count=0 — UI uses this to render NOTHING (zero
    visual cost on a healthy admin page)."""
    from routes.upload_jobs import list_stuck_upload_jobs

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        recent_id = f"job_{uuid.uuid4().hex[:10]}"
        try:
            await db.upload_jobs.insert_one({
                "job_id": recent_id,
                "user_id": user_id,
                "status": "queued",
                "total": 1,
                "processed": 0,
                "total_bytes": 50,
                "staged_files": [],
                "keep_originals": [],
                "created_at": (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat(),
                "started_at": None,
                "error": None,
            })
            # Crank threshold up so nothing matches.
            result = await list_stuck_upload_jobs(user=_admin_stub(user_id), threshold_minutes=60)
            # Other tenants may have stale rows; filter by our user.
            ours = [j for j in result["jobs"] if j["user_id"] == user_id]
            assert ours == []
        finally:
            await db.upload_jobs.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_list_stuck_upload_jobs_clamps_threshold(shared_event_loop):
    """``threshold_minutes`` is clamped to [1, 240] so a hostile or
    typo'd value can't OOM the cursor."""
    from routes.upload_jobs import list_stuck_upload_jobs

    async def _run():
        # Underflow
        r1 = await list_stuck_upload_jobs(user=_admin_stub("u1"), threshold_minutes=0)
        assert r1["threshold_minutes"] == 1
        # Overflow
        r2 = await list_stuck_upload_jobs(user=_admin_stub("u1"), threshold_minutes=99999)
        assert r2["threshold_minutes"] == 240

    shared_event_loop.run_until_complete(_run())


def test_recover_upload_jobs_now_rekicks_stale(shared_event_loop):
    """POST /admin/upload-jobs/recover-now re-runs the sweeper and
    returns the count of jobs re-kicked.  Stale jobs with bytes on
    disk are re-kicked; fresh jobs are left alone."""
    from unittest.mock import patch
    from routes.upload_jobs import recover_upload_jobs_now, _JOB_STAGING_DIR

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
                "staged_files": [{"path": str(staging / "fake.epub"), "original_name": "fake.epub"}],
                "keep_originals": [],
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=12)).isoformat(),
                "started_at": None,
            })

            # Patch the worker so we don't actually run the pipeline.
            with patch("routes.upload_jobs._run_upload_job") as worker_mock:
                worker_mock.return_value = None
                result = await recover_upload_jobs_now(user=_admin_stub(user_id))

            assert "recovered" in result
            assert result["recovered"] >= 1
        finally:
            await db.upload_jobs.delete_many({"job_id": job_id})
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_count_in_flight_upload_jobs(shared_event_loop):
    """GET /admin/upload-jobs/in-flight returns counts split by
    status + distinct-user count.  The frontend banner uses these
    to nudge the operator away from redeploying mid-Airdrop."""
    from routes.upload_jobs import count_in_flight_upload_jobs

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_a = f"user_{uuid.uuid4().hex[:10]}"
        user_b = f"user_{uuid.uuid4().hex[:10]}"
        ids = []
        try:
            for name, status, owner in [
                ("a1", "queued", user_a),
                ("a2", "processing", user_a),
                ("b1", "queued", user_b),
                ("c1", "done", user_b),   # terminal — must NOT count.
                ("d1", "failed", user_a), # terminal — must NOT count.
            ]:
                jid = f"job_{uuid.uuid4().hex[:6]}_{name}"
                ids.append(jid)
                await db.upload_jobs.insert_one({
                    "job_id": jid, "user_id": owner, "status": status,
                    "total": 1, "processed": 0, "total_bytes": 0,
                    "staged_files": [], "keep_originals": [],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "started_at": None,
                })

            res = await count_in_flight_upload_jobs(user=_admin_stub(user_a))
            # We must be lower-bounded by what we just inserted.  Other
            # rows from other tenants may exist in the shared DB, so
            # check >= rather than ==.
            assert res["queued"]     >= 2
            assert res["processing"] >= 1
            assert res["total"]      >= 3
            assert res["users"]      >= 2
        finally:
            await db.upload_jobs.delete_many({"job_id": {"$in": ids}})
            cli.close()

    shared_event_loop.run_until_complete(_run())
