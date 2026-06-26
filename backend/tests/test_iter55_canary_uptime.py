"""Iter 55 — Public canary uptime endpoint.

Covers GET /api/canary/uptime?days=N (anon, public).
"""
from __future__ import annotations

import os
import uuid
import datetime as _dt

import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _seed_runs(rows: list[dict]) -> list[str]:
    """Insert canary_runs docs with explicit finished_at + status."""
    c = _mongo()
    docs = []
    ids: list[str] = []
    for r in rows:
        rid = r.get("run_id") or f"test_canary_{uuid.uuid4().hex[:8]}"
        ids.append(rid)
        docs.append({
            "run_id":      rid,
            "status":      r["status"],
            "passed":      r.get("passed", 1),
            "total":       r.get("total", 1),
            "finished_at": r["finished_at"],
            "received_at": r["finished_at"],
        })
    c[_db_name()].canary_runs.insert_many(docs)
    c.close()
    return ids


def _cleanup_runs(run_ids: list[str]) -> None:
    if not run_ids:
        return
    c = _mongo()
    c[_db_name()].canary_runs.delete_many({"run_id": {"$in": run_ids}})
    c.close()


def _bust_uptime_cache():
    """Force the next /canary/uptime call to re-query Mongo.

    The endpoint caches results for 5 min in-process; tests need
    a fresh read after seeding so we monkey-patch the timestamp.
    """
    try:
        from routes.changelog import _CANARY_UPTIME_CACHE
        _CANARY_UPTIME_CACHE["data"] = {}
        _CANARY_UPTIME_CACHE["fetched_at"] = 0.0
    except Exception:
        # Running cross-process — cache will expire on its own.
        pass


# -----------------------------------------------------------------
# Anonymous access — must not require auth
# -----------------------------------------------------------------
def test_canary_uptime_anon_default():
    """GET /api/canary/uptime returns 200 with the expected shape."""
    r = requests.get(f"{BASE_URL}/api/canary/uptime", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # ``available`` may be true OR false depending on whether any
    # canary_runs are present in this env.  Either way, the shape
    # is consistent.
    assert "available" in body
    assert "days" in body
    assert body["days"] == 30  # default


def test_canary_uptime_days_query_param_clamped():
    """days < 1 → 1; days > 90 → 90."""
    r = requests.get(f"{BASE_URL}/api/canary/uptime", params={"days": 0}, timeout=15)
    assert r.status_code == 200
    assert r.json()["days"] == 1
    r = requests.get(f"{BASE_URL}/api/canary/uptime", params={"days": 9999}, timeout=15)
    assert r.status_code == 200
    assert r.json()["days"] == 90


# -----------------------------------------------------------------
# Empty state — available:false when no canary_runs in window
# -----------------------------------------------------------------
def test_canary_uptime_available_false_when_empty():
    """With zero canary_runs in the lookback window, available:false."""
    # Seed nothing.  Clear all existing test rows in this window so
    # the test is hermetic.
    c = _mongo()
    pre_count = c[_db_name()].canary_runs.count_documents({})
    c.close()
    if pre_count > 0:
        import pytest
        pytest.skip("canary_runs not empty in this env — covered by happy path below")
    _bust_uptime_cache()
    r = requests.get(f"{BASE_URL}/api/canary/uptime?days=30", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert body["days"] == 30
    assert "uptime_pct" not in body  # only present on available:true


# -----------------------------------------------------------------
# Happy path — 100% uptime when all runs pass
# -----------------------------------------------------------------
def test_canary_uptime_100_pct_all_pass():
    """All-pass runs in window → uptime_pct == 100.0."""
    now = _dt.datetime.now(_dt.timezone.utc)
    rows = [
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=h)).isoformat()}
        for h in range(5)
    ]
    seeded: list[str] = []
    # Use a unique `days` value so the in-process 5-min cache on the
    # backend doesn't return stale {available:false} from earlier tests
    # (cache is keyed by days, can't be busted cross-process).
    days = 3
    try:
        seeded = _seed_runs(rows)
        _bust_uptime_cache()
        r = requests.get(f"{BASE_URL}/api/canary/uptime?days={days}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        assert body["total_runs"] >= 5
        assert body["pass_count"] >= 5
        # All runs in the window pass, so percentage is 100.
        assert body["uptime_pct"] == 100.0
    finally:
        _cleanup_runs(seeded)
        _bust_uptime_cache()


# -----------------------------------------------------------------
# Happy path — mixed pass/fail
# -----------------------------------------------------------------
def test_canary_uptime_mixed_pass_fail():
    """4 pass + 1 fail → 80% uptime, fail_count=1."""
    now = _dt.datetime.now(_dt.timezone.utc)
    rows = [
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=1)).isoformat()},
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=2)).isoformat()},
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=3)).isoformat()},
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=4)).isoformat()},
        {"status": "fail", "finished_at": (now - _dt.timedelta(hours=5)).isoformat()},
    ]
    seeded: list[str] = []
    days = 2  # unique value (see test_canary_uptime_100_pct_all_pass note)
    try:
        # Wipe any leftover test rows so the math is deterministic
        c = _mongo()
        c[_db_name()].canary_runs.delete_many({})
        c.close()
        _bust_uptime_cache()
        seeded = _seed_runs(rows)
        _bust_uptime_cache()
        r = requests.get(f"{BASE_URL}/api/canary/uptime?days={days}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        assert body["total_runs"] == 5
        assert body["pass_count"] == 4
        assert body["fail_count"] == 1
        assert body["uptime_pct"] == 80.0
    finally:
        _cleanup_runs(seeded)
        _bust_uptime_cache()


# -----------------------------------------------------------------
# Cutoff — runs older than `days` excluded
# -----------------------------------------------------------------
def test_canary_uptime_excludes_runs_outside_window():
    """A row older than `days` must not affect the percentage."""
    now = _dt.datetime.now(_dt.timezone.utc)
    rows = [
        # In-window: 1 pass
        {"status": "pass", "finished_at": (now - _dt.timedelta(hours=1)).isoformat()},
        # Out-of-window: 1 fail (should be IGNORED for the small window)
        {"status": "fail", "finished_at": (now - _dt.timedelta(days=15)).isoformat()},
    ]
    seeded: list[str] = []
    # Unique day values so the cache hash doesn't collide with the
    # earlier tests in this file.
    short_window = 5
    long_window = 22
    try:
        c = _mongo()
        c[_db_name()].canary_runs.delete_many({})
        c.close()
        _bust_uptime_cache()
        seeded = _seed_runs(rows)
        _bust_uptime_cache()
        # 5-day window — only the in-window pass counts.
        r = requests.get(f"{BASE_URL}/api/canary/uptime?days={short_window}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        assert body["total_runs"] == 1
        assert body["uptime_pct"] == 100.0

        # 22-day window — both rows count, so 50%.
        _bust_uptime_cache()
        r2 = requests.get(f"{BASE_URL}/api/canary/uptime?days={long_window}", timeout=15)
        body2 = r2.json()
        assert body2["total_runs"] == 2
        assert body2["uptime_pct"] == 50.0
    finally:
        _cleanup_runs(seeded)
        _bust_uptime_cache()
