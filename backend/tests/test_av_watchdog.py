"""Tests for the ClamAV auto-pause watchdog.

Uses the session-wide ``shared_event_loop`` fixture from conftest.py
to avoid Motor's "Future attached to a different loop" footgun.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import pytest
from pymongo import MongoClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from utils import av_watchdog  # noqa: E402
from utils.feature_flags import set_flag, is_enabled, _invalidate_cache  # noqa: E402

mc = MongoClient(os.environ["MONGO_URL"])
sync_db = mc[os.environ["DB_NAME"]]


@pytest.fixture
def admin_seed(shared_event_loop, monkeypatch):
    """Clean slate per test: empty watchdog state, fresh admin user,
    uploads_enabled forced back ON.  Also force AV_WATCHDOG_ENABLED=true
    so we can drive the watchdog even when preview's .env has it off."""
    monkeypatch.setenv("AV_WATCHDOG_ENABLED", "true")
    sync_db.system_health.delete_one({"_id": av_watchdog._STATE_DOC_ID})
    admin_id = f"admin_avw_{uuid.uuid4().hex[:8]}"
    sync_db.users.insert_one({
        "user_id": admin_id, "email": f"{admin_id}@example.com",
        "name": "Watchdog Admin", "is_admin": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    shared_event_loop.run_until_complete(set_flag("uploads_enabled", True))
    _invalidate_cache()
    sync_db.audit_log.delete_many({"actor": "system.av_watchdog"})
    yield admin_id, shared_event_loop
    sync_db.users.delete_one({"user_id": admin_id})
    sync_db.notifications.delete_many({"user_id": admin_id})
    sync_db.audit_log.delete_many({"actor": "system.av_watchdog"})
    sync_db.system_health.delete_one({"_id": av_watchdog._STATE_DOC_ID})
    shared_event_loop.run_until_complete(set_flag("uploads_enabled", True))
    _invalidate_cache()


def test_scanner_up_clears_down_streak(admin_seed):
    _, loop = admin_seed
    # Plant a stale down-streak so we can verify it gets cleared
    sync_db.system_health.update_one(
        {"_id": av_watchdog._STATE_DOC_ID},
        {"$set": {"down_since": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()}},
        upsert=True,
    )
    with patch.object(av_watchdog.antivirus, "is_available", return_value=True):
        result = loop.run_until_complete(av_watchdog.av_health_watchdog_tick())
    assert result["available"] is True
    assert result["down_for_min"] == 0
    doc = sync_db.system_health.find_one({"_id": av_watchdog._STATE_DOC_ID})
    assert doc["down_since"] is None
    _invalidate_cache()
    assert loop.run_until_complete(is_enabled("uploads_enabled")) is True


def test_scanner_down_under_threshold_does_not_pause(admin_seed):
    _, loop = admin_seed
    with patch.object(av_watchdog.antivirus, "is_available", return_value=False):
        result = loop.run_until_complete(av_watchdog.av_health_watchdog_tick())
    assert result["available"] is False
    assert result["auto_paused"] is False
    assert result["down_for_min"] == 0
    _invalidate_cache()
    assert loop.run_until_complete(is_enabled("uploads_enabled")) is True


def test_scanner_down_past_threshold_auto_pauses(admin_seed):
    admin_id, loop = admin_seed
    past = datetime.now(timezone.utc) - timedelta(minutes=av_watchdog.AV_DOWN_THRESHOLD_MIN + 1)
    sync_db.system_health.update_one(
        {"_id": av_watchdog._STATE_DOC_ID},
        {"$set": {"down_since": past.isoformat(), "auto_paused": False}},
        upsert=True,
    )
    with patch.object(av_watchdog.antivirus, "is_available", return_value=False):
        result = loop.run_until_complete(av_watchdog.av_health_watchdog_tick())
    assert result["available"] is False
    assert result["auto_paused"] is True
    assert result["down_for_min"] >= av_watchdog.AV_DOWN_THRESHOLD_MIN
    _invalidate_cache()
    assert loop.run_until_complete(is_enabled("uploads_enabled")) is False
    audit = sync_db.audit_log.find_one({"actor": "system.av_watchdog", "action": "av.auto_pause"})
    assert audit is not None
    assert audit["metadata"]["flag"] == "uploads_enabled"
    notif = sync_db.notifications.find_one({"user_id": admin_id, "kind": "av_auto_pause"})
    assert notif is not None


def test_idempotent_while_already_paused(admin_seed):
    admin_id, loop = admin_seed
    past = datetime.now(timezone.utc) - timedelta(minutes=av_watchdog.AV_DOWN_THRESHOLD_MIN + 5)
    sync_db.system_health.update_one(
        {"_id": av_watchdog._STATE_DOC_ID},
        {"$set": {"down_since": past.isoformat(), "auto_paused": True}},
        upsert=True,
    )
    loop.run_until_complete(set_flag("uploads_enabled", False))
    _invalidate_cache()
    with patch.object(av_watchdog.antivirus, "is_available", return_value=False):
        result = loop.run_until_complete(av_watchdog.av_health_watchdog_tick())
    assert result["auto_paused"] is True
    _invalidate_cache()
    assert loop.run_until_complete(is_enabled("uploads_enabled")) is False
    audit_count = sync_db.audit_log.count_documents({"actor": "system.av_watchdog", "action": "av.auto_pause"})
    assert audit_count == 0
    notif_count = sync_db.notifications.count_documents({"user_id": admin_id, "kind": "av_auto_pause"})
    assert notif_count == 0


def test_watchdog_disabled_via_env(admin_seed, monkeypatch):
    """``AV_WATCHDOG_ENABLED=false`` makes the tick early-return.

    Preview pods set this so the watchdog doesn't auto-pause uploads
    despite clamd never being installed.  In production the var is unset
    (defaults to enabled).
    """
    _admin_id, loop = admin_seed
    monkeypatch.setenv("AV_WATCHDOG_ENABLED", "false")
    # Even with clamd reporting DOWN past the threshold, nothing should
    # happen if the watchdog itself is disabled.
    past = datetime.now(timezone.utc) - timedelta(minutes=av_watchdog.AV_DOWN_THRESHOLD_MIN + 10)
    sync_db.system_health.update_one(
        {"_id": av_watchdog._STATE_DOC_ID},
        {"$set": {"down_since": past.isoformat(), "auto_paused": False}},
        upsert=True,
    )
    with patch.object(av_watchdog.antivirus, "is_available", return_value=False):
        result = loop.run_until_complete(av_watchdog.av_health_watchdog_tick())
    assert result.get("skipped") is True
    _invalidate_cache()
    assert loop.run_until_complete(is_enabled("uploads_enabled")) is True

    audit_count = sync_db.audit_log.count_documents({"actor": "system.av_watchdog", "action": "av.auto_pause"})
    assert audit_count == 0
    notif_count = sync_db.notifications.count_documents({"user_id": _admin_id, "kind": "av_auto_pause"})
    assert notif_count == 0
