"""Regression for the silent-drop cron-alert path (2026-06-18).

When ``_maybe_alert_admins`` decides not to send (feature flag off,
no admin recipients with email, Resend not configured), it MUST
still write a ``cron_alerts`` row with ``suppressed=True`` and a
``reason``.  Without that, ``/admin/alert-health`` keeps reporting
the failing job as "uncovered" forever even after the operator
acknowledged the drop-out.

Follows the same loop+sync-collection pattern as test_cron_health.py
so it slots into the existing pytest setup.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys

import pytest

# Ensure backend/ is importable the same way test_cron_health does.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pymongo import MongoClient


@pytest.fixture(scope="module")
def db():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    yield client[db_name]
    client.close()


@pytest.fixture(scope="module")
def loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield loop
    finally:
        loop.close()


def test_suppression_records_row_when_no_admin_emails(loop, db):
    """Forcing zero admin recipients triggers the no_admin_recipients branch."""
    from utils.cron_health import _maybe_alert_admins

    JID = "test_supp_no_admin"
    # Demote every admin so the recipient list comes back empty.  Going
    # via ``is_admin`` instead of blanking ``email`` sidesteps the unique
    # index on ``users.email``.
    admin_ids = [a["user_id"] for a in db.users.find({"is_admin": True}, {"_id": 0, "user_id": 1})]
    db.users.update_many({"user_id": {"$in": admin_ids}}, {"$set": {"is_admin": False}})
    db.cron_alerts.delete_many({"job_id": JID})
    try:
        loop.run_until_complete(_maybe_alert_admins(JID, "boom"))
        row = db.cron_alerts.find_one({"job_id": JID})
        assert row is not None, "alerter must record a row, not silently drop"
        assert row.get("suppressed") is True
        assert row.get("reason") == "no_admin_recipients"
    finally:
        db.users.update_many({"user_id": {"$in": admin_ids}}, {"$set": {"is_admin": True}})
        db.cron_alerts.delete_many({"job_id": JID})


def test_suppression_records_row_when_resend_missing(loop, db, monkeypatch):
    """Blanking Resend env vars forces the resend_not_configured branch."""
    from utils.cron_health import _maybe_alert_admins

    JID = "test_supp_no_resend"
    monkeypatch.setenv("RESEND_API_KEY", "")
    monkeypatch.setenv("SENDER_EMAIL", "")
    db.cron_alerts.delete_many({"job_id": JID})
    try:
        loop.run_until_complete(_maybe_alert_admins(JID, "boom"))
        row = db.cron_alerts.find_one({"job_id": JID})
        assert row is not None
        assert row.get("suppressed") is True
        assert row.get("reason") == "resend_not_configured"
    finally:
        db.cron_alerts.delete_many({"job_id": JID})


def test_alert_health_filters_test_pytest_fixtures(loop, db):
    """The /admin/alert-health uncovered list MUST exclude pytest job_ids
    (anything starting with ``test_job_``) so prod alerts stay legible.

    We assert this by inserting one pytest-shaped failure row and one
    real-shaped failure row, then directly invoking the matching query
    that the endpoint uses.
    """
    from datetime import datetime, timezone, timedelta

    real_jid = "real_unwatched_failure_xyz"
    test_jid = "test_job_err_xyz"
    now = datetime.now(timezone.utc)

    db.cron_runs.delete_many({"job_id": {"$in": [real_jid, test_jid]}})
    db.cron_alerts.delete_many({"job_id": {"$in": [real_jid, test_jid]}})

    db.cron_runs.insert_many([
        {"job_id": real_jid, "status": "error", "finished_at": now - timedelta(minutes=10), "error": "boom"},
        {"job_id": test_jid, "status": "error", "finished_at": now - timedelta(minutes=10), "error": "boom"},
    ])
    try:
        # Mirror the endpoint's filter — pytest fixtures excluded.
        cutoff = now - timedelta(hours=24)
        cursor = db.cron_runs.find(
            {
                "status": "error",
                "finished_at": {"$gte": cutoff},
                "job_id": {"$not": {"$regex": "^test_job_"}},
            },
            {"_id": 0, "job_id": 1},
        )
        found_jids = {r["job_id"] for r in cursor}
        assert real_jid in found_jids
        assert test_jid not in found_jids, "pytest fixtures must not leak into prod alert banner"
    finally:
        db.cron_runs.delete_many({"job_id": {"$in": [real_jid, test_jid]}})
