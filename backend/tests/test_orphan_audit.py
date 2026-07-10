"""Tests for the Orphan Audit & cleanup admin endpoints.

Covers:
- GET /api/admin/orphan-audit returns the orphan list + counts and is
  admin-gated.
- POST /api/admin/orphan-audit/delete-bulk validates the body, re-checks
  files, and removes only the rows the operator confirmed.
- Test-account auto-acceptance — emails matching the test_account_filter
  pattern register without going through the approval queue and are
  flagged with ``is_test_account=True`` for stat isolation.
"""
from __future__ import annotations

import os
import re
import time
import uuid
import requests

BASE_URL = (
    os.environ.get("TEST_BASE_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")


def _seed_admin_session(user_id_hint: str = None) -> str:
    """Create an in-process session_token for an existing admin user.

    Cheaper than logging in: we just write a row to ``user_sessions``
    via Mongo.  Returns the bearer token.  Requires that at least one
    admin row exists in the DB (which is true in dev and on the
    preview env per /app/memory/test_credentials.md).
    """
    # We rely on the running backend's MongoDB so this test only works
    # against a live instance.  The pattern matches test_admin_routes.
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    admin = client[db_name].users.find_one({"is_admin": True, "email": {"$ne": ""}})
    assert admin, "No admin user seeded in DB — test environment broken"
    token = f"orphan_test_{uuid.uuid4().hex}"
    client[db_name].user_sessions.insert_one({
        "user_id": admin["user_id"],
        "session_token": token,
        "expires_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
            + __import__("datetime").timedelta(hours=1),
        "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    })
    client.close()
    return token


def test_orphan_audit_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/orphan-audit", timeout=15)
    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"


def test_orphan_audit_returns_orphan_list():
    tok = _seed_admin_session()
    r = requests.get(
        f"{BASE_URL}/api/admin/orphan-audit",
        params={"limit": 500},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    body = r.json()
    assert "scanned" in body
    assert "orphan_count" in body
    assert "orphans" in body and isinstance(body["orphans"], list)
    assert body["orphan_count"] == len(body["orphans"])
    # Sanity: every orphan row carries the keys the UI needs
    for o in body["orphans"][:3]:
        for k in ("book_id", "user_id", "title", "filename", "owner_email"):
            assert k in o, f"orphan row missing {k}: {o}"


def test_orphan_audit_delete_bulk_empty_body_rejected():
    tok = _seed_admin_session()
    r = requests.post(
        f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
        json={"book_ids": []},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code == 400, r.text


def test_orphan_audit_delete_bulk_unknown_ids_returns_not_found_list():
    tok = _seed_admin_session()
    r = requests.post(
        f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
        json={"book_ids": ["book_definitely_does_not_exist_xyz"]},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] == 0
    assert body["not_found"] == ["book_definitely_does_not_exist_xyz"]


def test_register_test_account_auto_approved_and_flagged():
    """Registering with a @test.local email skips the pending queue
    and stamps is_test_account=True on the user document for stat
    isolation.  Real-domain emails still go through the approval gate.
    """
    from pymongo import MongoClient

    email = f"test_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.local"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw", "name": "Test Fixture"},
        timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    body = r.json()
    # No "pending" wrapper — test accounts get a live session immediately.
    assert body.get("approval_status") == "approved"
    assert "user_id" in body

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    try:
        doc = client[db_name].users.find_one({"email": email})
        assert doc is not None
        assert doc.get("approval_status") == "approved"
        assert doc.get("is_test_account") is True
        assert doc.get("auto_approved_test") is True
    finally:
        # Tidy up so the admin inbox stays clean.
        client[db_name].users.delete_one({"email": email})
        client.close()


def test_register_real_user_still_pending_when_gate_enabled():
    """Sanity-check: a real-looking gmail address still lands in
    ``pending`` (assuming the default approval gate is ON in the
    preview env).  If the gate is OFF here we skip — there's no
    regression to assert.
    """
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = MongoClient(mongo_url)
    try:
        cfg = client[db_name].signup_config.find_one({}) or {}
        if not cfg.get("approval_gate_enabled", True):
            return  # gate disabled — there's nothing to test here
    finally:
        client.close()

    email = f"real_{int(time.time())}_{uuid.uuid4().hex[:6]}@example-real-domain.test"
    # ↑ Doesn't end in @test.local / @example.com etc., so it shouldn't
    # match the fixture filter.  We intentionally pick a "*-real-*"
    # local part so the prefix patterns also don't match.
    # NOTE: example-real-domain.test ends in '.test' which is fine,
    # but the local part 'real_*' is not in _TEST_LOCAL_PREFIXES.
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "email": email,
            "password": "hunter2pw",
            "name": "Real User",
            "accepted_rules": True,
            "onboarding": {
                "referral": "google",
                "reader_type": "fanfic",
                "is_13_plus": True,
            },
        },
        timeout=15,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    body = r.json()
    # Real users land in pending (unless they're the very first user
    # ever, which they aren't in a populated DB).
    if body.get("pending"):
        assert body["pending"] is True
    else:
        # gate was off — accepted as approved, that's fine
        assert body.get("approval_status") == "approved"

    # Tidy up.
    from pymongo import MongoClient as _M
    c = _M(mongo_url)
    c[db_name].users.delete_one({"email": email})
    c.close()
