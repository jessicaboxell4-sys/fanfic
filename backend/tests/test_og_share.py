"""Tests for the OG / Twitter Card preview endpoints added 2026-06-16.

Covered endpoints:
- GET /api/og/yib/{token}            → HTML stub with OG + Twitter meta + redirect
- GET /api/og/yib/{token}/image.png  → 1200×630 PNG (Pillow-rendered)
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_og_{uuid.uuid4().hex[:8]}"
SESSION = f"sess_og_{uuid.uuid4().hex}"
USER_EMAIL = f"{USER_ID}@example.com"
YEAR = 2025


def H():
    return {"Authorization": f"Bearer {SESSION}"}


@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": USER_EMAIL,
        "name": "OG Tester",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": USER_ID,
        "session_token": SESSION,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    bid = f"book_og_{uuid.uuid4().hex[:8]}"
    db.books.insert_one({
        "book_id": bid,
        "user_id": USER_ID,
        "title": "OG Book",
        "author": "OG Author",
        "fandom": "Harry Potter",
        "category": "Fanfiction",
        "progress_fraction": 0.99,
        "page_count": 220,
        "last_opened_at": f"{YEAR}-04-12T10:00:00+00:00",
        "created_at": f"{YEAR}-01-01T10:00:00+00:00",
    })
    db.reading_activity.insert_one({
        "user_id": USER_ID,
        "date": f"{YEAR}-04-12",
        "book_ids": [bid],
    })
    # Mint a share token via the API
    r = requests.post(f"{BASE}/api/year-in-books/{YEAR}/share", headers=H())
    assert r.status_code == 200, r.text
    yield r.json()["token"]
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.reading_activity.delete_many({"user_id": USER_ID})
    db.year_in_books_shares.delete_many({"user_id": USER_ID})


class TestOgPreview:
    def test_html_preview_returns_og_meta(self, seed_user):
        token = seed_user
        r = requests.get(f"{BASE}/api/og/yib/{token}")
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("text/html")
        html = r.text
        # All canonical OG tags present
        assert 'property="og:title"' in html
        assert 'property="og:description"' in html
        assert 'property="og:image"' in html
        assert 'property="og:image:width" content="1200"' in html
        assert 'property="og:image:height" content="630"' in html
        # Twitter card
        assert 'name="twitter:card" content="summary_large_image"' in html
        assert 'name="twitter:image"' in html
        # Year shows up in title
        assert str(YEAR) in html
        # Display name in og:image:alt
        assert "OG Tester" in html
        # Browser redirect to React route is wired
        assert f"/share/yib/{token}" in html
        assert "http-equiv=\"refresh\"" in html

    def test_html_preview_email_not_leaked(self, seed_user):
        token = seed_user
        r = requests.get(f"{BASE}/api/og/yib/{token}")
        assert r.status_code == 200
        assert USER_EMAIL not in r.text, "Owner email leaked into public OG HTML!"

    def test_html_preview_404_on_bad_token(self):
        r = requests.get(f"{BASE}/api/og/yib/not_a_real_token_xxxxxxxxx")
        assert r.status_code == 404

    def test_image_returns_png(self, seed_user):
        token = seed_user
        r = requests.get(f"{BASE}/api/og/yib/{token}/image.png")
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type") == "image/png"
        # Reasonable size — Pillow gradient + text is comfortably 30–200 KB
        assert 10_000 < len(r.content) < 500_000
        # PNG magic number
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_image_404_on_bad_token(self):
        r = requests.get(f"{BASE}/api/og/yib/totally_fake_token/image.png")
        assert r.status_code == 404

    def test_image_after_revoke_returns_404(self, seed_user):
        token = seed_user
        # Confirm currently 200
        r = requests.get(f"{BASE}/api/og/yib/{token}/image.png")
        assert r.status_code == 200
        # Revoke
        rev = requests.delete(f"{BASE}/api/year-in-books/{YEAR}/share", headers=H())
        assert rev.status_code == 200
        # Now 404
        r2 = requests.get(f"{BASE}/api/og/yib/{token}/image.png")
        assert r2.status_code == 404
        r3 = requests.get(f"{BASE}/api/og/yib/{token}")
        assert r3.status_code == 404
