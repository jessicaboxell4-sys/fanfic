"""Iteration 86 — regression tests for two prod bugs after cleanup toolkit deploy.

Covers:
  Bug 1: /admin/my-library-diagnostics duplicates.excess must be 0 when the
         only "duplicate-looking" books are Old stories / duplicate_pending /
         have replaced_by set (i.e., the same exclusions rescan uses).
  Bug 2: POST /api/books/reclassify-all now hydrates R2-only books via
         ensure_local_cached before classifying. Verify: happy-path with local
         .epub returns processed>0 and doesn't crash; empty library returns
         {processed:0, changed:0}; the hydration branch doesn't crash when
         ensure_local_cached returns False.
  Regression:
    - GET /api/books/{book_id}/links still returns 200 when a local .epub +
      links sidecar exist (happy path unchanged).
  Import/boot sanity:
    - server.py + modified route modules import without ImportError.

Falls back to http://localhost:8001 if the preview URL 502s (proven pattern
from iteration_85).
"""
from __future__ import annotations

import os
import uuid
import shutil
import zipfile
import io
from pathlib import Path

import pytest
import requests


PREVIEW_URL = "https://drift-check-live.preview.emergentagent.com"
LOCAL_URL = "http://localhost:8001"


def _pick_base_url() -> str:
    for u in (os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/"), PREVIEW_URL, LOCAL_URL):
        if not u:
            continue
        try:
            r = requests.get(f"{u}/api/health", timeout=4)
            if r.status_code < 500:
                return u
        except Exception:
            continue
    return LOCAL_URL


BASE_URL = _pick_base_url()
ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"
STORAGE_DIR = Path("/app/uploads")

TEST_PREFIX = "TEST_ITER86_"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def admin_session():
    """Return an authenticated requests.Session for the admin account."""
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed ({r.status_code}): {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def admin_uid(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200, r.text
    return r.json().get("user_id")


@pytest.fixture(scope="module")
def db():
    """Direct Mongo handle for seed/cleanup (matches iter85 pattern)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import os as _os

    mongo_url = _os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
    db_name = _os.environ.get("DB_NAME") or "test_database"
    client = AsyncIOMotorClient(mongo_url)
    yield client[db_name]
    client.close()


@pytest.fixture(autouse=True)
def _cleanup(admin_uid, db):
    """Wipe TEST_ITER86_ prefixed books before + after every test for isolation."""
    import asyncio

    async def _wipe():
        await db.books.delete_many({
            "user_id": admin_uid,
            "book_id": {"$regex": f"^{TEST_PREFIX}"},
        })
    asyncio.get_event_loop().run_until_complete(_wipe())
    yield
    asyncio.get_event_loop().run_until_complete(_wipe())
    # Also clean any test files we dropped on disk
    user_dir = STORAGE_DIR / admin_uid
    if user_dir.exists():
        for p in user_dir.glob(f"{TEST_PREFIX}*"):
            try:
                p.unlink()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_minimal_epub(path: Path, title: str = "Test", author: str = "TestAuthor") -> None:
    """Write a tiny but valid EPUB (mimetype + container + content.opf + one xhtml)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        # mimetype MUST be first and uncompressed
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, "application/epub+zip")
        z.writestr("META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
            '</container>'
        )
        z.writestr("OEBPS/content.opf",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:identifier id="bookid">urn:uuid:{uuid.uuid4()}</dc:identifier>'
            f'<dc:title>{title}</dc:title>'
            f'<dc:creator>{author}</dc:creator>'
            '<dc:language>en</dc:language>'
            '</metadata>'
            '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="c1"/></spine>'
            '</package>'
        )
        z.writestr("OEBPS/c1.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head>'
            '<body><p>Sample chapter body. Visit https://example.com/ for more.</p></body></html>'
        )


def _seed_book(db, admin_uid, *, book_id: str, category: str = "Unclassified",
               extra: dict | None = None) -> None:
    import asyncio
    from datetime import datetime, timezone

    doc = {
        "book_id": book_id,
        "user_id": admin_uid,
        "title": f"Iter86 Title {book_id[-6:]}",
        "author": "TestAuthor",
        "category": category,
        "fandom": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        doc.update(extra)

    async def _ins():
        await db.books.insert_one(doc)
    asyncio.get_event_loop().run_until_complete(_ins())


# ---------------------------------------------------------------------------
# Bug 1: Diagnostic excess count excludes Old stories / duplicate_pending / replaced_by
# ---------------------------------------------------------------------------

class TestDiagnosticExcessExcludes:

    def test_no_excess_when_dup_group_all_in_old_stories(self, admin_session, admin_uid, db):
        """Two books with same title+author but BOTH in 'Old stories' → excess=0."""
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}old_a",
                   category="Old stories",
                   extra={"title": "Shared Title", "author": "SameAuthor"})
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}old_b",
                   category="Old stories",
                   extra={"title": "Shared Title", "author": "SameAuthor"})
        r = admin_session.get(f"{BASE_URL}/api/admin/my-library-diagnostics", timeout=20)
        assert r.status_code == 200, r.text
        dupes = r.json()["duplicates"]
        assert dupes["excess"] == 0, f"expected 0 excess (both Old stories), got {dupes}"
        assert dupes["groups"] == 0

    def test_no_excess_when_dup_pending(self, admin_session, admin_uid, db):
        """Two dup_pending books → excluded, so excess=0."""
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}pend_a",
                   category="Fanfiction",
                   extra={"title": "Pending Dup", "author": "SameAuth",
                          "duplicate_pending": True})
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}pend_b",
                   category="Fanfiction",
                   extra={"title": "Pending Dup", "author": "SameAuth",
                          "duplicate_pending": True})
        r = admin_session.get(f"{BASE_URL}/api/admin/my-library-diagnostics", timeout=20)
        assert r.status_code == 200
        dupes = r.json()["duplicates"]
        assert dupes["excess"] == 0, dupes

    def test_no_excess_when_replaced_by_set(self, admin_session, admin_uid, db):
        """Books already promoted (replaced_by set) are excluded — no phantom dupe."""
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}rep_a",
                   category="Fanfiction",
                   extra={"title": "Replaced Book", "author": "AuthR",
                          "replaced_by": f"{TEST_PREFIX}rep_b"})
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}rep_b",
                   category="Fanfiction",
                   extra={"title": "Replaced Book", "author": "AuthR",
                          "replaced_by": "some_winner"})
        r = admin_session.get(f"{BASE_URL}/api/admin/my-library-diagnostics", timeout=20)
        assert r.status_code == 200
        dupes = r.json()["duplicates"]
        assert dupes["excess"] == 0, dupes

    def test_still_counts_real_duplicates(self, admin_session, admin_uid, db):
        """Positive control — two real active dupes should surface excess=1."""
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}real_a",
                   category="Fanfiction",
                   extra={"title": "Real Dup Title", "author": "RealAuth"})
        _seed_book(db, admin_uid, book_id=f"{TEST_PREFIX}real_b",
                   category="Fanfiction",
                   extra={"title": "Real Dup Title", "author": "RealAuth"})
        r = admin_session.get(f"{BASE_URL}/api/admin/my-library-diagnostics", timeout=20)
        assert r.status_code == 200
        dupes = r.json()["duplicates"]
        assert dupes["excess"] >= 1, dupes
        assert dupes["groups"] >= 1


