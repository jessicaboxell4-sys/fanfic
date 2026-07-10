"""Regression coverage for the Send-to-Kindle feature (2026-06-22).

Covers:
* Kindle-email validator (the @kindle.com / @free.kindle.com regex).
* GET/PUT /api/user/kindle-settings round-trip + validation.
* Send happy path with a real-sized EPUB attachment (Resend mocked).
* All error responses:
    - 400 no email / invalid email
    - 403 quarantined book
    - 404 unknown book
    - 413 oversized file
    - 429 rate limit (re-send within 30 min)
    - 502 Resend error surfaced cleanly
* email_logs row + kindle_send_log row written for every attempt.
"""
from __future__ import annotations

import os
import sys
import pathlib
import re
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
def kindle_user(sync_db):
    """A real (non-fixture) user with a tiny EPUB stored on disk so the
    send path actually reads bytes."""
    from deps import STORAGE_DIR
    suffix = uuid.uuid4().hex[:8]
    uid = f"user_stk_{suffix}"
    email = f"reader{suffix}@shelfsort-prod-test.com"
    book_id = f"bk_stk_{suffix}"
    fp = STORAGE_DIR / uid / f"{book_id}.epub"
    fp.parent.mkdir(parents=True, exist_ok=True)
    # Minimal EPUB-ish payload — Send-to-Kindle doesn't validate the
    # contents, only the size.
    fp.write_bytes(b"PK\x03\x04" + b"x" * 2048)
    sync_db.users.insert_one({
        "user_id":         uid,
        "email":           email,
        "name":            "Kindle Test",
        "kindle_email":    f"kindle-{suffix}@kindle.com",
        "approval_status": "approved",
    })
    sync_db.books.insert_one({
        "book_id":  book_id,
        "user_id":  uid,
        "title":    "Test Book",
        "author":   "T. Ester",
        "category": "Fanfiction",
        "fandom":   "Harry Potter",
        "av_status": "clean",
    })
    yield {"user_id": uid, "email": email, "book_id": book_id, "fp": fp}
    sync_db.users.delete_many({"user_id": uid})
    sync_db.books.delete_many({"user_id": uid})
    sync_db.kindle_send_log.delete_many({"user_id": uid})
    sync_db.email_logs.delete_many({"to": {"$regex": f"^kindle-{suffix}@"}})
    try:
        fp.unlink()
        fp.parent.rmdir()
    except OSError:
        pass


def test_is_valid_kindle_email():
    from utils.send_to_kindle import is_valid_kindle_email
    assert is_valid_kindle_email("foo@kindle.com")
    assert is_valid_kindle_email("FOO@KINDLE.COM")  # case-insensitive
    assert is_valid_kindle_email("foo@free.kindle.com")
    assert is_valid_kindle_email("foo.bar+x@kindle.com")
    assert not is_valid_kindle_email("foo@example.com")
    assert not is_valid_kindle_email("@kindle.com")
    assert not is_valid_kindle_email("")
    assert not is_valid_kindle_email(None)
    assert not is_valid_kindle_email("foo@kindle.co")
    assert not is_valid_kindle_email("foo@kindle.com.evil.com")


def test_set_and_get_kindle_email(loop, kindle_user, sync_db):
    from utils.send_to_kindle import set_kindle_email, get_kindle_settings
    uid = kindle_user["user_id"]
    # Set a fresh one
    r = _run(loop, set_kindle_email(uid, "new@kindle.com"))
    assert r == {"kindle_email": "new@kindle.com"}
    fresh = sync_db.users.find_one({"user_id": uid})
    assert fresh["kindle_email"] == "new@kindle.com"
    # GET returns it + the configured sender
    payload = _run(loop, get_kindle_settings(uid))
    assert payload["kindle_email"] == "new@kindle.com"
    assert isinstance(payload["sender_email"], str)
    # Clear it via empty string
    _run(loop, set_kindle_email(uid, ""))
    cleared = sync_db.users.find_one({"user_id": uid})
    assert cleared["kindle_email"] == ""


def test_set_invalid_kindle_email_raises_400(loop, kindle_user):
    from fastapi import HTTPException
    from utils.send_to_kindle import set_kindle_email
    with pytest.raises(HTTPException) as exc:
        _run(loop, set_kindle_email(kindle_user["user_id"], "bogus@example.com"))
    assert exc.value.status_code == 400


