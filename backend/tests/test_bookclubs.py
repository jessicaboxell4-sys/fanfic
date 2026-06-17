"""E2E tests for Book-club reading rooms.

Covers:
- Create room (only with a book the user owns)
- Invite (friends-only), accept, decline
- List my rooms + pending invites + count
- Get room detail (members + my role)
- PATCH room metadata (name/desc/schedule)
- Role management (promote to moderator, demote, remove)
- Transfer ownership
- Chapter-threaded messages: post + list filtered by chapter
- Set progress + finish-the-book milestone notification
- Leave room (owner can't leave with others present)
- Delete room (owner-only, cascade)
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
    "owner":    {"user_id": f"user_bcO_{uuid.uuid4().hex[:8]}", "token": f"sess_bcO_{uuid.uuid4().hex}", "name": "Bookclub Owner"},
    "friend":   {"user_id": f"user_bcF_{uuid.uuid4().hex[:8]}", "token": f"sess_bcF_{uuid.uuid4().hex}", "name": "Friend Reader"},
    "outsider": {"user_id": f"user_bcX_{uuid.uuid4().hex[:8]}", "token": f"sess_bcX_{uuid.uuid4().hex}", "name": "Random Stranger"},
}
BOOK_ID = f"book_bc_{uuid.uuid4().hex[:8]}"


def H(name): return {"Authorization": f"Bearer {USERS[name]['token']}"}


def _pair(a, b): return (a, b) if a < b else (b, a)


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for u in USERS.values():
        db.users.insert_one({
            "user_id": u["user_id"],
            "email": f"{u['user_id']}@example.com",
            "name": u["name"],
            "picture": "",
            "is_admin": False,
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"],
            "session_token": u["token"],
            "expires_at": now + timedelta(days=7),
            "created_at": now,
        })
    # Owner owns the book.
    db.books.insert_one({
        "book_id": BOOK_ID,
        "user_id": USERS["owner"]["user_id"],
        "title": "Test Reading Room Book",
        "author": "Test Author",
        "chapters": [
            {"index": 1, "title": "Chapter One"},
            {"index": 2, "title": "Chapter Two"},
            {"index": 3, "title": "Chapter Three"},
        ],
        "category": "Fanfiction",
        "fandom": "Harry Potter",
        "created_at": now,
    })
    # Owner <-> Friend are friends. Owner <-> Outsider are NOT.
    a, b = _pair(USERS["owner"]["user_id"], USERS["friend"]["user_id"])
    db.friendships.insert_one({
        "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
        "user_a": a, "user_b": b,
        "status": "accepted",
        "requested_by": USERS["owner"]["user_id"],
        "created_at": now, "updated_at": now,
    })
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.books.delete_many({"user_id": {"$in": uid_list}})
    db.friendships.delete_many({"$or": [{"user_a": {"$in": uid_list}}, {"user_b": {"$in": uid_list}}]})
    db.bookclubs.delete_many({"owner_user_id": {"$in": uid_list}})
    db.bookclub_members.delete_many({"user_id": {"$in": uid_list}})
    db.bookclub_messages.delete_many({"user_id": {"$in": uid_list}})
    db.notifications.delete_many({"user_id": {"$in": uid_list}})


# State carried between tests in this module.
STATE = {}


class TestBookclubCreateAndList:
    def test_unauth_blocked(self):
        r = requests.get(f"{BASE}/api/bookclubs")
        assert r.status_code == 401

    def test_create_requires_owned_book(self):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            json={"name": "Doomed Club", "book_id": "nonexistent"},
            headers=H("owner"),
        )
        assert r.status_code == 404

    def test_outsider_cant_create_with_others_book(self):
        # Outsider doesn't own BOOK_ID so should 404.
        r = requests.post(
            f"{BASE}/api/bookclubs",
            json={"name": "Sneaky", "book_id": BOOK_ID},
            headers=H("outsider"),
        )
        assert r.status_code == 404

    def test_create_room_succeeds(self):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            json={
                "name": "HP Re-read 2026",
                "book_id": BOOK_ID,
                "description": "Reading the test book together.",
                "schedule": "1 chapter / week",
            },
            headers=H("owner"),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["book_id"] == BOOK_ID
        assert data["book_total_chapters"] == 3
        assert data["owner_user_id"] == USERS["owner"]["user_id"]
        STATE["room_id"] = data["room_id"]

    def test_list_mine_shows_room(self):
        r = requests.get(f"{BASE}/api/bookclubs", headers=H("owner"))
        assert r.status_code == 200
        data = r.json()
        assert len(data["rooms"]) >= 1
        room = next(r for r in data["rooms"] if r["room_id"] == STATE["room_id"])
        assert room["my_role"] == "owner"
        assert room["member_count"] == 1


class TestBookclubInviteFlow:
    def test_outsider_cant_be_invited(self):
        # Outsider isn't friends with owner.
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/invite",
            json={"user_id": USERS["outsider"]["user_id"]},
            headers=H("owner"),
        )
        assert r.status_code == 403

    def test_invite_friend_succeeds(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/invite",
            json={"user_id": USERS["friend"]["user_id"]},
            headers=H("owner"),
        )
        assert r.status_code == 200

    def test_double_invite_rejected(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/invite",
            json={"user_id": USERS["friend"]["user_id"]},
            headers=H("owner"),
        )
        assert r.status_code == 409

    def test_friend_sees_pending_invite(self):
        r = requests.get(f"{BASE}/api/bookclubs", headers=H("friend"))
        assert r.status_code == 200
        data = r.json()
        assert len(data["invites"]) == 1
        assert data["invites"][0]["room_id"] == STATE["room_id"]

    def test_pending_count(self):
        r = requests.get(f"{BASE}/api/bookclubs/pending-count", headers=H("friend"))
        assert r.status_code == 200
        assert r.json()["pending_in"] == 1

    def test_outsider_cant_get_detail(self):
        r = requests.get(
            f"{BASE}/api/bookclubs/{STATE['room_id']}", headers=H("outsider"),
        )
        assert r.status_code == 403

    def test_accept_invite(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/accept", headers=H("friend"),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "active"

    def test_detail_lists_both_members(self):
        r = requests.get(
            f"{BASE}/api/bookclubs/{STATE['room_id']}", headers=H("friend"),
        )
        assert r.status_code == 200
        data = r.json()
        # Platform-owner oversight is auto-added to every bookclub as of
        # 2026-06-16 — exclude it for this "real members" headcount.
        real_members = [m for m in data["members"] if m["role"] != "oversight"]
        assert len(real_members) == 2
        roles = {m["user_id"]: m["role"] for m in real_members}
        assert roles[USERS["owner"]["user_id"]] == "owner"
        assert roles[USERS["friend"]["user_id"]] == "member"
        assert data["my_role"] == "member"


class TestRoomEditAndRoles:
    def test_member_cant_edit(self):
        r = requests.patch(
            f"{BASE}/api/bookclubs/{STATE['room_id']}",
            json={"name": "Pwned"},
            headers=H("friend"),
        )
        assert r.status_code == 403

    def test_owner_can_edit(self):
        r = requests.patch(
            f"{BASE}/api/bookclubs/{STATE['room_id']}",
            json={"description": "Updated desc", "schedule": "2 chapters / week"},
            headers=H("owner"),
        )
        assert r.status_code == 200
        assert r.json()["schedule"] == "2 chapters / week"

    def test_promote_friend_to_moderator(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/members/{USERS['friend']['user_id']}/role",
            json={"role": "moderator"},
            headers=H("owner"),
        )
        assert r.status_code == 200

    def test_moderator_can_invite_too(self):
        # Already at max friends, but pre-existing invite is gone (accepted).
        # Try with outsider — should still fail because outsider isn't friends with friend either.
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/invite",
            json={"user_id": USERS["outsider"]["user_id"]},
            headers=H("friend"),
        )
        assert r.status_code == 403


class TestMessages:
    def test_post_lobby_message(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages",
            json={"body": "Hey everyone! Excited to start.", "chapter_index": 0},
            headers=H("owner"),
        )
        assert r.status_code == 200
        assert r.json()["chapter_index"] == 0

    def test_post_chapter_message(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages",
            json={"body": "Loved the ending of chapter 1!", "chapter_index": 1},
            headers=H("friend"),
        )
        assert r.status_code == 200

    def test_post_invalid_chapter(self):
        # Book has 3 chapters; chapter 99 should reject.
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages",
            json={"body": "won't post", "chapter_index": 99},
            headers=H("owner"),
        )
        assert r.status_code == 400

    def test_list_all_messages(self):
        r = requests.get(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages",
            headers=H("owner"),
        )
        assert r.status_code == 200
        assert len(r.json()["messages"]) == 2

    def test_list_chapter_filter(self):
        r = requests.get(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages?chapter=1",
            headers=H("owner"),
        )
        assert r.status_code == 200
        msgs = r.json()["messages"]
        assert len(msgs) == 1
        assert msgs[0]["chapter_index"] == 1

    def test_non_member_cant_read(self):
        r = requests.get(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/messages",
            headers=H("outsider"),
        )
        assert r.status_code == 403


class TestProgressAndMilestones:
    def test_set_progress(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/progress",
            json={"current_chapter": 2},
            headers=H("friend"),
        )
        assert r.status_code == 200
        assert r.json()["current_chapter"] == 2

    def test_progress_clamps_to_total(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/progress",
            json={"current_chapter": 999},
            headers=H("friend"),
        )
        assert r.status_code == 200
        # Book has 3 chapters; should clamp.
        assert r.json()["current_chapter"] == 3

    def test_finish_fires_notification_to_owner(self):
        # Friend just finished — owner should have a bookclub_finished notification.
        ns = list(db.notifications.find({
            "user_id": USERS["owner"]["user_id"],
            "kind": "bookclub_finished",
        }))
        assert len(ns) >= 1


class TestTransferAndLeave:
    def test_owner_cant_leave_with_others(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/leave",
            headers=H("owner"),
        )
        assert r.status_code == 400

    def test_transfer_ownership(self):
        r = requests.post(
            f"{BASE}/api/bookclubs/{STATE['room_id']}/transfer",
            json={"new_owner_user_id": USERS["friend"]["user_id"]},
            headers=H("owner"),
        )
        assert r.status_code == 200
        # Original owner is now a moderator; can no longer delete.
        r2 = requests.delete(
            f"{BASE}/api/bookclubs/{STATE['room_id']}", headers=H("owner"),
        )
        assert r2.status_code == 403

    def test_new_owner_can_delete(self):
        r = requests.delete(
            f"{BASE}/api/bookclubs/{STATE['room_id']}", headers=H("friend"),
        )
        assert r.status_code == 200
        # Cascade: members + messages gone.
        assert db.bookclub_members.count_documents({"room_id": STATE["room_id"]}) == 0
        assert db.bookclub_messages.count_documents({"room_id": STATE["room_id"]}) == 0
