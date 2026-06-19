"""Regression test for /admin/campaign-stats."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"


@pytest.fixture(scope="module")
def admin_session():
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.users.update_one({"email": EMAIL}, {"$set": {"is_admin": True}})
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    yield s
    db.users.update_one({"email": EMAIL}, {"$set": {"is_admin": False}})


def _seed(referral, approved, last_login_iso, with_book):
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    uid = f"user_campfx_{uuid.uuid4().hex[:10]}"
    doc = {
        "user_id": uid,
        "email": f"{uid}@campfx.zzz",  # NOT a test domain
        "name": uid,
        "password_hash": "x",
        "is_admin": False,
        "approval_status": "approved" if approved else "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if referral:
        doc["onboarding"] = {"referral": referral}
    if last_login_iso:
        doc["last_login_at"] = last_login_iso
    db.users.insert_one(doc)
    if with_book:
        db.books.insert_one({"book_id": f"bk_{uid}", "user_id": uid, "title": "x", "author": "y"})
    return uid


def _cleanup(ids):
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.users.delete_many({"user_id": {"$in": ids}})
    db.books.delete_many({"user_id": {"$in": ids}})


def test_campaign_stats_funnel(admin_session):
    """4 facebook signups → 3 approved → 2 uploaded → 1 active_7d."""
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=3)).isoformat()
    stale  = (now - timedelta(days=30)).isoformat()
    ids = [
        _seed("campfx_fb", approved=True,  last_login_iso=recent, with_book=True),   # all 4
        _seed("campfx_fb", approved=True,  last_login_iso=stale,  with_book=True),   # not active
        _seed("campfx_fb", approved=True,  last_login_iso=None,   with_book=False),  # approved, no book, no login
        _seed("campfx_fb", approved=False, last_login_iso=None,   with_book=False),  # pending
    ]
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/campaign-stats", timeout=20)
        assert r.status_code == 200, r.text[:200]
        row = next(c for c in r.json()["campaigns"] if c["ref"] == "campfx_fb")
        assert row["signups"]   == 4
        assert row["approved"]  == 3
        assert row["uploaded"]  == 2
        assert row["active_7d"] == 1
    finally:
        _cleanup(ids)


def test_campaign_stats_excludes_test_accounts(admin_session):
    """A user on @test.local must NOT show up in any campaign row."""
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    uid = f"user_zfx_{uuid.uuid4().hex[:8]}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@test.local",  # ← test fixture domain
        "name": uid,
        "is_admin": False,
        "password_hash": "x",
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "onboarding": {"referral": "zfxzzz"},
    })
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/campaign-stats", timeout=20)
        rows = r.json()["campaigns"]
        assert not any(c["ref"] == "zfxzzz" for c in rows)
    finally:
        db.users.delete_one({"user_id": uid})


def test_campaign_stats_organic_baseline(admin_session):
    """A user with no onboarding.referral lands in the ``ref=None`` row."""
    uid = _seed(None, approved=True, last_login_iso=None, with_book=False)
    try:
        r = admin_session.get(f"{BASE_URL}/api/admin/campaign-stats", timeout=20)
        rows = r.json()["campaigns"]
        organic = next((c for c in rows if c["ref"] is None), None)
        assert organic is not None, "Expected an organic (ref=null) row"
        assert organic["signups"] >= 1
    finally:
        _cleanup([uid])
