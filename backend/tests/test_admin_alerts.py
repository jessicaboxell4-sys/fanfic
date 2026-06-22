"""Regression coverage for the admin-alert queue + weekly digest
(shipped 2026-06-22 to brake the Resend quota burn).

We don't actually call Resend — the test monkeypatches
``resend.Emails.send`` to a no-op recorder so each run stays free.
"""
from __future__ import annotations

import os
import sys
import pathlib
import uuid

import pytest

# Make ``backend/`` importable directly.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402


@pytest.fixture(scope="module")
def sync_db():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url, maxPoolSize=4)
    yield c[name]
    c.close()


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


@pytest.fixture()
def fresh_admin(sync_db):
    """Spin up a throw-away REAL admin (non-fixture email).  The
    weekly digest only emails admins whose address passes
    ``is_test_account``; we use a non-blocklisted prefix + domain so
    the filter treats this row as "real"."""
    suffix = uuid.uuid4().hex[:8]
    uid = f"user_aa_{suffix}"
    # local-part must NOT start with any of the test-account
    # prefixes (``user_``, ``test_``, ``qa_``, etc.) and the domain
    # must not match the test-domain blocklist either.  Pick
    # something that looks like a real reader address.
    email = f"opadmin{suffix}@shelfsort-prod-test.com"
    sync_db.users.insert_one({
        "user_id":  uid,
        "email":    email,
        "name":     "AA Test Admin",
        "is_admin": True,
    })
    yield {"user_id": uid, "email": email}
    sync_db.users.delete_many({"user_id": uid})
    sync_db.admin_pending_alerts.delete_many({})
    sync_db.admin_digest_runs.delete_many({})
    sync_db.notifications.delete_many({"user_id": uid})


def _run(loop, coro):
    return loop.run_until_complete(coro)


def test_queue_admin_alert_creates_row_and_notification(loop, sync_db, fresh_admin):
    from utils.admin_alerts import queue_admin_alert
    aid = _run(loop, queue_admin_alert(
        "cron_failure", "test job failed", "boom",
        meta={"job_id": "test_job_x"},
    ))
    assert isinstance(aid, str) and len(aid) >= 8
    row = sync_db.admin_pending_alerts.find_one({"alert_id": aid})
    assert row is not None
    assert row["status"] == "pending"
    assert row["count"] == 1
    # In-app notification for the real admin
    notif = sync_db.notifications.find_one({"user_id": fresh_admin["user_id"]})
    assert notif is not None
    assert notif["kind"] == "admin_alert.cron_failure"


def test_dedupe_key_bumps_count_instead_of_inserting(loop, sync_db, fresh_admin):
    from utils.admin_alerts import queue_admin_alert
    k = f"cron_failure:test_dedupe_{uuid.uuid4().hex[:6]}"
    a1 = _run(loop, queue_admin_alert("cron_failure", "x", "y", dedupe_key=k))
    a2 = _run(loop, queue_admin_alert("cron_failure", "x", "y", dedupe_key=k))
    a3 = _run(loop, queue_admin_alert("cron_failure", "x", "y", dedupe_key=k))
    assert a1 == a2 == a3
    row = sync_db.admin_pending_alerts.find_one({"alert_id": a1})
    assert row["count"] == 3


def test_test_fixture_admins_are_not_emailed(loop, sync_db, monkeypatch, fresh_admin):
    """Even when test-fixture admins exist in the DB, the digest must
    skip them — they bounce hard and waste Resend quota."""
    from utils.admin_alerts import weekly_admin_digest_tick

    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": f"x-{uuid.uuid4().hex[:6]}"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    # Seed an alert to give the digest something to send.
    from utils.admin_alerts import queue_admin_alert
    _run(loop, queue_admin_alert("cron_failure", "z", "z"))
    # Insert a noisy test-fixture admin
    fx_id = f"user_fx_{uuid.uuid4().hex[:6]}"
    sync_db.users.insert_one({
        "user_id":  fx_id,
        "email":    f"{fx_id}@example.com",  # blocklisted domain
        "is_admin": True,
    })
    try:
        result = _run(loop, weekly_admin_digest_tick())
        # Sent must include the real admin but NOT the fixture.
        recipients = [p["to"][0] for p in sent]
        assert fresh_admin["email"] in recipients
        assert not any(r.endswith("@example.com") for r in recipients)
        assert result["sent"] is True
        assert result["alerts"] >= 1
    finally:
        sync_db.users.delete_many({"user_id": fx_id})


def test_weekly_digest_marks_alerts_delivered(loop, sync_db, monkeypatch, fresh_admin):
    from utils.admin_alerts import weekly_admin_digest_tick, queue_admin_alert
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: {"id": "ok"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    aid = _run(loop, queue_admin_alert("cron_failure", "x", "y"))
    _run(loop, weekly_admin_digest_tick())
    row = sync_db.admin_pending_alerts.find_one({"alert_id": aid})
    assert row["status"] == "delivered"
    assert row.get("delivered_at") is not None


def test_weekly_digest_is_debounced(loop, sync_db, monkeypatch, fresh_admin):
    """Two back-to-back runs the same day — only one email batch."""
    from utils.admin_alerts import weekly_admin_digest_tick, queue_admin_alert
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": "ok"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    _run(loop, queue_admin_alert("cron_failure", "first", "1"))
    r1 = _run(loop, weekly_admin_digest_tick())
    r2 = _run(loop, weekly_admin_digest_tick())
    assert r1.get("sent") is True
    assert r2.get("sent") is False
    assert r2.get("reason") == "debounced"


def test_cron_failure_routed_via_queue_when_flag_on(loop, sync_db, monkeypatch, fresh_admin):
    """Smoke-test the cron_health → admin_alerts wiring: with the
    weekly-batch flag on (default), the immediate-email path is
    skipped and an admin_pending_alert row appears instead."""
    from utils.cron_health import _maybe_alert_admins
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": "x"},
    )
    job_id = f"pytest_route_{uuid.uuid4().hex[:6]}"
    _run(loop, _maybe_alert_admins(job_id, "intentional boom"))
    # No email
    assert sent == []
    # And a queued alert
    row = sync_db.admin_pending_alerts.find_one({"meta.job_id": job_id})
    assert row is not None
    assert row["kind"] == "cron_failure"


def test_dismiss_alerts_marks_dismissed(loop, sync_db, fresh_admin):
    from utils.admin_alerts import queue_admin_alert, dismiss_alerts, list_pending_alerts
    aid = _run(loop, queue_admin_alert("cron_failure", "to-dismiss", "x"))
    n = _run(loop, dismiss_alerts([aid]))
    assert n == 1
    row = sync_db.admin_pending_alerts.find_one({"alert_id": aid})
    assert row["status"] == "dismissed"
    # And the bell list no longer shows it
    remaining = _run(loop, list_pending_alerts())
    assert not any(r["alert_id"] == aid for r in remaining)