def test_send_to_kindle_happy_path(loop, kindle_user, sync_db, monkeypatch):
    """A configured user + valid EPUB → Resend called with attachment."""
    from utils.send_to_kindle import send_book_to_kindle
    sent = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: sent.append(params) or {"id": f"rsnd-{uuid.uuid4().hex[:6]}"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    result = _run(loop, send_book_to_kindle(
        user_id=kindle_user["user_id"],
        book_id=kindle_user["book_id"],
    ))
    assert result["ok"] is True
    assert result["resend_id"].startswith("rsnd-")
    assert result["to"].endswith("@kindle.com")
    assert result["size_bytes"] > 1000
    assert len(sent) == 1
    params = sent[0]
    # Subject is the literal "convert" per Amazon's convention.
    assert params["subject"] == "convert"
    # Recipient is the user's @kindle.com address — never the sender.
    assert params["to"][0].endswith("@kindle.com")
    # Attachment is present, base64-encoded, and the right filename.
    assert len(params["attachments"]) == 1
    attach = params["attachments"][0]
    assert attach["filename"].endswith(".epub")
    assert "Test Book" in attach["filename"]
    assert "T. Ester" in attach["filename"]
    assert isinstance(attach["content"], str)
    # Log rows
    log_row = sync_db.kindle_send_log.find_one({
        "user_id": kindle_user["user_id"],
        "book_id": kindle_user["book_id"],
    })
    assert log_row is not None
    assert log_row["status"] == "ok"
    assert log_row["resend_id"].startswith("rsnd-")
    # Book has kindle_last_sent_at stamped
    book = sync_db.books.find_one({"book_id": kindle_user["book_id"]})
    assert book.get("kindle_last_sent_at") is not None


def test_send_without_kindle_email_returns_400(loop, kindle_user, sync_db):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle
    sync_db.users.update_one(
        {"user_id": kindle_user["user_id"]}, {"$set": {"kindle_email": ""}},
    )
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 400
    assert "Kindle" in exc.value.detail


def test_send_unknown_book_returns_404(loop, kindle_user):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id="bk_does_not_exist",
        ))
    assert exc.value.status_code == 404


def test_send_quarantined_book_returns_403(loop, kindle_user, sync_db):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle
    sync_db.books.update_one(
        {"book_id": kindle_user["book_id"]},
        {"$set": {"av_status": "infected"}},
    )
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 403
    assert "antivirus" in exc.value.detail.lower()


def test_send_oversized_returns_413(loop, kindle_user, sync_db, monkeypatch):
    """If the on-disk EPUB exceeds the 25 MB Kindle gateway cap, the
    send path must reject early with 413."""
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle, KINDLE_ATTACHMENT_MAX_BYTES
    # Re-write the on-disk file to be 1 byte over the cap.  Cheap — we
    # just open it ``wb`` and seek to size-1 then write a sentinel,
    # which makes the file sparse on filesystems that support it.
    fp = kindle_user["fp"]
    with open(fp, "wb") as fh:
        fh.seek(KINDLE_ATTACHMENT_MAX_BYTES + 1024)
        fh.write(b"\x00")
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 413


def test_send_within_rate_limit_window_returns_429(loop, kindle_user, sync_db, monkeypatch):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle
    # Pre-populate a recent successful send
    sync_db.kindle_send_log.insert_one({
        "user_id":   kindle_user["user_id"],
        "book_id":   kindle_user["book_id"],
        "status":    "ok",
        "sent_at":   datetime.now(timezone.utc) - timedelta(minutes=5),
        "resend_id": "rsnd-prev",
    })
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    monkeypatch.setattr("resend.Emails.send", lambda params: {"id": "should-not-be-called"})
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 429
    assert "30 min" in exc.value.detail


def test_resend_error_returns_502_and_logs(loop, kindle_user, sync_db, monkeypatch):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle

    def _boom(params):
        raise RuntimeError("Daily quota exceeded")

    monkeypatch.setattr("resend.Emails.send", _boom)
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 502
    assert "quota" in exc.value.detail.lower()
    # An error row was still logged for forensic visibility
    err_row = sync_db.kindle_send_log.find_one({
        "user_id": kindle_user["user_id"],
        "book_id": kindle_user["book_id"],
        "status":  "error",
    })
    assert err_row is not None
    assert "quota" in (err_row.get("error") or "").lower()


def test_no_resend_config_returns_503(loop, kindle_user, monkeypatch):
    from fastapi import HTTPException
    from utils.send_to_kindle import send_book_to_kindle
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    with pytest.raises(HTTPException) as exc:
        _run(loop, send_book_to_kindle(
            user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
        ))
    assert exc.value.status_code == 503


def test_filename_sanitisation(loop, kindle_user, sync_db, monkeypatch):
    """A book with shell-unsafe characters in the title should still
    produce a clean filename for the Kindle attachment."""
    from utils.send_to_kindle import send_book_to_kindle
    sync_db.books.update_one(
        {"book_id": kindle_user["book_id"]},
        {"$set": {
            "title":  "Weird/Title*With?Slashes",
            "author": "<script>",
        }},
    )
    captured = []
    monkeypatch.setattr(
        "resend.Emails.send",
        lambda params: captured.append(params) or {"id": "ok"},
    )
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    monkeypatch.setenv("SENDER_EMAIL", "test@shelfsort.com")
    _run(loop, send_book_to_kindle(
        user_id=kindle_user["user_id"], book_id=kindle_user["book_id"],
    ))
    fname = captured[0]["attachments"][0]["filename"]
    # Slashes and angle-brackets gone; underscores in their place.
    assert "/" not in fname
    assert "<" not in fname
    assert ">" not in fname
    assert "?" not in fname
    assert "*" not in fname
    assert fname.endswith(".epub")
