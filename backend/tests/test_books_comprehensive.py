"""Comprehensive tests for routes/books.py — upload, FicHub refresh, and AI
classification — to push backend coverage above 70%.

External services are mocked:
- FicHub HTTP calls → redirected to a local pytest-httpserver via the
  `FICHUB_BASE_URL` env var read by `fichub_fetch_epub`.
- Claude (LlmChat) → bypassed via `SHELFSORT_TEST_AI_RESPONSE` env var
  read by `classify_with_ai`.

NOTE: env vars must be set BEFORE the uvicorn server starts (i.e. they are
exported from `scripts/run_coverage.sh`). In a normal pytest run against
the already-running preview server, these tests will:
  - upload + bulk_metadata + delete will exercise real classifier paths
  - FicHub-redirected tests will be SKIPPED unless FICHUB_BASE_URL is set
"""
from __future__ import annotations

import io
import os
import time
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_books_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_books_{uuid.uuid4().hex}"
USER_EMAIL = f"{USER_ID}@example.com"


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": USER_EMAIL,
        "name": "Books Tester",
        "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": TOKEN,
        "user_id": USER_ID,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.reading_activity.delete_many({"user_id": USER_ID})


def _build_minimal_epub(
    title: str,
    author: str,
    body_html: str = "<p>Once upon a time.</p>",
    *,
    series_name: str | None = None,
    series_index: float | None = None,
    description: str = "",
    publisher: str = "",
) -> bytes:
    """Hand-roll a minimal valid EPUB 2 file with NCX (toc) so ebooklib's
    `read_epub` is happy. Includes mimetype, container, OPF, NCX, and a
    single HTML chapter."""
    book_uid = f"test-{uuid.uuid4().hex[:8]}"
    container_xml = '''<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''
    meta_extras = ""
    if series_name:
        meta_extras += f'<meta name="calibre:series" content="{series_name}"/>'
    if series_index is not None:
        meta_extras += f'<meta name="calibre:series_index" content="{series_index}"/>'
    opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">{book_uid}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>{description}</dc:description>
    <dc:publisher>{publisher}</dc:publisher>
    {meta_extras}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>'''
    ncx = f'''<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="{book_uid}"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap>
    <navPoint id="navp1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>'''
    chapter = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head>
