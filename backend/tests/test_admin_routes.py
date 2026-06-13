"""Test for the route-catalogue admin endpoint.

Pins three contracts:
  1. The endpoint returns every registered ``/api/*`` route grouped by
     source module.
  2. Routes we know exist after Phase-2 refactor (extracted to
     ``routes/tags.py`` etc.) show up under the right module name.
  3. The endpoint is admin-only.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


@pytest.fixture()
def admin_session():
    uid = f"user_rtadm_{uuid.uuid4().hex[:8]}"
    tok = f"sess_rtadm_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "Routes Admin",
        "is_admin": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield {"user_id": uid, "token": tok}
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})


@pytest.fixture()
def normal_session():
    uid = f"user_rtnorm_{uuid.uuid4().hex[:8]}"
    tok = f"sess_rtnorm_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid, "email": f"{uid}@example.com",
        "name": "Normie", "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield {"user_id": uid, "token": tok}
    db.users.delete_many({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})


def test_admin_endpoint_returns_grouped_routes(admin_session):
    r = requests.get(
        f"{BASE}/api/admin/routes",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "total" in data and "modules" in data
    assert data["total"] > 50, f"expected many routes, got {data['total']}"
    # Every group has the right shape.
    for g in data["modules"]:
        assert "module" in g and "count" in g and "routes" in g
        assert g["count"] == len(g["routes"])
        for route in g["routes"]:
            assert route["path"].startswith("/api")
            assert isinstance(route["methods"], list)
            assert all(m == m.upper() for m in route["methods"])
            assert "name" in route


def test_extracted_routes_show_up_under_new_modules(admin_session):
    """After Phase-2 refactor, tag/author/pairing/trash routes must
    appear under their new modules — not under ``routes.books``."""
    r = requests.get(
        f"{BASE}/api/admin/routes",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    data = r.json()
    by_mod = {g["module"]: g["routes"] for g in data["modules"]}

    # tags.py
    assert "routes.tags" in by_mod, list(by_mod.keys())
    tag_paths = [r["path"] for r in by_mod["routes.tags"]]
    assert "/api/tags" in tag_paths
    assert "/api/tags/merge" in tag_paths
    assert "/api/books/{book_id}/tags" in tag_paths

    # authors.py
    assert "routes.authors" in by_mod
    auth_paths = [r["path"] for r in by_mod["routes.authors"]]
    assert "/api/authors" in auth_paths
    assert "/api/library/by-author" in auth_paths

    # pairings.py
    assert "routes.pairings" in by_mod
    pair_paths = [r["path"] for r in by_mod["routes.pairings"]]
    assert "/api/library/pairings" in pair_paths

    # trash.py
    assert "routes.trash" in by_mod
    trash_paths = [r["path"] for r in by_mod["routes.trash"]]
    assert "/api/trash" in trash_paths
    assert "/api/trash/empty" in trash_paths


def test_stale_detection_with_short_window_flags_everything(admin_session):
    """A 0-day stale window should flag every module whose source file
    is tracked in git — the catalogue's own self-test of the timestamp
    machinery."""
    r = requests.get(
        f"{BASE}/api/admin/routes?stale_days=0",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["stale_days"] == 0
    assert data["stale_total"] > 0, "expected modules with git timestamps to be flagged stale at 0d"
    # At least one module should expose last_modified.
    with_ts = [g for g in data["modules"] if g.get("last_modified")]
    assert with_ts, "no modules carry last_modified — git lookup may be broken"


def test_stale_detection_with_huge_window_flags_none(admin_session):
    """A 10-year window must flag zero modules — sanity check that the
    cutoff comparison is the right way around."""
    r = requests.get(
        f"{BASE}/api/admin/routes?stale_days=3650",
        headers={"Authorization": f"Bearer {admin_session['token']}"},
    )
    data = r.json()
    assert data["stale_total"] == 0
    assert all(g["is_stale"] is False for g in data["modules"])


def test_routes_endpoint_rejects_non_admin(normal_session):
    r = requests.get(
        f"{BASE}/api/admin/routes",
        headers={"Authorization": f"Bearer {normal_session['token']}"},
    )
    assert r.status_code in (401, 403), r.text


def test_routes_endpoint_rejects_anonymous():
    r = requests.get(f"{BASE}/api/admin/routes")
    assert r.status_code in (401, 403)
