"""Iteration 28 - Help-page feedback / admin scoping regression tests.

Validates:
- POST /api/feedback returns 200 for text-only valid submissions
- POST /api/feedback returns 413 + {detail:'photo_too_large'} for >5MB image
- POST /api/feedback returns 400 + {detail:'not_an_image'} for non-image content_type
- GET /api/admin/feedback list returns only rows with `text` (no legacy /api/suggestions rows)
- GET /api/admin/feedback/by-page aggregation returns only Help-page rows; includes /library
"""
import io
import os
import pytest
import requests

_BU = os.environ.get("REACT_APP_BACKEND_URL")
if not _BU:
    # fall back to frontend/.env (kept out of pytest env)
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    _BU = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except FileNotFoundError:
        pass
assert _BU, "REACT_APP_BACKEND_URL is not configured"
BASE_URL = _BU.rstrip("/")
ADMIN_EMAIL = "shelfsort-tester@example.com"
ADMIN_PASS = "tester123!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
               timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


# ---- /api/feedback writer ----

class TestFeedbackWriter:
    def test_text_only_ok(self, admin_session):
        fd = {"text": (None, "TEST_iter28 regression text-only " + os.urandom(4).hex()),
              "page": (None, "/library")}
        r = admin_session.post(f"{BASE_URL}/api/feedback", files=fd, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True

    def test_photo_too_large_returns_413(self, admin_session):
        # Make a 6 MB "image" blob — backend reads size before MIME validation order matters
        big = b"\x89PNG\r\n\x1a\n" + os.urandom(6 * 1024 * 1024)
        files = {
            "text": (None, "TEST_iter28 oversize photo"),
            "page": (None, "/library"),
            "photo": ("big.png", io.BytesIO(big), "image/png"),
        }
        r = admin_session.post(f"{BASE_URL}/api/feedback", files=files, timeout=30)
        assert r.status_code == 413, f"expected 413 got {r.status_code} body={r.text[:200]}"
        body = r.json()
        assert body.get("detail") == "photo_too_large", body

    def test_non_image_returns_400(self, admin_session):
        files = {
            "text": (None, "TEST_iter28 non-image"),
            "page": (None, "/library"),
            "photo": ("evil.txt", io.BytesIO(b"hello world this is not an image"), "text/plain"),
        }
        r = admin_session.post(f"{BASE_URL}/api/feedback", files=files, timeout=20)
        assert r.status_code == 400, f"expected 400 got {r.status_code} body={r.text[:200]}"
        body = r.json()
        assert body.get("detail") == "not_an_image", body


# ---- /api/admin/feedback readers (legacy discrimination) ----

class TestAdminFeedbackScope:
    def test_list_open_returns_only_text_rows(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/feedback",
                              params={"status": "open", "limit": 100}, timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        assert isinstance(rows, list)
        # Every row must carry the Help-page shape — `text` field present + non-null.
        for row in rows:
            assert "text" in row and row["text"] is not None, f"legacy row leaked: {row}"
            # Should NOT carry the legacy /api/suggestions product-board fields as the only content.
            # (rows may incidentally have unrelated extras, but must always have `text`)
        # And the writer test_text_only_ok above must have inserted at least one row.
        assert len(rows) >= 1, "expected at least one help-page feedback row"

    def test_list_status_all_works(self, admin_session):
        # Empty status should also discriminate to text rows only.
        r = admin_session.get(f"{BASE_URL}/api/admin/feedback",
                              params={"status": "", "limit": 100}, timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        for row in rows:
            assert row.get("text") is not None

    def test_by_page_aggregation(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/feedback/by-page",
                              params={"status": "open", "limit": 30}, timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        assert isinstance(rows, list) and len(rows) >= 1
        # /library should be among the seeded pages (3+ entries per the review request)
        pages = {row.get("page"): row for row in rows}
        assert "/library" in pages, f"expected /library in by-page, got {list(pages)}"
        # Each row must have count / page (no legacy projection)
        for row in rows:
            assert "count" in row and isinstance(row["count"], int)
            assert "page" in row

    def test_page_filter(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/feedback",
                              params={"status": "open", "page": "/library", "limit": 50},
                              timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        assert len(rows) >= 1
        for row in rows:
            assert row.get("page") == "/library", row
            assert row.get("text") is not None
