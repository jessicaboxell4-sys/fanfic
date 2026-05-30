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



# ============================================================
# Streak + reading-time heartbeat
# ============================================================
class TestStreakAndHeartbeat:
    def test_streak_endpoint_default_zero(self):
        r = requests.get(f"{BASE}/api/stats/streak", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("streak_days", "grace_today", "today_minutes", "today_active"):
            assert k in body
        assert isinstance(body["streak_days"], int)

    def test_heartbeat_adds_minutes(self, uploaded_books):
        bid = uploaded_books[0]["book_id"]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        db.reading_activity.delete_many({"user_id": USER_ID, "date": today})
        for _ in range(2):
            r = requests.post(
                f"{BASE}/api/books/{bid}/heartbeat",
                headers=H(),
                json={"seconds": 60},
            )
            assert r.status_code == 200, r.text
        s = requests.get(f"{BASE}/api/stats/streak", headers=H()).json()
        assert s["today_active"] is True
        assert s["today_minutes"] >= 2
        doc = db.books.find_one({"book_id": bid})
        assert (doc.get("reading_minutes") or 0) >= 2

    def test_heartbeat_404_for_unknown_book(self):
        r = requests.post(
            f"{BASE}/api/books/book_does_not_exist/heartbeat",
            headers=H(),
            json={"seconds": 60},
        )
        assert r.status_code == 404

    def test_heartbeat_validates_seconds_range(self, uploaded_books):
        bid = uploaded_books[0]["book_id"]
        r = requests.post(
            f"{BASE}/api/books/{bid}/heartbeat",
            headers=H(),
            json={"seconds": -1},
        )
        assert r.status_code == 422
        r = requests.post(
            f"{BASE}/api/books/{bid}/heartbeat",
            headers=H(),
            json={"seconds": 601},
        )
        assert r.status_code == 422


# ============================================================
# Per-book reading stats
# ============================================================
class TestBookReadingStats:
    def test_unread_book_returns_zero(self, uploaded_books):
        # Use book index 1 to avoid heartbeat-test pollution
        bid = uploaded_books[1]["book_id"]
        # Make sure no activity row references this book
        db.reading_activity.update_many(
            {"user_id": USER_ID},
            {"$pull": {"book_ids": bid}},
        )
        db.books.update_one(
            {"book_id": bid},
            {"$unset": {"reading_minutes": "", "last_opened_at": ""}},
        )
        r = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reading_minutes"] == 0
        assert body["session_count"] == 0
        assert body["first_opened_at"] is None
        assert body["last_opened_at"] is None
        assert len(body["sparkline"]) == 30
        assert all("date" in d and "active" in d for d in body["sparkline"])
        assert all(d["active"] is False for d in body["sparkline"])

    def test_read_book_returns_aggregated(self, uploaded_books):
        bid = uploaded_books[0]["book_id"]
        # The heartbeat tests above pushed activity onto bid for today
        r = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reading_minutes"] >= 2  # heartbeat tests added ≥2 min
        assert body["session_count"] >= 1
        assert body["first_opened_at"] is not None
        # Today must be marked active in the sparkline + have minutes recorded
        today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        spark_today = [d for d in body["sparkline"] if d["date"] == today_iso]
        assert spark_today and spark_today[0]["active"] is True
        # New per-day minutes tracking: today must have minutes > 0
        assert spark_today[0]["minutes"] >= 2
        # Each sparkline entry has the three required fields
        for d in body["sparkline"]:
            assert set(d.keys()) >= {"date", "active", "minutes"}
        # Top-level sparkline_max_minutes is exposed for height normalization
        assert "sparkline_max_minutes" in body
        assert body["sparkline_max_minutes"] >= 2

    def test_404_for_unknown_book(self):
        r = requests.get(
            f"{BASE}/api/books/book_does_not_exist/reading-stats", headers=H()
        )
        assert r.status_code == 404

    def test_pace_estimate_gated_off_when_low_signal(self, uploaded_books):
        """No estimate when reading_minutes < 5 OR progress < 5% OR ≥99%."""
        # Seed a fresh book (uploaded_books[2] is deleted by an earlier test)
        bid = f"book_pace_off_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": bid,
            "title": "Pace Off",
            "author": "T",
            "reading_minutes": 1,
            "progress_percent": 0.5,
        })
        body = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H()).json()
        assert body["estimated_minutes_left"] is None

        db.books.update_one(
            {"book_id": bid},
            {"$set": {"reading_minutes": 60, "progress_percent": 0.01}},
        )
        body = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H()).json()
        assert body["estimated_minutes_left"] is None

        db.books.update_one(
            {"book_id": bid},
            {"$set": {"reading_minutes": 100, "progress_percent": 0.995}},
        )
        body = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H()).json()
        assert body["estimated_minutes_left"] is None

    def test_pace_estimate_computed_with_clamp(self, uploaded_books):
        """Plenty of signal → estimate matches (minutes/progress)*(1-progress)."""
        bid = f"book_pace_on_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": bid,
            "title": "Pace On",
            "author": "T",
            "reading_minutes": 60,
            "progress_percent": 0.30,
        })
        body = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H()).json()
        # Expected: 60 / 0.30 * 0.70 = 140 minutes (±2 for rounding)
        assert body["estimated_minutes_left"] is not None
        assert 138 <= body["estimated_minutes_left"] <= 142
        # Sanity clamp: huge pace caps at one week
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"reading_minutes": 600, "progress_percent": 0.05}},
        )
        body = requests.get(f"{BASE}/api/books/{bid}/reading-stats", headers=H()).json()
        assert body["estimated_minutes_left"] == 10080



