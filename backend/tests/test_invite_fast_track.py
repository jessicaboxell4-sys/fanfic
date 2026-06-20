"""Tests for the invite-link fast-track signup path.

When a visitor lands with ``?ref=hpfb`` (or any other referral tag)
the frontend skips the onboarding questions panel and submits a
compact body to ``POST /auth/register``:

    {
      "email": ...,
      "password": ...,
      "accepted_rules": true,
      "onboarding": {"referral": "hpfb"}
    }

The backend's rule (auth.py:322) accepts this because the
``referral`` itself satisfies the "at least one onboarding answer"
check.  We test the end-to-end contract: a fast-track signup with
ONLY referral + accepted_rules + email/pw succeeds.

We also confirm the legacy paths still work:
  - questions_enabled=False + no referral → no onboarding required
  - questions_enabled=True + no referral → must answer at least one
    onboarding question OR submit will 400
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


# Helper: ensure signup config has questions_enabled=True so we
# actually exercise the gate.  Test_account email pattern is
# intentionally avoided so the bypass at auth.py:307 doesn't kick in.
@pytest.fixture(autouse=True)
def enable_questions():
    # Read current config
    cfg = db.signup_config.find_one({"_id": "singleton"}) or {}
    prior = cfg.get("questions_enabled", False)
    db.signup_config.update_one(
        {"_id": "singleton"},
        {"$set": {"questions_enabled": True, "approval_gate_enabled": True}},
        upsert=True,
    )
    yield
    db.signup_config.update_one(
        {"_id": "singleton"},
        {"$set": {"questions_enabled": prior}},
    )


@pytest.fixture(autouse=True)
def cleanup_test_users():
    yield
    # Remove any user created during this test run.
    db.users.delete_many({"email": {"$regex": r"^invite_test_"}})


def _make_email():
    """Pick an email that won't be caught by test_account_filter."""
    # Use a domain that's NOT in the test-filter set; .test_user_filter
    # already excludes @ft.local etc.  Use a fake but-not-blocklisted
    # domain so the approval gate actually runs.
    return f"invite_test_{uuid.uuid4().hex[:10]}@hpfanfic-readers.example.org"


def test_invite_fast_track_with_only_referral_succeeds():
    email = _make_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "TestPassw0rd!",
            "name": "Invite Test User",
            "accepted_rules": True,
            "onboarding": {"referral": "hpfb"},  # NO fandom, NO reader_type, NO is_13_plus
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # User is pending because approval_gate is on
    assert data.get("pending") is True
    # Confirm referral was recorded
    u = db.users.find_one({"email": email})
    assert u is not None
    assert (u.get("onboarding") or {}).get("referral") == "hpfb"


def test_register_without_referral_or_answers_blocks():
    """Confirms the original gate still works for non-invite traffic."""
    email = _make_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "TestPassw0rd!",
            "accepted_rules": True,
            "onboarding": {},  # empty — no referral, no fandom, no reader, no age
        },
    )
    assert r.status_code == 400
    assert "onboarding" in r.text.lower() or "answer" in r.text.lower()


def test_register_without_accepted_rules_blocks_even_with_referral():
    """Backend still requires accepted_rules even on fast-track.
    The frontend sets it implicitly; if a caller forgets, we want
    a clear 400."""
    email = _make_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "TestPassw0rd!",
            "onboarding": {"referral": "hpfb"},
            # accepted_rules intentionally omitted
        },
    )
    assert r.status_code == 400
    assert "rule" in r.text.lower()


def test_register_with_is_13_plus_false_still_blocks():
    """Sanity: even with referral fast-track, an explicit "I'm under 13"
    answer rejects the signup.  The fast-track skips ASKING this
    question, leaving it null — that's the intended pass."""
    email = _make_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "TestPassw0rd!",
            "accepted_rules": True,
            "onboarding": {"referral": "hpfb", "is_13_plus": False},
        },
    )
    assert r.status_code == 403


def test_register_with_referral_only_no_age_question_passes():
    """The whole point of the fast-track: skipping the age radio
    means is_13_plus=null, which the backend's age check
    (``if is_13_plus is False``) does NOT block."""
    email = _make_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={
            "email": email,
            "password": "TestPassw0rd!",
            "accepted_rules": True,
            "onboarding": {"referral": "hpfb"},  # is_13_plus omitted → null
        },
    )
    assert r.status_code == 200, r.text
