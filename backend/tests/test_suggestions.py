"""Tests for the user-suggestions system."""
import os, uuid, requests, pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]

ADMIN = {"user_id": f"user_sgA_{uuid.uuid4().hex[:8]}", "token": f"sess_sgA_{uuid.uuid4().hex}", "name": "Admin"}
ALICE = {"user_id": f"user_sgB_{uuid.uuid4().hex[:8]}", "token": f"sess_sgB_{uuid.uuid4().hex}", "name": "Alice"}
BOB   = {"user_id": f"user_sgC_{uuid.uuid4().hex[:8]}", "token": f"sess_sgC_{uuid.uuid4().hex}", "name": "Bob"}

def H(u): return {"Authorization": f"Bearer {u['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for u, is_admin in [(ADMIN, True), (ALICE, False), (BOB, False)]:
        db.users.insert_one({
            "user_id": u["user_id"], "email": f"{u['user_id']}@example.com", "name": u["name"],
            "picture": "", "is_admin": is_admin, "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": u["user_id"], "session_token": u["token"],
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    yield
    ids = [ADMIN["user_id"], ALICE["user_id"], BOB["user_id"]]
    db.users.delete_many({"user_id": {"$in": ids}})
    db.user_sessions.delete_many({"user_id": {"$in": ids}})
    db.suggestions.delete_many({"submitter_user_id": {"$in": ids}})


@pytest.fixture
def alice_suggestion():
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "Add dark mode reader skin", "body": "Easy on the eyes at night.", "category": "improvement", "device": "iPhone"},
        headers=H(ALICE),
    )
    assert r.status_code == 200, r.text
    yield r.json()["suggestion_id"]


class TestSubmit:
    def test_unauth(self):
        r = requests.post(f"{BASE}/api/suggestions", data={"title": "x", "body": "y"})
        assert r.status_code == 401

    def test_title_required(self):
        r = requests.post(f"{BASE}/api/suggestions", data={"body": "no title"}, headers=H(ALICE))
        assert r.status_code == 422

    def test_invalid_category_422(self):
        r = requests.post(f"{BASE}/api/suggestions", data={"title": "abc", "body": "", "category": "wishlist"}, headers=H(ALICE))
        assert r.status_code == 422

    def test_submit_creates_with_auto_vote(self, alice_suggestion):
        r = requests.get(f"{BASE}/api/suggestions", headers=H(ALICE))
        items = [s for s in r.json()["suggestions"] if s["suggestion_id"] == alice_suggestion]
        assert len(items) == 1
        assert items[0]["votes_count"] == 1  # submitter auto-votes
        assert items[0]["i_voted"] is True
        assert items[0]["is_mine"] is True
        assert items[0]["status"] == "open"
        assert items[0]["category"] == "improvement"


class TestVoting:
    def test_bob_votes(self, alice_suggestion):
        r = requests.post(f"{BASE}/api/suggestions/{alice_suggestion}/vote", headers=H(BOB))
        assert r.status_code == 200
        assert r.json()["action"] == "voted"
        assert r.json()["votes_count"] == 2  # alice (auto) + bob

    def test_bob_unvotes(self, alice_suggestion):
        # First vote, then toggle off
        requests.post(f"{BASE}/api/suggestions/{alice_suggestion}/vote", headers=H(BOB))
        r = requests.post(f"{BASE}/api/suggestions/{alice_suggestion}/vote", headers=H(BOB))
        assert r.json()["action"] == "unvoted"

    def test_vote_unknown_404(self):
        r = requests.post(f"{BASE}/api/suggestions/sug_nope/vote", headers=H(BOB))
        assert r.status_code == 404


class TestListing:
    def test_filter_by_status(self, alice_suggestion):
        r = requests.get(f"{BASE}/api/suggestions", params={"status": "open"}, headers=H(ALICE))
        ids = [s["suggestion_id"] for s in r.json()["suggestions"]]
        assert alice_suggestion in ids
        r2 = requests.get(f"{BASE}/api/suggestions", params={"status": "done"}, headers=H(ALICE))
        ids2 = [s["suggestion_id"] for s in r2.json()["suggestions"]]
        assert alice_suggestion not in ids2

    def test_filter_by_category(self, alice_suggestion):
        r = requests.get(f"{BASE}/api/suggestions", params={"category": "improvement"}, headers=H(ALICE))
        ids = [s["suggestion_id"] for s in r.json()["suggestions"]]
        assert alice_suggestion in ids

    def test_mine_only(self, alice_suggestion):
        # Bob asks for mine-only; should NOT see Alice's
        r = requests.get(f"{BASE}/api/suggestions", params={"mine_only": "true"}, headers=H(BOB))
        ids = [s["suggestion_id"] for s in r.json()["suggestions"]]
        assert alice_suggestion not in ids


class TestSelfDelete:
    def test_bob_cant_delete_alices(self, alice_suggestion):
        r = requests.delete(f"{BASE}/api/suggestions/{alice_suggestion}", headers=H(BOB))
        assert r.status_code == 403

    def test_alice_deletes_own(self):
        c = requests.post(
            f"{BASE}/api/suggestions",
            data={"title": "Goner", "category": "bug", "device": "Mac"},
            headers=H(ALICE),
        )
        sid = c.json()["suggestion_id"]
        r = requests.delete(f"{BASE}/api/suggestions/{sid}", headers=H(ALICE))
        assert r.status_code == 200


class TestAdmin:
    def test_non_admin_cant_update(self, alice_suggestion):
        r = requests.put(
            f"{BASE}/api/admin/suggestions/{alice_suggestion}",
            json={"status": "planned"},
            headers=H(BOB),
        )
        assert r.status_code == 403

    def test_admin_changes_status(self, alice_suggestion):
        r = requests.put(
            f"{BASE}/api/admin/suggestions/{alice_suggestion}",
            json={"status": "planned", "admin_note": "On the roadmap for v1.5"},
            headers=H(ADMIN),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "planned"
        assert r.json()["admin_note"] == "On the roadmap for v1.5"

    def test_open_count(self):
        # Submit one fresh and ensure count reflects ≥1 open
        c = requests.post(
            f"{BASE}/api/suggestions",
            data={"title": "Counted suggestion", "category": "feature", "device": "Mac"},
            headers=H(ALICE),
        )
        r = requests.get(f"{BASE}/api/admin/suggestions/open-count", headers=H(ADMIN))
        assert r.status_code == 200
        assert r.json()["open"] >= 1
        # Cleanup
        requests.delete(f"{BASE}/api/suggestions/{c.json()['suggestion_id']}", headers=H(ALICE))

    def test_audit_logged(self, alice_suggestion):
        requests.put(
            f"{BASE}/api/admin/suggestions/{alice_suggestion}",
            json={"status": "done"},
            headers=H(ADMIN),
        )
        r = requests.get(
            f"{BASE}/api/admin/audit-log",
            params={"action_prefix": "suggestion.", "limit": 20},
            headers=H(ADMIN),
        )
        assert r.status_code == 200
        actions = [e["action"] for e in r.json()["entries"]]
        assert "suggestion.update" in actions

    def test_status_change_creates_notification(self, alice_suggestion):
        # Mark all of Alice's notifications read first so we can detect the new one
        db.notifications.delete_many({"user_id": ALICE["user_id"]})
        r = requests.put(
            f"{BASE}/api/admin/suggestions/{alice_suggestion}",
            json={"status": "under_review", "admin_note": "Looking into it"},
            headers=H(ADMIN),
        )
        assert r.status_code == 200
        # Alice should now have a notification
        rs = requests.get(f"{BASE}/api/notifications/unread-count", headers=H(ALICE))
        assert rs.status_code == 200
        assert rs.json()["unread"] >= 1
        rs2 = requests.get(f"{BASE}/api/notifications", headers=H(ALICE))
        titles = [n["title"] for n in rs2.json()["notifications"]]
        assert any("Suggestion update" in t for t in titles)
        # mark-all-read works
        m = requests.post(f"{BASE}/api/notifications/read-all", headers=H(ALICE))
        assert m.status_code == 200
        assert requests.get(f"{BASE}/api/notifications/unread-count", headers=H(ALICE)).json()["unread"] == 0

    def test_admin_delete(self):
        c = requests.post(
            f"{BASE}/api/suggestions",
            data={"title": "spam title", "category": "bug", "device": "Mac"},
            headers=H(ALICE),
        )
        sid = c.json()["suggestion_id"]
        r = requests.delete(f"{BASE}/api/admin/suggestions/{sid}", headers=H(ADMIN))
        assert r.status_code == 200
