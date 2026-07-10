"""Iter 76 — Private "Verdicts" axis on books (favorite / least / never again / etc.).

Covers:
  • GET    /api/verdicts/taxonomy
  • PATCH  /api/books/{book_id}/verdict   (set / clear / add / remove)
  • POST   /api/books/bulk/verdicts        (mass apply across many)
  • POST   /api/verdicts/custom            (user-defined slot)
  • DELETE /api/verdicts/custom/{key}      (also pulls off books)

Verifies the design contract from the design-doc message:
  - reading_state is single-select (one value or null)
  - verdicts is multi-select (array, set-like via $addToSet)
  - custom verdicts are scoped per-user (max 10)
  - deleting a custom verdict cleans it off owned books
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient


BASE = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _db():
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))[
        os.environ.get("DB_NAME", "test_database")
    ]


@pytest.fixture
def seeded():
    """Seed a user + 3 books we can mark up."""
    db = _db()
    suffix = uuid.uuid4().hex[:8]
    user_id = f"user_iter76_{suffix}"
    email = f"iter76-{suffix}@example.com"
    token = f"sess_iter76_{suffix}_{uuid.uuid4().hex}"

    db.users.insert_one({
        "user_id": user_id, "email": email,
        "name": "Iter76", "picture": "",
        "is_admin": False, "approval_status": "approved",
        "is_test_account": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    book_ids = []
    for i in range(3):
        bid = f"book_iter76_{suffix}_{i}"
        db.books.insert_one({
            "book_id": bid, "user_id": user_id,
            "filename": f"book{i}.epub", "title": f"Iter76 Book {i}",
            "author": "Test", "category": "Original Fiction",
            "size_bytes": 1000, "has_cover": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "_iter76": suffix,
        })
        book_ids.append(bid)

    yield {"user_id": user_id, "token": token, "book_ids": book_ids, "suffix": suffix}

    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_one({"session_token": token})
    db.books.delete_many({"_iter76": suffix})


def _auth(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def test_taxonomy_returns_builtins(seeded):
    r = requests.get(f"{BASE}/api/verdicts/taxonomy", headers=_auth(seeded["token"]), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    state_keys = {s["key"] for s in body["reading_states"]}
    verdict_keys = {v["key"] for v in body["builtin_verdicts"]}
    assert state_keys == {"to_read", "reading", "read", "dnf"}
    assert {"favorite", "least_favorite", "never_again", "reread_material", "recommend"} <= verdict_keys
    assert body["custom_verdicts"] == []
    assert body["custom_verdict_max"] == 10


def test_set_reading_state(seeded):
    bid = seeded["book_ids"][0]
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"reading_state": "read"},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["reading_state"] == "read"

    # Clear by sending empty string
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"reading_state": ""},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    # ``reading_state`` should be missing OR explicitly null after the $unset
    assert r.json().get("reading_state") in (None,)


def test_invalid_reading_state_rejected(seeded):
    bid = seeded["book_ids"][0]
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"reading_state": "halfway"},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 400


def test_add_remove_verdicts(seeded):
    bid = seeded["book_ids"][0]
    # Add favorite + recommend
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts_add": ["favorite", "recommend"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    assert set(r.json()["verdicts"]) == {"favorite", "recommend"}

    # Add favorite again — idempotent thanks to $addToSet
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts_add": ["favorite"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert set(r.json()["verdicts"]) == {"favorite", "recommend"}

    # Remove one
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts_remove": ["favorite"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert set(r.json()["verdicts"]) == {"recommend"}


def test_replace_verdicts_full_set(seeded):
    bid = seeded["book_ids"][0]
    # Replace the whole array
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts": ["never_again", "least_favorite"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    assert set(r.json()["verdicts"]) == {"never_again", "least_favorite"}


def test_unknown_verdict_key_rejected(seeded):
    bid = seeded["book_ids"][0]
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts_add": ["nope_not_a_real_verdict"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 400


def test_bulk_apply_reading_state(seeded):
    r = requests.post(
        f"{BASE}/api/books/bulk/verdicts",
        json={"book_ids": seeded["book_ids"], "reading_state": "to_read"},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 3
    # Verify each book got the state
    for bid in seeded["book_ids"]:
        doc = _db().books.find_one({"book_id": bid}, {"reading_state": 1})
        assert doc["reading_state"] == "to_read"


def test_bulk_add_verdicts(seeded):
    r = requests.post(
        f"{BASE}/api/books/bulk/verdicts",
        json={"book_ids": seeded["book_ids"], "verdicts_add": ["favorite"]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 3


def test_custom_verdict_add_and_delete(seeded):
    # Add a custom verdict
    r = requests.post(
        f"{BASE}/api/verdicts/custom",
        json={"label": "Pride read", "emoji": "🏳️‍🌈"},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["key"].startswith("custom_")
    assert body["label"] == "Pride read"
    custom_key = body["key"]

    # Apply it to a book
    bid = seeded["book_ids"][0]
    r = requests.patch(
        f"{BASE}/api/books/{bid}/verdict",
        json={"verdicts_add": [custom_key]},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200
    assert custom_key in r.json()["verdicts"]

    # Delete the custom verdict — should pull it off the book too
    r = requests.delete(
        f"{BASE}/api/verdicts/custom/{custom_key}",
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 200

    doc = _db().books.find_one({"book_id": bid}, {"verdicts": 1})
    assert custom_key not in (doc.get("verdicts") or [])


def test_custom_verdict_max_enforced(seeded):
    # Add up to the limit, then expect a 400 on the eleventh.
    db = _db()
    customs = [
        {"key": f"custom_seed_{i}", "label": f"Seed {i}", "emoji": "🌱",
         "created_at": datetime.now(timezone.utc).isoformat()}
        for i in range(10)
    ]
    db.users.update_one(
        {"user_id": seeded["user_id"]},
        {"$set": {"custom_verdicts": customs}},
    )
    r = requests.post(
        f"{BASE}/api/verdicts/custom",
        json={"label": "Overflow", "emoji": "💥"},
        headers=_auth(seeded["token"]), timeout=10,
    )
    assert r.status_code == 400, r.text


def test_only_owner_can_update_verdict(seeded):
    """Another user's session must NOT be able to mark someone else's book."""
    db = _db()
    other_token = f"sess_iter76_other_{uuid.uuid4().hex}"
    other_uid = f"user_iter76_other_{seeded['suffix']}"
    db.users.insert_one({
        "user_id": other_uid, "email": f"iter76-other-{seeded['suffix']}@example.com",
        "name": "Other", "picture": "", "is_admin": False,
        "approval_status": "approved", "is_test_account": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": other_uid, "session_token": other_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    try:
        bid = seeded["book_ids"][0]
        r = requests.patch(
            f"{BASE}/api/books/{bid}/verdict",
            json={"verdicts_add": ["favorite"]},
            headers=_auth(other_token), timeout=10,
        )
        # The book belongs to the seeded user; the other user must get 404.
        assert r.status_code == 404
    finally:
        db.users.delete_one({"user_id": other_uid})
        db.user_sessions.delete_one({"session_token": other_token})
