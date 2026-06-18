"""Tests for the cross-device reading sync + stuck books + DNF."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from passlib.hash import bcrypt as bcrypt_hash

from deps import db


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


def _seed():
    """Create a pre-approved user directly in Mongo and log them in.
    Returns (uid, email, password, session)."""
    uid = f"synctest_{uuid.uuid4().hex[:10]}"
    email = f"{uid}@example.com"
    pw = "sync-" + uuid.uuid4().hex[:8]

    async def insert():
        await db.users.insert_one({
            "user_id": uid, "email": email, "name": "Sync Tester",
            "password_hash": bcrypt_hash.hash(pw),
            "is_admin": False, "is_moderator": False,
            "approval_status": "approved",
        })
    asyncio.get_event_loop().run_until_complete(insert())
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return uid, email, pw, s


def _seed_book(uid: str, title="Sync Test Book", **kwargs):
    """Insert a `books` doc directly so we don't depend on epub upload."""
    book_id = f"bk_{uuid.uuid4().hex[:14]}"
    doc = {
        "book_id": book_id, "user_id": uid,
        "title": title, "author": "Sync Author", "fandom": "",
        "category": "Original Fiction",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "trashed": False, "is_dnf": False,
        "progress_fraction": 0.0,
        **kwargs,
    }
    asyncio.get_event_loop().run_until_complete(db.books.insert_one(doc))
    return book_id


def _cleanup(uid: str, book_ids):
    async def go():
        await db.books.delete_many({"book_id": {"$in": list(book_ids)}})
        await db.reading_cursors.delete_many({"user_id": uid})
        await db.users.delete_many({"user_id": uid})
        await db.notifications.delete_many({"user_id": uid})
    asyncio.get_event_loop().run_until_complete(go())


def test_cursor_push_and_pull():
    """Cursor push upserts, pull returns the same doc, second device
    sees the same cursor — covers the core cross-device sync."""
    uid, _, _, s1 = _seed()
    book_id = _seed_book(uid)
    try:
        r = s1.post(f"{BASE}/api/books/{book_id}/cursor", json={
            "cfi": "epubcfi(/6/4)", "percent": 0.42,
            "chapter_label": "Chapter 5",
            "device_id": "dev_laptop_xyz", "device_label": "Mac",
        })
        assert r.status_code == 200, r.text
        # Pull from the same session — should reflect the write.
        g = s1.get(f"{BASE}/api/books/{book_id}/cursor")
        assert g.status_code == 200
        assert g.json()["percent"] == 0.42
        assert g.json()["device_label"] == "Mac"
        # Push from a different device (same user) overwrites the cursor.
        s1.post(f"{BASE}/api/books/{book_id}/cursor", json={
            "cfi": "epubcfi(/6/8)", "percent": 0.55,
            "device_id": "dev_phone_xyz", "device_label": "iPhone",
        })
        g2 = s1.get(f"{BASE}/api/books/{book_id}/cursor")
        assert g2.json()["percent"] == 0.55
        assert g2.json()["device_label"] == "iPhone"
    finally:
        _cleanup(uid, [book_id])


def test_cursor_404_for_unowned_book():
    """Pushing a cursor on someone else's book id → 404."""
    uid, _, _, s = _seed()
    try:
        r = s.post(f"{BASE}/api/books/not_my_book_id/cursor", json={"cfi": "x"})
        assert r.status_code == 404
    finally:
        _cleanup(uid, [])


def test_stuck_books_smart_shelf():
    """Books opened >30d ago with <30% progress show up in /books/stuck;
    fresh books and finished books don't."""
    uid, _, _, s = _seed()
    long_ago = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    stuck = _seed_book(uid, title="Stuck One",
                       last_opened_at=long_ago, progress_fraction=0.15)
    fresh = _seed_book(uid, title="Fresh One",
                       last_opened_at=recent, progress_fraction=0.10)
    done = _seed_book(uid, title="Done Book",
                      last_opened_at=long_ago, progress_fraction=0.98)
    try:
        r = s.get(f"{BASE}/api/books/stuck")
        assert r.status_code == 200
        titles = {b["title"] for b in r.json()["books"]}
        assert "Stuck One" in titles
        assert "Fresh One" not in titles
        assert "Done Book" not in titles
    finally:
        _cleanup(uid, [stuck, fresh, done])


