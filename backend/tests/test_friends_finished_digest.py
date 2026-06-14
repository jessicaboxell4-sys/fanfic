"""E2E tests for the 'From friends' weekly notification digest.

Covers:
- GET /api/recommendations/friends-finished/settings returns enabled=True by default
- PUT toggles the preference
- POST .../preview fires immediately when there's data, returns fired=False with reason when none
- The preview creates an actual notification row
- _collect_friends_finished_payload filters out books I already own + non-sharing friends
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

USERS = {
    "alice": {"user_id": f"user_ffA_{uuid.uuid4().hex[:8]}", "token": f"sess_ffA_{uuid.uuid4().hex}", "name": "Alice FFinish"},
    "bob":   {"user_id": f"user_ffB_{uuid.uuid4().hex[:8]}", "token": f"sess_ffB_{uuid.uuid4().hex}", "name": "Bob Reader"},
    "carol": {"user_id": f"user_ffC_{uuid.uuid4().hex[:8]}", "token": f"sess_ffC_{uuid.uuid4().hex}", "name": "Carol Private"},
}


def H(name): return {"Authorization": f"Bearer {USERS[name]['token']}"}


def _pair(a, b): return (a, b) if a < b else (b, a)


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for key, u in USERS.items():
        db.users.insert_one({
            "user_id": u["user_id"],
            "email": f"{u['user_id']}@example.com",
            "name": u["name"],
            "is_admin": False,
            # Bob shares; Carol doesn't.
            "library_visible_to_friends": key == "bob",
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"],
            "session_token": u["token"],
            "expires_at": now + timedelta(days=7),
            "created_at": now,
        })
    # Friendship alice<->bob and alice<->carol.
    for friend in ("bob", "carol"):
        a, b = _pair(USERS["alice"]["user_id"], USERS[friend]["user_id"])
        db.friendships.insert_one({
            "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
            "user_a": a, "user_b": b, "status": "accepted",
            "requested_by": USERS["alice"]["user_id"],
            "created_at": now, "updated_at": now,
        })
    # Bob just finished a book — within the last week, so it qualifies.
    db.books.insert_one({
        "book_id": f"ffbook_{uuid.uuid4().hex[:6]}",
        "user_id": USERS["bob"]["user_id"],
        "title": "Bob's Just-Finished Book",
        "author": "Recent Author",
        "category": "Fanfiction",
        "progress_percent": 1.0,
        "last_opened_at": now - timedelta(hours=12),
        "finished_at": (now - timedelta(hours=12)).isoformat(),
        "created_at": now - timedelta(days=4),
    })
    # Bob also finished a book 90 days ago — should NOT appear (too old).
    db.books.insert_one({
        "book_id": f"ffstale_{uuid.uuid4().hex[:6]}",
        "user_id": USERS["bob"]["user_id"],
        "title": "Bob Stale Book",
        "author": "Old",
        "category": "Fanfiction",
        "progress_percent": 1.0,
        "last_opened_at": now - timedelta(days=90),
        "created_at": now - timedelta(days=120),
    })
    # Carol (private) finished a book recently — should NOT appear.
    db.books.insert_one({
        "book_id": f"ffhidden_{uuid.uuid4().hex[:6]}",
        "user_id": USERS["carol"]["user_id"],
        "title": "Carol Private Finish",
        "author": "Hidden",
        "category": "Fanfiction",
        "progress_percent": 1.0,
        "last_opened_at": now - timedelta(hours=6),
        "created_at": now - timedelta(days=2),
    })
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.books.delete_many({"user_id": {"$in": uid_list}})
    db.friendships.delete_many({"$or": [{"user_a": {"$in": uid_list}}, {"user_b": {"$in": uid_list}}]})
    db.notifications.delete_many({"user_id": {"$in": uid_list}})
    db.recommendation_dismissals.delete_many({"user_id": {"$in": uid_list}})


class TestFriendsFinishedDigest:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/recommendations/friends-finished/settings")
        assert r.status_code == 401

    def test_default_enabled(self):
        r = requests.get(f"{BASE}/api/recommendations/friends-finished/settings", headers=H("alice"))
        assert r.status_code == 200
        assert r.json()["enabled"] is True

    def test_toggle_off_and_on(self):
        r = requests.put(f"{BASE}/api/recommendations/friends-finished/settings", json={"enabled": False}, headers=H("alice"))
        assert r.status_code == 200
        assert r.json()["enabled"] is False
        r = requests.put(f"{BASE}/api/recommendations/friends-finished/settings", json={"enabled": True}, headers=H("alice"))
        assert r.json()["enabled"] is True

    def test_preview_returns_payload_with_bob_finish_only(self):
        r = requests.post(f"{BASE}/api/recommendations/friends-finished/preview", headers=H("alice"))
        assert r.status_code == 200, r.text
        data = r.json()
        titles = [b["title"] for b in data["books"]]
        assert "Bob's Just-Finished Book" in titles
        assert "Bob Stale Book" not in titles
        assert "Carol Private Finish" not in titles
        assert data["fired"] is True

    def test_preview_creates_notification(self):
        # The previous test fired it — verify the notification row exists.
        n = db.notifications.find_one({
            "user_id": USERS["alice"]["user_id"],
            "kind": "friends_finished_digest",
        })
        assert n is not None
        assert "your friends just finished" in n["title"].lower()
        assert n["link"] == "/library/recommendations"

    def test_preview_empty_when_no_finishes(self):
        # Bob is the only person who shared and his recent book gets owned by alice
        # → preview should return total=0 and fired=False.
        now = datetime.now(timezone.utc)
        own_id = f"alice_owned_{uuid.uuid4().hex[:6]}"
        db.books.insert_one({
            "book_id": own_id,
            "user_id": USERS["alice"]["user_id"],
            "title": "Bob's Just-Finished Book",
            "author": "Recent Author",
            "category": "Fanfiction",
            "created_at": now,
        })
        try:
            r = requests.post(f"{BASE}/api/recommendations/friends-finished/preview", headers=H("alice"))
            assert r.status_code == 200
            data = r.json()
            assert data["fired"] is False
            assert data.get("reason") == "no_new_finishes"
            assert data["total"] == 0
        finally:
            db.books.delete_one({"book_id": own_id})
