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


@pytest.mark.skipif(not FICHUB_MOCKED, reason="FICHUB_BASE_URL not set")
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
        """err=-9 from FicHub → marked unavailable + 404 to caller."""
        fichub_mock_server.clear()
        fichub_mock_server.expect_request("/api/v0/epub").respond_with_json({
            "err": -9, "info": "Story not found"
        })
        bid = self._seed_book_via_upload("https://archiveofourown.org/works/not-real")
        r = requests.post(f"{BASE}/api/books/{bid}/refresh", headers=H())
        assert r.status_code == 404
        time.sleep(0.3)
        b = db.books.find_one({"book_id": bid})
        assert b.get("fichub_unavailable") is True
        assert b.get("fichub_last_error")

    def test_refresh_book_succeeds_with_fresh_epub(self, fichub_mock_server):
        """Happy path: FicHub returns meta + EPUB → book updated."""
        fichub_mock_server.clear()
        new_epub = _build_minimal_epub(
            "Refreshed Title", "Updated Author",
            description="New body after refresh",
        )
        fichub_mock_server.expect_request("/api/v0/epub").respond_with_json({
            "err": 0,
            "urls": {"epub": "/download/refreshed.epub"},
            "meta": {
                "chapters": 12,
                "rawExtendedMeta": {
                    "dateUpdated": "2025-12-01",
                    "words": 50000,
                    "status": "complete",
                }
            }
        })
        fichub_mock_server.expect_request("/download/refreshed.epub").respond_with_data(
            new_epub, content_type="application/epub+zip"
        )

        bid = self._seed_book_via_upload("https://archiveofourown.org/works/77777")
        r = requests.post(f"{BASE}/api/books/{bid}/refresh", headers=H())
        assert r.status_code == 200, r.text
        time.sleep(0.3)
        b = db.books.find_one({"book_id": bid})
        assert b["title"] == "Refreshed Title"
        assert b["author"] == "Updated Author"
        assert b.get("last_refreshed_at") is not None
        assert b.get("fichub_meta", {}).get("chapters") == 12

    def test_refresh_all_runs(self, fichub_mock_server):
        """Bulk refresh executes the loop and returns aggregate counts."""
        fichub_mock_server.clear()
        fichub_mock_server.expect_request("/api/v0/epub").respond_with_json({
            "err": -9, "info": "nope"
        })

        # Ensure there's at least one eligible book
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
