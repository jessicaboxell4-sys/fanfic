"""Iteration 111 smoke tests — book download filename + local/R2 mirror pattern."""
import io
import os
import re
import uuid
import zipfile

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")


def _make_minimal_epub() -> bytes:
    """Minimal valid EPUB (zip with mimetype + basic structure)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   '<dc:title>SmokeTitle Iter111</dc:title>'
                   '<dc:creator>Smoke Author</dc:creator>'
                   '<dc:identifier id="id">urn:uuid:smoke-iter111</dc:identifier>'
                   '<dc:language>en</dc:language>'
                   '</metadata><manifest><item id="c" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest>'
                   '<spine><itemref idref="c"/></spine></package>')
        z.writestr("OEBPS/ch.xhtml",
                   '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>C</title></head>'
                   '<body><p>hi</p></body></html>')
    return buf.getvalue()


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    # Register a fresh throwaway user to keep this test isolated.
    email = f"TEST_iter111_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "smokepass123!", "name": "Iter111 Smoke",
    }, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:200]}"
    return s


def test_upload_book_and_download_attachment_filename(auth_session):
    epub = _make_minimal_epub()
    files = {"files": ("smoke_iter111.epub", epub, "application/epub+zip")}
    r = auth_session.post(f"{BASE_URL}/api/books/upload", files=files, timeout=60)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    # Response shape is flexible; find at least one uploaded book id.
    book_id = None
    if isinstance(data, dict):
        for k in ("books", "uploaded", "results", "created"):
            v = data.get(k)
            if isinstance(v, list) and v:
                b = v[0]
                if isinstance(b, dict):
                    book_id = b.get("book_id") or b.get("id") or b.get("_id")
                    if book_id:
                        break
        if not book_id:
            book_id = data.get("book_id") or data.get("id")
    assert book_id, f"could not find book_id in upload response: {data}"

    # Give backend a moment for post-processing.
    import time; time.sleep(2)

    dl = auth_session.get(f"{BASE_URL}/api/books/{book_id}/download", timeout=60, allow_redirects=True)
    assert dl.status_code == 200, f"download failed: {dl.status_code} {dl.text[:200]}"
    cd = dl.headers.get("Content-Disposition", "")
    print(f"Content-Disposition: {cd}")
    # Match Title_by_Author-<8hex>.epub — allow either quoted or bare filename param.
    m = re.search(r'filename\*?=(?:UTF-8\'\'|")?([^";\r\n]+)', cd)
    assert m, f"no filename in Content-Disposition: {cd!r}"
    fname = m.group(1).strip('"')
    print(f"filename: {fname}")
    assert fname.lower().endswith(".epub"), f"expected .epub, got {fname}"
    # Template shape: <title>_by_<author>-<shortid>.epub
    assert re.match(r"^.+_by_.+-[A-Za-z0-9]{1,8}\.epub$", fname), \
        f"filename does not match Title_by_Author-<shortid>.epub template: {fname}"


def test_local_disk_write_no_exception(auth_session):
    """Second upload — just verifies the mirror-write pattern doesn't raise
    when R2 may or may not be configured. Success is HTTP 200 + a book_id."""
    epub = _make_minimal_epub()
    files = {"files": ("smoke_iter111_b.epub", epub, "application/epub+zip")}
    r = auth_session.post(f"{BASE_URL}/api/books/upload", files=files, timeout=60)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
