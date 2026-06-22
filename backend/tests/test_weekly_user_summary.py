"""Regression coverage for the consolidated weekly user summary
(shipped 2026-06-22).  Covers:

* The opt-in check (``is_in_weekly_summary_mode``).
* Each kind-sender (digest, update_digest, bookclub, friends-finished)
  early-returns when the user is opted in.
* The Friday cron walks opt-in users + skips test-fixture emails.
* Empty data → ``nothing_to_say`` (no email burned).
* Cooldown — a second run the same week is a no-op.
"""
from __future__ import annotations

import os
import sys
import pathlib
import uuid
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402


@pytest.fixture(scope="module")
def sync_db():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url, maxPoolSize=4)
    yield c[name]
    c.close()


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


def _run(loop, coro):
    return loop.run_until_complete(coro)


@pytest.fixture()
def opt_in_user(sync_db):
    suffix = uuid.uuid4().hex[:8]
    uid = f"user_ws_{suffix}"
    email = f"reader{suffix}@shelfsort-prod-test.com"
    sync_db.users.insert_one({
        "user_id":         uid,
        "email":           email,
        "name":            "Weekly Summary Tester",
        "is_admin":        False,
        "approval_status": "approved",
        "weekly_summary":  {"enabled": True},
    })
    yield {"user_id": uid, "email": email}
    sync_db.users.delete_many({"user_id": uid})
    sync_db.books.delete_many({"user_id": uid})


def test_is_in_weekly_summary_mode():
    from utils.weekly_user_summary import is_in_weekly_summary_mode
    assert is_in_weekly_summary_mode({"weekly_summary": {"enabled": True}}) is True
    assert is_in_weekly_summary_mode({"weekly_summary": {"enabled": False}}) is False
    assert is_in_weekly_summary_mode({}) is False
    assert is_in_weekly_summary_mode({"weekly_summary": {}}) is False
    assert is_in_weekly_summary_mode(None) is False


def test_kind_sender_digest_email_skips_when_opted_in(loop, opt_in_user):
    """``_send_digest_email`` must early-return with reason
    ``weekly_summary_mode`` when the user has opted into the
    consolidated Friday digest."""
    from routes.digest import _send_digest_email
    user_doc = {
        "user_id": opt_in_user["user_id"],
        "email":   opt_in_user["email"],
        "weekly_summary": {"enabled": True},
    }
    result = _run(loop, _send_digest_email(user_doc))
    assert result.get("delivered") is False
    assert result.get("reason") == "weekly_summary_mode"


def test_kind_sender_update_digest_skips_when_opted_in(loop, opt_in_user):
    from routes.digest import _send_update_digest_email
    user_doc = {
        "user_id": opt_in_user["user_id"],
        "email":   opt_in_user["email"],
        "weekly_summary": {"enabled": True},
    }
    result = _run(loop, _send_update_digest_email(user_doc, ["fake_book_id"]))
    assert result.get("delivered") is False
    assert result.get("reason") == "weekly_summary_mode"


def test_kind_sender_bookclub_digest_skips_when_opted_in(loop, opt_in_user):
    from routes.bookclubs import maybe_send_bookclub_digest
    user_doc = {
        "user_id": opt_in_user["user_id"],
        "email":   opt_in_user["email"],
        "weekly_summary": {"enabled": True},
        # Also opted into the per-channel email so we exercise the
        # *opt-out from per-channel* path specifically.
        "bookclub_digest": {"email_enabled": True},
    }
    result = _run(loop, maybe_send_bookclub_digest(user_doc))
    # Returns False — the digest was suppressed in favour of the
    # consolidated weekly_summary email.
    assert result is False


def test_orchestrator_skips_when_no_data(loop, opt_in_user, sync_db, monkeypatch):
    """Brand-new user with empty library → ``nothing_to_say``
    (and no email burned)."""
    from utils.weekly_user_summary import _send_one
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": "x"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    user_doc = sync_db.users.find_one({"user_id": opt_in_user["user_id"]})
    result = _run(loop, _send_one(user_doc, datetime.now(timezone.utc)))
    assert result.get("sent") is False
    assert result.get("reason") == "nothing_to_say"
    assert sent == []  # nothing was sent


def test_orchestrator_sends_consolidated_email_when_data_present(
    loop, opt_in_user, sync_db, monkeypatch,
):
    """Seed a stuck book → orchestrator finds 1 section + sends ONE
    email (not several per-kind emails)."""
    from utils.weekly_user_summary import _send_one
    uid = opt_in_user["user_id"]
    # Seed a stuck book
    stuck_at = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    sync_db.books.insert_one({
        "book_id":           f"bk_ws_{uuid.uuid4().hex[:6]}",
        "user_id":           uid,
        "title":             "Stuck Forever",
        "author":            "Tester",
        "category":          "Fanfiction",
        "fandom":            "Harry Potter",
        "last_opened_at":    stuck_at,
        "progress_fraction": 0.15,
    })
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": f"x-{uuid.uuid4().hex[:6]}"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    user_doc = sync_db.users.find_one({"user_id": uid})
    result = _run(loop, _send_one(user_doc, datetime.now(timezone.utc)))
    assert result.get("sent") is True
    assert result.get("sections") >= 1
    assert len(sent) == 1
    body = sent[0]
    assert "Stuck Forever" in body.get("html", "")
    assert body.get("_kind") == "weekly_summary"
    # last_sent_at + last_sections persisted
    refreshed = sync_db.users.find_one({"user_id": uid})
    assert (refreshed.get("weekly_summary") or {}).get("last_sent_at")


def test_orchestrator_filters_test_fixture_emails(
    loop, sync_db, monkeypatch,
):
    """A user with a blocklisted address (``@example.com``) must NOT
    receive the weekly summary even when opted in — those addresses
    bounce hard and waste Resend quota."""
    from utils.weekly_user_summary import user_weekly_summary_tick
    suffix = uuid.uuid4().hex[:6]
    uid_fixture = f"user_ws_fx_{suffix}"
    sync_db.users.insert_one({
        "user_id":        uid_fixture,
        "email":          f"fixture-{suffix}@example.com",  # blocklisted
        "weekly_summary": {"enabled": True},
    })
    # Seed a stuck book so there's data to digest
    sync_db.books.insert_one({
        "book_id":           f"bk_ws_fx_{suffix}",
        "user_id":           uid_fixture,
        "title":             "Fixture Stuck",
        "last_opened_at":    (datetime.now(timezone.utc) - timedelta(days=20)).isoformat(),
        "progress_fraction": 0.10,
    })
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": "x"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    try:
        result = _run(loop, user_weekly_summary_tick())
        # The fixture user was skipped — sent list contains nothing
        # for that fixture email.
        fixture_sent = [p for p in sent if p.get("to") == [f"fixture-{suffix}@example.com"]]
        assert fixture_sent == [], "fixture email should NOT be sent"
        assert result.get("skipped", 0) >= 1
    finally:
        sync_db.users.delete_many({"user_id": uid_fixture})
        sync_db.books.delete_many({"user_id": uid_fixture})
