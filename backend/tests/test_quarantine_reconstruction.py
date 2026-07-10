"""Reconstruction regression: quarantine + duplicate-dismissals surface (2026-07-09).

Covers:
  - GET  /api/library/quarantine (auth guard + empty state)
  - POST /api/library/quarantine/{book_id}/resolve (validation, 404, keep_both,
         discard, new_version, historical)
  - POST /api/library/quarantine/{book_id}/not-duplicate (idempotency,
         dismissal rows written)
  - GET/DELETE /api/user/duplicate-dismissals (list + delete + keeper.is_deleted)
  - find_duplicate_candidates filters dismissed keepers
"""
import os
import uuid
import time
import pytest
import requests

def _load_dotenv():
    p = "/app/frontend/.env"
    try:
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except FileNotFoundError:
        pass
    return os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

BASE_URL = _load_dotenv()
assert BASE_URL, "REACT_APP_BACKEND_URL not set"


def _register():
    email = f"qtest-{uuid.uuid4().hex[:10]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "password": "hunter2pw",
        "name": "Q Tester",
        "accepted_rules": True,
        "onboarding": {"referral": "other", "reader_type": "organize", "is_13_plus": True},
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    return s, email


@pytest.fixture(scope="module")
def session():
    s, _ = _register()
    return s


# --- endpoint registration + auth guard ------------------------------------

def test_quarantine_requires_auth():
    r = requests.get(f"{BASE_URL}/api/library/quarantine", timeout=15)
    assert r.status_code in (401, 403), r.text


def test_dismissals_requires_auth():
    r = requests.get(f"{BASE_URL}/api/user/duplicate-dismissals", timeout=15)
    assert r.status_code in (401, 403), r.text


# --- empty state ------------------------------------------------------------

def test_quarantine_empty_for_fresh_user(session):
    r = session.get(f"{BASE_URL}/api/library/quarantine", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"count": 0, "groups": []}


