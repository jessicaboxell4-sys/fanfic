"""Tests for GET /api/admin/my-library-diagnostics (iteration 84).

Verifies:
- Auth boundary: 401 unauthenticated, 403 non-admin
- Response schema shape for an admin caller
- Endpoint is scoped to caller (no target param, so no other-user data leak)
- Trash accounting: seeding a Trash book bumps totals.trash only
- Latency < 5s
"""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"
NONADMIN_EMAIL = "diag-nonadmin-test@example.com"
NONADMIN_PASSWORD = "NonAdmin123!"
NONADMIN_FALLBACK = ("shelfsort-tester@example.com", "tester123!")

ENDPOINT = f"{BASE_URL}/api/admin/my-library-diagnostics"


def _load_frontend_env():
    """Load REACT_APP_BACKEND_URL from /app/frontend/.env if not present."""
    global BASE_URL, ENDPOINT
    if BASE_URL:
        return
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    ENDPOINT = f"{BASE_URL}/api/admin/my-library-diagnostics"
                    return
    except Exception:
        pass


def _load_backend_env():
    global MONGO_URL, DB_NAME
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                line = line.strip()
                if line.startswith("MONGO_URL="):
                    MONGO_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("DB_NAME="):
                    DB_NAME = line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass


_load_frontend_env()
_load_backend_env()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text[:200]}")
    return s, r.json()


@pytest.fixture(scope="module")
def admin_session():
    s, u = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s, u


@pytest.fixture(scope="module")
def nonadmin_session():
    s, u = _login(NONADMIN_EMAIL, NONADMIN_PASSWORD)
    return s, u


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


# --------------------------- Auth boundary -----------------------------------


def test_unauthenticated_returns_401_or_403():
    r = requests.get(ENDPOINT, timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"


def test_non_admin_forbidden(nonadmin_session):
    s, _ = nonadmin_session
    r = s.get(ENDPOINT, timeout=15)
    assert r.status_code in (401, 403), f"non-admin should be forbidden, got {r.status_code}: {r.text[:200]}"


# --------------------------- Schema / admin OK -------------------------------


def test_admin_schema_shape(admin_session):
    s, admin_user = admin_session
    t0 = time.time()
    r = s.get(ENDPOINT, timeout=15)
    elapsed = time.time() - t0
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    assert elapsed < 5.0, f"endpoint too slow: {elapsed:.2f}s"

    data = r.json()
    # Top-level keys
    for k in ("user_id", "generated_at", "totals", "by_category", "cadence",
              "by_day_last_14", "duplicates", "recent_upload_jobs", "recent_failures_count"):
        assert k in data, f"missing key: {k}"

    # Scoped to caller
    assert data["user_id"] == admin_user.get("user_id") or data["user_id"] == admin_user.get("id"), \
        f"user_id mismatch: got {data['user_id']}, expected {admin_user}"

    # totals
    for k in ("all", "non_trash", "trash"):
        assert k in data["totals"] and isinstance(data["totals"][k], int)

    # cadence
    for k in ("last_24h", "last_48h", "last_7d", "last_30d"):
        assert k in data["cadence"] and isinstance(data["cadence"][k], int)

    # duplicates
    for k in ("groups", "books_in_groups", "excess", "note"):
        assert k in data["duplicates"]

    assert isinstance(data["by_category"], list)
    assert isinstance(data["by_day_last_14"], list)
    assert isinstance(data["recent_upload_jobs"], list)
    assert isinstance(data["recent_failures_count"], int)


def test_admin_zero_books_state(admin_session, mongo):
    """Admin smoke-test account should be empty (0 books)."""
    s, admin_user = admin_session
    uid = admin_user.get("user_id") or admin_user.get("id")
    # Only assert zero-state if DB actually has 0 books for this admin (defensive)
    current_count = mongo.books.count_documents({"user_id": uid})
    r = s.get(ENDPOINT, timeout=15)
    assert r.status_code == 200
    data = r.json()
    if current_count == 0:
        assert data["totals"]["all"] == 0
        assert data["totals"]["non_trash"] == 0
        assert data["totals"]["trash"] == 0
        assert data["by_category"] == []
        assert data["duplicates"]["groups"] == 0
    else:
        pytest.skip(f"admin account not empty (has {current_count} books); zero-state assertion skipped")


# --------------------------- Trash accounting --------------------------------


def test_trash_book_increments_only_trash(admin_session, mongo):
    s, admin_user = admin_session
    uid = admin_user.get("user_id") or admin_user.get("id")

    # baseline
    r = s.get(ENDPOINT, timeout=15)
    assert r.status_code == 200
    base = r.json()
    base_all = base["totals"]["all"]
    base_trash = base["totals"]["trash"]
    base_non_trash = base["totals"]["non_trash"]

    marker = f"diag_test_{uuid.uuid4().hex[:8]}"
    doc = {
        "user_id": uid,
        "book_id": marker,
        "title": "Test Trash Book",
        "author": "T",
        "category": "Trash",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    mongo.books.insert_one(doc)
    try:
        r2 = s.get(ENDPOINT, timeout=15)
        assert r2.status_code == 200
        after = r2.json()
        assert after["totals"]["trash"] == base_trash + 1, \
            f"trash should be +1: base={base_trash}, after={after['totals']['trash']}"
        assert after["totals"]["non_trash"] == base_non_trash, \
            f"non_trash should be unchanged: base={base_non_trash}, after={after['totals']['non_trash']}"
        assert after["totals"]["all"] == base_all + 1
    finally:
        mongo.books.delete_one({"book_id": marker, "user_id": uid})


# --------------------------- Per-caller scoping ------------------------------


def test_endpoint_has_no_target_param(admin_session):
    """Passing target_user_id should be ignored — result still scoped to caller."""
    s, admin_user = admin_session
    uid = admin_user.get("user_id") or admin_user.get("id")
    r = s.get(ENDPOINT, params={"target_user_id": "user_a_093c0f85"}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["user_id"] == uid, f"caller scope leak: got {data['user_id']}, expected {uid}"
