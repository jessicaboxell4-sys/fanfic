"""Cron-run telemetry — wraps a scheduled job so its start, finish,
duration, status, and any error get persisted to `db.cron_runs`.

Why this exists
---------------
We learned the hard way (Bug A, 2026-06-13) that a scheduled job can
silently fail every night for weeks if the only safety net is the
broad ``except Exception`` inside the job body. APScheduler's
``misfire_grace_time`` doesn't help once the job raises — the error
just goes to a log nobody reads.

Pattern
-------
Decorate any async job with ``@track_cron_run("job_id")`` (or call
``wrap_cron_job(coro_func, "job_id")``) and every invocation will
write a row to ``db.cron_runs`` with the outcome. The admin dashboard
reads from that collection.

Schema (``db.cron_runs``)
-------------------------
``{
    job_id: str,
    started_at: datetime,
    finished_at: datetime,
    duration_ms: int,
    status: "ok" | "error",
    error: str | None,
}``

Retention
---------
We keep the latest 200 runs per job (TTL would also work; this is
simpler and bounded). Trimming happens lazily inside the wrapper so
no separate cron-of-crons is needed.
"""
from __future__ import annotations

import asyncio
import functools
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from deps import db

logger = logging.getLogger(__name__)

# Keep no more than this many run records per job.
RUNS_PER_JOB_RETENTION = 200


async def _record_run(
    job_id: str,
    started_at: datetime,
    status: str,
    error: str | None,
) -> None:
    """Persist a single run record + trim old rows. Best-effort: any
    failure here is swallowed so telemetry never breaks the job."""
    finished_at = datetime.now(timezone.utc)
    try:
        await db.cron_runs.insert_one(
            {
                "job_id": job_id,
                "started_at": started_at,
                "finished_at": finished_at,
                "duration_ms": int(
                    (finished_at - started_at).total_seconds() * 1000
                ),
                "status": status,
                "error": error,
            }
        )
        # Lazy retention: count, trim if over budget.
        total = await db.cron_runs.count_documents({"job_id": job_id})
        if total > RUNS_PER_JOB_RETENTION:
            # Delete the oldest (total - RUNS_PER_JOB_RETENTION) rows.
            to_drop = total - RUNS_PER_JOB_RETENTION
            old = (
                await db.cron_runs.find(
                    {"job_id": job_id},
                    {"_id": 1},
                )
                .sort("started_at", 1)
                .limit(to_drop)
                .to_list(length=to_drop)
            )
            if old:
                await db.cron_runs.delete_many(
                    {"_id": {"$in": [r["_id"] for r in old]}}
                )
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("cron_runs telemetry write failed for %s: %s", job_id, exc)


def wrap_cron_job(
    fn: Callable[..., Awaitable[Any]],
    job_id: str,
) -> Callable[..., Awaitable[Any]]:
    """Return an async wrapper that records start/finish/status of *fn*
    into ``db.cron_runs`` under ``job_id``. The wrapper re-raises any
    exception so APScheduler still sees the failure in its own logs."""

    @functools.wraps(fn)
    async def _wrapped(*args, **kwargs):
        started_at = datetime.now(timezone.utc)
        try:
            result = await fn(*args, **kwargs)
        except asyncio.CancelledError:
            await _record_run(job_id, started_at, "error", "cancelled")
            raise
        except Exception as exc:
            await _record_run(job_id, started_at, "error", repr(exc))
            raise
        else:
            await _record_run(job_id, started_at, "ok", None)
            return result

    return _wrapped


def track_cron_run(job_id: str):
    """Decorator form of :func:`wrap_cron_job`."""

    def _deco(fn: Callable[..., Awaitable[Any]]):
        return wrap_cron_job(fn, job_id)

    return _deco
