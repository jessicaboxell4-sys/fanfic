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
