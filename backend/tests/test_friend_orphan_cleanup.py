"""Regression for the 'Someone' bug.

When a user is hard-deleted, their friendships used to remain in the
database, surfacing on the recipient's Friends page as a row with no
name / email / username — DisplayName fell through to literal 'Someone'.

This test pins down two fixes:
  1. ``_hard_delete_user`` now cascades ``friendships`` / ``invites`` /
     ``notifications``.
  2. ``GET /api/friends`` defensively garbage-collects any orphaned rows
     (where the other user no longer exists), so legacy rows from
     before the cascade fix also get swept on the next page load.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _uid() -> str:
    return f"user_orphan_{uuid.uuid4().hex[:10]}"


def _pair(a, b):
    return (a, b) if a < b else (b, a)


def test_hard_delete_cascades_friendships(shared_event_loop):
    """Hard-deleting a user must purge their friendships, invites, and
    notifications so nothing referencing them survives."""
    from routes.auth import _hard_delete_user

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        sender_id = _uid()
        recipient_id = _uid()
        fid = f"fr_{uuid.uuid4().hex[:12]}"
        try:
            await db.users.insert_one({
                "user_id": sender_id,
                "email": f"{sender_id}@example.com",
                "name": "Sender",
                "approval_status": "approved",
            })
            await db.users.insert_one({
                "user_id": recipient_id,
                "email": f"{recipient_id}@example.com",
                "name": "Recipient",
                "approval_status": "approved",
            })
            a, b = _pair(sender_id, recipient_id)
            await db.friendships.insert_one({
                "friendship_id": fid,
                "user_a": a, "user_b": b,
                "status": "pending",
                "requested_by": sender_id,
                "blocked_by": None,
            })
            await db.notifications.insert_one({
                "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
                "user_id": sender_id,
                "kind": "friend_request",
                "title": "Sender wants to be friends",
                "read": False,
            })
            await db.invites.insert_one({
                "invite_id": f"inv_{uuid.uuid4().hex[:12]}",
                "token": uuid.uuid4().hex,
                "inviter_user_id": sender_id,
                "target_email": "stranger@example.com",
                "status": "pending",
            })

            await _hard_delete_user(sender_id)

            assert await db.friendships.count_documents({"friendship_id": fid}) == 0
            assert await db.notifications.count_documents({"user_id": sender_id}) == 0
            assert await db.invites.count_documents({"inviter_user_id": sender_id}) == 0
            assert await db.users.count_documents({"user_id": recipient_id}) == 1
        finally:
            await db.users.delete_many({"user_id": {"$in": [sender_id, recipient_id]}})
            await db.friendships.delete_many({"friendship_id": fid})
            await db.notifications.delete_many({"user_id": sender_id})
            await db.invites.delete_many({"inviter_user_id": sender_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_get_friends_garbage_collects_orphans(shared_event_loop):
    """If a friendship row already references a deleted user (legacy
    data), GET /api/friends should silently drop it instead of
    surfacing a 'Someone' row."""
    from routes.friends import list_friends
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        me_id = _uid()
        ghost_id = _uid()
        fid = f"fr_{uuid.uuid4().hex[:12]}"
        try:
            await db.users.insert_one({
                "user_id": me_id,
                "email": f"{me_id}@example.com",
                "name": "Me",
                "approval_status": "approved",
            })
            # Intentionally do NOT insert ghost_id — represents a deleted user.

            a, b = _pair(me_id, ghost_id)
            await db.friendships.insert_one({
                "friendship_id": fid,
                "user_a": a, "user_b": b,
                "status": "pending",
                "requested_by": ghost_id,
                "blocked_by": None,
            })

            me = User(user_id=me_id, email=f"{me_id}@example.com", name="Me")
            result = await list_friends(user=me)

            assert all(r["other_user_id"] != ghost_id for r in result["pending_in"])
            assert all(r["other_user_id"] != ghost_id for r in result["pending_out"])
            assert all(r["other_user_id"] != ghost_id for r in result["accepted"])
            assert await db.friendships.count_documents({"friendship_id": fid}) == 0
        finally:
            await db.users.delete_many({"user_id": {"$in": [me_id, ghost_id]}})
            await db.friendships.delete_many({"friendship_id": fid})
            cli.close()

    shared_event_loop.run_until_complete(_run())
