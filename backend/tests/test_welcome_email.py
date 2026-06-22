"""Tests for utils/welcome_email — smart welcome composer (2026-06-22).

Pure-function tests on ``build_welcome_email`` cover all four
reader_type branches, the fandom-specific second sentence, the
referral opening line, and the CTA re-ordering.  The async
``send_welcome_email`` sender is covered separately by mocking
``resend.Emails.send``.
"""
from __future__ import annotations

import os
import sys
import pathlib
import uuid
from unittest.mock import patch

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


# ---------------------------------------------------------------------------
# Pure builder tests — no I/O, no monkeypatching, no event loop.
# ---------------------------------------------------------------------------
def test_build_welcome_default_when_no_onboarding():
    """With zero onboarding data we fall back to the generic tip."""
    from utils.welcome_email import build_welcome_email
    subj, html, text = build_welcome_email(name="Sam", onboarding=None, frontend_url="https://app.example")
    assert "Welcome to Shelfsort" in subj
    assert "Hi Sam" in html and "Hi Sam" in text
    # Generic copy from _DEFAULT_TIP
    assert "Glad to have you" in html
    # All three CTAs present in the text body
    assert "/library" in text
    assert "/friends" in text
    assert "/help" in text


def test_build_welcome_fanfic_reader_with_fandom():
    """Fanfic + fandom → fandom-specific second sentence + library CTA first."""
    from utils.welcome_email import build_welcome_email
    _, html, text = build_welcome_email(
        name="Alex",
        onboarding={"reader_type": "fanfic", "favorite_fandom": "Stargate SG-1"},
        frontend_url="https://app.example",
    )
    assert "You're here for the fic" in html
    assert "Stargate SG-1" in html
    assert "Stargate SG-1" in text
    # Library CTA appears first (primary) — its label is "Upload your first books"
    library_idx = text.find("Upload your first books")
    friends_idx = text.find("Find a reading friend")
    assert 0 <= library_idx < friends_idx


def test_build_welcome_original_reader_no_fandom_line():
    """Original reader → no fandom-specific second sentence even if fandom is set."""
    from utils.welcome_email import build_welcome_email
    _, html, _ = build_welcome_email(
        name="Jess",
        onboarding={"reader_type": "original", "favorite_fandom": "Sherlock Holmes"},
        frontend_url="https://app.example",
    )
    assert "Original-fiction-first" in html
    # We only inject the fandom line for fanfic / mix readers.
    assert "Sherlock Holmes" not in html


def test_build_welcome_organize_reader_no_fandom_line():
    """The 'just organize' reader_type never gets a fandom callout."""
    from utils.welcome_email import build_welcome_email
    _, html, _ = build_welcome_email(
        name="Pat",
        onboarding={"reader_type": "organize", "favorite_fandom": "Marvel"},
        frontend_url="https://app.example",
    )
    assert "You're here to organize" in html
    assert "Marvel" not in html


def test_build_welcome_referral_line_known_source():
    """Known referral source → its specific thank-you copy."""
    from utils.welcome_email import build_welcome_email
    _, html, text = build_welcome_email(
        name="Rin",
        onboarding={"referral": "reddit"},
        frontend_url="https://app.example",
    )
    assert "Thanks for finding us on Reddit" in html
    assert "Thanks for finding us on Reddit" in text


def test_build_welcome_referral_line_unknown_source():
    """Unknown referral source → generic thank-you (still personal)."""
    from utils.welcome_email import build_welcome_email
    _, html, _ = build_welcome_email(
        name="Kim",
        onboarding={"referral": "some-podcast"},
        frontend_url="https://app.example",
    )
    assert "Thanks for finding us." in html


def test_build_welcome_unknown_reader_type_falls_back():
    """A reader_type the copy bank doesn't know → default heading."""
    from utils.welcome_email import build_welcome_email
    _, html, _ = build_welcome_email(
        name="Lee",
        onboarding={"reader_type": "totally-new-type"},
        frontend_url="https://app.example",
    )
    assert "Glad to have you" in html


def test_build_welcome_frontend_url_inlined_in_links():
    """CTAs should be absolute URLs using frontend_url + path."""
    from utils.welcome_email import build_welcome_email
    _, html, text = build_welcome_email(
        name="Mo",
        onboarding={"reader_type": "fanfic"},
        frontend_url="https://genre-sort.preview.emergentagent.com",
    )
    assert "https://genre-sort.preview.emergentagent.com/library" in html
    assert "https://genre-sort.preview.emergentagent.com/library" in text


