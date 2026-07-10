"""Tests for the cron-failure email alert path in `utils/cron_health.py`.

What we verify
--------------
1. A failing wrapped cron job records a row in `cron_runs` with
   `status="error"` (existing behaviour, kept as a sanity check).
2. The wrapper invokes `_maybe_alert_admins` after that error write.
3. `_maybe_alert_admins` debounces: a second failure of the same
   `job_id` within ALERT_DEBOUNCE_MINUTES doesn't re-trigger Resend.
4. The `cron_failure_alerts` feature flag actually mutes the path.
5. Only admins (`is_admin: True`) with non-empty emails are notified.
6. Missing Resend configuration is a silent no-op (no exception).

We monkeypatch the in-process Resend send so the test never makes a
real HTTP call. Mongo state for `cron_alerts` is the durable record
the production code uses for debouncing, so we use the real Mongo
under `DB_NAME` and clean up after each test.
"""
import os
import asyncio
import pathlib
import sys
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

backend_dir = str(pathlib.Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
sync_db = mc[DB_NAME]


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop

# Two admins + one non-admin so we can assert the recipient list.
ADMIN_A = f"cron_admin_a_{uuid.uuid4().hex[:8]}@pytest.local"
ADMIN_B = f"cron_admin_b_{uuid.uuid4().hex[:8]}@pytest.local"
NON_ADMIN = f"cron_user_{uuid.uuid4().hex[:8]}@pytest.local"

ADMIN_A_ID = f"user_cra_{uuid.uuid4().hex[:8]}"
ADMIN_B_ID = f"user_crb_{uuid.uuid4().hex[:8]}"
NON_ADMIN_ID = f"user_crN_{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def _seed_and_cleanup():
    sync_db.users.update_one(
        {"user_id": ADMIN_A_ID},
        {"$set": {"user_id": ADMIN_A_ID, "email": ADMIN_A, "name": "Cron A", "is_admin": True}},
        upsert=True,
    )
    sync_db.users.update_one(
        {"user_id": ADMIN_B_ID},
        {"$set": {"user_id": ADMIN_B_ID, "email": ADMIN_B, "name": "Cron B", "is_admin": True}},
        upsert=True,
    )
    sync_db.users.update_one(
        {"user_id": NON_ADMIN_ID},
        {"$set": {"user_id": NON_ADMIN_ID, "email": NON_ADMIN, "name": "Cron U", "is_admin": False}},
        upsert=True,
    )
    # Ensure RESEND/SENDER look configured so the email path runs.
    os.environ.setdefault("RESEND_API_KEY", "test-resend-key")
    os.environ.setdefault("SENDER_EMAIL", "test@shelfsort.test")
    sync_db.cron_alerts.delete_many({"job_id": {"$regex": "^pytest_cron_"}})
    sync_db.cron_runs.delete_many({"job_id": {"$regex": "^pytest_cron_"}})
    # These tests cover the legacy immediate-email path; the default
    # changed to ``weekly_batch`` on 2026-06-22.  Force the immediate
    # branch by flipping the flag off + bust the in-process cache.
    sync_db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"cron_alerts_weekly_batch": False}},
        upsert=True,
    )
    try:
        from utils.feature_flags import _invalidate_cache as _bust  # noqa: WPS433
        _bust()
    except Exception:
        pass
    yield
    sync_db.users.delete_many({"user_id": {"$in": [ADMIN_A_ID, ADMIN_B_ID, NON_ADMIN_ID]}})
    sync_db.cron_alerts.delete_many({"job_id": {"$regex": "^pytest_cron_"}})
    sync_db.cron_runs.delete_many({"job_id": {"$regex": "^pytest_cron_"}})
    # Restore default weekly_batch.
    sync_db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"cron_alerts_weekly_batch": True}},
        upsert=True,
    )
    try:
        from utils.feature_flags import _invalidate_cache as _bust  # noqa: WPS433
        _bust()
    except Exception:
        pass


def _run(loop, coro):
    return loop.run_until_complete(coro)


