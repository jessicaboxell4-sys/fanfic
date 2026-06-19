"""Regression test for /admin/pending-users/approve-bulk.

Verifies the bulk-approve endpoint:
  - approves only the referral campaign requested (`ref="facebook"`)
  - approves everyone when called with no ref
  - returns sensible counts + user list
  - is idempotent on repeat calls

Uses the live FastAPI backend over HTTP (matches the project's
existing test pattern in test_av_fields.py) and pymongo (sync) for
DB seeding to sidestep Motor's loop-binding issues in pytest.
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Load backend/.env so MONGO_URL/DB_NAME are available outside the
# FastAPI process (pytest doesn't auto-load it).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
# Also pull REACT_APP_BACKEND_URL from the frontend so tests use the
# public preview URL — the same path the frontend takes — instead of
# localhost (which isn't always reachable inside this pod).
load_dotenv(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"


@pytest.fixture(scope="module")
def admin_session():
    """Login as the seeded tester, temporarily promote to admin for the module."""
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.users.update_one({"email": EMAIL}, {"$set": {"is_admin": True}})

    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    yield s

    db.users.update_one({"email": EMAIL}, {"$set": {"is_admin": False}})


def _seed_pending(count: int, referral: str | None) -> list[str]:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    ids: list[str] = []
    docs = []
    now = datetime.now(timezone.utc).isoformat()
    for _ in range(count):
        uid = f"user_bulkfx_{uuid.uuid4().hex[:10]}"
        ids.append(uid)
        # NOT a test domain — ``@bulkfx.zzz`` avoids the test_account_filter.
        doc = {
            "user_id": uid,
            "email": f"{uid}@bulkfx.zzz",
            "name": uid,
            "password_hash": "x",
            "is_admin": False,
            "approval_status": "pending",
            "created_at": now,
        }
        if referral:
            doc["onboarding"] = {"referral": referral}
        docs.append(doc)
    db.users.insert_many(docs)
    return ids


def _cleanup(ids: list[str]):
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.users.delete_many({"user_id": {"$in": ids}})


def test_bulk_approve_by_ref_only_approves_that_campaign(admin_session):
    fb_ids = _seed_pending(3, "facebook")
    rd_ids = _seed_pending(2, "reddit")
    all_ids = fb_ids + rd_ids
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/admin/pending-users/approve-bulk",
            json={"ref": "facebook"}, timeout=20,
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body["approved"] == 3
        assert body["ref"] == "facebook"

        pending = admin_session.get(f"{BASE_URL}/api/admin/pending-users", timeout=20).json()["users"]
        pending_ids = {u["user_id"] for u in pending}
        assert all(uid in pending_ids for uid in rd_ids), "Reddit users should still be pending"
        assert not any(uid in pending_ids for uid in fb_ids), "Facebook users should be gone from pending"
    finally:
        _cleanup(all_ids)


def test_bulk_approve_no_ref_approves_everyone(admin_session):
    ids = _seed_pending(3, "twitter") + _seed_pending(2, None)
    try:
        r = admin_session.post(
            f"{BASE_URL}/api/admin/pending-users/approve-bulk",
            json={}, timeout=20,
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body["approved"] >= 5  # at least our seeded 5

        pending = admin_session.get(f"{BASE_URL}/api/admin/pending-users", timeout=20).json()["users"]
        pending_ids = {u["user_id"] for u in pending}
        assert not any(uid in pending_ids for uid in ids)
    finally:
        _cleanup(ids)


def test_bulk_approve_idempotent(admin_session):
    """A second call with the same ref should approve 0 (already done)."""
    ids = _seed_pending(2, "tiktok")
    try:
        first = admin_session.post(
            f"{BASE_URL}/api/admin/pending-users/approve-bulk",
            json={"ref": "tiktok"}, timeout=20,
        ).json()
        second = admin_session.post(
            f"{BASE_URL}/api/admin/pending-users/approve-bulk",
            json={"ref": "tiktok"}, timeout=20,
        ).json()
        assert first["approved"] == 2
        assert second["approved"] == 0
    finally:
        _cleanup(ids)
