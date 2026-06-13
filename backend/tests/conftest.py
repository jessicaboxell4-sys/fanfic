"""Session-wide pytest fixtures.

Why this exists
---------------
Several test modules need to call async helpers directly (the
fandom-overlap notification helper in ``test_friends.py`` and the
cron-health wrapper in ``test_cron_health.py``). They were each
creating their own ``asyncio.new_event_loop()``. That breaks Motor
across modules: Motor binds its connection pool to the *first* event
loop it sees, and any later loop hits ``RuntimeError: <Future
attached to a different loop>``.

Exposing a single session-scoped loop here makes every async-helper
test share the same Motor binding, so module ordering doesn't matter.
"""
from __future__ import annotations

import asyncio

import pytest


@pytest.fixture(scope="session")
def shared_event_loop():
    """One asyncio loop reused by every test in the session.

    Use this when a test needs to drive an ``async`` helper directly
    (i.e. without going through the FastAPI HTTP layer). Avoids the
    Motor "Future attached to a different loop" footgun.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()
