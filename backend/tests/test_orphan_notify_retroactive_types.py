"""Iteration-83 re-verification: anchor query must handle BOTH ISO-string
and datetime-typed users.created_at values, and marker anchor_ts must be
persisted as ISO string.

Seeds 4 users:
    - user A: created_at ISO STRING, BEFORE anchor  → must be notified
    - user B: created_at DATETIME,   BEFORE anchor  → must be notified
    - user C: created_at ISO STRING, AFTER anchor   → must NOT be notified
    - user D: created_at DATETIME,   AFTER anchor   → must NOT be notified
"""
from __future__ import annotations

import os
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
MARKER_ID = "orphan_retroactive_notify_2026_07_11"


def _mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


def _admin_token(db) -> str:
    admin = db.users.find_one({"is_admin": True})
    assert admin, "No admin user seeded"
    tok = f"orphan_types_test_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "user_id": admin["user_id"],
        "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "created_at": datetime.now(timezone.utc),
    })
    return tok


def _seed_user(db, uid, created_at_value):
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@test.local",
        "name": uid,
        "is_admin": False,
        "approval_status": "approved",
        "is_test_account": True,
        "created_at": created_at_value,
    })
    db.books.insert_one({
        "book_id": f"book_{uid}",
        "user_id": uid,
        "title": f"Book {uid}",
        "filename": f"{uid}.epub",
        "_test_seed": True,
    })


def test_retroactive_notify_handles_both_string_and_datetime_created_at():
    db = _mongo()
    tok = _admin_token(db)

    # Clear marker
    db.system_flags.delete_one({"_id": MARKER_ID})

    # Anchor
    anchor_dt = datetime.now(timezone.utc)
    db.admin_audit.insert_one({
        "action": "books.delete_orphans_bulk",
        "ts": anchor_dt,
        "created_at": anchor_dt,
        "actor_id": "test_admin_seed",
        "target": "count:1",
        "metadata": {"deleted": 1},
        "_test_seed": True,
    })

    tag = uuid.uuid4().hex[:8]
    users = {
        "A_before_str":  (f"user_test_A_{tag}", (anchor_dt - timedelta(days=3)).isoformat(), True),
        "B_before_dt":   (f"user_test_B_{tag}",  anchor_dt - timedelta(days=3),               True),
        "C_after_str":   (f"user_test_C_{tag}", (anchor_dt + timedelta(hours=2)).isoformat(), False),
        "D_after_dt":    (f"user_test_D_{tag}",  anchor_dt + timedelta(hours=2),              False),
    }
    for label, (uid, ca, _) in users.items():
        _seed_user(db, uid, ca)

    all_uids = [uid for (uid, _, _) in users.values()]
    db.notifications.delete_many({"user_id": {"$in": all_uids}})

    try:
        r = requests.post(
            f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
            headers={"Authorization": f"Bearer {tok}"}, timeout=180,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("ok") is True
        assert not body.get("already_sent"), body

        # Marker anchor_ts must be an ISO string
        marker = db.system_flags.find_one({"_id": MARKER_ID})
        assert marker is not None
        assert isinstance(marker.get("anchor_ts"), str), (
            f"marker.anchor_ts must be ISO string, got {type(marker.get('anchor_ts'))}: {marker.get('anchor_ts')}"
        )

        # Verify pre-anchor users notified (both string and datetime types)
        for label in ("A_before_str", "B_before_dt"):
            uid = users[label][0]
            notifs = list(db.notifications.find({
                "user_id": uid, "kind": "library_maintenance",
            }))
            assert len(notifs) >= 1, (
                f"BUG: pre-anchor user {label} ({uid}) not notified. "
                f"Response body={body}"
            )

        # Verify post-anchor users NOT notified
        for label in ("C_after_str", "D_after_dt"):
            uid = users[label][0]
            notifs = list(db.notifications.find({
                "user_id": uid, "kind": "library_maintenance",
            }))
            assert len(notifs) == 0, (
                f"BUG: post-anchor user {label} ({uid}) got notified: {notifs}"
            )

        # Idempotency
        r2 = requests.post(
            f"{BASE_URL}/api/admin/orphan-audit/notify-retroactive",
            headers={"Authorization": f"Bearer {tok}"}, timeout=30,
        )
        assert r2.status_code == 200, r2.text[:400]
        body2 = r2.json()
        assert body2.get("already_sent") is True, body2
        assert "sent_count" in body2, body2

        # No extra notifications after second call
        for label in ("A_before_str", "B_before_dt"):
            uid = users[label][0]
            notifs = list(db.notifications.find({
                "user_id": uid, "kind": "library_maintenance",
            }))
            assert len(notifs) == 1, (
                f"idempotency broken for {label}: got {len(notifs)} notifs"
            )

    finally:
        db.users.delete_many({"user_id": {"$in": all_uids}})
        db.books.delete_many({"user_id": {"$in": all_uids}})
        db.notifications.delete_many({"user_id": {"$in": all_uids}})
        db.admin_audit.delete_many({"_test_seed": True})
        db.system_flags.delete_one({"_id": MARKER_ID})
        db.deleted_books_ledger.delete_many({"user_id": {"$in": all_uids}})
