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



# =====================================================================
# Reading-insights endpoints — re-read signal, pace percentile,
# aggregate cursor.  Powers BookReadingInsights on BookDetail.
# =====================================================================

class TestReadingInsights:
    TOK = f"sess_ri_{uuid.uuid4().hex}"
    UID = f"user_ri_{uuid.uuid4().hex[:8]}"
    BOOK = f"book_ri_{uuid.uuid4().hex[:6]}"
    SHARED_TITLE = f"Cohort-RI-{uuid.uuid4().hex[:6]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": self.UID, "email": f"{self.UID}@ex.com", "name": "RI Tester",
            "is_admin": False, "reading_data_shared": True,
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": self.UID, "session_token": self.TOK,
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        db.books.insert_one({
            "book_id": self.BOOK, "user_id": self.UID,
            "title": self.SHARED_TITLE, "author": "Shared Author",
            "category": "Fanfiction", "progress_fraction": 0.45,
            "created_at": now,
        })
        # Seed cursor_history with a clean read-through then a re-read:
        # five forward steps to 100 %, then three backward jumps to <40 %.
        hist = []
        ts0 = now - timedelta(days=60)
        for i, p in enumerate([0.1, 0.3, 0.55, 0.8, 1.0,
                                0.05, 1.0, 0.1, 1.0, 0.2]):
            hist.append({
                "user_id": self.UID, "book_id": self.BOOK,
                "percent": p, "prev_pct": (hist[-1]["percent"] if hist else 0),
                "delta": 0, "device_id": "test",
                "ts": (ts0 + timedelta(days=i * 3)).isoformat(),
            })
        db.cursor_history.insert_many(hist)
        # Cohort books for aggregate-cursor: 6 fake readers at varying
        # progress on the SAME canonical title so the cohort gate
        # (>= 5) clears.
        self.cohort_uids: list[str] = []
        for i, pct in enumerate([0.2, 0.5, 0.6, 0.7, 0.9, 1.0]):
            cu = f"user_ri_cohort_{i}_{uuid.uuid4().hex[:6]}"
            db.users.insert_one({
                "user_id": cu, "email": f"{cu}@ex.com", "name": cu,
                "is_admin": False, "reading_data_shared": True,
                "created_at": now.isoformat(),
            })
            db.books.insert_one({
                "book_id": f"book_ri_cohort_{i}_{uuid.uuid4().hex[:6]}",
                "user_id": cu,
                "title": self.SHARED_TITLE, "author": "Shared Author",
                "category": "Fanfiction", "progress_fraction": pct,
                "created_at": now,
            })
            self.cohort_uids.append(cu)
        yield
        db.users.delete_many({"user_id": {"$in": self.cohort_uids + [self.UID]}})
        db.user_sessions.delete_many({"user_id": self.UID})
        db.books.delete_many({"title": self.SHARED_TITLE})
        db.cursor_history.delete_many({"user_id": self.UID})

    def test_reread_signal_detects_backward_jumps(self):
        r = requests.get(
            f"{BASE}/api/books/{self.BOOK}/reread-signal",
            headers=_h(self.TOK),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # The 3 backward jumps to <40% after reaching 100% should trip it.
        assert body["is_reread"] is True
        assert body["backward_jumps"] >= 3
        assert body["peak_percent"] >= 0.99

    def test_reread_signal_404_for_unknown_book(self):
        r = requests.get(
            f"{BASE}/api/books/nonexistent_book/reread-signal",
            headers=_h(self.TOK),
        )
        assert r.status_code == 404

    def test_aggregate_cursor_returns_cohort_average(self):
        r = requests.get(
            f"{BASE}/api/books/{self.BOOK}/aggregate-cursor",
            headers=_h(self.TOK),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # 6-user cohort, avg ~ 0.65; threshold is 5 so it clears.
        assert body["have_data"] is True
        assert body["cohort"] >= 5
        assert body["your_percent"] == 0.45
        assert 0.5 < body["avg_percent"] < 0.8

    def test_pace_percentile_graceful_without_data(self):
        # Tester has cursor_history but no reading_activity rows ⇒
        # endpoint should return have_data=False with not_enough_data.
        r = requests.get(
            f"{BASE}/api/books/{self.BOOK}/pace-percentile",
            headers=_h(self.TOK),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("have_data") in (False, True)
        if body.get("have_data") is False:
            assert body.get("reason") == "not_enough_data"


# =====================================================================
# Re-read rabbit-hole nudge — POST /api/books/{id}/cursor fires a
# one-shot notification when backward_jumps >= 4 in the last 30 days.
# =====================================================================

class TestRereadRabbitHoleNudge:
    TOK = f"sess_rr_{uuid.uuid4().hex}"
    UID = f"user_rr_{uuid.uuid4().hex[:8]}"
    BOOK = f"book_rr_{uuid.uuid4().hex[:6]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": self.UID, "email": f"{self.UID}@ex.com",
            "name": "RR Tester", "is_admin": False,
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": self.UID, "session_token": self.TOK,
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        db.books.insert_one({
            "book_id": self.BOOK, "user_id": self.UID,
            "title": "Comfort Re-read Test",
            "author": "RR Author", "category": "Fanfiction",
            "progress_fraction": 0.0, "created_at": now,
        })
        # Pre-seed cursor_history with 4 prior backward jumps so the
        # next backward-jump push trips the >=4 threshold.
        hist = []
        ts0 = now - timedelta(days=28)
        # peaks then drops: 4 cycles of (0.9 -> 0.1)
        for i, p in enumerate([0.1, 0.5, 0.9, 0.1,
                                0.5, 0.9, 0.1,
                                0.5, 0.9, 0.1,
                                0.5, 0.9, 0.1]):
            hist.append({
                "user_id": self.UID, "book_id": self.BOOK,
                "percent": p, "prev_pct": 0,
                "delta": 0, "device_id": "test",
                "ts": (ts0 + timedelta(days=i * 2)).isoformat(),
            })
        # Final cursor row reflecting the latest state (at 0.9 so the
        # next push down to 0.05 counts as a fresh backward jump).
        db.cursor_history.insert_many(hist)
        db.reading_cursors.insert_one({
            "user_id": self.UID, "book_id": self.BOOK,
            "cfi": "x", "percent": 0.9, "chapter_label": "Ch 9",
            "device_id": "test", "device_label": "Test",
            "updated_at": now.isoformat(),
        })
        yield
        db.users.delete_many({"user_id": self.UID})
        db.user_sessions.delete_many({"user_id": self.UID})
        db.books.delete_many({"user_id": self.UID})
        db.cursor_history.delete_many({"user_id": self.UID})
        db.reading_cursors.delete_many({"user_id": self.UID})
        db.notifications.delete_many({"user_id": self.UID})

    def test_backward_jump_fires_notification(self):
        # Now POST /cursor with percent=0.05 (jump from 0.9) — should
        # cross the 4-jump threshold and create a one-shot notification.
        r = requests.post(
            f"{BASE}/api/books/{self.BOOK}/cursor",
            json={"cfi": "x", "percent": 0.05, "device_id": "test"},
            headers=_h(self.TOK),
        )
        assert r.status_code == 200, r.text

        # Give the SSE publish a tick to settle (sync-await in the
        # endpoint should already have written the notification).
        notif = db.notifications.find_one({
            "user_id": self.UID, "kind": "reread_rabbit_hole",
        })
        assert notif is not None
        assert "Comfort Re-read Test" in notif["body"]
        assert notif["link"].endswith(f"/book/{self.BOOK}")

    def test_idempotent_within_30_days(self):
        # Second backward jump in the same 30-day window — should NOT
        # double-fire a notification.
        prev_count = db.notifications.count_documents({
            "user_id": self.UID, "kind": "reread_rabbit_hole",
        })
        # Bump the cursor back to 0.9 then back to 0.05 once more.
        requests.post(
            f"{BASE}/api/books/{self.BOOK}/cursor",
            json={"cfi": "x", "percent": 0.9, "device_id": "test"},
            headers=_h(self.TOK),
        )
        requests.post(
            f"{BASE}/api/books/{self.BOOK}/cursor",
            json={"cfi": "x", "percent": 0.05, "device_id": "test"},
            headers=_h(self.TOK),
        )
        new_count = db.notifications.count_documents({
            "user_id": self.UID, "kind": "reread_rabbit_hole",
        })
        assert new_count == prev_count, "Should not double-fire"


# =====================================================================
# Pace endpoint projected_hours_to_finish field
# =====================================================================

class TestProjectedHoursToFinish:
    TOK = f"sess_phf_{uuid.uuid4().hex}"
    UID = f"user_phf_{uuid.uuid4().hex[:8]}"
    BOOK_NEW = f"book_phf_new_{uuid.uuid4().hex[:6]}"
    BOOK_OLD = f"book_phf_old_{uuid.uuid4().hex[:6]}"

    @pytest.fixture(autouse=True, scope="class")
    def seed(self):
        now = datetime.now(timezone.utc)
        db.users.insert_one({
            "user_id": self.UID, "email": f"{self.UID}@ex.com",
            "name": "PHF Tester", "is_admin": False,
            "created_at": now.isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": self.UID, "session_token": self.TOK,
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
        db.books.insert_one({
            "book_id": self.BOOK_NEW, "user_id": self.UID,
            "title": "Fresh Book", "author": "A",
            "category": "Fanfiction", "progress_fraction": 0.0,
            "created_at": now,
        })
        # Baseline book: finished, with cursor_history + reading_activity
        # for the pace-rate computation.
        db.books.insert_one({
            "book_id": self.BOOK_OLD, "user_id": self.UID,
            "title": "Baseline Book", "author": "A",
            "category": "Fanfiction", "progress_fraction": 1.0,
            "created_at": now,
        })
        ts0 = now - timedelta(days=160)
        db.cursor_history.insert_many([
            {"user_id": self.UID, "book_id": self.BOOK_OLD,
             "percent": 0.1, "prev_pct": 0, "delta": 0,
             "device_id": "t", "ts": ts0.isoformat()},
            {"user_id": self.UID, "book_id": self.BOOK_OLD,
             "percent": 1.0, "prev_pct": 0.1, "delta": 0.9,
             "device_id": "t",
             "ts": (ts0 + timedelta(days=5)).isoformat()},
        ])
        db.reading_activity.insert_one({
            "user_id": self.UID, "book_id": self.BOOK_OLD,
            "day": (ts0 + timedelta(days=2)).date().isoformat(),
            "minutes": 600,   # 10 hours total → 9 %pts/hr
        })
        yield
        db.users.delete_many({"user_id": self.UID})
        db.user_sessions.delete_many({"user_id": self.UID})
        db.books.delete_many({"user_id": self.UID})
        db.cursor_history.delete_many({"user_id": self.UID})
        db.reading_activity.delete_many({"user_id": self.UID})

    def test_projected_hours_present_for_unstarted_book(self):
        r = requests.get(
            f"{BASE}/api/books/{self.BOOK_NEW}/pace-percentile",
            headers=_h(self.TOK),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # User has a baseline book → median_rate populated → projection.
        assert body.get("median_rate") is not None
        assert body.get("projected_hours_to_finish") is not None
        # Sanity check: ~ 100 / 9 ≈ 11 hours for the 100% remaining book.
        assert 5 < body["projected_hours_to_finish"] < 30


# =====================================================================
# Phase-6 module split — chapter helpers moved to utils/epub_chapters.
# Backward-compat shim: routes.books still exposes the names.
# =====================================================================

class TestPhase6ChapterHelpersShim:
    def test_extract_chapters_reexported_from_books(self):
        from routes.books import extract_chapters, diff_chapters, _normalize_chapter_title
        from utils.epub_chapters import (
            extract_chapters as _ec,
            diff_chapters as _dc,
            _normalize_chapter_title as _nct,
        )
        assert extract_chapters is _ec
        assert diff_chapters is _dc
        assert _normalize_chapter_title is _nct

    def test_normalize_chapter_title_strips_prefix(self):
        from utils.epub_chapters import _normalize_chapter_title
        assert _normalize_chapter_title("Chapter 5: The Reckoning") == "the reckoning"
        assert _normalize_chapter_title("Prologue") == ""
        assert _normalize_chapter_title("   ") == ""

    def test_diff_chapters_detects_added_and_changed(self):
        from utils.epub_chapters import diff_chapters
        old = [
            {"index": 0, "title": "Chapter 1", "words": 100, "href": "a.xhtml"},
            {"index": 1, "title": "Chapter 2", "words": 200, "href": "b.xhtml"},
        ]
        new = [
            {"index": 0, "title": "Chapter 1", "words": 100, "href": "a.xhtml"},
            {"index": 1, "title": "Chapter 2", "words": 250, "href": "b.xhtml"},
            {"index": 2, "title": "Chapter 3", "words": 300, "href": "c.xhtml"},
        ]
        d = diff_chapters(old, new)
        assert d["summary"]["chapters_added"] == 1
        assert d["summary"]["chapters_changed"] == 1
        assert d["summary"]["chapters_unchanged"] == 1
        assert d["summary"]["words_delta"] == 350
        assert d["first_changed_chapter"] is not None


# =====================================================================
# Phase-6 #2 — EPUB metadata + relationship/fandom shim
# =====================================================================

class TestPhase6MetadataShim:
    def test_metadata_helpers_reexported_from_books(self):
        from routes.books import (
            extract_epub_metadata, update_epub_metadata, extract_urls_from_epub,
            format_links_txt, _canonicalize_relationship, _canonicalize_fandom,
            _suggest_fandom_merges, detect_series_from_title, SERIES_TITLE_PATTERNS,
        )
        from utils.epub_metadata import (
            extract_epub_metadata as _ext, update_epub_metadata as _upd,
            extract_urls_from_epub as _eu, format_links_txt as _flt,
            _canonicalize_relationship as _cr, _canonicalize_fandom as _cf,
            _suggest_fandom_merges as _sm, detect_series_from_title as _ds,
            SERIES_TITLE_PATTERNS as _stp,
        )
        assert extract_epub_metadata is _ext
        assert update_epub_metadata is _upd
        assert extract_urls_from_epub is _eu
        assert format_links_txt is _flt
        assert _canonicalize_relationship is _cr
        assert _canonicalize_fandom is _cf
        assert _suggest_fandom_merges is _sm
        assert detect_series_from_title is _ds
        assert SERIES_TITLE_PATTERNS is _stp

    def test_canonicalize_fandom_crossover_alpha_sorted(self):
        from utils.epub_metadata import _canonicalize_fandom
        assert _canonicalize_fandom("Twilight & Harry Potter") == "Harry Potter / Twilight"
        assert _canonicalize_fandom("Harry Potter/Twilight") == "Harry Potter / Twilight"
        assert _canonicalize_fandom("Marvel") == "Marvel"
        assert _canonicalize_fandom("") is None
        assert _canonicalize_fandom(None) is None

    def test_canonicalize_relationship_dedup_and_drop_disamb(self):
        from utils.epub_metadata import _canonicalize_relationship
        assert _canonicalize_relationship("Hermione/Harry (Harry Potter)") == "Harry / Hermione"
        assert _canonicalize_relationship("Sherlock") is None
        assert _canonicalize_relationship("Draco/Harry - past") == "Draco / Harry"

    def test_detect_series_from_title_basic(self):
        from utils.epub_metadata import detect_series_from_title
        s, idx = detect_series_from_title("The Final Empire (Mistborn #1)")
        assert s == "Mistborn"
        assert idx == 1.0

    def test_clean_author_string_unknown_sentinels(self):
        from utils.epub_metadata import _clean_author_string
        assert _clean_author_string("by John Smith") == "John Smith"
        assert _clean_author_string("Anonymous") == "Unknown"
        assert _clean_author_string("") == "Unknown"
        assert _clean_author_string("Various") == "Various"


# =====================================================================
# Phase-6 #3 — classifier shim
# =====================================================================

class TestPhase6ClassifierShim:
    def test_classifier_reexported_from_books(self):
        from routes.books import classify_by_metadata, classify_with_ai, classify_book
        from utils.classifier import (
            classify_by_metadata as _cbm,
            classify_with_ai as _cwa,
            classify_book as _cb,
        )
        assert classify_by_metadata is _cbm
        assert classify_with_ai is _cwa
        assert classify_book is _cb

    def test_classify_by_metadata_matches_known_fandom(self):
        from utils.classifier import classify_by_metadata
        result = classify_by_metadata({
            "title": "The Half Blood Prince Reimagined",
            "author": "fanwriter42",
            "description": "Drarry slow-burn slytherin AU hogwarts romance",
            "publisher": "",
            "sample_text": "harry potter hermione granger ron weasley dumbledore",
        })
        assert result["category"] == "Fanfiction"
        assert "Harry Potter" in (result["fandom"] or "")
        assert result["classifier"] == "metadata"
        assert result["confidence"] >= 0.6

    def test_classify_by_metadata_returns_unclassified_for_blank(self):
        from utils.classifier import classify_by_metadata
        result = classify_by_metadata({
            "title": "", "author": "", "description": "",
            "publisher": "", "sample_text": "",
        })
        assert result["category"] == "Unclassified"
        assert result["fandom"] is None
