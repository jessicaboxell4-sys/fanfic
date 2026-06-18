"""Tests for the new P3 batch: cross-device hints, buddy-pacing,
most-finished leaderboard, and operator-digest endpoints.

These all rely on real Mongo state, so the test seeds throwaway users
+ books before each module and cleans up afterwards.  Mirrors the
session-fixture pattern used by ``test_bookclubs.py``.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _pair(a: str, b: str):
    return (a, b) if a < b else (b, a)


# =====================================================================
# Cross-device hints
# =====================================================================

class TestCrossDeviceHints:
    USER = {"user_id": f"user_cdh_{uuid.uuid4().hex[:8]}", "token": f"sess_cdh_{uuid.uuid4().hex}"}
    BOOK_RECENT = f"book_cdh_recent_{uuid.uuid4().hex[:6]}"
    BOOK_FINISHED = f"book_cdh_done_{uuid.uuid4().hex[:6]}"
    BOOK_OLD = f"book_cdh_old_{uuid.uuid4().hex[:6]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": self.USER["user_id"], "email": f"{self.USER['user_id']}@ex.com",
            "name": "Hint Tester", "is_admin": False, "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": self.USER["user_id"], "session_token": self.USER["token"],
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        # 3 books: one recent on a different device, one finished, one stale.
        for bid, pct in [(self.BOOK_RECENT, 0.3), (self.BOOK_FINISHED, 1.0), (self.BOOK_OLD, 0.4)]:
            db.books.insert_one({
                "book_id": bid, "user_id": self.USER["user_id"],
                "title": f"Book {bid}", "author": "A", "category": "Fanfiction",
                "progress_fraction": pct, "created_at": now,
            })
        # Cursor seeds
        db.reading_cursors.insert_many([
            {  # Recent + different device → should appear
                "user_id": self.USER["user_id"], "book_id": self.BOOK_RECENT,
                "cfi": "x", "percent": 0.3, "chapter_label": "Ch 3",
                "device_id": "phone-1", "device_label": "iPhone",
                "updated_at": now.isoformat(),
            },
            {  # Finished — should be excluded
                "user_id": self.USER["user_id"], "book_id": self.BOOK_FINISHED,
                "cfi": "x", "percent": 1.0, "chapter_label": "End",
                "device_id": "phone-1", "device_label": "iPhone",
                "updated_at": now.isoformat(),
            },
            {  # Old (>48h) — should be excluded
                "user_id": self.USER["user_id"], "book_id": self.BOOK_OLD,
                "cfi": "x", "percent": 0.4, "chapter_label": "Ch 4",
                "device_id": "phone-1", "device_label": "iPhone",
                "updated_at": (now - timedelta(days=5)).isoformat(),
            },
        ])
        yield
        db.users.delete_many({"user_id": self.USER["user_id"]})
        db.user_sessions.delete_many({"user_id": self.USER["user_id"]})
        db.books.delete_many({"user_id": self.USER["user_id"]})
        db.reading_cursors.delete_many({"user_id": self.USER["user_id"]})

    def test_unauth_blocked(self):
        r = requests.get(f"{BASE}/api/reading-sync/hints")
        assert r.status_code == 401

    def test_hints_exclude_finished_and_old(self):
        r = requests.get(
            f"{BASE}/api/reading-sync/hints",
            params={"device_id": "laptop-X", "hours": 48},
            headers=_h(self.USER["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        ids = [h["book_id"] for h in body["hints"]]
        assert self.BOOK_RECENT in ids
        assert self.BOOK_FINISHED not in ids
        assert self.BOOK_OLD not in ids
        assert body["count"] == len(ids)

    def test_hints_filter_own_device(self):
        # If the client supplies its own device id and that's the only
        # cursor, the hint goes away (don't nudge the user about a book
        # they were reading on the same laptop).
        r = requests.get(
            f"{BASE}/api/reading-sync/hints",
            params={"device_id": "phone-1", "hours": 48},
            headers=_h(self.USER["token"]),
        )
        assert r.status_code == 200
        ids = [h["book_id"] for h in r.json()["hints"]]
        assert self.BOOK_RECENT not in ids


# =====================================================================
# Buddy-pacing system message in 2-person bookclub
# =====================================================================

class TestBookclubBuddyPacing:
    A = {"user_id": f"user_bpA_{uuid.uuid4().hex[:8]}", "token": f"sess_bpA_{uuid.uuid4().hex}"}
    B = {"user_id": f"user_bpB_{uuid.uuid4().hex[:8]}", "token": f"sess_bpB_{uuid.uuid4().hex}"}
    BOOK = f"book_bp_{uuid.uuid4().hex[:6]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        for u in (self.A, self.B):
            db.users.insert_one({
                "user_id": u["user_id"], "email": f"{u['user_id']}@ex.com",
                "name": u["user_id"], "is_admin": False, "created_at": now.isoformat(),
            })
            db.user_sessions.insert_one({
                "user_id": u["user_id"], "session_token": u["token"],
                "expires_at": now + timedelta(days=7), "created_at": now,
            })
        # A owns the book and is friends with B.
        db.books.insert_one({
            "book_id": self.BOOK, "user_id": self.A["user_id"],
            "title": "Buddy Book", "author": "Author",
            "chapters": [{"index": i, "title": f"Ch {i}"} for i in range(1, 6)],
            "category": "Fanfiction", "created_at": now,
        })
        a, b = _pair(self.A["user_id"], self.B["user_id"])
        db.friendships.insert_one({
            "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
            "user_a": a, "user_b": b, "status": "accepted",
            "requested_by": self.A["user_id"], "created_at": now, "updated_at": now,
        })
        yield
        uids = [self.A["user_id"], self.B["user_id"]]
        db.users.delete_many({"user_id": {"$in": uids}})
        db.user_sessions.delete_many({"user_id": {"$in": uids}})
        db.books.delete_many({"user_id": {"$in": uids}})
        db.friendships.delete_many({"$or": [{"user_a": {"$in": uids}}, {"user_b": {"$in": uids}}]})
        db.bookclubs.delete_many({"owner_user_id": {"$in": uids}})
        db.bookclub_members.delete_many({"user_id": {"$in": uids}})
        db.bookclub_messages.delete_many({"user_id": {"$in": uids}})
        db.notifications.delete_many({"user_id": {"$in": uids}})

    def test_buddy_pacing_system_message_appears(self):
        # 1) A creates the room.
        r = requests.post(
            f"{BASE}/api/bookclubs",
            json={"name": "Buddy Reads", "book_id": self.BOOK, "description": "Just us two"},
            headers=_h(self.A["token"]),
        )
        assert r.status_code == 200, r.text
        room_id = r.json()["room_id"]

        # 2) A invites B; B accepts.
        r = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/invite",
            json={"user_id": self.B["user_id"]},
            headers=_h(self.A["token"]),
        )
        assert r.status_code == 200, r.text
        r = requests.post(f"{BASE}/api/bookclubs/{room_id}/accept", headers=_h(self.B["token"]))
        assert r.status_code == 200, r.text

        # 3) A reads ahead to chapter 2 — no nudge yet because B is at 0.
        r = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/progress",
            json={"current_chapter": 2}, headers=_h(self.A["token"]),
        )
        assert r.status_code == 200
        sys_msgs = list(db.bookclub_messages.find(
            {"room_id": room_id, "is_system": True, "system_kind": "buddy_pacing"}
        ))
        assert sys_msgs == [], "Should not nudge until both have reached ch 2"

        # 4) B catches up to chapter 2 — nudge fires for ch 2.
        r = requests.post(
            f"{BASE}/api/bookclubs/{room_id}/progress",
            json={"current_chapter": 2}, headers=_h(self.B["token"]),
        )
        assert r.status_code == 200
        sys_msgs = list(db.bookclub_messages.find(
            {"room_id": room_id, "is_system": True, "system_kind": "buddy_pacing"}
        ))
        assert len(sys_msgs) == 1
        assert sys_msgs[0]["chapter_index"] == 2
        assert "Chapter 2" in sys_msgs[0]["body"]

        # 5) Idempotency: B moves back-and-forth, no duplicate ch-2 nudge.
        requests.post(
            f"{BASE}/api/bookclubs/{room_id}/progress",
            json={"current_chapter": 2}, headers=_h(self.B["token"]),
        )
        sys_msgs = list(db.bookclub_messages.find(
            {"room_id": room_id, "is_system": True, "system_kind": "buddy_pacing"}
        ))
        assert len(sys_msgs) == 1, "Should be idempotent for the same chapter"

        # 6) Both reach chapter 3 → second nudge fires.
        requests.post(
            f"{BASE}/api/bookclubs/{room_id}/progress",
            json={"current_chapter": 3}, headers=_h(self.A["token"]),
        )
        requests.post(
            f"{BASE}/api/bookclubs/{room_id}/progress",
            json={"current_chapter": 3}, headers=_h(self.B["token"]),
        )
        sys_msgs = sorted(
            db.bookclub_messages.find(
                {"room_id": room_id, "is_system": True, "system_kind": "buddy_pacing"}
            ),
            key=lambda m: m["chapter_index"],
        )
        assert len(sys_msgs) == 2
        assert sys_msgs[1]["chapter_index"] == 3


# =====================================================================
# Most-finished leaderboard
# =====================================================================

class TestMostFinishedLeaderboard:
    BOOKS_TITLE = f"Cohort-{uuid.uuid4().hex[:6]}"
    USERS_TOK = f"sess_lb_{uuid.uuid4().hex}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        # One representative user with a session for auth.
        uid = f"user_lb_{uuid.uuid4().hex[:8]}"
        db.users.insert_one({
            "user_id": uid, "email": f"{uid}@ex.com", "name": "LB Tester",
            "is_admin": False, "reading_data_shared": True,
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": uid, "session_token": self.USERS_TOK,
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        # Spin up 12 fake opted-in cohort users — each owns the same
        # canonical title at >=99% progress so completion_rate == 1.0.
        self.cohort_uids: list[str] = []
        for i in range(12):
            cu = f"user_lbc_{i}_{uuid.uuid4().hex[:6]}"
            db.users.insert_one({
                "user_id": cu, "email": f"{cu}@ex.com", "name": cu,
                "is_admin": False, "reading_data_shared": True,
                "created_at": now.isoformat(),
            })
            db.books.insert_one({
                "book_id": f"book_lb_{i}_{uuid.uuid4().hex[:6]}",
                "user_id": cu, "title": self.BOOKS_TITLE, "author": "Shared Author",
                "category": "Fanfiction", "progress_fraction": 0.995,
                "created_at": now,
            })
            self.cohort_uids.append(cu)
        # Save the auth user_id so the test method can read it.
        self.auth_uid = uid
        yield
        db.users.delete_many({"user_id": {"$in": self.cohort_uids + [uid]}})
        db.user_sessions.delete_many({"user_id": uid})
        db.books.delete_many({"title": self.BOOKS_TITLE})

    def test_unauth_blocked(self):
        r = requests.get(f"{BASE}/api/books/most-finished-leaderboard")
        assert r.status_code == 401

    def test_cohort_visible_when_above_threshold(self):
        r = requests.get(
            f"{BASE}/api/books/most-finished-leaderboard",
            params={"limit": 50},
            headers=_h(self.USERS_TOK),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["cohort_threshold"] == 10
        match = next(
            (row for row in body["rows"] if row["title"] == self.BOOKS_TITLE),
            None,
        )
        assert match is not None, "12-user cohort should clear threshold"
        assert match["cohort"] >= 10
        assert match["completion_rate"] >= 0.99


# =====================================================================
# Operator digest gating
# =====================================================================

class TestOperatorDigestGating:
    TOK = f"sess_od_{uuid.uuid4().hex}"
    UID = f"user_od_{uuid.uuid4().hex[:8]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": self.UID, "email": f"{self.UID}@ex.com", "name": "Op Test",
            "is_admin": False,   # non-admin — should be blocked
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": self.UID, "session_token": self.TOK,
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        yield
        db.users.delete_many({"user_id": self.UID})
        db.user_sessions.delete_many({"user_id": self.UID})

    def test_nonadmin_get_blocked(self):
        r = requests.get(f"{BASE}/api/admin/operator-digest", headers=_h(self.TOK))
        assert r.status_code == 403

    def test_nonadmin_put_blocked(self):
        r = requests.put(
            f"{BASE}/api/admin/operator-digest",
            json={"email_enabled": True}, headers=_h(self.TOK),
        )
        assert r.status_code == 403

    def test_admin_can_toggle(self):
        db.users.update_one({"user_id": self.UID}, {"$set": {"is_admin": True}})
        try:
            r = requests.put(
                f"{BASE}/api/admin/operator-digest",
                json={"email_enabled": True}, headers=_h(self.TOK),
            )
            assert r.status_code == 200, r.text
            assert r.json()["email_enabled"] is True

            r = requests.get(f"{BASE}/api/admin/operator-digest", headers=_h(self.TOK))
            assert r.status_code == 200
            assert r.json()["email_enabled"] is True
        finally:
            db.users.update_one({"user_id": self.UID}, {"$set": {"is_admin": False}})
