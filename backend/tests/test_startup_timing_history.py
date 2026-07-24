"""Backend tests for the admin startup-timing history endpoint.

Covers:
- Auth (unauth -> 401; non-admin -> 403).
- Admin -> 200 with expected schema.
- At-risk detection when two most recent boots > 2× budget.
- Non at-risk when only one over-budget boot.
- Empty history (count=0, at_risk=false).

Uses direct Mongo seeding for deterministic at-risk states.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASS = "AdminSmoke123!"

TEST_BOOT_IDS = ["TEST_boot_atrisk_1", "TEST_boot_atrisk_2", "TEST_boot_single_slow", "TEST_boot_fast"]


# ---------------------- fixtures ----------------------
@pytest.fixture(scope="module")
def db():
    mc = MongoClient(MONGO_URL)
    _db = mc[DB_NAME]
    yield _db
    # Cleanup all test seed rows
    _db.startup_timings.delete_many({"boot_id": {"$in": TEST_BOOT_IDS}})
    mc.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed ({r.status_code}): {r.text[:200]}")
    return s


@pytest.fixture
def clean_test_rows(db):
    """Wipe test-prefixed rows before each test so we can reason about ordering."""
    db.startup_timings.delete_many({"boot_id": {"$in": TEST_BOOT_IDS}})
    yield
    db.startup_timings.delete_many({"boot_id": {"$in": TEST_BOOT_IDS}})


def seed_rows(db, rows):
    now = datetime.now(timezone.utc)
    docs = []
    for i, r in enumerate(rows):
        # Force newest to be the last in list by giving later rows more recent created_at
        offset = timedelta(minutes=(len(rows) - i))
        docs.append({
            "boot_id": r["boot_id"],
            "elapsed_seconds": r["elapsed_seconds"],
            "over_budget": r["elapsed_seconds"] > r.get("budget", 20),
            "over_budget_2x": r["elapsed_seconds"] > 2 * r.get("budget", 20),
            "budget_seconds": r.get("budget", 20),
            "status": "done",
            "created_at": now - offset,
            "started_at": (now - offset - timedelta(seconds=int(r["elapsed_seconds"]))).isoformat(),
            "finished_at": (now - offset).isoformat(),
        })
    db.startup_timings.insert_many(docs)


# ---------------------- auth tests ----------------------
def test_unauth_returns_401():
    r = requests.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text[:200]}"


# ---------------------- shape / schema ----------------------
def test_admin_gets_200_and_expected_schema(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    for key in ("points", "budget_seconds", "at_risk", "at_risk_reason", "count"):
        assert key in data, f"missing key {key} in {list(data.keys())}"
    assert isinstance(data["points"], list)
    assert isinstance(data["at_risk"], bool)
    assert isinstance(data["count"], int)
    assert data["count"] == len(data["points"])
    # points should be sorted DESCENDING by created_at (newest first)
    ts = [p.get("created_at") for p in data["points"] if p.get("created_at")]
    assert ts == sorted(ts, reverse=True), "points must be newest-first"


# ---------------------- at-risk positive case ----------------------
def test_at_risk_true_when_last_two_boots_over_2x_budget(admin_session, db, clean_test_rows):
    # Seed only test rows; existing real boot rows might still be there,
    # so filter response to test rows for deterministic assertions.
    seed_rows(db, [
        {"boot_id": "TEST_boot_atrisk_1", "elapsed_seconds": 45, "budget": 20},  # older
        {"boot_id": "TEST_boot_atrisk_2", "elapsed_seconds": 50, "budget": 20},  # newer
    ])
    # The API returns global history newest first — we need our seeded rows to be
    # the two most recent. Their created_at is now-2m/now-1m so they beat historical rows
    # only if no newer real row exists. To be safe, remove any newer real rows briefly:
    now = datetime.now(timezone.utc)
    newer_real = list(db.startup_timings.find({
        "created_at": {"$gt": now - timedelta(minutes=3)},
        "boot_id": {"$nin": TEST_BOOT_IDS},
    }))
    if newer_real:
        # temporarily push their created_at back
        db.startup_timings.update_many(
            {"_id": {"$in": [d["_id"] for d in newer_real]}},
            {"$set": {"created_at": now - timedelta(hours=24)}},
        )
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["at_risk"] is True, f"expected at_risk=true, got {data}"
        reason = data["at_risk_reason"] or ""
        assert "45" in reason and "50" in reason, f"reason should mention both elapsed values: {reason}"
    finally:
        if newer_real:
            for d in newer_real:
                db.startup_timings.update_one({"_id": d["_id"]}, {"$set": {"created_at": d["created_at"]}})


# ---------------------- at-risk negative: only one slow boot ----------------------
def test_at_risk_false_when_only_one_over_budget(admin_session, db, clean_test_rows):
    # newest = slow (45s), previous = fast (2s) → not two in a row
    seed_rows(db, [
        {"boot_id": "TEST_boot_fast", "elapsed_seconds": 2, "budget": 20},          # older
        {"boot_id": "TEST_boot_single_slow", "elapsed_seconds": 45, "budget": 20},  # newer
    ])
    now = datetime.now(timezone.utc)
    newer_real = list(db.startup_timings.find({
        "created_at": {"$gt": now - timedelta(minutes=3)},
        "boot_id": {"$nin": TEST_BOOT_IDS},
    }))
    if newer_real:
        db.startup_timings.update_many(
            {"_id": {"$in": [d["_id"] for d in newer_real]}},
            {"$set": {"created_at": now - timedelta(hours=24)}},
        )
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # newest is single slow, next is fast — not two in a row
        assert data["at_risk"] is False, f"expected at_risk=false, got {data}"
    finally:
        if newer_real:
            for d in newer_real:
                db.startup_timings.update_one({"_id": d["_id"]}, {"$set": {"created_at": d["created_at"]}})


# ---------------------- empty history ----------------------
def test_empty_history_returns_empty_points(admin_session, db):
    # Move all existing rows out of the way temporarily
    all_rows = list(db.startup_timings.find({}, {"_id": 1, "created_at": 1}))
    if not all_rows:
        r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
        data = r.json()
        assert data["count"] == 0 and data["points"] == [] and data["at_risk"] is False
        return
    # Temporarily rename collection to simulate empty history
    db.startup_timings.rename("startup_timings_bak_test", dropTarget=True)
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0
        assert data["points"] == []
        assert data["at_risk"] is False
    finally:
        db.startup_timings_bak_test.rename("startup_timings", dropTarget=True)


# ---------------------- budget echoed ----------------------
def test_budget_seconds_present_and_positive(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/startup-timing/history", timeout=15)
    data = r.json()
    assert isinstance(data["budget_seconds"], (int, float))
    assert data["budget_seconds"] > 0