def test_build_welcome_strips_trailing_slash():
    """frontend_url trailing slash shouldn't yield //library."""
    from utils.welcome_email import build_welcome_email
    _, html, _ = build_welcome_email(
        name="Em",
        onboarding={"reader_type": "fanfic"},
        frontend_url="https://app.example/",
    )
    assert "//library" not in html  # well-formed
    assert "https://app.example/library" in html


def test_build_welcome_no_name_uses_there():
    """When name is missing the greeting falls back to 'Hi there'."""
    from utils.welcome_email import build_welcome_email
    _, html, text = build_welcome_email(name="", onboarding=None, frontend_url="")
    assert "Hi there" in html
    assert "Hi there" in text


# ---------------------------------------------------------------------------
# Sender wrapper tests — patches resend.Emails.send so we don't burn quota.
# ---------------------------------------------------------------------------
def test_send_welcome_email_returns_false_when_resend_unconfigured(loop, monkeypatch):
    """No RESEND_API_KEY → bail out cleanly, returning False."""
    from utils import welcome_email as mod
    monkeypatch.setattr(mod, "RESEND_API_KEY", "")
    monkeypatch.setattr(mod, "SENDER_EMAIL", "")
    ok = _run(loop, mod.send_welcome_email({"email": "a@b.com", "name": "A"}, source="approval"))
    assert ok is False


def test_send_welcome_email_returns_false_when_email_missing(loop, monkeypatch):
    from utils import welcome_email as mod
    monkeypatch.setattr(mod, "RESEND_API_KEY", "fake_key")
    monkeypatch.setattr(mod, "SENDER_EMAIL", "from@x.com")
    ok = _run(loop, mod.send_welcome_email({"email": "", "name": "A"}, source="auto_approve"))
    assert ok is False


def test_send_welcome_email_writes_email_log_on_success(loop, monkeypatch, sync_db):
    """On a successful send, an email_logs row is written with the
    right ``kind`` slug (welcome_approval / welcome_auto_approve)."""
    from utils import welcome_email as mod
    suffix = uuid.uuid4().hex[:6]
    fake_to = f"welcometest_{suffix}@example.com"

    monkeypatch.setattr(mod, "RESEND_API_KEY", "fake_key")
    monkeypatch.setattr(mod, "SENDER_EMAIL", "from@example.com")
    monkeypatch.setattr(mod, "FRONTEND_URL", "https://app.example")

    # Mock resend.Emails.send to a no-op so we never actually call out.
    with patch("resend.Emails.send", return_value={"id": "fake-resend-id"}):
        ok = _run(loop, mod.send_welcome_email(
            {"email": fake_to, "name": "Welcome Tester",
             "onboarding": {"reader_type": "mix", "favorite_fandom": "Harry Potter"}},
            source="approval",
        ))
    assert ok is True

    # Confirm the email_logs entry shape.
    try:
        row = sync_db.email_logs.find_one({"to": fake_to})
        assert row is not None
        assert row["kind"] == "welcome_approval"
        assert row["status"] == "ok"
    finally:
        sync_db.email_logs.delete_many({"to": fake_to})


def test_send_welcome_email_logs_error_on_resend_failure(loop, monkeypatch, sync_db):
    """When Resend raises, we still log the failure (with kind/status='error')."""
    from utils import welcome_email as mod
    suffix = uuid.uuid4().hex[:6]
    fake_to = f"welcomefail_{suffix}@example.com"

    monkeypatch.setattr(mod, "RESEND_API_KEY", "fake_key")
    monkeypatch.setattr(mod, "SENDER_EMAIL", "from@example.com")

    with patch("resend.Emails.send", side_effect=RuntimeError("simulated Resend 500")):
        ok = _run(loop, mod.send_welcome_email(
            {"email": fake_to, "name": "X"}, source="auto_approve",
        ))
    assert ok is False

    try:
        row = sync_db.email_logs.find_one({"to": fake_to})
        assert row is not None
        assert row["kind"] == "welcome_auto_approve"
        assert row["status"] == "error"
        assert row["error"] and "simulated Resend 500" in row["error"]
    finally:
        sync_db.email_logs.delete_many({"to": fake_to})
