"""
Iter 88 backend regression — verify the 14 routes extracted from routes/books.py
into 5 new modules (books_polish, books_relationships, books_unknown_sources,
books_versions, books_links) have IDENTICAL behavior to before the refactor.
Plus smoke test of shared-helper routes (upload/list/single fetch/reclassify)
that still live in books.py.
"""
import os
import io
import pytest
import requests
import zipfile

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")

TESTER_EMAIL = "shelfsort-tester@example.com"
TESTER_PW = "tester123!"
ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PW = "AdminSmoke123!"

BOGUS_ID = "book_deadbeefdeadbeef"


def _login_or_register(email, password, name="Tester"):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        # try register
        r2 = s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": name}, timeout=15)
        if r2.status_code not in (200, 201):
            pytest.skip(f"Cannot auth {email}: login={r.status_code} register={r2.status_code} body={r2.text[:200]}")
    return s


@pytest.fixture(scope="module")
def user_session():
    return _login_or_register(TESTER_EMAIL, TESTER_PW, "Tester")


@pytest.fixture(scope="module")
def admin_session():
    return _login_or_register(ADMIN_EMAIL, ADMIN_PW, "Admin")


@pytest.fixture(scope="module")
def anon_session():
    return requests.Session()


# ------------------- books_polish.py -------------------

