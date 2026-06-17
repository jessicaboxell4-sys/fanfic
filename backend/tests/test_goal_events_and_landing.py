"""Tests for the goal-hit SSE pub/sub layer + the public landing-stats endpoint.

The SSE endpoint itself is awkward to integration-test (requires a live
EventSource), so we test the in-memory pub/sub primitives directly and
verify the endpoint is registered + auth-gated.
"""
from __future__ import annotations

import asyncio
import os

import pytest
import requests

from utils.goal_events import publish_goal_hit, subscribe, subscriber_count


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


# ──────────────────────────────────────────────────────────────────────
# In-memory pub/sub primitives
# ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def anyio_backend():
    """Restrict anyio's auto-test runner to asyncio (no trio backend in
    this codebase) so each async test only runs once."""
    return "asyncio"


@pytest.mark.anyio
async def test_publish_no_subscribers_is_silent():
    """No subscribers → publish_goal_hit returns without raising."""
    await publish_goal_hit("user_nobody", {"goal_id": "g1", "target": 10})


@pytest.mark.anyio
async def test_subscriber_receives_published_event():
    """A single subscriber gets the event we publish."""
    user_id = "user_pubsub_a"
    sub = subscribe(user_id)
    # Drive the iterator past the initial `setdefault` so the queue is
    # registered before we publish.
    started = asyncio.create_task(sub.__anext__())
    # Give the iterator a tick to register itself.
    await asyncio.sleep(0.05)
    assert subscriber_count(user_id) == 1

    await publish_goal_hit(user_id, {"goal_id": "g42", "target": 10})
    got = await asyncio.wait_for(started, timeout=1.0)
    assert got["goal_id"] == "g42"
    assert got["target"] == 10

    await sub.aclose()
    # Allow cleanup to flush.
    await asyncio.sleep(0.05)
    assert subscriber_count(user_id) == 0


@pytest.mark.anyio
async def test_fan_out_to_multiple_subscribers():
    """Two open connections for the same user → both receive the event."""
    user_id = "user_pubsub_b"
    sub1, sub2 = subscribe(user_id), subscribe(user_id)
    t1 = asyncio.create_task(sub1.__anext__())
    t2 = asyncio.create_task(sub2.__anext__())
    await asyncio.sleep(0.05)
    assert subscriber_count(user_id) == 2

    await publish_goal_hit(user_id, {"goal_id": "fan", "target": 5})
    a, b = await asyncio.wait_for(asyncio.gather(t1, t2), timeout=1.0)
    assert a["goal_id"] == "fan"
    assert b["goal_id"] == "fan"

    await sub1.aclose()
    await sub2.aclose()


@pytest.mark.anyio
async def test_isolation_between_users():
    """Publishing to user A does NOT leak to user B's subscriber."""
    sub_a = subscribe("user_iso_a")
    sub_b = subscribe("user_iso_b")
    ta = asyncio.create_task(sub_a.__anext__())
    tb = asyncio.create_task(sub_b.__anext__())
    await asyncio.sleep(0.05)

    await publish_goal_hit("user_iso_a", {"goal_id": "only-a", "target": 1})
    got_a = await asyncio.wait_for(ta, timeout=1.0)
    assert got_a["goal_id"] == "only-a"
    # B should still be waiting — that's the assertion we care about.
    assert not tb.done()
    # Cancel and drain the B task before closing the generator so we
    # don't hit "aclose(): generator is already running".
    tb.cancel()
    try:
        await tb
    except (asyncio.CancelledError, StopAsyncIteration):
        pass
    await sub_a.aclose()
    await sub_b.aclose()


# ──────────────────────────────────────────────────────────────────────
# Endpoint registration + auth gating
# ──────────────────────────────────────────────────────────────────────

def test_goals_stream_requires_auth():
    """SSE endpoint must 401 unauth so EventSource doesn't loop on
    an open-but-useless stream."""
    r = requests.get(f"{BASE}/api/goals/stream", timeout=5)
    assert r.status_code == 401, r.text


# ──────────────────────────────────────────────────────────────────────
# Public landing stats
# ──────────────────────────────────────────────────────────────────────

def test_landing_stats_public_shape():
    """Endpoint is unauth, returns the expected shape, and the numbers
    are non-negative ints."""
    r = requests.get(f"{BASE}/api/landing/stats", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data.keys()) >= {"books_sorted", "fandoms_recognized", "as_of"}
    assert isinstance(data["books_sorted"], int) and data["books_sorted"] >= 0
    assert isinstance(data["fandoms_recognized"], int) and data["fandoms_recognized"] >= 0
    assert isinstance(data["as_of"], str) and "T" in data["as_of"]


def test_landing_stats_cached_second_call_is_identical():
    """Two consecutive calls inside the TTL should return the same
    ``as_of`` (cache hit) — proves the cache layer is live."""
    r1 = requests.get(f"{BASE}/api/landing/stats", timeout=10).json()
    r2 = requests.get(f"{BASE}/api/landing/stats", timeout=10).json()
    assert r1["as_of"] == r2["as_of"]
