"""Regression tests for the new ``GET /api/books/upload/queue-summary``
endpoint (Iter56, 2026-01).

Contract under test
-------------------
* Returns 200 with all six keys for an authenticated user with an
  empty library.  Counts default to 0.
* Returns 401 when called without auth.
* ``fetched_at`` is a valid ISO-8601 timestamp.
* User isolation — uploads from user B do NOT bump user A's counts.
* End-to-end with the async upload flow — after a job completes,
  ``jobs_done_recent`` reflects the books from that job (5-min
  rolling window).
* Sibling existing endpoints (``/api/auth/me``, ``/api/books/upload/jobs/{id}``)
  still work alongside the new one.
"""
from __future__ import annotations

import os
import re
import tempfile
import time
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from ebooklib import epub

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

EXPECTED_KEYS = {
    "polish_pending",
    "polish_failed",
    "jobs_queued",
    "jobs_processing",
    "jobs_done_recent",
    "fetched_at",
}


# ---------- helpers --------------------------------------------------


def _login_fresh_user() -> requests.Session:
    s = requests.Session()
    email = f"qsum-{_uuid.uuid4().hex[:8]}@example.com"
    pw = "hunter2pw!"
    rr = s.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": pw, "name": "Queue Summary"},
        timeout=20,
    )
    assert rr.status_code in (200, 201), f"register failed: {rr.status_code} {rr.text[:200]}"
    r = s.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=20,
    )
    assert r.status_code == 200, r.text[:200]
    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, f"no session_token in Set-Cookie header"
    s.headers.update({"Authorization": f"Bearer {m.group(1)}"})
    return s


