"""E2E tests for the username flow."""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


def _seeded_user(seed):
    user = {
        "user_id": f"un_{seed}_{uuid.uuid4().hex[:6]}",
        "email": f"un_{seed}_{uuid.uuid4().hex[:6]}@example.com",
        "name": f"un_{seed}",
        "token": f"sess_{uuid.uuid4().hex}",
    }
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user["user_id"], "email": user["email"], "name": user["name"],
        "is_admin": False, "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user["user_id"], "session_token": user["token"],
        "expires_at": now + timedelta(days=7), "created_at": now,
    })
    return user


def cleanup(user):
    db.users.delete_one({"user_id": user["user_id"]})
    db.user_sessions.delete_many({"user_id": user["user_id"]})


@pytest.fixture
def me():
    u = _seeded_user("me")
    yield u
    cleanup(u)


@pytest.fixture
def them():
    u = _seeded_user("them")
    yield u
    cleanup(u)


def H(u):
    return {"Authorization": f"Bearer {u['token']}"}


def test_first_claim_no_previous(me):
    r = requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "myhandle"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["username"] == "myhandle"
    assert d["previous_username"] is None
    assert d["changed"] is True


def test_format_violations_rejected(me):
    bad = ["AB", "no spaces here", "_leading", "trailing_", "with!", "x" * 21]
    for h in bad:
        r = requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": h})
        assert r.status_code == 400, f"expected 400 for {h!r}, got {r.status_code}"


def test_mixed_case_normalized_to_lower(me):
    """Mixed case input gets lowercased automatically — convenience UX."""
    r = requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "Mixed_Case"})
    assert r.status_code == 200
    assert r.json()["username"] == "mixed_case"


def test_reserved_rejected(me):
    r = requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "admin"})
    assert r.status_code == 400
    assert "reserved" in r.json()["detail"]


def test_uniqueness(me, them):
    requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "taken_one"})
    r = requests.patch(f"{BASE}/api/auth/username", headers=H(them), json={"username": "taken_one"})
    assert r.status_code == 409


def test_change_stamps_previous(me):
    requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "brad42"})
    r = requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "imcrazy42"})
    assert r.status_code == 200
    d = r.json()
    assert d["username"] == "imcrazy42"
    assert d["previous_username"] == "brad42"


def test_clear_previous(me):
    requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "brad43"})
    requests.patch(f"{BASE}/api/auth/username", headers=H(me), json={"username": "imcrazy43"})
    r = requests.delete(f"{BASE}/api/auth/previous-username", headers=H(me))
    assert r.status_code == 200
    me_doc = db.users.find_one({"user_id": me["user_id"]}, {"previous_username": 1})
    assert me_doc.get("previous_username") is None


def test_availability_check(me):
    # Reserved
    r = requests.get(f"{BASE}/api/auth/username-available", headers=H(me), params={"handle": "admin"})
    assert r.json()["available"] is False
    # Bad format
    r = requests.get(f"{BASE}/api/auth/username-available", headers=H(me), params={"handle": "BAD!"})
    assert r.json()["available"] is False
    # Open handle
    r = requests.get(f"{BASE}/api/auth/username-available", headers=H(me), params={"handle": "open_handle_test"})
    assert r.json()["available"] is True


def test_friend_request_by_username(me, them):
    requests.patch(f"{BASE}/api/auth/username", headers=H(them), json={"username": "findme"})
    # @-prefix
    r = requests.post(f"{BASE}/api/friends/request", headers=H(me), json={"target_username": "@findme"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"
    assert r.json()["other_user_id"] == them["user_id"]
    # Clean fixture data
    db.friendships.delete_many({"$or": [{"user_a": me["user_id"]}, {"user_b": me["user_id"]}]})


def test_friend_request_username_not_found(me):
    r = requests.post(f"{BASE}/api/friends/request", headers=H(me), json={"target_username": "does_not_exist_99"})
    assert r.status_code == 404


def test_register_with_username():
    em = f"reg_{uuid.uuid4().hex[:8]}@example.com"
    handle = f"newuser_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE}/api/auth/register", json={"email": em, "password": "hunter2pw", "username": handle})
    assert r.status_code == 200, r.text
    assert r.json()["username"] == handle
    # cleanup
    doc = db.users.find_one({"email": em})
    if doc:
        db.users.delete_one({"_id": doc["_id"]})
