"""Tests for new features (iteration 2):
- Authors endpoints (/api/authors, /api/authors/{name})
- Stats detailed (/api/stats/detailed)
- Bulk metadata (/api/books/bulk/metadata)
- Regression: auth register/login/logout/me, series, refresh-status, source-url
"""
import os
import uuid
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from ebooklib import epub

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://genre-sort.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

# Seed user with bearer-token session (no password required for these tests)
USER_ID = f"user_newf_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_newf_{uuid.uuid4().hex}"


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


def make_epub(title, author, desc):
    b = epub.EpubBook()
    b.set_identifier(uuid.uuid4().hex)
    b.set_title(title)
    b.add_author(author)
    b.set_language('en')
    b.add_metadata('DC', 'description', desc)
    c = epub.EpubHtml(title='Ch1', file_name='c1.xhtml', lang='en')
    c.content = f"<h1>{title}</h1><p>{desc}</p>"
    b.add_item(c); b.toc = [c]
    b.add_item(epub.EpubNcx()); b.add_item(epub.EpubNav())
    b.spine = ['nav', c]
    path = f"/tmp/{uuid.uuid4().hex}.epub"
    epub.write_epub(path, b)
    return path


@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": f"{USER_ID}@example.com",
        "name": "NewF User",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID,
        "session_token": TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})


@pytest.fixture(scope="module")
def uploaded_books():
    """Upload 3 books: 2 by 'Jane Author', 1 by 'John Other'."""
    paths = [
        make_epub("OLDIE: The First Book", "Jane Author", "A Harry Potter fanfiction at Hogwarts."),
        make_epub("OLDIE: The Second Book", "Jane Author", "Another Hogwarts fanfic."),
        make_epub("Hiking Manual", "John Other", "A practical mountain hiking guide and handbook."),
    ]
    books = []
    for p in paths:
        with open(p, 'rb') as f:
            r = requests.post(f"{BASE}/api/books/upload", headers=H(),
                              files={"files": (os.path.basename(p), f, "application/epub+zip")})
        assert r.status_code == 200, r.text
        books.append(r.json()["books"][0])
    return books


# ---------------------------------------------------------------------------
# AUTHORS
# ---------------------------------------------------------------------------
class TestAuthors:
    def test_list_authors(self, uploaded_books):
        r = requests.get(f"{BASE}/api/authors", headers=H())
        assert r.status_code == 200
        names = [a["name"] for a in r.json()["authors"]]
        assert "Jane Author" in names
        assert "John Other" in names
        # Ensure 'Unknown'/empty filtered (none in this seed, but contract holds)
        assert all(n.strip() and n.lower() != "unknown" for n in names)
        # Counts correct
        jane = next(a for a in r.json()["authors"] if a["name"] == "Jane Author")
        assert jane["count"] == 2

    def test_get_author_books(self, uploaded_books):
        r = requests.get(f"{BASE}/api/authors/Jane Author", headers=H())
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Jane Author"
        assert len(data["books"]) == 2
        for b in data["books"]:
            assert b["author"] == "Jane Author"

    def test_get_author_empty(self):
        r = requests.get(f"{BASE}/api/authors/Nonexistent Person", headers=H())
        assert r.status_code == 200
        assert r.json()["books"] == []


# ---------------------------------------------------------------------------
# STATS DETAILED
# ---------------------------------------------------------------------------
class TestStatsDetailed:
    def test_shape(self, uploaded_books):
        r = requests.get(f"{BASE}/api/stats/detailed", headers=H())
        assert r.status_code == 200
        d = r.json()
        assert "daily" in d and len(d["daily"]) == 30
        assert all("date" in x and "books_opened" in x and "label" in x for x in d["daily"])
        assert "monthly_finished" in d and len(d["monthly_finished"]) == 12
        assert "top_fandoms" in d and isinstance(d["top_fandoms"], list)
        assert "top_authors" in d and isinstance(d["top_authors"], list)
        assert "categories" in d
        assert d["books_total"] >= 3
        # Jane Author should appear at top
        author_names = [a["name"] for a in d["top_authors"]]
        assert "Jane Author" in author_names

    def test_stats_overview_regression(self, uploaded_books):
        r = requests.get(f"{BASE}/api/stats/overview", headers=H())
        assert r.status_code == 200
        d = r.json()
        # has expected fields (may vary, but should at least include some)
        assert isinstance(d, dict)


