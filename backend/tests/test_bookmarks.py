"""Tests for the reader-bookmarks API."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


def _mk_user():
    uid = f"user_bm_{uuid.uuid4().hex[:8]}"
    tok = f"sess_bm_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({"user_id": uid, "email": f"{uid}@e.com", "name": "Bm", "created_at": now.isoformat()})
    db.user_sessions.insert_one({"user_id": uid, "session_token": tok, "expires_at": now + timedelta(days=1)})
    return uid, tok


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _cleanup(uid):
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.books.delete_many({"user_id": uid})
    db.bookmarks.delete_many({"user_id": uid})


def test_add_list_and_delete_bookmark():
    uid, tok = _mk_user()
    try:
        bid = f"book_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({"book_id": bid, "user_id": uid, "title": "T", "author": "A", "category": "Fanfiction"})
        # add
        r = requests.post(f"{BASE}/api/books/{bid}/bookmarks", json={
            "cfi": "epubcfi(/6/4!/4/2[ch1]/2/4)", "note": "great line", "chapter_label": "Chapter 1", "percent": 0.12,
        }, headers=_h(tok))
        assert r.status_code == 200, r.text
        bm = r.json()["bookmark"]
        assert bm["note"] == "great line"
        assert bm["percent"] == 0.12
        # list
        r = requests.get(f"{BASE}/api/books/{bid}/bookmarks", headers=_h(tok))
        assert r.status_code == 200
        assert r.json()["count"] == 1
        # delete
        r = requests.delete(f"{BASE}/api/books/{bid}/bookmarks/{bm['bookmark_id']}", headers=_h(tok))
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        # list again — empty
        r = requests.get(f"{BASE}/api/books/{bid}/bookmarks", headers=_h(tok))
        assert r.json()["count"] == 0
    finally:
        _cleanup(uid)


def test_add_bookmark_is_idempotent_on_cfi():
    uid, tok = _mk_user()
    try:
        bid = f"book_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({"book_id": bid, "user_id": uid, "title": "T", "category": "Fanfiction"})
        cfi = "epubcfi(/6/4!/4/2[xyz]/2)"
        requests.post(f"{BASE}/api/books/{bid}/bookmarks", json={"cfi": cfi, "note": "first"}, headers=_h(tok))
        requests.post(f"{BASE}/api/books/{bid}/bookmarks", json={"cfi": cfi, "note": "updated"}, headers=_h(tok))
        rows = list(db.bookmarks.find({"user_id": uid}))
        assert len(rows) == 1
        assert rows[0]["note"] == "updated"
    finally:
        _cleanup(uid)


def test_add_bookmark_404_when_book_not_owned():
    uid, tok = _mk_user()
    try:
        # No book in DB for this user — POST should 404.
        r = requests.post(
            f"{BASE}/api/books/nope/bookmarks",
            json={"cfi": "epubcfi(/6/4)"},
            headers=_h(tok),
        )
        assert r.status_code == 404
    finally:
        _cleanup(uid)


def test_cross_library_listing_hydrates_book_metadata():
    uid, tok = _mk_user()
    try:
        bid1 = f"book_{uuid.uuid4().hex[:8]}"
        bid2 = f"book_{uuid.uuid4().hex[:8]}"
        db.books.insert_many([
            {"book_id": bid1, "user_id": uid, "title": "First", "author": "A", "category": "Fanfiction"},
            {"book_id": bid2, "user_id": uid, "title": "Second", "author": "B", "category": "Fanfiction"},
        ])
        requests.post(f"{BASE}/api/books/{bid1}/bookmarks", json={"cfi": "epubcfi(/6/4)", "note": "n1"}, headers=_h(tok))
        requests.post(f"{BASE}/api/books/{bid2}/bookmarks", json={"cfi": "epubcfi(/8/2)", "note": "n2"}, headers=_h(tok))
        r = requests.get(f"{BASE}/api/bookmarks", headers=_h(tok))
        assert r.status_code == 200
        bms = r.json()["bookmarks"]
        assert len(bms) == 2
        titles = {b["book"]["title"] for b in bms}
        assert titles == {"First", "Second"}
    finally:
        _cleanup(uid)


def test_note_is_capped_at_280_chars():
    uid, tok = _mk_user()
    try:
        bid = f"book_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({"book_id": bid, "user_id": uid, "title": "T", "category": "Fanfiction"})
        long_note = "x" * 1000
        r = requests.post(f"{BASE}/api/books/{bid}/bookmarks", json={
            "cfi": "epubcfi(/6/4)", "note": long_note,
        }, headers=_h(tok))
        assert r.status_code == 200
        bm = r.json()["bookmark"]
        assert len(bm["note"]) == 280
    finally:
        _cleanup(uid)


def test_other_user_cant_see_my_bookmarks():
    uid1, tok1 = _mk_user()
    uid2, tok2 = _mk_user()
    try:
        bid = f"book_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({"book_id": bid, "user_id": uid1, "title": "Mine", "category": "Fanfiction"})
        requests.post(f"{BASE}/api/books/{bid}/bookmarks", json={"cfi": "epubcfi(/6/4)"}, headers=_h(tok1))
        # User 2 querying same book path — book doesn't belong to them, so list returns empty
        r = requests.get(f"{BASE}/api/books/{bid}/bookmarks", headers=_h(tok2))
        assert r.status_code == 200
        assert r.json()["count"] == 0
    finally:
        _cleanup(uid1); _cleanup(uid2)
