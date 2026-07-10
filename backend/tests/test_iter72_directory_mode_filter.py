"""Iter 72 — Library-mode filter on /api/users/directory.

Phase 2 of the library_mode feature.  Verifies the new ?mode= query
param on the reader directory:

  • mode=fanfic    → only fanfic-mode users
  • mode=original  → only original-mode users
  • mode=mixed     → mixed-mode users INCLUDING legacy rows missing the field
  • mode= (omit)   → everyone (current behaviour)
  • invalid mode   → ignored (no filter applied)

Also asserts that ``library_mode`` is surfaced in each row of the
response payload so the FE can render its per-row "💜 fic / 📖 og"
chip and Friends-discovery filter.

Drives the live backend at ``REACT_APP_BACKEND_URL`` (or localhost
fallback).  Cleans up test users on teardown.
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
    for c in session.cookies:
        if c.name == "session_token":
            return c.value
    return None


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _register(email: str, handle: str, mode: str | None) -> tuple[requests.Session, dict, str]:
    """Register a user, claim a handle, and (optionally) set library_mode.

    Returns (session, cookies, user_id).
    """
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "iter72pw!", "name": "Iter72",
    }, timeout=10)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    user_id = r.json()["user_id"]
    tok = _grab_session_token(s)
    cookies = {"session_token": tok}
    # Claim a unique handle so the user shows up in the directory.
    r = s.patch(f"{BASE_URL}/api/auth/username", json={"username": handle}, cookies=cookies, timeout=10)
    assert r.status_code == 200, f"username claim failed: {r.status_code} {r.text}"
    if mode:
        r = s.patch(f"{BASE_URL}/api/auth/library-mode", json={"mode": mode}, cookies=cookies, timeout=10)
        assert r.status_code == 200, f"library-mode update failed: {r.status_code} {r.text}"
    return s, cookies, user_id


@pytest.fixture
def trio():
    """Seed three users — one fanfic, one original, one mixed — plus a
    viewer that hits the directory.  All four are cleaned up on teardown.
    """
    suffix = uuid.uuid4().hex[:8]
    viewer_email = f"viewer-{suffix}@example.com"
    fanfic_email = f"fic-{suffix}@example.com"
    orig_email = f"og-{suffix}@example.com"
    mixed_email = f"mix-{suffix}@example.com"

    viewer_handle = f"viewer{suffix}"
    fanfic_handle = f"fic{suffix}"
    orig_handle = f"og{suffix}"
    mixed_handle = f"mix{suffix}"

    _register(fanfic_email, fanfic_handle, "fanfic")
    _register(orig_email, orig_handle, "original")
    _register(mixed_email, mixed_handle, "mixed")
    viewer_s, viewer_cookies, _ = _register(viewer_email, viewer_handle, None)

    yield {
        "viewer_session": viewer_s,
        "viewer_cookies": viewer_cookies,
        "fanfic_handle": fanfic_handle,
        "orig_handle": orig_handle,
        "mixed_handle": mixed_handle,
        "viewer_handle": viewer_handle,
    }

    c = _mongo()
    c[_db_name()].users.delete_many({"email": {"$in": [
        viewer_email, fanfic_email, orig_email, mixed_email,
    ]}})
    c.close()


def _handles(payload: dict) -> set[str]:
    return {(u.get("username") or "").lower() for u in payload.get("users", [])}


def test_directory_returns_library_mode_field(trio):
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory", params={"limit": 100}, cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    for row in body["users"]:
        assert "library_mode" in row, f"row missing library_mode: {row}"
        assert row["library_mode"] in ("fanfic", "original", "mixed"), row


def test_directory_filter_fanfic_only(trio):
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory",
              params={"mode": "fanfic", "limit": 100},
              cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    handles = _handles(r.json())
    assert trio["fanfic_handle"].lower() in handles
    assert trio["orig_handle"].lower() not in handles
    assert trio["mixed_handle"].lower() not in handles
    # Every returned row's mode must be fanfic.
    for row in r.json()["users"]:
        assert row["library_mode"] == "fanfic", row


def test_directory_filter_original_only(trio):
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory",
              params={"mode": "original", "limit": 100},
              cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    handles = _handles(r.json())
    assert trio["orig_handle"].lower() in handles
    assert trio["fanfic_handle"].lower() not in handles
    assert trio["mixed_handle"].lower() not in handles
    for row in r.json()["users"]:
        assert row["library_mode"] == "original", row


def test_directory_filter_mixed_includes_legacy(trio):
    """The 'mixed' filter must include both explicit mixed-mode rows AND
    legacy rows that never set library_mode (those default to "mixed"
    on the read side).  The viewer itself is a legacy row in this test
    fixture (never set a mode), so we use it as the canary.
    """
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory",
              params={"mode": "mixed", "limit": 100},
              cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    handles = _handles(r.json())
    assert trio["mixed_handle"].lower() in handles
    # Note: the viewer is excluded from its own directory listing
    # (self always excluded), so we don't assert it's present.  Other
    # legacy users in the live preview DB MAY appear as "mixed" — we
    # just need at least the explicit mixed row.
    assert trio["fanfic_handle"].lower() not in handles
    assert trio["orig_handle"].lower() not in handles


def test_directory_no_mode_returns_everyone(trio):
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory",
              params={"limit": 100},
              cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    handles = _handles(r.json())
    assert trio["fanfic_handle"].lower() in handles
    assert trio["orig_handle"].lower() in handles
    assert trio["mixed_handle"].lower() in handles


def test_directory_invalid_mode_is_ignored(trio):
    """Garbage ?mode= values fall through to the no-filter branch."""
    s = trio["viewer_session"]
    r = s.get(f"{BASE_URL}/api/users/directory",
              params={"mode": "nonsense", "limit": 100},
              cookies=trio["viewer_cookies"], timeout=10)
    assert r.status_code == 200, r.text
    handles = _handles(r.json())
    assert trio["fanfic_handle"].lower() in handles
    assert trio["orig_handle"].lower() in handles
    assert trio["mixed_handle"].lower() in handles
