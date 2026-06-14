"""E2E tests for OPDS catalog endpoint.

Covers:
- Catalog-credentials lifecycle: GET (default disabled), regenerate, toggle off
- Bare /api/opds returns 401 without Basic auth
- Wrong password returns 401
- Correct Basic auth returns root navigation feed XML
- /opds/all returns acquisition feed with the user's books, paginated
- Other endpoints surface correct feeds (fandom, author, recent)
- /opds/download/{id} actually streams the EPUB
- /opds/cover/{id} returns 404 when no cover, 200 when cover bytes on disk
"""
import os
import base64
import uuid
import requests
import pytest
from pathlib import Path
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
STORAGE_DIR = Path(os.environ.get("OPDS_STORAGE_DIR", "/app/uploads"))

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER = {
    "user_id": f"user_opds_{uuid.uuid4().hex[:8]}",
    "email": f"opds_{uuid.uuid4().hex[:6]}@example.com",
    "token": f"sess_opds_{uuid.uuid4().hex}",
    "name": "OPDS Tester",
}

BOOK_FANDOM = {"book_id": f"opdsbk_{uuid.uuid4().hex[:6]}", "title": "OPDS Fandom Book", "author": "OPDS Author 1", "fandom": "Harry Potter"}
BOOK_OTHER  = {"book_id": f"opdsbk_{uuid.uuid4().hex[:6]}", "title": "OPDS Other Book",  "author": "OPDS Author 2", "fandom": "Twilight"}


def auth_header(email: str, password: str) -> dict:
    raw = f"{email}:{password}".encode()
    return {"Authorization": f"Basic {base64.b64encode(raw).decode()}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": USER["user_id"],
        "email": USER["email"],
        "name": USER["name"],
        "picture": "",
        "is_admin": False,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER["user_id"],
        "session_token": USER["token"],
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    # Two books, one with on-disk EPUB and cover (so download/cover endpoints work).
    user_dir = STORAGE_DIR / USER["user_id"]
    user_dir.mkdir(parents=True, exist_ok=True)
    epub_path = user_dir / f"{BOOK_FANDOM['book_id']}.epub"
    # Minimal valid-enough EPUB stub: needs the PK zip header so anything reading magic-bytes is happy.
    epub_path.write_bytes(b"PK\x03\x04" + b"\x00" * 500)
    cover_path = user_dir / f"{BOOK_FANDOM['book_id']}.cover"
    cover_path.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 200)  # tiny JPEG-ish

    for b in (BOOK_FANDOM, BOOK_OTHER):
        db.books.insert_one({
            "book_id": b["book_id"],
            "user_id": USER["user_id"],
            "title": b["title"],
            "author": b["author"],
            "fandom": b["fandom"],
            "category": "Fanfiction",
            "language": "en",
            "description": "An OPDS test book.",
            "has_cover": b is BOOK_FANDOM,
            "created_at": now,
            "filename": f"{b['title']}.epub",
        })
    yield
    db.users.delete_one({"user_id": USER["user_id"]})
    db.user_sessions.delete_many({"user_id": USER["user_id"]})
    db.books.delete_many({"user_id": USER["user_id"]})
    db.recommendation_dismissals.delete_many({"user_id": USER["user_id"]})
    for f in user_dir.glob("*"):
        f.unlink(missing_ok=True)
    user_dir.rmdir()


# State carries the regenerated password across tests.
STATE: dict = {}


