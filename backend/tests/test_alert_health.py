"""Unit tests for the new ``/api/admin/alert-health`` endpoint.

The endpoint surfaces two distinct failure modes for the AdminConsole banner:
  1. ``alert_send_failures_24h`` — rows in ``db.email_logs`` where the
     cron-alert Resend send returned an error within the last 24h.
  2. ``cron_failures_uncovered_24h`` — cron-runs that errored in the last
     24h whose ``job_id`` has *no* matching ``cron_alerts`` row (i.e. the
     alert path never fired — usually because Resend wasn't configured,
     the flag was off, or no admin has an email set).

Hits the live preview backend via ``REACT_APP_BACKEND_URL`` and seeds
state through ``pymongo`` (matching the pattern in
``test_admin_console.py``).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

ADMIN_ID = f"user_alerth_{uuid.uuid4().hex[:8]}"
ADMIN_TOKEN = f"sess_alerth_{uuid.uuid4().hex}"
PLAIN_ID = f"user_alerthP_{uuid.uuid4().hex[:8]}"
PLAIN_TOKEN = f"sess_alerthP_{uuid.uuid4().hex}"


def H_ADMIN():
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


def H_PLAIN():
    return {"Authorization": f"Bearer {PLAIN_TOKEN}"}


JOB_PREFIX = "alerttest_"


@pytest.fixture(scope="module", autouse=True)
def seed():
    """Provision an admin + a non-admin and clean up after the module."""
    for uid, tok, is_admin, name in [
        (ADMIN_ID, ADMIN_TOKEN, True, "Alert Admin"),
        (PLAIN_ID, PLAIN_TOKEN, False, "Alert Plain"),
    ]:
        db.users.insert_one({
            "user_id": uid, "email": f"{uid}@example.com", "name": name,
            "picture": "", "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": uid, "session_token": tok,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    yield
    db.users.delete_many({"user_id": {"$in": [ADMIN_ID, PLAIN_ID]}})
    db.user_sessions.delete_many({"user_id": {"$in": [ADMIN_ID, PLAIN_ID]}})


@pytest.fixture
def clean_alert_state():
    """Wipe the alert + cron telemetry rows owned by this test module."""
    db.email_logs.delete_many({"kind": "cron_failure_alert", "to": {"$regex": "alerttest"}})
    db.cron_runs.delete_many({"job_id": {"$regex": f"^{JOB_PREFIX}"}})
    db.cron_alerts.delete_many({"job_id": {"$regex": f"^{JOB_PREFIX}"}})
    yield
    db.email_logs.delete_many({"kind": "cron_failure_alert", "to": {"$regex": "alerttest"}})
    db.cron_runs.delete_many({"job_id": {"$regex": f"^{JOB_PREFIX}"}})
    db.cron_alerts.delete_many({"job_id": {"$regex": f"^{JOB_PREFIX}"}})


def _get():
    return requests.get(f"{BASE}/api/admin/alert-health", headers=H_ADMIN(), timeout=15)


# ---------- Auth gating ------------------------------------------------------

def test_requires_admin():
    r = requests.get(f"{BASE}/api/admin/alert-health", timeout=15)
    assert r.status_code == 401
    r = requests.get(f"{BASE}/api/admin/alert-health", headers=H_PLAIN(), timeout=15)
    assert r.status_code == 403


# ---------- Counters ---------------------------------------------------------

def test_returns_zero_when_quiet(clean_alert_state):
    """No failures + no errored cron runs in window ⇒ banner stays hidden.

    Note we can't assert *zero* on the global counters (other tests/users
    may have unrelated rows); we only assert our test-prefixed jobs don't
    appear and the shape is valid.
    """
    r = _get()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["window_hours"] == 24
    assert isinstance(body["alert_send_failures_24h"], int)
    assert isinstance(body["cron_failures_uncovered_24h"], int)
    # None of our test jobs should leak in.
    assert not any(j.startswith(JOB_PREFIX) for j in body.get("uncovered_job_ids", []))


def test_counts_resend_send_failures(clean_alert_state):
    now = datetime.now(timezone.utc)
    db.email_logs.insert_many([
        {
            "sent_at": now - timedelta(minutes=10),
            "kind": "cron_failure_alert",
            "to": "alerttest_admin@example.com",
            "status": "error",
            "error": "Resend 429: rate limited",
            "job_id": f"{JOB_PREFIX}nightly_backup",
        },
        {
            "sent_at": now - timedelta(hours=2),
            "kind": "cron_failure_alert",
            "to": "alerttest_admin@example.com",
            "status": "error",
            "error": "Resend 500",
            "job_id": f"{JOB_PREFIX}nightly_backup",
        },
        # Outside 24h window — must not count.
        {
            "sent_at": now - timedelta(hours=48),
            "kind": "cron_failure_alert",
            "to": "alerttest_admin@example.com",
            "status": "error",
            "error": "Resend 500 old",
            "job_id": f"{JOB_PREFIX}old",
        },
        # Successful — must not count.
        {
            "sent_at": now - timedelta(minutes=5),
            "kind": "cron_failure_alert",
            "to": "alerttest_admin@example.com",
            "status": "ok",
        },
    ])
    body = _get().json()
    assert body["alert_send_failures_24h"] >= 2
    assert body["latest_failure"]["kind"] == "send_failed"
    assert body["latest_failure"]["job_id"] == f"{JOB_PREFIX}nightly_backup"
    assert "rate limited" in body["latest_failure"]["error"]


def test_flags_uncovered_cron_failures(clean_alert_state):
    now = datetime.now(timezone.utc)
    db.cron_runs.insert_many([
        {
            "job_id": f"{JOB_PREFIX}silent_a",
            "started_at": now - timedelta(minutes=30),
            "finished_at": now - timedelta(minutes=29),
            "duration_ms": 100, "status": "error",
            "error": "RuntimeError('boom')",
        },
        {
            "job_id": f"{JOB_PREFIX}silent_b",
            "started_at": now - timedelta(hours=3),
            "finished_at": now - timedelta(hours=3),
            "duration_ms": 50, "status": "error",
            "error": "ValueError('nope')",
        },
        # Covered: errored AND alert row exists.
        {
            "job_id": f"{JOB_PREFIX}covered",
            "started_at": now - timedelta(hours=1),
            "finished_at": now - timedelta(hours=1),
            "duration_ms": 50, "status": "error",
            "error": "RuntimeError('also boom but emailed')",
        },
        # Outside window.
        {
            "job_id": f"{JOB_PREFIX}ancient",
            "started_at": now - timedelta(hours=72),
            "finished_at": now - timedelta(hours=72),
            "duration_ms": 50, "status": "error",
            "error": "old",
        },
        # ``ok`` run never counts.
        {
            "job_id": f"{JOB_PREFIX}happy",
            "started_at": now - timedelta(minutes=5),
            "finished_at": now - timedelta(minutes=5),
            "duration_ms": 10, "status": "ok",
            "error": None,
        },
    ])
    db.cron_alerts.insert_one({
        "job_id": f"{JOB_PREFIX}covered",
        "last_sent_at": now - timedelta(minutes=59),
    })

    body = _get().json()
    # Other test runs may produce uncovered jobs too; assert ours are present
    # and the covered/old/happy ones are NOT.
    uncovered = set(body["uncovered_job_ids"])
    assert f"{JOB_PREFIX}silent_a" in uncovered
    assert f"{JOB_PREFIX}silent_b" in uncovered
    assert f"{JOB_PREFIX}covered" not in uncovered
    assert f"{JOB_PREFIX}ancient" not in uncovered
    assert f"{JOB_PREFIX}happy" not in uncovered
    # No send failures in this test → latest should describe a no_alert_sent.
    if body["alert_send_failures_24h"] == 0:
        assert body["latest_failure"]["kind"] == "no_alert_sent"
        # Most recent of our two: silent_a (29min vs 3h).
        assert body["latest_failure"]["job_id"] == f"{JOB_PREFIX}silent_a"


def test_send_failure_takes_priority_in_latest(clean_alert_state):
    """When both modes are present, latest_failure reports the send error
    (red is more actionable than amber)."""
    now = datetime.now(timezone.utc)
    db.email_logs.insert_one({
        "sent_at": now - timedelta(minutes=15),
        "kind": "cron_failure_alert",
        "to": "alerttest_admin@example.com",
        "status": "error",
        "error": "Resend 500",
        "job_id": f"{JOB_PREFIX}send_fail",
    })
    db.cron_runs.insert_one({
        "job_id": f"{JOB_PREFIX}silent_x",
        "started_at": now - timedelta(minutes=2),
        "finished_at": now - timedelta(minutes=2),
        "duration_ms": 50, "status": "error",
        "error": "RuntimeError('boom')",
    })
    body = _get().json()
    assert body["alert_send_failures_24h"] >= 1
    assert f"{JOB_PREFIX}silent_x" in body["uncovered_job_ids"]
    assert body["latest_failure"]["kind"] == "send_failed"
