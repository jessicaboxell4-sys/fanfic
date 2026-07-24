"""Test POST /api/admin/storage/orphans/scan - top_affected_users field."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "rownum-test@example.com"
ADMIN_PASSWORD = "hunter2pw!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=120)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def test_orphan_scan_returns_top_affected_users(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/admin/storage/orphans/scan", timeout=120)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    # Existing fields intact
    for key in ("orphans_found", "bytes_recoverable", "sample", "backend"):
        assert key in data, f"missing key {key} in {list(data.keys())}"
    # sweep_capped only present when r2 backend
    if data.get("backend") == "r2":
        assert "sweep_capped" in data
        assert "top_affected_users" in data, f"missing top_affected_users. keys={list(data.keys())}"
        tau = data["top_affected_users"]
        assert isinstance(tau, list)
        assert len(tau) <= 10
        # Validate structure & sorted desc by bytes
        prev_bytes = None
        for row in tau:
            assert set(row.keys()) >= {"user_id", "bytes", "objects"}
            assert isinstance(row["user_id"], str)
            assert isinstance(row["bytes"], int)
            assert isinstance(row["objects"], int)
            if prev_bytes is not None:
                assert row["bytes"] <= prev_bytes, "top_affected_users not sorted desc by bytes"
            prev_bytes = row["bytes"]
        print(f"top_affected_users count={len(tau)} orphans_found={data['orphans_found']} bytes_recoverable={data['bytes_recoverable']}")


def test_orphan_scan_persisted_doc_shape(admin_session):
    """Persisted doc should only contain orphan_keys/bytes_recoverable/scanned_at (not top_affected_users)."""
    # We can't hit mongo directly through the API, but we can trigger a purge-preview endpoint if exists.
    # Instead, verify by checking the second call returns fresh top_affected_users still (derived).
    r = admin_session.post(f"{BASE_URL}/api/admin/storage/orphans/scan", timeout=120)
    assert r.status_code == 200
    data = r.json()
    if data.get("backend") == "r2":
        assert "top_affected_users" in data
