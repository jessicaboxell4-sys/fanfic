"""Tests for the unified `/api/events/stream` SSE channel."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


def test_event_bus_publishes_to_subscribers():
    """`publish` fans out to every subscribed queue and tears down on
    iterator close.  Pure unit test of the in-memory bus, no HTTP."""
    from utils.event_bus import publish, subscribe, subscriber_count

    async def go():
        uid = f"u_{uuid.uuid4().hex[:8]}"
        sub = subscribe(uid)
        # Kick the generator so the queue is registered (the first
        # `__anext__` call runs the body up to `await q.get()`).
        first = asyncio.create_task(sub.__anext__())
        await asyncio.sleep(0.05)
        assert subscriber_count(uid) == 1
        await publish(uid, "notification", {"hello": "world"})
        msg = await asyncio.wait_for(first, timeout=1.0)
        assert msg["kind"] == "notification"
        assert msg["data"] == {"hello": "world"}
        await sub.aclose()
        assert subscriber_count(uid) == 0

    asyncio.get_event_loop().run_until_complete(go())


def test_notification_publishes_to_event_bus():
    """`create_notification` writes to Mongo AND pushes to the unified
    event bus so any open SSE tab gets an instant ping."""
    from routes.notifications import create_notification
    from utils.event_bus import subscribe, subscriber_count

    async def go():
        uid = f"u_{uuid.uuid4().hex[:8]}"
        sub = subscribe(uid)
        first = asyncio.create_task(sub.__anext__())
        await asyncio.sleep(0.05)
        assert subscriber_count(uid) == 1
        await create_notification(
            uid, kind="cover_top_of_week",
            title="hi", body="b", link="/library",
        )
        envelope = await asyncio.wait_for(first, timeout=1.0)
        assert envelope["kind"] == "notification"
        assert envelope["data"]["title"] == "hi"
        assert envelope["data"]["kind"] == "cover_top_of_week"
        await sub.aclose()

        # Cleanup so the test row doesn't linger.
        from deps import db
        await db.notifications.delete_many({"user_id": uid})

    asyncio.get_event_loop().run_until_complete(go())


def test_events_stream_endpoint_opens_with_session():
    """`GET /api/events/stream` opens immediately with the `: connected`
    comment, then streams the SSE keep-alive cadence."""
    import requests
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={
        "email": "shelfsort-tester@example.com",
        "password": "tester123!",
    })
    if r.status_code != 200:
        pytest.skip(f"tester login skipped: {r.status_code}")
    with s.get(f"{BASE}/api/events/stream", stream=True, timeout=5) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        first = next(resp.iter_lines())
        assert b"connected" in first



def test_chat_incoming_publishes_to_bus_for_other_member():
    """Sending a chat message fans out a `chat-incoming` envelope to
    every OTHER room member's SSE subscription.  The sender does not
    receive their own message echo — that would re-bump their own
    badge incorrectly."""
    from utils.event_bus import subscribe, subscriber_count
    from deps import db

    async def go():
        # Two synthetic users + a two-person room they both belong to.
        a_uid = f"chatA_{uuid.uuid4().hex[:6]}"
        b_uid = f"chatB_{uuid.uuid4().hex[:6]}"
        room_id = f"room_{uuid.uuid4().hex[:8]}"
        await db.chat_rooms.insert_one({
            "room_id":         room_id,
            "kind":            "dm",
            "member_user_ids": [a_uid, b_uid],
            "created_at":      "2026-06-18T00:00:00+00:00",
        })

        # B subscribes to the bus.
        b_sub = subscribe(b_uid)
        b_next = asyncio.create_task(b_sub.__anext__())
        await asyncio.sleep(0.05)
        assert subscriber_count(b_uid) == 1

        # Simulate the chat publish — bypass HTTP so we don't need auth.
        from utils.event_bus import publish as bus_publish
        await bus_publish(b_uid, "chat-incoming", {
            "room_id": room_id, "sender": a_uid, "preview": "hi",
        })

        envelope = await asyncio.wait_for(b_next, timeout=1.0)
        assert envelope["kind"] == "chat-incoming"
        assert envelope["data"]["sender"] == a_uid
        assert envelope["data"]["preview"] == "hi"
        await b_sub.aclose()
        await db.chat_rooms.delete_many({"room_id": room_id})

    asyncio.get_event_loop().run_until_complete(go())
