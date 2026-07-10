"""Tests for the test-account friend-request block + admin purge endpoint.

Review request iteration 75.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"


def _login(session: requests.Session, email: str, password: str) -> requests.Response:
    return session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=45,
    )


def _register(session: requests.Session, email: str, password: str, name: str) -> requests.Response:
    return session.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "email": email,
            "password": password,
            "name": name,
            "accepted_rules": True,
            "onboarding": {
                "referral": "friend",
                "favorite_fandom": "sci-fi",
                "reader_type": "casual",
                "is_13_plus": True,
            },
        },
        timeout=45,
    )


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def real_users():
    """Register two fresh non-test users and return (session1, uid1, uid2, email2)."""
    tag = uuid.uuid4().hex[:8]
    e1 = f"real-user-1-{tag}@shelfsort.com"
    e2 = f"real-user-2-{tag}@shelfsort.com"
    pw = "RealUserPass123!"

    s1 = requests.Session()
    r1 = _register(s1, e1, pw, f"Real One {tag}")
    assert r1.status_code in (200, 201), f"register real-1 failed: {r1.status_code} {r1.text}"
    u1 = r1.json().get("user") or r1.json()
    uid1 = u1.get("user_id") or u1.get("id")

    s2 = requests.Session()
    r2 = _register(s2, e2, pw, f"Real Two {tag}")
    assert r2.status_code in (200, 201), f"register real-2 failed: {r2.status_code} {r2.text}"
    u2 = r2.json().get("user") or r2.json()
    uid2 = u2.get("user_id") or u2.get("id")

    return {"s1": s1, "s2": s2, "e1": e1, "e2": e2, "uid1": uid1, "uid2": uid2, "pw": pw}


# ---------- TEST-1: test account is blocked from sending friend requests -------
def test_test_account_blocked_from_sending_friend_request(admin_session):
    r = admin_session.post(
        f"{BASE_URL}/api/friends/request",
        json={"target_email": "real@shelfsort.com"},
        timeout=45,
    )
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
    data = r.json()
    detail = data.get("detail") or data.get("message") or ""
    assert "test account" in detail.lower(), f"unexpected detail: {detail}"


# ---------- TEST-2: real user happy path ---------------------------------------
def test_real_user_can_send_friend_request(real_users):
    r = real_users["s1"].post(
        f"{BASE_URL}/api/friends/request",
        json={"target_email": real_users["e2"]},
        timeout=45,
    )
    assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
    data = r.json()
    assert data.get("status") == "pending", f"expected status=pending got {data}"


# ---------- TEST-3: admin purge endpoint ----------------------------------------
def test_admin_purge_test_account_spam(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/admin/purge-test-account-spam", timeout=30)
    assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
    data = r.json()
    assert data.get("ok") is True
    assert "friendships_deleted" in data
    assert "notifications_deleted" in data
    assert "test_users_considered" in data
    assert isinstance(data["friendships_deleted"], int)
    assert isinstance(data["notifications_deleted"], int)
    assert isinstance(data["test_users_considered"], int)
    assert data["test_users_considered"] > 0, "expected some test users to exist"


# ---------- TEST-4: purge endpoint requires admin ------------------------------
def test_purge_endpoint_requires_auth():
    s = requests.Session()  # no cookie
    r = s.post(f"{BASE_URL}/api/admin/purge-test-account-spam", timeout=45)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text}"


def test_purge_endpoint_rejects_non_admin(real_users):
    r = real_users["s1"].post(f"{BASE_URL}/api/admin/purge-test-account-spam", timeout=45)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text}"
