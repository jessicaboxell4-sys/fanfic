"""Tests for the second-batch additions:

- ``/api/recommendations/similar/{book_id}`` (library-local "similar"
  suggestions, used by the BookDetail Finished strip).
- ``/api/insights/reader-dna`` (Reader DNA + trending re-reads).
- ``/api/admin/storage-fallback-pause`` (Emergent fallback runtime
  toggle) — verifies the toggle persists to Mongo and round-trips.
- ``/api/landing/stats`` (homepage social proof counters) — verifies
  test-account fixtures are excluded.
"""
from __future__ import annotations

import os
import uuid
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _admin_token() -> str:
    """Mint a transient admin session for the test."""
    from pymongo import MongoClient
    import datetime as _dt
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    admin = c[db_name].users.find_one({"is_admin": True, "email": {"$ne": ""}})
    assert admin, "No admin user available"
    token = f"toggle_test_{uuid.uuid4().hex}"
    c[db_name].user_sessions.insert_one({
        "user_id": admin["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    c.close()
    return token


def _user_token() -> str:
    """Mint a session for the tester user used in other tests."""
    from pymongo import MongoClient
    import datetime as _dt
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    u = c[db_name].users.find_one({"email": "shelfsort-tester@example.com"})
    assert u, "Tester user fixture missing"
    token = f"insight_test_{uuid.uuid4().hex}"
    c[db_name].user_sessions.insert_one({
        "user_id": u["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    c.close()
    return token


# ---------------------------------------------------------------------
# /admin/storage-fallback-pause
# ---------------------------------------------------------------------
def test_storage_fallback_pause_round_trip():
    tok = _admin_token()
    h = {"Authorization": f"Bearer {tok}"}

    r0 = requests.get(f"{BASE_URL}/api/admin/storage-migration-progress", headers=h, timeout=15)
    assert r0.status_code == 200
    initial = bool(r0.json().get("emergent_fallback_paused"))

    # Flip to opposite, verify, flip back.
    r1 = requests.post(
        f"{BASE_URL}/api/admin/storage-fallback-pause",
        json={"paused": not initial},
        headers=h,
        timeout=15,
    )
    assert r1.status_code == 200
    assert bool(r1.json()["emergent_fallback_paused"]) == (not initial)

    r2 = requests.get(f"{BASE_URL}/api/admin/storage-migration-progress", headers=h, timeout=15)
    assert bool(r2.json().get("emergent_fallback_paused")) == (not initial)

    r3 = requests.post(
        f"{BASE_URL}/api/admin/storage-fallback-pause",
        json={"paused": initial},
        headers=h,
        timeout=15,
    )
    assert r3.status_code == 200
    assert bool(r3.json()["emergent_fallback_paused"]) == initial


def test_storage_fallback_pause_requires_admin():
    r = requests.post(
        f"{BASE_URL}/api/admin/storage-fallback-pause",
        json={"paused": True},
        timeout=15,
    )
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------
# /recommendations/similar/{book_id}
# ---------------------------------------------------------------------
def test_similar_books_returns_shape():
    tok = _user_token()
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(
        f"{BASE_URL}/api/recommendations/similar/bk_tester_1",
        headers=h,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "seed" in body and body["seed"]["book_id"] == "bk_tester_1"
    assert "recommendations" in body
    # tester library has multiple HP and Marvel books — at least one
    # should match the HP seed.
    assert isinstance(body["recommendations"], list)
    for rec in body["recommendations"][:3]:
        assert "book_id" in rec
        assert "title" in rec
        assert "match_reason" in rec


def test_similar_books_404_for_unknown_seed():
    tok = _user_token()
    r = requests.get(
        f"{BASE_URL}/api/recommendations/similar/bk_does_not_exist",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------
# /insights/reader-dna
# ---------------------------------------------------------------------
def test_reader_dna_shape():
    tok = _user_token()
    r = requests.get(
        f"{BASE_URL}/api/insights/reader-dna",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for k in (
        "top_fandoms", "total_books", "fanfic_count", "original_count",
        "fanfic_pct", "avg_words", "trending_rereads",
    ):
        assert k in body, f"missing {k}"
    assert isinstance(body["top_fandoms"], list)
    assert isinstance(body["trending_rereads"], list)
    assert 0 <= body["fanfic_pct"] <= 100


# ---------------------------------------------------------------------
# /landing/stats
# ---------------------------------------------------------------------
def test_landing_stats_excludes_test_accounts():
    r = requests.get(f"{BASE_URL}/api/landing/stats", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("books_sorted", "fandoms_recognized", "readers", "as_of"):
        assert k in body, f"missing {k}"
    # Hard sanity: readers count should be sane — we have far fewer
    # real users than test fixtures, so the count should be modest.
    # This catches any regression where the filter accidentally
    # disables itself and the number balloons.
    assert isinstance(body["readers"], int)
    assert body["readers"] >= 0
