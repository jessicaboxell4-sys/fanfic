"""Tests for the always-on Platform Owner Oversight membership in bookclub rooms.

Policy (decided 2026-06-16):
- A single ``is_platform_owner: true`` user is auto-added to every newly
  created bookclub as a member with role ``"oversight"``.
- The oversight membership is visible to other members (badge) but never
  receives notifications.
- The oversight row cannot be kicked, promoted, demoted, or transferred to,
  and the platform owner cannot leave on their own — deleting the room is
  the only way to drop it.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]


def _seed_user(*, label: str, is_platform_owner: bool = False) -> dict:
    user_id = f"user_{label}_{uuid.uuid4().hex[:8]}"
    session = f"sess_{label}_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@oversight.test",
        "name": label.title(),
        "is_platform_owner": is_platform_owner,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": user_id, "session": session, "headers": {"Authorization": f"Bearer {session}"}}


def _seed_book_for(user_id: str) -> str:
    bid = f"book_ov_{uuid.uuid4().hex[:8]}"
    db.books.insert_one({
        "book_id": bid,
        "user_id": user_id,
        "title": "Oversight Test Book",
        "author": "Author",
        "category": "Original Fiction",
        "chapters": [{"title": f"Ch {i}", "href": f"ch{i}.xhtml"} for i in range(1, 4)],
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    return bid


@pytest.fixture(scope="module", autouse=True)
def reset_platform_owner_flag():
    """Some test fixtures elsewhere also create users; make sure exactly
    one ``is_platform_owner`` exists for this module, restored to the real
    Jessica row at teardown so production state isn't disturbed."""
    real_owner = db.users.find_one({"email": "jessicaboxell4@gmail.com"})
    # Save the existing flag-bearer set so we can restore precisely.
    snapshot = list(db.users.find({"is_platform_owner": True}, {"_id": 0, "user_id": 1}))
    db.users.update_many({"is_platform_owner": True}, {"$unset": {"is_platform_owner": ""}})
    yield real_owner
    db.users.update_many({"is_platform_owner": True}, {"$unset": {"is_platform_owner": ""}})
    for s in snapshot:
        db.users.update_one({"user_id": s["user_id"]}, {"$set": {"is_platform_owner": True}})
    # Restart backend cache by calling /health (the in-process cache resets
    # on backend restart — we tolerate stale cache here because subsequent
    # tests don't depend on it across pytest sessions).


def _bust_owner_cache():
    """The backend caches the platform-owner user_id in-process. Restart the
    process so subsequent _get_platform_owner_id() reads the DB fresh."""
    import subprocess
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, capture_output=True)
    import time
    time.sleep(3)


@pytest.fixture
def world():
    """Build a clean trio: a creator, the platform owner, and a friend.

    Backend is restarted so the platform-owner cache picks up the fresh flag.
    """
    creator = _seed_user(label="creator")
    owner = _seed_user(label="platformowner", is_platform_owner=True)
    friend = _seed_user(label="friend")
    _bust_owner_cache()
    book_id = _seed_book_for(creator["user_id"])
    yield {"creator": creator, "owner": owner, "friend": friend, "book_id": book_id, "room_ids": []}
    # Cleanup
    for u in (creator, owner, friend):
        db.users.delete_many({"user_id": u["user_id"]})
        db.user_sessions.delete_many({"user_id": u["user_id"]})
        db.books.delete_many({"user_id": u["user_id"]})


class TestOversightAutoMembership:
    def test_oversight_added_on_create(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Test Club", "description": "", "book_id": world["book_id"]},
        )
        assert r.status_code == 200, r.text
        room_id = r.json()["room_id"]
        # Mongo state: oversight member exists
        ov = db.bookclub_members.find_one(
            {"room_id": room_id, "user_id": world["owner"]["user_id"]}
        )
        assert ov is not None, "Platform owner was NOT auto-added"
        assert ov["role"] == "oversight"
        assert ov["status"] == "active"

    def test_oversight_shows_in_member_list(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Visible Test", "description": "", "book_id": world["book_id"]},
        )
        room_id = r.json()["room_id"]
        detail = requests.get(
            f"{BASE}/api/bookclubs/{room_id}", headers=world["creator"]["headers"]
        ).json()
        roles = {m["user_id"]: m["role"] for m in detail["members"]}
        assert roles.get(world["owner"]["user_id"]) == "oversight"

    def test_member_count_excludes_oversight(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Count Test", "description": "", "book_id": world["book_id"]},
        )
        rooms = requests.get(
            f"{BASE}/api/bookclubs", headers=world["creator"]["headers"]
        ).json()
        # creator should be member_count = 1 (themselves), oversight not counted
        target = next(rr for rr in rooms["rooms"] if rr["room_id"] == r.json()["room_id"])
        assert target["member_count"] == 1

    def test_oversight_cannot_be_kicked(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Kick Test", "description": "", "book_id": world["book_id"]},
        )
        room_id = r.json()["room_id"]
        kick = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/members/{world['owner']['user_id']}/remove",
            headers=world["creator"]["headers"],
        )
        assert kick.status_code == 400, kick.text
        assert "oversight" in kick.json()["detail"].lower()

    def test_oversight_cannot_be_promoted(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Promote Test", "description": "", "book_id": world["book_id"]},
        )
        room_id = r.json()["room_id"]
        promote = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/members/{world['owner']['user_id']}/role",
            headers=world["creator"]["headers"],
            json={"role": "moderator"},
        )
        assert promote.status_code == 400, promote.text

    def test_creator_who_is_platform_owner_doesnt_get_dup_row(self, world):
        # Platform owner creates their own bookclub — no duplicate row.
        owner_book = _seed_book_for(world["owner"]["user_id"])
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["owner"]["headers"],
            json={"name": "Self Test", "description": "", "book_id": owner_book},
        )
        assert r.status_code == 200, r.text
        room_id = r.json()["room_id"]
        rows = list(db.bookclub_members.find(
            {"room_id": room_id, "user_id": world["owner"]["user_id"]}
        ))
        assert len(rows) == 1, f"Expected exactly one row, got {len(rows)}"
        # And the single row should be the OWNER (not oversight) — the creator
        # role wins when they happen to be the platform owner.
        assert rows[0]["role"] == "owner"

    def test_platform_owner_cannot_self_leave(self, world):
        r = requests.post(
            f"{BASE}/api/bookclubs",
            headers=world["creator"]["headers"],
            json={"name": "Leave Test", "description": "", "book_id": world["book_id"]},
        )
        room_id = r.json()["room_id"]
        leave = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/leave",
            headers=world["owner"]["headers"],
        )
        assert leave.status_code == 400, leave.text
        assert "oversight" in leave.json()["detail"].lower()
