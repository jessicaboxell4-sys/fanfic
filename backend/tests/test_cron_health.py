"""Tests for the cron-health telemetry system.

Pins three contracts:
  1. The ``wrap_cron_job`` decorator records both successful and failed
     runs to ``db.cron_runs``.
  2. The admin ``/api/admin/cron-health`` endpoint returns each known
     job with last-run + 24h counters + recent history.
  3. The endpoint is admin-only (401/403 for non-admins, even if the
     user is authenticated).
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

backend_dir = str(pathlib.Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


@pytest.fixture()
def admin_session():
    """Create a throw-away admin user + session token."""
    uid = f"user_cradm_{uuid.uuid4().hex[:8]}"
    tok = f"sess_cradm_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "Cron Admin",
        "is_admin": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield {"user_id": uid, "token": tok}
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})


@pytest.fixture()
def normal_session():
    uid = f"user_crnorm_{uuid.uuid4().hex[:8]}"
    tok = f"sess_crnorm_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "Normal",
        "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield {"user_id": uid, "token": tok}
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})


def test_wrap_cron_job_records_success(loop):
    from utils.cron_health import wrap_cron_job

    JID = f"test_job_ok_{uuid.uuid4().hex[:6]}"

    async def _job():
        return "done"

    db.cron_runs.delete_many({"job_id": JID})
    wrapped = wrap_cron_job(_job, JID)
    result = loop.run_until_complete(wrapped())
    assert result == "done"

    rows = list(db.cron_runs.find({"job_id": JID}))
    assert len(rows) == 1
    assert rows[0]["status"] == "ok"
    assert rows[0]["error"] is None
    assert isinstance(rows[0]["duration_ms"], int)
    db.cron_runs.delete_many({"job_id": JID})


def test_wrap_cron_job_records_failure_and_reraises(loop):
    from utils.cron_health import wrap_cron_job

    JID = f"test_job_err_{uuid.uuid4().hex[:6]}"

    async def _job():
        raise RuntimeError("boom")

    db.cron_runs.delete_many({"job_id": JID})
    wrapped = wrap_cron_job(_job, JID)
    with pytest.raises(RuntimeError):
        loop.run_until_complete(wrapped())

    rows = list(db.cron_runs.find({"job_id": JID}))
    assert len(rows) == 1
    assert rows[0]["status"] == "error"
    assert "boom" in (rows[0]["error"] or "")
    db.cron_runs.delete_many({"job_id": JID})


def test_wrap_cron_job_retention_trims_to_200(loop):
    """Insert > retention runs and confirm the wrapper trims to the cap."""
    from utils.cron_health import wrap_cron_job, RUNS_PER_JOB_RETENTION

    JID = f"test_job_trim_{uuid.uuid4().hex[:6]}"

    async def _noop():
        return None

    db.cron_runs.delete_many({"job_id": JID})
    # Seed 205 pre-existing rows so the first wrapped invocation trims to 200.
    base = datetime.now(timezone.utc) - timedelta(days=30)
    db.cron_runs.insert_many([
        {
            "job_id": JID,
            "started_at": base + timedelta(minutes=i),
            "finished_at": base + timedelta(minutes=i, seconds=1),
            "duration_ms": 1000,
            "status": "ok",
            "error": None,
        }
        for i in range(205)
    ])

    wrapped = wrap_cron_job(_noop, JID)
    loop.run_until_complete(wrapped())  # inserts a 206th, then trims

    count = db.cron_runs.count_documents({"job_id": JID})
    assert count == RUNS_PER_JOB_RETENTION
    db.cron_runs.delete_many({"job_id": JID})


def test_admin_endpoint_returns_known_jobs(admin_session):
    """Smoke test: the endpoint returns one entry per known job with all
    the expected keys, even when no runs have ever been recorded."""
    r = requests.get(
        f"{BASE}/api/admin/cron-health",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "jobs" in data and "checked_at" in data
    ids = [j["id"] for j in data["jobs"]]
    assert "weekly_digest_tick" in ids
    assert "account_grace_tick" in ids
    for j in data["jobs"]:
        # Contract: every entry has these keys
        for key in (
            "id", "label", "schedule", "last_run", "last_ok_at",
            "runs_24h", "errors_24h", "error_rate_24h", "stale", "recent",
        ):
            assert key in j, f"missing key {key} on {j['id']}"
        assert isinstance(j["recent"], list)


def test_admin_endpoint_surfaces_recent_runs(admin_session):
    """Seed a few runs and verify they appear in the `recent` list with
    correct status + error fields."""
    JID = "weekly_digest_tick"
    # Clear and seed 3 mixed runs
    db.cron_runs.delete_many({"job_id": JID})
    now = datetime.now(timezone.utc)
    db.cron_runs.insert_many([
        {"job_id": JID, "started_at": now - timedelta(hours=2), "finished_at": now - timedelta(hours=2) + timedelta(seconds=3),
         "duration_ms": 3000, "status": "ok", "error": None},
        {"job_id": JID, "started_at": now - timedelta(hours=1), "finished_at": now - timedelta(hours=1) + timedelta(seconds=1),
         "duration_ms": 1000, "status": "error", "error": "RuntimeError('digest broken')"},
        {"job_id": JID, "started_at": now - timedelta(minutes=10), "finished_at": now - timedelta(minutes=10) + timedelta(seconds=2),
         "duration_ms": 2000, "status": "ok", "error": None},
    ])

    r = requests.get(
        f"{BASE}/api/admin/cron-health",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    assert r.status_code == 200
    job = next(j for j in r.json()["jobs"] if j["id"] == JID)
    # Last run is the most recent — the 10-min-ago OK one.
    assert job["last_run"]["status"] == "ok"
    # Last OK should also point to that one.
    assert job["last_ok_at"] is not None
    # 24h counters
    assert job["runs_24h"] >= 3
    assert job["errors_24h"] >= 1
    assert 0.0 <= job["error_rate_24h"] <= 1.0
    # Recent list contains the error row
    assert any(
        rec["status"] == "error" and "digest broken" in (rec["error"] or "")
        for rec in job["recent"]
    )
    # Stale should be False because last run is within 2h cadence
    assert job["stale"] is False
    db.cron_runs.delete_many({"job_id": JID})


def test_admin_endpoint_marks_stale_when_no_recent_runs(admin_session):
    """If the most recent run for account_grace_tick is older than its
    26h cadence, `stale` must be True so the UI can show a red badge."""
    JID = "account_grace_tick"
    db.cron_runs.delete_many({"job_id": JID})
    very_old = datetime.now(timezone.utc) - timedelta(days=3)
    db.cron_runs.insert_one({
        "job_id": JID,
        "started_at": very_old,
        "finished_at": very_old + timedelta(seconds=1),
        "duration_ms": 1000,
        "status": "ok",
        "error": None,
    })

    r = requests.get(
        f"{BASE}/api/admin/cron-health",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    job = next(j for j in r.json()["jobs"] if j["id"] == JID)
    assert job["stale"] is True
    db.cron_runs.delete_many({"job_id": JID})


def test_admin_endpoint_rejects_non_admin(normal_session):
    r = requests.get(
        f"{BASE}/api/admin/cron-health",
        headers={"Authorization": f"Bearer {normal_session['token']}"},
    )
    assert r.status_code in (401, 403), r.text


def test_admin_endpoint_rejects_anonymous():
    r = requests.get(f"{BASE}/api/admin/cron-health")
    assert r.status_code in (401, 403)
