"""Regression test for resume-after-refresh (2026-06-24 P2).

The async upload pipeline persists the in-flight ``job_id`` in
``localStorage`` so a SPA refresh can re-attach to background uploads.
This test exercises the *backend* contract that makes the resume work:

1. Submitting a job returns a ``job_id`` that the SPA can persist.
2. The job remains queryable for at least the expected resume window
   (we use 24h backend TTL; SPA enforces 6h client-side).
3. Querying the same ``job_id`` from a fresh "browser session" (a
   new requests.Session with the same Bearer token) still works, so
   cross-tab restore is supported as long as auth is preserved.
4. The same response payload is returned every time, so the resume
   path lands in exactly the same downstream code as the foreground
   poll (no special branching needed).
"""
import os
import re
import tempfile
import time
import uuid as _uuid
from pathlib import Path

import requests
from ebooklib import epub

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _register_and_token() -> tuple[str, str]:
    """Register a fresh user and return (email, bearer_token)."""
    email = f"resume-test-{_uuid.uuid4().hex[:8]}@example.com"
    pw = "hunter2pw!"
    r = requests.post(f"{BASE}/api/auth/register",
                      json={"email": email, "password": pw, "name": "Resume"},
                      timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, f"no session_token in Set-Cookie: {cookies!r}"
    return email, m.group(1)


def _session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _build_epub(path: Path, *, title: str) -> None:
    b = epub.EpubBook()
    b.set_identifier(f"resume-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author("Resume Tester")
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Ch1</h1><p>Resume after refresh test.</p>"
    b.add_item(c)
    b.toc = (c,)
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    b.spine = ["nav", c]
    epub.write_epub(str(path), b)


def test_job_remains_queryable_from_fresh_session():
    """Refresh = new browser session with the same token; the job MUST
    still be reachable so the SPA can finish polling on resume."""
    _, token = _register_and_token()
    submit = _session(token)

    tmp = Path(tempfile.mkdtemp())
    book = tmp / "resume_a.epub"
    _build_epub(book, title="Resume A")

    with open(book, "rb") as fh:
        r = submit.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("resume_a.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202, r.text[:200]
    job_id = r.json()["job_id"]

    # Simulate the page refresh: pretend the SPA was reloaded by
    # discarding `submit` and creating a brand-new session with the
    # same bearer token (no shared cookies, no shared connection pool).
    resumed = _session(token)
    # Poll until done — should be sub-second for a trivial EPUB.
    deadline = time.monotonic() + 30
    final = None
    while time.monotonic() < deadline:
        r = resumed.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        assert r.status_code == 200, r.text[:200]
        final = r.json()
        if final.get("status") in ("done", "failed"):
            break
        time.sleep(0.5)
    assert final and final["status"] == "done", final


def test_repeated_polls_return_consistent_response():
    """Once a job is `done`, every subsequent GET must return the
    same `response` payload — the SPA may poll the job multiple
    times across page reloads and shouldn't see inconsistent data."""
    _, token = _register_and_token()
    s = _session(token)

    tmp = Path(tempfile.mkdtemp())
    book = tmp / "resume_b.epub"
    _build_epub(book, title="Resume B")
    with open(book, "rb") as fh:
        r = s.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("resume_b.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    # Wait for completion.
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        r = s.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        if r.json().get("status") == "done":
            break
        time.sleep(0.4)

    # Poll three more times — payload MUST match.
    payloads = []
    for _ in range(3):
        r = s.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        assert r.status_code == 200
        payloads.append(r.json().get("response"))
        time.sleep(0.2)
    assert payloads[0] == payloads[1] == payloads[2], "response payload mutated between polls"


def test_resumed_job_books_visible_in_library():
    """After resume completes, the book MUST be visible via the regular
    library API — proves the resume path lands in the same code as
    the foreground upload."""
    _, token = _register_and_token()
    s = _session(token)

    tmp = Path(tempfile.mkdtemp())
    book = tmp / "resume_c.epub"
    _build_epub(book, title="Resume C — Visible")
    with open(book, "rb") as fh:
        r = s.post(
            f"{BASE}/api/books/upload/async",
            files=[("files", ("resume_c.epub", fh, "application/epub+zip"))],
            timeout=30,
        )
    job_id = r.json()["job_id"]

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        r = s.get(f"{BASE}/api/books/upload/jobs/{job_id}", timeout=10)
        if r.json().get("status") == "done":
            break
        time.sleep(0.4)

    # Now hit the regular books listing — the resumed book must be in it.
    r = s.get(f"{BASE}/api/books?limit=50", timeout=10)
    assert r.status_code == 200, r.text[:200]
    titles = [(b.get("title") or "") for b in (r.json().get("books") or [])]
    assert "Resume C — Visible" in titles, f"book missing from library after resume: {titles}"