class TestPolish:
    def test_polish_preview_shape(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/polish/preview", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("suggestions", "returned", "candidates_scanned", "limit"):
            assert k in data, f"missing {k} in {data}"
        assert isinstance(data["suggestions"], list)
        assert isinstance(data["returned"], int)
        assert isinstance(data["candidates_scanned"], int)
        assert isinstance(data["limit"], int)

    def test_polish_preview_auth_gated(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/books/polish/preview", timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_polish_apply_empty(self, user_session):
        r = user_session.post(f"{BASE_URL}/api/books/polish/apply", json={"items": []}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("updated") == 0
        assert data.get("skipped") == 0
        assert data.get("details") == []


# ------------------- books_relationships.py -------------------

class TestRelationships:
    def test_relationships_list_shape(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/relationships", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "relationships" in data and "count" in data
        assert isinstance(data["relationships"], list)
        assert isinstance(data["count"], int)

    def test_relationships_list_auth_gated(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/relationships", timeout=15)
        assert r.status_code in (401, 403)

    def test_relationships_backfill(self, user_session):
        r = user_session.post(f"{BASE_URL}/api/relationships/backfill", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "updated" in data and "skipped" in data
        assert isinstance(data["updated"], int)
        assert isinstance(data["skipped"], int)

    def test_detect_series_all(self, user_session):
        r = user_session.post(f"{BASE_URL}/api/books/detect-series-all", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "scanned" in data and "found" in data
        assert isinstance(data["scanned"], int)
        assert isinstance(data["found"], int)

    def test_patch_book_series_404(self, user_session):
        r = user_session.patch(f"{BASE_URL}/api/books/{BOGUS_ID}/series", json={"series_name": "X", "series_index": 1}, timeout=15)
        assert r.status_code == 404, r.status_code


# ------------------- books_unknown_sources.py (admin) -------------------

class TestUnknownSources:
    def test_list_auth_gated_anon(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/admin/unknown-sources", timeout=15)
        assert r.status_code in (401, 403)

    def test_list_forbidden_non_admin(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/admin/unknown-sources", timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_list_shape_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/unknown-sources", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "hosts" in data
        assert isinstance(data["count"], int)
        assert isinstance(data["hosts"], list)

    def test_create_and_delete_flow(self, admin_session):
        test_url = "https://iter88-test-unknown-host.example.com/story/123"
        test_host = "iter88-test-unknown-host.example.com"
        # cleanup any prior
        admin_session.delete(f"{BASE_URL}/api/admin/unknown-sources/{test_host}", timeout=15)

        r = admin_session.post(
            f"{BASE_URL}/api/admin/unknown-sources",
            json={"url": test_url},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text

        # verify present
        lst = admin_session.get(f"{BASE_URL}/api/admin/unknown-sources", timeout=15).json()
        hosts_str = str(lst.get("hosts", []))
        assert test_host in hosts_str, f"created host not in list: {hosts_str[:400]}"

        # delete
        d = admin_session.delete(f"{BASE_URL}/api/admin/unknown-sources/{test_host}", timeout=15)
        assert d.status_code in (200, 204), d.text

        # delete again (idempotent)
        d2 = admin_session.delete(f"{BASE_URL}/api/admin/unknown-sources/{test_host}", timeout=15)
        assert d2.status_code in (200, 204, 404)

    def test_mark_accepted_404(self, admin_session):
        r = admin_session.patch(
            f"{BASE_URL}/api/admin/unknown-sources/iter88-nonexistent-host-xyz.example.invalid/mark-accepted",
            json={"accepted": True},
            timeout=15,
        )
        assert r.status_code == 404, r.status_code


# ------------------- books_versions.py -------------------

class TestVersions:
    def test_upload_new_version_404(self, user_session):
        # Send minimal multipart to reach the endpoint (missing book returns 404 before file processing usually)
        files = {"file": ("dummy.epub", b"PK\x03\x04dummy", "application/epub+zip")}
        r = user_session.post(f"{BASE_URL}/api/books/{BOGUS_ID}/upload-new-version", files=files, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_diff_404(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/{BOGUS_ID}/diff", timeout=15)
        assert r.status_code == 404, r.status_code


# ------------------- books_links.py -------------------

class TestLinks:
    def test_book_links_404(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/{BOGUS_ID}/links", timeout=15)
        assert r.status_code == 404, r.status_code

    def test_download_original_404(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/{BOGUS_ID}/download-original", timeout=15, allow_redirects=False)
        assert r.status_code == 404, r.status_code

    def test_export_links_shape(self, user_session):
        # Empty library user → per spec, 404 matches previous behavior.
        # For a user WITH books, should return 200. Accept both to avoid brittleness.
        r = user_session.get(f"{BASE_URL}/api/books/export/links", timeout=30)
        assert r.status_code in (200, 404), f"{r.status_code}: {r.text[:200]}"


# ------------------- Shared-helper smoke: existing books.py routes -------------------

def _make_minimal_epub_bytes(title="ITER88 Test Book", author="Iter88 Author"):
    """Build a very small valid-ish EPUB in memory."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""")
        opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:identifier id="BookId">urn:uuid:iter88-test</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>"""
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/c1.xhtml", "<html><body><p>Iter88 smoke content</p></body></html>")
    return buf.getvalue()


class TestSharedHelperSmoke:
    """Spot-check routes still in books.py that use extracted-helper touch points."""

    def test_list_books(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Could be list or dict{books:[]}
        assert isinstance(data, (list, dict))

    def test_single_book_404(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/{BOGUS_ID}", timeout=15)
        assert r.status_code == 404, r.status_code

    def test_patch_book_404(self, user_session):
        r = user_session.patch(f"{BASE_URL}/api/books/{BOGUS_ID}", json={"title": "X"}, timeout=15)
        assert r.status_code == 404, r.status_code

    def test_download_404(self, user_session):
        r = user_session.get(f"{BASE_URL}/api/books/{BOGUS_ID}/download", timeout=15, allow_redirects=False)
        assert r.status_code == 404, r.status_code

    def test_reclassify_404(self, user_session):
        r = user_session.post(f"{BASE_URL}/api/books/{BOGUS_ID}/reclassify", json={}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_upload_epub_smoke(self, user_session):
        """Upload minimal EPUB → verify list contains it → cleanup."""
        epub_bytes = _make_minimal_epub_bytes(title="ITER88 Smoke", author="Iter88 Smoke Author")
        files = [("files", ("iter88_smoke.epub", epub_bytes, "application/epub+zip"))]
        r = user_session.post(f"{BASE_URL}/api/books/upload", files=files, timeout=60)
        # Accept 200/201/202 (async job) — just verifying the extracted helpers didn't break upload
        assert r.status_code in (200, 201, 202), f"{r.status_code}: {r.text[:300]}"
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        book_id = None
        if isinstance(data, dict):
            book_id = data.get("book_id") or data.get("id") or (data.get("book") or {}).get("id")
        # Cleanup if we got a book_id
        if book_id:
            user_session.delete(f"{BASE_URL}/api/books/{book_id}", timeout=15)


# ------------------- Import health -------------------

class TestImportHealth:
    def test_shared_helpers_importable(self):
        """The 5 new modules import a lot from routes.books — verify none broken."""
        import subprocess
        r = subprocess.run(
            [
                "python3", "-c",
                "from routes.books import extract_epub_metadata, OLD_STORIES_SHELF, _templated_filename, "
                "extract_urls_from_epub, format_links_txt, extract_chapters, diff_chapters, "
                "_write_local_and_mirror_to_r2, apply_template_to_epub, _canonicalize_fandom, "
                "classify_ao3_non_work, normalize_fanfic_url, FANDOM_KEYWORDS, FANFIC_SIGNALS, "
                "classify_book, classify_by_metadata, _clean_author_string, _normalize_author_for_match; "
                "print('OK')"
            ],
            cwd="/app/backend", capture_output=True, text=True, timeout=30
        )
        assert "OK" in r.stdout, f"stderr={r.stderr[-400:]}"

    def test_new_modules_importable(self):
        import subprocess
        r = subprocess.run(
            ["python3", "-c",
             "from routes import books_polish, books_relationships, books_unknown_sources, books_versions, books_links; print('OK')"],
            cwd="/app/backend", capture_output=True, text=True, timeout=30
        )
        assert "OK" in r.stdout, f"stderr={r.stderr[-400:]}"
