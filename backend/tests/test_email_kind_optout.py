"""Tests for the per-kind email opt-out + suppression integration.

Covers:
  - GET /api/account/email-prefs returns all opt-in defaults
  - PUT /api/account/email-prefs patches a single kind
  - Setting a kind to False causes the suppression layer to short-
    circuit that kind's emails AND queue an in-app notification
  - Non-optable kinds (e.g. 'password_reset') ignore the user pref
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
import resend
from pymongo import MongoClient

from utils.email_suppression import install
from utils import email_suppression as es

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]

UID = f"user_opt_{uuid.uuid4().hex[:6]}"
TOK = f"sess_opt_{uuid.uuid4().hex}"
EMAIL = f"real_optout_{uuid.uuid4().hex[:6]}@shelfsort.com"


@pytest.fixture(scope="module", autouse=True)
def seed():
    install()
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": UID, "email": EMAIL,
        "name": "Opt-out tester", "is_admin": False,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": UID, "session_token": TOK,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    yield
    db.users.delete_many({"user_id": UID})
    db.user_sessions.delete_many({"user_id": UID})
    db.notifications.delete_many({"user_id": UID})
    # Make sure outbound flag is back ON for other tests
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": True}},
        upsert=True,
    )


def H():
    return {"Authorization": f"Bearer {TOK}"}


def test_default_prefs_are_all_on():
    r = requests.get(f"{BASE}/api/account/email-prefs", headers=H())
    assert r.status_code == 200, r.text
    data = r.json()
    prefs = data["prefs"]
    # Every optable kind defaults to True
    for kind in data["optable_kinds"]:
        assert prefs[kind] is True, f"{kind} should default True"
    # Make sure approval_approved is listed
    assert "approval_approved" in prefs


def test_put_patches_single_kind():
    r = requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": False},
        headers=H(),
    )
    assert r.status_code == 200
    assert r.json()["prefs"]["approval_approved"] is False
    assert r.json()["prefs"]["year_in_books"] is True  # unchanged

    # Restore for next test
    requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": True},
        headers=H(),
    )


def test_opted_out_kind_suppressed_and_in_app_queued(monkeypatch):
    """Set approval_approved=False → calling resend.Emails.send to
    this user with _kind=approval_approved suppresses and queues
    a notifications row."""
    # Ensure outbound flag is on (so we're isolating the user-opt gate)
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": True}},
        upsert=True,
    )
    # Opt out
    requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": False},
        headers=H(),
    )

    monkeypatch.setattr(es, "_ORIGINAL_SEND",
                        lambda p: (_ for _ in ()).throw(AssertionError("should not send")))

    pre = db.notifications.count_documents({"user_id": UID})
    res = resend.Emails.send({
        "from": "Shelfsort <hi@shelfsort.com>",
        "to": EMAIL,
        "subject": "You're approved!",
        "html": "<p>welcome</p>",
        "_kind": "approval_approved",
    })
    assert res["id"].startswith("suppressed-optout-")
    post = db.notifications.count_documents({"user_id": UID})
    assert post == pre + 1, "expected an in-app notification queued"

    # Restore
    requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": True},
        headers=H(),
    )


def test_non_optable_kind_passes_through(monkeypatch):
    """Even if user has 'approval_approved' off, a 'password_reset'
    email still goes through Resend — security kinds are non-
    optable."""
    db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {"outbound_emails_enabled": True}},
        upsert=True,
    )
    requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": False},
        headers=H(),
    )

    calls = []
    monkeypatch.setattr(es, "_ORIGINAL_SEND", lambda p: calls.append(p) or {"id": "ok"})

    res = resend.Emails.send({
        "from": "Shelfsort <hi@shelfsort.com>",
        "to": EMAIL,
        "subject": "Reset your password",
        "html": "<p>x</p>",
        "_kind": "password_reset",
    })
    assert res["id"] == "ok"
    assert calls and calls[0]["to"] == EMAIL

    # Restore
    requests.put(
        f"{BASE}/api/account/email-prefs",
        json={"approval_approved": True},
        headers=H(),
    )