# ============================================================
# CSV analytics export
# ============================================================
class TestStatsCsvExport:
    def test_csv_export(self, uploaded_books):
        r = requests.get(f"{BASE}/api/stats/export.csv", headers=H())
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        cd = r.headers.get("content-disposition", "")
        assert "shelfsort-analytics-" in cd and ".csv" in cd
        body = r.text
        for section in ("Shelfsort analytics export", "Summary", "Authors", "Fandoms", "Categories"):
            assert section in body
        assert "book_count" in body


# ============================================================
# FanFicFare user options
# ============================================================
class TestFFFOptions:
    def test_defaults(self):
        r = requests.get(f"{BASE}/api/user/fff-options", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["include_author_notes"] is True
        assert body["include_images"] is True
        assert body["keep_chapter_links"] is False
        assert body["apply_template"] is True

    def test_toggle_persists(self):
        r = requests.put(
            f"{BASE}/api/user/fff-options",
            headers=H(),
            json={"include_images": False},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["include_images"] is False
        assert body["include_author_notes"] is True

    def test_partial_update(self):
        r = requests.put(
            f"{BASE}/api/user/fff-options",
            headers=H(),
            json={"keep_chapter_links": True},
        )
        assert r.status_code == 200
        assert r.json()["keep_chapter_links"] is True

    def test_requires_auth(self):
        r = requests.get(f"{BASE}/api/user/fff-options")
        assert r.status_code == 401


# ============================================================
# EPUB template applier — injects intro page + house stylesheet
# ============================================================
class TestEpubTemplateApplier:
    def _build_minimal_fff_epub(self, title: str = "Sample Story") -> bytes:
        """Build a tiny valid EPUB resembling FanFicFare's output (no intro page).
        We just need enough structure for `apply_template_to_epub` to mutate."""
        import zipfile
        from io import BytesIO
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            info = zipfile.ZipInfo("mimetype")
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, "application/epub+zip")
            z.writestr("META-INF/container.xml",
                '<?xml version="1.0"?>\n<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                'media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr("OEBPS/content.opf",
                '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" '
                'version="3.0" unique-identifier="id">\n'
                '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                f'<dc:identifier id="id">test123</dc:identifier>'
                f'<dc:title>{title}</dc:title><dc:language>en</dc:language>'
                '</metadata>\n'
                '<manifest><item href="chap_1.xhtml" id="c1" '
                'media-type="application/xhtml+xml"/></manifest>\n'
                '<spine><itemref idref="c1"/></spine></package>')
            z.writestr("OEBPS/chap_1.xhtml",
                '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
                '<head><title>Chapter 1</title></head><body><h2>Chapter 1</h2>'
                '<p>Once upon a time…</p></body></html>')
        return buf.getvalue()

    def test_template_injects_intro_and_marker(self):
        from routes.books import apply_template_to_epub, SHELFSORT_TEMPLATE_MARKER
        import zipfile
        from io import BytesIO

        raw = self._build_minimal_fff_epub("Templated Test")
        meta = {
            "title": "Templated Test",
            "author": "Ada Lovelace",
            "description": "A story.",
            "chapters": 12,
            "rawExtendedMeta": {
                "status": "complete",
                "datePublished": "2025-01-01",
                "dateUpdated": "2025-06-30",
                "words": 42000,
                "rating": "M",
                "language": "English",
                "reviews": "1,234",
                "favs": "9,001",
                "follows": "555",
            },
        }
        out = apply_template_to_epub(raw, meta, "https://archiveofourown.org/works/777")
        assert isinstance(out, bytes) and len(out) > 0
        assert out != raw  # something changed

        with zipfile.ZipFile(BytesIO(out), "r") as z:
            names = set(z.namelist())
            assert "OEBPS/shelfsort_intro.xhtml" in names
            intro = z.read("OEBPS/shelfsort_intro.xhtml").decode("utf-8")
            # Intro must mirror the template structure
            assert "<h1>Templated Test</h1>" in intro
            assert "<b>By: Ada Lovelace</b>" in intro
            assert "Status: complete" in intro
            assert "Words: 42,000" in intro  # formatted with thousand-separator
            assert "Chapters: 12" in intro
            assert "Published: 2025-01-01" in intro
            assert "Updated: 2025-06-30" in intro
            assert "Fiction M" in intro
            assert "Original source:" in intro
            assert "https://archiveofourown.org/works/777" in intro

            opf = z.read("OEBPS/content.opf").decode("utf-8")
            assert SHELFSORT_TEMPLATE_MARKER in opf
            assert 'id="shelfsort-intro"' in opf
            # Spine must reference the intro BEFORE the original c1
            assert opf.index('idref="shelfsort-intro"') < opf.index('idref="c1"')

            # House stylesheet was added
            css_files = [n for n in names if n.endswith(".css")]
            assert css_files
            css = z.read(css_files[0]).decode("utf-8")
            assert "Verdana" in css

    def test_template_is_idempotent(self):
        """Re-applying the template to an already-templated EPUB is a no-op."""
        from routes.books import apply_template_to_epub
        raw = self._build_minimal_fff_epub("Idem Test")
        meta = {"title": "Idem Test", "author": "X", "rawExtendedMeta": {}}
        once = apply_template_to_epub(raw, meta, "https://x.test/1")
        twice = apply_template_to_epub(once, meta, "https://x.test/1")
        assert twice == once  # exact bytes match → idempotent

    def test_template_returns_original_on_broken_input(self):
        """Malformed EPUB shouldn't blow up — just return the original bytes."""
        from routes.books import apply_template_to_epub
        out = apply_template_to_epub(b"not an epub", {"title": "X"}, "https://x.test/1")
        assert out == b"not an epub"


# ============================================================
# "Apply template to all my books" — retroactive sweep
# ============================================================
class TestApplyTemplateToAll:
    def test_sweep_endpoint(self, uploaded_books):
        from routes.books import STORAGE_DIR
        import zipfile
        from io import BytesIO

        user_dir = STORAGE_DIR / USER_ID
        user_dir.mkdir(parents=True, exist_ok=True)

        # Seed one untemplated EPUB on disk for an existing book
        bid_to_template = uploaded_books[0]["book_id"]
        raw_path = user_dir / f"{bid_to_template}.epub"
        # Build the same minimal EPUB used by TestEpubTemplateApplier
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            info = zipfile.ZipInfo("mimetype")
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, "application/epub+zip")
            z.writestr("META-INF/container.xml",
                '<?xml version="1.0"?>\n<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                'media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr("OEBPS/content.opf",
                '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" '
                'version="3.0" unique-identifier="id"><metadata '
                'xmlns:dc="http://purl.org/dc/elements/1.1/">'
                '<dc:identifier id="id">sweep1</dc:identifier>'
                '<dc:title>Sweep Test</dc:title><dc:language>en</dc:language>'
                '</metadata><manifest><item href="c1.xhtml" id="c1" '
                'media-type="application/xhtml+xml"/></manifest>'
                '<spine><itemref idref="c1"/></spine></package>')
            z.writestr("OEBPS/c1.xhtml",
                '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
                '<head><title>1</title></head><body><p>hi</p></body></html>')
        raw_path.write_bytes(buf.getvalue())

        original_size = raw_path.stat().st_size

        # Fire the sweep
        r = requests.post(f"{BASE}/api/user/apply-template-to-all", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("processed", "templated", "already_templated", "errors", "skipped", "total_in_library"):
            assert key in body
        assert body["processed"] >= 1
        # Our seeded EPUB must have been templated
        assert body["templated"] >= 1

        # File on disk was rewritten and is larger (intro page added)
        new_size = raw_path.stat().st_size
        assert new_size > original_size

        # Re-run is idempotent — nothing should be re-templated
        r2 = requests.post(f"{BASE}/api/user/apply-template-to-all", headers=H())
        body2 = r2.json()
        # The book we just templated now counts as already_templated
        assert body2["already_templated"] >= 1
        # File size unchanged across the second run
        assert raw_path.stat().st_size == new_size

    def test_sweep_requires_auth(self):
        r = requests.post(f"{BASE}/api/user/apply-template-to-all")
        assert r.status_code == 401


# ============================================================
# "Tidy filenames" — backfills book.filename to 'Title_by_Author-id.epub'
# ============================================================
class TestTidyFilenames:
    def test_templated_filename_helper(self):
        from routes.books import _templated_filename
        # Matches the attachment pattern exactly
        out = _templated_filename("A Black Comedy", "nonjon", "book_2F4YtDd3")
        assert out == "A_Black_Comedy_by_nonjon-2F4YtDd3.epub"
        # Spaces, slashes, control chars all sanitized
        out = _templated_filename("Some/Title:With?Bad*chars", "Author Name", "book_id1234567890")
        assert "/" not in out and ":" not in out and "?" not in out and "*" not in out
        assert "_by_" in out
        assert out.endswith(".epub")
        # Missing fields fall back to sensible defaults
        out = _templated_filename(None, None, "")
        assert out == "Untitled_by_Unknown-x.epub"

    def test_tidy_sweep(self, uploaded_books):
        # Mess with one book's filename so we can verify the rename
        bid = uploaded_books[0]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"filename": "wrong_name_xyz.epub"}},
        )
        r = requests.post(f"{BASE}/api/user/tidy-filenames", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("updated", "already_correct", "total"):
            assert key in body
        assert body["updated"] >= 1
        # Verify the targeted book now has the templated filename
        doc = db.books.find_one({"book_id": bid})
        assert doc["filename"].endswith(".epub")
        assert "_by_" in doc["filename"]
        # Re-run is idempotent — already-correct count goes up, no more updates
        r2 = requests.post(f"{BASE}/api/user/tidy-filenames", headers=H())
        body2 = r2.json()
        assert body2["already_correct"] >= 1

    def test_tidy_requires_auth(self):
        r = requests.post(f"{BASE}/api/user/tidy-filenames")
        assert r.status_code == 401

    def test_download_filename_uses_template(self, uploaded_books):
        bid = uploaded_books[0]["book_id"]
        r = requests.get(f"{BASE}/api/books/{bid}/download", headers=H(), stream=True)
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        # The Content-Disposition filename must match the templated pattern
        assert "_by_" in cd
        assert ".epub" in cd


# ============================================================
# Onboarding prompt — first-run template + tidy choice
# ============================================================
class TestOnboardingPrompt:
    def test_status_pending_when_books_exist(self, uploaded_books):
        # Reset dismissed state for this user
        db.users.update_one(
            {"user_id": USER_ID},
            {"$unset": {"template_prompt_dismissed": ""}},
        )
        r = requests.get(f"{BASE}/api/user/onboarding-status", headers=H())
        assert r.status_code == 200
        body = r.json()
        assert body["template_prompt_pending"] is True
        assert body["book_count"] >= 1

    def test_status_not_pending_after_dismiss_decline(self, uploaded_books):
        db.users.update_one(
            {"user_id": USER_ID},
            {"$unset": {"template_prompt_dismissed": ""}},
        )
        r = requests.post(
            f"{BASE}/api/user/dismiss-template-prompt",
            headers=H(),
            json={"accept": False},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["accepted"] is False
        # Status should now report dismissed
        s = requests.get(f"{BASE}/api/user/onboarding-status", headers=H()).json()
        assert s["template_prompt_pending"] is False
        # User doc has the flag
        doc = db.users.find_one({"user_id": USER_ID})
        assert doc["template_prompt_dismissed"] is True
        assert doc["template_prompt_accepted"] is False

    def test_dismiss_accept_runs_both_sweeps(self, uploaded_books):
        from routes.books import STORAGE_DIR
        import zipfile
        from io import BytesIO

        # Reset state
        db.users.update_one(
            {"user_id": USER_ID},
            {"$unset": {"template_prompt_dismissed": ""}},
        )
        # Mess with one book's filename so the rename can be observed
        bid = uploaded_books[1]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"filename": "obviously_wrong.epub"}},
        )

        # Seed an untemplated EPUB on disk so the template sweep has work
        user_dir = STORAGE_DIR / USER_ID
        user_dir.mkdir(parents=True, exist_ok=True)
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            info = zipfile.ZipInfo("mimetype")
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, "application/epub+zip")
            z.writestr("META-INF/container.xml",
                '<?xml version="1.0"?>\n<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                'media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr("OEBPS/content.opf",
                '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" '
                'version="3.0" unique-identifier="id"><metadata '
                'xmlns:dc="http://purl.org/dc/elements/1.1/">'
                '<dc:identifier id="id">onb1</dc:identifier>'
                '<dc:title>Onb Test</dc:title><dc:language>en</dc:language>'
                '</metadata><manifest><item href="c1.xhtml" id="c1" '
                'media-type="application/xhtml+xml"/></manifest>'
                '<spine><itemref idref="c1"/></spine></package>')
            z.writestr("OEBPS/c1.xhtml",
                '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
                '<head><title>1</title></head><body><p>x</p></body></html>')
        (user_dir / f"{bid}.epub").write_bytes(buf.getvalue())

        r = requests.post(
            f"{BASE}/api/user/dismiss-template-prompt",
            headers=H(),
            json={"accept": True},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accepted"] is True
        assert "template" in body and "filenames" in body
        # At least our seeded book was templated, and at least one filename renamed
        assert body["template"]["templated"] >= 1
        assert body["filenames"]["updated"] >= 1
        # And it's idempotent: the next status check says not pending
        s = requests.get(f"{BASE}/api/user/onboarding-status", headers=H()).json()
        assert s["template_prompt_pending"] is False

    def test_status_requires_auth(self):
        r = requests.get(f"{BASE}/api/user/onboarding-status")
        assert r.status_code == 401


# ============================================================
# Upload new version — multipart upload mirrors apply_refresh
# ============================================================
class TestUploadNewVersion:
    def _minimal_epub_bytes(self, title: str = "Manual Upload") -> bytes:
        import zipfile
        from io import BytesIO
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            info = zipfile.ZipInfo("mimetype")
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, "application/epub+zip")
            z.writestr("META-INF/container.xml",
                '<?xml version="1.0"?>\n<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                '<rootfiles><rootfile full-path="OEBPS/content.opf" '
                'media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr("OEBPS/content.opf",
                '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" '
                'version="3.0" unique-identifier="id"><metadata '
                'xmlns:dc="http://purl.org/dc/elements/1.1/">'
                '<dc:identifier id="id">unv1</dc:identifier>'
                f'<dc:title>{title}</dc:title><dc:language>en</dc:language>'
                '</metadata><manifest><item href="c1.xhtml" id="c1" '
                'media-type="application/xhtml+xml"/></manifest>'
                '<spine><itemref idref="c1"/></spine></package>')
            z.writestr("OEBPS/c1.xhtml",
                '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
                '<head><title>1</title></head><body><p>uploaded new version</p></body></html>')
        return buf.getvalue()

    def test_upload_creates_new_book_and_archives_old(self, uploaded_books):
        bid = uploaded_books[0]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {
                "tags": ["keepsake"],
                "source_url": "https://www.fanfiction.net/s/1902191",
                "fandom": "Test",
                "category": "Fanfiction",
                "progress_percent": 0.7,
            }},
        )
        files = {"file": ("fresh.epub", self._minimal_epub_bytes("Fresh"), "application/epub+zip")}
        r = requests.post(
            f"{BASE}/api/books/{bid}/upload-new-version", headers=H(), files=files
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["new_book_id"] and body["new_book_id"] != bid
        assert body["old_book_id"] == bid
        assert body["updated_shelf"].startswith("Updated stories ")

        # Old book is archived with back-pointer
        old = db.books.find_one({"book_id": bid})
        assert old["category"] == "Old stories"
        assert old["replaced_by"] == body["new_book_id"]
        # OLD book's progress (0.7) STAYS on the old book — was not wiped
        assert old["progress_percent"] == 0.7

        # New book exists with carried-over fields
        new = db.books.find_one({"book_id": body["new_book_id"]})
        assert new is not None
        assert new["category"].startswith("Updated stories ")
        assert new["replaces"] == bid
        assert set(new.get("tags", [])) == {"keepsake"}
        assert new["source_url"] == "https://www.fanfiction.net/s/1902191"
        assert new["fandom"] == "Test"
        assert new["classifier"] == "manual_upload"
        assert new.get("manually_uploaded_at")
        assert new.get("update_seen") is False  # bell badge will fire
        # Filename is templated
        assert "_by_" in new["filename"]

    def test_blocks_upload_on_already_archived(self, uploaded_books):
        bid = uploaded_books[1]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"category": "Old stories", "replaced_by": "book_other"}},
        )
        files = {"file": ("x.epub", self._minimal_epub_bytes(), "application/epub+zip")}
        r = requests.post(
            f"{BASE}/api/books/{bid}/upload-new-version", headers=H(), files=files
        )
        assert r.status_code == 400
        assert "archived" in r.json()["detail"].lower()

    def test_upload_rejects_non_epub(self, uploaded_books):
        # Seed our own book — earlier tests delete uploaded_books[2]
        bid = f"book_unv_n_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_ID, "book_id": bid,
            "title": "x", "author": "y", "category": "Fanfiction",
        })
        files = {"file": ("not.txt", b"hello world", "text/plain")}
        r = requests.post(
            f"{BASE}/api/books/{bid}/upload-new-version", headers=H(), files=files
        )
        assert r.status_code == 400

    def test_upload_rejects_garbage_bytes(self, uploaded_books):
        bid = f"book_unv_g_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": USER_ID, "book_id": bid,
            "title": "x", "author": "y", "category": "Fanfiction",
        })
        files = {"file": ("fake.epub", b"this is not actually a zip file", "application/epub+zip")}
        r = requests.post(
            f"{BASE}/api/books/{bid}/upload-new-version", headers=H(), files=files
        )
        assert r.status_code == 400

    def test_upload_404_for_unknown_book(self):
        files = {"file": ("x.epub", self._minimal_epub_bytes(), "application/epub+zip")}
        r = requests.post(
            f"{BASE}/api/books/book_does_not_exist/upload-new-version",
            headers=H(),
            files=files,
        )
        assert r.status_code == 404


