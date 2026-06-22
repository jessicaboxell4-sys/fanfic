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

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
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
            # Either logged-to-console (no key) or Resend rejected (sandbox)
            assert data.get("logged") is True or "error" in data

    def test_preview_requires_auth(self):
        r = requests.post(f"{BASE}/api/user/digest-preview")
        assert r.status_code == 401


# ---------- FIC-UPDATE EMAIL: settings + preview ----------
class TestFicUpdateEmail:
    def test_settings_default_disabled(self, H):
        r = requests.get(f"{BASE}/api/user/update-email-settings", headers=H)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["enabled"] is False
        assert "email_configured" in d

    def test_settings_toggle_on_off(self, H):
        r = requests.put(
            f"{BASE}/api/user/update-email-settings",
            headers=H,
            json={"enabled": True},
        )
        assert r.status_code == 200, r.text
        assert r.json()["enabled"] is True
        g = requests.get(f"{BASE}/api/user/update-email-settings", headers=H).json()
        assert g["enabled"] is True
        # Flip back off
        r = requests.put(
            f"{BASE}/api/user/update-email-settings",
            headers=H,
            json={"enabled": False},
        )
        assert r.json()["enabled"] is False

    def test_settings_requires_auth(self):
        r = requests.put(
            f"{BASE}/api/user/update-email-settings", json={"enabled": True}
        )
        assert r.status_code == 401

    def test_preview_400_without_refreshed_books(self, H, seeded_user):
        # Clean any previously-seeded refreshed books for this user
        db.books.delete_many({"user_id": seeded_user["user_id"]})
        r = requests.post(f"{BASE}/api/user/update-email-preview", headers=H)
        assert r.status_code == 400
        assert "refresh" in r.json()["detail"].lower()

    def test_preview_with_refreshed_book(self, H, seeded_user):
        # Seed a refreshed book directly in mongo
        from pymongo import MongoClient as _MC
        bid = f"book_upd_{uuid.uuid4().hex[:8]}"
        db.books.insert_one({
            "user_id": seeded_user["user_id"],
            "book_id": bid,
            "title": "Updated Test Fic",
            "author": "Test Author",
            "fandom": "Harry Potter",
            "category": "Updated stories 2026-05-29",
            "replaces": "book_old_xyz",
            "last_refreshed_at": datetime.now(timezone.utc).isoformat(),
            "refresh_summary": {
                "chapters_added": 3,
                "chapters_changed": 1,
                "chapters_removed": 0,
                "words_delta": 4200,
            },
        })
        r = requests.post(f"{BASE}/api/user/update-email-preview", headers=H)
        assert r.status_code == 200, r.text
        body = r.json()
        # In preview env (no RESEND_API_KEY), delivered=False logged=True
        assert "delivered" in body
        if not body.get("delivered"):
            # Either logged-to-console (no key) or Resend sandbox rejection
            assert body.get("logged") is True or "error" in body
        assert body["summary"]["book_count"] == 1
        assert body["summary"]["total_added"] == 3
        assert body["summary"]["total_changed"] == 1


# ---------- EMAIL OVERVIEW (consolidated preferences page) ----------
class TestEmailOverview:
    def test_overview_shape(self, H, seeded_user):
        r = requests.get(f"{BASE}/api/user/email-overview", headers=H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == seeded_user["email"]
        assert "sender_email" in body
        assert "email_configured" in body
        # weekly_digest
        wd = body["weekly_digest"]
        for k in ("enabled", "day_of_week", "hour", "last_sent_at"):
            assert k in wd
        # fic_updates
        fu = body["fic_updates"]
        assert "enabled" in fu
        assert "refreshed_book_count" in fu
        assert isinstance(fu["refreshed_book_count"], int)
        # year_recap
        yr = body["year_recap"]
        for k in ("enabled", "last_year_sent", "note"):
            assert k in yr
        # Year recap mirrors weekly digest enabled state
        assert yr["enabled"] == wd["enabled"]

    def test_overview_requires_auth(self):
        r = requests.get(f"{BASE}/api/user/email-overview")
        assert r.status_code == 401

    def test_overview_reflects_settings_changes(self, H):
        # Turn weekly digest on
        requests.put(
            f"{BASE}/api/user/digest-settings", headers=H,
            json={"enabled": True, "day_of_week": 3, "hour": 10},
        )
        # Turn fic-update on
        requests.put(
            f"{BASE}/api/user/update-email-settings", headers=H,
            json={"enabled": True},
        )
        body = requests.get(f"{BASE}/api/user/email-overview", headers=H).json()
        assert body["weekly_digest"]["enabled"] is True
        assert body["weekly_digest"]["day_of_week"] == 3
        assert body["weekly_digest"]["hour"] == 10
        assert body["fic_updates"]["enabled"] is True
        assert body["year_recap"]["enabled"] is True


# ---------- TEST EMAIL (one-shot delivery check) ----------
class TestEmailTest:
    def test_email_test_requires_auth(self):
        r = requests.post(f"{BASE}/api/user/email-test")
        assert r.status_code == 401

    def test_email_test_returns_to_field(self, H, seeded_user):
        # Either RESEND_API_KEY is unset (delivered=False logged=True),
        # OR it's set but Resend's sandbox rejects @example.com -> 502,
        # OR Resend accepts -> delivered=True with id.
        r = requests.post(f"{BASE}/api/user/email-test", headers=H)
        # 200 (configured or unconfigured) or 502 (sandbox restriction)
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            data = r.json()
            assert "delivered" in data
            assert data.get("to") == seeded_user["email"]
            if not data["delivered"]:
                assert data.get("logged") is True
            else:
                assert "id" in data


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
        # New-user approval gate (added 2026-06-15) — every signup after the
        # very first one lands in `"pending"` and does NOT get a session
        # cookie until an admin approves them.  This regression check now
        # asserts the gate is in place and the response shape matches what
        # the frontend's "pending approval" screen reads.
        #
        # 2026-06-22 — Email switched off both the test-account domain
        # AND prefix blocklist (see ``utils.test_account_filter``).
        # ``reg_`` is a fixture prefix, so any address starting with it
        # auto-approves; use a neutral one to actually exercise the
        # approval-gate code path.
        email = f"newreader{uuid.uuid4().hex[:8]}@shelfsort-prod-test.com"
        pwd = "hunter2pw"
        s = requests.Session()
        # The signup endpoint requires the rules-acknowledgement
        # checkbox + at least one onboarding answer when the
        # ``questions_enabled`` signup-config flag is ON (which it is
        # in this env).  Supply both so we exercise the approval gate
        # itself, not the input-validation guard.
        r = s.post(f"{BASE}/api/auth/register",
                   json={
                       "email": email,
                       "password": pwd,
                       "name": "Reg",
                       "accepted_rules": True,
                       "onboarding": {
                           "referral": "search",
                           "favorite_fandom": "Harry Potter",
                           "reader_type": "fanfic",
                           "is_13_plus": True,
                       },
                   })
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("pending") is True, body
        assert body.get("email") == email
        assert s.cookies.get("session_token") is None
        # Login should be blocked while pending — backend returns 403 with
        # an approval-status detail so the frontend can route to the right
        # screen instead of a generic "wrong password" toast.
        li = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pwd})
        assert li.status_code in (401, 403), li.text
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
