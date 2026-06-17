"""Tests for the Moderator role (shipped 2026-06-17).

Covers:
- ``require_moderator_or_admin`` accepts both flags, rejects regular users.
- Promote/demote-mod endpoints are admin-only + idempotent.
- Mods can approve / reject pending sign-ups.
- Mods can lock / unlock bookclub rooms; locked rooms refuse messages.
- ``/auth/me`` echoes the ``is_moderator`` flag.
- Admin user list includes ``is_moderator`` so the toggle column can render.

We test against the live preview backend via cookies, same pattern as
test_digest.py, because the auth + admin code paths rely on real
session cookies + the live Mongo connection.  Tests clean up the users
and rooms they create at the end.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

from deps import db


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _login_admin() -> requests.Session:
    """Find the first admin in the DB, force-set a known password (via the
    DB so we don't need to know it), and return an authenticated session.

    We bypass the approval gate by promoting the user directly in Mongo
    rather than going through /auth/register (which would land in
    pending).  Tests don't need a clean signup flow — they need an
    authenticated admin session as quickly as possible."""
    import asyncio
    from passlib.hash import bcrypt as bcrypt_hash

    async def setup():
        admin = await db.users.find_one(
            {"is_admin": True, "approval_status": {"$ne": "rejected"}},
            {"_id": 0, "email": 1, "user_id": 1},
        )
        if not admin:
            pytest.skip("No admin user in DB — can't run moderator tests")
        # Force-set a known password so we can log in.
        pw = "modtest-" + uuid.uuid4().hex[:8]
        await db.users.update_one(
            {"user_id": admin["user_id"]},
            {"$set": {"password_hash": bcrypt_hash.hash(pw),
                       "approval_status": "approved"}},
        )
        return admin["email"], pw

    email, pw = asyncio.get_event_loop().run_until_complete(setup())
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


def _make_test_user(*, is_mod: bool = False, is_admin: bool = False, approved: bool = True) -> str:
    """Create a user directly in Mongo and return their user_id."""
    import asyncio

    uid = f"modtest_{uuid.uuid4().hex[:10]}"
    email = f"{uid}@example.com"

    async def insert():
        await db.users.insert_one({
            "user_id": uid,
            "email": email,
            "name": "Mod Test",
            "is_admin": is_admin,
            "is_moderator": is_mod,
            "approval_status": "approved" if approved else "pending",
        })

    asyncio.get_event_loop().run_until_complete(insert())
    return uid


def _cleanup_user(uid: str) -> None:
    import asyncio
    asyncio.get_event_loop().run_until_complete(
        db.users.delete_many({"user_id": uid}),
    )


def _login_user(uid: str) -> requests.Session:
    """Force-set a password on a test user and log them in."""
    import asyncio
    from passlib.hash import bcrypt as bcrypt_hash

    pw = "modtest-" + uuid.uuid4().hex[:8]
    asyncio.get_event_loop().run_until_complete(
        db.users.update_one(
            {"user_id": uid},
            {"$set": {"password_hash": bcrypt_hash.hash(pw)}},
        ),
    )
    user = asyncio.get_event_loop().run_until_complete(
        db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1}),
    )
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": user["email"], "password": pw})
    assert r.status_code == 200, f"login for {uid} failed: {r.text}"
    return s


# ──────────────────────────────────────────────────────────────────────
# /auth/me echoes is_moderator
# ──────────────────────────────────────────────────────────────────────

def test_auth_me_includes_is_moderator():
    uid = _make_test_user(is_mod=True)
    try:
        s = _login_user(uid)
        r = s.get(f"{BASE}/api/auth/me")
        assert r.status_code == 200, r.text
        me = r.json()
        assert me["is_moderator"] is True
        assert me["is_admin"] is False
    finally:
        _cleanup_user(uid)


# ──────────────────────────────────────────────────────────────────────
# Admin-only promote/demote-mod
# ──────────────────────────────────────────────────────────────────────

def test_promote_mod_is_admin_only():
    target = _make_test_user()
    regular = _make_test_user()
    try:
        s = _login_user(regular)
        r = s.post(f"{BASE}/api/admin/users/{target}/promote-mod")
        # Non-admin / non-mod should 403.
        assert r.status_code == 403, r.text
    finally:
        _cleanup_user(target)
        _cleanup_user(regular)


def test_promote_and_demote_mod_idempotent():
    admin = _login_admin()
    target = _make_test_user()
    try:
        # Promote.
        r1 = admin.post(f"{BASE}/api/admin/users/{target}/promote-mod")
        assert r1.status_code == 200, r1.text
        assert r1.json()["is_moderator"] is True
        # Idempotent.
        r2 = admin.post(f"{BASE}/api/admin/users/{target}/promote-mod")
        assert r2.status_code == 200
        # Demote.
        r3 = admin.post(f"{BASE}/api/admin/users/{target}/demote-mod")
        assert r3.status_code == 200
        assert r3.json()["is_moderator"] is False
        # Idempotent.
        r4 = admin.post(f"{BASE}/api/admin/users/{target}/demote-mod")
        assert r4.status_code == 200
    finally:
        _cleanup_user(target)


# ──────────────────────────────────────────────────────────────────────
# Mods can approve / reject pending sign-ups
# ──────────────────────────────────────────────────────────────────────

def test_mod_can_approve_pending_signup():
    mod_uid = _make_test_user(is_mod=True)
    pending_uid = _make_test_user(approved=False)
    try:
        s = _login_user(mod_uid)
        r = s.post(f"{BASE}/api/admin/users/{pending_uid}/approve")
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "approved"
    finally:
        _cleanup_user(mod_uid)
        _cleanup_user(pending_uid)


def test_regular_user_cannot_approve_signup():
    regular = _make_test_user()
    pending = _make_test_user(approved=False)
    try:
        s = _login_user(regular)
        r = s.post(f"{BASE}/api/admin/users/{pending}/approve")
        assert r.status_code == 403, r.text
    finally:
        _cleanup_user(regular)
        _cleanup_user(pending)


# ──────────────────────────────────────────────────────────────────────
# Mods can lock / unlock bookclub rooms
# ──────────────────────────────────────────────────────────────────────

def test_mod_can_lock_unlock_room_and_writes_are_blocked():
    """End-to-end: create a room as an owner, lock it as a mod, prove the
    owner can no longer post, unlock, prove the owner can post again."""
    import asyncio

    mod_uid = _make_test_user(is_mod=True)
    owner_uid = _make_test_user()
    try:
        # Seed a bookclub directly.
        room_id = f"club_{uuid.uuid4().hex[:10]}"
        asyncio.get_event_loop().run_until_complete(db.bookclubs.insert_one({
            "room_id": room_id,
            "name": "Mod test room",
            "description": "",
            "book_id": "test_book",
            "book_title": "T",
            "book_author": "A",
            "book_total_chapters": 5,
            "owner_user_id": owner_uid,
            "schedule": "",
        }))
        asyncio.get_event_loop().run_until_complete(db.bookclub_members.insert_one({
            "room_id": room_id,
            "user_id": owner_uid,
            "role": "owner",
            "status": "active",
            "current_chapter": 0,
        }))

        owner = _login_user(owner_uid)
        mod = _login_user(mod_uid)

        # Owner can post initially.
        r = owner.post(f"{BASE}/api/bookclubs/{room_id}/messages",
                       json={"chapter_index": 0, "body": "hi"})
        assert r.status_code == 200, r.text

        # Mod locks.
        r = mod.post(f"{BASE}/api/bookclubs/{room_id}/lock")
        assert r.status_code == 200, r.text
        assert r.json()["is_locked"] is True

        # Owner cannot post anymore.
        r = owner.post(f"{BASE}/api/bookclubs/{room_id}/messages",
                       json={"chapter_index": 0, "body": "still here?"})
        assert r.status_code == 423, r.text

        # Mod unlocks.
        r = mod.post(f"{BASE}/api/bookclubs/{room_id}/unlock")
        assert r.status_code == 200
        assert r.json()["is_locked"] is False

        # Owner can post again.
        r = owner.post(f"{BASE}/api/bookclubs/{room_id}/messages",
                       json={"chapter_index": 0, "body": "thanks"})
        assert r.status_code == 200, r.text

        # Cleanup the room.
        asyncio.get_event_loop().run_until_complete(
            db.bookclubs.delete_one({"room_id": room_id}),
        )
        asyncio.get_event_loop().run_until_complete(
            db.bookclub_members.delete_many({"room_id": room_id}),
        )
        asyncio.get_event_loop().run_until_complete(
            db.bookclub_messages.delete_many({"room_id": room_id}),
        )
    finally:
        _cleanup_user(mod_uid)
        _cleanup_user(owner_uid)


def test_regular_user_cannot_lock_room():
    import asyncio

    regular = _make_test_user()
    owner_uid = _make_test_user()
    try:
        room_id = f"club_{uuid.uuid4().hex[:10]}"
        asyncio.get_event_loop().run_until_complete(db.bookclubs.insert_one({
            "room_id": room_id,
            "name": "Reg test",
            "owner_user_id": owner_uid,
            "book_total_chapters": 1,
        }))
        s = _login_user(regular)
        r = s.post(f"{BASE}/api/bookclubs/{room_id}/lock")
        assert r.status_code == 403, r.text
        asyncio.get_event_loop().run_until_complete(
            db.bookclubs.delete_one({"room_id": room_id}),
        )
    finally:
        _cleanup_user(regular)
        _cleanup_user(owner_uid)


# ──────────────────────────────────────────────────────────────────────
# Admin user list carries the mod flag
# ──────────────────────────────────────────────────────────────────────

def test_admin_user_list_includes_is_moderator():
    admin = _login_admin()
    target = _make_test_user(is_mod=True)
    try:
        r = admin.get(f"{BASE}/api/admin/users")
        assert r.status_code == 200
        users = r.json()["users"]
        row = next((u for u in users if u["user_id"] == target), None)
        assert row is not None, f"target {target} not in /admin/users response"
        assert row["is_moderator"] is True
    finally:
        _cleanup_user(target)


# ──────────────────────────────────────────────────────────────────────
# Moderation log — append-only history of every mod action
# ──────────────────────────────────────────────────────────────────────

def test_moderation_log_records_every_action():
    """Promote → approve a pending user → lock a room → all three land in
    the log, and the targets are hydrated to human-readable names."""
    import asyncio

    admin = _login_admin()
    pending_uid = _make_test_user(approved=False)
    owner_uid = _make_test_user()
    room_id = f"club_{uuid.uuid4().hex[:10]}"
    try:
        # Seed a room so we can lock it.
        asyncio.get_event_loop().run_until_complete(db.bookclubs.insert_one({
            "room_id": room_id,
            "name": "Modlog test room",
            "owner_user_id": owner_uid,
            "book_total_chapters": 1,
        }))

        # Three actions.
        assert admin.post(f"{BASE}/api/admin/users/{owner_uid}/promote-mod").status_code == 200
        assert admin.post(f"{BASE}/api/admin/users/{pending_uid}/approve").status_code == 200
        assert admin.post(f"{BASE}/api/bookclubs/{room_id}/lock").status_code == 200

        # Fetch the log.
        r = admin.get(f"{BASE}/api/admin/moderation-log", params={"limit": 50})
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["entries"], list)
        assert body["count"] >= 3

        # Map to verify the three actions all appear.
        actions = [e["action"] for e in body["entries"]]
        assert "user.promote_mod" in actions
        assert "user.approve" in actions
        assert "bookclub.lock" in actions

        # Target hydration — find the lock row and verify the room name is
        # echoed back so the UI doesn't need a second fetch.
        lock_row = next((e for e in body["entries"]
                         if e["action"] == "bookclub.lock" and e["target"] == room_id), None)
        assert lock_row is not None
        assert lock_row.get("target_display") == "Modlog test room"

        # Filter by action.
        r = admin.get(f"{BASE}/api/admin/moderation-log",
                      params={"action": "bookclub.lock", "limit": 50})
        assert r.status_code == 200
        for e in r.json()["entries"]:
            assert e["action"] == "bookclub.lock"

        # Filter by actor.
        admin_me = admin.get(f"{BASE}/api/auth/me").json()
        r = admin.get(f"{BASE}/api/admin/moderation-log",
                      params={"actor_id": admin_me["user_id"], "limit": 200})
        for e in r.json()["entries"]:
            assert e["actor_id"] == admin_me["user_id"]

        # Bad filter → 400.
        r = admin.get(f"{BASE}/api/admin/moderation-log",
                      params={"action": "user.banhammer"})
        assert r.status_code == 400

        # Cleanup the room.
        asyncio.get_event_loop().run_until_complete(
            db.bookclubs.delete_one({"room_id": room_id}),
        )
    finally:
        _cleanup_user(pending_uid)
        _cleanup_user(owner_uid)


def test_moderation_log_pagination():
    """``limit`` and ``offset`` slice the result and the ``count`` field
    reports the total across all pages."""
    admin = _login_admin()
    r1 = admin.get(f"{BASE}/api/admin/moderation-log",
                   params={"limit": 1, "offset": 0}).json()
    r2 = admin.get(f"{BASE}/api/admin/moderation-log",
                   params={"limit": 1, "offset": 1}).json()
    assert r1["count"] == r2["count"]  # total doesn't change between pages
    assert r1["limit"] == 1
    assert r1["offset"] == 0
    assert r2["offset"] == 1
    if r1["count"] >= 2:
        # The two pages should be disjoint and ordered newest-first, so the
        # first row of page 1 should be newer than page 2.
        assert r1["entries"][0]["ts"] >= r2["entries"][0]["ts"]


def test_moderation_log_mod_can_access_own_history():
    """Mods can fetch the log (scoped to themselves via the
    ``actor_id`` query param)."""
    mod = _make_test_user(is_mod=True)
    s = _login_user(mod)
    try:
        # Mod has done nothing yet — endpoint should still return 200.
        r = s.get(f"{BASE}/api/admin/moderation-log",
                  params={"actor_id": mod})
        assert r.status_code == 200, r.text
        body = r.json()
        # Empty (or whatever they've done, but at least valid shape).
        assert "entries" in body
        assert "count" in body
        for e in body["entries"]:
            assert e["actor_id"] == mod
    finally:
        _cleanup_user(mod)


def test_moderation_log_regular_user_blocked():
    """Regular users can't read the moderation log."""
    uid = _make_test_user()
    s = _login_user(uid)
    try:
        r = s.get(f"{BASE}/api/admin/moderation-log")
        assert r.status_code == 403, r.text
    finally:
        _cleanup_user(uid)
