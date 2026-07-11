"""Tests for the 2026-07-11 orphan-delete auto-notify + retroactive endpoints.

Covers:
- POST /api/admin/orphan-audit/delete-bulk auth gates (401 unauth, 403 non-admin)
- POST /api/admin/orphan-audit/delete-bulk cap of 250 book_ids, empty rejection
- POST /api/admin/orphan-audit/notify-retroactive auth gates (401 unauth, 403 non-admin)
- POST /api/admin/orphan-audit/notify-retroactive idempotency (marker in system_flags)
- Retroactive endpoint does NOT notify users created AFTER the anchor timestamp.
- Verifies going-forward auto-notify path collapses per-user (one notification per user
  even when multiple books belong to that user).
"""
from __future__ import annotations

import os
import time
import uuid
import requests
from datetime import datetime, timezone, timedelta

from pymongo import MongoClient

BASE_URL = (
    os.environ.get("TEST_BASE_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


def _seed_session(user_query: dict) -> str:
    db = _mongo()
    user = db.users.find_one(user_query)
    assert user, f"No matching user for {user_query}"
    token = f"orphan_notif_test_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "created_at": datetime.now(timezone.utc),
    })
    return token


def _admin_token() -> str:
    return _seed_session({"is_admin": True, "email": {"$ne": ""}})


def _non_admin_token() -> str:
    # Prefer the seeded tester
    db = _mongo()
    row = db.users.find_one({"email": "shelfsort-tester@example.com"})
    if not row:
        # Fall back to any approved non-admin
        row = db.users.find_one({
            "$or": [{"is_admin": {"$exists": False}}, {"is_admin": False}],
            "approval_status": "approved",
        })
    assert row, "No non-admin user seeded"
    token = f"orphan_notif_user_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "user_id": row["user_id"],
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "created_at": datetime.now(timezone.utc),
    })
    return token


# ------------------------------------------------------------------
# Auth gates
# ------------------------------------------------------------------
def test_delete_bulk_unauth():
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
                      json={"book_ids": ["x"]}, timeout=15)
    assert r.status_code in (401, 403), f"{r.status_code} {r.text[:200]}"


def test_delete_bulk_forbidden_for_non_admin():
    tok = _non_admin_token()
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
                      json={"book_ids": ["x"]},
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 403, f"{r.status_code} {r.text[:200]}"


def test_notify_retroactive_unauth():
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
                      timeout=15)
    assert r.status_code in (401, 403), f"{r.status_code} {r.text[:200]}"


def test_notify_retroactive_forbidden_for_non_admin():
    tok = _non_admin_token()
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 403, f"{r.status_code} {r.text[:200]}"


# ------------------------------------------------------------------
# Delete-bulk validation
# ------------------------------------------------------------------
def test_delete_bulk_empty_ids_400():
    tok = _admin_token()
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
                      json={"book_ids": []},
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 400, r.text[:200]


def test_delete_bulk_over_cap_400():
    tok = _admin_token()
    ids = [f"nonexistent_{i}" for i in range(251)]
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/delete-bulk",
                      json={"book_ids": ids, "confirm_recheck": False},
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 400, r.text[:200]
    assert "250" in r.text or "Cap" in r.text


