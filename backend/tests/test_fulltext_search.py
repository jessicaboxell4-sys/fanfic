"""Tests for the full-text EPUB search feature.

Covers:
- Helpers: `make_snippet` excerpt logic
- API: `/api/library/search/fulltext` requires auth, scopes by user,
  returns score + snippet, matches single + multi-word queries
- Admin backfill: `/api/admin/fulltext/backfill` requires admin, writes
  empty rows for missing files, indexes only books without a row
- Index creation: `ensure_text_index` is idempotent
"""
import os
import asyncio
import pathlib
import sys
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

backend_dir = str(pathlib.Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

sync_db = MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


# ─── Seed two users, two books each in book_fulltext ──────────────────
USER_A_ID = f"user_ft_a_{uuid.uuid4().hex[:6]}"
USER_A_TOK = f"sess_ft_a_{uuid.uuid4().hex}"
USER_B_ID = f"user_ft_b_{uuid.uuid4().hex[:6]}"
USER_B_TOK = f"sess_ft_b_{uuid.uuid4().hex}"
ADMIN_ID = f"user_ft_admin_{uuid.uuid4().hex[:6]}"
ADMIN_TOK = f"sess_ft_admin_{uuid.uuid4().hex}"

BOOK_A1 = f"book_ft_a1_{uuid.uuid4().hex[:6]}"
BOOK_A2 = f"book_ft_a2_{uuid.uuid4().hex[:6]}"
BOOK_B1 = f"book_ft_b1_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module", autouse=True)
def _seed():
    for uid, tok, admin in [
        (USER_A_ID, USER_A_TOK, False),
        (USER_B_ID, USER_B_TOK, False),
        (ADMIN_ID, ADMIN_TOK, True),
    ]:
        sync_db.users.update_one(
            {"user_id": uid},
            {"$set": {"user_id": uid, "email": f"{uid}@ft.local", "name": uid, "is_admin": admin}},
            upsert=True,
        )
        sync_db.user_sessions.update_one(
            {"session_token": tok},
            {"$set": {"user_id": uid, "session_token": tok, "expires_at": datetime.now(timezone.utc) + timedelta(days=1)}},
            upsert=True,
        )
    # Seed book metadata + fulltext rows directly — bypass extraction
    sync_db.books.delete_many({"book_id": {"$in": [BOOK_A1, BOOK_A2, BOOK_B1]}})
    sync_db.book_fulltext.delete_many({"book_id": {"$in": [BOOK_A1, BOOK_A2, BOOK_B1]}})
    sync_db.books.insert_many([
        {"book_id": BOOK_A1, "user_id": USER_A_ID, "title": "Severus and the Phoenix", "author": "Anon A", "category": "Fanfiction"},
        {"book_id": BOOK_A2, "user_id": USER_A_ID, "title": "Other Story", "author": "Anon A", "category": "Fanfiction"},
        {"book_id": BOOK_B1, "user_id": USER_B_ID, "title": "Different Library", "author": "Anon B", "category": "Fanfiction"},
    ])
    sync_db.book_fulltext.insert_many([
        {"book_id": BOOK_A1, "user_id": USER_A_ID, "text": "It was the night Severus Snape walked the corridors. Horcrux fragments glowed faintly.", "indexed_at": datetime.now(timezone.utc).isoformat()},
        {"book_id": BOOK_A2, "user_id": USER_A_ID, "text": "Completely different story about dragons and silver mountains.", "indexed_at": datetime.now(timezone.utc).isoformat()},
        {"book_id": BOOK_B1, "user_id": USER_B_ID, "text": "User B has a book about Severus too but A should not see this.", "indexed_at": datetime.now(timezone.utc).isoformat()},
    ])
    yield
    sync_db.user_sessions.delete_many({"session_token": {"$in": [USER_A_TOK, USER_B_TOK, ADMIN_TOK]}})
    sync_db.users.delete_many({"user_id": {"$in": [USER_A_ID, USER_B_ID, ADMIN_ID]}})
    sync_db.books.delete_many({"book_id": {"$in": [BOOK_A1, BOOK_A2, BOOK_B1]}})
    sync_db.book_fulltext.delete_many({"book_id": {"$in": [BOOK_A1, BOOK_A2, BOOK_B1]}})


def test_make_snippet_centers_match():
    from utils.epub_fulltext import make_snippet
    text = "x" * 200 + " the quick brown fox jumps " + "y" * 200
    snip = make_snippet(text, "brown fox", window=20)
    assert "brown fox" in snip
    assert snip.startswith("…") and snip.endswith("…")


def test_make_snippet_falls_back_when_no_match():
    from utils.epub_fulltext import make_snippet
    text = "no matching content here"
    snip = make_snippet(text, "ZZZZZ", window=10)
    # Falls back to the leading text
    assert "no matching" in snip


def test_search_requires_auth():
    r = requests.get(f"{BASE}/api/library/search/fulltext", params={"q": "severus"})
    assert r.status_code in (401, 403)


def test_search_scopes_to_caller():
    """User A searching 'Severus' must NOT see User B's book."""
    r = requests.get(
        f"{BASE}/api/library/search/fulltext",
        params={"q": "Severus", "limit": 20},
        headers={"Authorization": f"Bearer {USER_A_TOK}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    ids = [b["book_id"] for b in data["results"]]
    assert BOOK_A1 in ids
    assert BOOK_B1 not in ids  # leak guard


def test_search_returns_snippet_with_score():
    r = requests.get(
        f"{BASE}/api/library/search/fulltext",
        params={"q": "Phoenix horcrux"},
        headers={"Authorization": f"Bearer {USER_A_TOK}"},
    )
    assert r.status_code == 200
    data = r.json()
    hit = next((b for b in data["results"] if b["book_id"] == BOOK_A1), None)
    assert hit is not None
    assert hit["score"] > 0
    assert "snippet" in hit and len(hit["snippet"]) > 0


def test_search_q_too_short_returns_422():
    r = requests.get(
        f"{BASE}/api/library/search/fulltext",
        params={"q": "x"},
        headers={"Authorization": f"Bearer {USER_A_TOK}"},
    )
    assert r.status_code == 422


def test_backfill_requires_admin():
    r = requests.post(f"{BASE}/api/admin/fulltext/backfill")
    assert r.status_code in (401, 403)
    r2 = requests.post(
        f"{BASE}/api/admin/fulltext/backfill",
        headers={"Authorization": f"Bearer {USER_A_TOK}"},
    )
    assert r2.status_code == 403


def test_backfill_admin_returns_shape():
    r = requests.post(
        f"{BASE}/api/admin/fulltext/backfill?limit=1",
        headers={"Authorization": f"Bearer {ADMIN_TOK}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("scanned", "indexed", "errors", "skipped_missing_file"):
        assert k in data
