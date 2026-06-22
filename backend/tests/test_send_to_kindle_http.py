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
    """Each test starts with a clean kindle_email + no recent send log for the tester.

    Also flips the ``send_to_kindle_enabled`` feature flag ON for the
    duration of the test (default is OFF in production — see
    /app/backend/utils/feature_flags.py — added 2026-06-22 as a
    Resend-quota safety net).  Without this, every POST returns 503
    "currently disabled" instead of the targeted 400/404/429.

    Important — Mongo-direct writes don't bust the *live backend's*
    in-process cache (TTL ~30 s).  We flip the flag through the admin
    API instead, which runs ``set_flag`` server-side and invalidates
    the cache atomically. To call the admin endpoint we briefly
    promote the tester, then demote on teardown.
    """
    db.users.update_one({"user_id": TESTER_USER_ID}, {"$set": {"kindle_email": ""}})
    db.kindle_send_log.delete_many({"user_id": TESTER_USER_ID})
    # Temporarily promote tester so we can hit /admin/feature-flags.
    db.users.update_one({"user_id": TESTER_USER_ID}, {"$set": {"is_admin": True}})
    admin = requests.Session()
    lg = admin.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
        timeout=20,
    )
    assert lg.status_code == 200
    flip = admin.put(
        f"{BASE_URL}/api/admin/feature-flags",
        json={"flag": "send_to_kindle_enabled", "enabled": True},
        timeout=15,
    )
    assert flip.status_code == 200, f"flag flip failed: {flip.status_code} {flip.text}"
    yield
    # Restore default (off) + demote.
    admin.put(
        f"{BASE_URL}/api/admin/feature-flags",
        json={"flag": "send_to_kindle_enabled", "enabled": False},
        timeout=15,
    )
    db.users.update_one({"user_id": TESTER_USER_ID}, {"$set": {"is_admin": False}})
    admin.close()


# ---------- Feature-flag gate ----------
def test_send_book_to_kindle_returns_503_when_feature_disabled(session, db):
    """The user-facing UI also hides this whole feature behind a
    client-side ``SEND_TO_KINDLE_UI_ENABLED`` constant.  The backend
    gate is the runtime defence — flipping ``send_to_kindle_enabled``
    OFF must reject the endpoint with 503 *regardless* of whether the
    user has an address configured or not (otherwise a curl-savvy user
    could bypass the UI hide and keep burning Resend quota).
    """
    # Flip the flag OFF via the admin API so the live backend's cache
    # actually invalidates.  (Mongo-direct writes don't bust the
    # in-process cache; see _reset_state.)
    db.users.update_one({"user_id": TESTER_USER_ID}, {"$set": {"is_admin": True}})
    try:
        admin = requests.Session()
        admin.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
            timeout=20,
        )
        admin.put(
            f"{BASE_URL}/api/admin/feature-flags",
            json={"flag": "send_to_kindle_enabled", "enabled": False},
            timeout=15,
        )
        admin.close()
        # Set a valid kindle email so we *would* otherwise pass the
        # 400-no-email guard — proves the flag wins.
        session.put(
            f"{BASE_URL}/api/user/kindle-settings",
            json={"kindle_email": "tester@kindle.com"},
            timeout=15,
        )
        r = session.post(
            f"{BASE_URL}/api/books/bk_tester_1/send-to-kindle",
            timeout=15,
        )
        assert r.status_code == 503, r.text
        assert "disabled" in (r.json().get("detail") or "").lower()
    finally:
        # _reset_state yield-teardown will demote, but we put the flag
        # back ON so the rest of the test session keeps working.
        admin = requests.Session()
        admin.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
            timeout=20,
        )
        admin.put(
            f"{BASE_URL}/api/admin/feature-flags",
            json={"flag": "send_to_kindle_enabled", "enabled": True},
            timeout=15,
        )
        admin.close()


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