def test_failing_job_records_error_and_emails_admins(loop, monkeypatch):
    from utils import cron_health

    sent_calls = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent_calls.append(params) or {"id": "test-id-1"},
    )

    job_id = f"pytest_cron_fail_{uuid.uuid4().hex[:6]}"

    @cron_health.track_cron_run(job_id)
    async def boom():
        raise RuntimeError("simulated explosion")

    with pytest.raises(RuntimeError):
        _run(loop, boom())

    # Error row written
    row = sync_db.cron_runs.find_one({"job_id": job_id})
    assert row is not None and row["status"] == "error"
    assert "simulated explosion" in (row.get("error") or "")

    # Email fired exactly once with both admins in `to:`
    assert len(sent_calls) == 1
    params = sent_calls[0]
    assert ADMIN_A in params["to"]
    assert ADMIN_B in params["to"]
    assert NON_ADMIN not in params["to"]
    assert job_id in params["subject"]
    assert "simulated explosion" in params["text"]

    # Debounce row persisted
    alert = sync_db.cron_alerts.find_one({"job_id": job_id})
    assert alert is not None


def test_second_failure_within_debounce_window_is_silent(loop, monkeypatch):
    from utils import cron_health

    sent_calls = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent_calls.append(params) or {"id": "test-id-2"},
    )

    job_id = f"pytest_cron_debounce_{uuid.uuid4().hex[:6]}"

    @cron_health.track_cron_run(job_id)
    async def boom():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        _run(loop, boom())
    with pytest.raises(ValueError):
        _run(loop, boom())
    # Two failures — only one email.
    assert len(sent_calls) == 1


def test_feature_flag_disables_alert(loop, monkeypatch):
    from utils import cron_health, feature_flags

    sent_calls = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent_calls.append(params) or {"id": "test-id-3"},
    )
    # Persist the disabled flag via the real persistence path.
    _run(loop, feature_flags.set_flag("cron_failure_alerts", False))

    job_id = f"pytest_cron_flagoff_{uuid.uuid4().hex[:6]}"

    @cron_health.track_cron_run(job_id)
    async def boom():
        raise RuntimeError("muted")

    try:
        with pytest.raises(RuntimeError):
            _run(loop, boom())
        # No email sent…
        assert len(sent_calls) == 0
        # …but a suppression row IS written so /admin/alert-health
        # doesn't keep flagging this job as "uncovered" (2026-06-18
        # behaviour change — see test_cron_alert_suppression.py).
        row = sync_db.cron_alerts.find_one({"job_id": job_id})
        assert row is not None, "expected a suppression row, got None"
        assert row.get("suppressed") is True
        assert row.get("reason") == "feature_flag_off"
    finally:
        # Reset for other tests.
        _run(loop, feature_flags.set_flag("cron_failure_alerts", True))
        sync_db.cron_alerts.delete_many({"job_id": job_id})


def test_no_resend_config_is_silent_noop(loop, monkeypatch):
    from utils import cron_health

    sent_calls = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent_calls.append(params) or {"id": "test-id-4"},
    )
    monkeypatch.delenv("RESEND_API_KEY", raising=False)

    job_id = f"pytest_cron_noresend_{uuid.uuid4().hex[:6]}"

    @cron_health.track_cron_run(job_id)
    async def boom():
        raise RuntimeError("no key configured")

    try:
        with pytest.raises(RuntimeError):
            _run(loop, boom())
        # The cron_runs row is still written…
        assert sync_db.cron_runs.find_one({"job_id": job_id}) is not None
        # …no email goes out…
        assert len(sent_calls) == 0
        # …and the suppression row is recorded with the expected
        # reason so the alert-health endpoint can stop nagging
        # about this run (2026-06-18 behaviour change).
        row = sync_db.cron_alerts.find_one({"job_id": job_id})
        assert row is not None
        assert row.get("suppressed") is True
        assert row.get("reason") == "resend_not_configured"
    finally:
        sync_db.cron_alerts.delete_many({"job_id": job_id})


def test_successful_job_does_not_email(loop, monkeypatch):
    from utils import cron_health

    sent_calls = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent_calls.append(params) or {"id": "test-id-5"},
    )

    job_id = f"pytest_cron_ok_{uuid.uuid4().hex[:6]}"

    @cron_health.track_cron_run(job_id)
    async def happy():
        return "fine"

    assert _run(loop, happy()) == "fine"
    assert len(sent_calls) == 0
