"""Iter 69 — System Health endpoint surfaces watchdog states.

Verifies the new ``watchdogs`` field on ``GET /api/admin/system-health``
correctly aggregates state from:
  • ``system_health`` collection rows (av_watchdog, email_quota_watchdog)
  • ``/app/memory/canary_status.json``

Drives the endpoint via a direct call to the route function to avoid
the admin-auth dependency wiring overhead.
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


def _seed_watchdog_states():
    c = _mongo()
    db = c[_db_name()]
    db.system_health.update_one(
        {"_id": "av_watchdog"},
        {"$set": {
            "last_check":  "2026-06-27T01:00:00+00:00",
            "last_status": True,
            "auto_paused": False,
        }},
        upsert=True,
    )
    db.system_health.update_one(
        {"_id": "email_quota_watchdog"},
        {"$set": {
            "last_check":   "2026-06-27T01:05:00+00:00",
            "last_warning": "ok",
            "auto_paused":  False,
            "last_metrics": {
                "daily_avg_7d":  47.29,
                "cliff_eta_days": 10,
                "warning_level": "ok",
            },
        }},
        upsert=True,
    )
    c.close()


def _cleanup_watchdog_states():
    c = _mongo()
    c[_db_name()].system_health.delete_many({"_id": {"$in": ["av_watchdog", "email_quota_watchdog"]}})
    c.close()


@pytest.fixture(autouse=True)
def _isolate():
    _cleanup_watchdog_states()
    yield
    _cleanup_watchdog_states()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _call_endpoint():
    """Call the system_health route function directly, bypassing the
    require_admin dep."""
    from routes.admin import system_health as system_health_fn
    fake_user = type("U", (), {"user_id": "test-admin", "is_admin": True})()
    return _run(system_health_fn(user=fake_user))


def test_watchdog_list_returned_with_all_three_entries():
    _seed_watchdog_states()
    out = _call_endpoint()
    assert "watchdogs" in out
    keys = [w["key"] for w in out["watchdogs"]]
    # Order matters in the response but tests should be order-agnostic
    assert "av_watchdog" in keys
    assert "email_quota_watchdog" in keys
    assert "canary_retry" in keys


def test_watchdog_states_match_seeded_data():
    _seed_watchdog_states()
    out = _call_endpoint()
    by_key = {w["key"]: w for w in out["watchdogs"]}
    av = by_key["av_watchdog"]
    eq = by_key["email_quota_watchdog"]
    assert av["auto_paused"] is False
    assert av["flag"] == "uploads_enabled"
    assert av["last_status"] == "up"
    assert eq["auto_paused"] is False
    assert eq["flag"] == "outbound_emails_enabled"
    assert "47.29" in (eq["summary"] or "")
    assert "cliff in 10d" in (eq["summary"] or "")


def test_canary_watchdog_reads_from_status_file():
    _seed_watchdog_states()
    out = _call_endpoint()
    by_key = {w["key"]: w for w in out["watchdogs"]}
    canary = by_key.get("canary_retry")
    assert canary is not None
    # The initial-seed file ships with status="ok"
    assert canary.get("last_status") == "ok"
    assert canary["auto_paused"] is False


def test_missing_watchdog_state_returns_blank_row_not_error():
    """If a watchdog hasn't run yet (fresh install / cleared collection),
    the response still includes a placeholder row so the operator can
    see the watchdog exists even if it hasn't fired."""
    # Don't seed any state.
    out = _call_endpoint()
    by_key = {w["key"]: w for w in out["watchdogs"]}
    assert "av_watchdog" in by_key
    assert by_key["av_watchdog"]["auto_paused"] is False
    assert by_key["av_watchdog"].get("last_check") is None
