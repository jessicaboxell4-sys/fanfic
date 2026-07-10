"""Test the /api/recommendations/similar endpoint with limit=3
(used by the new <CrossDeviceFinishStrip> on BookDetail).

The existing 6-card <SimilarBooksStrip> tests live alongside the
recommendations suite — this case specifically locks the limit=3
contract so the cross-device finish moment can never accidentally
expand into a busy 6-card grid.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]

UID = f"user_cdf_{uuid.uuid4().hex[:6]}"
TOK = f"sess_cdf_{uuid.uuid4().hex}"
SEED_ID = f"bk_cdf_seed_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": UID, "email": f"{UID}@ft.local",
        "name": "CDF tester", "is_admin": False,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": UID, "session_token": TOK,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    # Seed: 1 finished HP/Tester + 5 other HP books to choose from
    db.books.insert_one({
        "book_id": SEED_ID, "user_id": UID,
        "title": "Seed: HP Finished", "author": "Tester",
        "fandom": "Harry Potter", "category": "Fanfiction",
        "progress_fraction": 0.95, "finished_at": now.isoformat(),
        "is_trash": False,
    })
    for i in range(5):
        db.books.insert_one({
            "book_id": f"bk_cdf_rec_{i}", "user_id": UID,
            "title": f"HP Rec {i}", "author": f"Author {i}",
            "fandom": "Harry Potter", "category": "Fanfiction",
            "progress_fraction": 0.1, "is_trash": False,
        })
    yield
    db.users.delete_many({"user_id": UID})
    db.user_sessions.delete_many({"user_id": UID})
    db.books.delete_many({"user_id": UID})


def H():
    return {"Authorization": f"Bearer {TOK}"}


def test_similar_limit_3_returns_at_most_3():
    """Cross-device finish strip uses ?limit=3 — confirm clamping."""
    r = requests.get(f"{BASE}/api/recommendations/similar/{SEED_ID}?limit=3", headers=H())
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["recommendations"]) == 3
    # Match reason is exposed so the UI's "SAME FANDOM" pill works
    for rec in data["recommendations"]:
        assert "match_reason" in rec
        assert "book_id" in rec
        assert "title" in rec


def test_similar_limit_clamps_lower_bound():
    # limit=0 → falsy → endpoint falls back to default 6 (existing behavior)
    r = requests.get(f"{BASE}/api/recommendations/similar/{SEED_ID}?limit=0", headers=H())
    assert r.status_code == 200
    assert len(r.json()["recommendations"]) <= 6

    # limit=999 → clamped to 20
    r2 = requests.get(f"{BASE}/api/recommendations/similar/{SEED_ID}?limit=999", headers=H())
    assert r2.status_code == 200
    assert len(r2.json()["recommendations"]) <= 20


def test_similar_unknown_seed_404():
    r = requests.get(f"{BASE}/api/recommendations/similar/bk_does_not_exist", headers=H())
    assert r.status_code == 404
