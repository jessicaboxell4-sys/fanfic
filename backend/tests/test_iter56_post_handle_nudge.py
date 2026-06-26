"""Iter 56 — Post-handle completeness nudge support.

Verifies that GET /api/auth/me surfaces `library_visible_to_public`
so the frontend nudge in UsersDirectory can drive itself off the
auth context without an extra round-trip.
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


def _register(prefix: str = "iter56") -> tuple[requests.Session, str, str]:
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw!", "name": f"{prefix} user"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text[:200]}"
    data = r.json()
    uid = data.get("user_id") or data.get("user", {}).get("user_id")
    return s, email, uid


def test_auth_me_includes_library_visible_to_public_default_false():
    """A fresh user has library_visible_to_public=false in /auth/me."""
    s, _, _ = _register("iter56default")
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "library_visible_to_public" in body
    assert body["library_visible_to_public"] is False


def test_auth_me_reflects_visibility_after_opt_in():
    """After flipping the public-library flag, /auth/me reflects True."""
    s, _, uid = _register("iter56optin")
    # Directly flip the flag in Mongo — bypasses the modal logic.
    c = _mongo()
    c[_db_name()].users.update_one(
        {"user_id": uid},
        {"$set": {"library_visible_to_public": True}},
    )
    c.close()
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["library_visible_to_public"] is True


def test_auth_me_bio_field_still_present():
    """Regression: bio + library_visible_to_public coexist."""
    s, _, _ = _register("iter56biocheck")
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # Both fields should be present (default empty/false).
    assert "bio" in body
    assert "library_visible_to_public" in body
    assert body["bio"] == ""
    assert body["library_visible_to_public"] is False
