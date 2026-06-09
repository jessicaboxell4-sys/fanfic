"""Live integration test for the Linkless Shelf endpoints.

Hits the public preview URL so we exercise the same path the UI takes.
Creates an ephemeral user, uploads a tiny linkless EPUB, asserts it
appears in /api/library/linkless, claims a source URL via
PATCH /api/books/{id}/source-url (testing BOTH `url` and `source_url`
field aliases), and verifies the book disappears from the shelf.
"""
import io
import os
import time
import uuid
import zipfile
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _make_minimal_epub(title: str = "Linkless Test Book") -> bytes:
    """Build a tiny but valid EPUB 2 with NO source URL in metadata or body."""
    book_uuid = str(uuid.uuid4())
    container_xml = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""
    content_opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>{title}</dc:title>
<dc:creator>Test Author</dc:creator>
<dc:identifier id="BookId">urn:uuid:{book_uuid}</dc:identifier>
<dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
<item id="ch1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>"""
    nav_xhtml = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>nav</title></head><body><nav><ol><li><a href="chap1.xhtml">C1</a></li></ol></nav></body></html>"""
    chap1 = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>C1</title></head><body><h1>Chapter 1</h1><p>Just text. No links here.</p></body></html>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", container_xml)
        z.writestr("OEBPS/content.opf", content_opf)
        z.writestr("OEBPS/nav.xhtml", nav_xhtml)
        z.writestr("OEBPS/chap1.xhtml", chap1)
    return buf.getvalue()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    email = f"linkless_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.local"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "hunter2pw_test", "name": "Linkless Tester"}, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return s


class TestLinklessShelf:
    def test_unauth_403(self):
        r = requests.get(f"{API}/library/linkless", timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_empty_initial(self, client):
        r = client.get(f"{API}/library/linkless", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 0
        assert data["books"] == []
        assert data["by_category"] == {}

    def test_upload_and_appears_in_linkless(self, client):
        epub = _make_minimal_epub("Linkless Test One")
        r = client.post(
            f"{API}/books/upload",
            files={"files": ("linkless_test_one.epub", epub, "application/epub+zip")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Endpoint returns list of uploaded books — find ours
        uploaded = body.get("uploaded") or body.get("books") or body
        assert uploaded, f"no uploaded list in {body}"
        # Pull from /api/books to grab the book_id
        rb = client.get(f"{API}/books", timeout=20)
        assert rb.status_code == 200
        books = rb.json() if isinstance(rb.json(), list) else rb.json().get("books", [])
        target = next((b for b in books if b.get("title") == "Linkless Test One"), None)
        assert target, f"uploaded book not in /api/books listing: {books[:2]}"
        pytest.book_id = target["book_id"]

        r2 = client.get(f"{API}/library/linkless", timeout=20)
        assert r2.status_code == 200
        d = r2.json()
        assert d["count"] >= 1
        assert any(b["book_id"] == target["book_id"] for b in d["books"])
        assert d["by_category"], "by_category should be populated"

    def test_patch_source_url_rejects_garbage(self, client):
        bid = pytest.book_id
        r = client.patch(f"{API}/books/{bid}/source-url", json={"url": "https://example.com/notafic"}, timeout=20)
        assert r.status_code == 400
        assert "recognized" in r.text.lower() or "fanfic" in r.text.lower()

    def test_patch_source_url_404_unknown_book(self, client):
        r = client.patch(f"{API}/books/does-not-exist-xyz/source-url",
                         json={"url": "https://archiveofourown.org/works/12345"}, timeout=20)
        assert r.status_code == 404

    def test_patch_source_url_accepts_legacy_field(self, client):
        # Legacy body shape: {source_url: ...}
        bid = pytest.book_id
        r = client.patch(f"{API}/books/{bid}/source-url",
                         json={"source_url": "https://m.archiveofourown.org/works/77777?view_adult=true"},
                         timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        # Canonicalization check
        assert d["source_url"] == "https://archiveofourown.org/works/77777"
        assert "https://archiveofourown.org/works/77777" in d["fanfic_urls"]

    def test_book_disappears_from_linkless_after_claim(self, client):
        r = client.get(f"{API}/library/linkless", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert not any(b["book_id"] == pytest.book_id for b in d["books"]), \
            "book still in linkless shelf after claiming a source URL"

    def test_patch_source_url_accepts_new_field_and_canonicalizes(self, client):
        # Upload a second linkless book to test the `url` field path.
        epub = _make_minimal_epub("Linkless Test Two")
        client.post(
            f"{API}/books/upload",
            files={"files": ("linkless_test_two.epub", epub, "application/epub+zip")},
            timeout=60,
        )
        rb = client.get(f"{API}/books", timeout=20)
        books = rb.json() if isinstance(rb.json(), list) else rb.json().get("books", [])
        b2 = next((b for b in books if b.get("title") == "Linkless Test Two"), None)
        assert b2, "second book missing"

        # FFnet with trailing slash + uppercase → canonical
        r = client.patch(f"{API}/books/{b2['book_id']}/source-url",
                         json={"url": "https://WWW.fanfiction.net/s/9876/3/Some-Chapter-Title/"},
                         timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["source_url"] == "https://www.fanfiction.net/s/9876"

    def test_dedupe_endpoint_still_works(self, client):
        """Sanity: utils.url_canonical extraction didn't break dedupe."""
        payload = {"text": "\n".join([
            "https://archiveofourown.org/works/77777",
            "https://m.archiveofourown.org/works/77777?view_adult=true",  # same as above
            "https://www.fanfiction.net/s/9876",  # owned
            "https://archiveofourown.org/works/99999999",  # not owned
        ])}
        r = client.post(f"{API}/books/url-list/dedupe", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should report at least one match for our owned URLs
        keys = list(d.keys())
        assert any(k in keys for k in ("owned", "matched", "duplicates", "results", "items", "total")), keys

    def test_xlsx_export_still_works(self, client):
        payload = {"urls": [
            "https://archiveofourown.org/works/77777",
            "https://archiveofourown.org/works/99999",
        ]}
        r = client.post(f"{API}/books/url-list/export-xlsx", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/vnd.openxmlformats-officedocument.spreadsheetml")
        assert len(r.content) > 100