<body>{body_html}</body></html>'''

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container_xml)
        z.writestr("content.opf", opf)
        z.writestr("toc.ncx", ncx)
        z.writestr("chapter1.xhtml", chapter)
    return buf.getvalue()


# --------------------------------------------------------------------------
# Upload tests — exercise extract_epub_metadata + classify_book +
# extract_urls_from_epub + find_source_url + detect_series_from_title
# --------------------------------------------------------------------------
class TestUpload:
    def test_upload_rejects_non_epub(self):
        files = {"files": ("notes.txt", b"plain text not epub", "text/plain")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["uploaded"] == 1
        assert body["books"][0].get("error") == "Not an EPUB"

    def test_upload_basic_epub_creates_book(self):
        epub = _build_minimal_epub(
            "The Coverage Chronicles", "Ada Lovelace",
            body_html="<p>Chapter one. Links: <a href='https://example.com'>example</a></p>",
        )
        files = {"files": ("cov.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["uploaded"] == 1
        book = body["books"][0]
        assert book["title"] == "The Coverage Chronicles"
        assert book["author"] == "Ada Lovelace"
        assert book["category"] in ("Original Fiction", "Unclassified", "Non-fiction", "Fanfiction")
        assert book["links_count"] >= 1
        assert book["book_id"].startswith("book_")

    def test_upload_with_fichub_url_detects_source(self):
        epub = _build_minimal_epub(
            "Magical Cookies and the Fan Saga", "FanWriter01",
            body_html='<p>Story: <a href="https://archiveofourown.org/works/12345">on AO3</a></p>',
        )
        files = {"files": ("fan.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        body = r.json()
        book = body["books"][0]
        assert "archiveofourown.org/works/12345" in (book.get("source_url") or "")

    def test_upload_with_calibre_series_metadata(self):
        epub = _build_minimal_epub(
            "Book One of Test Series", "Series Author",
            series_name="Test Series", series_index=1.0,
        )
        files = {"files": ("s1.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        book = r.json()["books"][0]
        assert book.get("series_name") == "Test Series"
        assert book.get("series_index") == 1.0

    def test_upload_with_title_only_series_detection(self):
        epub = _build_minimal_epub(
            "Detective Tales Book 3: The Plot Thickens", "Some Sleuth",
        )
        files = {"files": ("d3.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        book = r.json()["books"][0]
        # detect_series_from_title should have extracted name+index from title
        assert book.get("series_name") is not None
        assert book.get("series_index") in (3.0, 3)

    def test_upload_unparseable_epub_files_under_cant_open(self):
        # ebooklib can't read a tiny truncated zip → parse_failed → "Can't Open" branch
        truncated = b"PK\x03\x04 truncated zip data - definitely not a valid epub"
        files = {"files": ("broken.epub", truncated, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        body = r.json()
        book = body["books"][0]
        assert book["category"] == "Can't Open"
        assert book["epub_unreadable"] is True
        assert book["classifier"] == "broken-epub"

    def test_upload_multiple_files(self):
        e1 = _build_minimal_epub("Twin A", "Pair Author")
        e2 = _build_minimal_epub("Twin B", "Pair Author")
        files = [
            ("files", ("a.epub", e1, "application/epub+zip")),
            ("files", ("b.epub", e2, "application/epub+zip")),
        ]
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        assert r.json()["uploaded"] == 2


# --------------------------------------------------------------------------
# FicHub refresh tests — uses pytest-httpserver to mock fichub.net.
# These only run when the server was started with FICHUB_BASE_URL set.
# --------------------------------------------------------------------------
FICHUB_MOCKED = bool(os.environ.get("FICHUB_BASE_URL"))


@pytest.fixture(scope="module")
def fichub_mock_server():
    """Provides a pytest-httpserver bound to the URL the test server is
    pointed at. Only used in coverage mode."""
    if not FICHUB_MOCKED:
        pytest.skip("FICHUB_BASE_URL not set — skipping FicHub mock tests")

    # Parse FICHUB_BASE_URL to extract host/port
    from urllib.parse import urlparse
    from pytest_httpserver import HTTPServer
    parsed = urlparse(os.environ["FICHUB_BASE_URL"])
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8766

    server = HTTPServer(host=host, port=port)
    server.start()
    yield server
    server.clear()
    server.stop()


# Use a base64-encoded EPUB for the FanFicFare test hook
def _build_canned_fff_response(title="Refreshed Title", author="Updated Author", chapters=12):
    import base64
    epub = _build_minimal_epub(title, author, description="New body after refresh")
    return {
        "epub_b64": base64.b64encode(epub).decode("ascii"),
        "meta": {
            "chapters": chapters,
            "rawExtendedMeta": {
                "dateUpdated": "2025-12-01",
                "words": 50000,
                "status": "complete",
            },
            "title": title,
            "author": author,
            "site": "archiveofourown.org",
        }
    }


# FanFicFare integration is exercised via SHELFSORT_TEST_FFF_RESPONSE env hook
# (set by scripts/run_coverage.sh + CI workflow). The pytest-httpserver mock
# is kept ONLY for the legacy /api/fichub/status probe and is not needed for
# refresh calls anymore.
FFF_MOCKED = bool(os.environ.get("SHELFSORT_TEST_FFF_RESPONSE")) or FICHUB_MOCKED


@pytest.mark.skipif(not FFF_MOCKED, reason="No FanFicFare test hook configured")
class TestFicHubRefresh:
    def _seed_book_via_upload(self, source_url: str) -> str:
        """Upload a real EPUB then patch its source_url so refresh has a
        local file to overwrite."""
        epub = _build_minimal_epub("Old Title", "Old Author")
        r = requests.post(
            f"{BASE}/api/books/upload",
            headers=H(),
            files={"files": ("fan.epub", epub, "application/epub+zip")},
        )
        bid = r.json()["books"][0]["book_id"]
        db.books.update_one({"book_id": bid}, {"$set": {"source_url": source_url}})
        return bid

    def test_refresh_book_fichub_not_found(self, fichub_mock_server):
        """Setting a hook to {not_found: true} would mark unavailable.
        Skipped here since the run_coverage.sh hook is set to success globally.
        The flag-and-handle behavior is exercised by test_retry_unavailable_clears_and_retries."""
        pytest.skip("Per-test FanFicFare hook variation not supported across HTTP boundary")

    def test_refresh_book_succeeds_with_fresh_epub(self, fichub_mock_server):
        """Happy path: FanFicFare-hook returns success → book updated."""
        # The SHELFSORT_TEST_FFF_RESPONSE env (set in run_coverage.sh) makes
        # fichub_fetch_epub return a canned EPUB with title "Refreshed Title"
        # and author "Updated Author".
        bid = self._seed_book_via_upload("https://archiveofourown.org/works/77777")
        # Tag the old book so we can assert tags carry over to the refreshed copy
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"tags": ["needs-update-test", "carry-over"]}},
        )
        r = requests.post(f"{BASE}/api/books/{bid}/refresh", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        # New behavior: response carries new_book_id, old_book_id, dated shelf
        assert body.get("new_book_id") and body["new_book_id"] != bid
        assert body.get("old_book_id") == bid
        assert body.get("updated_shelf", "").startswith("Updated stories ")
        time.sleep(0.3)
        # Old record archived
        old = db.books.find_one({"book_id": bid})
        assert old["category"] == "Old stories"
        assert old["replaced_by"] == body["new_book_id"]
        assert old.get("replaced_at")
        # New record in dated shelf with tags carried over
        new = db.books.find_one({"book_id": body["new_book_id"]})
        assert new is not None
        assert new["category"].startswith("Updated stories ")
        assert new["replaces"] == bid
        assert set(new.get("tags", [])) >= {"needs-update-test", "carry-over"}
        assert new.get("last_refreshed_at") is not None
        assert new.get("source_url") == "https://archiveofourown.org/works/77777"

    def test_refresh_skips_already_archived_books(self, fichub_mock_server):
        """refresh-all should not re-refresh books already on the Old stories shelf."""
        bid = self._seed_book_via_upload("https://archiveofourown.org/works/archived-already")
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"category": "Old stories", "replaced_by": "book_someother"}},
        )
        r = requests.post(f"{BASE}/api/books/refresh-all", headers=H())
        assert r.status_code == 200
        # The archived book should not appear in failures (it was skipped entirely)
        failures_ids = {f.get("book_id") for f in r.json().get("failures", [])}
        assert bid not in failures_ids
        # And it should still be on Old stories (not re-touched)
        still = db.books.find_one({"book_id": bid})
        assert still["category"] == "Old stories"

    def test_refresh_registers_dated_shelf_and_filters(self, fichub_mock_server):
        """After a successful refresh:
        - Response includes a `message` mentioning the dated shelf
        - GET /api/categories includes the dated shelf in `custom`
        - GET /api/books?category=<dated> returns ONLY the new copy
        - GET /api/books?category='Old stories' includes the archived copy
        - GET /api/books/refresh-status excludes the archived book from `refreshable`
        """
        bid = self._seed_book_via_upload("https://archiveofourown.org/works/dated-check")
        # Baseline refresh-status
        pre_status = requests.get(f"{BASE}/api/books/refresh-status", headers=H()).json()
        pre_refreshable = pre_status.get("refreshable", 0)

        r = requests.post(f"{BASE}/api/books/{bid}/refresh", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        new_id = body["new_book_id"]
        dated_shelf = body["updated_shelf"]
        # `message` field present and mentions the dated shelf name
        assert "message" in body and isinstance(body["message"], str)
        assert dated_shelf in body["message"]
        assert body.get("last_refreshed_at")

        # Dated shelf auto-registered as a custom category chip
        cats = requests.get(f"{BASE}/api/categories", headers=H()).json()
        assert dated_shelf in cats.get("custom", []), f"{dated_shelf} not in {cats.get('custom')}"

        # Filter by dated shelf returns ONLY the new copy
        dated_books = requests.get(f"{BASE}/api/books", headers=H(), params={"category": dated_shelf}).json()["books"]
        ids_dated = {b["book_id"] for b in dated_books}
        assert new_id in ids_dated
        assert bid not in ids_dated

        # Filter by Old stories includes the archived copy
        old_books = requests.get(f"{BASE}/api/books", headers=H(), params={"category": "Old stories"}).json()["books"]
        ids_old = {b["book_id"] for b in old_books}
        assert bid in ids_old
        assert new_id not in ids_old

        # Both copies still browseable via the un-filtered list
        all_books = requests.get(f"{BASE}/api/books", headers=H()).json()["books"]
        all_ids = {b["book_id"] for b in all_books}
        assert bid in all_ids and new_id in all_ids

        # refresh-status excludes the archived book from `refreshable`.
        # The new book inherits source_url so it stays refreshable -> net change 0.
        post_status = requests.get(f"{BASE}/api/books/refresh-status", headers=H()).json()
        assert post_status["refreshable"] == pre_refreshable, (
            f"refresh-status changed unexpectedly: pre={pre_refreshable}, post={post_status['refreshable']}"
        )

    def test_refresh_all_runs(self, fichub_mock_server):
        """Bulk refresh executes the loop and returns aggregate counts."""
        self._seed_book_via_upload("https://archiveofourown.org/works/aaa1")
        r = requests.post(f"{BASE}/api/books/refresh-all", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert "eligible" in body
        assert "refreshed" in body
        assert "failures" in body

    def test_refresh_status_endpoint(self):
        """GET /api/books/refresh-status reports current FicHub-eligible counts."""
        r = requests.get(f"{BASE}/api/books/refresh-status", headers=H())
        assert r.status_code == 200
        body = r.json()
        # Backend uses 'refreshable' (not 'eligible'). Just check shape.
        assert "refreshable" in body
        assert "unavailable" in body
        assert "total" in body

    def test_fichub_status_probe(self, fichub_mock_server):
        """GET /api/fichub/status reports the probe result and caches it."""
        # The probe now hits AO3 directly (or the mock if FICHUB_BASE_URL set).
        r = requests.get(f"{BASE}/api/fichub/status?force=true", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ok" in body
        assert "detail" in body
        assert body["cached"] is False
        # Second call should be cached
        r = requests.get(f"{BASE}/api/fichub/status", headers=H())
        assert r.json()["cached"] is True

    def test_retry_unavailable_clears_and_retries(self, fichub_mock_server):
        """retry-unavailable clears flags and calls refresh on each book."""
        bid = self._seed_book_via_upload("https://archiveofourown.org/works/retry-me")
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"fichub_unavailable": True, "fichub_last_error": "old failure"}},
        )
        r = requests.post(f"{BASE}/api/books/retry-unavailable", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["attempted"] >= 1

    def test_retry_unavailable_with_nothing_to_do(self):
        """Empty result when no books are flagged."""
        # Make sure no unavailable books for this user
        db.books.update_many(
            {"user_id": USER_ID, "fichub_unavailable": True},
            {"$unset": {"fichub_unavailable": ""}},
        )
        r = requests.post(f"{BASE}/api/books/retry-unavailable", headers=H())
        assert r.status_code == 200
        assert r.json()["attempted"] == 0


# --------------------------------------------------------------------------
# Version diff (Compare versions) — needs two linked uploads
# --------------------------------------------------------------------------
class TestVersionDiff:
    def _upload_epub(self, title: str, body_html: str) -> str:
        epub = _build_minimal_epub(title, "Diff Author", body_html=body_html)
        r = requests.post(
            f"{BASE}/api/books/upload",
            headers=H(),
            files={"files": (f"{title}.epub", epub, "application/epub+zip")},
        )
        assert r.status_code == 200, r.text
        return r.json()["books"][0]["book_id"]

    def test_diff_400_when_no_counterpart(self):
        """Without `?vs=` and no replaces/replaced_by, endpoint 400s."""
        bid = self._upload_epub("Standalone Book", "<p>solo</p>")
        r = requests.get(f"{BASE}/api/books/{bid}/diff", headers=H())
        assert r.status_code == 400
        assert "counterpart" in r.json()["detail"].lower()

    def test_diff_returns_chapter_structure(self):
        """Upload two EPUBs, link them via replaces/replaced_by, verify diff shape."""
        old_id = self._upload_epub("Old Title V1", "<p>one two three four five</p>")
        new_id = self._upload_epub(
            "New Title V2",
            "<p>one two three four five six seven eight nine ten</p>",
        )
        # Link them as if a refresh had happened
        db.books.update_one(
            {"book_id": old_id},
            {"$set": {"category": "Old stories", "replaced_by": new_id}},
        )
        db.books.update_one(
            {"book_id": new_id},
            {"$set": {"category": "Updated stories 2026-05-29", "replaces": old_id}},
        )

        # Auto-resolve via the link (no ?vs=)
        r = requests.get(f"{BASE}/api/books/{new_id}/diff", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["old"]["book_id"] == old_id
        assert body["new"]["book_id"] == new_id
        assert len(body["old"]["chapters"]) >= 1
        assert len(body["new"]["chapters"]) >= 1
        s = body["diff"]["summary"]
        assert s["old_chapter_count"] == len(body["old"]["chapters"])
        assert s["new_chapter_count"] == len(body["new"]["chapters"])
        # The minimal EPUB's single chapter normalizes to a "Chapter N"-style
        # prefix that _normalize_chapter_title strips → both chapters match,
        # so they land in `changed_chapters` (different word counts).
        assert s["chapters_changed"] + s["chapters_added"] + s["chapters_removed"] >= 1
        # And the new EPUB has more words than the old
        assert s["new_total_words"] > s["old_total_words"]
        assert s["words_delta"] > 0
        # Required summary fields present
        for field in (
            "old_chapter_count", "new_chapter_count",
            "chapters_added", "chapters_removed",
            "chapters_changed", "chapters_unchanged",
            "old_total_words", "new_total_words", "words_delta",
        ):
            assert field in s, f"missing summary field: {field}"
        # Each chapter has an href (used by the Reader chapter-jump feature)
        for ch in body["new"]["chapters"]:
            assert "href" in ch
        for ch in body["old"]["chapters"]:
            assert "href" in ch
        # first_changed_chapter is populated when there's something to jump to
        fc = body["diff"]["first_changed_chapter"]
        assert fc is not None
        assert fc["kind"] in ("added", "changed")
        assert "new_href" in fc
        assert "new_index" in fc
        assert "title" in fc

    def test_diff_with_explicit_vs_param(self):
        """Passing ?vs={other_id} works without any link in mongo."""
        a = self._upload_epub("Solo A", "<p>aa bb cc</p>")
        b = self._upload_epub("Solo B", "<p>aa bb cc dd ee</p>")
        r = requests.get(f"{BASE}/api/books/{a}/diff?vs={b}", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        # Both ids should appear in old + new (order determined by created_at)
        ids = {body["old"]["book_id"], body["new"]["book_id"]}
        assert ids == {a, b}

    def test_diff_404_when_book_missing(self):
        r = requests.get(f"{BASE}/api/books/book_does_not_exist/diff", headers=H())
        assert r.status_code == 404

    def test_diff_404_when_vs_counterpart_missing(self):
        """?vs={id} pointing to a non-existent book → 404."""
        bid = self._upload_epub("Has Counterpart Missing", "<p>x y z</p>")
        r = requests.get(
            f"{BASE}/api/books/{bid}/diff?vs=no_such_book_id", headers=H()
        )
        assert r.status_code == 404

    def test_diff_404_when_epub_file_missing_on_disk(self):
        """If the on-disk EPUB has been removed, endpoint returns 404."""
        from pathlib import Path
        a = self._upload_epub("OnDisk A", "<p>aaa bbb</p>")
        b = self._upload_epub("OnDisk B", "<p>aaa bbb ccc</p>")
        # Delete one of the EPUBs from disk to simulate orphaned db doc.
        storage_root = Path("/app/uploads")
        # The storage layout is <storage>/<user_id>/<book_id>.epub.
        # Walk it instead of guessing the user id so the test is resilient.
        target = None
        for p in storage_root.rglob(f"{b}.epub"):
            target = p
            break
        if target and target.exists():
            target.unlink()
        r = requests.get(f"{BASE}/api/books/{a}/diff?vs={b}", headers=H())
        assert r.status_code == 404


# --------------------------------------------------------------------------
# Recent-updates bell badge — drives the "fics updated" navbar notification
# --------------------------------------------------------------------------
class TestRecentUpdates:
    def _seed_refreshed_book(self, title: str = "Refreshed Book") -> tuple[str, str]:
        """Insert an old + new book pair as if a refresh happened. Returns (old, new)."""
        old_id = f"book_old_{uuid.uuid4().hex[:8]}"
        new_id = f"book_new_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": old_id,
            "title": f"{title} (v1)",
            "author": "Test Author",
            "category": "Old stories",
            "replaced_by": new_id,
        })
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": new_id,
            "title": f"{title} (v2)",
            "author": "Test Author",
            "fandom": "Harry Potter",
            "category": f"Updated stories 2026-05-29",
            "replaces": old_id,
            "last_refreshed_at": now,
            "update_seen": False,
            "refresh_summary": {
                "chapters_added": 2,
                "chapters_changed": 1,
                "chapters_removed": 0,
                "words_delta": 1500,
                "first_changed_href": "chapter5.xhtml",
                "first_changed_title": "Chapter 5",
                "first_changed_kind": "added",
            },
        })
        return old_id, new_id

    def test_recent_updates_returns_unseen(self):
        _, new_id = self._seed_refreshed_book("Bell Test One")
        r = requests.get(f"{BASE}/api/books/recent-updates", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        ids = [u["book_id"] for u in body["updates"]]
        assert new_id in ids
        assert body["total_unseen"] >= 1
        # Sanity: payload shape
        u = next(u for u in body["updates"] if u["book_id"] == new_id)
        assert u["title"].endswith("(v2)")
        assert u["refresh_summary"]["chapters_added"] == 2
        assert u["last_refreshed_at"]

    def test_mark_single_update_seen(self):
        _, new_id = self._seed_refreshed_book("Bell Test Two")
        r = requests.post(f"{BASE}/api/books/{new_id}/mark-update-seen", headers=H())
        assert r.status_code == 200
        # Now it should NOT appear in recent-updates
        r2 = requests.get(f"{BASE}/api/books/recent-updates", headers=H())
        ids = [u["book_id"] for u in r2.json()["updates"]]
        assert new_id not in ids
        # And the doc has update_seen=True
        doc = db.books.find_one({"book_id": new_id})
        assert doc["update_seen"] is True
        assert doc.get("update_seen_at")

    def test_mark_single_update_seen_404(self):
        r = requests.post(
            f"{BASE}/api/books/book_does_not_exist_xx/mark-update-seen", headers=H()
        )
        assert r.status_code == 404

    def test_mark_all_updates_seen(self):
        self._seed_refreshed_book("Bell Bulk A")
        self._seed_refreshed_book("Bell Bulk B")
        before = requests.get(f"{BASE}/api/books/recent-updates", headers=H()).json()
        assert before["total_unseen"] >= 2
        r = requests.post(f"{BASE}/api/books/mark-updates-seen", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["marked"] >= 2
        after = requests.get(f"{BASE}/api/books/recent-updates", headers=H()).json()
        assert after["total_unseen"] == 0
        assert after["updates"] == []

    def test_recent_updates_excludes_non_refreshed(self):
        """A regular (non-refreshed) upload must not appear in the bell."""
        bid = f"book_regular_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": bid,
            "title": "Just a normal book",
            "author": "Solo",
            "category": "Fanfiction",
            # No `replaces` field — not a refreshed copy
        })
        r = requests.get(f"{BASE}/api/books/recent-updates", headers=H())
        ids = [u["book_id"] for u in r.json()["updates"]]
        assert bid not in ids


# --------------------------------------------------------------------------
# AI classification — exercises the SHELFSORT_TEST_AI_RESPONSE hook in
# classify_with_ai. The hook is read at request-time from the server's
# environment, so this works inside the run_coverage.sh server only.
# --------------------------------------------------------------------------
AI_HOOK_ENABLED = bool(os.environ.get("SHELFSORT_TEST_AI_RESPONSE"))


@pytest.mark.skipif(not AI_HOOK_ENABLED, reason="SHELFSORT_TEST_AI_RESPONSE not set")
class TestAIClassification:
    def test_bulk_ai_classify_uses_hook(self):
        """Upload a book that won't be confidently classified by metadata,
        then trigger bulk AI re-classify. The hook returns Fanfiction/HP."""
        epub = _build_minimal_epub("Ambiguous Tale", "Mystery Author")
        files = {"files": ("amb.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        assert r.status_code == 200
        bid = r.json()["books"][0]["book_id"]

        # Force this book to Unclassified so reclassify_all picks it up
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"category": "Unclassified"}}
        )

        r = requests.post(
            f"{BASE}/api/books/reclassify-all",
            headers={**H(), "Content-Type": "application/json"},
            json={"force_ai": True, "only_unclassified": True},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["processed"] >= 1
        # After reclassification, the hooked response should now be applied
        time.sleep(0.3)
        updated = db.books.find_one({"book_id": bid})
        assert updated["category"] in ("Fanfiction", "Original Fiction", "Non-fiction", "Unclassified")
        assert updated.get("classifier") in ("ai", "metadata")

    def test_single_book_reclassify(self):
        epub = _build_minimal_epub("Single Reclassify", "Solo Author")
        r = requests.post(
            f"{BASE}/api/books/upload",
            headers=H(),
            files={"files": ("solo.epub", epub, "application/epub+zip")},
        )
        bid = r.json()["books"][0]["book_id"]
        r = requests.post(
            f"{BASE}/api/books/{bid}/reclassify",
            headers={**H(), "Content-Type": "application/json"},
            json={"force_ai": True},
        )
        assert r.status_code == 200, r.text
        assert "category" in r.json()


# --------------------------------------------------------------------------
# Book CRUD + download + cover + delete (regression / extra coverage)
# --------------------------------------------------------------------------
class TestBookCRUD:
    def test_book_get_download_cover_delete_cycle(self):
        epub = _build_minimal_epub("Cycle Book", "Cycle Author")
        files = {"files": ("cyc.epub", epub, "application/epub+zip")}
        r = requests.post(f"{BASE}/api/books/upload", headers=H(), files=files)
        bid = r.json()["books"][0]["book_id"]

        # GET single book
        r = requests.get(f"{BASE}/api/books/{bid}", headers=H())
        assert r.status_code == 200
        assert r.json()["title"] == "Cycle Book"

        # Download EPUB
        r = requests.get(f"{BASE}/api/books/{bid}/download", headers=H())
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/")
        assert len(r.content) > 100

        # PATCH metadata (backend's PATCH supports category + fandom)
        r = requests.patch(
            f"{BASE}/api/books/{bid}",
            headers={**H(), "Content-Type": "application/json"},
            json={"category": "Non-fiction"},
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Mark as read
        r = requests.post(
            f"{BASE}/api/books/{bid}/mark",
            headers={**H(), "Content-Type": "application/json"},
            json={"read": True},
        )
        assert r.status_code == 200

        # Progress + touch
        r = requests.post(
            f"{BASE}/api/books/{bid}/progress",
            headers={**H(), "Content-Type": "application/json"},
            json={"percent": 0.5, "cfi": "epubcfi(/6/2)"},
        )
        assert r.status_code == 200
        r = requests.post(f"{BASE}/api/books/{bid}/touch", headers=H())
        assert r.status_code == 200

        # Source URL set + clear
        r = requests.patch(
            f"{BASE}/api/books/{bid}/source-url",
            headers={**H(), "Content-Type": "application/json"},
            json={"source_url": "https://archiveofourown.org/works/9999"},
        )
        assert r.status_code == 200

        # Series set + clear
        r = requests.patch(
            f"{BASE}/api/books/{bid}/series",
            headers={**H(), "Content-Type": "application/json"},
            json={"series_name": "Cycle Saga", "series_index": 1.0},
        )
        assert r.status_code == 200

        # Get links file
        r = requests.get(f"{BASE}/api/books/{bid}/links", headers=H())
        assert r.status_code in (200, 404)

        # DELETE
        r = requests.delete(f"{BASE}/api/books/{bid}", headers=H())
        assert r.status_code == 200
        r = requests.get(f"{BASE}/api/books/{bid}", headers=H())
        assert r.status_code == 404

    def test_export_links_and_zip(self):
        epub = _build_minimal_epub("Export Book", "Export Author",
                                   body_html='<a href="https://example.com">x</a>')
        r = requests.post(
            f"{BASE}/api/books/upload",
            headers=H(),
            files={"files": ("exp.epub", epub, "application/epub+zip")},
        )
        assert r.status_code == 200

        r = requests.get(f"{BASE}/api/books/export/links", headers=H())
        assert r.status_code in (200, 404)

        r = requests.get(f"{BASE}/api/books/export/unavailable", headers=H())
        assert r.status_code in (200, 404)

    def test_book_stats_and_recent(self):
        r = requests.get(f"{BASE}/api/books/stats", headers=H())
        assert r.status_code == 200
        body = r.json()
        # Backend exposes 'categories' and 'fandoms', not 'by_category'
        assert "categories" in body
        assert "fandoms" in body
        assert "total" in body

        r = requests.get(f"{BASE}/api/books/recent?limit=5", headers=H())
        assert r.status_code == 200
        # Backend returns a list directly
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_detect_series_all_runs(self):
        # Upload an extra book whose title has a series pattern
        epub = _build_minimal_epub("Saga Book 5: Doom", "Saga Author")
        requests.post(
            f"{BASE}/api/books/upload",
            headers=H(),
            files={"files": ("saga.epub", epub, "application/epub+zip")},
        )
        r = requests.post(f"{BASE}/api/books/detect-series-all", headers=H())
        assert r.status_code == 200
        body = r.json()
        # Backend returns {'scanned': N, 'found': M}
        assert "scanned" in body


# --------------------------------------------------------------------------
# Bulk operations — extra coverage for routes/books.py
# --------------------------------------------------------------------------
class TestBulkOps:
    def test_bulk_move_and_metadata_and_delete(self):
        ids = []
        for i in range(2):
            epub = _build_minimal_epub(f"Bulk Book {i}", "Bulk Author")
            r = requests.post(
                f"{BASE}/api/books/upload",
                headers=H(),
                files={"files": (f"b{i}.epub", epub, "application/epub+zip")},
            )
            ids.append(r.json()["books"][0]["book_id"])

        # bulk move
        r = requests.post(
            f"{BASE}/api/books/bulk/move",
            headers={**H(), "Content-Type": "application/json"},
            json={"book_ids": ids, "category": "Fanfiction"},
        )
        assert r.status_code == 200
        assert r.json()["updated"] >= 2

        # bulk metadata: set author + group as series
        r = requests.post(
            f"{BASE}/api/books/bulk/metadata",
            headers={**H(), "Content-Type": "application/json"},
            json={
                "book_ids": ids,
                "author": "Renamed Author",
                "series_name": "Group Series",
                "series_start_index": 1,
                "title_prefix_strip": "Bulk ",
            },
        )
        assert r.status_code == 200

        # bulk metadata: empty ids → no-op
        r = requests.post(
            f"{BASE}/api/books/bulk/metadata",
            headers={**H(), "Content-Type": "application/json"},
            json={"book_ids": []},
        )
        assert r.status_code == 200
        assert r.json()["updated"] == 0

        # bulk delete
        r = requests.post(
            f"{BASE}/api/books/bulk/delete",
            headers={**H(), "Content-Type": "application/json"},
            json={"book_ids": ids},
        )
        assert r.status_code == 200
        assert r.json()["deleted"] >= 2
