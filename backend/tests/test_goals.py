"""E2E tests for the reading-goals API."""
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

USER = {
    "user_id": f"user_goals_{uuid.uuid4().hex[:8]}",
    "token": f"sess_goals_{uuid.uuid4().hex}",
    "email": f"goals_{uuid.uuid4().hex[:8]}@example.com",
}


def H():
    return {"Authorization": f"Bearer {USER['token']}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": USER["user_id"], "email": USER["email"], "name": "Goal User",
        "is_admin": False, "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER["user_id"], "session_token": USER["token"],
        "expires_at": now + timedelta(days=7), "created_at": now,
    })
    yield
    db.users.delete_one({"user_id": USER["user_id"]})
    db.user_sessions.delete_many({"user_id": USER["user_id"]})
    db.reading_goals.delete_many({"user_id": USER["user_id"]})
    db.books.delete_many({"user_id": USER["user_id"]})


def test_empty_list():
    r = requests.get(f"{BASE}/api/goals", headers=H())
    assert r.status_code == 200
    assert r.json() == {"goals": []}


def test_create_year_goal():
    r = requests.post(f"{BASE}/api/goals", headers=H(), json={
        "metric": "books", "period_type": "year", "period_value": "2026", "target": 24,
    })
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["metric"] == "books"
    assert g["period_value"] == "2026"
    assert g["period_label"] == "2026"
    assert g["target"] == 24
    assert g["current"] == 0
    assert g["fraction"] == 0.0
    assert g["hit_at"] is None


def test_duplicate_returns_409():
    r = requests.post(f"{BASE}/api/goals", headers=H(), json={
        "metric": "books", "period_type": "year", "period_value": "2026", "target": 99,
    })
    assert r.status_code == 409


def test_bad_period_value_422():
    r = requests.post(f"{BASE}/api/goals", headers=H(), json={
        "metric": "books", "period_type": "month", "period_value": "bogus", "target": 5,
    })
    assert r.status_code == 422


def test_create_month_goal_with_words():
    r = requests.post(f"{BASE}/api/goals", headers=H(), json={
        "metric": "words", "period_type": "month", "period_value": "2026-02", "target": 50000,
    })
    assert r.status_code == 200
    g = r.json()
    assert g["period_label"] == "Feb 2026"
    assert g["metric"] == "words"


def test_progress_counts_finished_books():
    # Insert two books finished in 2026 with last_opened_at and progress_fraction=1.
    for i, words in enumerate((30000, 70000)):
        db.books.insert_one({
            "book_id": f"bk_{uuid.uuid4().hex[:8]}",
            "user_id": USER["user_id"],
            "title": f"Test Book {i}",
            "progress_fraction": 1.0,
            "last_opened_at": f"2026-06-{i + 1:02d}T10:00:00+00:00",
            "word_count": words,
        })
    # Insert a book finished outside the period — should be excluded.
    db.books.insert_one({
        "book_id": f"bk_{uuid.uuid4().hex[:8]}",
        "user_id": USER["user_id"], "title": "Excluded",
        "progress_fraction": 1.0, "last_opened_at": "2025-12-01T00:00:00+00:00",
        "word_count": 99999,
    })

    r = requests.get(f"{BASE}/api/goals", headers=H())
    assert r.status_code == 200
    goals = {g["period_label"]: g for g in r.json()["goals"]}
    year = goals["2026"]
    # 2 books finished in 2026, target 24.
    assert year["current"] == 2
    assert year["target"] == 24
    # Words goal for Feb 2026 — neither book was in Feb 2026, so 0.
    feb = goals["Feb 2026"]
    assert feb["current"] == 0


def test_celebrate_before_hit_400():
    g = requests.get(f"{BASE}/api/goals", headers=H()).json()["goals"][0]
    r = requests.post(f"{BASE}/api/goals/{g['goal_id']}/celebrate", headers=H())
    assert r.status_code == 400


def test_lower_target_triggers_hit_and_celebrate():
    # 2 books finished — lower target to 2 so the year goal flips to hit.
    goals = requests.get(f"{BASE}/api/goals", headers=H()).json()["goals"]
    year_goal = next(g for g in goals if g["period_label"] == "2026")
    r = requests.patch(f"{BASE}/api/goals/{year_goal['goal_id']}", headers=H(), json={"target": 2})
    assert r.status_code == 200
    # Re-fetch list — _maybe_mark_hit runs in list, stamps hit_at.
    refreshed = requests.get(f"{BASE}/api/goals", headers=H()).json()["goals"]
    year_refreshed = next(g for g in refreshed if g["period_label"] == "2026")
    assert year_refreshed["hit_at"] is not None
    assert year_refreshed["current"] >= year_refreshed["target"]
    # Mark celebrated
    r = requests.post(f"{BASE}/api/goals/{year_refreshed['goal_id']}/celebrate", headers=H())
    assert r.status_code == 200
    assert r.json()["hit_celebrated_at"] is not None
    # A notification should have been created.
    notif = db.notifications.find_one({"user_id": USER["user_id"], "kind": "reading_goal_hit"})
    assert notif is not None


def test_delete_goal():
    goals = requests.get(f"{BASE}/api/goals", headers=H()).json()["goals"]
    gid = goals[0]["goal_id"]
    r = requests.delete(f"{BASE}/api/goals/{gid}", headers=H())
    assert r.status_code == 200
    remaining = requests.get(f"{BASE}/api/goals", headers=H()).json()["goals"]
    assert all(g["goal_id"] != gid for g in remaining)
