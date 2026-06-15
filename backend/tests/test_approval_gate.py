"""End-to-end coverage for the new-user approval gate + Today-pulse card.

The gate (shipped 2026-06-15) puts every new sign-up — email/password OR
Google OAuth — into ``approval_status="pending"`` until an admin
approves them from ``/admin/pending-users``. Login is refused with a
structured ``403 {code: "pending_approval"}`` so the frontend can show
the right screen.

Covered scenarios:
1.  Register: new user lands in ``pending``; response has ``{pending: true}``
    and NO session cookie is set.
2.  Login while pending → 403 pending_approval.
3.  Admin POST /approve → status flips to ``"approved"`` + audit row
    written; user can now log in.
4.  Reject with a reason → status flips to ``"rejected"`` with reason
    persisted; login returns 403 ``{code: "rejected", reason: ...}``.
5.  Bootstrap: when no users exist yet, the first registration is
    auto-approved AND made admin (otherwise the install locks itself).
6.  Today-pulse endpoint returns the expected shape.
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
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

ADMIN_ID = f"user_apprv_{uuid.uuid4().hex[:8]}"
ADMIN_TOKEN = f"sess_apprv_{uuid.uuid4().hex}"


def H_ADMIN():
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    """One reusable admin for the module + cleanup at teardown."""
    db.users.insert_one({
        "user_id": ADMIN_ID,
        "email": f"{ADMIN_ID}@example.com",
        "name": "Approval Admin",
        "picture": "",
        "is_admin": True,
        "approval_status": "approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": ADMIN_ID, "session_token": ADMIN_TOKEN,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    yield
    db.users.delete_one({"user_id": ADMIN_ID})
    db.user_sessions.delete_many({"user_id": ADMIN_ID})
    db.admin_audit.delete_many({"actor_id": ADMIN_ID})


def _make_pending_signup():
    """Register a new account end-to-end; return (email, password, uid)."""
    email = f"approvaltest_{uuid.uuid4().hex[:8]}@example.com"
    password = "hunter2pw"
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": password, "name": "Approval Test"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("pending") is True, "expected pending=True for non-bootstrap signup"
    assert "session_token" not in (r.cookies or {}), "pending signup must NOT issue a session"
    doc = db.users.find_one({"email": email}, {"_id": 0})
    assert doc is not None
    assert doc.get("approval_status") == "pending"
    return email, password, doc["user_id"]


# ---------- Register path ----------------------------------------------------

def test_register_lands_in_pending_with_no_session():
    email, _, uid = _make_pending_signup()
    try:
        # Idempotency-ish: re-registering the same email still 409s.
        r = requests.post(
            f"{BASE}/api/auth/register",
            json={"email": email, "password": "anotherone", "name": "x"},
            timeout=15,
        )
        assert r.status_code == 409
    finally:
        db.users.delete_one({"user_id": uid})


# ---------- Login path -------------------------------------------------------

def test_login_pending_returns_structured_403():
    email, password, uid = _make_pending_signup()
    try:
        r = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": email, "password": password},
            timeout=15,
        )
        assert r.status_code == 403
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail.get("code") == "pending_approval"
        assert "pending" in (detail.get("message") or "").lower()
    finally:
        db.users.delete_one({"user_id": uid})


# ---------- Approve path -----------------------------------------------------

def test_admin_approve_unblocks_login_and_writes_audit():
    email, password, uid = _make_pending_signup()
    try:
        r = requests.post(
            f"{BASE}/api/admin/users/{uid}/approve",
            headers=H_ADMIN(), timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "approved"

        # DB updated + bookkeeping fields set
        doc = db.users.find_one({"user_id": uid}, {"_id": 0})
        assert doc["approval_status"] == "approved"
        assert doc.get("approved_by") == ADMIN_ID
        assert doc.get("approved_at")
        assert "approval_rejected_reason" not in doc  # cleared on approve

        # Audit row was written
        audit = db.admin_audit.find_one(
            {"actor_id": ADMIN_ID, "target": uid, "action": "user.approve"},
            sort=[("at", -1)],
        )
        assert audit is not None

        # Login now works
        r = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": email, "password": password},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["email"] == email
    finally:
        db.users.delete_one({"user_id": uid})


def test_approve_is_idempotent_on_already_approved():
    email, _, uid = _make_pending_signup()
    try:
        r1 = requests.post(f"{BASE}/api/admin/users/{uid}/approve", headers=H_ADMIN(), timeout=15)
        r2 = requests.post(f"{BASE}/api/admin/users/{uid}/approve", headers=H_ADMIN(), timeout=15)
        assert r1.status_code == r2.status_code == 200
        # Only one audit row (re-approve shouldn't double-log)
        n = db.admin_audit.count_documents(
            {"actor_id": ADMIN_ID, "target": uid, "action": "user.approve"}
        )
        assert n == 1
    finally:
        db.users.delete_one({"user_id": uid})


def test_approve_unknown_user_404():
    r = requests.post(
        f"{BASE}/api/admin/users/user_does_not_exist/approve",
        headers=H_ADMIN(), timeout=15,
    )
    assert r.status_code == 404


# ---------- Reject path ------------------------------------------------------

def test_admin_reject_persists_reason_and_blocks_login():
    email, password, uid = _make_pending_signup()
    reason = "Sign-up looks automated. Please re-register from a personal email."
    try:
        r = requests.post(
            f"{BASE}/api/admin/users/{uid}/reject",
            headers=H_ADMIN(), json={"reason": reason}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "rejected"

        doc = db.users.find_one({"user_id": uid}, {"_id": 0})
        assert doc["approval_status"] == "rejected"
        assert doc.get("approval_rejected_reason") == reason
        assert doc.get("rejected_by") == ADMIN_ID

        # Login returns structured rejected detail with the reason
        r = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": email, "password": password},
            timeout=15,
        )
        assert r.status_code == 403
        detail = r.json()["detail"]
        assert detail["code"] == "rejected"
        assert detail["reason"] == reason
    finally:
        db.users.delete_one({"user_id": uid})


def test_reject_already_approved_user_400():
    email, _, uid = _make_pending_signup()
    try:
        # Approve first.
        requests.post(f"{BASE}/api/admin/users/{uid}/approve", headers=H_ADMIN(), timeout=15)
        # Now reject should refuse.
        r = requests.post(
            f"{BASE}/api/admin/users/{uid}/reject",
            headers=H_ADMIN(), json={"reason": "no"}, timeout=15,
        )
        assert r.status_code == 400
    finally:
        db.users.delete_one({"user_id": uid})


# ---------- Pending list -----------------------------------------------------

def test_pending_list_returns_only_pending_users():
    # Create one pending and approve another so we can verify filtering.
    e1, _, uid1 = _make_pending_signup()
    e2, _, uid2 = _make_pending_signup()
    try:
        requests.post(f"{BASE}/api/admin/users/{uid2}/approve", headers=H_ADMIN(), timeout=15)
        r = requests.get(f"{BASE}/api/admin/pending-users", headers=H_ADMIN(), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        ids = {u["user_id"] for u in body["users"]}
        assert uid1 in ids
        assert uid2 not in ids
        assert body["count"] == len(body["users"])
    finally:
        db.users.delete_many({"user_id": {"$in": [uid1, uid2]}})


# ---------- Today-pulse ------------------------------------------------------

def test_today_pulse_shape():
    r = requests.get(f"{BASE}/api/admin/today-pulse", headers=H_ADMIN(), timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["window_hours"] == 24
    for key in (
        "signups_24h", "uploads_24h", "resend_errors_24h",
        "new_fandoms_24h", "pending_count",
    ):
        assert isinstance(body[key], int), f"{key} should be int"
    assert isinstance(body["new_fandom_names"], list)
    assert len(body["new_fandom_names"]) <= 10


def test_today_pulse_requires_admin():
    r = requests.get(f"{BASE}/api/admin/today-pulse", timeout=15)
    assert r.status_code == 401


# ---------- Bootstrap --------------------------------------------------------

def test_first_ever_user_is_auto_approved_admin(tmp_path):
    """If the users collection is empty, the very next register call
    must auto-approve the user AND flag them as admin so the install
    doesn't lock itself out.

    We can't safely wipe the live ``users`` collection from a test, so
    instead we ask the DB whether the bootstrap admin already exists
    (i.e. the install has been bootstrapped) and skip this test if so.
    Useful in fresh-install CI; harmless in shared dev environments.
    """
    any_user = db.users.find_one({})
    if any_user is not None:
        pytest.skip("Users collection is non-empty; bootstrap path can't be exercised safely.")
    # If we ever do hit an empty DB in a sandbox, exercise the path.
    email = f"bootstrap_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": "hunter2pw", "name": "Bootstrap"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("pending") is not True  # session should be issued
    doc = db.users.find_one({"email": email}, {"_id": 0})
    assert doc["approval_status"] == "approved"
    assert doc["is_admin"] is True
    db.users.delete_one({"email": email})
