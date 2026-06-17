"""In-memory pub/sub for reading-goal-hit events.

Backs the SSE endpoint ``GET /api/goals/stream`` so the frontend's
``GlobalConfettiHost`` can replace its 90-second polling loop with an
event-driven connection.

Why in-memory?
--------------
We only need to push *transient* goal-hit notifications to whichever tabs
the user has open *right now*.  A missed event isn't catastrophic — the
frontend still calls ``pulseGoalsCheck()`` on mount, which catches up via
the persisted ``hit_at`` timestamp on each goal document.  Persistence is
already handled by ``reading_goals.hit_at`` in Mongo; this module is just
the fan-out hose.

Single-worker assumption
------------------------
Shelfsort runs as one uvicorn worker behind supervisor (see backend
``supervisord.conf``).  If we ever scale horizontally we'd swap this for
Redis pub/sub — the public surface (``publish_goal_hit`` /
``subscribe``) is shaped so the swap stays a localized change.
"""
from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Dict, Set


# Per-user fan-out set.  Each subscribed connection owns its own
# ``asyncio.Queue`` so a slow client can't starve siblings, and we
# bound the queue so a stuck reader gets dropped after a few backed-up
# events instead of growing unbounded.
_SUBSCRIBERS: Dict[str, Set["asyncio.Queue[Dict[str, Any]]"]] = {}
_LOCK = asyncio.Lock()


async def publish_goal_hit(user_id: str, goal: Dict[str, Any]) -> None:
    """Notify every connection for ``user_id`` that a goal just flipped.

    Failures are swallowed (the queue is bounded — if a client is so
    backed up that ``put_nowait`` fails, that connection will be cleaned
    up by its own iterator the next time it loops).
    """
    if not user_id:
        return
    async with _LOCK:
        queues = list(_SUBSCRIBERS.get(user_id, ()))
    payload = dict(goal)
    for q in queues:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            # Drop — better to skip a confetti burst than crash the worker.
            pass


async def subscribe(user_id: str) -> AsyncIterator[Dict[str, Any]]:
    """Async generator yielding goal-hit payloads for ``user_id``.

    Caller is expected to use this from inside an SSE
    ``StreamingResponse``.  The generator cleans up its own queue on
    cancellation (the FastAPI request finishes, or the client closes the
    EventSource) so a dropped tab doesn't leak.
    """
    q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=16)
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
    """Test/debug helper — current number of open SSE connections for the
    user.  Not under the lock by design: this is observational only."""
    return len(_SUBSCRIBERS.get(user_id, ()))
