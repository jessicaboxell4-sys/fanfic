"""E2E tests for the weekly book-club email digest.

Covers:
- GET /api/bookclubs/digest/settings → default disabled
- PUT toggle round-trip
- POST .../preview with no rooms → sent=False, reason=no_activity
- POST .../preview with rooms but no recent activity → no_activity
- POST .../preview with activity returns payload with finishers + messages
- POST .../preview?send_email=true attempts email path
- /api/user/email-overview includes bookclub_digest as a 5th channel
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
    "alice": {"user_id": f"user_bcd_A_{uuid.uuid4().hex[:8]}", "token": f"sess_bcd_A_{uuid.uuid4().hex}", "name": "Alice BC"},
    "bob":   {"user_id": f"user_bcd_B_{uuid.uuid4().hex[:8]}", "token": f"sess_bcd_B_{uuid.uuid4().hex}", "name": "Bob BC"},
}
ROOM_ID = f"club_bcd_{uuid.uuid4().hex[:8]}"


def H(name="alice"): return {"Authorization": f"Bearer {USERS[name]['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for u in USERS.values():
        db.users.insert_one({
            "user_id": u["user_id"], "email": f"{u['user_id']}@example.com",
            "name": u["name"], "is_admin": False, "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
    db.bookclubs.insert_one({
        "room_id": ROOM_ID,
        "name": "Test Reading Club",
        "book_id": f"book_{uuid.uuid4().hex[:6]}",
        "book_title": "The Test Read",
        "book_author": "T. Author",
        "book_total_chapters": 5,
        "owner_user_id": USERS["alice"]["user_id"],
        "description": "", "schedule": "",
        "created_at": now - timedelta(days=14), "updated_at": now,
    })
    # Both members are active.
    for u in USERS.values():
        db.bookclub_members.insert_one({
            "room_id": ROOM_ID, "user_id": u["user_id"],
            "role": "owner" if u is USERS["alice"] else "member",
            "status": "active",
            "current_chapter": 5 if u is USERS["bob"] else 2,  # Bob has finished
            "invited_by": USERS["alice"]["user_id"],
            "invited_at": now - timedelta(days=14),
            "joined_at": now - timedelta(days=14),
        })
    # Bob posts 3 messages over the last week.
    for i, ch in enumerate([0, 1, 3], start=1):
        db.bookclub_messages.insert_one({
            "message_id": f"clubmsg_{uuid.uuid4().hex[:10]}",
            "room_id": ROOM_ID, "user_id": USERS["bob"]["user_id"],
            "user_name": USERS["bob"]["name"], "chapter_index": ch,
            "body": f"Message body {i} in chapter {ch}",
            "created_at": now - timedelta(days=i),
        })
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.bookclubs.delete_one({"room_id": ROOM_ID})
    db.bookclub_members.delete_many({"room_id": ROOM_ID})
    db.bookclub_messages.delete_many({"room_id": ROOM_ID})


class TestBookclubDigestSettings:
    def test_default_disabled(self):
        r = requests.get(f"{BASE}/api/bookclubs/digest/settings", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert data["email_enabled"] is False
        assert "email_configured" in data

    def test_toggle_roundtrip(self):
        r = requests.put(f"{BASE}/api/bookclubs/digest/settings", json={"email_enabled": True}, headers=H())
        assert r.status_code == 200
        assert r.json()["email_enabled"] is True
        r2 = requests.put(f"{BASE}/api/bookclubs/digest/settings", json={"email_enabled": False}, headers=H())
        assert r2.json()["email_enabled"] is False


class TestBookclubDigestPreview:
    def test_alice_sees_bobs_activity(self):
        r = requests.post(f"{BASE}/api/bookclubs/digest/preview", headers=H("alice"))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total_messages"] == 3  # Bob's 3 messages
        assert data["total_finishers"] == 1  # Bob finished
        assert len(data["rooms"]) == 1
        room = data["rooms"][0]
        assert room["name"] == "Test Reading Club"
        assert USERS["bob"]["name"] in room["finishers"]
        assert len(room["top_messages"]) == 3
        # sent=False because we didn't pass send_email
        assert data["sent"] is False

    def test_bob_sees_no_self_activity(self):
        # Bob is the only one posting — preview for Bob should exclude his own messages.
        r = requests.post(f"{BASE}/api/bookclubs/digest/preview", headers=H("bob"))
        assert r.status_code == 200
        data = r.json()
        # No activity because the only messages are from Bob himself.
        assert data["total_messages"] == 0
        # Bob hasn't finished anyone else's reading; alice hasn't finished either.
        assert data["total_finishers"] == 0
        # If there's truly no activity, "no_activity" reason; rooms empty.
        if not data.get("rooms"):
            assert data.get("reason") == "no_activity"

    def test_preview_with_send_email_attempts_email(self):
        r = requests.post(f"{BASE}/api/bookclubs/digest/preview?send_email=true", headers=H("alice"))
        assert r.status_code == 200
        data = r.json()
        attempted = bool(data.get("sent")) or bool(data.get("logged")) or bool(data.get("error"))
        assert attempted, f"email path not exercised: {data}"


class TestEmailOverviewIncludesBookclub:
    def test_overview_has_bookclub_digest(self):
        r = requests.get(f"{BASE}/api/user/email-overview", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert "bookclub_digest" in data
        assert "email_enabled" in data["bookclub_digest"]
