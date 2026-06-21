"""E2E tests for the Admin Console (/api/admin/*).

Covers: users list/promote/demote (last-admin guard + self-demote guard),
maintenance banner GET/PUT/public read, system health snapshot, global
fandom aliases CRUD, global stats, feature flags CRUD, audit log.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'https://genre-sort.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

ADMIN_ID = f"user_admc_{uuid.uuid4().hex[:8]}"
ADMIN_TOKEN = f"sess_admc_{uuid.uuid4().hex}"
NON_ADMIN_ID = f"user_admcN_{uuid.uuid4().hex[:8]}"
NON_ADMIN_TOKEN = f"sess_admcN_{uuid.uuid4().hex}"
# A second admin so demote tests don't trip the last-admin guard.
ADMIN2_ID = f"user_admc2_{uuid.uuid4().hex[:8]}"
ADMIN2_TOKEN = f"sess_admc2_{uuid.uuid4().hex}"


def H_ADMIN(): return {"Authorization": f"Bearer {ADMIN_TOKEN}"}
def H_NONADMIN(): return {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}
def H_ADMIN2(): return {"Authorization": f"Bearer {ADMIN2_TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for uid, tok, is_admin, name in [
        (ADMIN_ID, ADMIN_TOKEN, True, "Adm Console"),
        (ADMIN2_ID, ADMIN2_TOKEN, True, "Second Adm"),
        (NON_ADMIN_ID, NON_ADMIN_TOKEN, False, "Plain Joe"),
    ]:
        db.users.insert_one({
            "user_id": uid, "email": f"{uid}@example.com", "name": name,
            "picture": "", "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        db.user_sessions.insert_one({
            "user_id": uid, "session_token": tok,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        })
    # Wipe baseline state for the maintenance banner + global aliases.
    db.maintenance_banner.delete_many({})
    db.global_fandom_aliases.delete_many({})
    db.feature_flags.delete_many({})
    yield
    db.users.delete_many({"user_id": {"$in": [ADMIN_ID, ADMIN2_ID, NON_ADMIN_ID]}})
    db.user_sessions.delete_many({"user_id": {"$in": [ADMIN_ID, ADMIN2_ID, NON_ADMIN_ID]}})
    db.admin_audit.delete_many({"actor_id": {"$in": [ADMIN_ID, ADMIN2_ID]}})


# ---------- Auth gating --------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/admin/users",
    "/api/admin/maintenance-banner",
    "/api/admin/system-health",
    "/api/admin/global-fandom-aliases",
    "/api/admin/global-stats",
    "/api/admin/feature-flags",
    "/api/admin/audit-log",
])
def test_endpoints_require_admin(path):
    # Unauthenticated → 401
    r = requests.get(f"{BASE}{path}")
    assert r.status_code == 401
    # Non-admin → 403
    r2 = requests.get(f"{BASE}{path}", headers=H_NONADMIN())
    assert r2.status_code == 403


# ---------- Users --------------------------------------------------------

def test_users_list_includes_admin_badge_and_book_count():
    # 2026-06-21 — ``/admin/users`` excludes test-account fixtures by
    # design (they live on ``/admin/test-accounts``).  Our fixture
    # admins/non-admins use ``user_`` prefix + ``@example.com`` domain,
    # both of which match the exclusion regex.  Split the test:
    # (1) shape-check the main endpoint with whichever real users
    #     happen to be in the CI DB, and
    # (2) verify our fixtures land on the test-accounts endpoint.
    r = requests.get(f"{BASE}/api/admin/users", headers=H_ADMIN())
    assert r.status_code == 200
    main = r.json()
    assert "users" in main and "count" in main
    # If there's at least one real (non-fixture) user, sanity-check the
    # response shape so we know the endpoint is wired up.  If the CI
    # DB has zero real users (common on a clean shelfsort_ci) the
    # shape is still locked in by ``main`` itself.
    if main["users"]:
        u = main["users"][0]
        for field in ("user_id", "email", "is_admin", "is_moderator", "book_count"):
            assert field in u, f"missing field {field!r} in /admin/users row"

    # Fixture verification on the dedicated test-accounts endpoint.
    r2 = requests.get(f"{BASE}/api/admin/test-accounts", headers=H_ADMIN())
    assert r2.status_code == 200
    fixtures = r2.json()
    assert fixtures["count"] >= 2  # admin fixture + non-admin fixture at minimum
    mine = next((u for u in fixtures["users"] if u["user_id"] == ADMIN_ID), None)
    assert mine is not None, "Fixture admin should appear on /admin/test-accounts"
    plain = next((u for u in fixtures["users"] if u["user_id"] == NON_ADMIN_ID), None)
    assert plain is not None, "Fixture non-admin should appear on /admin/test-accounts"


def test_promote_and_demote_roundtrip():
    # Initially non-admin
    r = requests.post(f"{BASE}/api/admin/users/{NON_ADMIN_ID}/promote", headers=H_ADMIN())
    assert r.status_code == 200 and r.json()["is_admin"] is True
    # Demote back
    r2 = requests.post(f"{BASE}/api/admin/users/{NON_ADMIN_ID}/demote", headers=H_ADMIN())
    assert r2.status_code == 200 and r2.json()["is_admin"] is False
    # Audit log recorded the actions
    audit = db.admin_audit.find_one({"actor_id": ADMIN_ID, "action": "user.promote", "target": NON_ADMIN_ID})
    assert audit is not None
    audit2 = db.admin_audit.find_one({"actor_id": ADMIN_ID, "action": "user.demote", "target": NON_ADMIN_ID})
    assert audit2 is not None


def test_cannot_self_demote():
    r = requests.post(f"{BASE}/api/admin/users/{ADMIN_ID}/demote", headers=H_ADMIN())
    assert r.status_code == 400


def test_promote_unknown_user_404():
    r = requests.post(f"{BASE}/api/admin/users/user_does_not_exist/promote", headers=H_ADMIN())
    assert r.status_code == 404


# ---------- Maintenance banner ------------------------------------------

def test_maintenance_banner_lifecycle():
    # Initially off — public endpoint returns null
    db.maintenance_banner.delete_many({})
    r = requests.get(f"{BASE}/api/maintenance-banner")
    assert r.status_code == 200 and r.json() is None

    # Admin turns it on
    payload = {"enabled": True, "message": "Calibre is down for maintenance.", "severity": "warn"}
    r = requests.put(f"{BASE}/api/admin/maintenance-banner", json=payload, headers=H_ADMIN())
    assert r.status_code == 200

    # Public endpoint reflects it
    r = requests.get(f"{BASE}/api/maintenance-banner")
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "Calibre is down for maintenance."
    assert body["severity"] == "warn"

    # Admin GET returns full doc including enabled flag
    r = requests.get(f"{BASE}/api/admin/maintenance-banner", headers=H_ADMIN())
    assert r.json()["enabled"] is True

    # Turn it off
    requests.put(f"{BASE}/api/admin/maintenance-banner", json={"enabled": False, "message": "", "severity": "info"}, headers=H_ADMIN())
    r = requests.get(f"{BASE}/api/maintenance-banner")
    assert r.json() is None


def test_maintenance_banner_validation():
    r = requests.put(
        f"{BASE}/api/admin/maintenance-banner",
        json={"enabled": True, "message": "x", "severity": "bogus"},
        headers=H_ADMIN(),
    )
    assert r.status_code == 422


# ---------- System health ------------------------------------------------

def test_system_health_shape():
    r = requests.get(f"{BASE}/api/admin/system-health", headers=H_ADMIN())
    assert r.status_code == 200
    data = r.json()
    assert "calibre" in data and "ok" in data["calibre"]
    assert "resend" in data
    assert "llm" in data
    assert "digest_scheduler" in data
    assert "collections" in data and isinstance(data["collections"], dict)
    assert "storage" in data and "total_bytes" in data["storage"]


# ---------- Global fandom aliases ---------------------------------------

def test_global_aliases_crud():
    # Empty baseline
    db.global_fandom_aliases.delete_many({})
    r = requests.get(f"{BASE}/api/admin/global-fandom-aliases", headers=H_ADMIN())
    assert r.json()["aliases"] == {}

    # Put
    r = requests.put(
        f"{BASE}/api/admin/global-fandom-aliases",
        json={"aliases": {"HP": "Harry Potter", "  ": "skipped", "Same": "Same"}},
        headers=H_ADMIN(),
    )
    assert r.status_code == 200
    # Empty-key and same-value entries are stripped
    aliases = r.json()["aliases"]
    assert aliases == {"HP": "Harry Potter"}

    # Read back
    r2 = requests.get(f"{BASE}/api/admin/global-fandom-aliases", headers=H_ADMIN())
    assert r2.json()["aliases"] == {"HP": "Harry Potter"}


# ---------- Global stats ------------------------------------------------

def test_global_stats_shape():
    r = requests.get(f"{BASE}/api/admin/global-stats", headers=H_ADMIN())
    assert r.status_code == 200
    data = r.json()
    for key in ("users", "admins", "books", "signups_7d", "signups_30d", "top_fandoms", "categories", "total_storage_bytes"):
        assert key in data
    assert isinstance(data["top_fandoms"], list)
    assert isinstance(data["categories"], dict)


# ---------- Feature flags -----------------------------------------------

def test_feature_flags_lifecycle():
    # Defaults: all enabled
    r = requests.get(f"{BASE}/api/admin/feature-flags", headers=H_ADMIN())
    assert r.status_code == 200
    body = r.json()
    assert set(body["known"].keys()) == {
        "uploads_enabled",
        "ai_classify_enabled",
        "fichub_enabled",
        "calibre_convert_enabled",
        # Added 2026-06-13 with the cron-failure-alert wiring; kept on by default
        # so admins are emailed when a scheduled job crashes (debounced 60 min/job).
        "cron_failure_alerts",
        # Added 2026-06-20 alongside the Email-system kill-switch card on /admin.
        # When False, all outbound Resend mail is suppressed and queued as in-app
        # notifications instead (security-critical kinds bypass).
        "outbound_emails_enabled",
    }
    assert body["flags"]["uploads_enabled"] is True

    # Disable one
    r = requests.put(
        f"{BASE}/api/admin/feature-flags",
        json={"flag": "ai_classify_enabled", "enabled": False},
        headers=H_ADMIN(),
    )
    assert r.status_code == 200
    assert r.json()["flags"]["ai_classify_enabled"] is False

    # Restore
    r = requests.put(
        f"{BASE}/api/admin/feature-flags",
        json={"flag": "ai_classify_enabled", "enabled": True},
        headers=H_ADMIN(),
    )
    assert r.json()["flags"]["ai_classify_enabled"] is True


def test_feature_flag_unknown_rejected():
    r = requests.put(
        f"{BASE}/api/admin/feature-flags",
        json={"flag": "not_a_real_flag", "enabled": False},
        headers=H_ADMIN(),
    )
    assert r.status_code == 400


# ---------- Audit log ---------------------------------------------------

def test_audit_log_records_entries():
    # Trigger a few actions
    requests.put(
        f"{BASE}/api/admin/maintenance-banner",
        json={"enabled": False, "message": "ping", "severity": "info"},
        headers=H_ADMIN(),
    )
    # Read log
    r = requests.get(f"{BASE}/api/admin/audit-log", headers=H_ADMIN(), params={"limit": 10})
    assert r.status_code == 200
    actions = {e["action"] for e in r.json()["entries"]}
    # We expect to see at least the banner action since it just ran.
    assert any(a.startswith("maintenance") for a in actions)


def test_audit_log_action_prefix_filter():
    r = requests.get(
        f"{BASE}/api/admin/audit-log",
        headers=H_ADMIN(),
        params={"action_prefix": "user.", "limit": 50},
    )
    assert r.status_code == 200
    for e in r.json()["entries"]:
        assert e["action"].startswith("user.")



# ---------- Email diagnostic --------------------------------------------

def test_email_test_requires_admin():
    # Unauthed
    r = requests.post(f"{BASE}/api/admin/email-test", json={})
    assert r.status_code == 401
    # Non-admin
    r2 = requests.post(f"{BASE}/api/admin/email-test", json={}, headers=H_NONADMIN())
    assert r2.status_code == 403


def test_email_test_defaults_to_caller():
    # No target → uses the admin's own email
    r = requests.post(f"{BASE}/api/admin/email-test", json={}, headers=H_ADMIN())
    # In sandbox with @example.com it gets 502; without key it returns 200 logged.
    assert r.status_code in (200, 502), r.text
    if r.status_code == 200:
        data = r.json()
        assert data.get("to") == f"{ADMIN_ID}@example.com"


def test_email_test_picks_user_by_id():
    r = requests.post(
        f"{BASE}/api/admin/email-test",
        json={"target_user_id": NON_ADMIN_ID, "note": "ping"},
        headers=H_ADMIN(),
    )
    assert r.status_code in (200, 502), r.text
    if r.status_code == 200:
        assert r.json().get("to") == f"{NON_ADMIN_ID}@example.com"


def test_email_test_unknown_user_404():
    r = requests.post(
        f"{BASE}/api/admin/email-test",
        json={"target_user_id": "user_does_not_exist"},
        headers=H_ADMIN(),
    )
    assert r.status_code == 404


def test_email_test_custom_email():
    r = requests.post(
        f"{BASE}/api/admin/email-test",
        json={"target_email": "ops@example.com"},
        headers=H_ADMIN(),
    )
    assert r.status_code in (200, 502), r.text
    if r.status_code == 200:
        assert r.json().get("to") == "ops@example.com"


def test_email_test_writes_audit_entry():
    requests.post(
        f"{BASE}/api/admin/email-test",
        json={"target_user_id": NON_ADMIN_ID, "note": "audit check"},
        headers=H_ADMIN(),
    )
    r = requests.get(
        f"{BASE}/api/admin/audit-log",
        headers=H_ADMIN(),
        params={"action_prefix": "email.", "limit": 20},
    )
    assert r.status_code == 200
    entries = r.json()["entries"]
    assert any(e["action"] == "email.test" for e in entries)