# ============================================================
# Links export — ZIP format with one folder per fanfic
# ============================================================
class TestLinksExportByFolder:
    def test_default_format_still_txt(self, uploaded_books):
        r = requests.get(f"{BASE}/api/books/export/links", headers=H())
        assert r.status_code == 200, r.text
        assert "text/plain" in r.headers.get("content-type", "")
        assert "Shelfsort — links extracted from" in r.text

    def test_zip_format_returns_zip_with_one_txt_per_fandom(self, uploaded_books):
        import zipfile
        from io import BytesIO
        # Seed 3 books across 2 fandoms so we can verify grouping
        for i, bid_idx in enumerate(uploaded_books[:2]):
            db.books.update_one(
                {"book_id": bid_idx["book_id"]},
                {"$set": {"category": "Fanfiction", "fandom": "ZipGroupHP"}},
            )
        # And one more on a different fandom
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": f"book_zg_{uuid.uuid4().hex[:8]}",
            "title": "Borg Encounter",
            "author": "Trekkie",
            "category": "Fanfiction",
            "fandom": "ZipGroupStarTrek",
        })

        r = requests.get(f"{BASE}/api/books/export/links?format=zip", headers=H())
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type") == "application/zip"
        zf = zipfile.ZipFile(BytesIO(r.content))
        names = zf.namelist()
        assert "README.txt" in names
        # Top-level .txt files only (no nested folders any more) — one per fandom
        per_bucket = [n for n in names if n != "README.txt"]
        for n in per_bucket:
            assert n.endswith(".txt"), f"expected top-level fandom .txt, got {n}"
            assert "/" not in n, f"expected flat .txt files, got nested: {n}"
        # Both seeded fandoms must appear as their own .txt
        assert "ZipGroupHP.txt" in names
        assert "ZipGroupStarTrek.txt" in names
        # The HP txt must contain BOTH of our HP books (grouped together)
        hp_content = zf.read("ZipGroupHP.txt").decode("utf-8")
        # Read the current titles from DB (other tests may have renamed them)
        for b_fixture in uploaded_books[:2]:
            current = db.books.find_one({"book_id": b_fixture["book_id"]})
            assert current["title"] in hp_content
        # Star Trek txt has the one Borg fic
        st_content = zf.read("ZipGroupStarTrek.txt").decode("utf-8")
        assert "Borg Encounter" in st_content

    def test_zip_format_respects_fandom_filter(self, uploaded_books):
        # Tag one book with a known fandom so we can filter
        bid = uploaded_books[0]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"category": "Fanfiction", "fandom": "ZipFilterTestFandom"}},
        )
        import zipfile
        from io import BytesIO
        r = requests.get(
            f"{BASE}/api/books/export/links?format=zip&fandom=ZipFilterTestFandom",
            headers=H(),
        )
        assert r.status_code == 200
        zf = zipfile.ZipFile(BytesIO(r.content))
        non_readme = [n for n in zf.namelist() if n != "README.txt"]
        # Filter result: only the fandom-named .txt should appear
        assert non_readme == ["ZipFilterTestFandom.txt"]

    def test_xlsx_format_one_sheet_per_fandom(self, uploaded_books):
        from openpyxl import load_workbook
        from io import BytesIO
        # Seed two distinct fandoms
        db.books.update_one(
            {"book_id": uploaded_books[0]["book_id"]},
            {"$set": {
                "category": "Fanfiction",
                "fandom": "XLSXFandomA",
                "source_url": "https://archiveofourown.org/works/123",
                "words": 12345,
                "progress_percent": 0.42,
            }},
        )
        db.books.insert_one({
            "user_id": USER_ID,
            "book_id": f"book_xlb_{uuid.uuid4().hex[:8]}",
            "title": "XLSX-only book",
            "author": "Author B",
            "category": "Fanfiction",
            "fandom": "XLSXFandomB",
            "source_url": "https://example.com/x",
            "words": 5000,
            "chapters": 3,
        })

        r = requests.get(f"{BASE}/api/books/export/links?format=xlsx", headers=H())
        assert r.status_code == 200, r.text
        assert (
            r.headers.get("content-type")
            == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert ".xlsx" in r.headers.get("content-disposition", "")

        wb = load_workbook(BytesIO(r.content), data_only=True)
        # Summary sheet always present
        assert "Summary" in wb.sheetnames
        # Both fandoms get their own sheet
        assert "XLSXFandomA" in wb.sheetnames
        assert "XLSXFandomB" in wb.sheetnames
        # Header row + data row layout — exactly four columns in this order
        ws = wb["XLSXFandomA"]
        headers = [c.value for c in ws[1]]
        assert headers == ["Title", "Author", "Fandom", "Source URL"]
        # First data row contains our seeded values
        row2 = {h: ws.cell(row=2, column=i + 1).value for i, h in enumerate(headers)}
        assert row2["Fandom"] == "XLSXFandomA"
        assert row2["Source URL"] == "https://archiveofourown.org/works/123"
        assert row2["Title"]  # whatever upload fixture set it to
        assert row2["Author"]

    def test_xlsx_format_respects_fandom_filter(self, uploaded_books):
        from openpyxl import load_workbook
        from io import BytesIO
        bid = uploaded_books[0]["book_id"]
        db.books.update_one(
            {"book_id": bid},
            {"$set": {"category": "Fanfiction", "fandom": "XLSXOnlyMe"}},
        )
        r = requests.get(
            f"{BASE}/api/books/export/links?format=xlsx&fandom=XLSXOnlyMe", headers=H()
        )
        assert r.status_code == 200
        wb = load_workbook(BytesIO(r.content), data_only=True)
        # Summary + just the filtered fandom
        assert set(wb.sheetnames) == {"Summary", "XLSXOnlyMe"}
