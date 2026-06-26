"""Iteration 53 — Bundle A quick wins backend tests.

Covers:
- Task 9: friend-request notification deep-link to /users?focus=<handle>
- Task 9: fallback to /users when requester has no @handle
- Task 9: friend_accepted notif still links to /friends (no regression)
- Task 11: GET /api/books/trending shape (anon)
- Regression: POST /api/friends/request still 200; GET /api/books/trending still 200
"""
import os
import uuid
import time

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://genre-sort.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _register_fresh(prefix="iter53"):
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(
        f"{API}/auth/register",
        json={"email": email, "password": "hunter2pw!", "name": f"{prefix} user"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text[:160]}"
    data = r.json()
    uid = data.get("user_id") or data.get("user", {}).get("user_id")
    return s, email, uid


def _claim_handle(session, handle):
    r = session.patch(f"{API}/auth/username", json={"username": handle}, timeout=15)
    return r.status_code in (200, 201), r


def _fetch_notifs(session):
    r = session.get(f"{API}/notifications", timeout=15)
    if r.status_code != 200:
        return []
    j = r.json()
    return j.get("items") or j.get("notifications") or (j if isinstance(j, list) else [])


# ===================================================================
# Task 9 — Friend-request notification link
# ===================================================================
class TestFriendRequestNotificationLink:
    def test_link_uses_users_focus_with_handle(self):
        sA, _emailA, uidA = _register_fresh("iter53reqA")
        sB, _emailB, uidB = _register_fresh("iter53reqB")
        assert uidA and uidB

        # Claim a handle for A so requester_handle is set
        handle = f"iter53a{uuid.uuid4().hex[:6]}"
        ok, resp = _claim_handle(sA, handle)
        assert ok, f"claim handle failed: {resp.status_code} {resp.text[:160]}"

        # A → B friend request
        rreq = sA.post(
            f"{API}/friends/request",
            json={"target_user_id": uidB},
            timeout=15,
        )
        assert rreq.status_code == 200, f"send request: {rreq.status_code} {rreq.text[:160]}"
        assert rreq.json().get("status") == "pending"

        time.sleep(0.5)

        # Inspect B's notifications for the friend_request entry
        items = _fetch_notifs(sB)
        fr_notifs = [n for n in items if n.get("kind") == "friend_request"]
        assert fr_notifs, f"No friend_request notif found. Items: {items[:3]}"
        latest = fr_notifs[0]
        assert latest.get("link") == f"/users?focus={handle}", \
            f"Expected /users?focus={handle}, got {latest.get('link')}"
        assert latest.get("body") == "See them in the directory, then accept on the Friends page."

    def test_link_fallback_when_no_handle(self):
        sA, _emailA, uidA = _register_fresh("iter53nofallA")
        sB, _emailB, uidB = _register_fresh("iter53nofallB")
        assert uidA and uidB
        # Do NOT claim a handle for A — username should be empty/None

        rreq = sA.post(
            f"{API}/friends/request",
            json={"target_user_id": uidB},
            timeout=15,
        )
        assert rreq.status_code == 200, f"send: {rreq.status_code} {rreq.text[:160]}"

        time.sleep(0.5)
        items = _fetch_notifs(sB)
        fr_notifs = [n for n in items if n.get("kind") == "friend_request"]
        assert fr_notifs, "No friend_request notif found"
        latest = fr_notifs[0]
        # Without a handle, link falls back to bare /users
        assert latest.get("link") == "/users", \
            f"Expected bare /users (no ?focus=), got {latest.get('link')}"

    def test_friend_accepted_still_links_to_friends(self):
        sA, _emailA, uidA = _register_fresh("iter53accA")
        sB, _emailB, uidB = _register_fresh("iter53accB")
        assert uidA and uidB

        # A → B friend request
        rreq = sA.post(
            f"{API}/friends/request",
            json={"target_user_id": uidB},
            timeout=15,
        )
        assert rreq.status_code == 200

        # B accepts → A should get friend_accepted notif
        racc = sB.post(f"{API}/friends/{uidA}/accept", timeout=15)
        assert racc.status_code == 200, f"accept: {racc.status_code} {racc.text[:160]}"

        time.sleep(0.5)
        items = _fetch_notifs(sA)
        fa_notifs = [n for n in items if n.get("kind") == "friend_accepted"]
        assert fa_notifs, "No friend_accepted notif on requester"
        assert fa_notifs[0].get("link") == "/friends", \
            f"friend_accepted should still link /friends, got {fa_notifs[0].get('link')}"


# ===================================================================
# Task 11 — Trending books endpoint (regression)
# ===================================================================
class TestTrendingEndpoint:
    def test_trending_anon_shape(self):
        r = requests.get(f"{API}/books/trending", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "trending" in data and isinstance(data["trending"], list)
        assert data.get("window_days") == 7

    def test_trending_entries_have_required_fields(self):
        r = requests.get(f"{API}/books/trending?limit=8", timeout=15)
        assert r.status_code == 200
        for entry in r.json().get("trending", []):
            for k in ("title", "author", "heart_count"):
                assert k in entry, f"Missing {k} in trending entry"
            # sample_owner_handle may be present for navigation
