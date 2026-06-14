"""E2E tests for the per-kind in-app notification mute matrix.

Covers:
- GET /api/user/notification-mutes returns empty mutes + full catalog with mutable flag
- PUT accepts valid mutable kinds and stores them
- PUT silently ignores unknown kinds and refuses to mute non-mutable kinds
- create_notification skips when the kind is muted (mutable kind)
- create_notification ALWAYS fires for non-mutable kinds (e.g. friend_request)
  even when the user has them in muted_kinds (shouldn't be there, but defensive)
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER = {
    "user_id": f"user_mute_{uuid.uuid4().hex[:8]}",
    "email": f"mute_{uuid.uuid4().hex[:6]}@example.com",
    "token": f"sess_mute_{uuid.uuid4().hex}",
    "name": "Mute Tester",
}


def H(): return {"Authorization": f"Bearer {USER['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": USER["user_id"],
        "email": USER["email"],
        "name": USER["name"],
        "is_admin": False,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER["user_id"],
        "session_token": USER["token"],
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    yield
    db.users.delete_one({"user_id": USER["user_id"]})
    db.user_sessions.delete_many({"user_id": USER["user_id"]})
    db.notifications.delete_many({"user_id": USER["user_id"]})


class TestNotificationMutes:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/user/notification-mutes")
        assert r.status_code == 401

    def test_default_empty(self):
        r = requests.get(f"{BASE}/api/user/notification-mutes", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert data["muted_kinds"] == []
        assert isinstance(data["catalog"], list) and len(data["catalog"]) >= 6
        # Sanity: friend_request is non-mutable
        fr = next(c for c in data["catalog"] if c["kind"] == "friend_request")
        assert fr["mutable"] is False
        # bookclub_message is mutable
        bm = next(c for c in data["catalog"] if c["kind"] == "bookclub_message")
        assert bm["mutable"] is True

    def test_set_mutes_roundtrip(self):
        r = requests.put(
            f"{BASE}/api/user/notification-mutes",
            json={"muted_kinds": ["bookclub_message", "friends_finished_digest"]},
            headers=H(),
        )
        assert r.status_code == 200
        data = r.json()
        assert sorted(data["muted_kinds"]) == ["bookclub_message", "friends_finished_digest"]
        # Verify persisted
        r2 = requests.get(f"{BASE}/api/user/notification-mutes", headers=H())
        assert sorted(r2.json()["muted_kinds"]) == ["bookclub_message", "friends_finished_digest"]

    def test_unknown_and_non_mutable_rejected(self):
        r = requests.put(
            f"{BASE}/api/user/notification-mutes",
            json={"muted_kinds": ["bookclub_invite", "totally_fake_kind", "bookclub_message"]},
            headers=H(),
        )
        assert r.status_code == 200
        data = r.json()
        # bookclub_invite is non-mutable — should be dropped
        assert "bookclub_invite" not in data["muted_kinds"]
        # totally_fake_kind should be ignored
        assert "totally_fake_kind" not in data["muted_kinds"]
        # bookclub_message survives
        assert "bookclub_message" in data["muted_kinds"]
        assert "bookclub_invite" in data["ignored_non_mutable"]
        assert "totally_fake_kind" in data["ignored_unknown"]

    def test_muted_kind_skips_insert(self):
        # Set up: minimal sharing friend with a recent finish so the
        # friends-finished preview would normally fire an in-app notif.
        now = datetime.now(timezone.utc)
        friend = {
            "user_id": f"friend_mute_{uuid.uuid4().hex[:6]}",
            "email": f"friend_mute_{uuid.uuid4().hex[:6]}@example.com",
        }
        db.users.insert_one({
            "user_id": friend["user_id"],
            "email": friend["email"],
            "name": "Mute Friend",
            "library_visible_to_friends": True,
            "created_at": now.isoformat(),
        })
        a, b = (USER["user_id"], friend["user_id"]) if USER["user_id"] < friend["user_id"] else (friend["user_id"], USER["user_id"])
        fr_id = f"fr_{uuid.uuid4().hex[:12]}"
        db.friendships.insert_one({
            "friendship_id": fr_id,
            "user_a": a, "user_b": b, "status": "accepted",
            "requested_by": USER["user_id"],
            "created_at": now, "updated_at": now,
        })
        bk_id = f"mutebk_{uuid.uuid4().hex[:6]}"
        db.books.insert_one({
            "book_id": bk_id, "user_id": friend["user_id"],
            "title": "Mute test book", "author": "MA",
            "category": "Fanfiction", "progress_percent": 1.0,
            "last_opened_at": now - timedelta(hours=1),
            "created_at": now - timedelta(days=2),
        })
        # Mute the digest kind, then fire preview — no notification should land.
        requests.put(
            f"{BASE}/api/user/notification-mutes",
            json={"muted_kinds": ["friends_finished_digest"]},
            headers=H(),
        )
        db.notifications.delete_many({"user_id": USER["user_id"], "kind": "friends_finished_digest"})
        try:
            r = requests.post(f"{BASE}/api/recommendations/friends-finished/preview", headers=H())
            assert r.status_code == 200
            # Backend reports fired=False because create_notification was a no-op.
            # (We check via DB rather than fired flag since the response only
            # reflects what the helper attempted, not whether the insert happened.)
            cnt = db.notifications.count_documents({
                "user_id": USER["user_id"], "kind": "friends_finished_digest",
            })
            assert cnt == 0, f"muted notification should not insert, got {cnt}"
        finally:
            # Cleanup
            db.users.delete_one({"user_id": friend["user_id"]})
            db.friendships.delete_one({"friendship_id": fr_id})
            db.books.delete_one({"book_id": bk_id})
            requests.put(
                f"{BASE}/api/user/notification-mutes",
                json={"muted_kinds": []}, headers=H(),
            )

    def test_non_mutable_kind_always_fires(self):
        # Even if a stale/manipulated mute exists for a non-mutable kind, the
        # notification must still fire because critical kinds bypass mute.
        # Directly poke Mongo to set a non-mutable mute (the API would have
        # stripped it). Then send a friend request through the HTTP API
        # which fires friend_request — a non-mutable kind.
        sender = {
            "user_id": f"sender_mute_{uuid.uuid4().hex[:6]}",
            "email": f"sender_mute_{uuid.uuid4().hex[:6]}@example.com",
            "token": f"sess_sender_mute_{uuid.uuid4().hex}",
        }
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": sender["user_id"], "email": sender["email"],
            "name": "Sender", "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": sender["user_id"], "session_token": sender["token"],
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        db.users.update_one(
            {"user_id": USER["user_id"]},
            {"$set": {"notification_mutes": ["friend_request"]}},
        )
        try:
            # Trigger a friend request from sender → USER.
            r = requests.post(
                f"{BASE}/api/friends/request",
                json={"target_user_id": USER["user_id"]},
                headers={"Authorization": f"Bearer {sender['token']}"},
            )
            assert r.status_code in (200, 201), r.text
            # Despite the stale mute, the notification MUST have fired.
            cnt = db.notifications.count_documents({
                "user_id": USER["user_id"], "kind": "friend_request",
            })
            assert cnt >= 1, "non-mutable critical notification must always fire"
        finally:
            db.users.delete_one({"user_id": sender["user_id"]})
            db.user_sessions.delete_many({"user_id": sender["user_id"]})
            db.friendships.delete_many({"$or": [
                {"user_a": sender["user_id"]}, {"user_b": sender["user_id"]},
            ]})
            db.notifications.delete_many({"user_id": USER["user_id"], "kind": "friend_request"})
            db.users.update_one(
                {"user_id": USER["user_id"]},
                {"$set": {"notification_mutes": []}},
            )
