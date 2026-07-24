"""Iter 115 — batch-stats telemetry endpoints regression test.

Covers:
- POST /api/upload-jobs/batch-stats requires auth
- POST is idempotent by batch_id (second POST returns ok, no dup)
- GET /api/admin/upload-jobs/batch-stats requires admin auth
- GET returns rows/trend/summary shape
"""
import os
import time
import uuid
import requests
import pytest

def _read_frontend_env_url():
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env_url() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL is not set"
ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"

TEST_BATCH_PREFIX = "test-audit-iter115-"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def created_batch_ids():
    ids = []
    yield ids
    # cleanup handled via a raw mongo delete would require db access; skip.
    # We use unique prefix so admin can identify+delete manually if needed.


def _payload(batch_id):
    now_ms = int(time.time() * 1000)
    return {
        "batch_id": batch_id,
        "started_at": now_ms - 60000,
        "finished_at": now_ms,
        "duration_ms": 60000,
        "total_files": 3,
        "succeeded": 2,
        "failed": 1,
        "transient_retries": 1,
        "throttled_events": 0,
        "ramp_events": 1,
        "peak_concurrency": 3,
        "min_concurrency_after_start": 2,
        "failure_reasons": [{"reason": "transient_5xx", "count": 1}],
        "airdrop_mode": False,
    }


def test_post_batch_stats_requires_auth():
    r = requests.post(f"{BASE_URL}/api/upload-jobs/batch-stats", json=_payload(TEST_BATCH_PREFIX + "noauth-" + uuid.uuid4().hex[:6]), timeout=10)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_get_admin_batch_stats_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/upload-jobs/batch-stats?days=7", timeout=10)
    assert r.status_code in (401, 403)


def test_post_batch_stats_authed(admin_session, created_batch_ids):
    bid = TEST_BATCH_PREFIX + uuid.uuid4().hex[:8]
    created_batch_ids.append(bid)
    r = admin_session.post(f"{BASE_URL}/api/upload-jobs/batch-stats", json=_payload(bid), timeout=15)
    assert r.status_code == 200, r.text[:300]
    assert r.json().get("ok") is True


def test_post_batch_stats_idempotent(admin_session, created_batch_ids):
    bid = TEST_BATCH_PREFIX + "idem-" + uuid.uuid4().hex[:8]
    created_batch_ids.append(bid)
    p = _payload(bid)
    r1 = admin_session.post(f"{BASE_URL}/api/upload-jobs/batch-stats", json=p, timeout=15)
    assert r1.status_code == 200
    # Change values on second POST — first-write-wins should ignore
    p2 = dict(p)
    p2["succeeded"] = 99
    r2 = admin_session.post(f"{BASE_URL}/api/upload-jobs/batch-stats", json=p2, timeout=15)
    assert r2.status_code == 200
    assert r2.json().get("ok") is True


def test_get_admin_batch_stats_shape(admin_session, created_batch_ids):
    r = admin_session.get(f"{BASE_URL}/api/admin/upload-jobs/batch-stats?days=7", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "rows" in data and isinstance(data["rows"], list)
    assert "trend" in data and isinstance(data["trend"], list)
    assert "summary" in data and isinstance(data["summary"], dict)
    s = data["summary"]
    for k in ("batches", "files", "failed", "failure_rate", "window_days"):
        assert k in s, f"missing summary key: {k}"
    assert s["window_days"] == 7

    # Verify idempotent write took effect only once — find our idem batch
    idem_rows = [row for row in data["rows"] if row.get("batch_id", "").startswith(TEST_BATCH_PREFIX + "idem-")]
    if idem_rows:
        # First-write-wins: succeeded should still be 2, not 99
        assert idem_rows[0]["succeeded"] == 2, f"idempotency broken: {idem_rows[0]}"


def test_get_admin_batch_stats_windows(admin_session):
    for days in (1, 30, 90):
        r = admin_session.get(f"{BASE_URL}/api/admin/upload-jobs/batch-stats?days={days}", timeout=15)
        assert r.status_code == 200
        assert r.json()["summary"]["window_days"] == days
