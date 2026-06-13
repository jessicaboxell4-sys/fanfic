"""E2E tests for friends + DM system (Phase 1a/1b).

Covers:
- Friend request lifecycle: send → pending → accept | decline | cancel
- Mutual auto-accept when both sides send
- Block / unblock / leak prevention
- Privacy: friends_only blocks DM creation, anyone allows it
- User search: by email / name; respects hidden_from_search + blocks
- DM room creation: idempotent, friend-gated, blocked-out
- Pending-count badge endpoint
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


# Three test users. Distinct token + email per user.
USERS = {
    "alice":   {"user_id": f"user_fA_{uuid.uuid4().hex[:8]}",  "token": f"sess_fA_{uuid.uuid4().hex}",  "name": "Alice Test"},
    "bob":     {"user_id": f"user_fB_{uuid.uuid4().hex[:8]}",  "token": f"sess_fB_{uuid.uuid4().hex}",  "name": "Bob Test"},
    "carol":   {"user_id": f"user_fC_{uuid.uuid4().hex[:8]}",  "token": f"sess_fC_{uuid.uuid4().hex}",  "name": "Carol Open"},
    "dave":    {"user_id": f"user_fD_{uuid.uuid4().hex[:8]}",  "token": f"sess_fD_{uuid.uuid4().hex}",  "name": "Dave Hidden"},
}


def H(name): return {"Authorization": f"Bearer {USERS[name]['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for key, u in USERS.items():
        db.users.insert_one({
            "user_id": u["user_id"],
            "email": f"{u['user_id']}@example.com",
            "name": u["name"],
            "picture": "",
            "is_admin": False,
            "message_privacy": "anyone" if key == "carol" else "friends_only",
            "hidden_from_search": key == "dave",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"],
            "session_token": u["token"],
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.friendships.delete_many({"$or": [{"user_a": {"$in": uid_list}}, {"user_b": {"$in": uid_list}}]})
    db.chat_rooms.delete_many({"member_user_ids": {"$in": uid_list}})


# ---------- Friend request lifecycle ----------

class TestFriendRequest:
    def test_unauth_blocked(self):
        r = requests.post(f"{BASE}/api/friends/request", json={"target_user_id": USERS["bob"]["user_id"]})
        assert r.status_code == 401

    def test_cant_request_self(self):
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["alice"]["user_id"]},
            headers=H("alice"),
        )
        assert r.status_code == 400

    def test_target_must_exist(self):
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": "user_nope"},
            headers=H("alice"),
        )
        assert r.status_code == 404

    def test_send_by_email(self):
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_email": f"{USERS['bob']['user_id']}@example.com"},
            headers=H("alice"),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

    def test_duplicate_request_409(self):
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["bob"]["user_id"]},
            headers=H("alice"),
        )
        assert r.status_code == 409

    def test_bob_sees_pending_in(self):
        r = requests.get(f"{BASE}/api/friends", headers=H("bob"))
        assert r.status_code == 200
        data = r.json()
        assert len(data["pending_in"]) == 1
        assert data["pending_in"][0]["other_user_id"] == USERS["alice"]["user_id"]
        assert data["pending_in"][0]["email"] == f"{USERS['alice']['user_id']}@example.com"

    def test_pending_count_endpoint(self):
        r = requests.get(f"{BASE}/api/friends/pending-count", headers=H("bob"))
        assert r.status_code == 200
        assert r.json()["pending_in"] == 1
        r2 = requests.get(f"{BASE}/api/friends/pending-count", headers=H("alice"))
        assert r2.json()["pending_in"] == 0  # alice sent it; outgoing doesn't count

    def test_alice_cant_accept_own(self):
        r = requests.post(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/accept",
            headers=H("alice"),
        )
        assert r.status_code == 400

    def test_bob_accepts(self):
        r = requests.post(
            f"{BASE}/api/friends/{USERS['alice']['user_id']}/accept",
            headers=H("bob"),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"

    def test_both_see_accepted(self):
        for who in ("alice", "bob"):
            r = requests.get(f"{BASE}/api/friends", headers=H(who))
            data = r.json()
            assert len(data["accepted"]) == 1
            assert len(data["pending_in"]) == 0
            assert len(data["pending_out"]) == 0


class TestFriendNotifications:
    def test_request_notifies_target(self):
        # Carol sends a fresh request to Bob — Bob should get a notification.
        a, b = sorted([USERS["carol"]["user_id"], USERS["bob"]["user_id"]])
        db.friendships.delete_many({"user_a": a, "user_b": b})
        db.notifications.delete_many({"user_id": USERS["bob"]["user_id"]})
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["bob"]["user_id"]},
            headers=H("carol"),
        )
        assert r.status_code == 200
        nr = requests.get(f"{BASE}/api/notifications", headers=H("bob"))
        kinds = [n["kind"] for n in nr.json()["notifications"]]
        assert "friend_request" in kinds
        # cleanup
        requests.post(f"{BASE}/api/friends/{USERS['carol']['user_id']}/decline", headers=H("bob"))

    def test_accept_notifies_requester(self):
        # Carol → Bob, then Bob accepts — Carol should get a "friend_accepted" notification.
        a, b = sorted([USERS["carol"]["user_id"], USERS["bob"]["user_id"]])
        db.friendships.delete_many({"user_a": a, "user_b": b})
        db.notifications.delete_many({"user_id": USERS["carol"]["user_id"]})
        r1 = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["bob"]["user_id"]},
            headers=H("carol"),
        )
        assert r1.status_code == 200
        r2 = requests.post(
            f"{BASE}/api/friends/{USERS['carol']['user_id']}/accept",
            headers=H("bob"),
        )
        assert r2.status_code == 200
        nr = requests.get(f"{BASE}/api/notifications", headers=H("carol"))
        kinds = [n["kind"] for n in nr.json()["notifications"]]
        assert "friend_accepted" in kinds
        # cleanup
        requests.delete(f"{BASE}/api/friends/{USERS['bob']['user_id']}", headers=H("carol"))


class TestMutualAutoAccept:
    def test_simultaneous_requests_auto_accept(self):
        # Alice → Carol
        r1 = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["carol"]["user_id"]},
            headers=H("alice"),
        )
        assert r1.json()["status"] == "pending"
        # Carol → Alice (already pending the other way → auto-accept)
        r2 = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["alice"]["user_id"]},
            headers=H("carol"),
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "accepted"


class TestDecline:
    def test_decline_pending(self):
        # Bob → Carol → Carol declines
        requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["carol"]["user_id"]},
            headers=H("bob"),
        )
        r = requests.post(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/decline",
            headers=H("carol"),
        )
        assert r.status_code == 200
        # Now bob can re-request
        r2 = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["carol"]["user_id"]},
            headers=H("bob"),
        )
        assert r2.status_code == 200
        # Clean up
        requests.post(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/decline",
            headers=H("carol"),
        )


# ---------- DM rooms ----------

class TestDMRooms:
    def test_dm_blocked_by_friends_only_when_not_friends(self):
        # Bob → Dave (Dave is friends_only, not friends)
        r = requests.post(f"{BASE}/api/chat/dm/{USERS['dave']['user_id']}", headers=H("bob"))
        assert r.status_code == 403

    def test_dm_allowed_to_open_user(self):
        # Bob → Carol (Carol is 'anyone')
        r = requests.post(f"{BASE}/api/chat/dm/{USERS['carol']['user_id']}", headers=H("bob"))
        assert r.status_code == 200
        rid = r.json()["room_id"]
        assert r.json()["created"] is True
        # Second call returns same room
        r2 = requests.post(f"{BASE}/api/chat/dm/{USERS['carol']['user_id']}", headers=H("bob"))
        assert r2.json()["room_id"] == rid
        assert r2.json()["created"] is False

    def test_dm_allowed_between_friends(self):
        # Alice + Bob are friends from TestFriendRequest
        r = requests.post(f"{BASE}/api/chat/dm/{USERS['bob']['user_id']}", headers=H("alice"))
        assert r.status_code == 200


# ---------- Search ----------

class TestUserSearch:
    def test_short_query_returns_empty(self):
        r = requests.get(f"{BASE}/api/users/search", params={"q": "a"}, headers=H("alice"))
        assert r.status_code == 200
        assert r.json()["users"] == []

    def test_search_finds_by_email(self):
        # Search a unique part of bob's email
        q = USERS["bob"]["user_id"][:10]
        r = requests.get(f"{BASE}/api/users/search", params={"q": q}, headers=H("alice"))
        ids = [u["user_id"] for u in r.json()["users"]]
        assert USERS["bob"]["user_id"] in ids

    def test_search_finds_by_name(self):
        r = requests.get(f"{BASE}/api/users/search", params={"q": "Carol"}, headers=H("alice"))
        names = [u["name"] for u in r.json()["users"]]
        assert "Carol Open" in names

    def test_search_excludes_self(self):
        # Search alice's own unique part
        q = USERS["alice"]["user_id"][:10]
        r = requests.get(f"{BASE}/api/users/search", params={"q": q}, headers=H("alice"))
        ids = [u["user_id"] for u in r.json()["users"]]
        assert USERS["alice"]["user_id"] not in ids

    def test_search_excludes_hidden(self):
        # Dave is hidden — searching his name returns nothing
        r = requests.get(f"{BASE}/api/users/search", params={"q": "Dave"}, headers=H("alice"))
        ids = [u["user_id"] for u in r.json()["users"]]
        assert USERS["dave"]["user_id"] not in ids

    def test_search_annotates_relation(self):
        # Alice + Bob are friends — Bob should appear with relation='friend'
        q = USERS["bob"]["user_id"][:10]
        r = requests.get(f"{BASE}/api/users/search", params={"q": q}, headers=H("alice"))
        bob_row = next((u for u in r.json()["users"] if u["user_id"] == USERS["bob"]["user_id"]), None)
        assert bob_row is not None
        assert bob_row["relation"] == "friend"


# ---------- Privacy ----------

class TestPrivacy:
    def test_get_defaults(self):
        # Bob is friends_only (default)
        r = requests.get(f"{BASE}/api/account/privacy", headers=H("bob"))
        assert r.status_code == 200
        assert r.json()["message_privacy"] == "friends_only"

    def test_toggle_to_anyone(self):
        r = requests.put(
            f"{BASE}/api/account/privacy",
            json={"message_privacy": "anyone"},
            headers=H("bob"),
        )
        assert r.status_code == 200
        assert r.json()["message_privacy"] == "anyone"
        # Reset
        requests.put(f"{BASE}/api/account/privacy", json={"message_privacy": "friends_only"}, headers=H("bob"))

    def test_invalid_privacy_value(self):
        r = requests.put(
            f"{BASE}/api/account/privacy",
            json={"message_privacy": "no-one"},
            headers=H("bob"),
        )
        assert r.status_code == 422

    def test_toggle_hidden(self):
        r = requests.put(
            f"{BASE}/api/account/privacy",
            json={"hidden_from_search": True},
            headers=H("bob"),
        )
        assert r.json()["hidden_from_search"] is True
        # Reset
        requests.put(f"{BASE}/api/account/privacy", json={"hidden_from_search": False}, headers=H("bob"))


# ---------- Block / unblock ----------

class TestBlock:
    def test_block_user(self):
        # Bob blocks Dave
        r = requests.post(f"{BASE}/api/friends/{USERS['dave']['user_id']}/block", headers=H("bob"))
        assert r.status_code == 200

    def test_blocked_user_cant_friend_request(self):
        # Dave tries to request Bob → 403 (without leaking who blocked whom)
        r = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["bob"]["user_id"]},
            headers=H("dave"),
        )
        assert r.status_code == 403

    def test_blocked_user_excluded_from_search(self):
        # Bob searches for Dave's unique part → should be empty (hidden + blocked)
        q = USERS["dave"]["user_id"][:10]
        r = requests.get(f"{BASE}/api/users/search", params={"q": q}, headers=H("bob"))
        ids = [u["user_id"] for u in r.json()["users"]]
        assert USERS["dave"]["user_id"] not in ids

    def test_dm_blocked(self):
        r = requests.post(f"{BASE}/api/chat/dm/{USERS['dave']['user_id']}", headers=H("bob"))
        assert r.status_code == 403

    def test_block_visible_in_friends_list_for_blocker(self):
        r = requests.get(f"{BASE}/api/friends", headers=H("bob"))
        blocked_ids = [b["other_user_id"] for b in r.json()["blocked"]]
        assert USERS["dave"]["user_id"] in blocked_ids

    def test_block_not_visible_to_blockee(self):
        r = requests.get(f"{BASE}/api/friends", headers=H("dave"))
        # Dave shouldn't see Bob in any list as 'blocked'
        assert r.json()["blocked"] == []

    def test_unblock(self):
        r = requests.delete(f"{BASE}/api/friends/{USERS['dave']['user_id']}/block", headers=H("bob"))
        assert r.status_code == 200
        # Verify dave can now request bob
        r2 = requests.post(
            f"{BASE}/api/friends/request",
            json={"target_user_id": USERS["bob"]["user_id"]},
            headers=H("dave"),
        )
        assert r2.status_code == 200
        # Clean
        requests.post(f"{BASE}/api/friends/{USERS['dave']['user_id']}/decline", headers=H("bob"))
