"""Regression test for the 2026-07-04 partial-success upload fix.

Before this fix, uploading a 3-file batch where one file was AV-flagged
caused the backend to raise HTTPException 400 — killing the 2 healthy
siblings AND making the frontend abort the remaining ~80 books of a
100-book drop. The user reported this on launch day after trying to
upload 100 books and only seeing ~15-20 succeed.

This test verifies the new contract:
  • A 3-file multipart batch where one file is AV-flagged returns HTTP
    200 (not 400).
  • The flagged file appears in ``books[]`` with ``failed: True`` and
    ``av_infected: True`` instead of breaking the whole batch.
  • The 2 healthy EPUBs succeed normally (have ``book_id``).
"""
import os
import re
import tempfile
from pathlib import Path

import pytest
import requests
from ebooklib import epub

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"

# Standard EICAR test string — ClamAV is required by spec to flag this.
EICAR = (
    b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$"
    b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
)


@pytest.fixture(scope="module")
def session():
    """Login (or register-and-login) a throwaway user.

    Falls back to creating a fresh user when the seeded tester isn't
    present (preview-env DB doesn't always carry the fixture).
    """
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD},
               timeout=20)
    if r.status_code != 200:
        # Seeded tester missing — register a unique fresh user for this test run.
        import uuid as _uuid
        fresh_email = f"partial-upload-{_uuid.uuid4().hex[:8]}@example.com"
        rr = s.post(f"{BASE}/api/auth/register",
                    json={"email": fresh_email, "password": "hunter2pw!", "name": "Partial Upload"},
                    timeout=20)
        assert rr.status_code in (200, 201), f"register failed: {rr.status_code} {rr.text[:200]}"
        r = s.post(f"{BASE}/api/auth/login",
                   json={"email": fresh_email, "password": "hunter2pw!"},
                   timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, f"no session_token in Set-Cookie header: {cookies!r}"
    s.headers.update({"Authorization": f"Bearer {m.group(1)}"})
    return s


def _build_epub(path: Path, *, title: str, author: str = "Test") -> None:
    b = epub.EpubBook()
    b.set_identifier(f"partial-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author(author)
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Ch1</h1><p>Body text for partial-success test.</p>"
    b.add_item(c)
    b.toc = (c,)
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    b.spine = ["nav", c]
    epub.write_epub(str(path), b)


def _is_av_available(session) -> bool:
    """Check whether ClamAV is actually running on the backend — if not,
    skip the AV-specific tests instead of failing them."""
    try:
        r = session.get(f"{BASE}/api/admin/av-health", timeout=10)
        if r.status_code == 200:
            data = r.json() or {}
            return bool(data.get("available", True))
    except requests.RequestException:
        pass
    # Default to True — if the health endpoint isn't reachable we still
    # try the test (worst case it skips on the assertion below).
    return True


def test_upload_returns_200_when_one_file_is_av_flagged(session):
    """A 3-file batch with one EICAR file MUST return 200, not 400.

    Before the fix, the AV-flagged file raised HTTPException 400 which
    killed the whole batch and made the frontend abort.
    """
    if not _is_av_available(session):
        pytest.skip("ClamAV not running on the backend — partial-success "
                    "contract still holds, just can't exercise it here.")
    tmp = Path(tempfile.mkdtemp())
    good_a = tmp / "partial_good_a.epub"
    good_b = tmp / "partial_good_b.epub"
    bad    = tmp / "partial_eicar.epub"
    _build_epub(good_a, title="Partial Good A")
    _build_epub(good_b, title="Partial Good B")
    bad.write_bytes(EICAR)  # EPUB extension but EICAR content

    with open(good_a, "rb") as fa, open(good_b, "rb") as fb, open(bad, "rb") as fc:
        r = session.post(
            f"{BASE}/api/books/upload",
            files=[
                ("files", ("partial_good_a.epub", fa, "application/epub+zip")),
                ("files", ("partial_eicar.epub",  fc, "application/epub+zip")),
                ("files", ("partial_good_b.epub", fb, "application/epub+zip")),
            ],
            timeout=120,
        )

    # The whole point of the fix: we get 200, not 400.
    assert r.status_code == 200, (
        f"Expected partial-success 200, got {r.status_code}: {r.text[:300]}"
    )
    body = r.json()
    books = body.get("books") or []
    assert len(books) == 3, f"expected 3 result entries, got {len(books)}: {books}"

    # Find the EICAR result — must be marked failed + av_infected.
    eicar = next((b for b in books if b.get("filename") == "partial_eicar.epub"), None)
    assert eicar is not None, f"EICAR result missing: {books}"
    assert eicar.get("failed") is True, f"EICAR result not marked failed: {eicar}"
    assert eicar.get("av_infected") is True, f"EICAR result not av_infected: {eicar}"
    assert "blocked" in (eicar.get("error") or "").lower(), eicar.get("error")

    # The two clean books must have succeeded (have book_id).
    good_results = [b for b in books if b.get("filename", "").startswith("partial_good_")]
    assert len(good_results) == 2, f"expected 2 clean results, got: {good_results}"
    for g in good_results:
        assert g.get("book_id"), f"clean book missing book_id: {g}"
        assert not g.get("failed"), f"clean book wrongly marked failed: {g}"

    # Cleanup — remove the two test books so the library stays tidy.
    for g in good_results:
        try:
            session.delete(f"{BASE}/api/books/{g['book_id']}", timeout=10)
        except requests.RequestException:
            pass
