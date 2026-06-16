"""Tests for in-place EPUB metadata editing via PATCH /api/books/{book_id}.

Verifies both the DB update path and the EPUB file rewrite (added 2026-06-16).
"""
import os
import tempfile
from pathlib import Path

import pytest
import requests
from ebooklib import epub

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return s


def _build_epub(path: Path, *, title: str, author: str, description: str) -> None:
    b = epub.EpubBook()
    b.set_identifier(f"inplace-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author(author)
    b.add_metadata("DC", "description", description)
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Chapter</h1><p>Body text for in-place edit test.</p>"
    b.add_item(c)
    b.toc = (c,)
    b.add_item(epub.EpubNcx())
    b.add_item(epub.EpubNav())
    b.spine = ["nav", c]
    epub.write_epub(str(path), b)


@pytest.fixture
def uploaded_book(session):
    """Upload a fresh EPUB and tear it down at the end of the test."""
    tmpdir = Path(tempfile.mkdtemp())
    epub_path = tmpdir / "fixture.epub"
    _build_epub(
        epub_path,
        title="Fixture Title",
        author="Fixture Author",
        description="Fixture description.",
    )
    with open(epub_path, "rb") as f:
        up = session.post(
            f"{BASE}/api/books/upload",
            files={"files": ("fixture.epub", f, "application/epub+zip")},
        )
    assert up.status_code == 200, up.text
    book_id = up.json()["books"][0]["book_id"]
    yield {"book_id": book_id, "tmpdir": tmpdir}
    # Cleanup
    try:
        session.delete(f"{BASE}/api/books/{book_id}")
    except Exception:
        pass
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)


class TestInPlaceEdit:
    def test_patch_updates_db_and_epub(self, session, uploaded_book):
        book_id = uploaded_book["book_id"]
        r = session.patch(
            f"{BASE}/api/books/{book_id}",
            json={
                "title": "Edited Title",
                "author": "Edited Author",
                "description": "Edited description — text travels with the file.",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["epub_updated"] is True

        # DB reflects the edit
        got = session.get(f"{BASE}/api/books/{book_id}").json()
        assert got["title"] == "Edited Title"
        assert got["author"] == "Edited Author"
        assert got["description"].startswith("Edited description")

        # Downloaded EPUB carries the new metadata baked in
        dl = session.get(f"{BASE}/api/books/{book_id}/download")
        assert dl.status_code == 200
        out = uploaded_book["tmpdir"] / "downloaded.epub"
        out.write_bytes(dl.content)
        b = epub.read_epub(str(out), options={"ignore_ncx": True})
        assert b.get_metadata("DC", "title")[0][0] == "Edited Title"
        assert b.get_metadata("DC", "creator")[0][0] == "Edited Author"
        assert "Edited description" in b.get_metadata("DC", "description")[0][0]

    def test_partial_edit_only_touches_supplied_fields(self, session, uploaded_book):
        book_id = uploaded_book["book_id"]
        # Title only
        r = session.patch(f"{BASE}/api/books/{book_id}", json={"title": "Only Title"})
        assert r.json()["epub_updated"] is True
        got = session.get(f"{BASE}/api/books/{book_id}").json()
        assert got["title"] == "Only Title"
        assert got["author"] == "Fixture Author"  # untouched
        assert got["description"] == "Fixture description."

    def test_empty_payload_is_noop(self, session, uploaded_book):
        book_id = uploaded_book["book_id"]
        r = session.patch(f"{BASE}/api/books/{book_id}", json={})
        assert r.status_code == 200
        body = r.json()
        assert body.get("noop") is True

    def test_classification_only_does_not_touch_epub(self, session, uploaded_book):
        book_id = uploaded_book["book_id"]
        r = session.patch(
            f"{BASE}/api/books/{book_id}",
            json={"category": "Non-fiction", "fandom": None},
        )
        assert r.status_code == 200
        body = r.json()
        # epub_updated stays None when only classifier fields were touched —
        # no need to rewrite the file for a metadata change that only lives in the DB.
        assert body.get("epub_updated") is None
        got = session.get(f"{BASE}/api/books/{book_id}").json()
        assert got["category"] == "Non-fiction"
        assert got["classifier"] == "manual"

    def test_field_length_caps_enforced(self, session, uploaded_book):
        book_id = uploaded_book["book_id"]
        # Send something larger than the caps; backend trims silently.
        r = session.patch(
            f"{BASE}/api/books/{book_id}",
            json={
                "title": "T" * 600,
                "author": "A" * 600,
                "description": "D" * 6000,
            },
        )
        assert r.status_code == 200
        got = session.get(f"{BASE}/api/books/{book_id}").json()
        assert len(got["title"]) == 500
        assert len(got["author"]) == 500
        assert len(got["description"]) == 5000

    def test_other_users_cannot_patch(self, session, uploaded_book):
        # Hit the route without a session — should 401/403
        book_id = uploaded_book["book_id"]
        r = requests.patch(f"{BASE}/api/books/{book_id}", json={"title": "Pwned"})
        assert r.status_code in (401, 403)