# ---------------------------------------------------------------------------
# Bug 2: reclassify-all hydrates from R2 and doesn't crash
# ---------------------------------------------------------------------------

class TestReclassifyAllHydration:

    def test_empty_library_returns_zeros(self, admin_session, admin_uid, db):
        # Cleanup removed anything TEST_ITER86_; ensure endpoint returns
        # 0/0 (or a normal count for the real library) without crashing.
        r = admin_session.post(
            f"{BASE_URL}/api/books/reclassify-all",
            json={"only_unclassified": True, "category": None, "fandom": None},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "processed" in data and "changed" in data
        assert isinstance(data["processed"], int)
        assert isinstance(data["changed"], int)

    def test_happy_path_with_local_epub(self, admin_session, admin_uid, db):
        """Seed an Unclassified book with a real local .epub → reclassify processes it."""
        book_id = f"{TEST_PREFIX}reclass_{uuid.uuid4().hex[:6]}"
        epub = STORAGE_DIR / admin_uid / f"{book_id}.epub"
        _make_minimal_epub(epub, title="Iter86 Local Epub", author="Local Author")
        _seed_book(db, admin_uid, book_id=book_id, category="Unclassified")

        r = admin_session.post(
            f"{BASE_URL}/api/books/reclassify-all",
            json={"only_unclassified": True},
            timeout=120,  # AI classifier can take a while
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Happy path: at least one book processed (our seed), no crash.
        assert data["processed"] >= 1, data
        # `changed` may be 0 if classifier confidence <= 0, but must not crash.
        assert data["changed"] >= 0

    def test_hydration_branch_no_crash_when_r2_returns_false(self, admin_session, admin_uid, db):
        """Seed a book with NO local .epub. ensure_local_cached will fail
        (no R2 config in preview) → the endpoint should skip cleanly, not crash."""
        book_id = f"{TEST_PREFIX}nofile_{uuid.uuid4().hex[:6]}"
        # Make sure no sidecar exists on disk
        epub = STORAGE_DIR / admin_uid / f"{book_id}.epub"
        if epub.exists():
            epub.unlink()
        _seed_book(db, admin_uid, book_id=book_id, category="Unclassified")

        r = admin_session.post(
            f"{BASE_URL}/api/books/reclassify-all",
            json={"only_unclassified": True},
            timeout=60,
        )
        # Must NOT be 500; the hydration branch's try/except must swallow.
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["processed"] >= 1  # the seeded book still counts as attempted
        # `changed` for this specific book should be 0 (skipped), but other
        # real unclassified books may still succeed → just assert it's an int.
        assert isinstance(data["changed"], int)


# ---------------------------------------------------------------------------
# Regression: GET /books/{book_id}/links happy path when local epub exists
# ---------------------------------------------------------------------------

class TestBookLinksHappyPath:

    def test_links_endpoint_returns_200_with_local_epub(self, admin_session, admin_uid, db):
        book_id = f"{TEST_PREFIX}links_{uuid.uuid4().hex[:6]}"
        epub = STORAGE_DIR / admin_uid / f"{book_id}.epub"
        _make_minimal_epub(epub, title="Links Test Book")
        _seed_book(db, admin_uid, book_id=book_id, category="Fanfiction",
                   extra={"title": "Links Test Book", "author": "LinksAuth"})

        r = admin_session.get(f"{BASE_URL}/api/books/{book_id}/links", timeout=30)
        assert r.status_code == 200, r.text
        # Response is a text/plain file — the http path returns a body.
        assert "text/plain" in r.headers.get("content-type", "")
        assert len(r.content) > 0


# ---------------------------------------------------------------------------
# Import / boot sanity
# ---------------------------------------------------------------------------

class TestImportSanity:

    def test_all_modified_modules_import(self):
        """All modified route modules must import without ImportError."""
        import importlib, sys
        # Force-reload so any lingering broken state surfaces here rather
        # than reusing a previously-cached module object.
        for name in [
            "server",
            "routes.admin",
            "routes.bulk_ops",
            "routes.books",
            "routes.user_prefs",
            "utils.storage_cloud",
        ]:
            mod = importlib.import_module(name)
            assert mod is not None
            # Sanity: reload once so a broken syntax edit would blow up here.
            importlib.reload(sys.modules[name])

    def test_ensure_local_cached_is_sync(self):
        """Regression guard — routes call this via asyncio.to_thread. If it
        gets accidentally made async, the to_thread call would silently
        return a coroutine and never hydrate the file."""
        import inspect
        from utils.storage_cloud import ensure_local_cached
        assert not inspect.iscoroutinefunction(ensure_local_cached)

    def test_backend_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
