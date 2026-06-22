"""HTTP integration tests for Send-to-Kindle endpoints against the public preview URL.

Covers the real wire path through ingress/CORS/auth:
- GET  /api/user/kindle-settings
- PUT  /api/user/kindle-settings    (valid / invalid / empty-clear)
- POST /api/books/{book_id}/send-to-kindle (400 no-email / 404 unknown / 403 quarantined / 429 rate-limit)

Resend is NOT exercised live (quota lock) — we drive every error code path that does
not require a successful outbound send.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
TESTER_EMAIL = "shelfsort-tester@example.com"
TESTER_PASSWORD = "tester123!"
TESTER_USER_ID = "user_a18dde45958d"


@pytest.fixture(scope="module")
def db():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url, maxPoolSize=4)
    yield c[name]
    c.close()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _reset_state(db):
    """Each test starts with a clean kindle_email + no recent send log for the tester."""
    db.users.update_one({"user_id": TESTER_USER_ID}, {"$set": {"kindle_email": ""}})
    db.kindle_send_log.delete_many({"user_id": TESTER_USER_ID})
    yield


# ---------- GET kindle-settings ----------
def test_get_kindle_settings_defaults_empty(session):
    r = session.get(f"{BASE_URL}/api/user/kindle-settings", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # contract: kindle_email, sender_email, last_sent_at, last_book_id
    assert "kindle_email" in body
    assert "sender_email" in body
    assert "last_sent_at" in body
    assert "last_book_id" in body
    assert body["kindle_email"] == ""
    assert isinstance(body["sender_email"], str)


# ---------- PUT kindle-settings ----------
def test_put_kindle_settings_valid_persists(session):
    addr = f"tester-{uuid.uuid4().hex[:6]}@kindle.com"
    r = session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": addr},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("kindle_email") == addr
    # GET should reflect
    r2 = session.get(f"{BASE_URL}/api/user/kindle-settings", timeout=15)
    assert r2.json()["kindle_email"] == addr


def test_put_kindle_settings_invalid_returns_400(session):
    r = session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": "foo@example.com"},
        timeout=15,
    )
    assert r.status_code == 400, r.text
    body = r.json()
    detail = (body.get("detail") or "").lower()
    assert "kindle" in detail or "invalid" in detail


def test_put_kindle_settings_empty_clears(session):
    # First set
    addr = f"tester-{uuid.uuid4().hex[:6]}@kindle.com"
    session.put(f"{BASE_URL}/api/user/kindle-settings", json={"kindle_email": addr}, timeout=15)
    # Then clear
    r = session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": ""},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    r2 = session.get(f"{BASE_URL}/api/user/kindle-settings", timeout=15)
    assert r2.json()["kindle_email"] == ""


# ---------- POST send-to-kindle ----------
def test_send_to_kindle_no_email_returns_400(session, db):
    # Ensure kindle_email is empty (autouse fixture already did this)
    r = session.post(f"{BASE_URL}/api/books/bk_tester_1/send-to-kindle", timeout=15)
    assert r.status_code == 400, r.text
    detail = (r.json().get("detail") or "")
    assert "Kindle" in detail or "kindle" in detail


def test_send_to_kindle_unknown_book_returns_404(session, db):
    # Set a valid kindle email so we get past the 400 gate
    session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": "tester@kindle.com"},
        timeout=15,
    )
    r = session.post(
        f"{BASE_URL}/api/books/bk_does_not_exist_{uuid.uuid4().hex[:6]}/send-to-kindle",
        timeout=15,
    )
    assert r.status_code == 404, r.text


def test_send_to_kindle_quarantined_returns_403(session, db):
    # Configure email
    session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": "tester@kindle.com"},
        timeout=15,
    )
    # Flip a tester book to infected, run, restore
    book = db.books.find_one({"user_id": TESTER_USER_ID})
    assert book, "no tester book to test quarantine against"
    bid = book["book_id"]
    prev = book.get("av_status")
    db.books.update_one({"book_id": bid}, {"$set": {"av_status": "infected"}})
    try:
        r = session.post(f"{BASE_URL}/api/books/{bid}/send-to-kindle", timeout=15)
        assert r.status_code == 403, r.text
    finally:
        db.books.update_one({"book_id": bid}, {"$set": {"av_status": prev or "clean"}})


def test_send_to_kindle_rate_limit_returns_429(session, db):
    """Seed a recent 'ok' row in kindle_send_log → immediate send is 429."""
    session.put(
        f"{BASE_URL}/api/user/kindle-settings",
        json={"kindle_email": "tester@kindle.com"},
        timeout=15,
    )
    book = db.books.find_one({"user_id": TESTER_USER_ID})
    bid = book["book_id"]
    db.kindle_send_log.insert_one({
        "user_id":   TESTER_USER_ID,
        "book_id":   bid,
        "status":    "ok",
        "sent_at":   datetime.now(timezone.utc) - timedelta(minutes=5),
        "resend_id": "rsnd-seed-rate",
    })
    r = session.post(f"{BASE_URL}/api/books/{bid}/send-to-kindle", timeout=15)
    assert r.status_code == 429, r.text
    detail = (r.json().get("detail") or "")
    assert "30 min" in detail
