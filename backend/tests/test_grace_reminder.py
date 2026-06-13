"""Test for the 7-day account-deletion grace reminder email.

This was a P0 production bug: `routes/digest.py::_account_grace_tick`
called `_send_grace_reminder_email(u)` but the function did not exist
anywhere in the codebase. That meant the daily cron crashed every night
and users scheduled for hard-deletion never got the warning email — they
just got silently deleted at the end of the grace window.

These tests pin the helper function's contract so it can't go missing
again. The Resend send path itself is exercised via `RESEND_API_KEY=""`
(the "would have sent" branch) so the suite doesn't burn real Resend
credit on every test run.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest

backend_dir = str(pathlib.Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


def test_grace_reminder_function_is_defined():
    """Regression guard: the cron job calls this — it must exist."""
    from routes import digest
    assert hasattr(digest, "_send_grace_reminder_email"), (
        "routes.digest._send_grace_reminder_email is missing — the daily "
        "account-deletion grace-tick cron will crash without it."
    )
    assert callable(digest._send_grace_reminder_email)


def test_grace_reminder_returns_logged_when_no_resend_key(loop, monkeypatch):
    """When RESEND_API_KEY is empty, the helper logs + returns
    {delivered: False, logged: True} so the cron can still flip
    grace_reminder_sent_at and not loop forever."""
    from routes import digest
    monkeypatch.setattr(digest, "RESEND_API_KEY", "")
    user_doc = {
        "user_id": f"user_grt_{uuid.uuid4().hex[:8]}",
        "email": "grace@example.com",
        "name": "Grace Tester",
        "scheduled_deletion_at": datetime.now(timezone.utc) + timedelta(days=7),
    }
    res = loop.run_until_complete(digest._send_grace_reminder_email(user_doc))
    assert res == {"delivered": False, "logged": True}


def test_grace_reminder_handles_missing_name(loop, monkeypatch):
    """If user has no name, the email should still render cleanly."""
    from routes import digest
    monkeypatch.setattr(digest, "RESEND_API_KEY", "")
    user_doc = {
        "user_id": f"user_grt_{uuid.uuid4().hex[:8]}",
        "email": "anon@example.com",
        "scheduled_deletion_at": datetime.now(timezone.utc) + timedelta(days=7),
    }
    res = loop.run_until_complete(digest._send_grace_reminder_email(user_doc))
    assert res["delivered"] is False


def test_grace_reminder_handles_missing_scheduled_date(loop, monkeypatch):
    """If the date is missing for some reason, fall back to a generic phrase
    rather than crashing the cron."""
    from routes import digest
    monkeypatch.setattr(digest, "RESEND_API_KEY", "")
    user_doc = {
        "user_id": f"user_grt_{uuid.uuid4().hex[:8]}",
        "email": "x@example.com",
        "name": "X",
    }
    res = loop.run_until_complete(digest._send_grace_reminder_email(user_doc))
    assert res == {"delivered": False, "logged": True}


def test_grace_reminder_catches_resend_failure(loop, monkeypatch):
    """A Resend exception must NOT propagate — the cron loops over many
    users and one broken email shouldn't poison the whole batch."""
    import routes.digest as digest

    monkeypatch.setattr(digest, "RESEND_API_KEY", "fake-key-for-test")

    class _FakeEmails:
        @staticmethod
        def send(params):  # noqa: D401 — match Resend's API shape
            raise RuntimeError("simulated SMTP failure")

    monkeypatch.setattr(digest.resend, "Emails", _FakeEmails)
    user_doc = {
        "user_id": "u",
        "email": "fail@example.com",
        "name": "Fail",
        "scheduled_deletion_at": datetime.now(timezone.utc) + timedelta(days=7),
    }
    res = loop.run_until_complete(digest._send_grace_reminder_email(user_doc))
    assert res["delivered"] is False
    assert "error" in res
