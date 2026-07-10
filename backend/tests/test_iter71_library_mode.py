"""Iter 71 — Library mode preference round-trip.

Verifies the new ``user.library_mode`` field:
  • Defaults to "mixed" for users who haven't set it
  • Surfaces correctly on ``GET /api/auth/me``
  • Can be updated via ``PATCH /api/auth/library-mode``
  • Rejects invalid mode values with 422
  • Is persisted across subsequent ``/auth/me`` calls

Drives the live backend; cleans up the test user on teardown.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _grab_session_token(session: requests.Session) -> str | None:
    """Get the most recent ``session_token`` cookie regardless of the
    ``Secure`` flag attached to it.

    Why this exists: the backend sets the cookie with ``Secure=True``
    in production (HTTPS only).  ``requests.Session`` correctly
    refuses to *send* a Secure cookie back over HTTP.  These tests
    intentionally hit localhost over HTTP (faster + no DNS round-trip
    flakiness), so we sidestep the Secure-flag check by reading the
    raw cookie value and passing it explicitly in subsequent requests.
    """
    for c in session.cookies:
        if c.name == "session_token":
            return c.value
    return None


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


@pytest.fixture
def session():
    """Register a fresh test user and return an authenticated requests.Session.

    Yields a tuple ``(session, email, cookies)``.  ``cookies`` is a dict
    you must pass explicitly to every follow-up call (e.g.
    ``s.get(url, cookies=cookies)``) because the cookie was set with
    ``Secure=True`` and we're talking to localhost over HTTP.  See
    ``_grab_session_token`` for the rationale.
    """
    email = f"lib-mode-{uuid.uuid4().hex[:8]}@example.com"
    pwd = "libmode123!"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": pwd, "name": "LibMode Tester",
    }, timeout=10)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    tok = _grab_session_token(s)
    assert tok, "register did not return a session_token cookie"
    cookies = {"session_token": tok}
    yield s, email, cookies
    # cleanup
    c = _mongo()
    c[_db_name()].users.delete_many({"email": email})
    c.close()


def test_library_mode_defaults_to_mixed_on_fresh_account(session):
    s, _, cookies = session
    r = s.get(f"{BASE_URL}/api/auth/me", cookies=cookies, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json().get("library_mode") == "mixed"


def test_library_mode_updates_round_trip(session):
    s, _, cookies = session
    # Update to "fanfic"
    r = s.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": "fanfic"}, cookies=cookies, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "library_mode": "fanfic"}
    # Verify on next /auth/me
    r = s.get(f"{BASE_URL}/api/auth/me", cookies=cookies, timeout=10)
    assert r.json().get("library_mode") == "fanfic"
    # Switch to "original"
    s.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": "original"}, cookies=cookies, timeout=10)
    r = s.get(f"{BASE_URL}/api/auth/me", cookies=cookies, timeout=10)
    assert r.json().get("library_mode") == "original"
    # Switch back to "mixed"
    s.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": "mixed"}, cookies=cookies, timeout=10)
    r = s.get(f"{BASE_URL}/api/auth/me", cookies=cookies, timeout=10)
    assert r.json().get("library_mode") == "mixed"


@pytest.mark.parametrize("bad", ["fancy", "FANFIC", "", "fanfic ", " fanfic", "fanfiction", "all"])
def test_library_mode_rejects_invalid_values(session, bad):
    s, _, cookies = session
    r = s.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": bad}, cookies=cookies, timeout=10)
    # Case-insensitive normalization: "FANFIC" / " fanfic" / "fanfic "
    # should normalize via .strip().lower() and pass.
    expected = bad.strip().lower() in {"fanfic", "original", "mixed"}
    if expected:
        assert r.status_code == 200, f"'{bad}' should have been accepted: {r.text}"
    else:
        assert r.status_code in (422, 400), f"'{bad}' should have been rejected: {r.text}"


def test_library_mode_requires_auth():
    """Anonymous requests must not be able to set someone else's library_mode."""
    r = requests.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": "fanfic"}, timeout=10)
    assert r.status_code in (401, 403), f"unexpected: {r.status_code}"
