"""Iter 54 — Canary throwaway-account cleanup endpoint + sweep helper.

Covers POST /api/admin/canary/cleanup and the underlying
``sweep_canary_accounts`` helper from routes.admin.

What we verify:
- Admin-only gate (non-admin and anon get 401/403).
- Sweep helper matches only ``shelfsort-canary[-_]…@example.com``
  emails older than ``min_age_minutes``.
- Real users (Gmail addresses) and recent canary users are preserved.
- Cascade deletes: books, user_sessions, book_reactions, notifications
  belonging to swept users are removed.
- ``dry_run=true`` returns the match count without writing anything.
"""
from __future__ import annotations

import os
import uuid
import datetime as _dt
import time

import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


# ----- helpers ---------------------------------------------------------
def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _admin_token() -> str:
    c = _mongo()
    admin = c[_db_name()].users.find_one({"is_admin": True, "email": {"$ne": ""}})
    assert admin, "no admin in DB"
    token = f"iter54_admin_{uuid.uuid4().hex}"
    c[_db_name()].user_sessions.insert_one({
        "user_id": admin["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    c.close()
    return token


def _seed_canary_user(email: str, created_minutes_ago: int) -> str:
    """Insert a throwaway canary user with a backdated created_at."""
    uid = f"user_canary_{uuid.uuid4().hex[:10]}"
    created_at = (
        _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=created_minutes_ago)
    ).isoformat()
    c = _mongo()
    c[_db_name()].users.insert_one({
        "user_id":   uid,
        "email":     email,
        "name":      "Canary",
        "created_at": created_at,
        "password_hash": "",
    })
    c.close()
    return uid


def _cleanup_test_users(user_ids: list[str]) -> None:
    """Best-effort teardown — wipe any test rows we created."""
    if not user_ids:
        return
    c = _mongo()
    dbn = _db_name()
    c[dbn].users.delete_many({"user_id": {"$in": user_ids}})
    c[dbn].books.delete_many({"user_id": {"$in": user_ids}})
    c[dbn].user_sessions.delete_many({"user_id": {"$in": user_ids}})
    c[dbn].book_reactions.delete_many({"user_id": {"$in": user_ids}})
    c[dbn].notifications.delete_many({"user_id": {"$in": user_ids}})
    c.close()


# ----- HTTP gate ------------------------------------------------------
def test_canary_cleanup_requires_admin_anon():
    """Anonymous POST → 401."""
    r = requests.post(
        f"{BASE_URL}/api/admin/canary/cleanup",
        json={"min_age_minutes": 60, "dry_run": True},
        timeout=15,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"


def test_canary_cleanup_requires_admin_non_admin():
    """Authenticated non-admin → 403."""
    c = _mongo()
    u = c[_db_name()].users.find_one({"email": "shelfsort-tester@example.com"})
    c.close()
    if not u:
        # Fixture isn't seeded in this preview — skip rather than fail
        # (the anon test above already covers the gate).
        import pytest
        pytest.skip("shelfsort-tester fixture missing")
    token = f"iter54_user_{uuid.uuid4().hex}"
    cc = _mongo()
    cc[_db_name()].user_sessions.insert_one({
        "user_id": u["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    cc.close()
    r = requests.post(
        f"{BASE_URL}/api/admin/canary/cleanup",
        json={"min_age_minutes": 60, "dry_run": True},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"


# ----- happy path: dry-run ---------------------------------------------
def test_canary_cleanup_dry_run_does_not_delete():
    """dry_run=true returns matches but writes nothing."""
    nonce = uuid.uuid4().hex[:6]
    seeded: list[str] = []
    try:
        # Three OLD canary users (created 2 hours ago — > default 60min)
        for i in range(3):
            email = f"shelfsort-canary-{int(time.time())}-{nonce}-{i}@example.com"
            seeded.append(_seed_canary_user(email, created_minutes_ago=120))

        tok = _admin_token()
        r = requests.post(
            f"{BASE_URL}/api/admin/canary/cleanup",
            json={"min_age_minutes": 60, "dry_run": True},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert body["matched"] >= 3, f"expected ≥3 matches, got {body}"
        assert body["deleted_users"] == 0
        assert body["deleted_books"] == 0

        # Verify they're still there
        c = _mongo()
        still_there = c[_db_name()].users.count_documents({"user_id": {"$in": seeded}})
        c.close()
        assert still_there == 3, "dry_run should not delete users"
    finally:
        _cleanup_test_users(seeded)


# ----- happy path: real deletion ---------------------------------------
def test_canary_cleanup_deletes_old_users_and_cascades():
    """dry_run=false deletes matched users + their books/sessions/reactions/notifs."""
    nonce = uuid.uuid4().hex[:6]
    seeded: list[str] = []
    try:
        # Two old canary users + seed books/sessions/reactions/notifs.
        for i in range(2):
            email = f"shelfsort-canary-{int(time.time())}-{nonce}-{i}@example.com"
            uid = _seed_canary_user(email, created_minutes_ago=120)
            seeded.append(uid)
            c = _mongo()
            dbn = _db_name()
            c[dbn].books.insert_one({
                "book_id": f"bk_canary_{nonce}_{i}",
                "user_id": uid,
                "title":   "Canary Book",
                "author":  "QA",
            })
            c[dbn].user_sessions.insert_one({
                "user_id": uid,
                "session_token": f"canary_sess_{uuid.uuid4().hex}",
                "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
                "created_at": _dt.datetime.now(_dt.timezone.utc),
            })
            c[dbn].book_reactions.insert_one({
                "user_id": uid,
                "book_id": f"bk_other_{nonce}_{i}",
                "kind":    "heart",
                "created_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            })
            c[dbn].notifications.insert_one({
                "user_id": uid,
                "kind":    "library_view",
                "created_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "read":    False,
            })
            c.close()

        tok = _admin_token()
        r = requests.post(
            f"{BASE_URL}/api/admin/canary/cleanup",
            json={"min_age_minutes": 60, "dry_run": False},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is False
        assert body["deleted_users"] >= 2, body
        assert body["deleted_books"] >= 2, body
        assert body["deleted_sessions"] >= 2, body
        assert body["deleted_reactions"] >= 2, body
        assert body["deleted_notifications"] >= 2, body

        # Verify users + their books are gone
        c = _mongo()
        dbn = _db_name()
        remaining_u = c[dbn].users.count_documents({"user_id": {"$in": seeded}})
        remaining_b = c[dbn].books.count_documents({"user_id": {"$in": seeded}})
        c.close()
        assert remaining_u == 0, "users should be deleted"
        assert remaining_b == 0, "books should cascade-delete"
    finally:
        _cleanup_test_users(seeded)


# ----- safety: in-flight canary not touched ----------------------------
def test_canary_cleanup_preserves_recent_canary_users():
    """A canary user created 5 minutes ago is NOT deleted with default 60min cutoff."""
    nonce = uuid.uuid4().hex[:6]
    seeded: list[str] = []
    try:
        # One OLD (should delete) + one RECENT (should survive).
        old_email = f"shelfsort-canary-{int(time.time())}-{nonce}-old@example.com"
        new_email = f"shelfsort-canary-{int(time.time())}-{nonce}-new@example.com"
        old_uid = _seed_canary_user(old_email, created_minutes_ago=120)
        new_uid = _seed_canary_user(new_email, created_minutes_ago=5)
        seeded.extend([old_uid, new_uid])

        tok = _admin_token()
        r = requests.post(
            f"{BASE_URL}/api/admin/canary/cleanup",
            json={"min_age_minutes": 60, "dry_run": False},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text

        c = _mongo()
        dbn = _db_name()
        old_still = c[dbn].users.find_one({"user_id": old_uid})
        new_still = c[dbn].users.find_one({"user_id": new_uid})
        c.close()
        assert old_still is None, "old canary user should be deleted"
        assert new_still is not None, "recent canary user (in-flight) must survive"
    finally:
        _cleanup_test_users(seeded)


# ----- safety: real users not touched ----------------------------------
def test_canary_cleanup_preserves_real_users():
    """A non-canary email pattern is never deleted, even if old."""
    nonce = uuid.uuid4().hex[:6]
    real_uid = f"user_realQA_{nonce}"
    canary_uid = ""
    try:
        # Seed a real-looking user (gmail) backdated far past the cutoff.
        c = _mongo()
        dbn = _db_name()
        c[dbn].users.insert_one({
            "user_id":   real_uid,
            "email":     f"realuser_{nonce}@gmail.com",
            "name":      "Real",
            "created_at": (
                _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=10)
            ).isoformat(),
            "password_hash": "",
        })
        c.close()

        # Plus a real canary so the endpoint has something to delete
        canary_uid = _seed_canary_user(
            f"shelfsort-canary-{int(time.time())}-{nonce}@example.com",
            created_minutes_ago=120,
        )

        tok = _admin_token()
        r = requests.post(
            f"{BASE_URL}/api/admin/canary/cleanup",
            json={"min_age_minutes": 60, "dry_run": False},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text

        c = _mongo()
        real_still = c[dbn].users.find_one({"user_id": real_uid})
        canary_still = c[dbn].users.find_one({"user_id": canary_uid})
        c.close()
        assert real_still is not None, "real gmail user must NOT be deleted"
        assert canary_still is None, "canary user should be deleted"
    finally:
        _cleanup_test_users([real_uid, canary_uid])