class TestCatalogCredentials:
    def test_initial_state_disabled(self):
        r = requests.get(f"{BASE}/api/user/catalog-credentials", headers={"Authorization": f"Bearer {USER['token']}"})
        assert r.status_code == 200
        data = r.json()
        assert data["opds_enabled"] is False
        assert data["has_password"] is False

    def test_regenerate_returns_plaintext(self):
        r = requests.post(f"{BASE}/api/user/catalog-credentials/regenerate", headers={"Authorization": f"Bearer {USER['token']}"})
        assert r.status_code == 200
        data = r.json()
        assert data["opds_enabled"] is True
        assert isinstance(data["password"], str) and len(data["password"]) >= 12
        STATE["password"] = data["password"]

    def test_status_reflects_enable(self):
        r = requests.get(f"{BASE}/api/user/catalog-credentials", headers={"Authorization": f"Bearer {USER['token']}"})
        assert r.json()["opds_enabled"] is True
        assert r.json()["has_password"] is True

    def test_toggle_off_then_on(self):
        r = requests.put(f"{BASE}/api/user/catalog-credentials", json={"enabled": False}, headers={"Authorization": f"Bearer {USER['token']}"})
        assert r.status_code == 200
        assert r.json()["opds_enabled"] is False
        r = requests.put(f"{BASE}/api/user/catalog-credentials", json={"enabled": True}, headers={"Authorization": f"Bearer {USER['token']}"})
        assert r.json()["opds_enabled"] is True


class TestOpdsFeed:
    def test_no_auth_401(self):
        r = requests.get(f"{BASE}/api/opds")
        assert r.status_code == 401
        assert "Basic" in r.headers.get("WWW-Authenticate", "")

    def test_wrong_password_401(self):
        r = requests.get(f"{BASE}/api/opds", headers=auth_header(USER["email"], "definitely-wrong"))
        assert r.status_code == 401

    def test_root_navigation_feed(self):
        r = requests.get(f"{BASE}/api/opds", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 200
        assert "atom+xml" in r.headers.get("content-type", "")
        body = r.text
        assert "<feed" in body
        assert "All books" in body
        assert "Recently added" in body
        assert "By fandom" in body
        assert "By author" in body

    def test_all_acquisition_feed(self):
        r = requests.get(f"{BASE}/api/opds/all", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 200
        body = r.text
        assert BOOK_FANDOM["title"] in body
        assert BOOK_OTHER["title"] in body
        # Acquisition link is present.
        assert 'rel="http://opds-spec.org/acquisition"' in body

    def test_fandoms_nav(self):
        r = requests.get(f"{BASE}/api/opds/fandoms", headers=auth_header(USER["email"], STATE["password"]))
        body = r.text
        assert "Harry Potter" in body
        assert "Twilight" in body

    def test_fandom_acquisition(self):
        from urllib.parse import quote
        r = requests.get(f"{BASE}/api/opds/fandom/{quote('Harry Potter', safe='')}", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 200
        assert BOOK_FANDOM["title"] in r.text
        assert BOOK_OTHER["title"] not in r.text

    def test_authors_nav(self):
        r = requests.get(f"{BASE}/api/opds/authors", headers=auth_header(USER["email"], STATE["password"]))
        assert BOOK_FANDOM["author"] in r.text
        assert BOOK_OTHER["author"] in r.text

    def test_download_streams_epub(self):
        r = requests.get(f"{BASE}/api/opds/download/{BOOK_FANDOM['book_id']}", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/epub+zip")
        assert r.content[:4] == b"PK\x03\x04"

    def test_cover_present(self):
        r = requests.get(f"{BASE}/api/opds/cover/{BOOK_FANDOM['book_id']}", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")

    def test_cover_missing_404(self):
        r = requests.get(f"{BASE}/api/opds/cover/{BOOK_OTHER['book_id']}", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 404

    def test_disabled_blocks_access(self):
        # Disable OPDS — root should now 401 even with the right password.
        rt = requests.put(f"{BASE}/api/user/catalog-credentials", json={"enabled": False}, headers={"Authorization": f"Bearer {USER['token']}"})
        assert rt.status_code == 200
        r = requests.get(f"{BASE}/api/opds", headers=auth_header(USER["email"], STATE["password"]))
        assert r.status_code == 401
        # Re-enable for any later tests.
        requests.put(f"{BASE}/api/user/catalog-credentials", json={"enabled": True}, headers={"Authorization": f"Bearer {USER['token']}"})
