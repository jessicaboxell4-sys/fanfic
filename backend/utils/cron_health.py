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
reads from that collection. On ``status="error"``, we also fan out a
debounced email alert (see ``_maybe_alert_admins``).

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

Schema (``db.cron_alerts`` — for debounce)
------------------------------------------
``{ job_id: str, last_sent_at: datetime }``

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
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable

from deps import db

logger = logging.getLogger(__name__)

# Keep no more than this many run records per job.
RUNS_PER_JOB_RETENTION = 200

# Don't email admins about the same job_id more than once per this many
# minutes. A failing job retrying every minute would otherwise nuke
# inboxes inside an hour.
ALERT_DEBOUNCE_MINUTES = 60


async def _maybe_alert_admins(job_id: str, error: str | None) -> None:
    """Send a one-shot email to every admin when a cron job fails.

    Debounced via the ``cron_alerts`` collection: if we've already sent
    an alert for the same ``job_id`` within ``ALERT_DEBOUNCE_MINUTES``,
    skip silently. Gated by the ``cron_failure_alerts`` feature flag
    (default on) so an operator can mute alerts during planned outages.

    Mail delivery is best-effort: any failure here is logged and
    swallowed so the cron telemetry write path always succeeds. Resend
    isn't imported at module load — we lazy-import it inside the
    function so unit tests that don't exercise this path don't need
    the Resend dependency.
    """
    try:
        from utils.feature_flags import get_flags  # noqa: WPS433
        flags = await get_flags()
        if not flags.get("cron_failure_alerts", True):
            return
    except Exception as exc:
        logger.warning("cron alert: couldn't read feature flag, defaulting on: %s", exc)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=ALERT_DEBOUNCE_MINUTES)
    try:
        recent = await db.cron_alerts.find_one({"job_id": job_id, "last_sent_at": {"$gte": cutoff}})
        if recent:
            return  # debounced
    except Exception as exc:
        logger.warning("cron alert: debounce lookup failed: %s", exc)
        # Fall through — better to send a duplicate than miss the alert.

    try:
        admins_cursor = db.users.find(
            {"is_admin": True, "email": {"$exists": True, "$ne": ""}},
            {"_id": 0, "email": 1, "name": 1},
        )
        admins = await admins_cursor.to_list(length=50)
    except Exception as exc:
        logger.error("cron alert: admin lookup failed for %s: %s", job_id, exc)
        return
    recipients = [a["email"] for a in admins if a.get("email")]
    if not recipients:
        return

    resend_key = os.environ.get("RESEND_API_KEY") or ""
    sender = os.environ.get("SENDER_EMAIL") or ""
    if not resend_key or not sender:
        logger.info("cron alert: Resend not configured, skipping email for %s", job_id)
        return

    subject = f"[Shelfsort] Cron job failed: {job_id}"
    err_text = (error or "(no error detail captured)").strip()
    # Trim absurdly long stack-traces — keep the head, signal there's more.
    if len(err_text) > 4000:
        err_text = err_text[:4000] + "\n… [truncated]"
    when_iso = now.isoformat()
    html = (
        f"<div style='font-family:system-ui,sans-serif;max-width:560px;line-height:1.5'>"
        f"<h2 style='color:#6B46C1;margin:0 0 8px'>Cron job failure</h2>"
        f"<p style='margin:0 0 12px;color:#2C2C2C'>The scheduled job <code style='background:#EEE9FB;padding:2px 6px;border-radius:4px;color:#6B46C1'>{job_id}</code> raised an error at <strong>{when_iso}</strong>.</p>"
        f"<pre style='background:#FBFAF6;border:1px solid #E5DDC5;padding:12px;border-radius:8px;white-space:pre-wrap;font-size:12px;color:#2C2C2C;overflow:auto'>{err_text}</pre>"
        f"<p style='font-size:12px;color:#6B705C;margin-top:16px'>Open <a href='/admin' style='color:#6B46C1'>/admin → Scheduled jobs</a> for the run history. Subsequent failures of this job in the next {ALERT_DEBOUNCE_MINUTES} min won't email again (debounced).</p>"
        f"</div>"
    )
    text = (
        f"Cron job failure\n\n"
        f"Job: {job_id}\nTime: {when_iso}\n\n"
        f"Error:\n{err_text}\n\n"
        f"Open /admin → Scheduled jobs for the run history. "
        f"Subsequent failures of this job in the next {ALERT_DEBOUNCE_MINUTES} min won't email again (debounced)."
    )

    try:
        import resend  # noqa: WPS433
        resend.api_key = resend_key
        params = {
            "from": sender,
            "to": recipients,
            "subject": subject,
            "html": html,
            "text": text,
        }
        await asyncio.to_thread(resend.Emails.send, params)
        await db.cron_alerts.update_one(
            {"job_id": job_id},
            {"$set": {"job_id": job_id, "last_sent_at": now}},
            upsert=True,
        )
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "cron_failure_alert",
                ", ".join(recipients),
                "ok",
                metadata={"job_id": job_id, "recipient_count": len(recipients)},
            )
        except Exception:
            pass
        logger.info("cron alert: emailed %d admin(s) about %s", len(recipients), job_id)
    except Exception as exc:
        logger.error("cron alert: Resend send failed for %s: %s", job_id, exc)
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "cron_failure_alert",
                ", ".join(recipients),
                "error",
                error=str(exc),
                metadata={"job_id": job_id},
            )
        except Exception:
            pass


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
    # Fan out an email alert on failure. Always after the telemetry
    # write so a transient Mongo blip on the alert path doesn't lose
    # the failure record itself.
    if status == "error":
        try:
            await _maybe_alert_admins(job_id, error)
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("cron alert dispatch failed for %s: %s", job_id, exc)


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
