"""End-to-end HTTP regression for the 'Someone' bug (P0 from FriendsPage).

Walks the full API at http://localhost:8001:
  1. Register users A (sender) and B (recipient).
  2. A sends a friend request to B (by email).
  3. GET /api/friends as B → pending_in row must have correct
     name/email/username (NOT empty/falsy that would render as 'Someone').
  4. GET /api/notifications as B → has a friend_request notification
     whose title contains A's display name (no bare ' wants to be friends').
  5. Schedule A for deletion (post-date scheduled_deletion_at directly via
     Mongo, since /api/account/delete uses a 30-day grace window).
  6. Call /api/account/grace-tick → A is hard-deleted.
  7. GET /api/friends as B → pending_in MUST NOT contain the orphan row;
     the friendship document must be gone from Mongo.
  8. Confirm A's notifications + outbound invites are also purged.

Plus a regression-check: normal accept flow still produces correct names.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

# In-cluster: hit the backend directly; the external URL is rate-limited
# / timed out for high-volume tests.
BASE_URL = "http://localhost:8001"


def _rand_email(prefix: str) -> str:
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@example.com"


def _register(email: str, name: str, username: str | None = None):
    """Register a brand-new user; return (session_with_Bearer_header, user_id).

    Uses Authorization: Bearer because the Set-Cookie is flagged Secure
    (HTTPS-only) and ``requests`` silently drops it on http://localhost.
    """
    s = requests.Session()
    payload = {
        "email": email,
        "password": "hunter2pw!",
        "name": name,
    }
    if username:
        payload["username"] = username
    r = s.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=10)
    assert r.status_code == 200, f"register failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    if data.get("pending"):
        pytest.skip(f"Signup config gated {email} into pending — can't run E2E")
    # Extract token from Set-Cookie header (cookie jar drops it due to Secure).
    set_cookie = r.headers.get("set-cookie", "")
    token = ""
    for piece in set_cookie.split(";"):
        if piece.strip().startswith("session_token="):
            token = piece.strip().split("=", 1)[1]
            break
    assert token, f"no session_token in Set-Cookie: {set_cookie}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s, data["user_id"]


@pytest.fixture(scope="module")
def mongo_db():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    yield db
    cli.close()


def test_friend_request_displays_correct_name_then_cascade_on_delete(
    shared_event_loop, mongo_db
):
    """Full happy-path + the cascade fix that closes the 'Someone' bug."""
    a_email = _rand_email("sender")
    b_email = _rand_email("recipient")
    a_username = f"tsender{uuid.uuid4().hex[:6]}"
    b_username = f"trecv{uuid.uuid4().hex[:6]}"

    sess_a, a_uid = _register(a_email, name="Alice Sender", username=a_username)
    sess_b, b_uid = _register(b_email, name="Bob Recipient", username=b_username)

    # Sanity: /auth/me works with Bearer.
    me_a = sess_a.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
    me_b = sess_b.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
    assert me_a.get("user_id") == a_uid
    assert me_b.get("user_id") == b_uid

    try:
        # --- A sends friend request to B (by email) -------------------
        r = sess_a.post(
            f"{BASE_URL}/api/friends/request",
            json={"target_email": b_email},
            timeout=10,
        )
        assert r.status_code == 200, f"friend request failed: {r.status_code} {r.text}"
        assert r.json().get("status") == "pending"

        # --- B sees pending_in row WITH proper sender identity --------
        r = sess_b.get(f"{BASE_URL}/api/friends", timeout=10)
        assert r.status_code == 200
        friends = r.json()
        pending_in = friends.get("pending_in") or []
        assert len(pending_in) == 1, f"expected 1 pending_in, got {pending_in}"
        row = pending_in[0]
        assert row["other_user_id"] == a_uid
        # The whole bug: at least one of these MUST be truthy so the
        # frontend's DisplayName never falls through to 'Someone'.
        assert row.get("name") == "Alice Sender", row
        assert row.get("email", "").lower() == a_email.lower()
        assert row.get("username") == a_username, row

        # --- B's notifications include a friend_request from A --------
        r = sess_b.get(f"{BASE_URL}/api/notifications?limit=20", timeout=10)
        assert r.status_code == 200, r.text
        notifs = r.json().get("notifications") or r.json().get("items") or r.json()
        if isinstance(notifs, dict):
            notifs = notifs.get("notifications") or notifs.get("items") or []
        friend_req_notifs = [
            n for n in notifs if (n.get("kind") or n.get("type")) == "friend_request"
        ]
        assert friend_req_notifs, f"no friend_request notif found: {notifs}"
        title = friend_req_notifs[0].get("title") or ""
        # Title must include some identity for A — the @handle is what
        # _display_name prefers when a username is set.
        assert f"@{a_username}" in title or "Alice Sender" in title, title
        # Sanity: title must NOT be a bare " wants to be friends" with
        # nothing on the left side.
        assert not title.lstrip().startswith("wants to be friends"), title

        # --- Schedule A for deletion in the past, then run grace-tick --
        async def _backdate():
            await mongo_db.users.update_one(
                {"user_id": a_uid},
                {"$set": {"scheduled_deletion_at": datetime.now(timezone.utc) - timedelta(days=1)}},
            )
            # Also seed an outbound invite from A to verify cascade.
            await mongo_db.invites.insert_one({
                "invite_id": f"inv_{uuid.uuid4().hex[:12]}",
                "token": uuid.uuid4().hex,
                "inviter_user_id": a_uid,
                "target_email": "stranger@example.com",
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
            })
        shared_event_loop.run_until_complete(_backdate())

        # B calls grace-tick (any authed user can — purge is global)
        r = sess_b.post(f"{BASE_URL}/api/account/grace-tick", timeout=15)
        assert r.status_code == 200, r.text
        deleted_uids = [d["user_id"] for d in r.json().get("details", [])]
        assert a_uid in deleted_uids, f"A not hard-deleted: {r.json()}"

        # --- Cascade verification in Mongo ----------------------------
        async def _verify():
            # User A row gone.
            assert await mongo_db.users.count_documents({"user_id": a_uid}) == 0
            # Friendship row gone.
            friendship_count = await mongo_db.friendships.count_documents({
                "$or": [{"user_a": a_uid}, {"user_b": a_uid}],
            })
            assert friendship_count == 0, f"orphan friendship remains: {friendship_count}"
            # Outbound invite from A gone.
            assert await mongo_db.invites.count_documents({"inviter_user_id": a_uid}) == 0
            # A's own notifications gone (the friend_accept-style ones A
            # would receive).  We only purge user_id==a_uid; B's
            # friend_request notif may legitimately remain (titled with
            # A's name as captured at send-time) — that's fine, the FE
            # doesn't re-resolve sender on notif render.
            assert await mongo_db.notifications.count_documents({"user_id": a_uid}) == 0
        shared_event_loop.run_until_complete(_verify())

        # --- B's GET /api/friends no longer shows the orphan ----------
        r = sess_b.get(f"{BASE_URL}/api/friends", timeout=10)
        assert r.status_code == 200
        friends_after = r.json()
        assert all(
            row.get("other_user_id") != a_uid
            for row in (friends_after.get("pending_in") or [])
        ), friends_after
        assert all(
            row.get("other_user_id") != a_uid
            for row in (friends_after.get("accepted") or [])
        ), friends_after

    finally:
        # Cleanup: nuke any test rows we created so the DB stays tidy.
        async def _cleanup():
            await mongo_db.users.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
            await mongo_db.friendships.delete_many({
                "$or": [{"user_a": a_uid}, {"user_b": a_uid},
                        {"user_a": b_uid}, {"user_b": b_uid}],
            })
            await mongo_db.notifications.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
            await mongo_db.invites.delete_many({"inviter_user_id": {"$in": [a_uid, b_uid]}})
            await mongo_db.user_sessions.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
        shared_event_loop.run_until_complete(_cleanup())


def test_normal_accept_flow_still_works_with_correct_names(shared_event_loop, mongo_db):
    """Regression check: the happy path (no deletes) still shows correct
    display names on both sides through accept."""
    a_email = _rand_email("acc_a")
    b_email = _rand_email("acc_b")
    a_handle = f"taccA{uuid.uuid4().hex[:6]}"
    b_handle = f"taccB{uuid.uuid4().hex[:6]}"

    sess_a, a_uid = _register(a_email, name="Alpha Tester", username=a_handle)
    sess_b, b_uid = _register(b_email, name="Beta Tester", username=b_handle)

    try:
        # A → B request
        r = sess_a.post(
            f"{BASE_URL}/api/friends/request",
            json={"target_username": b_handle},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        # B accepts
        r = sess_b.post(f"{BASE_URL}/api/friends/{a_uid}/accept", timeout=10)
        assert r.status_code == 200, r.text

        # Both sides see the other in accepted with correct identity
        fa = sess_a.get(f"{BASE_URL}/api/friends", timeout=10).json()
        fb = sess_b.get(f"{BASE_URL}/api/friends", timeout=10).json()
        a_accepted = fa.get("accepted") or []
        b_accepted = fb.get("accepted") or []
        assert len(a_accepted) == 1 and a_accepted[0]["other_user_id"] == b_uid
        assert len(b_accepted) == 1 and b_accepted[0]["other_user_id"] == a_uid
        assert a_accepted[0]["name"] == "Beta Tester"
        assert a_accepted[0]["username"] == b_handle
        assert b_accepted[0]["name"] == "Alpha Tester"
        assert b_accepted[0]["username"] == a_handle
    finally:
        async def _cleanup():
            await mongo_db.users.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
            await mongo_db.friendships.delete_many({
                "$or": [{"user_a": a_uid}, {"user_b": a_uid},
                        {"user_a": b_uid}, {"user_b": b_uid}],
            })
            await mongo_db.notifications.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
            await mongo_db.user_sessions.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
        shared_event_loop.run_until_complete(_cleanup())