# ------------------------------------------------------------------
# Retroactive endpoint — behaviour
# ------------------------------------------------------------------
def test_notify_retroactive_admin_reachable():
    """The endpoint should be admin-reachable and either succeed
    (200 with {ok, sent_count}), report already-sent, or return a
    proper 400 if no anchor exists. It must never 500."""
    tok = _admin_token()
    r = requests.post(f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    assert r.status_code in (200, 400), f"{r.status_code} {r.text[:400]}"
    if r.status_code == 200:
        body = r.json()
        assert body.get("ok") is True
        assert "sent_count" in body


def test_notify_retroactive_idempotent_and_anchor_correctness():
    """Seed a synthetic admin_actions/admin_audit doc + old & new users +
    verify:
      1) endpoint returns 200 with sent_count > 0 on first call for old user
      2) new user (created_at AFTER anchor) does NOT get a notification
      3) marker is written to system_flags
      4) second call returns already_sent=true, no additional notifications
    """
    db = _mongo()
    tok = _admin_token()

    # Clean slate for this test
    marker_id = "orphan_retroactive_notify_2026_07_11"
    db.system_flags.delete_one({"_id": marker_id})

    # Anchor: create an admin action doc "before" our new user.  Because
    # of a code-vs-schema mismatch we insert into BOTH `admin_audit`
    # (the real audit collection) and `admin_actions` (what the retro
    # endpoint currently reads) so the test is robust to either fix.
    anchor_dt = datetime.now(timezone.utc)
    anchor_iso = anchor_dt.isoformat()
    for coll in ("admin_actions", "admin_audit"):
        db[coll].insert_one({
            "action": "books.delete_orphans_bulk",
            "created_at": anchor_dt,
            "ts": anchor_dt,
            "actor_id": "test_admin_seed",
            "target": "count:1",
            "metadata": {"deleted": 1},
            "_test_seed": True,
        })

    # OLD user (before anchor) with a book — should be notified.
    old_uid = f"user_test_old_{uuid.uuid4().hex[:8]}"
    old_created = (anchor_dt - timedelta(days=7)).isoformat()
    db.users.insert_one({
        "user_id": old_uid,
        "email": f"{old_uid}@test.local",
        "name": "Old Fixture",
        "is_admin": False,
        "approval_status": "approved",
        "is_test_account": True,
        "created_at": old_created,
    })
    db.books.insert_one({
        "book_id": f"book_test_{uuid.uuid4().hex[:8]}",
        "user_id": old_uid,
        "title": "Fixture Book Old",
        "filename": "old.epub",
        "_test_seed": True,
    })

    # NEW user (after anchor) with a book — must NOT be notified.
    new_uid = f"user_test_new_{uuid.uuid4().hex[:8]}"
    new_created = (anchor_dt + timedelta(hours=1)).isoformat()
    db.users.insert_one({
        "user_id": new_uid,
        "email": f"{new_uid}@test.local",
        "name": "New Fixture",
        "is_admin": False,
        "approval_status": "approved",
        "is_test_account": True,
        "created_at": new_created,
    })
    db.books.insert_one({
        "book_id": f"book_test_{uuid.uuid4().hex[:8]}",
        "user_id": new_uid,
        "title": "Fixture Book New",
        "filename": "new.epub",
        "_test_seed": True,
    })

    # Clear any prior notifications for cleanliness
    db.notifications.delete_many({"user_id": {"$in": [old_uid, new_uid]}})

    try:
        # First call
        r1 = requests.post(
            f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
            headers={"Authorization": f"Bearer {tok}"}, timeout=60,
        )
        assert r1.status_code == 200, f"first call: {r1.status_code} {r1.text[:400]}"
        body1 = r1.json()
        assert body1.get("ok") is True
        # Should NOT be already_sent on first invocation (we cleared marker)
        assert not body1.get("already_sent"), f"unexpected already_sent on first call: {body1}"

        # Marker written
        marker = db.system_flags.find_one({"_id": marker_id})
        assert marker is not None, "system_flags marker was not written"

        # Old user got the notification.
        # NOTE (2026-07-11): Currently FAILS because the endpoint uses
        # a datetime `anchor_ts` to filter `users.created_at`, but 42/49
        # real users have `created_at` stored as ISO STRING (BSON type
        # mismatch → those users are silently excluded).  Also, the
        # endpoint reads from `db.admin_actions` while writes land in
        # `db.admin_audit` — the anchor lookup only works when the test
        # explicitly seeds `admin_actions`.  Both are critical bugs.
        old_notifs = list(db.notifications.find({
            "user_id": old_uid, "kind": "library_maintenance",
        }))
        assert len(old_notifs) >= 1, (
            f"BUG: old user was not notified: {old_notifs}. "
            f"Response: {body1}. Likely cause: datetime vs string "
            f"type mismatch on users.created_at filter."
        )

        # New user did NOT get notified
        new_notifs = list(db.notifications.find({
            "user_id": new_uid, "kind": "library_maintenance",
        }))
        assert len(new_notifs) == 0, (
            f"BUG: user created AFTER anchor was notified: {new_notifs}"
        )

        # Second call — must be idempotent (already_sent=true)
        r2 = requests.post(
            f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r2.status_code == 200, r2.text[:400]
        body2 = r2.json()
        assert body2.get("already_sent") is True, f"second call not idempotent: {body2}"

        # Notifications count for old user unchanged
        old_notifs_after = list(db.notifications.find({
            "user_id": old_uid, "kind": "library_maintenance",
        }))
        assert len(old_notifs_after) == len(old_notifs), (
            f"idempotency broken: {len(old_notifs)} -> {len(old_notifs_after)}"
        )

    finally:
        # Cleanup
        db.users.delete_many({"user_id": {"$in": [old_uid, new_uid]}})
        db.books.delete_many({"user_id": {"$in": [old_uid, new_uid]}})
        db.notifications.delete_many({"user_id": {"$in": [old_uid, new_uid]}})
        db.admin_actions.delete_many({"_test_seed": True})
        db.admin_audit.delete_many({"_test_seed": True})
        db.system_flags.delete_one({"_id": marker_id})
        db.deleted_books_ledger.delete_many({"user_id": {"$in": [old_uid, new_uid]}})
