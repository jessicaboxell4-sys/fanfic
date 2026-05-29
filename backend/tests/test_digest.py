"""Tests for Weekly Reading Digest feature + regression of existing endpoints.

Covers:
- GET /api/user/digest-settings (fresh user defaults)
- PUT /api/user/digest-settings (full + partial updates + validation)
- POST /api/user/digest-preview (delivered=false logged=true path when RESEND_API_KEY="")
- Scheduler startup log line in backend.err.log
- Regression: /api/auth/me, /api/books, /api/stats/overview, /api/stats/detailed,
  /api/authors, /api/books/bulk/metadata, /api/books/bulk/move, /api/books/bulk/delete,
  /api/series, /api/auth/profile (PUT name change)
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def seeded_user():
    uid = f"user_dig_{uuid.uuid4().hex[:8]}"
    token = f"sess_dig_{uuid.uuid4().hex}"
    email = f"{uid}@example.com"
    db.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": "Digest User",
        "picture": "",
        "password_hash": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield {"user_id": uid, "token": token, "email": email}
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.books.delete_many({"user_id": uid})


@pytest.fixture
def H(seeded_user):
    return {"Authorization": f"Bearer {seeded_user['token']}"}


# ---------- DIGEST: GET defaults ----------
class TestDigestSettingsGet:
    def test_fresh_user_defaults(self, H):
        r = requests.get(f"{BASE}/api/user/digest-settings", headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["enabled"] is False
        assert d["day_of_week"] == 6
        assert d["hour"] == 8
        assert d["last_sent_at"] is None
        assert "email_configured" in d
        assert isinstance(d["email_configured"], bool)


# ---------- DIGEST: PUT (full + partial + validation) ----------
class TestDigestSettingsPut:
    def test_full_update_persists(self, H):
        body = {"enabled": True, "day_of_week": 2, "hour": 14}
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json=body)
        assert r.status_code == 200, r.text
        echo = r.json()
        assert echo["enabled"] is True
        assert echo["day_of_week"] == 2
        assert echo["hour"] == 14
        # Verify via GET
        g = requests.get(f"{BASE}/api/user/digest-settings", headers=H).json()
        assert g["enabled"] is True
        assert g["day_of_week"] == 2
        assert g["hour"] == 14

    def test_partial_update_only_enabled(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"enabled": False})
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/user/digest-settings", headers=H).json()
        # enabled flipped, other fields preserved
        assert g["enabled"] is False
        assert g["day_of_week"] == 2
        assert g["hour"] == 14

    def test_partial_update_only_hour(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"hour": 9})
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/user/digest-settings", headers=H).json()
        assert g["hour"] == 9
        assert g["day_of_week"] == 2  # preserved
        assert g["enabled"] is False  # preserved

    def test_partial_update_only_day(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"day_of_week": 0})
        assert r.status_code == 200
        g = requests.get(f"{BASE}/api/user/digest-settings", headers=H).json()
        assert g["day_of_week"] == 0
        assert g["hour"] == 9  # preserved

    def test_invalid_day_of_week_7(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"day_of_week": 7})
        assert r.status_code == 400, r.text

    def test_invalid_day_of_week_negative(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"day_of_week": -1})
        assert r.status_code == 400

    def test_invalid_hour_24(self, H):
        r = requests.put(f"{BASE}/api/user/digest-settings", headers=H, json={"hour": 24})
        assert r.status_code == 400, r.text

    def test_requires_auth(self):
        r = requests.put(f"{BASE}/api/user/digest-settings", json={"enabled": True})
        assert r.status_code == 401


# ---------- DIGEST: PREVIEW ----------
class TestDigestPreview:
    def test_preview_returns_summary(self, H):
        r = requests.post(f"{BASE}/api/user/digest-preview", headers=H)
        assert r.status_code == 200, r.text
        data = r.json()
        # When RESEND_API_KEY is empty (preview env), delivered=False, logged=True
        # Otherwise delivered=True with id.
        assert "delivered" in data
        assert "summary" in data
        s = data["summary"]
        # Required summary keys
        for key in ("books_opened", "active_days", "finished_this_week",
                    "pages_this_week", "top_fandom", "nudges",
                    "library_total", "week_start", "week_end"):
            assert key in s, f"missing summary key: {key}"
        # In preview env (RESEND_API_KEY="" in /app/backend/.env)
        if not data["delivered"]:
            assert data.get("logged") is True

    def test_preview_requires_auth(self):
        r = requests.post(f"{BASE}/api/user/digest-preview")
        assert r.status_code == 401


# ---------- SCHEDULER LOG CHECK ----------
class TestSchedulerLog:
    def test_scheduler_started_log_present(self):
        log_paths = [
            "/var/log/supervisor/backend.err.log",
            "/var/log/supervisor/backend.out.log",
        ]
        needle = "Weekly digest scheduler started (UTC, every hour at :00)."
        found = False
        for p in log_paths:
            if not os.path.exists(p):
                continue
            with open(p, "r", errors="ignore") as f:
                if needle in f.read():
                    found = True
                    break
        assert found, f"Scheduler startup line not found in supervisor logs"


# ---------- REGRESSION: confirm router still registers all endpoints ----------
class TestRegression:
    def test_auth_me(self, seeded_user, H):
        r = requests.get(f"{BASE}/api/auth/me", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["email"] == seeded_user["email"]

    def test_auth_register_login_logout(self):
        email = f"test_reg_{uuid.uuid4().hex[:8]}@example.com"
        pwd = "hunter2pw"
        s = requests.Session()
        r = s.post(f"{BASE}/api/auth/register",
                   json={"email": email, "password": pwd, "name": "Reg"})
        assert r.status_code in (200, 201), r.text
        assert s.cookies.get("session_token")
        me = s.get(f"{BASE}/api/auth/me")
        assert me.status_code == 200
        lo = s.post(f"{BASE}/api/auth/logout")
        assert lo.status_code == 200
        # Login
        s2 = requests.Session()
        li = s2.post(f"{BASE}/api/auth/login", json={"email": email, "password": pwd})
        assert li.status_code == 200, li.text
        # Cleanup
        db.users.delete_many({"email": email})

    def test_auth_profile_put(self, seeded_user, H):
        r = requests.patch(f"{BASE}/api/auth/profile", headers=H,
                           json={"name": "Renamed Digest User"})
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/api/auth/me", headers=H).json()
        assert g["name"] == "Renamed Digest User"

    def test_books_list(self, H):
        r = requests.get(f"{BASE}/api/books", headers=H)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), (list, dict))

    def test_stats_overview(self, H):
        r = requests.get(f"{BASE}/api/stats/overview", headers=H)
        assert r.status_code == 200, r.text

    def test_stats_detailed(self, H):
        r = requests.get(f"{BASE}/api/stats/detailed", headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "daily" in d
        assert "top_authors" in d

    def test_authors_list(self, H):
        r = requests.get(f"{BASE}/api/authors", headers=H)
        assert r.status_code == 200, r.text
        assert "authors" in r.json()

    def test_series_list(self, H):
        r = requests.get(f"{BASE}/api/series", headers=H)
        assert r.status_code == 200, r.text

    def test_bulk_metadata_empty(self, H):
        r = requests.post(f"{BASE}/api/books/bulk/metadata", headers=H,
                          json={"book_ids": [], "author": "X"})
        assert r.status_code == 200

    def test_bulk_move_empty(self, H):
        r = requests.post(f"{BASE}/api/books/bulk/move", headers=H,
                          json={"book_ids": [], "category": "Non-fiction"})
        assert r.status_code == 200

    def test_bulk_delete_empty(self, H):
        r = requests.post(f"{BASE}/api/books/bulk/delete", headers=H,
                          json={"book_ids": []})
        assert r.status_code == 200
