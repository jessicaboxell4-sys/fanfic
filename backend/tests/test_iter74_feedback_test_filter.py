"""Iter 74 — Admin Feedback/Suggestion inbox: test-fixture separation.

Verifies that test-fixture rows (submitted by @example.com / user_*
agent accounts) are hidden by default from both the Suggestions board
admin view and the Help-page feedback admin view, but still visible
when ``include_tests=true`` is passed.

Endpoints under test:
  • GET /api/suggestions                (Suggestions board list)
  • GET /api/admin/suggestions/open-count
  • GET /api/admin/feedback             (Help-page feedback list)
  • GET /api/admin/feedback/by-page     (Help-page friction roll-up)

Seeded data:
  • 1 real-user suggestion + 1 test-fixture suggestion
  • 1 real-user help-feedback + 1 test-fixture help-feedback
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


def _mongo():
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db():
    return _mongo()[os.environ.get("DB_NAME", "test_database")]


@pytest.fixture
def seeded():
    """Insert four rows directly into Mongo with controllable emails.

    Bypasses the HTTP endpoints (which would re-derive submitter info
    from the authenticated user) so we can pin the exact ``submitter_email``
    / ``user_email`` values that drive the filter.  Also seeds an admin
    session token so the admin-only endpoints accept us.
    """
    db = _db()
    suffix = uuid.uuid4().hex[:8]
    admin_id = f"user_iter74A_{suffix}"
    admin_token = f"sess_iter74A_{suffix}_{uuid.uuid4().hex}"
    real_sid = f"sug_real_{suffix}"
    fixture_sid = f"sug_fix_{suffix}"
    real_email = f"real-iter74-{suffix}@gmail.com"          # real user
    fixture_email = f"fixture-iter74-{suffix}@example.com"  # test fixture

    db.users.insert_one({
        "user_id": admin_id,
        "email": f"iter74admin-{suffix}@shelfsort.com",
        "name": "Iter74 Admin", "picture": "",
        "is_admin": True, "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": admin_id, "session_token": admin_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    now = datetime.now(timezone.utc)
    # Suggestions-board rows
    db.suggestions.insert_one({
        "suggestion_id": real_sid,
        "title": "Real user request — please add dark mode toggle to navbar",
        "body": "real user reporting actual feedback",
        "category": "feature",
        "status": "open",
        "submitter_user_id": f"user_real_{suffix}",
        "submitter_name": "Real User",
        "submitter_email": real_email,
        "voters": [],
        "created_at": now, "updated_at": now,
    })
    db.suggestions.insert_one({
        "suggestion_id": fixture_sid,
        "title": "TEST_iter74_fixture_should_be_hidden",
        "body": "agent integration test fixture row",
        "category": "feature",
        "status": "open",
        "submitter_user_id": f"user_fix_{suffix}",
        "submitter_name": "Fix Fixture",
        "submitter_email": fixture_email,
        "voters": [],
        "created_at": now, "updated_at": now,
    })
    # Help-page feedback rows (different schema — `text`, `user_email`)
    db.suggestions.insert_one({
        "text": "Real friction report — help search misses 'opds'",
        "page": "/help",
        "status": "open",
        "user_id": f"user_real_{suffix}",
        "user_email": real_email,
        "ts": now.isoformat(),
    })
    db.suggestions.insert_one({
        "text": "TEST_iter74 helpfeedback fixture text",
        "page": "/help",
        "status": "open",
        "user_id": f"user_fix_{suffix}",
        "user_email": fixture_email,
        "ts": now.isoformat(),
    })

    yield {
        "admin_token": admin_token,
        "admin_id": admin_id,
        "real_sid": real_sid,
        "fixture_sid": fixture_sid,
        "real_email": real_email,
        "fixture_email": fixture_email,
    }

    # Teardown
    db.suggestions.delete_one({"suggestion_id": real_sid})
    db.suggestions.delete_one({"suggestion_id": fixture_sid})
    db.suggestions.delete_many({"user_email": {"$in": [real_email, fixture_email]}})
    db.users.delete_one({"user_id": admin_id})
    db.user_sessions.delete_one({"session_token": admin_token})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_suggestions_board_hides_test_rows_by_default(seeded):
    """GET /api/suggestions excludes @example.com submitters by default."""
    import requests
    r = requests.get(f"{BASE}/api/suggestions", headers=_auth(seeded["admin_token"]), timeout=15)
    assert r.status_code == 200, r.text
    sids = [s["suggestion_id"] for s in r.json()["suggestions"]]
    assert seeded["real_sid"] in sids, "real-user suggestion must be visible"
    assert seeded["fixture_sid"] not in sids, "fixture suggestion must be hidden by default"


def test_suggestions_board_shows_test_rows_when_requested(seeded):
    """GET /api/suggestions?include_tests=true includes them again."""
    import requests
    r = requests.get(
        f"{BASE}/api/suggestions",
        params={"include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    sids = [s["suggestion_id"] for s in r.json()["suggestions"]]
    assert seeded["real_sid"] in sids
    assert seeded["fixture_sid"] in sids


def test_open_count_excludes_test_rows_by_default(seeded):
    """The badge counter must match what the admin actually sees."""
    import requests
    r_default = requests.get(
        f"{BASE}/api/admin/suggestions/open-count",
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    r_with_tests = requests.get(
        f"{BASE}/api/admin/suggestions/open-count",
        params={"include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r_default.status_code == 200
    assert r_with_tests.status_code == 200
    default_count = r_default.json()["open"]
    with_tests_count = r_with_tests.json()["open"]
    # With-tests must be >= default count, and at least the one extra
    # fixture row we seeded must show up.
    assert with_tests_count >= default_count + 1


def test_help_feedback_hides_test_rows_by_default(seeded):
    """GET /api/admin/feedback excludes @example.com submitters by default."""
    import requests
    r = requests.get(f"{BASE}/api/admin/feedback", headers=_auth(seeded["admin_token"]), timeout=15)
    assert r.status_code == 200, r.text
    texts = [row.get("text", "") for row in r.json()["rows"]]
    assert any("Real friction" in t for t in texts), "real user feedback must be visible"
    assert not any("TEST_iter74" in t for t in texts), "fixture feedback must be hidden"


def test_help_feedback_shows_test_rows_when_requested(seeded):
    import requests
    r = requests.get(
        f"{BASE}/api/admin/feedback",
        params={"include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    texts = [row.get("text", "") for row in r.json()["rows"]]
    assert any("Real friction" in t for t in texts)
    assert any("TEST_iter74" in t for t in texts)


def test_help_feedback_by_page_excludes_tests_by_default(seeded):
    """The per-page friction roll-up must mirror the list view's filter."""
    import requests
    r_default = requests.get(
        f"{BASE}/api/admin/feedback/by-page",
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    r_with_tests = requests.get(
        f"{BASE}/api/admin/feedback/by-page",
        params={"include_tests": "true"},
        headers=_auth(seeded["admin_token"]),
        timeout=15,
    )
    assert r_default.status_code == 200
    assert r_with_tests.status_code == 200
    total_default = sum(row.get("count", 0) for row in r_default.json()["rows"])
    total_with = sum(row.get("count", 0) for row in r_with_tests.json()["rows"])
    # The fixture row contributes at least 1 to /help when shown.
    assert total_with >= total_default + 1
