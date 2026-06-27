"""Iter 75 — Policy: test fixtures separated from real users EVERYWHERE.

Extends the iter-74 separation policy to three more admin lists that
previously surfaced test-account activity inline with real-user
records:

  • GET /api/admin/audit-log
  • GET /api/admin/moderation-log
  • GET /api/admin/antivirus/quarantine

All three honour ``?include_tests=true`` to opt back into the
fixture-inclusive view when debugging.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from pymongo import MongoClient


BASE = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _db():
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))[
        os.environ.get("DB_NAME", "test_database")
    ]


@pytest.fixture
def seeded():
    db = _db()
    suffix = uuid.uuid4().hex[:8]
    admin_id = f"user_iter75A_{suffix}"
    admin_token = f"sess_iter75A_{suffix}_{uuid.uuid4().hex}"
    real_user_id = f"realiter75_{suffix}"            # NOT prefixed user_, NOT @example.com
    fixture_user_id = f"user_iter75fix_{suffix}"     # matches `user_` prefix → test account

    # Admin
    db.users.insert_one({
        "user_id": admin_id,
        "email": f"iter75admin-{suffix}@shelfsort.com",
        "name": "Iter75 Admin", "picture": "",
        "is_admin": True, "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": admin_id, "session_token": admin_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    # Real user (so audit/moderation refs land on a real person)
    db.users.insert_one({
        "user_id": real_user_id, "email": f"realiter75-{suffix}@gmail.com",
        "name": "Real Reader", "picture": "", "is_admin": False,
        "is_test_account": False,
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Fixture user (with the stamp explicitly set — startup migration
    # would set this on restart anyway).
    db.users.insert_one({
        "user_id": fixture_user_id, "email": f"fixtureiter75-{suffix}@example.com",
        "name": "Fixture User", "picture": "", "is_admin": False,
        "is_test_account": True, "auto_approved_test": True,
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    now = datetime.now(timezone.utc)
    real_audit = {"action": "user.approve", "actor_id": admin_id,
                  "target": real_user_id, "ts": now,
                  "_iter75": suffix}
    fix_audit = {"action": "user.approve", "actor_id": admin_id,
                 "target": fixture_user_id, "ts": now,
                 "_iter75": suffix}
    db.admin_audit.insert_one(real_audit)
    db.admin_audit.insert_one(fix_audit)

    # AV quarantine rows — store user_id only (per schema)
    db.av_quarantine.insert_one({
        "ts": now.isoformat(), "user_id": real_user_id,
        "filename": "real.epub", "source": "upload",
        "infected": True, "signature": "Test.Eicar",
        "_iter75": suffix,
    })
    db.av_quarantine.insert_one({
        "ts": now.isoformat(), "user_id": fixture_user_id,
        "filename": "fixture.epub", "source": "upload",
        "infected": True, "signature": "Test.Eicar",
        "_iter75": suffix,
    })

    yield {
        "admin_token": admin_token, "admin_id": admin_id,
        "real_user_id": real_user_id, "fixture_user_id": fixture_user_id,
        "suffix": suffix,
    }

    # Teardown
    db.users.delete_many({"user_id": {"$in": [admin_id, real_user_id, fixture_user_id]}})
    db.user_sessions.delete_many({"user_id": admin_id})
    db.admin_audit.delete_many({"_iter75": suffix})
    db.av_quarantine.delete_many({"_iter75": suffix})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_audit_log_hides_test_targets_by_default(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/audit-log",
        params={"limit": 500, "action_prefix": "user."},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    targets = [e.get("target") for e in r.json()["entries"]]
    assert seeded["real_user_id"] in targets
    assert seeded["fixture_user_id"] not in targets


def test_audit_log_shows_tests_when_opted_in(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/audit-log",
        params={"limit": 500, "action_prefix": "user.", "include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200
    targets = [e.get("target") for e in r.json()["entries"]]
    assert seeded["real_user_id"] in targets
    assert seeded["fixture_user_id"] in targets


def test_moderation_log_hides_test_targets_by_default(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/moderation-log",
        params={"limit": 200, "action": "user.approve"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    targets = [e.get("target") for e in r.json()["entries"]]
    assert seeded["real_user_id"] in targets
    assert seeded["fixture_user_id"] not in targets


def test_av_quarantine_hides_test_user_rows_by_default(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/antivirus/quarantine",
        params={"limit": 500},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    uids = [row.get("user_id") for row in rows]
    assert seeded["real_user_id"] in uids
    assert seeded["fixture_user_id"] not in uids


def test_av_quarantine_shows_tests_when_opted_in(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/antivirus/quarantine",
        params={"limit": 500, "include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200
    uids = [row.get("user_id") for row in r.json()["rows"]]
    assert seeded["real_user_id"] in uids
    assert seeded["fixture_user_id"] in uids
