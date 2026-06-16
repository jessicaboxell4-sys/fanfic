"""End-to-end coverage for per-admin user-consented read-only view-as.

Flow tested:
1. Admin requests view access → pending row.
2. User grants with a duration → row goes ``"granted"`` + ``expires_at`` set.
3. Admin reads /view-as-data and /timeline → 200 + audit rows written.
4. Same admin requesting again with an active grant = idempotent.
5. User revokes → admin reads now 403.
6. A DIFFERENT admin without consent gets 403.
7. Auto-expiry: if ``expires_at`` is in the past, status flips to
   ``"expired"`` on the next list query and reads 403.
8. Deny path: user denies → status ``"denied"``, admin can re-request.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com"
).rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]


def _make(uid_prefix: str, is_admin=False):
    uid = f"user_{uid_prefix}_{uuid.uuid4().hex[:8]}"
    tok = f"sess_{uid_prefix}_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": f"{uid_prefix.title()} User",
        "is_admin": is_admin,
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return uid, tok


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def alice():
    """Admin Alice."""
    uid, tok = _make("alice", is_admin=True)
    yield {"uid": uid, "tok": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.view_consents.delete_many({"admin_id": uid})
    db.admin_audit.delete_many({"actor_id": uid})


@pytest.fixture
def bob():
    """A second admin to test cross-admin isolation."""
    uid, tok = _make("bob", is_admin=True)
    yield {"uid": uid, "tok": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.view_consents.delete_many({"admin_id": uid})


@pytest.fixture
def carol():
    """The user being viewed."""
    uid, tok = _make("carol", is_admin=False)
    # Carol has a tiny library so the view-as-data endpoint has
    # something to return.
    for i in range(3):
        db.books.insert_one({
            "book_id": f"bk_carol_{uuid.uuid4().hex[:6]}",
            "user_id": uid,
            "title": f"Carol's Book {i}",
            "author": "C. Reader",
            "fandom": "Harry Potter",
            "category": "Fanfiction",
            "created_at": datetime.now(timezone.utc),
        })
    yield {"uid": uid, "tok": tok}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.books.delete_many({"user_id": uid})
    db.view_consents.delete_many({"user_id": uid})


def _request_view(alice, carol_uid, reason="Looking into a missing-fandom report"):
    r = requests.post(
        f"{BASE}/api/admin/users/{carol_uid}/view-request",
        json={"reason": reason}, headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Happy path -------------------------------------------------------

def test_full_request_grant_read_revoke_flow(alice, carol):
    # 1) Alice requests
    body = _request_view(alice, carol["uid"])
    assert body["created"] is True
    consent_id = body["consent"]["consent_id"]
    assert body["consent"]["status"] == "pending"

    # 2) Reading before grant → 403
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "no_consent"

    # 3) Carol grants for 24h
    r = requests.post(
        f"{BASE}/api/account/view-requests/{consent_id}/respond",
        json={"accept": True, "hours": 24}, headers=H(carol["tok"]), timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "granted"

    # 4) Alice reads library + timeline
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["user_id"] == carol["uid"]
    assert body["library"]["total_books"] == 3
    assert {"name": "Harry Potter", "count": 3} in body["library"]["fandoms"]

    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/timeline",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 200, r.text
    events = r.json()["events"]
    # 3 uploads at minimum (book_uploaded events)
    kinds = [e["kind"] for e in events]
    assert kinds.count("book_uploaded") >= 3

    # 5) Audit rows written
    n_audit = db.admin_audit.count_documents({
        "actor_id": alice["uid"], "target": carol["uid"],
        "action": {"$in": ["view_consent.read_library", "view_consent.read_timeline"]},
    })
    assert n_audit >= 2

    # 6) Carol revokes
    r = requests.delete(
        f"{BASE}/api/account/view-consents/{consent_id}",
        headers=H(carol["tok"]), timeout=15,
    )
    assert r.status_code == 200

    # 7) Alice's next read → 403
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 403


# ---------- Per-admin isolation ---------------------------------------------

def test_consent_is_per_admin(alice, bob, carol):
    # Alice gets consent
    body = _request_view(alice, carol["uid"])
    consent_id = body["consent"]["consent_id"]
    requests.post(
        f"{BASE}/api/account/view-requests/{consent_id}/respond",
        json={"accept": True, "hours": 24}, headers=H(carol["tok"]), timeout=15,
    )
    # Bob (a different admin) tries to read → 403
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(bob["tok"]), timeout=15,
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "no_consent"


# ---------- Idempotency + deny ----------------------------------------------

def test_re_request_is_idempotent(alice, carol):
    a = _request_view(alice, carol["uid"])
    b = _request_view(alice, carol["uid"])
    assert a["consent"]["consent_id"] == b["consent"]["consent_id"]
    assert b["created"] is False


def test_deny_blocks_read_and_allows_re_request(alice, carol):
    body = _request_view(alice, carol["uid"])
    consent_id = body["consent"]["consent_id"]
    # Carol denies
    r = requests.post(
        f"{BASE}/api/account/view-requests/{consent_id}/respond",
        json={"accept": False, "hours": 24}, headers=H(carol["tok"]), timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "denied"
    # Read → 403
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 403
    # Alice can re-request — gets a FRESH row (not the denied one)
    body2 = _request_view(alice, carol["uid"])
    assert body2["consent"]["consent_id"] != consent_id
    assert body2["consent"]["status"] == "pending"


# ---------- Auto-expiry ------------------------------------------------------

def test_expired_consent_auto_flips_and_blocks_read(alice, carol):
    body = _request_view(alice, carol["uid"])
    consent_id = body["consent"]["consent_id"]
    # Carol grants
    requests.post(
        f"{BASE}/api/account/view-requests/{consent_id}/respond",
        json={"accept": True, "hours": 24}, headers=H(carol["tok"]), timeout=15,
    )
    # Force expiry in the past — simulate the time-passes case.
    db.view_consents.update_one(
        {"consent_id": consent_id},
        {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(hours=1)}},
    )
    # Alice's read → 403
    r = requests.get(
        f"{BASE}/api/admin/users/{carol['uid']}/view-as-data",
        headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 403
    # Status flipped to expired (the read above triggered _expire_stale_consents)
    row = db.view_consents.find_one({"consent_id": consent_id})
    assert row["status"] == "expired"


# ---------- Listing endpoints ------------------------------------------------

def test_admin_sees_only_their_own_requests(alice, bob, carol):
    _request_view(alice, carol["uid"])
    _request_view(bob, carol["uid"])
    r = requests.get(f"{BASE}/api/admin/view-requests/mine", headers=H(alice["tok"]), timeout=15)
    assert r.status_code == 200
    rows = r.json()["consents"]
    assert all(c["admin_id"] == alice["uid"] for c in rows)
    assert len(rows) >= 1


def test_user_sees_only_incoming_to_themselves(alice, bob, carol):
    _request_view(alice, carol["uid"])
    _request_view(bob, carol["uid"])
    r = requests.get(f"{BASE}/api/account/view-requests", headers=H(carol["tok"]), timeout=15)
    assert r.status_code == 200
    rows = r.json()["consents"]
    assert all(c["user_id"] == carol["uid"] for c in rows)
    assert len(rows) == 2  # both requests are pending


# ---------- Auth gating ------------------------------------------------------

def test_view_endpoints_require_admin(alice, carol):
    # Carol (non-admin) tries to hit the admin endpoint → 403
    r = requests.post(
        f"{BASE}/api/admin/users/{carol['uid']}/view-request",
        json={"reason": "?"}, headers=H(carol["tok"]), timeout=15,
    )
    assert r.status_code == 403


def test_cannot_request_view_access_to_self(alice):
    r = requests.post(
        f"{BASE}/api/admin/users/{alice['uid']}/view-request",
        json={"reason": "no"}, headers=H(alice["tok"]), timeout=15,
    )
    assert r.status_code == 400
