"""Shelfsort backend API tests."""
import os, io, time, uuid
import pytest, requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from ebooklib import epub

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://genre-sort.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_test_{uuid.uuid4().hex[:8]}"
TOKEN = f"test_session_{uuid.uuid4().hex}"


@pytest.fixture(scope="session", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID, "email": f"{USER_ID}@example.com",
        "name": "Test User", "picture": "", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID, "session_token": TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.categories.delete_many({"user_id": USER_ID})


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


def make_epub(title, author, desc):
    b = epub.EpubBook()
    b.set_identifier(uuid.uuid4().hex)
    b.set_title(title); b.add_author(author); b.set_language('en')
    b.add_metadata('DC', 'description', desc)
    c = epub.EpubHtml(title='Ch1', file_name='c1.xhtml', lang='en')
    c.content = f"<h1>{title}</h1><p>{desc}</p>"
    b.add_item(c); b.toc = [c]
    b.add_item(epub.EpubNcx()); b.add_item(epub.EpubNav())
    b.spine = ['nav', c]
    path = f"/tmp/{uuid.uuid4().hex}.epub"
    epub.write_epub(path, b)
    return path


# --- Health & Auth ---
def test_root():
    r = requests.get(f"{BASE}/api/")
    assert r.status_code == 200 and r.json()["ok"] is True

def test_me_no_auth():
    assert requests.get(f"{BASE}/api/auth/me").status_code == 401

def test_me_with_token():
    r = requests.get(f"{BASE}/api/auth/me", headers=H())
    assert r.status_code == 200
    assert r.json()["user_id"] == USER_ID


# --- Uploads & classification ---
@pytest.fixture(scope="session")
def hp_book():
    p = make_epub("The Marauders of Hogwarts", "AnonAO3",
                  "A Harry Potter fanfiction featuring Hermione, Voldemort, Dumbledore at Hogwarts.")
    with open(p, 'rb') as f:
        r = requests.post(f"{BASE}/api/books/upload", headers=H(),
                          files={"files": ("hp.epub", f, "application/epub+zip")})
    assert r.status_code == 200
    return r.json()["books"][0]

@pytest.fixture(scope="session")
def nf_book():
    p = make_epub("Mountain Hiking Guide", "John Doe",
                  "A practical guide to mountain hiking with handbook and manual style.")
    with open(p, 'rb') as f:
        r = requests.post(f"{BASE}/api/books/upload", headers=H(),
                          files={"files": ("nf.epub", f, "application/epub+zip")})
    return r.json()["books"][0]

@pytest.fixture(scope="session")
def tw_book():
    p = make_epub("Forks Forever", "TwiFan",
                  "Bella Swan and Edward Cullen fanfiction set in Forks Washington. Twilight saga.")
    with open(p, 'rb') as f:
        r = requests.post(f"{BASE}/api/books/upload", headers=H(),
                          files={"files": ("tw.epub", f, "application/epub+zip")})
    return r.json()["books"][0]


def test_upload_hp(hp_book):
    assert hp_book["category"] == "Fanfiction"
    assert hp_book["fandom"] == "Harry Potter"

def test_upload_nf(nf_book):
    assert nf_book["category"] == "Non-fiction"

def test_upload_twilight(tw_book):
    assert tw_book["category"] == "Fanfiction"
    assert tw_book["fandom"] == "Twilight"


def test_list_books(hp_book, nf_book, tw_book):
    r = requests.get(f"{BASE}/api/books", headers=H())
    assert r.status_code == 200
    ids = [b["book_id"] for b in r.json()["books"]]
    assert hp_book["book_id"] in ids and nf_book["book_id"] in ids

def test_filter_books(hp_book):
    r = requests.get(f"{BASE}/api/books?category=Fanfiction&fandom=Harry%20Potter", headers=H())
    assert r.status_code == 200
    assert all(b["fandom"] == "Harry Potter" for b in r.json()["books"])

def test_stats(hp_book):
    r = requests.get(f"{BASE}/api/books/stats", headers=H())
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 3
    assert any(f["name"] == "Harry Potter" for f in d["fandoms"])

def test_get_book(hp_book):
    r = requests.get(f"{BASE}/api/books/{hp_book['book_id']}", headers=H())
    assert r.status_code == 200 and r.json()["book_id"] == hp_book["book_id"]

def test_cover_404(hp_book):
    r = requests.get(f"{BASE}/api/books/{hp_book['book_id']}/cover", headers=H())
    assert r.status_code in (200, 404)

def test_download(hp_book):
    r = requests.get(f"{BASE}/api/books/{hp_book['book_id']}/download", headers=H())
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/epub")

def test_patch_book(nf_book):
    r = requests.patch(f"{BASE}/api/books/{nf_book['book_id']}", headers=H(),
                       json={"category": "Original Fiction", "fandom": None})
    assert r.status_code == 200
    g = requests.get(f"{BASE}/api/books/{nf_book['book_id']}", headers=H()).json()
    assert g["category"] == "Original Fiction" and g["classifier"] == "manual"

def test_reclassify_ai(hp_book):
    r = requests.post(f"{BASE}/api/books/{hp_book['book_id']}/reclassify",
                      headers=H(), json={"use_ai": True}, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert d["category"] in ("Fanfiction", "Original Fiction", "Non-fiction", "Unclassified")

def test_export_zip(hp_book):
    r = requests.get(f"{BASE}/api/books/export/zip", headers=H())
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/zip")
    assert len(r.content) > 100
    # Verify the new folder layout: README.txt at top + Fanfiction/<Fandom>/...
    import io as _io, zipfile as _zf
    z = _zf.ZipFile(_io.BytesIO(r.content))
    names = z.namelist()
    assert "README.txt" in names, names
    assert "library_index.xlsx" in names, names
    readme = z.read("README.txt").decode("utf-8")
    assert "Shelfsort library export" in readme
    assert "Folder layout" in readme
    assert "library_index.xlsx" in readme
    # HP fanfic should land somewhere under Fanfiction/Harry_Potter/
    assert any(n.startswith("Fanfiction/Harry_Potter/") for n in names), names
    # Excel index sanity: openable, has 1 header row + at least 1 book row
    import openpyxl as _ox
    from io import BytesIO as _BIO
    wb = _ox.load_workbook(_BIO(z.read("library_index.xlsx")))
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0] == ("Folder", "Fandom", "Pairing", "Title", "Author", "Source URL", "Words"), rows[0]
    assert len(rows) >= 2, rows

def test_categories():
    r = requests.get(f"{BASE}/api/categories", headers=H())
    assert r.status_code == 200
    assert "Fanfiction" in r.json()["defaults"]
    r2 = requests.post(f"{BASE}/api/categories", headers=H(), json={"name": "TEST_Custom"})
    assert r2.status_code == 200
    r3 = requests.get(f"{BASE}/api/categories", headers=H()).json()
    assert "TEST_Custom" in r3["custom"]
    requests.delete(f"{BASE}/api/categories/TEST_Custom", headers=H())

def test_delete_book(tw_book):
    r = requests.delete(f"{BASE}/api/books/{tw_book['book_id']}", headers=H())
    assert r.status_code == 200
    g = requests.get(f"{BASE}/api/books/{tw_book['book_id']}", headers=H())
    assert g.status_code == 404
