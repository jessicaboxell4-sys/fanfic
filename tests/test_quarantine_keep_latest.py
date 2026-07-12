"""Tests for iteration 85: quarantine keep-latest resolution + trash bytes_freed.

Endpoints under test:
- POST /api/library/quarantine/group/{keeper_book_id}/keep-latest
- POST /api/library/quarantine/keep-latest-all
- POST /api/trash/empty (bytes_freed in response)
- Regression: POST /api/library/quarantine/{book_id}/not-duplicate
- Regression: GET /api/library/quarantine (created_at on keeper+dupes)
- Smoke: GET /api/admin/my-library-diagnostics
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient


def _load_env():
    base = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    mongo = os.environ.get("MONGO_URL")
    dbn = os.environ.get("DB_NAME")
    if not base:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        base = line.split("=", 1)[1].strip().rstrip("/")
        except Exception:
            pass
    if not (mongo and dbn):
        try:
            with open("/app/backend/.env") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("MONGO_URL="):
                        mongo = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("DB_NAME="):
                        dbn = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return base, mongo, dbn


BASE_URL, MONGO_URL, DB_NAME = _load_env()
# Use direct localhost when preview URL is unreachable (backend is dev-hot-reloaded)
LOCAL_BASE = "http://localhost:8001"

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"


def _resolve_base():
    """Prefer the external URL when reachable, else fall back to localhost."""
    for candidate in (BASE_URL, LOCAL_BASE):
        try:
            r = requests.get(f"{candidate}/api/", timeout=5)
            if r.status_code < 500:
                return candidate
        except Exception:
            continue
    return LOCAL_BASE


API_BASE = _resolve_base()


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API_BASE}/api/auth/login",
               json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text[:200]}")
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    s, u = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s, u


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(autouse=True)
def _cleanup(mongo, admin):
    """Delete all TEST_ books before and after each test (isolation)."""
    _, u = admin
    uid = u["user_id"]
    mongo.books.delete_many({"user_id": uid, "book_id": {"$regex": "^TEST_"}})
    yield
    mongo.books.delete_many({"user_id": uid, "book_id": {"$regex": "^TEST_"}})


# ------ helpers ------

def _mk_book(uid, book_id, created_at, category="New stories", extra=None):
    doc = {
        "user_id": uid,
        "book_id": book_id,
        "title": f"Title {book_id}",
        "author": "Auth",
        "category": category,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }
    if extra:
        doc.update(extra)
    return doc


def _mk_dupe(uid, book_id, keeper_id, created_at, category="New stories"):
    return _mk_book(
        uid, book_id, created_at, category=category,
        extra={
            "duplicate_pending": True,
            "duplicate_of": [{"book_id": keeper_id, "match_reasons": ["title_author"]}],
        },
    )


def _seed_group(mongo, uid, keeper_time, dup_times):
    keeper_id = f"TEST_keeper_{uuid.uuid4().hex[:8]}"
    mongo.books.insert_one(_mk_book(uid, keeper_id, keeper_time))
    dup_ids = []
    for dt in dup_times:
        did = f"TEST_dup_{uuid.uuid4().hex[:8]}"
        mongo.books.insert_one(_mk_dupe(uid, did, keeper_id, dt))
        dup_ids.append(did)
    return keeper_id, dup_ids


# ===== Auth boundary =====

def test_unauth_group_keep_latest_401():
    r = requests.post(f"{API_BASE}/api/library/quarantine/group/xxx/keep-latest", timeout=15)
    assert r.status_code in (401, 403), f"{r.status_code} {r.text[:200]}"


def test_unauth_keep_latest_all_401():
    r = requests.post(f"{API_BASE}/api/library/quarantine/keep-latest-all", timeout=15)
    assert r.status_code in (401, 403)


# ===== Group keep-latest: 404 & 400 =====

def test_group_keep_latest_404_missing_keeper(admin):
    s, _ = admin
    r = s.post(f"{API_BASE}/api/library/quarantine/group/TEST_nonexistent_xyz/keep-latest", timeout=15)
    assert r.status_code == 404, f"{r.status_code} {r.text[:200]}"


def test_group_keep_latest_400_no_dupes(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    keeper_id = f"TEST_solo_{uuid.uuid4().hex[:8]}"
    mongo.books.insert_one(_mk_book(uid, keeper_id, datetime.now(timezone.utc)))
    r = s.post(f"{API_BASE}/api/library/quarantine/group/{keeper_id}/keep-latest", timeout=15)
    assert r.status_code == 400, f"{r.status_code} {r.text[:200]}"


# ===== Group keep-latest: keeper is newest =====

def test_keeper_newest_trashes_all_dupes(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    now = datetime.now(timezone.utc)
    keeper_id, dup_ids = _seed_group(
        mongo, uid,
        keeper_time=now,
        dup_times=[now - timedelta(days=2), now - timedelta(days=5)],
    )
    r = s.post(f"{API_BASE}/api/library/quarantine/group/{keeper_id}/keep-latest", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    data = r.json()
    assert data["promoted"] is False
    assert data["keeper_archived"] is False
    assert data["trashed_count"] == 2
    assert data["winner_book_id"] == keeper_id

    # Verify DB state
    for did in dup_ids:
        d = mongo.books.find_one({"book_id": did})
        assert d["category"] == "Trash", f"{did} category={d['category']}"
        assert d.get("trash_expires_at"), "trash_expires_at should be set"
        assert "duplicate_pending" not in d
        assert "duplicate_of" not in d
    keeper = mongo.books.find_one({"book_id": keeper_id})
    assert keeper["category"] == "New stories", "keeper category should be untouched"


# ===== Group keep-latest: duplicate is newest (promotion) =====

def test_dup_newest_promotes(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    now = datetime.now(timezone.utc)
    # keeper older, one dup newest, one dup middle
    keeper_id, dup_ids = _seed_group(
        mongo, uid,
        keeper_time=now - timedelta(days=10),
        dup_times=[now, now - timedelta(days=5)],
    )
    winner_expected = dup_ids[0]  # the one at 'now'
    other_dup = dup_ids[1]

    r = s.post(f"{API_BASE}/api/library/quarantine/group/{keeper_id}/keep-latest", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    data = r.json()
    assert data["promoted"] is True
    assert data["keeper_archived"] is True
    assert data["winner_book_id"] == winner_expected
    assert data["trashed_count"] == 1

    # Winner
    w = mongo.books.find_one({"book_id": winner_expected})
    assert w.get("replaces") == keeper_id
    assert "duplicate_pending" not in w
    assert "duplicate_of" not in w

    # Old keeper -> Old stories, replaced_by/at
    k = mongo.books.find_one({"book_id": keeper_id})
    assert k["category"] == "Old stories"
    assert k.get("replaced_by") == winner_expected
    assert k.get("replaced_at")

    # Other dupe -> Trash
    o = mongo.books.find_one({"book_id": other_dup})
    assert o["category"] == "Trash"
    assert o.get("trash_expires_at")


# ===== keep-latest-all bulk =====

def test_keep_latest_all_multi_group(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    now = datetime.now(timezone.utc)

    # Group 1: keeper newest, 2 dupes older -> 2 trashed
    k1, d1 = _seed_group(mongo, uid, now, [now - timedelta(days=3), now - timedelta(days=4)])
    # Group 2: keeper newest, 1 dupe older -> 1 trashed
    k2, d2 = _seed_group(mongo, uid, now, [now - timedelta(days=2)])
    # Group 3: dup newest, 1 dup older -> 1 promoted, 1 trashed
    k3, d3 = _seed_group(mongo, uid, now - timedelta(days=10), [now, now - timedelta(days=5)])

    r = s.post(f"{API_BASE}/api/library/quarantine/keep-latest-all", timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    data = r.json()
    for k in ("groups_processed", "groups_resolved", "groups_skipped",
              "promoted_count", "trashed_count", "skipped_reasons"):
        assert k in data, f"missing key {k}"
    assert data["groups_resolved"] == 3, data
    assert data["promoted_count"] == 1, data
    # 2 (group1) + 1 (group2) + 1 (group3 old dupe) = 4
    assert data["trashed_count"] == 4, data


def test_keep_latest_all_empty_idempotent(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    # Ensure no pending dupes for admin
    mongo.books.delete_many({"user_id": uid, "duplicate_pending": True})
    r = s.post(f"{API_BASE}/api/library/quarantine/keep-latest-all", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["groups_processed"] == 0
    assert data.get("groups_resolved", 0) == 0
    assert data.get("trashed_count", 0) == 0
    assert data.get("promoted_count", 0) == 0


# ===== /trash/empty bytes_freed =====

def test_trash_empty_bytes_freed(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    # Clear existing trash
    mongo.books.delete_many({"user_id": uid, "category": "Trash"})
    b1 = f"TEST_trash_{uuid.uuid4().hex[:8]}"
    b2 = f"TEST_trash_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    mongo.books.insert_one(_mk_book(uid, b1, now, "Trash", {"size_bytes": 2048}))
    mongo.books.insert_one(_mk_book(uid, b2, now, "Trash", {"size_bytes": 8192}))

    r = s.post(f"{API_BASE}/api/trash/empty", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    data = r.json()
    assert data["deleted"] == 2, data
    assert data["bytes_freed"] == 10240, data


# ===== Regression: not-duplicate still works =====

def test_not_duplicate_regression(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    now = datetime.now(timezone.utc)
    keeper_id, dup_ids = _seed_group(mongo, uid, now, [now - timedelta(days=1)])
    dup_id = dup_ids[0]
    r = s.post(f"{API_BASE}/api/library/quarantine/{dup_id}/not-duplicate", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    d = mongo.books.find_one({"book_id": dup_id})
    assert "duplicate_pending" not in d, "duplicate_pending should be unset"


# ===== Regression: /library/quarantine returns created_at =====

def test_quarantine_list_has_created_at(admin, mongo):
    s, u = admin
    uid = u["user_id"]
    now = datetime.now(timezone.utc)
    keeper_id, dup_ids = _seed_group(mongo, uid, now, [now - timedelta(days=1)])
    r = s.get(f"{API_BASE}/api/library/quarantine", timeout=15)
    assert r.status_code == 200
    data = r.json()
    grp = next((g for g in data.get("groups", []) if g["keeper"]["book_id"] == keeper_id), None)
    assert grp is not None, f"seeded group not found in {data}"
    assert "created_at" in grp["keeper"], grp["keeper"]
    assert grp["keeper"]["created_at"], "keeper created_at empty"
    for d in grp["duplicates"]:
        assert "created_at" in d and d["created_at"], d


# ===== Smoke: my-library-diagnostics =====

def test_diagnostics_smoke(admin):
    s, u = admin
    r = s.get(f"{API_BASE}/api/admin/my-library-diagnostics", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    data = r.json()
    for k in ("user_id", "totals", "by_category", "duplicates"):
        assert k in data
    assert data["user_id"] == u["user_id"]
