"""Iter 68 — Email-quota watchdog auto-pause logic.

Verifies that ``utils/email_quota_watchdog.email_quota_watchdog_tick``:

1. Auto-flips ``outbound_emails_enabled`` → False when the forecast
   warning_level is "critical".
2. Pre-emptively pauses when ``cliff_eta_days <= 1``.
3. Does NOT auto-unpause once paused (matches AV watchdog posture).
4. Is idempotent: re-running the tick while already paused does not
   re-fire admin notifications.
5. Honors the ``EMAIL_QUOTA_WATCHDOG_DISABLED`` env kill-switch.
6. Pure trigger classifier (``_classify_trigger``) handles every
   warning_level / cliff combination correctly.

Driven against the live backend so the Mongo wiring, feature-flag
write, and audit/notification side-effects are all exercised
end-to-end.  Cleanups are aggressive so the suite leaves no state
behind regardless of pass/fail.
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

# Make backend importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils.email_quota_watchdog import _classify_trigger  # noqa: E402


def _f(**kw):
    """Build a forecast-shaped dict with sensible defaults for tests."""
    return {
        "daily_cap":            100,
        "daily_avg_7d":         0,
        "forecast_daily_avg":   0,
        "forecast_daily_pct":   0,
        "cliff_eta_days":       None,
        "warning_level":        "ok",
        **kw,
    }


# ---------------------------------------------------------------------------
# Pure-function tests — _classify_trigger
# ---------------------------------------------------------------------------

def test_classify_ok_when_well_under_cap():
    assert _classify_trigger(_f(daily_avg_7d=10, warning_level="ok")) is None


def test_classify_critical_on_actual_avg_over_cap():
    out = _classify_trigger(_f(daily_avg_7d=120, warning_level="critical"))
    assert out is not None
    assert "120" in out and "100" in out


def test_classify_critical_on_forecast_over_cap():
    # 7d avg still under cap, but the weekly projection pushes the
    # daily over.
    out = _classify_trigger(_f(daily_avg_7d=80, forecast_daily_avg=110, warning_level="critical"))
    assert out is not None
    assert "110" in out


def test_classify_cliff_eta_imminent_triggers_pause():
    out = _classify_trigger(_f(daily_avg_7d=85, cliff_eta_days=1, warning_level="warning"))
    assert out is not None
    assert "1" in out  # cliff days surfaced in reason text


def test_classify_cliff_eta_today_triggers_pause():
    out = _classify_trigger(_f(daily_avg_7d=99, cliff_eta_days=0, warning_level="warning"))
    assert out is not None


def test_classify_cliff_eta_far_away_does_not_trigger():
    assert _classify_trigger(_f(daily_avg_7d=60, cliff_eta_days=14, warning_level="warning")) is None


def test_classify_warning_without_cliff_does_not_trigger():
    # "warning" alone is too aggressive to auto-pause; needs cliff
    # window OR critical.
    assert _classify_trigger(_f(daily_avg_7d=72, warning_level="warning")) is None


# ---------------------------------------------------------------------------
# End-to-end tick tests — drive against the live backend Mongo
# ---------------------------------------------------------------------------

def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _cleanup():
    """Wipe any state this test module created."""
    c = _mongo()
    db = c[_db_name()]
    db.system_health.delete_one({"_id": "email_quota_watchdog"})
    db.audit_log.delete_many({"actor": "system.email_quota_watchdog"})
    db.notifications.delete_many({"kind": "email_quota_auto_pause"})
    db.admin_pending_alerts.delete_many({"kind": "email_quota_auto_pause"})
    # Restore the feature flag to its default-on state so other tests
    # in the suite aren't impacted.
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": True}},
        upsert=True,
    )
    c.close()
    # Invalidate the in-process feature-flags cache (5s TTL) so the
    # next tick reads fresh from Mongo.  Without this, a test that
    # flipped the flag → False can leak that value into the next
    # test's first ``is_enabled()`` call and cause spurious failures.
    try:
        from utils.feature_flags import _invalidate_cache
        _invalidate_cache()
    except Exception:  # noqa: BLE001
        pass


@pytest.fixture(autouse=True)
def _isolate_test_state():
    _cleanup()
    yield
    _cleanup()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _seed_critical_forecast(monkeypatch):
    """Patch email_volume_forecast() to return a critical-level payload."""
    import utils.email_quota_watchdog as mod

    async def fake_forecast():
        return _f(
            daily_avg_7d=120,
            forecast_daily_avg=140,
            forecast_daily_pct=140.0,
            warning_level="critical",
        )

    monkeypatch.setattr(mod, "email_volume_forecast", fake_forecast)


def _seed_ok_forecast(monkeypatch):
    import utils.email_quota_watchdog as mod

    async def fake_forecast():
        return _f(daily_avg_7d=15, forecast_daily_avg=20)

    monkeypatch.setattr(mod, "email_volume_forecast", fake_forecast)


def test_tick_auto_pauses_on_critical(monkeypatch):
    """First tick at critical → flag flipped, audit row written,
    admin notifications + pending-alerts row created."""
    from utils.email_quota_watchdog import email_quota_watchdog_tick
    _seed_critical_forecast(monkeypatch)

    result = _run(email_quota_watchdog_tick())
    assert result["auto_paused"] is True
    assert result["warning_level"] == "critical"
    assert "reached" in (result["reason"] or "")

    c = _mongo()
    try:
        db = c[_db_name()]
        # Flag flipped
        flag_doc = db.feature_flags.find_one({"_id": "singleton"})
        assert flag_doc.get("outbound_emails_enabled") is False
        # Audit log
        audit = db.audit_log.find_one({"actor": "system.email_quota_watchdog"})
        assert audit is not None
        assert audit["action"] == "email.auto_pause"
        assert audit["metadata"]["flag"] == "outbound_emails_enabled"
        # admin_pending_alerts row queued for the weekly digest
        alert = db.admin_pending_alerts.find_one({"kind": "email_quota_auto_pause"})
        assert alert is not None
    finally:
        c.close()


def test_tick_idempotent_when_already_paused(monkeypatch):
    """Second tick while still critical → no new admin notifications
    or alert queue rows.  We DO update the state doc's last_check so
    later observability surfaces show the watchdog is alive."""
    from utils.email_quota_watchdog import email_quota_watchdog_tick
    _seed_critical_forecast(monkeypatch)

    # First tick: triggers the pause.
    _run(email_quota_watchdog_tick())

    # Snapshot side-effect counts after the first tick.
    c = _mongo()
    db = c[_db_name()]
    audit_after_first = db.audit_log.count_documents({"actor": "system.email_quota_watchdog"})
    notif_after_first = db.notifications.count_documents({"kind": "email_quota_auto_pause"})
    alerts_after_first = db.admin_pending_alerts.count_documents({"kind": "email_quota_auto_pause"})
    c.close()

    # Second tick — should NOT re-pause / re-notify.
    second = _run(email_quota_watchdog_tick())
    assert second["auto_paused"] is True

    c = _mongo()
    db = c[_db_name()]
    assert db.audit_log.count_documents({"actor": "system.email_quota_watchdog"}) == audit_after_first
    assert db.notifications.count_documents({"kind": "email_quota_auto_pause"}) == notif_after_first
    assert db.admin_pending_alerts.count_documents({"kind": "email_quota_auto_pause"}) == alerts_after_first
    c.close()


def test_tick_does_not_auto_unpause_on_recovery(monkeypatch):
    """Once paused, a return to healthy forecast does NOT flip the
    flag back on.  Operator-explicit recovery only."""
    from utils.email_quota_watchdog import email_quota_watchdog_tick

    # 1) trigger the pause
    _seed_critical_forecast(monkeypatch)
    _run(email_quota_watchdog_tick())

    # 2) forecast recovers to healthy
    _seed_ok_forecast(monkeypatch)
    result = _run(email_quota_watchdog_tick())

    # Flag is still OFF.  Watchdog records the recovery in state
    # but leaves the kill-switch latched.
    c = _mongo()
    try:
        db = c[_db_name()]
        flag_doc = db.feature_flags.find_one({"_id": "singleton"})
        assert flag_doc.get("outbound_emails_enabled") is False
    finally:
        c.close()
    assert result["warning_level"] == "ok"
    assert result["auto_paused"] is True  # state-doc remembers prior pause


def test_tick_skipped_when_disabled_via_env(monkeypatch):
    monkeypatch.setenv("EMAIL_QUOTA_WATCHDOG_DISABLED", "1")
    _seed_critical_forecast(monkeypatch)
    from utils.email_quota_watchdog import email_quota_watchdog_tick
    result = _run(email_quota_watchdog_tick())
    assert result.get("skipped") is True
    # Flag must not be touched
    c = _mongo()
    try:
        db = c[_db_name()]
        flag_doc = db.feature_flags.find_one({"_id": "singleton"}) or {}
        # Should still be True (the default the fixture restored).
        assert flag_doc.get("outbound_emails_enabled", True) is True
    finally:
        c.close()


def test_tick_does_not_pause_when_ok(monkeypatch):
    _seed_ok_forecast(monkeypatch)
    from utils.email_quota_watchdog import email_quota_watchdog_tick
    result = _run(email_quota_watchdog_tick())
    assert result["auto_paused"] is False
    c = _mongo()
    try:
        db = c[_db_name()]
        flag_doc = db.feature_flags.find_one({"_id": "singleton"}) or {}
        assert flag_doc.get("outbound_emails_enabled", True) is True
        # No audit row, no admin notifications.
        assert db.audit_log.count_documents({"actor": "system.email_quota_watchdog"}) == 0
        assert db.notifications.count_documents({"kind": "email_quota_auto_pause"}) == 0
    finally:
        c.close()
