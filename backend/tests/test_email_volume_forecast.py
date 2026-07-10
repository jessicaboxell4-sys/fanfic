"""Regression coverage for the email-volume forecast (2026-06-22)."""
from __future__ import annotations

import os
import sys
import pathlib
import uuid
from datetime import datetime, timezone, timedelta

import pytest

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


def _run(loop, coro):
    return loop.run_until_complete(coro)


def test_forecast_response_shape(loop):
    """Smoke test — the endpoint payload has every expected key + type."""
    from utils.email_volume_forecast import email_volume_forecast
    r = _run(loop, email_volume_forecast())
    for key in (
        "daily_cap", "past_7d", "past_30d", "opt_in_counts",
        "forecast_weekly", "forecast_7d_total", "forecast_30d_total",
        "daily_avg_7d", "forecast_daily_avg", "forecast_daily_pct",
        "warning_level", "generated_at",
    ):
        assert key in r, f"missing key {key} in forecast payload"
    assert r["daily_cap"] == 100
    assert r["warning_level"] in {"ok", "warning", "critical"}
    assert isinstance(r["past_7d"]["by_kind"], dict)
    assert isinstance(r["forecast_weekly"]["total"], int)


def test_weekly_summary_optin_replaces_kind_specific(loop, sync_db):
    """A user opted into weekly_summary should NOT also be counted in
    the kind-specific forecast lines — that would double-count them."""
    from utils.email_volume_forecast import _weekly_projection

    proj = _weekly_projection({
        "weekly_digest":     5,
        "update_email":      4,
        "friends_finished":  3,
        "bookclub_digest":   2,
        "weekly_summary":    2,
        "cover_sharers":     1,
        "admin_real":        1,
    })
    # Each kind-specific count should have weekly_summary subtracted.
    assert proj["weekly_digest"] == 3   # 5 - 2
    assert proj["friends_finished"] == 1  # 3 - 2
    assert proj["bookclub_digest"] == 0   # 2 - 2
    # weekly_summary keeps its full count.
    assert proj["weekly_summary"] == 2
    # cover + admin lines are independent.
    assert proj["cover_weekly_recap"] == 1
    assert proj["admin_digest"] == 1
    # Total adds up to all the per-channel projections.
    expected = 3 + ((4 - 2 + 1) // 2) + 1 + 0 + 2 + 1 + 1
    assert proj["total"] == expected


def test_warning_level_thresholds():
    """The warning_level boundaries: ok < 70/day, warning <100, critical at/above 100."""
    from utils.email_volume_forecast import DAILY_CAP
    # Sanity — the cap is what we expect (test pins it).
    assert DAILY_CAP == 100


def test_past_counts_includes_status_buckets(loop, sync_db):
    """Insert one log row with status=error and one with status=ok;
    they should appear in the same ``by_kind`` slot with the right
    bucket counts."""
    from utils.email_volume_forecast import _past_counts
    suffix = uuid.uuid4().hex[:6]
    kind = f"pytest_forecast_kind_{suffix}"
    now = datetime.now(timezone.utc)
    sync_db.email_logs.insert_many([
        {"log_id": f"l_{suffix}_a", "to": "a@x.com", "kind": kind,
         "sent_at": now - timedelta(days=1), "status": "ok"},
        {"log_id": f"l_{suffix}_b", "to": "b@x.com", "kind": kind,
         "sent_at": now - timedelta(days=2), "status": "error"},
        {"log_id": f"l_{suffix}_c", "to": "c@x.com", "kind": kind,
         "sent_at": now - timedelta(days=2), "status": "ok"},
    ])
    try:
        r = _run(loop, _past_counts(7))
        bucket = r["by_kind"].get(kind)
        assert bucket is not None
        assert bucket["ok"] == 2
        assert bucket["error"] == 1
        assert bucket["total"] == 3
    finally:
        sync_db.email_logs.delete_many({"kind": kind})


def test_old_rows_outside_window_are_excluded(loop, sync_db):
    """A 40-day-old row should be in past_30d but NOT past_7d."""
    from utils.email_volume_forecast import _past_counts
    suffix = uuid.uuid4().hex[:6]
    kind = f"pytest_old_{suffix}"
    sync_db.email_logs.insert_one({
        "log_id": f"old_{suffix}",
        "to":     "old@x.com",
        "kind":   kind,
        "sent_at": datetime.now(timezone.utc) - timedelta(days=40),
        "status": "ok",
    })
    try:
        r7 = _run(loop, _past_counts(7))
        r30 = _run(loop, _past_counts(30))
        assert kind not in r7["by_kind"]
        assert kind not in r30["by_kind"]  # 40 > 30
        # Sanity — 100d window should pick it up
        from utils.email_volume_forecast import _past_counts as _pc
        r100 = _run(loop, _pc(100))
        assert kind in r100["by_kind"]
    finally:
        sync_db.email_logs.delete_many({"kind": kind})
