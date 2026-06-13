"""End-to-end tests for the chat / messaging system.

Covers:
- Admin CRUD on /api/admin/chat-rooms (create, update, delete, list)
- Auth gating: non-admin can't create rooms; non-member can't read/post
- User flow: list my rooms, post message, list messages, mark read,
  unread-count badge
- Attachments: book (requires book ownership), palette token
- Audit log entries: chat_room.create / update / delete
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


ADMIN_ID = f"user_chatA_{uuid.uuid4().hex[:8]}"
ADMIN_TOKEN = f"sess_chatA_{uuid.uuid4().hex}"
USER_A_ID = f"user_chatU1_{uuid.uuid4().hex[:8]}"
USER_A_TOKEN = f"sess_chatU1_{uuid.uuid4().hex}"
USER_B_ID = f"user_chatU2_{uuid.uuid4().hex[:8]}"
USER_B_TOKEN = f"sess_chatU2_{uuid.uuid4().hex}"
USER_C_ID = f"user_chatU3_{uuid.uuid4().hex[:8]}"
USER_C_TOKEN = f"sess_chatU3_{uuid.uuid4().hex}"


def H(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    rows = [
        (ADMIN_ID, ADMIN_TOKEN, True, "Chat Admin"),
        (USER_A_ID, USER_A_TOKEN, False, "User Alpha"),
        (USER_B_ID, USER_B_TOKEN, False, "User Bravo"),
        (USER_C_ID, USER_C_TOKEN, False, "User Charlie"),
    ]
    for uid, tok, is_admin, name in rows:
        db.users.insert_one({
            "user_id": uid, "email": f"{uid}@example.com", "name": name,
            "picture": "", "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": uid, "session_token": tok,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    yield
    uid_list = [ADMIN_ID, USER_A_ID, USER_B_ID, USER_C_ID]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.chat_rooms.delete_many({"created_by": {"$in": uid_list}})
    db.chat_messages.delete_many({"sender_user_id": {"$in": uid_list}})
    db.chat_reads.delete_many({"user_id": {"$in": uid_list}})
    db.admin_audit.delete_many({"actor_id": {"$in": uid_list}})
    db.books.delete_many({"user_id": {"$in": uid_list}})


# ---------- Admin CRUD ----------

class TestAdminChatRoomCRUD:
    def test_unauth_create_blocked(self):
        r = requests.post(f"{BASE}/api/admin/chat-rooms", json={"name": "x", "member_user_ids": [USER_A_ID]})
        assert r.status_code == 401

    def test_non_admin_create_blocked(self):
        r = requests.post(
            f"{BASE}/api/admin/chat-rooms",
            json={"name": "x", "member_user_ids": [USER_A_ID]},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 403

    def test_admin_creates_room(self):
        r = requests.post(
            f"{BASE}/api/admin/chat-rooms",
            json={"name": "Beta readers", "member_user_ids": [USER_A_ID, USER_B_ID]},
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "Beta readers"
        assert set(data["member_user_ids"]) == {USER_A_ID, USER_B_ID}
        assert data["created_by"] == ADMIN_ID
        assert data["room_id"].startswith("room_")
        # Stash for later
        TestAdminChatRoomCRUD.room_id = data["room_id"]

    def test_create_rejects_unknown_member(self):
        r = requests.post(
            f"{BASE}/api/admin/chat-rooms",
            json={"name": "bad", "member_user_ids": ["user_does_not_exist"]},
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code == 400

    def test_create_rejects_empty_members(self):
        r = requests.post(
            f"{BASE}/api/admin/chat-rooms",
            json={"name": "empty", "member_user_ids": []},
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code in (400, 422)

    def test_admin_lists_rooms(self):
        r = requests.get(f"{BASE}/api/admin/chat-rooms", headers=H(ADMIN_TOKEN))
        assert r.status_code == 200
        ids = [room["room_id"] for room in r.json()["rooms"]]
        assert TestAdminChatRoomCRUD.room_id in ids

    def test_admin_updates_room_members(self):
        rid = TestAdminChatRoomCRUD.room_id
        r = requests.put(
            f"{BASE}/api/admin/chat-rooms/{rid}",
            json={"member_user_ids": [USER_A_ID, USER_B_ID, USER_C_ID]},
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code == 200, r.text
        assert set(r.json()["member_user_ids"]) == {USER_A_ID, USER_B_ID, USER_C_ID}

    def test_update_404_unknown_room(self):
        r = requests.put(
            f"{BASE}/api/admin/chat-rooms/room_xxx",
            json={"name": "nope"},
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code == 404


# ---------- User-side flow ----------

class TestUserChatFlow:
    @classmethod
    def setup_class(cls):
        # Get the room from previous class.
        cls.room_id = TestAdminChatRoomCRUD.room_id

    def test_list_my_rooms_member(self):
        r = requests.get(f"{BASE}/api/chat/rooms", headers=H(USER_A_TOKEN))
        assert r.status_code == 200
        rooms = r.json()["rooms"]
        assert any(x["room_id"] == self.room_id for x in rooms)
        # Each room has members hydrated
        room = next(x for x in rooms if x["room_id"] == self.room_id)
        assert "members" in room and len(room["members"]) == 3
        assert any(m.get("name") == "User Bravo" for m in room["members"])

    def test_list_messages_member_empty(self):
        r = requests.get(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 200
        assert r.json()["messages"] == []

    def test_non_member_blocked(self):
        # Admin is NOT a member of this room
        r = requests.get(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            headers=H(ADMIN_TOKEN),
        )
        assert r.status_code == 403

    def test_post_text_message(self):
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={"body": "Hello from Alpha", "kind": "text"},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["body"] == "Hello from Alpha"
        assert msg["sender_user_id"] == USER_A_ID
        assert msg["sender_name"] == "User Alpha"

    def test_empty_text_rejected(self):
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={"body": "   ", "kind": "text"},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 400

    def test_post_book_attachment_requires_ownership(self):
        # USER_A doesn't own this book
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={"body": "check this", "kind": "book", "attachment": {"book_id": "book_not_real"}},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 404

    def test_post_book_attachment_happy_path(self):
        bid = f"book_chat_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_A_ID,
            "book_id": bid,
            "title": "Test Fanfic",
            "author": "A. Writer",
        })
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={"body": "check this", "kind": "book", "attachment": {"book_id": bid}},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["kind"] == "book"
        assert m["attachment"]["book_id"] == bid
        assert m["attachment"]["book_title"] == "Test Fanfic"
        assert m["attachment"]["book_author"] == "A. Writer"

    def test_post_palette_attachment(self):
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={
                "body": "love this colour",
                "kind": "palette",
                "attachment": {"palette_token": "ss-p-forest", "palette_name": "Forest"},
            },
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 200
        m = r.json()
        assert m["kind"] == "palette"
        assert m["attachment"]["palette_token"] == "ss-p-forest"

    def test_palette_missing_token_400(self):
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            json={"body": "x", "kind": "palette"},
            headers=H(USER_A_TOKEN),
        )
        assert r.status_code == 400

    def test_unread_count_for_other_user(self):
        # USER_B never read; should see A's messages as unread
        r = requests.get(f"{BASE}/api/chat/unread-count", headers=H(USER_B_TOKEN))
        assert r.status_code == 200
        assert r.json()["unread"] >= 3  # text + book + palette

    def test_mark_read_zeros_unread(self):
        r = requests.post(
            f"{BASE}/api/chat/rooms/{self.room_id}/read",
            headers=H(USER_B_TOKEN),
        )
        assert r.status_code == 200
        r2 = requests.get(f"{BASE}/api/chat/unread-count", headers=H(USER_B_TOKEN))
        assert r2.json()["unread"] == 0

    def test_sender_own_messages_dont_count_as_unread(self):
        # USER_A's own posts shouldn't show as unread for USER_A
        r = requests.get(f"{BASE}/api/chat/unread-count", headers=H(USER_A_TOKEN))
        assert r.json()["unread"] == 0

    def test_messages_listed_in_chronological_order(self):
        r = requests.get(
            f"{BASE}/api/chat/rooms/{self.room_id}/messages",
            headers=H(USER_A_TOKEN),
        )
        msgs = r.json()["messages"]
        assert len(msgs) >= 3
        timestamps = [m["created_at"] for m in msgs]
        assert timestamps == sorted(timestamps)


class TestAuditLog:
    def test_room_create_was_audited(self):
        r = requests.get(
            f"{BASE}/api/admin/audit-log",
            headers=H(ADMIN_TOKEN),
            params={"action_prefix": "chat_room.", "limit": 50},
        )
        assert r.status_code == 200
        actions = [e["action"] for e in r.json()["entries"]]
        assert "chat_room.create" in actions
        assert "chat_room.update" in actions


class TestAdminChatRoomDelete:
    def test_delete_room_wipes_messages(self):
        # Create a fresh room to delete cleanly
        c = requests.post(
            f"{BASE}/api/admin/chat-rooms",
            json={"name": "Doomed room", "member_user_ids": [USER_A_ID, USER_B_ID]},
            headers=H(ADMIN_TOKEN),
        )
        rid = c.json()["room_id"]
        requests.post(
            f"{BASE}/api/chat/rooms/{rid}/messages",
            json={"body": "soon to be gone", "kind": "text"},
            headers=H(USER_A_TOKEN),
        )
        d = requests.delete(f"{BASE}/api/admin/chat-rooms/{rid}", headers=H(ADMIN_TOKEN))
        assert d.status_code == 200
        # Messages collection should be empty for that room
        assert db.chat_messages.count_documents({"room_id": rid}) == 0
        # Listing rooms shouldn't include it
        rooms = requests.get(f"{BASE}/api/admin/chat-rooms", headers=H(ADMIN_TOKEN)).json()["rooms"]
        assert not any(x["room_id"] == rid for x in rooms)
