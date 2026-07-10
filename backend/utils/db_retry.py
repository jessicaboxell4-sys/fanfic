"""Transient-database-error helpers.

MongoDB Atlas elections, maintenance windows, and auto-scaling all
produce 5-30s windows where the replica set has no primary.  Any
write during that window raises ``ServerSelectionTimeoutError`` or
``AutoReconnect``.  Without dedicated handling, these blow up
through ``upload_jobs`` and ``polish_worker``, leak a raw topology
trace into a user-facing toast, and mark perfectly recoverable work
as permanently failed.

This module gives the rest of the backend two helpers:

  * ``is_transient_mongo_error(exc)``  — typed predicate.
  * ``retry_on_transient(coro_factory, attempts=3, label="…")`` —
    wraps an async DB call with exponential backoff that catches
    only transient errors (real bugs still propagate immediately).

  * ``friendly_mongo_message(exc)`` — translates the raw exception
    into a one-sentence message safe to show users.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, TypeVar

from pymongo.errors import (
    AutoReconnect,
    ConnectionFailure,
    NetworkTimeout,
    NotPrimaryError,
    ServerSelectionTimeoutError,
    WaitQueueTimeoutError,
)

logger = logging.getLogger(__name__)

_TRANSIENT_TYPES = (
    ServerSelectionTimeoutError,
    NetworkTimeout,
    AutoReconnect,
    NotPrimaryError,
    ConnectionFailure,
    WaitQueueTimeoutError,
)

T = TypeVar("T")


def is_transient_mongo_error(exc: BaseException) -> bool:
    """True iff ``exc`` is a transient Mongo connectivity issue that
    typically recovers within seconds.  Real bugs (BadValue,
    DuplicateKey, OperationFailure for a code reason, etc.) return
    False so the caller surfaces them normally."""
    return isinstance(exc, _TRANSIENT_TYPES)


def friendly_mongo_message(exc: BaseException) -> str:
    """User-safe single-sentence translation of a transient Mongo
    error.  Never leaks topology JSON or replica-set internals."""
    if isinstance(exc, ServerSelectionTimeoutError):
        return "Our database briefly had no primary node — usually an Atlas failover. Shelfsort will retry automatically."
    if isinstance(exc, (NetworkTimeout, AutoReconnect, ConnectionFailure)):
        return "Database connection blipped — Shelfsort will retry automatically."
    if isinstance(exc, NotPrimaryError):
        return "Atlas was electing a new primary — Shelfsort will retry once the election completes."
    if isinstance(exc, WaitQueueTimeoutError):
        return "Database briefly overloaded — Shelfsort will retry shortly."
    return "Temporary database issue — Shelfsort will retry automatically."


async def retry_on_transient(
    coro_factory: Callable[[], Awaitable[T]],
    attempts: int = 3,
    base_delay: float = 0.5,
    label: str = "mongo-op",
) -> T:
    """Run ``coro_factory()`` with retry-on-transient.

    ``coro_factory`` must return a fresh awaitable on every call — we
    cannot ``await`` the same coroutine twice.  Use a lambda:

        await retry_on_transient(
            lambda: db.books.update_one({"_id": x}, {"$set": ...}),
            label="polish-update",
        )

    Delays: 0.5s, 1.5s, 4s by default (exponential).  Atlas elections
    typically resolve inside that window; anything that doesn't is
    re-raised so the caller can fall back to "leave as queued, let
    the recovery cron pick it up later".
    """
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await coro_factory()
        except Exception as exc:  # noqa: BLE001
            if not is_transient_mongo_error(exc):
                raise
            last_exc = exc
            if attempt == attempts:
                logger.warning(
                    "retry_on_transient(%s): exhausted %d attempts — %s",
                    label, attempts, type(exc).__name__,
                )
                break
            delay = base_delay * (3 ** (attempt - 1))
            logger.info(
                "retry_on_transient(%s): attempt %d failed (%s); sleeping %.2fs",
                label, attempt, type(exc).__name__, delay,
            )
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc
