"""Tests for the P2 batch-1 library discovery + activity endpoints.

Covers W1 (surprise-me), W2 (unread list), W3 (reading queue), and
S4 (since-last-login) — plus A2 (email-stats admin endpoint).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


def _mk_user(is_admin=False, prev_login_days_ago=None):
    uid = f"user_p2_{uuid.uuid4().hex[:8]}"
    tok = f"sess_p2_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    udoc = {
        "user_id": uid, "email": f"{uid}@example.com", "name": "P2",
        "is_admin": is_admin,
        "created_at": now.isoformat(),
    }
    if prev_login_days_ago is not None:
        udoc["previous_login_at"] = (now - timedelta(days=prev_login_days_ago)).isoformat()
    db.users.insert_one(udoc)
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": now + timedelta(days=1),
    })
    return uid, tok


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _cleanup(uid):
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.books.delete_many({"user_id": uid})
    db.reading_queues.delete_many({"user_id": uid})
    db.notifications.delete_many({"user_id": uid})
    db.chat_rooms.delete_many({"member_user_ids": uid})


# ---------------------------------------------------------------------------
# W1 — Surprise-me
# ---------------------------------------------------------------------------
def test_random_unread_returns_an_unread_book():
    uid, tok = _mk_user()
    try:
        # 2 unread, 1 read
        db.books.insert_many([
            {"book_id": f"b1-{uid}", "user_id": uid, "title": "A", "category": "Fanfiction"},
            {"book_id": f"b2-{uid}", "user_id": uid, "title": "B", "category": "Fanfiction"},
            {"book_id": f"b3-{uid}", "user_id": uid, "title": "C", "category": "Fanfiction",
             "last_opened_at": datetime.now(timezone.utc).isoformat()},
        ])
        r = requests.get(f"{BASE}/api/library/random-unread", headers=_h(tok))
        assert r.status_code == 200
        bid = r.json()["book"]["book_id"]
        assert bid in (f"b1-{uid}", f"b2-{uid}")
    finally:
        _cleanup(uid)


def test_random_unread_404_when_no_unread():
    uid, tok = _mk_user()
    try:
        db.books.insert_one({
            "book_id": f"b1-{uid}", "user_id": uid, "title": "Read", "category": "Fanfiction",
            "last_opened_at": datetime.now(timezone.utc).isoformat(),
        })
        r = requests.get(f"{BASE}/api/library/random-unread", headers=_h(tok))
        assert r.status_code == 404
    finally:
        _cleanup(uid)


# ---------------------------------------------------------------------------
# W2 — Unread list
# ---------------------------------------------------------------------------
def test_unread_list_excludes_read_and_trash():
    uid, tok = _mk_user()
    try:
        db.books.insert_many([
            {"book_id": f"u1-{uid}", "user_id": uid, "title": "U1", "category": "Fanfiction"},
            {"book_id": f"u2-{uid}", "user_id": uid, "title": "U2", "category": "Original Fiction"},
            {"book_id": f"r1-{uid}", "user_id": uid, "title": "R1", "category": "Fanfiction",
             "last_opened_at": datetime.now(timezone.utc).isoformat()},
            {"book_id": f"t1-{uid}", "user_id": uid, "title": "T1", "category": "Trash"},
        ])
        r = requests.get(f"{BASE}/api/library/unread", headers=_h(tok))
        assert r.status_code == 200
        titles = sorted(b["title"] for b in r.json()["books"])
        assert titles == ["U1", "U2"]
    finally:
        _cleanup(uid)


# ---------------------------------------------------------------------------
# W3 — Reading queue
# ---------------------------------------------------------------------------
def test_queue_add_and_get_preserves_order():
    uid, tok = _mk_user()
    try:
        for i in range(3):
            db.books.insert_one({"book_id": f"q{i}-{uid}", "user_id": uid, "title": f"Q{i}", "category": "Fanfiction"})
        for i in [2, 0, 1]:  # add in non-natural order
            r = requests.post(f"{BASE}/api/library/queue/add", json={"book_id": f"q{i}-{uid}"}, headers=_h(tok))
            assert r.status_code == 200
        r = requests.get(f"{BASE}/api/library/queue", headers=_h(tok))
        assert r.status_code == 200
        order = [b["book_id"] for b in r.json()["queue"]]
        assert order == [f"q2-{uid}", f"q0-{uid}", f"q1-{uid}"]
    finally:
        _cleanup(uid)


def test_queue_add_is_idempotent_and_moves_to_position():
    uid, tok = _mk_user()
    try:
        for i in range(3):
            db.books.insert_one({"book_id": f"q{i}-{uid}", "user_id": uid, "title": f"Q{i}", "category": "Fanfiction"})
        # add q0, q1, q2
        for i in [0, 1, 2]:
            requests.post(f"{BASE}/api/library/queue/add", json={"book_id": f"q{i}-{uid}"}, headers=_h(tok))
        # now move q2 to position 0
        r = requests.post(f"{BASE}/api/library/queue/add",
                          json={"book_id": f"q2-{uid}", "position": 0},
                          headers=_h(tok))
        assert r.status_code == 200
        order = r.json()["queue"]
        assert order == [f"q2-{uid}", f"q0-{uid}", f"q1-{uid}"]
    finally:
        _cleanup(uid)


def test_queue_remove():
    uid, tok = _mk_user()
    try:
        db.books.insert_one({"book_id": f"q0-{uid}", "user_id": uid, "title": "Q0", "category": "Fanfiction"})
        requests.post(f"{BASE}/api/library/queue/add", json={"book_id": f"q0-{uid}"}, headers=_h(tok))
        r = requests.post(f"{BASE}/api/library/queue/remove", json={"book_id": f"q0-{uid}"}, headers=_h(tok))
        assert r.status_code == 200
        assert r.json()["queue"] == []
    finally:
        _cleanup(uid)


def test_queue_reorder_drops_unowned_ids():
    uid, tok = _mk_user()
    try:
        for i in range(2):
            db.books.insert_one({"book_id": f"q{i}-{uid}", "user_id": uid, "title": f"Q{i}", "category": "Fanfiction"})
        r = requests.post(f"{BASE}/api/library/queue/reorder",
                          json={"book_ids": [f"q1-{uid}", "FAKE-NOT-OWNED", f"q0-{uid}"]},
                          headers=_h(tok))
        assert r.status_code == 200
        assert r.json()["queue"] == [f"q1-{uid}", f"q0-{uid}"]
    finally:
        _cleanup(uid)


# ---------------------------------------------------------------------------
# S4 — Since last login
# ---------------------------------------------------------------------------
def test_since_last_login_counts_new_things():
    uid, tok = _mk_user(prev_login_days_ago=2)
    try:
        # 1 book uploaded yesterday, 1 last week
        now = datetime.now(timezone.utc)
        db.books.insert_many([
            {"book_id": f"old-{uid}", "user_id": uid, "title": "Old",
             "category": "Fanfiction",
             "created_at": (now - timedelta(days=7)).isoformat()},
            {"book_id": f"new-{uid}", "user_id": uid, "title": "New",
             "category": "Fanfiction",
             "created_at": (now - timedelta(hours=4)).isoformat()},
        ])
        # 1 friend_request notification within the window
        db.notifications.insert_one({
            "user_id": uid, "kind": "friend_request", "title": "...",
            "is_read": False, "created_at": (now - timedelta(hours=2)).isoformat(),
        })
        # 1 OLD friend_request notification outside the window
        db.notifications.insert_one({
            "user_id": uid, "kind": "friend_request", "title": "...",
            "is_read": False, "created_at": (now - timedelta(days=5)).isoformat(),
        })
        r = requests.get(f"{BASE}/api/dashboard/since-last-login", headers=_h(tok))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["new_books"] == 1
        assert data["friend_requests"] == 1
        assert data["since"]
    finally:
        _cleanup(uid)


# ---------------------------------------------------------------------------
# A2 — Email stats admin endpoint
# ---------------------------------------------------------------------------
def test_email_stats_aggregates_logs():
    uid, tok = _mk_user(is_admin=True)
    # Clear all email_logs so our seeded data is the only thing visible.
    db.email_logs.delete_many({})
    try:
        now = datetime.now(timezone.utc)
        # 5 successful digests, 1 failed reset, all within the 7-day window
        for _ in range(5):
            db.email_logs.insert_one({
                "sent_at": now - timedelta(hours=2), "kind": "digest",
                "to": "a@b.com", "status": "ok", "error": None,
            })
        db.email_logs.insert_one({
            "sent_at": now - timedelta(hours=1), "kind": "password_reset",
            "to": "x@y.com", "status": "error", "error": "boom",
        })
        # 1 old digest OUTSIDE the window - should be excluded
        db.email_logs.insert_one({
            "sent_at": now - timedelta(days=14), "kind": "digest",
            "to": "old@b.com", "status": "ok",
        })
        r = requests.get(f"{BASE}/api/admin/email-stats", headers=_h(tok))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["window_days"] == 7
        assert data["total_7d"] == 6  # excludes the 14-day-old
        assert data["ok_7d"] == 5
        assert data["error_7d"] == 1
        assert 0 < data["error_rate_7d"] < 1
        kinds = {k["kind"]: k for k in data["by_kind"]}
        assert kinds["digest"]["total"] == 5
        assert kinds["password_reset"]["error"] == 1
        # Recent failures expose the error text
        assert any("boom" in (f["error"] or "") for f in data["recent_failures"])
    finally:
        db.email_logs.delete_many({})
        _cleanup(uid)


def test_email_stats_rejects_non_admin():
    uid, tok = _mk_user(is_admin=False)
    try:
        r = requests.get(f"{BASE}/api/admin/email-stats", headers=_h(tok))
        assert r.status_code in (401, 403)
    finally:
        _cleanup(uid)
