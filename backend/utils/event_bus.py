"""Unified in-memory pub/sub for transient per-user events.

Powers the single multiplexed ``GET /api/events/stream`` SSE endpoint
so the frontend can replace its 60-90s polling loops (notifications,
bookclub messages, friend activity, goal hits) with a single
persistent connection per tab.

Payload shape on the wire (after JSON encoding):

    {"kind": "goal-hit",       "data": {...}}
    {"kind": "notification",   "data": {...}}
    {"kind": "bookclub-msg",   "data": {...}}
    {"kind": "friend-finish",  "data": {...}}

Each ``kind`` becomes its own SSE ``event:`` line so the client side
hook can register typed listeners (``EventSource.addEventListener``).

Single-worker assumption (one uvicorn worker, supervisor-managed) —
mirrors the original ``goal_events`` module.  Swap the in-memory dict
for Redis pub/sub if we ever scale out horizontally.
"""
from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Dict, Set


_SUBSCRIBERS: Dict[str, Set["asyncio.Queue[Dict[str, Any]]"]] = {}
_LOCK = asyncio.Lock()


async def publish(user_id: str, kind: str, data: Dict[str, Any]) -> None:
    """Fan-out ``data`` (under event ``kind``) to every open SSE
    connection for ``user_id``.  Failures are swallowed — a slow tab
    that backs up its queue gets a drop, not a crash."""
    if not user_id or not kind:
        return
    payload = {"kind": kind, "data": dict(data or {})}
    async with _LOCK:
        queues = list(_SUBSCRIBERS.get(user_id, ()))
    for q in queues:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


async def subscribe(user_id: str) -> AsyncIterator[Dict[str, Any]]:
    """Async generator yielding ``{kind, data}`` events for ``user_id``.
    Cleans up its queue on cancellation so a dropped tab doesn't leak.
    Caller wraps this in an SSE ``StreamingResponse`` and serialises
    each event according to the SSE wire format."""
    q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=32)
    async with _LOCK:
        _SUBSCRIBERS.setdefault(user_id, set()).add(q)
    try:
        while True:
            item = await q.get()
            yield item
    finally:
        async with _LOCK:
            bucket = _SUBSCRIBERS.get(user_id)
            if bucket:
                bucket.discard(q)
                if not bucket:
                    _SUBSCRIBERS.pop(user_id, None)


def subscriber_count(user_id: str) -> int:
    """Test/debug helper — number of open SSE connections for the
    user.  Not locked by design (observational only)."""
    return len(_SUBSCRIBERS.get(user_id, ()))
