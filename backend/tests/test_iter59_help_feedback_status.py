"""Iteration 59 — Help-page feedback status transitions.

Covers the new PUT /api/admin/feedback/{feedback_id} endpoint and the
`feedback_id` field exposed on GET /api/admin/feedback rows.
"""
from __future__ import annotations

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASS = "AdminSmoke123!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def submitted_feedback(admin_session):
    """Submit a Help-page feedback row as the admin (test) account,
    then retrieve its feedback_id via the include_tests query."""
    unique = f"iter59-help-status-{int(time.time()*1000)}"
    r = admin_session.post(
        f"{BASE_URL}/api/feedback",
        data={"text": unique, "page": "/library"},
        timeout=30,
    )
    assert r.status_code == 200, f"POST /api/feedback failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body.get("ok") is True

    r2 = admin_session.get(
        f"{BASE_URL}/api/admin/feedback",
        params={"status": "open", "include_tests": "true", "limit": 200},
        timeout=30,
    )
    assert r2.status_code == 200, r2.text[:200]
    rows = r2.json().get("rows", [])
    hits = [row for row in rows if row.get("text") == unique]
    assert hits, f"submitted row not found; unique={unique}, rows_len={len(rows)}"
    row = hits[0]
    assert "feedback_id" in row and isinstance(row["feedback_id"], str)
    # ObjectId is 24-char hex.
    assert len(row["feedback_id"]) == 24
    int(row["feedback_id"], 16)  # verifies hex
    # No mongo `_id` leaked.
    assert "_id" not in row
    return {"unique": unique, "feedback_id": row["feedback_id"]}


class TestFeedbackIdExposed:
    def test_feedback_id_is_24char_hex(self, submitted_feedback):
        fid = submitted_feedback["feedback_id"]
        assert len(fid) == 24
        int(fid, 16)


class TestStatusTransitions:
    def test_full_status_cycle(self, admin_session, submitted_feedback):
        fid = submitted_feedback["feedback_id"]
        unique = submitted_feedback["unique"]

        for new_status in ["under_review", "planned", "done", "declined", "open"]:
            r = admin_session.put(
                f"{BASE_URL}/api/admin/feedback/{fid}",
                json={"status": new_status},
                timeout=30,
            )
            assert r.status_code == 200, f"PUT->{new_status} failed: {r.status_code} {r.text[:200]}"
            j = r.json()
            assert j == {"ok": True, "status": new_status}

            # Verify GET on that status includes the row.
            g = admin_session.get(
                f"{BASE_URL}/api/admin/feedback",
                params={"status": new_status, "include_tests": "true", "limit": 200},
                timeout=30,
            )
            assert g.status_code == 200
            found = [row for row in g.json().get("rows", []) if row.get("feedback_id") == fid]
            assert found, f"row not visible under status={new_status}"
            assert found[0].get("text") == unique
            assert found[0].get("status") == new_status


class TestErrorCases:
    def test_invalid_status(self, admin_session, submitted_feedback):
        fid = submitted_feedback["feedback_id"]
        r = admin_session.put(
            f"{BASE_URL}/api/admin/feedback/{fid}",
            json={"status": "bogus"},
            timeout=30,
        )
        assert r.status_code == 400
        assert r.json().get("detail") == "invalid_status"

    def test_invalid_id_shape(self, admin_session):
        r = admin_session.put(
            f"{BASE_URL}/api/admin/feedback/not-an-oid",
            json={"status": "under_review"},
            timeout=30,
        )
        assert r.status_code == 400
        assert r.json().get("detail") == "invalid_id"

    def test_not_found_valid_shape(self, admin_session):
        r = admin_session.put(
            f"{BASE_URL}/api/admin/feedback/000000000000000000000000",
            json={"status": "under_review"},
            timeout=30,
        )
        assert r.status_code == 404
        assert r.json().get("detail") == "not_found"

    def test_requires_admin(self, submitted_feedback):
        # Unauthenticated request should fail (401/403).
        r = requests.put(
            f"{BASE_URL}/api/admin/feedback/{submitted_feedback['feedback_id']}",
            json={"status": "under_review"},
            timeout=30,
        )
        assert r.status_code in (401, 403)
