"""Tests for the email suppression layer.

Verifies the monkey-patch at ``utils/email_suppression.py``:

  - Test-recipient emails (matching ``is_test_account``) are never
    forwarded to Resend; an ``email_logs`` row with
    ``status="suppressed"`` and ``suppress_reason="test_recipient"``
    is written instead.

  - When the ``outbound_emails_enabled`` feature flag is set to
    False, real-domain emails are also suppressed and a matching
    ``notifications`` row is queued for the user.

We invoke the patched ``resend.Emails.send`` directly to avoid the
network — the goal is to lock in the suppression contract, not the
Resend HTTP call.
"""
import os
import uuid

import pytest
import resend
from pymongo import MongoClient

from utils.email_suppression import install
from utils import email_suppression as es

mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


@pytest.fixture(autouse=True)
def cleanup_logs():
    # Snapshot of log ids we created so we can remove them after each test.
    created_log_ids = []
    created_notif_ids = []
    es._created_log_ids = created_log_ids  # type: ignore[attr-defined]
    es._created_notif_ids = created_notif_ids  # type: ignore[attr-defined]
    yield
    if created_log_ids:
        db.email_logs.delete_many({"log_id": {"$in": created_log_ids}})
    if created_notif_ids:
        db.notifications.delete_many({"notification_id": {"$in": created_notif_ids}})


@pytest.fixture(autouse=True, scope="module")
def install_once():
    install()
    yield


def _send(to_email, subject="test", kind="approval_approved"):
    """Call the patched send and capture the latest log row."""
    pre_ids = {d.get("log_id") for d in db.email_logs.find({}, {"log_id": 1})}
    pre_notif_ids = {d.get("notification_id")
                     for d in db.notifications.find({}, {"notification_id": 1})}
    res = resend.Emails.send({
        "from": "Shelfsort <hi@shelfsort.com>",
        "to": to_email,
        "subject": subject,
        "html": "<p>test</p>",
        "_kind": kind,
    })
    post_logs = [d for d in db.email_logs.find({})
                 if d.get("log_id") and d.get("log_id") not in pre_ids]
    post_notifs = [d for d in db.notifications.find({})
                   if d.get("notification_id") and d.get("notification_id") not in pre_notif_ids]
    for d in post_logs:
        es._created_log_ids.append(d["log_id"])  # type: ignore[attr-defined]
    for d in post_notifs:
        es._created_notif_ids.append(d["notification_id"])  # type: ignore[attr-defined]
    return res, post_logs, post_notifs


def test_test_recipient_is_suppressed():
    res, logs, _ = _send("pytest_user@example.com", kind="approval_approved")
    assert isinstance(res, dict) and res.get("id", "").startswith("suppressed-test-")
    assert len(logs) == 1
    assert logs[0]["status"] == "suppressed"
    assert logs[0]["suppress_reason"] == "test_recipient"
    assert logs[0]["kind"] == "approval_approved"


def test_test_local_part_pattern_suppressed():
    """Local-part like ``test_xxx`` should match even with a real-
    looking domain."""
    res, logs, _ = _send(f"test_{uuid.uuid4().hex[:6]}@real-domain-acme.shop")
    assert res["id"].startswith("suppressed-test-")
    assert logs and logs[0]["suppress_reason"] == "test_recipient"


def test_real_recipient_with_outbound_enabled_calls_through(monkeypatch):
    """When the flag is on (default), real emails reach the original
    Resend send.  We monkey-patch ``_ORIGINAL_SEND`` to verify the
    pass-through without hitting the network."""
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": True}},
        upsert=True,
    )
    calls = []

    def fake_original(params):
        calls.append(params)
        return {"id": "real-fake-resend-id"}

    monkeypatch.setattr(es, "_ORIGINAL_SEND", fake_original)
    res, logs, _ = _send("real_user@shelfsort.com")
    assert calls and calls[0]["to"] == "real_user@shelfsort.com"
    assert res["id"] == "real-fake-resend-id"
    # No suppression log on the happy path — the call-site logs the
    # successful send on its own.
    assert logs == []


def test_outbound_paused_suppresses_and_queues_notification(monkeypatch):
    """Flag OFF → real email is suppressed; if the recipient has a
    user account, an in-app notification is queued instead."""
    # Seed a real user
    uid = f"user_suppress_test_{uuid.uuid4().hex[:6]}"
    email = f"real_{uuid.uuid4().hex[:6]}@shelfsort.com"
    db.users.insert_one({"user_id": uid, "email": email, "name": "Suppress test"})
    try:
        db.feature_flags.update_one(
            {"_id": "singleton"},
            {"$set": {"outbound_emails_enabled": False}},
            upsert=True,
        )

        def fake_original(params):
            raise AssertionError("Should not have hit Resend!")
        monkeypatch.setattr(es, "_ORIGINAL_SEND", fake_original)

        res, logs, notifs = _send(email, subject="You're approved!",
                                  kind="approval_approved")
        assert res["id"].startswith("suppressed-paused-")
        assert logs and logs[0]["suppress_reason"] == "outbound_paused"
        # In-app notification was queued for the real user
        assert any(n.get("user_id") == uid for n in notifs)
    finally:
        # Restore default state so other tests don't suppress
        db.feature_flags.update_one(
            {"_id": "singleton"},
            {"$set": {"outbound_emails_enabled": True}},
        )
        db.users.delete_one({"user_id": uid})


def test_outbound_paused_skips_notification_when_user_unknown(monkeypatch):
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": False}},
        upsert=True,
    )
    try:
        monkeypatch.setattr(es, "_ORIGINAL_SEND",
                            lambda p: (_ for _ in ()).throw(AssertionError("unreachable")))
        res, logs, notifs = _send(f"unknown_{uuid.uuid4().hex[:6]}@shelfsort.com",
                                  kind="digest")
        assert res["id"].startswith("suppressed-paused-")
        assert logs and logs[0]["suppress_reason"] == "outbound_paused"
        # No matching user → no notification queued (silent no-op)
        assert notifs == []
    finally:
        db.feature_flags.update_one(
            {"_id": "singleton"},
            {"$set": {"outbound_emails_enabled": True}},
        )
