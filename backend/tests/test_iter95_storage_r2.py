"""Iter-95 backend tests for /admin/storage/* real R2 sweep.

Consolidated so the expensive R2 scan runs only once (25k objects).
"""
import os
import subprocess
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "rownum-test@example.com"
ADMIN_PASSWORD = "hunter2pw!"

NON_ADMIN_EMAIL = "noadmin-test@example.com"
NON_ADMIN_PASSWORD = "hunter2pw!"

TIMEOUT = 180  # R2 sweep can take a while


def _login_bearer(email, password, register_if_missing=False):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200 and register_if_missing:
        r = s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "Test"}, timeout=30)
        assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    assert r.status_code in (200, 201), f"login failed: {r.status_code} {r.text}"
    token = r.cookies.get("session_token") or s.cookies.get("session_token")
    assert token, f"no session_token cookie: cookies={r.cookies.get_dict()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def admin_session():
    s = _login_bearer(ADMIN_EMAIL, ADMIN_PASSWORD)
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert me.status_code == 200 and me.json().get("is_admin"), f"not admin: {me.text}"
    return s


@pytest.fixture(scope="module")
def nonadmin_session():
    s = _login_bearer(NON_ADMIN_EMAIL, NON_ADMIN_PASSWORD, register_if_missing=True)
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert me.status_code == 200
    assert not me.json().get("is_admin", False), "non-admin user is unexpectedly admin"
    return s


@pytest.fixture(scope="module")
def scan_result(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/admin/storage/orphans/scan", timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


# ---- storage/report ----
def test_report_shape(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/storage/report", timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["backend"] == "r2"
    assert isinstance(data["total_bytes"], int) and data["total_bytes"] > 0
    assert isinstance(data["total_objects"], int) and data["total_objects"] > 0
    assert isinstance(data["est_monthly_cost"], float)
    assert round(data["est_monthly_cost"], 2) == data["est_monthly_cost"]
    assert isinstance(data["top_users"], list) and len(data["top_users"]) <= 10
    for u in data["top_users"]:
        assert set(["user_id", "bytes", "objects"]).issubset(u.keys())
        assert isinstance(u["bytes"], int)
        assert isinstance(u["objects"], int)
    assert isinstance(data["sweep_capped"], bool)


def test_report_requires_admin(nonadmin_session):
    r = nonadmin_session.get(f"{BASE_URL}/api/admin/storage/report", timeout=30)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---- storage/orphans/scan ----
def test_scan_shape(scan_result):
    data = scan_result
    assert data["backend"] == "r2"
    assert isinstance(data["orphans_found"], int)
    assert isinstance(data["bytes_recoverable"], int)
    assert isinstance(data["sample"], list) and len(data["sample"]) <= 5
    for k in data["sample"]:
        assert isinstance(k, str)
    assert isinstance(data["sweep_capped"], bool)


def test_scan_persists_mongo_doc(scan_result):
    out = subprocess.run(
        ["mongosh", "mongodb://localhost:27017/test_database", "--quiet", "--eval",
         "const d=db.storage_orphan_scans.findOne({_id:'latest'}); print(JSON.stringify({has:!!d, keys:Array.isArray(d && d.orphan_keys), scanned_at:!!(d && d.scanned_at), bytes:typeof (d && d.bytes_recoverable)}));"],
        check=False, capture_output=True, text=True,
    )
    stdout = out.stdout
    assert '"has":true' in stdout, f"mongo doc missing: {stdout}"
    assert '"keys":true' in stdout
    assert '"scanned_at":true' in stdout
    assert '"bytes":"number"' in stdout or '"bytes":"object"' in stdout, f"bytes_recoverable missing/wrong type: {stdout}"


def test_scan_requires_admin(nonadmin_session):
    r = nonadmin_session.post(f"{BASE_URL}/api/admin/storage/orphans/scan", timeout=30)
    assert r.status_code in (401, 403)


# ---- storage/orphans/purge (only pre-scan short-circuit) ----
def test_purge_without_scan_returns_zero(admin_session):
    subprocess.run(
        ["mongosh", "mongodb://localhost:27017/test_database", "--quiet", "--eval",
         "db.storage_orphan_scans.deleteOne({_id:'latest'})"],
        check=False, capture_output=True,
    )
    r = admin_session.post(f"{BASE_URL}/api/admin/storage/orphans/purge", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["purged"] == 0
    assert data["bytes_freed"] == 0
    assert "No pending orphan scan" in (data.get("note") or "")


def test_purge_requires_admin(nonadmin_session):
    r = nonadmin_session.post(f"{BASE_URL}/api/admin/storage/orphans/purge", timeout=30)
    assert r.status_code in (401, 403)
