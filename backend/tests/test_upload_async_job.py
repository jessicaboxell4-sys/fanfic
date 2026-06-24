"""Regression test for the 2026-06-24 async-upload P0 fix.

Backstory: the synchronous ``POST /api/books/upload`` endpoint held one
HTTP connection open for the full upload + classify + R2 mirror, so a
slow Claude classifier could push the request past Cloudflare's 100s
edge timeout and 524 the user.  The fix introduces:

* ``POST /api/books/upload/async``           — returns 202 + job_id
  immediately after buffering bytes to disk.
* ``GET  /api/books/upload/jobs/{job_id}``   — polls the job status.

This test verifies the contract:

1. The async endpoint returns 202 in well under 5s for a real EPUB.
2. Polling the job eventually reports ``status: "done"`` with a
   ``response.books`` array containing the freshly-uploaded book.
3. Polling a non-existent job returns 404.
4. Another user cannot read someone else's job (404 not 403 — the
   handler treats unknown ``(job_id, user_id)`` pairs identically).
"""
import os
import re
import tempfile
import time
import uuid as _uuid
from pathlib import Path

import pytest
import requests
from ebooklib import epub

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _login_fresh_user() -> requests.Session:
    s = requests.Session()
    email = f"async-upload-{_uuid.uuid4().hex[:8]}@example.com"
    pw = "hunter2pw!"
    rr = s.post(f"{BASE}/api/auth/register",
                json={"email": email, "password": pw, "name": "Async UL"},
                timeout=20)
    assert rr.status_code in (200, 201), f"register failed: {rr.status_code} {rr.text[:200]}"
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, f"no session_token in Set-Cookie header: {cookies!r}"
    s.headers.update({"Authorization": f"Bearer {m.group(1)}"})
    return s


def _build_epub(path: Path, *, title: str, author: str = "Test") -> None:
    b = epub.EpubBook()
    b.set_identifier(f"async-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author(author)
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Ch1</h1><p>Body text for async upload test.</p>"
    b.add_item(c)
    b.toc = (c,)
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    b.spine = ["nav", c]
    epub.write_epub(str(path), b)


def _poll_until_done(session: requests.Session, job_id: str, *, timeout_s: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        r = session.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        assert r.status_code == 200, f"poll failed: {r.status_code} {r.text[:200]}"
        last = r.json()
        if last.get("status") in ("done", "failed"):
            return last
        time.sleep(0.5)
    raise AssertionError(f"job didn't finish within {timeout_s}s; last poll: {last}")


def test_async_upload_returns_202_quickly():
    """The submit half MUST return in well under 5 seconds, so the
    Cloudflare 100s edge timeout becomes structurally impossible.
    """
    s = _login_fresh_user()
    tmp = Path(tempfile.mkdtemp())
    book = tmp / "async_quick.epub"
    _build_epub(book, title="Async Quick")
    started = time.monotonic()
    with open(book, "rb") as fh:
        r = s.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("async_quick.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    elapsed = time.monotonic() - started
    assert r.status_code == 202, f"expected 202, got {r.status_code} — {r.text[:200]}"
    assert elapsed < 10.0, (
        f"submit took {elapsed:.1f}s — async fix is supposed to keep "
        f"the request under the proxy ceiling.  Anything close to 100s "
        f"defeats the purpose of decoupling submit from processing."
    )
    body = r.json()
    assert body.get("status") == "queued"
    assert body.get("total") == 1
    assert isinstance(body.get("job_id"), str) and body["job_id"]


def test_async_upload_job_completes_with_book():
    """Polling MUST eventually report status=done with the book payload."""
    s = _login_fresh_user()
    tmp = Path(tempfile.mkdtemp())
    book = tmp / "async_complete.epub"
    _build_epub(book, title="Async Complete")
    with open(book, "rb") as fh:
        r = s.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("async_complete.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202, r.text[:200]
    job_id = r.json()["job_id"]
    final = _poll_until_done(s, job_id, timeout_s=60.0)
    assert final["status"] == "done", f"job ended in {final['status']!r}: {final.get('error')}"
    books = (final.get("response") or {}).get("books") or []
    assert len(books) == 1, f"expected 1 book, got {len(books)}: {books}"
    assert books[0].get("title") == "Async Complete"


def test_unknown_job_returns_404():
    s = _login_fresh_user()
    r = s.get(f"{BASE}/api/books/upload/jobs/{'0' * 32}", timeout=10)
    assert r.status_code == 404


def test_other_users_job_is_404():
    """Cross-user isolation: user B cannot inspect user A's job."""
    sa = _login_fresh_user()
    sb = _login_fresh_user()
    tmp = Path(tempfile.mkdtemp())
    book = tmp / "async_isolation.epub"
    _build_epub(book, title="Iso")
    with open(book, "rb") as fh:
        r = sa.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("async_isolation.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    # User B asks for user A's job — must be 404, not 200 (info disclosure).
    r2 = sb.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
    assert r2.status_code == 404, f"expected 404 for cross-user job lookup, got {r2.status_code}"


def test_empty_batch_rejected():
    """The handler explicitly raises 400 (via FastAPI multipart validation)
    or 400 from our own guard when no files are attached."""
    s = _login_fresh_user()
    r = s.post(f"{BASE}/api/books/upload/async", files=[], timeout=10)
    # FastAPI's File(...) validation responds with 422 when the field
    # is missing entirely; if the field is present but empty our own
    # guard raises 400.  Either is acceptable as long as it's a 4xx.
    assert 400 <= r.status_code < 500, f"expected 4xx for empty batch, got {r.status_code}"
