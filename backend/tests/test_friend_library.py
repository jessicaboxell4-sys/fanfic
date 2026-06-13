"""Tests for friend library sharing: mutual count, browse, book request."""
import os, uuid, requests, pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]

USERS = {
    "alice": {"user_id": f"user_lA_{uuid.uuid4().hex[:8]}", "token": f"sess_lA_{uuid.uuid4().hex}", "name": "Alice Lib"},
    "bob":   {"user_id": f"user_lB_{uuid.uuid4().hex[:8]}", "token": f"sess_lB_{uuid.uuid4().hex}", "name": "Bob Lib"},
    "carol": {"user_id": f"user_lC_{uuid.uuid4().hex[:8]}", "token": f"sess_lC_{uuid.uuid4().hex}", "name": "Carol Stranger"},
}
def H(n): return {"Authorization": f"Bearer {USERS[n]['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for u in USERS.values():
        db.users.insert_one({
            "user_id": u["user_id"], "email": f"{u['user_id']}@example.com",
            "name": u["name"], "picture": "", "is_admin": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    # Alice + Bob are friends; carol is not.
    a, b = sorted([USERS["alice"]["user_id"], USERS["bob"]["user_id"]])
    db.friendships.insert_one({
        "friendship_id": f"fr_{uuid.uuid4().hex[:12]}", "user_a": a, "user_b": b,
        "status": "accepted", "requested_by": USERS["alice"]["user_id"], "blocked_by": None,
        "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc),
    })
    # Alice has 3 books. Bob has 4 — 2 overlap with Alice.
    for t, a_, who in [
        ("Pride and Prejudice", "Austen", "alice"),
        ("Dune", "Herbert", "alice"),
        ("The Hobbit", "Tolkien", "alice"),
        ("Pride and Prejudice", "Austen", "bob"),       # overlap
        ("Hobbit", "Tolkien", "bob"),                   # overlap (the/no-the)
        ("Mistborn", "Sanderson", "bob"),
        ("Sandman: Overture", "Gaiman", "bob"),
    ]:
        db.books.insert_one({
            "user_id": USERS[who]["user_id"],
            "book_id": f"book_{uuid.uuid4().hex[:10]}",
            "title": t, "author": a_,
        })
    # Bob opts in to library sharing.
    db.users.update_one({"user_id": USERS["bob"]["user_id"]}, {"$set": {"library_visible_to_friends": True}})
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.friendships.delete_many({"$or": [{"user_a": {"$in": uid_list}}, {"user_b": {"$in": uid_list}}]})
    db.books.delete_many({"user_id": {"$in": uid_list}})
    db.chat_rooms.delete_many({"member_user_ids": {"$in": uid_list}})
    db.chat_messages.delete_many({"sender_user_id": {"$in": uid_list}})


class TestMutual:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/friends/{USERS['bob']['user_id']}/mutual")
        assert r.status_code == 401

    def test_non_friend_403(self):
        r = requests.get(f"{BASE}/api/friends/{USERS['carol']['user_id']}/mutual", headers=H("alice"))
        assert r.status_code == 403

    def test_alice_bob_mutual(self):
        r = requests.get(f"{BASE}/api/friends/{USERS['bob']['user_id']}/mutual", headers=H("alice"))
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 2  # Pride & Prejudice + Hobbit/the-Hobbit
        assert data["my_total"] == 3
        assert data["their_total"] == 4
        sample_titles = [s["title"] for s in data["sample"]]
        assert "Pride and Prejudice" in sample_titles


class TestFriendLibrary:
    def test_non_friend_blocked(self):
        r = requests.get(f"{BASE}/api/friends/{USERS['carol']['user_id']}/library", headers=H("alice"))
        assert r.status_code == 403

    def test_not_opted_in_blocked(self):
        # Bob → Alice: Alice didn't opt in
        r = requests.get(f"{BASE}/api/friends/{USERS['alice']['user_id']}/library", headers=H("bob"))
        assert r.status_code == 403
        assert "hasn't shared" in r.json()["detail"].lower() or "library" in r.json()["detail"].lower()

    def test_alice_views_bob_library(self):
        r = requests.get(f"{BASE}/api/friends/{USERS['bob']['user_id']}/library", headers=H("alice"))
        assert r.status_code == 200
        data = r.json()
        assert len(data["books"]) == 4
        # i_have_it should be True for Pride and Prejudice + Hobbit, False for others.
        have_count = sum(1 for b in data["books"] if b.get("i_have_it"))
        assert have_count == 2

    def test_search_filters(self):
        r = requests.get(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/library",
            params={"q": "Sanderson"},
            headers=H("alice"),
        )
        assert r.status_code == 200
        titles = [b["title"] for b in r.json()["books"]]
        assert titles == ["Mistborn"]


class TestBookRequest:
    def test_request_creates_dm_message(self):
        # Find a book Bob has that Alice doesn't
        their_lib = requests.get(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/library", headers=H("alice"),
        ).json()["books"]
        target = next(b for b in their_lib if not b.get("i_have_it"))
        r = requests.post(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/book-request",
            json={"book_id": target["book_id"], "note": "Pretty please"},
            headers=H("alice"),
        )
        assert r.status_code == 200, r.text
        room_id = r.json()["room_id"]
        # Verify the DM exists with the right shape + book_request message
        msgs = requests.get(
            f"{BASE}/api/chat/rooms/{room_id}/messages", headers=H("bob"),
        ).json()["messages"]
        assert any(m["kind"] == "book_request" and m["attachment"]["book_id"] == target["book_id"] for m in msgs)

    def test_request_unknown_book_404(self):
        r = requests.post(
            f"{BASE}/api/friends/{USERS['bob']['user_id']}/book-request",
            json={"book_id": "book_does_not_exist"},
            headers=H("alice"),
        )
        assert r.status_code == 404

    def test_non_friend_cant_request(self):
        # Carol isn't friends; even a known book_id should 403 before lookup
        r = requests.post(
            f"{BASE}/api/friends/{USERS['carol']['user_id']}/book-request",
            json={"book_id": "x"},
            headers=H("alice"),
        )
        assert r.status_code == 403


class TestVisibilityToggle:
    def test_default_off(self):
        r = requests.get(f"{BASE}/api/account/library-visibility", headers=H("alice"))
        assert r.status_code == 200
        assert r.json()["library_visible_to_friends"] is False

    def test_toggle_on_off(self):
        for v in (True, False):
            r = requests.put(
                f"{BASE}/api/account/library-visibility",
                json={"library_visible_to_friends": v},
                headers=H("alice"),
            )
            assert r.status_code == 200
            assert r.json()["library_visible_to_friends"] is v