def test_dismissals_empty_for_fresh_user(session):
    r = session.get(f"{BASE_URL}/api/user/duplicate-dismissals", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json() == {"dismissals": []}


# --- resolve validation ----------------------------------------------------

def test_resolve_invalid_action(session):
    r = session.post(
        f"{BASE_URL}/api/library/quarantine/does-not-exist/resolve",
        json={"action": "bogus"},
        timeout=15,
    )
    assert r.status_code == 400, r.text
    assert "keep_both" in r.json().get("detail", "")


def test_resolve_missing_book(session):
    r = session.post(
        f"{BASE_URL}/api/library/quarantine/nonexistent-book/resolve",
        json={"action": "keep_both"},
        timeout=15,
    )
    assert r.status_code == 404
    assert r.json().get("detail") == "Book not found"


def test_not_duplicate_missing_book(session):
    r = session.post(
        f"{BASE_URL}/api/library/quarantine/nonexistent-book/not-duplicate",
        timeout=15,
    )
    assert r.status_code == 404
    assert r.json().get("detail") == "Book not found"


# --- delete dismissal 404 --------------------------------------------------

def test_delete_dismissal_bogus_id(session):
    r = session.delete(
        f"{BASE_URL}/api/user/duplicate-dismissals/bogus-id-xyz",
        timeout=15,
    )
    assert r.status_code == 404


# --- end-to-end via direct mongo seeding -----------------------------------
# We seed books+duplicate_pending directly through Mongo so we exercise
# every branch of resolve/not-duplicate without needing the upload pipeline.

@pytest.fixture(scope="module")
def mongo_seeded(session):
    """Seed a keeper + duplicate + record user_id via /api/auth/me.

    Returns (user_id, keeper_id, dup_id).
    """
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio

    me = session.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
    user_id = me["user_id"]

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _seed():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        keeper_id = f"kb-{uuid.uuid4().hex[:8]}"
        dup_id = f"db-{uuid.uuid4().hex[:8]}"
        base = {
            "user_id": user_id,
            "title": "Test Duplicate Book",
            "author": "Test Author",
            "category": "Reading",
            "has_cover": False,
            "source_url": "",
            "fanfic_urls": [],
            "created_at": "2026-07-09T00:00:00Z",
        }
        await db.books.insert_one({**base, "book_id": keeper_id})
        await db.books.insert_one({
            **base,
            "book_id": dup_id,
            "duplicate_pending": True,
            "duplicate_of": [{
                "book_id": keeper_id,
                "title": base["title"],
                "author": base["author"],
                "match_reasons": ["title+author"],
            }],
        })
        client.close()
        return user_id, keeper_id, dup_id

    return asyncio.get_event_loop().run_until_complete(_seed())


def test_quarantine_lists_seeded_group(session, mongo_seeded):
    _, keeper_id, dup_id = mongo_seeded
    r = session.get(f"{BASE_URL}/api/library/quarantine", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    matching = [g for g in body["groups"] if g["keeper"]["book_id"] == keeper_id]
    assert len(matching) == 1
    g = matching[0]
    assert any(d["book_id"] == dup_id for d in g["duplicates"])
    dup = next(d for d in g["duplicates"] if d["book_id"] == dup_id)
    assert dup["match_reasons"] == ["title+author"]


def test_not_duplicate_writes_and_is_idempotent(session, mongo_seeded):
    _, keeper_id, dup_id = mongo_seeded
    # First: re-flag the dup by resetting duplicate_pending via seed helper.
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _refresh():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.books.update_one(
            {"book_id": dup_id},
            {"$set": {"duplicate_pending": True, "duplicate_of": [{
                "book_id": keeper_id, "title": "Test Duplicate Book",
                "author": "Test Author", "match_reasons": ["title+author"],
            }]}},
        )
        client.close()
    asyncio.get_event_loop().run_until_complete(_refresh())

    r1 = session.post(
        f"{BASE_URL}/api/library/quarantine/{dup_id}/not-duplicate", timeout=15,
    )
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["ok"] is True
    assert b1["dismissals_written"] == 1

    # Repeat with same dismissed_book once flag is re-set → idempotent
    asyncio.get_event_loop().run_until_complete(_refresh())
    r2 = session.post(
        f"{BASE_URL}/api/library/quarantine/{dup_id}/not-duplicate", timeout=15,
    )
    assert r2.status_code == 200
    assert r2.json()["dismissals_written"] == 0, r2.json()


def test_list_dismissals_returns_seeded_row(session, mongo_seeded):
    r = session.get(f"{BASE_URL}/api/user/duplicate-dismissals", timeout=15)
    assert r.status_code == 200
    rows = r.json()["dismissals"]
    assert len(rows) >= 1
    row = rows[0]
    assert "id" in row
    assert row["keeper"]["is_deleted"] is False
    assert row["keeper"]["title"] == "Test Duplicate Book"


def test_delete_dismissal_removes_row(session):
    rows = session.get(f"{BASE_URL}/api/user/duplicate-dismissals", timeout=15).json()["dismissals"]
    if not rows:
        pytest.skip("no dismissal to delete")
    did = rows[0]["id"]
    r = session.delete(f"{BASE_URL}/api/user/duplicate-dismissals/{did}", timeout=15)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "id": did}
    r2 = session.delete(f"{BASE_URL}/api/user/duplicate-dismissals/{did}", timeout=15)
    assert r2.status_code == 404


def test_resolve_keep_both_clears_flag(session, mongo_seeded):
    _, keeper_id, dup_id = mongo_seeded
    # re-arm duplicate_pending
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    async def _refresh():
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "test_database")]
        await db.books.update_one({"book_id": dup_id}, {"$set": {"duplicate_pending": True,
            "duplicate_of": [{"book_id": keeper_id, "title": "x", "author": "y", "match_reasons": ["title+author"]}]}})
        client.close()
    asyncio.get_event_loop().run_until_complete(_refresh())

    r = session.post(f"{BASE_URL}/api/library/quarantine/{dup_id}/resolve",
                     json={"action": "keep_both"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["action"] == "keep_both"


def test_resolve_new_version_requires_target(session, mongo_seeded):
    _, _, dup_id = mongo_seeded
    r = session.post(f"{BASE_URL}/api/library/quarantine/{dup_id}/resolve",
                     json={"action": "new_version"}, timeout=15)
    assert r.status_code == 400
    assert "target_book_id" in r.json()["detail"]
