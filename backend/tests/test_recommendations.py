"""E2E tests for friend-recommendations widget.

Setup:
- Alice (me) — 1 book already owned (will be filtered out of recs)
- Bob — friend, library_visible_to_friends=True — has 2 finished books + 1 in-progress
- Carol — friend, library_visible_to_friends=False (opted out) — has 1 finished book (should NOT appear)
- Dave — NOT friend — has 1 finished book (should NOT appear)

Then verify:
- Recs surface from Bob only (sharing friend)
- "Already owned" book is filtered out
- Score ordering: finished > serious reader > shallow
- Grouping: when multiple friends finished the same book, group up
- Dismiss / undismiss flow
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
    "alice": {"user_id": f"user_rA_{uuid.uuid4().hex[:8]}", "token": f"sess_rA_{uuid.uuid4().hex}", "name": "Alice Rec"},
    "bob":   {"user_id": f"user_rB_{uuid.uuid4().hex[:8]}", "token": f"sess_rB_{uuid.uuid4().hex}", "name": "Bob Sharing"},
    "carol": {"user_id": f"user_rC_{uuid.uuid4().hex[:8]}", "token": f"sess_rC_{uuid.uuid4().hex}", "name": "Carol Private"},
    "dave":  {"user_id": f"user_rD_{uuid.uuid4().hex[:8]}", "token": f"sess_rD_{uuid.uuid4().hex}", "name": "Dave Stranger"},
    "erin":  {"user_id": f"user_rE_{uuid.uuid4().hex[:8]}", "token": f"sess_rE_{uuid.uuid4().hex}", "name": "Erin Sharing"},
}

# Books — one shared title across Bob + Erin to test grouping.
BOOKS = {
    "alice_owned":   {"book_id": f"b_a_{uuid.uuid4().hex[:6]}", "owner": "alice", "title": "I Already Own This", "author": "A. Owned"},
    "bob_finished_hot": {"book_id": f"b_b1_{uuid.uuid4().hex[:6]}", "owner": "bob",   "title": "The Best Fic Ever", "author": "Star Author", "progress_fraction": 1.0, "reading_minutes": 120},
    "bob_finished_ok":  {"book_id": f"b_b2_{uuid.uuid4().hex[:6]}", "owner": "bob",   "title": "Decent Read",       "author": "B. Author",   "progress_fraction": 0.96, "reading_minutes": 30},
    "bob_progress":     {"book_id": f"b_b3_{uuid.uuid4().hex[:6]}", "owner": "bob",   "title": "Long In Progress",  "author": "C. Author",   "progress_fraction": 0.40, "reading_minutes": 90},
    "carol_finished":   {"book_id": f"b_c_{uuid.uuid4().hex[:6]}",  "owner": "carol", "title": "Hidden Book",       "author": "Z. Author",   "progress_fraction": 1.0, "reading_minutes": 50},
    "dave_finished":    {"book_id": f"b_d_{uuid.uuid4().hex[:6]}",  "owner": "dave",  "title": "Stranger Book",     "author": "Y. Author",   "progress_fraction": 1.0, "reading_minutes": 50},
    "erin_shared_hot":  {"book_id": f"b_e1_{uuid.uuid4().hex[:6]}", "owner": "erin",  "title": "The Best Fic Ever", "author": "Star Author", "progress_fraction": 1.0, "reading_minutes": 60},
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
            "picture": "",
            "is_admin": False,
            "library_visible_to_friends": key in ("bob", "erin"),
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"],
            "session_token": u["token"],
            "expires_at": now + timedelta(days=7),
            "created_at": now,
        })
    for k, b in BOOKS.items():
        db.books.insert_one({
            "book_id": b["book_id"],
            "user_id": USERS[b["owner"]]["user_id"],
            "title": b["title"],
            "author": b["author"],
            "category": "Fanfiction",
            "fandom": "Test Fandom",
            "progress_fraction": b.get("progress_fraction", 0),
            "reading_minutes": b.get("reading_minutes", 0),
            "last_opened_at": now,
            "created_at": now,
        })
    # Alice ↔ Bob/Carol/Erin friendships (Dave is NOT a friend).
    for friend in ("bob", "carol", "erin"):
        a, b = _pair(USERS["alice"]["user_id"], USERS[friend]["user_id"])
        db.friendships.insert_one({
            "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
            "user_a": a, "user_b": b,
            "status": "accepted",
            "requested_by": USERS["alice"]["user_id"],
            "created_at": now, "updated_at": now,
        })
    yield
    uid_list = [u["user_id"] for u in USERS.values()]
    db.users.delete_many({"user_id": {"$in": uid_list}})
    db.user_sessions.delete_many({"user_id": {"$in": uid_list}})
    db.books.delete_many({"user_id": {"$in": uid_list}})
    db.friendships.delete_many({"$or": [{"user_a": {"$in": uid_list}}, {"user_b": {"$in": uid_list}}]})
    db.recommendation_dismissals.delete_many({"user_id": {"$in": uid_list}})


class TestFriendRecommendations:
    def test_unauth(self):
        r = requests.get(f"{BASE}/api/recommendations/friends")
        assert r.status_code == 401

    def test_returns_only_sharing_friends_books(self):
        r = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        assert r.status_code == 200
        data = r.json()
        titles = [rec["title"] for rec in data["recommendations"]]
        # Bob + Erin's books surface; Carol's (private) and Dave's (not a friend) don't.
        assert "Hidden Book" not in titles
        assert "Stranger Book" not in titles
        # Bob's "Long In Progress" has progress < 0.95 but minutes >= 30, so counts as serious reader.
        # We should see at least: bob_finished_hot, bob_finished_ok, bob_progress.
        assert "The Best Fic Ever" in titles
        assert "Decent Read" in titles
        assert "Long In Progress" in titles
        assert data["shared_friend_count"] == 2
        assert data["friend_count"] == 3

    def test_already_owned_filtered(self):
        # Alice already owns the title "I Already Own This" — but we didn't put a matching one in Bob's list, so add one now temporarily.
        # Insert Bob copy of Alice's owned book.
        tmp_book_id = f"b_tmp_{uuid.uuid4().hex[:6]}"
        db.books.insert_one({
            "book_id": tmp_book_id,
            "user_id": USERS["bob"]["user_id"],
            "title": "I Already Own This",
            "author": "A. Owned",
            "category": "Fanfiction",
            "progress_fraction": 1.0,
            "reading_minutes": 60,
            "last_opened_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
            assert r.status_code == 200
            titles = [rec["title"] for rec in r.json()["recommendations"]]
            # Even though Bob finished it, Alice owns it → filter out.
            assert "I Already Own This" not in titles
        finally:
            db.books.delete_one({"book_id": tmp_book_id})

    def test_grouping_multiple_friends(self):
        # Both Bob and Erin have "The Best Fic Ever" by "Star Author". Should group.
        r = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        data = r.json()
        best = next(rec for rec in data["recommendations"] if rec["title"] == "The Best Fic Ever")
        assert best["friend_count"] == 2, f"expected 2 friends, got {best['friend_count']}: {best['friends']}"
        assert best["finished_count"] == 2

    def test_ranking_finished_first(self):
        r = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        recs = r.json()["recommendations"]
        # "The Best Fic Ever" — 2 finishers + lots of minutes — should be #1.
        assert recs[0]["title"] == "The Best Fic Ever"

    def test_dismiss_and_undismiss(self):
        r1 = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        recs = r1.json()["recommendations"]
        target = next(rec for rec in recs if rec["title"] == "Decent Read")
        rec_key = target["rec_key"]
        # Dismiss
        rd = requests.post(f"{BASE}/api/recommendations/dismiss", json={"rec_key": rec_key}, headers=H("alice"))
        assert rd.status_code == 200
        # Should no longer appear.
        r2 = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        titles2 = [rec["title"] for rec in r2.json()["recommendations"]]
        assert "Decent Read" not in titles2
        # Listed in dismissed.
        rl = requests.get(f"{BASE}/api/recommendations/dismissed", headers=H("alice"))
        assert rl.status_code == 200
        assert any(d["rec_key"] == rec_key for d in rl.json()["dismissed"])
        # Undismiss → back in the list.
        ru = requests.post(f"{BASE}/api/recommendations/undismiss", json={"rec_key": rec_key}, headers=H("alice"))
        assert ru.status_code == 200
        r3 = requests.get(f"{BASE}/api/recommendations/friends", headers=H("alice"))
        titles3 = [rec["title"] for rec in r3.json()["recommendations"]]
        assert "Decent Read" in titles3

    def test_no_friends_returns_empty(self):
        r = requests.get(f"{BASE}/api/recommendations/friends", headers=H("dave"))
        assert r.status_code == 200
        assert r.json()["recommendations"] == []
        assert r.json()["friend_count"] == 0
