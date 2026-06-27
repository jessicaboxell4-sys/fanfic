"""Iter 70 — GuardiansBanner cross-page paused-state surface.

Verifies that ``GET /api/admin/system-health`` returns enough info
for the GuardiansBanner frontend to render a "🛑 N guardians paused"
sticky alert across the admin console.

Specifically:
  • Paused watchdogs are flagged (auto_paused=True) so the FE filter
    `list.filter(w => w.auto_paused === true)` picks them up.
  • Friendly name + summary + flag fields are populated so the
    banner can format the alert without further lookups.
  • The endpoint is resilient to a missing canary_status.json or
    missing system_health rows (any single source failing should
    not break the whole list).
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _seed(state: dict):
    c = _mongo()
    c[_db_name()].system_health.update_one(
        {"_id": "email_quota_watchdog"}, {"$set": state}, upsert=True
    )
    c.close()


def _cleanup():
    c = _mongo()
    c[_db_name()].system_health.delete_many({"_id": {"$in": ["av_watchdog", "email_quota_watchdog"]}})
    c.close()


@pytest.fixture(autouse=True)
def _isolate():
    _cleanup()
    yield
    _cleanup()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _call_endpoint():
    from routes.admin import system_health as fn
    fake_user = type("U", (), {"user_id": "test", "is_admin": True})()
    return _run(fn(user=fake_user))


def test_banner_finds_paused_watchdog_in_response():
    """A paused watchdog must show up in the array with auto_paused=True
    so the FE filter catches it."""
    _seed({
        "last_check":   "2026-06-27T01:30:00+00:00",
        "auto_paused":  True,
        "last_warning": "critical",
        "last_metrics": {"daily_avg_7d": 120, "cliff_eta_days": 0},
    })
    out = _call_endpoint()
    paused = [w for w in out["watchdogs"] if w.get("auto_paused") is True]
    assert len(paused) == 1
    assert paused[0]["key"] == "email_quota_watchdog"
    # Friendly name with no parens — exactly what the FE displays.
    assert "Email quota" in paused[0]["name"]
    # Flag name is surfaced for the operator to know where to re-enable.
    assert paused[0]["flag"] == "outbound_emails_enabled"


def test_banner_finds_zero_paused_when_all_healthy():
    """Default state — no system_health rows at all — should report
    zero paused watchdogs.  Banner renders nothing."""
    out = _call_endpoint()
    paused = [w for w in out["watchdogs"] if w.get("auto_paused") is True]
    assert len(paused) == 0


def test_banner_summary_field_human_readable():
    """The summary blurb is what the banner shows inline ("avg 120/day
    · cliff in 0d"), so it must be present and stringy for paused
    watchdogs that have triggered."""
    _seed({
        "last_check":   "2026-06-27T01:30:00+00:00",
        "auto_paused":  True,
        "last_warning": "critical",
        "last_metrics": {
            "daily_avg_7d":       120,
            "forecast_daily_avg": 140,
            "cliff_eta_days":     0,
            "warning_level":      "critical",
        },
    })
    out = _call_endpoint()
    eq = next(w for w in out["watchdogs"] if w["key"] == "email_quota_watchdog")
    assert eq["summary"]
    assert "120" in eq["summary"]
    assert "cliff in 0d" in eq["summary"]
