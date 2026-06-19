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