def _build_epub(path: Path, *, title: str, author: str = "Test") -> None:
    b = epub.EpubBook()
    b.set_identifier(f"qsum-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author(author)
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Ch1</h1><p>Body text.</p>"
    b.add_item(c)
    b.toc = (c,)
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    b.spine = ["nav", c]
    epub.write_epub(str(path), b)


def _poll_until_done(s: requests.Session, job_id: str, timeout_s: float = 90.0) -> dict:
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        r = s.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        assert r.status_code == 200, f"poll: {r.status_code} {r.text[:200]}"
        last = r.json()
        if last.get("status") in ("done", "failed"):
            return last
        time.sleep(0.5)
    raise AssertionError(f"job did not finish in {timeout_s}s; last={last}")


# ---------- (a) 200 with six keys, all zeros for fresh user ---------


def test_queue_summary_returns_six_keys_zero_for_fresh_user():
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/books/upload/queue-summary", timeout=15)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    body = r.json()

    # All six contract keys present (no more, no less surprise additions
    # would also be OK — we only assert the required ones are there).
    missing = EXPECTED_KEYS - set(body.keys())
    assert not missing, f"missing keys in response: {missing} — body={body}"

    # Counts must all be integers and equal to 0 for a fresh account.
    for k in ("polish_pending", "polish_failed", "jobs_queued",
              "jobs_processing", "jobs_done_recent"):
        assert isinstance(body[k], int), f"{k} should be int, got {type(body[k])}"
        assert body[k] == 0, f"{k} should be 0 for fresh user, got {body[k]}"


# ---------- (b) 401 without auth ------------------------------------


def test_queue_summary_requires_auth():
    # Bare requests.get (no cookies, no Bearer header) must be 401.
    r = requests.get(f"{BASE}/api/books/upload/queue-summary", timeout=10)
    assert r.status_code == 401, (
        f"expected 401 unauthenticated, got {r.status_code}: {r.text[:200]}"
    )


# ---------- (c) fetched_at is valid ISO ------------------------------


def test_queue_summary_fetched_at_is_valid_iso():
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/books/upload/queue-summary", timeout=15)
    assert r.status_code == 200
    body = r.json()
    raw = body.get("fetched_at")
    assert isinstance(raw, str) and raw, f"fetched_at missing/empty: {raw!r}"
    # Must parse cleanly — datetime.fromisoformat handles offset suffix
    # (e.g. '+00:00') natively.  We also assert it's timezone-aware and
    # within a small slew window of "now" (max 60s drift).
    parsed = datetime.fromisoformat(raw)
    assert parsed.tzinfo is not None, f"fetched_at must be tz-aware: {raw!r}"
    now = datetime.now(timezone.utc)
    delta = abs((now - parsed).total_seconds())
    assert delta < 60, f"fetched_at clock skew too large: {delta:.1f}s ({raw})"


# ---------- (d) user isolation --------------------------------------


def test_queue_summary_user_isolation():
    """User A's pending/queued/done counts must NOT reflect uploads
    made by user B.  Easiest probe: have user B kick off an upload,
    then ask user A for their summary — every count stays 0 for A.
    """
    user_a = _login_fresh_user()
    user_b = _login_fresh_user()

    # B starts an async upload.
    tmp = Path(tempfile.mkdtemp())
    book = tmp / "iso.epub"
    _build_epub(book, title="Isolation Test")
    with open(book, "rb") as fh:
        r = user_b.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("iso.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202, f"B's upload submit failed: {r.status_code} {r.text[:200]}"
    job_id = r.json()["job_id"]

    # Immediately ask user A — every count for A must still be 0.
    r_a = user_a.get(f"{BASE}/api/books/upload/queue-summary", timeout=15)
    assert r_a.status_code == 200, r_a.text[:200]
    body_a = r_a.json()
    for k in ("polish_pending", "polish_failed", "jobs_queued",
              "jobs_processing", "jobs_done_recent"):
        assert body_a[k] == 0, (
            f"USER ISOLATION LEAK: user A's {k}={body_a[k]} bumped by "
            f"user B's upload (job {job_id})"
        )

    # Also drain B's job to completion so it doesn't sit queued
    # contaminating other tests' counts, and confirm the cross-user
    # isolation holds AFTER completion too.
    _poll_until_done(user_b, job_id, timeout_s=90.0)
    r_a2 = user_a.get(f"{BASE}/api/books/upload/queue-summary", timeout=15)
    body_a2 = r_a2.json()
    assert body_a2["jobs_done_recent"] == 0, (
        f"jobs_done_recent leaked across users: A={body_a2['jobs_done_recent']}"
    )


# ---------- (e) end-to-end: done bumps jobs_done_recent --------------


def test_queue_summary_reflects_completed_job_for_owner():
    """After a user's own async job completes, jobs_done_recent
    should be >= the number of books processed in that job (within
    the 5-min window).
    """
    s = _login_fresh_user()
    tmp = Path(tempfile.mkdtemp())
    book = tmp / "owner_done.epub"
    _build_epub(book, title="Owner Done")
    with open(book, "rb") as fh:
        r = s.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("owner_done.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    final = _poll_until_done(s, job_id, timeout_s=90.0)
    assert final["status"] == "done", f"job failed: {final.get('error')}"
    processed = final.get("processed", 0) or len((final.get("response") or {}).get("books") or [])
    assert processed >= 1

    # Now the summary should reflect that.
    r2 = s.get(f"{BASE}/api/books/upload/queue-summary", timeout=15)
    assert r2.status_code == 200
    body = r2.json()
    assert body["jobs_done_recent"] >= processed, (
        f"expected jobs_done_recent >= {processed}, got {body['jobs_done_recent']} — "
        f"body={body}"
    )
    # While we're here: jobs_processing/queued for that user should
    # be 0 (the job finished).
    assert body["jobs_queued"] == 0
    assert body["jobs_processing"] == 0


# ---------- (f) sibling endpoints still work -------------------------


def test_auth_me_still_works():
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    # Some apps wrap the user under {"user": ...}; accept either.
    user_doc = body.get("user", body)
    assert user_doc.get("user_id") or user_doc.get("email"), f"unexpected /auth/me body: {body}"


def test_jobs_endpoint_still_works():
    """The pre-existing GET /books/upload/jobs/{id} must still 404 on
    unknown ids — guards against the new route shadowing it."""
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/books/upload/jobs/{'0' * 32}", timeout=10)
    assert r.status_code == 404, f"got {r.status_code} for unknown job"


def test_admin_stuck_endpoint_requires_admin():
    """Non-admin should get 403 (or 401) from /admin/upload-jobs/stuck;
    the new route must not have inadvertently opened it up."""
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/admin/upload-jobs/stuck", timeout=10)
    assert r.status_code in (401, 403), f"non-admin got {r.status_code} on stuck endpoint"


def test_admin_failures_endpoint_requires_auth():
    """Reach the admin failures endpoint without auth — must be 401."""
    r = requests.get(f"{BASE}/api/admin/upload-jobs/failures", timeout=10)
    assert r.status_code in (401, 403, 404), (
        f"unexpected status for unauthenticated admin failures call: {r.status_code}"
    )
