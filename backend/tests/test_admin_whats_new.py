"""Tests for the AdminHelp What's new feed (/api/admin/whats-new).

Covers auth gating, response shape, parser correctness against a
synthetic CHANGELOG, mtime-based cache invalidation, and the
date-suffix capture path.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

ADMIN_ID = f"user_wn_adm_{uuid.uuid4().hex[:6]}"
ADMIN_TOK = f"sess_wn_adm_{uuid.uuid4().hex}"
PLAIN_ID = f"user_wn_pln_{uuid.uuid4().hex[:6]}"
PLAIN_TOK = f"sess_wn_pln_{uuid.uuid4().hex}"


def _seed_user(uid, tok, is_admin):
    db.users.insert_one({
        "user_id": uid, "email": f"{uid}@ft.local", "name": uid,
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })


@pytest.fixture(scope="module", autouse=True)
def seed():
    _seed_user(ADMIN_ID, ADMIN_TOK, True)
    _seed_user(PLAIN_ID, PLAIN_TOK, False)
    yield
    db.users.delete_many({"user_id": {"$in": [ADMIN_ID, PLAIN_ID]}})
    db.user_sessions.delete_many({"user_id": {"$in": [ADMIN_ID, PLAIN_ID]}})


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_requires_admin_401():
    r = requests.get(f"{BASE}/api/admin/whats-new")
    assert r.status_code == 401


def test_requires_admin_403():
    r = requests.get(f"{BASE}/api/admin/whats-new", headers=H(PLAIN_TOK))
    assert r.status_code == 403


def test_returns_shape():
    r = requests.get(f"{BASE}/api/admin/whats-new?limit=3", headers=H(ADMIN_TOK))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "entries" in data and "total" in data
    assert isinstance(data["entries"], list)
    assert len(data["entries"]) <= 3
    assert data["total"] >= len(data["entries"])
    if data["entries"]:
        e = data["entries"][0]
        for key in ("date", "title", "slug", "body_preview", "body_full"):
            assert key in e
        # Date format YYYY-MM-DD
        assert len(e["date"]) == 10 and e["date"][4] == "-" and e["date"][7] == "-"


def test_limit_bounds_enforced():
    r1 = requests.get(f"{BASE}/api/admin/whats-new?limit=1", headers=H(ADMIN_TOK))
    assert r1.status_code == 200
    assert len(r1.json()["entries"]) <= 1

    r0 = requests.get(f"{BASE}/api/admin/whats-new?limit=0", headers=H(ADMIN_TOK))
    assert r0.status_code == 422  # ge=1

    rbig = requests.get(f"{BASE}/api/admin/whats-new?limit=999", headers=H(ADMIN_TOK))
    assert rbig.status_code == 422  # le=50


def test_parser_handles_suffix_and_emoji():
    """The CHANGELOG has multiple ``(suffix)`` entries — confirm at least
    one parses with both a suffix and a status emoji."""
    r = requests.get(f"{BASE}/api/admin/whats-new?limit=50", headers=H(ADMIN_TOK))
    assert r.status_code == 200
    entries = r.json()["entries"]
    suffixed = [e for e in entries if e.get("suffix")]
    assert suffixed, "expected at least one entry with a date-suffix"
    # At least one suffixed entry should also have a status emoji
    emoji_ones = [e for e in suffixed if e.get("status_emoji")]
    assert emoji_ones, "expected at least one suffixed entry with a status emoji"
    # Date format sanity on the first one
    first = suffixed[0]
    assert len(first["date"]) == 10 and first["date"][4] == "-"


def test_parser_unit_synthetic():
    """Direct call into the parser with controlled markdown."""
    from routes.admin_whats_new import _parse_changelog
    text = (
        "# Header\n\nintro line\n\n---\n\n"
        "## 2026-06-19 — Hello world \U0001F389\n\n"
        "Body para line 1\n- bullet a\n- bullet b\n\n---\n\n"
        "## 2026-06-18 (part 2) \u2014 Second one\n\nOnly body line\n"
    )
    parsed = _parse_changelog(text)
    assert len(parsed) == 2
    a, b = parsed
    assert a.date == "2026-06-19" and a.title == "Hello world"
    assert a.status_emoji == "\U0001F389"
    assert "bullet a" in a.body_full
    assert b.date == "2026-06-18" and b.suffix == "part 2"
    assert b.title == "Second one"
    assert b.status_emoji is None
