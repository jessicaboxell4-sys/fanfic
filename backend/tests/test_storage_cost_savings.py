"""Tests for the R2 storage cost-savings rollup.

Endpoint: GET /api/admin/storage-cost-savings
Renders the "$ X saved this month" line on the R2 migration-complete
banner.  Verifies the math is internally consistent (R2 < Emergent
when storage is non-empty, savings_pct in [0, 100]) and that the
response includes every field the UI tooltip needs.
"""
from __future__ import annotations

import os
import uuid
import requests

BASE_URL = (
    os.environ.get("TEST_BASE_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")


def _admin_token() -> str:
    from pymongo import MongoClient
    import datetime as _dt
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    admin = c[db_name].users.find_one({"is_admin": True, "email": {"$ne": ""}})
    assert admin, "No admin user available for test"
    token = f"savings_test_{uuid.uuid4().hex}"
    c[db_name].user_sessions.insert_one({
        "user_id": admin["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    c.close()
    return token


def test_cost_savings_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/storage-cost-savings", timeout=15)
    assert r.status_code in (401, 403)


def test_cost_savings_shape_and_math():
    tok = _admin_token()
    r = requests.get(
        f"{BASE_URL}/api/admin/storage-cost-savings",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    # Every field the tooltip needs.
    for k in (
        "total_bytes", "total_gb", "monthly_egress_gb",
        "rates", "emergent_estimated", "r2_estimated",
        "savings_usd", "savings_pct",
    ):
        assert k in body, f"missing {k}"

    # Rates expose the underlying constants.
    for k in (
        "emergent_storage_per_gb", "emergent_egress_per_gb",
        "r2_storage_per_gb", "r2_egress_per_gb", "egress_multiplier",
        "egress_multiplier_is_override",
    ):
        assert k in body["rates"], f"rates missing {k}"

    # Storage * rate math is internally consistent.
    rates = body["rates"]
    total_gb = body["total_gb"]
    emergent = body["emergent_estimated"]
    r2 = body["r2_estimated"]

    expected_emergent_storage = round(total_gb * rates["emergent_storage_per_gb"], 4)
    assert abs(emergent["storage_usd"] - expected_emergent_storage) < 0.001

    expected_r2_storage = round(total_gb * rates["r2_storage_per_gb"], 4)
    assert abs(r2["storage_usd"] - expected_r2_storage) < 0.001

    # R2 is always cheaper than Emergent for non-zero libraries.
    if total_gb > 0:
        assert r2["total_usd"] <= emergent["total_usd"], \
            "R2 should be cheaper than Emergent for non-empty libraries"

    # Savings percent in valid range.
    assert 0 <= body["savings_pct"] <= 100
    # Savings $ is never negative — the endpoint clamps to 0.
    assert body["savings_usd"] >= 0


def test_egress_multiplier_runtime_override():
    """Admin can tune the multiplier without a redeploy.

    Verifies the full round-trip: set → reflected on the savings
    endpoint → clear → reverts to env default.
    """
    tok = _admin_token()
    h = {"Authorization": f"Bearer {tok}"}

    # Set to a recognisable value.
    r1 = requests.post(
        f"{BASE_URL}/api/admin/storage-cost-savings/multiplier",
        json={"multiplier": 7.5},
        headers=h, timeout=15,
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["multiplier"] == 7.5
    assert r1.json()["is_override"] is True

    # Confirm the savings endpoint now uses the override.
    r2 = requests.get(
        f"{BASE_URL}/api/admin/storage-cost-savings", headers=h, timeout=15,
    )
    rates = r2.json()["rates"]
    assert rates["egress_multiplier"] == 7.5
    assert rates["egress_multiplier_is_override"] is True

    # Clear the override — reverts to env default.
    r3 = requests.post(
        f"{BASE_URL}/api/admin/storage-cost-savings/multiplier",
        json={"multiplier": None},
        headers=h, timeout=15,
    )
    assert r3.status_code == 200, r3.text
    assert r3.json()["is_override"] is False

    # Out-of-range value is rejected.
    r4 = requests.post(
        f"{BASE_URL}/api/admin/storage-cost-savings/multiplier",
        json={"multiplier": 999},
        headers=h, timeout=15,
    )
    assert r4.status_code == 400