def test_dnf_flag_excludes_author_from_affinity_recs():
    """Marking a book DNF removes that author from the affinity rec
    pool — the user already gave up on them."""
    uid, _, _, s = _seed()
    # Seed the user's library with one book whose author is "Sync Author"
    own = _seed_book(uid, title="The First", fandom="StuckTestFandom")
    # Seed a community cover by another user matching that fandom +
    # author.  Without DNF it would be recommended; with DNF it must
    # be filtered out.
    other_uid = f"other_{uuid.uuid4().hex[:10]}"
    from pathlib import Path
    cover_id = f"covdnf_{uuid.uuid4().hex[:8]}"
    Path(f"/app/community_covers/{cover_id}").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    asyncio.get_event_loop().run_until_complete(
        db.community_covers.insert_one({
            "cover_id": cover_id,
            "title": "Another By Same Author", "author": "Sync Author",
            "fandom": "StuckTestFandom",
            "title_key": "another by same author",
            "author_key": "sync author", "fandom_key": "stucktestfandom",
            "file": cover_id, "source_book_id": "x", "source_variant_id": "x",
            "shared_by_user_id": other_uid, "shared_by_username": "anon",
            "shared_at": datetime.now(timezone.utc).isoformat(),
            "import_count": 0, "votes": 0, "voters": [],
        })
    )
    try:
        # Without DNF — should surface in affinity recs.
        r = s.get(f"{BASE}/api/recommendations/by-affinity")
        recs = r.json().get("recommendations", [])
        assert any(c["cover_id"] == cover_id for c in recs)

        # Mark DNF — recs must now exclude the author.
        s.post(f"{BASE}/api/books/{own}/dnf", json={"is_dnf": True})
        r2 = s.get(f"{BASE}/api/recommendations/by-affinity")
        recs2 = r2.json().get("recommendations", [])
        assert not any(c["cover_id"] == cover_id for c in recs2)
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"cover_id": cover_id})
        )
        Path(f"/app/community_covers/{cover_id}").unlink(missing_ok=True)
        _cleanup(uid, [own])


def test_stuck_books_reengagement_tick_pings_user():
    """Sunday tick generates one `reengagement_stuck` notification per
    user with stuck books, none for clean users."""
    from utils.engagement import stuck_books_reengagement_tick
    uid_dirty, _, _, _ = _seed()
    uid_clean, _, _, _ = _seed()
    long_ago = (datetime.now(timezone.utc) - timedelta(days=21)).isoformat()
    stuck = _seed_book(uid_dirty, title="Old Stuck",
                       last_opened_at=long_ago, progress_fraction=0.08)
    fresh = _seed_book(uid_clean, title="Clean Active",
                       last_opened_at=datetime.now(timezone.utc).isoformat(),
                       progress_fraction=0.50)
    try:
        result = asyncio.get_event_loop().run_until_complete(
            stuck_books_reengagement_tick()
        )
        assert result["recipients"] >= 1

        # The dirty user got a notification.
        n = asyncio.get_event_loop().run_until_complete(
            db.notifications.find_one(
                {"user_id": uid_dirty, "kind": "reengagement_stuck"},
                {"_id": 0, "title": 1},
            )
        )
        assert n is not None
        # The clean user did not.
        n2 = asyncio.get_event_loop().run_until_complete(
            db.notifications.find_one(
                {"user_id": uid_clean, "kind": "reengagement_stuck"},
                {"_id": 0},
            )
        )
        assert n2 is None
    finally:
        _cleanup(uid_dirty, [stuck])
        _cleanup(uid_clean, [fresh])
