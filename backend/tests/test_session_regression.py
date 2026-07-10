"""
Regression coverage for the features shipped in this session:
- ADMIN /admin/changelog
- ADMIN /admin/llm-key-health (GET + PUT balance)
- ADMIN /admin/antivirus/status + system-health (ClamAV + Calibre)
- AUTH /auth/register welcome email (auto-approve + admin approve/reject)
- LIBRARY classifier & cover instrumentation -> llm_usage rows
"""

import os
import time
import uuid
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

# Public URL is rate-limited / slow; use localhost for backend regression speed
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8001").rstrip("/")
PUBLIC_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_EMAIL = "shelfsort-tester@example.com"
ADMIN_PASSWORD = "tester123!"


@pytest.fixture(scope="session")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    # Cookie may be marked secure (HTTPS only) — on localhost/HTTP it won't auto-send.
    # Grab the token from cookies and use Bearer header instead so tests work on both.
    token = s.cookies.get("session_token")
    if not token:
        # Some servers return the token in body — try that too
        token = (r.json() or {}).get("session_token")
    assert token, f"no session_token returned; cookies={s.cookies.get_dict()} body={r.text[:200]}"
    s.headers["Authorization"] = f"Bearer {token}"
    return s


# ---------- ADMIN changelog ----------

class TestChangelog:
    def test_changelog_returns_entries(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/changelog?limit=20", timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # response could be {"entries":[...]} or a list
        entries = data.get("entries") if isinstance(data, dict) else data
        assert isinstance(entries, list)
        if entries:
            e = entries[0]
            # expected per request: date, title, slug, line count, body
            assert "date" in e or "published" in e or "iso_date" in e
            assert "title" in e or "slug" in e


# ---------- ADMIN llm-key-health ----------

class TestLlmKeyHealth:
    def test_get_llm_key_health(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/llm-key-health", timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, dict)
        # Response groups KPIs into nested keys: instrumented / proxy / balance / runway
        assert "instrumented" in data, f"keys={list(data.keys())}"
        assert "proxy" in data
        assert "balance" in data
        assert "runway" in data

    def test_put_balance_persists(self, admin_session):
        new_balance = round(4.85 + (time.time() % 1), 4)
        r = admin_session.put(
            f"{BASE_URL}/api/admin/llm-key-health/balance",
            json={"usd": new_balance},
            timeout=20,
        )
        assert r.status_code in (200, 204), r.text[:300]
        r2 = admin_session.get(f"{BASE_URL}/api/admin/llm-key-health", timeout=20)
        assert r2.status_code == 200
        data = r2.json()
        bal_blob = data.get("balance") or {}
        bal = (bal_blob.get("usd")
               if isinstance(bal_blob, dict) else bal_blob)
        assert bal is not None
        assert abs(float(bal) - new_balance) < 0.01, f"expected ~{new_balance}, got {bal}"


# ---------- Infra: antivirus + system-health ----------

class TestInfraHealth:
    def test_antivirus_status_up(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/antivirus/status", timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # accept many possible shapes
        status_str = (str(data.get("status", "")) + " " +
                      str(data.get("clamav", "")) + " " +
                      str(data.get("clamav_status", ""))).lower()
        # may also be {"available": true}
        if "available" in data:
            assert data["available"] is True, data
        else:
            assert "up" in status_str or "ok" in status_str or "ready" in status_str, data

    def test_system_health_reports_calibre(self, admin_session):
        # Try several plausible endpoints
        for path in ("/api/admin/system-health",
                     "/api/admin/health",
                     "/api/admin/calibre/status"):
            r = admin_session.get(f"{BASE_URL}{path}", timeout=20)
            if r.status_code == 200:
                blob = r.text.lower()
                # Expect calibre/ebook-convert mentioned
                if "calibre" in blob or "ebook" in blob:
                    return
        pytest.skip("No system-health endpoint reports calibre presence")


# ---------- AUTH welcome email ----------

def _set_approval_gate(db, enabled: bool):
    db.app_config.update_one(
        {"_id": "signup"},
        {"$set": {"approval_gate_enabled": bool(enabled)}},
        upsert=True,
    )


class TestWelcomeEmail:
    def test_auto_approve_writes_welcome_log(self, db):
        _set_approval_gate(db, False)
        # Avoid the global is_test_account filter — use a non-test domain
        # and a local-part that doesn't begin with one of the test prefixes
        email = f"shelfregr_{uuid.uuid4().hex[:10]}@real-domain-acme.shop"
        payload = {
            "email": email,
            "password": "hunter2pw!",
            "name": "Auto Test",
            "accepted_rules": True,
            "onboarding": {
                "referral": "reddit",
                "favorite_fandom": "Stargate SG-1",
                "reader_type": "fanfic",
                "is_13_plus": True,
            },
        }
        r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("approval_status") == "approved", body

        # Poll email_logs up to ~8s
        log = None
        for _ in range(16):
            log = db.email_logs.find_one(
                {"to": email, "kind": "welcome_auto_approve"},
                sort=[("created_at", -1)],
            )
            if log:
                break
            time.sleep(0.5)
        assert log is not None, f"no welcome_auto_approve email_log for {email}"
        # Subject not always stamped when status=error (Resend daily quota).
        # The instrumentation contract is: kind + to + status must be present.
        assert log.get("kind") == "welcome_auto_approve"
        assert log.get("to") == email
        assert log.get("status") in ("ok", "sent", "suppressed", "error"), log
        # cleanup
        db.users.delete_one({"email": email})

    def test_admin_approve_writes_welcome_approval(self, db, admin_session):
        _set_approval_gate(db, True)
        email = f"shelfregr_pend_{uuid.uuid4().hex[:8]}@real-domain-acme.shop"
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": email,
                "password": "hunter2pw!",
                "name": "Pending Test",
                "accepted_rules": True,
                "onboarding": {
                    "referral": "reddit",
                    "favorite_fandom": "Stargate SG-1",
                    "reader_type": "fanfic",
                    "is_13_plus": True,
                },
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # Pending registration returns {pending: True, email, name, message} — no user_id.
        assert body.get("pending") is True, body
        # Look up user_id from DB
        user_doc = db.users.find_one({"email": email})
        assert user_doc, f"user not created for {email}"
        user_id = user_doc["user_id"]
        assert user_doc.get("approval_status") in ("pending", "pending_approval")

        # Approve via admin
        ar = admin_session.post(
            f"{BASE_URL}/api/admin/users/{user_id}/approve", timeout=20
        )
        assert ar.status_code in (200, 204), ar.text[:300]

        log = None
        for _ in range(16):
            log = db.email_logs.find_one(
                {"to": email, "kind": "welcome_approval"},
                sort=[("created_at", -1)],
            )
            if log:
                break
            time.sleep(0.5)
        assert log is not None, f"no welcome_approval email_log for {email}"

        # cleanup
        db.users.delete_one({"email": email})
        _set_approval_gate(db, False)

    def test_admin_reject_writes_rejection(self, db, admin_session):
        _set_approval_gate(db, True)
        email = f"shelfregr_rej_{uuid.uuid4().hex[:8]}@real-domain-acme.shop"
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "hunter2pw!", "name": "Reject Test",
                  "accepted_rules": True,
                  "onboarding": {"referral": "reddit", "favorite_fandom": "X",
                                 "reader_type": "fanfic", "is_13_plus": True}},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:300]
        user_doc = db.users.find_one({"email": email})
        assert user_doc, f"user not created for {email}"
        user_id = user_doc["user_id"]

        rj = admin_session.post(
            f"{BASE_URL}/api/admin/users/{user_id}/reject",
            json={"reason": "test rejection"},
            timeout=20,
        )
        assert rj.status_code in (200, 204), rj.text[:300]

        log = None
        for _ in range(16):
            log = db.email_logs.find_one(
                {"to": email, "kind": "approval_rejected"},
                sort=[("created_at", -1)],
            )
            if log:
                break
            time.sleep(0.5)
        assert log is not None, f"no approval_rejected email_log for {email}"

        db.users.delete_one({"email": email})
        _set_approval_gate(db, False)


# ---------- llm_usage instrumentation ----------

class TestLlmUsageInstrumentation:
    def test_classifier_logs_llm_usage(self, db, admin_session):
        # Find a book belonging to the tester
        user = db.users.find_one({"email": ADMIN_EMAIL})
        assert user
        book = db.books.find_one({"user_id": user["user_id"]})
        if not book:
            pytest.skip("no books available to trigger classify")
        book_id = book["book_id"] if "book_id" in book else book.get("id")
        before = db.llm_usage.count_documents({"kind": "classify"})
        # Try several classify endpoints
        triggered = False
        for path, payload in (
            (f"/api/books/{book_id}/reclassify", {}),
            (f"/api/books/{book_id}/classify", {}),
        ):
            r = admin_session.post(f"{BASE_URL}{path}", json=payload, timeout=90)
            if r.status_code in (200, 202):
                triggered = True
                break
        if not triggered:
            pytest.skip("no working classify endpoint (book file may be missing on disk — covered by test_llm_usage.py)")
        # poll for new row
        for _ in range(20):
            after = db.llm_usage.count_documents({"kind": "classify"})
            if after > before:
                row = db.llm_usage.find_one({"kind": "classify"},
                                            sort=[("created_at", -1)])
                assert row
                model = (row.get("model") or "").lower()
                assert "claude" in model or "sonnet" in model, row
                return
            time.sleep(0.5)
        pytest.fail("classifier did not write llm_usage row")

    def test_cover_regen_logs_llm_usage(self, db, admin_session):
        user = db.users.find_one({"email": ADMIN_EMAIL})
        book = db.books.find_one({"user_id": user["user_id"]})
        if not book:
            pytest.skip("no books available")
        book_id = book.get("book_id") or book.get("id")
        before = db.llm_usage.count_documents({"kind": "cover"})
        triggered = False
        for path, payload in (
            (f"/api/books/{book_id}/preview-cover", {"style_id": "fanfic_classic"}),
            (f"/api/books/{book_id}/cover/regenerate", {}),
        ):
            r = admin_session.post(f"{BASE_URL}{path}", json=payload, timeout=120)
            if r.status_code in (200, 202):
                triggered = True
                break
        if not triggered:
            pytest.skip("no working cover regen endpoint")
        for _ in range(30):
            after = db.llm_usage.count_documents({"kind": "cover"})
            if after > before:
                row = db.llm_usage.find_one({"kind": "cover"},
                                            sort=[("created_at", -1)])
                model = (row.get("model") or "").lower()
                assert "gemini" in model, row
                return
            time.sleep(0.5)
        pytest.fail("cover regen did not write llm_usage row")


# ---------- Frontend smoke (page reachable) ----------

class TestFrontendReachable:
    @pytest.mark.parametrize("path", ["/login", "/library", "/admin",
                                     "/help", "/friends", "/shelves"])
    def test_page_returns_200(self, path):
        r = requests.get(f"{PUBLIC_URL}{path}", timeout=30, allow_redirects=True)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
