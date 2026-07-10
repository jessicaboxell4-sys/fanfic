"""Unit tests for the engagement gate added to the weekly bookclub digest.

Validates that `maybe_send_bookclub_digest`:
- Skips emails for users who haven't posted or moved progress in 28+ days,
- Still marks the ISO-year-week handled so the gate doesn't re-tick all week,
- Treats a recent bookclub_message as engagement,
- Treats a recent last_progress_update_at as engagement.
"""
import os
import sys
import uuid
import asyncio
import pytest
from datetime import datetime, timezone, timedelta

# Test runs from /app/backend; import the route module directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.bookclubs import (
    _user_recently_engaged,
    BOOKCLUB_DIGEST_ENGAGEMENT_DAYS,
    maybe_send_bookclub_digest,
)
from deps import db


def _u(name):
    return {
        "user_id": f"engtest_{name}_{uuid.uuid4().hex[:8]}",
        "email": f"engtest_{name}_{uuid.uuid4().hex[:8]}@example.com",
        "name": f"Engagement {name}",
    }


@pytest.fixture
def loop(shared_event_loop):
    """Bind every test in this module to the session-scoped Motor loop
    (see ``tests/conftest.py``). Without this we'd silently use a fresh
    ``asyncio.get_event_loop()`` and bind Motor to it, then later tests
    in the same pytest run (``test_cron_failure_alerts.py`` etc.) would
    hit ``RuntimeError: Future attached to a different loop`` — which
    ``_maybe_alert_admins`` swallows, breaking the email-fire path.
    """
    return shared_event_loop


def _run(loop, coro):
    return loop.run_until_complete(coro)


@pytest.fixture
def fresh_users(loop):
    """Create three users: idle, recent-message, recent-progress."""
    users = {"idle": _u("idle"), "msg": _u("msg"), "prog": _u("prog")}
    now = datetime.now(timezone.utc)
    for u in users.values():
        u["doc"] = {
            **u,
            "is_admin": False,
            "created_at": now.isoformat(),
            "bookclub_digest": {"email_enabled": True, "last_year_week": None},
        }
        _run(loop, db.users.insert_one(dict(u["doc"])))
    yield users
    for u in users.values():
        _run(loop, db.users.delete_one({"user_id": u["user_id"]}))
        _run(loop, db.bookclub_messages.delete_many({"user_id": u["user_id"]}))
        _run(loop, db.bookclub_members.delete_many({"user_id": u["user_id"]}))


def test_idle_user_not_engaged(loop, fresh_users):
    uid = fresh_users["idle"]["user_id"]
    assert _run(loop, _user_recently_engaged(uid)) is False


def test_recent_message_counts_as_engaged(loop, fresh_users):
    uid = fresh_users["msg"]["user_id"]
    _run(loop, db.bookclub_messages.insert_one({
        "message_id": f"msg_{uuid.uuid4().hex[:8]}",
        "room_id": "club_dummy", "user_id": uid, "user_name": "Engagement msg",
        "chapter_index": 0, "body": "hi",
        "created_at": datetime.now(timezone.utc) - timedelta(days=5),
    }))
    assert _run(loop, _user_recently_engaged(uid)) is True


def test_old_message_does_not_count(loop, fresh_users):
    uid = fresh_users["msg"]["user_id"]
    _run(loop, db.bookclub_messages.insert_one({
        "message_id": f"msg_{uuid.uuid4().hex[:8]}",
        "room_id": "club_dummy", "user_id": uid, "user_name": "Engagement msg",
        "chapter_index": 0, "body": "stale",
        "created_at": datetime.now(timezone.utc) - timedelta(days=BOOKCLUB_DIGEST_ENGAGEMENT_DAYS + 5),
    }))
    assert _run(loop, _user_recently_engaged(uid)) is False


def test_recent_progress_counts_as_engaged(loop, fresh_users):
    uid = fresh_users["prog"]["user_id"]
    _run(loop, db.bookclub_members.insert_one({
        "room_id": "club_dummy", "user_id": uid, "role": "member",
        "status": "active", "current_chapter": 3,
        "last_progress_update_at": datetime.now(timezone.utc) - timedelta(days=2),
    }))
    assert _run(loop, _user_recently_engaged(uid)) is True


def test_idle_user_digest_skipped_but_week_marked(loop, fresh_users):
    """The whole point of the gate: a quiet user should not get the email
    AND we should bump `last_year_week` so the next tick same week is a no-op.
    """
    udoc = fresh_users["idle"]["doc"]
    delivered = _run(loop, maybe_send_bookclub_digest(udoc))
    assert delivered is False

    refreshed = _run(loop, db.users.find_one({"user_id": udoc["user_id"]}, {"_id": 0, "bookclub_digest": 1}))
    yw = refreshed.get("bookclub_digest", {}).get("last_year_week")
    iso = datetime.now(timezone.utc).isocalendar()
    expected = f"{iso[0]}-W{iso[1]:02d}"
    assert yw == expected, f"expected {expected}, got {yw}"