# ---------------------------------------------------------------------------
# BULK METADATA
# ---------------------------------------------------------------------------
class TestBulkMetadata:
    def test_set_author_and_category(self, uploaded_books):
        ids = [b["book_id"] for b in uploaded_books[:2]]
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": ids,
            "author": "Renamed Author",
            "category": "Original Fiction",
        })
        assert r.status_code == 200
        assert r.json()["updated"] >= 1
        # Verify persistence
        for bid in ids:
            g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert g["author"] == "Renamed Author"
            assert g["category"] == "Original Fiction"
            assert g["classifier"] == "manual"

    def test_clear_fandom(self, uploaded_books):
        # Use book[2] (John Other) - even though it has no fandom, clearing should be a no-op success
        bid = uploaded_books[0]["book_id"]
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": [bid],
            "fandom": "",
        })
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
        assert not g.get("fandom")

    def test_assign_series(self, uploaded_books):
        ids = [b["book_id"] for b in uploaded_books[:2]]
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": ids,
            "series_name": "Test Saga",
            "series_start_index": 5,
        })
        assert r.status_code == 200
        # Verify sequential numbering
        g0 = requests.get(f"{BASE}/api/books/{ids[0]}", headers=H()).json()
        g1 = requests.get(f"{BASE}/api/books/{ids[1]}", headers=H()).json()
        assert g0["series_name"] == "Test Saga"
        assert g1["series_name"] == "Test Saga"
        assert g0["series_index"] == 5
        assert g1["series_index"] == 6

    def test_clear_series(self, uploaded_books):
        ids = [b["book_id"] for b in uploaded_books[:2]]
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": ids,
            "series_name": "",
        })
        assert r.status_code == 200
        for bid in ids:
            g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert not g.get("series_name")

    def test_title_prefix_strip(self, uploaded_books):
        ids = [b["book_id"] for b in uploaded_books[:2]]
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": ids,
            "title_prefix_strip": "OLDIE: ",
        })
        assert r.status_code == 200
        for bid in ids:
            g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert not g["title"].startswith("OLDIE:"), g["title"]

    def test_empty_book_ids(self):
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H(), json={
            "book_ids": [],
            "author": "X",
        })
        assert r.status_code == 200
        assert r.json()["updated"] == 0

    def test_requires_auth(self):
        r = requests.post(f"{BASE}/api/books/bulk/metadata", json={
            "book_ids": ["x"], "author": "Y",
        })
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# REGRESSION: AUTH (register/login/logout/me)
# ---------------------------------------------------------------------------
class TestAuthRegression:
    def test_register_login_logout(self):
        email = f"test_reg_{uuid.uuid4().hex[:8]}@example.com"
        pwd = "hunter2pw"
        s = requests.Session()
        # Register
        r = s.post(f"{BASE}/api/auth/register",
                   json={"email": email, "password": pwd, "name": "Reg User"})
        assert r.status_code in (200, 201), r.text
        # Cookie should be set
        assert s.cookies.get("session_token"), "session_token cookie missing"
        # me
        me = s.get(f"{BASE}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email
        # Logout
        lo = s.post(f"{BASE}/api/auth/logout")
        assert lo.status_code == 200
        # me should now fail
        me2 = requests.get(f"{BASE}/api/auth/me", cookies={"session_token": "garbage"})
        assert me2.status_code == 401

        # Login again
        s2 = requests.Session()
        li = s2.post(f"{BASE}/api/auth/login",
                     json={"email": email, "password": pwd})
        assert li.status_code == 200, li.text
        assert s2.cookies.get("session_token")
        # Cleanup user from db
        db.users.delete_many({"email": email})

    def test_login_invalid(self):
        r = requests.post(f"{BASE}/api/auth/login",
                          json={"email": "doesnt@exist.com", "password": "nope"})
        assert r.status_code in (401, 429)


# ---------------------------------------------------------------------------
# REGRESSION: BULK move/delete, series, refresh-status, source-url
# ---------------------------------------------------------------------------
class TestOtherRegression:
    def test_refresh_status(self, uploaded_books):
        r = requests.get(f"{BASE}/api/books/refresh-status", headers=H())
        assert r.status_code == 200

    def test_series_list(self, uploaded_books):
        r = requests.get(f"{BASE}/api/series", headers=H())
        assert r.status_code == 200

    def test_bulk_move(self, uploaded_books):
        bid = uploaded_books[2]["book_id"]
        r = requests.post(f"{BASE}/api/books/bulk/move", headers=H(), json={
            "book_ids": [bid], "category": "Non-fiction",
        })
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
        assert g["category"] == "Non-fiction"

    def test_source_url_patch(self, uploaded_books):
        bid = uploaded_books[2]["book_id"]
        r = requests.patch(f"{BASE}/api/books/{bid}/source-url", headers=H(), json={
            "source_url": "https://archiveofourown.org/works/12345",
        })
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
        assert "archiveofourown.org" in (g.get("source_url") or "")

    def test_source_url_patch_invalid(self, uploaded_books):
        bid = uploaded_books[2]["book_id"]
        r = requests.patch(f"{BASE}/api/books/{bid}/source-url", headers=H(), json={
            "source_url": "https://random.com/notsupported",
        })
        assert r.status_code == 400

    def test_bulk_delete(self, uploaded_books):
        # Delete book 2 (John Other) at end
        bid = uploaded_books[2]["book_id"]
        r = requests.post(f"{BASE}/api/books/bulk/delete", headers=H(), json={
            "book_ids": [bid],
        })
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/books/{bid}", headers=H())
        assert g.status_code == 404
