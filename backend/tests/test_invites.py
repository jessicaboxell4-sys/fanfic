"""E2E tests for the invite-by-email flow."""
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
    "inviter": {"user_id": f"user_iA_{uuid.uuid4().hex[:8]}", "token": f"sess_iA_{uuid.uuid4().hex}", "name": "Inviter One"},
    "joiner":  {"user_id": f"user_iB_{uuid.uuid4().hex[:8]}", "token": f"sess_iB_{uuid.uuid4().hex}", "name": "Joiner Two"},
    "existing": {"user_id": f"user_iC_{uuid.uuid4().hex[:8]}", "token": f"sess_iC_{uuid.uuid4().hex}", "name": "Existing Three"},
}


def H(name): return {"Authorization": f"Bearer {USERS[name]['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for u in USERS.values():
        db.users.insert_one({
            "user_id": u["user_id"],
            "email": f"{u['user_id']}@example.com",
            "name": u["name"],
            "picture": "",
            "is_admin": False,
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
    db.invites.delete_many({"inviter_user_id": {"$in": uid_list}})


@pytest.fixture(scope="module")
def invite_token():
    """Create a fresh pending invite once for the whole module and return its token."""
    target = f"shared-{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(
        f"{BASE}/api/friends/invite",
        json={"email": target},
        headers=H("inviter"),
    )
    assert r.status_code == 200, r.text
    inv = db.invites.find_one({"invite_id": r.json()["invite_id"]})
    assert inv is not None
    return inv["token"]


class TestInviteFlow:
    def test_unauth_blocked(self):
        r = requests.post(f"{BASE}/api/friends/invite", json={"email": "x@example.com"})
        assert r.status_code == 401

    def test_cant_invite_self(self):
        r = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": f"{USERS['inviter']['user_id']}@example.com"},
            headers=H("inviter"),
        )
        assert r.status_code == 400

    def test_existing_user_falls_through_to_friend_request(self):
        r = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": f"{USERS['existing']['user_id']}@example.com"},
            headers=H("inviter"),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["path"] in ("friend_request_sent", "auto_accepted")
        assert data["other_user_id"] == USERS["existing"]["user_id"]
        # Verify a friendship row was created
        a, b = sorted([USERS["inviter"]["user_id"], USERS["existing"]["user_id"]])
        rel = db.friendships.find_one({"user_a": a, "user_b": b})
        assert rel is not None
        # Cleanup
        db.friendships.delete_one({"user_a": a, "user_b": b})

    def test_brand_new_email_creates_invite(self):
        target = f"new-{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": target, "note": "Hey!"},
            headers=H("inviter"),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["path"] in ("invite_sent", "invite_created_email_failed")
        assert data["target_email"] == target
        assert data["status"] == "pending"
        inv = db.invites.find_one({"invite_id": data["invite_id"]})
        assert inv is not None, f"Inserted invite {data['invite_id']} not found in DB"

    def test_duplicate_pending_returns_same(self):
        target = f"dup-{uuid.uuid4().hex[:6]}@example.com"
        r1 = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": target},
            headers=H("inviter"),
        )
        r2 = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": target},
            headers=H("inviter"),
        )
        assert r2.json()["path"] == "invite_already_pending"
        assert r2.json()["invite_id"] == r1.json()["invite_id"]

    def test_preview_invite_public(self, invite_token):
        r = requests.get(f"{BASE}/api/invites/{invite_token}")  # NO auth header
        assert r.status_code == 200
        data = r.json()
        assert data["inviter_name"] == "Inviter One"
        assert data["status"] == "pending"

    def test_preview_unknown_token_404(self):
        r = requests.get(f"{BASE}/api/invites/totally-fake-token")
        assert r.status_code == 404

    def test_accept_requires_auth(self, invite_token):
        r = requests.post(f"{BASE}/api/invites/{invite_token}/accept")
        assert r.status_code == 401

    def test_inviter_cant_accept_own(self, invite_token):
        r = requests.post(
            f"{BASE}/api/invites/{invite_token}/accept",
            headers=H("inviter"),
        )
        assert r.status_code == 400

    def test_joiner_accepts_creates_friendship(self, invite_token):
        r = requests.post(
            f"{BASE}/api/invites/{invite_token}/accept",
            headers=H("joiner"),
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accepted"
        # Both sides see accepted friendship
        for who in ("inviter", "joiner"):
            f = requests.get(f"{BASE}/api/friends", headers=H(who)).json()
            assert len(f["accepted"]) >= 1

    def test_accept_twice_400(self, invite_token):
        r = requests.post(
            f"{BASE}/api/invites/{invite_token}/accept",
            headers=H("joiner"),
        )
        assert r.status_code == 400  # already accepted

    def test_expired_invite_410(self):
        # Insert a manually-expired invite and try to accept it.
        old_token = uuid.uuid4().hex
        db.invites.insert_one({
            "invite_id": f"inv_{uuid.uuid4().hex[:12]}",
            "token": old_token,
            "inviter_user_id": USERS["inviter"]["user_id"],
            "target_email": "ancient@example.com",
            "status": "pending",
            "created_at": datetime.now(timezone.utc) - timedelta(days=60),
            "expires_at": datetime.now(timezone.utc) - timedelta(days=30),
        })
        r = requests.post(f"{BASE}/api/invites/{old_token}/accept", headers=H("joiner"))
        assert r.status_code == 410

    def test_list_my_invites(self):
        r = requests.get(f"{BASE}/api/friends/invites", headers=H("inviter"))
        assert r.status_code == 200
        invites = r.json()["invites"]
        assert len(invites) >= 1

    def test_cancel_pending_invite(self):
        # Create then cancel
        target = f"cancel-{uuid.uuid4().hex[:6]}@example.com"
        c = requests.post(
            f"{BASE}/api/friends/invite",
            json={"email": target},
            headers=H("inviter"),
        )
        inv_id = c.json()["invite_id"]
        d = requests.delete(f"{BASE}/api/friends/invites/{inv_id}", headers=H("inviter"))
        assert d.status_code == 200
        # Confirm gone
        assert db.invites.find_one({"invite_id": inv_id}) is None
