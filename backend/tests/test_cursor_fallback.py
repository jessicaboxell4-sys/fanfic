"""Regression test: a fresh device with no localStorage falls back to
the cloud cursor for the initial book position.

This test verifies the backend contract that Reader.jsx now relies
on: GET /books/{id}/cursor returns 200 + cfi when a cursor exists,
and 404 when it doesn't (Reader.jsx silently starts at chapter 1 in
the 404 case).
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"
BOOK_ID = "bk_tester_1"  # seeded in test_credentials.md


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    # Wipe any existing cursor row so test is deterministic
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.reading_cursors.delete_many({"book_id": BOOK_ID})
    yield s
    db.reading_cursors.delete_many({"book_id": BOOK_ID})


def test_no_cursor_returns_404(session):
    """Empty cloud cursor → 404.  Reader.jsx then leaves the chapter-1
    default in place silently — no error toast."""
    r = session.get(f"{BASE_URL}/api/books/{BOOK_ID}/cursor", timeout=20)
    assert r.status_code == 404


def test_write_then_read_round_trips(session):
    """Save a cursor on device A (POST), then read it on device B (GET)."""
    save = session.post(
        f"{BASE_URL}/api/books/{BOOK_ID}/cursor",
        json={
            "cfi": "epubcfi(/6/4!/4/2[chap-1]/8/1:0)",
            "percent": 0.42,
            "device_id": "test-device-laptop",
            "device_label": "Test laptop",
        },
        timeout=20,
    )
    assert save.status_code == 200, save.text[:200]

    read = session.get(f"{BASE_URL}/api/books/{BOOK_ID}/cursor", timeout=20)
    assert read.status_code == 200
    body = read.json()
    assert body["cfi"] == "epubcfi(/6/4!/4/2[chap-1]/8/1:0)"
    assert body["device_label"] == "Test laptop"
    assert abs(body["percent"] - 0.42) < 0.001


def test_books_recent_includes_cross_device_fields(session):
    """The Continue Reading rail relies on /books/recent returning
    `last_device_id`, `last_device_label`, and `last_cursor_updated_at`
    alongside each book whenever a cursor exists.  Regression guard
    for the 2026-06-19 cross-device caption feature."""
    # Ensure a cursor exists from the round-trip test above
    session.post(
        f"{BASE_URL}/api/books/{BOOK_ID}/cursor",
        json={
            "cfi": "epubcfi(/6/4!/4/2/8/1:5)",
            "percent": 0.55,
            "device_id": "test-device-phone",
            "device_label": "iPhone",
        },
        timeout=20,
    )
    # Touch last_opened_at so the book surfaces on /books/recent
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    from datetime import datetime, timezone
    db.books.update_one(
        {"book_id": BOOK_ID},
        {"$set": {"last_opened_at": datetime.now(timezone.utc).isoformat()}},
    )

    r = session.get(f"{BASE_URL}/api/books/recent", timeout=20)
    assert r.status_code == 200
    books = r.json().get("books", [])
    book = next((b for b in books if b.get("book_id") == BOOK_ID), None)
    assert book is not None, "Expected the seeded book on /books/recent"
    assert book.get("last_device_id")     == "test-device-phone"
    assert book.get("last_device_label")  == "iPhone"
    assert book.get("last_cursor_updated_at"), "Expected a last_cursor_updated_at timestamp"


def test_get_book_includes_cross_device_fields(session):
    """The BookDetail page hint relies on /books/{id} returning the
    same cross-device fields.  Regression guard for the 2026-06-19
    BookDetail cross-device hint."""
    session.post(
        f"{BASE_URL}/api/books/{BOOK_ID}/cursor",
        json={
            "cfi": "epubcfi(/6/4!/4/2/8/1:7)",
            "percent": 0.77,
            "device_id": "test-device-tablet",
            "device_label": "iPad",
        },
        timeout=20,
    )
    r = session.get(f"{BASE_URL}/api/books/{BOOK_ID}", timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body.get("last_device_id")     == "test-device-tablet"
    assert body.get("last_device_label")  == "iPad"
    assert body.get("last_cursor_updated_at")
