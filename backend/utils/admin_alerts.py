"""Admin alert queue + weekly digest — Resend quota brake.

Background
----------
Before 2026-06-22, every cron-job failure fanned out an immediate
email to every admin (debounced 60 min per ``job_id``).  With 5
admin rows in the DB (1 real + 4 test fixtures, all of which bounce
but still count against Resend's daily quota) and 9 prod crons —
several of which kept failing because ClamAV / Calibre are missing
in production — the operator hit 200% of their 100-email/day free
tier in a single morning.

This module fixes that two ways:

1. **Queue** — every alert now writes to ``admin_pending_alerts``
   with status ``pending``.  An in-app notification is also dropped
   on every real admin so the operator sees it on /admin with a bell
   badge instantly, without an email.

2. **Weekly digest** — a new cron (``weekly_admin_digest_tick``,
   Sundays 09:00 UTC) drains every ``pending`` row from the past
   7 days into ONE consolidated email per real admin
   ("3 cron failures this week, 2 new feedbacks, 12 sign-ups").

   An **emergency bypass** kicks in mid-week if more than
   ``EMERGENCY_BURST_THRESHOLD`` alerts queue up in a single
   24-hour rolling window — the operator wants to know early
   when prod is on fire.

The whole thing is gated by a single feature flag,
``cron_alerts_weekly_batch`` (default True).  Setting it to False
restores the old immediate-email behaviour.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Iterable

from deps import db
from utils.test_account_filter import is_test_account

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------
# Mid-week emergency-bypass threshold: if this many pending alerts
# pile up in a single 24h rolling window, send an out-of-cycle
# email so the operator can react before Sunday.  10 is well above
# normal noise (one crash per day per cron is unusual) but well
# below quota-burning territory.
EMERGENCY_BURST_THRESHOLD = 10

# Don't fire the emergency email more than once per this many hours
# even if the burst threshold keeps tripping — prevents alert storms
# from blowing through quota.
EMERGENCY_DEBOUNCE_HOURS = 12

# Roll-up window for the weekly digest.
WEEKLY_WINDOW_DAYS = 7

# Retention: keep alert rows around for a quarter so the admin can
# look back at historical noise patterns.  Older rows get pruned by
# the digest cron itself.
ALERT_RETENTION_DAYS = 90


# ---------------------------------------------------------------------
# Queue API
# ---------------------------------------------------------------------
async def queue_admin_alert(
    kind: str,
    title: str,
    body: str,
    *,
    severity: str = "warning",
    meta: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> str:
    """Enqueue a single admin alert + push an in-app notification.

    Parameters
    ----------
    kind
        Short machine identifier (``cron_failure``, ``new_feedback``,
        ``storage_straggler``, ...).
    title, body
        Human-readable summary.  ``title`` shows in the bell icon
        dropdown; ``body`` appears in the digest email and the
        notification detail.
    severity
        ``info`` | ``warning`` | ``critical``.  Only ``critical``
        items show with a red badge on /admin.
    meta
        Optional structured payload.  ``job_id``, ``error``, etc.
    dedupe_key
        If provided, an existing ``pending`` row with the same
        dedupe_key has its ``count`` bumped instead of creating a
        new row.  Lets a flaky cron register as one alert + a
        repeat counter, not 50 duplicate digest lines.

    Returns the ``alert_id``.
    """
    now = datetime.now(timezone.utc)
    if dedupe_key:
        existing = await db.admin_pending_alerts.find_one_and_update(
            {"dedupe_key": dedupe_key, "status": "pending"},
            {"$set": {"last_seen_at": now, "body": body, "title": title},
             "$inc": {"count": 1}},
            return_document=False,
        )
        if existing:
            return existing["alert_id"]

    alert_id = uuid.uuid4().hex[:12]
    await db.admin_pending_alerts.insert_one({
        "alert_id":     alert_id,
        "kind":         kind,
        "title":        title,
        "body":         body,
        "severity":     severity,
        "meta":         meta or {},
        "dedupe_key":   dedupe_key,
        "count":        1,
        "status":       "pending",
        "created_at":   now,
        "last_seen_at": now,
        "delivered_at": None,
    })
    # Drop an in-app notification on every real admin so the bell
    # icon lights up immediately.  Test-fixture admins are skipped
    # via ``is_test_account`` — their notifications are noise.
    try:
        await _push_admin_notification(kind, title, body, severity, alert_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("admin alert: in-app push failed for %s: %s", kind, exc)
    # Mid-week emergency bypass
    try:
        await _maybe_emergency_email(now)
    except Exception as exc:  # noqa: BLE001
        logger.warning("admin alert: emergency-bypass check failed: %s", exc)
    return alert_id


async def _real_admin_emails() -> list[dict[str, str]]:
    """All admins whose email is not a test fixture.  Returns dicts
    with ``user_id``, ``email``, ``name``."""
    cursor = db.users.find(
        {"is_admin": True, "email": {"$exists": True, "$ne": ""}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1},
    )
    raw = await cursor.to_list(length=100)
    return [a for a in raw if not is_test_account(a.get("email", ""))]


async def _push_admin_notification(
    kind: str, title: str, body: str, severity: str, alert_id: str,
) -> None:
    """Drop one in-app notification per real admin.  Best-effort —
    a Mongo blip can't break the alert queue itself."""
    admins = await _real_admin_emails()
    if not admins:
        return
    now = datetime.now(timezone.utc)
    docs = [{
        "notification_id": uuid.uuid4().hex[:12],
        "user_id":         a["user_id"],
        "kind":            f"admin_alert.{kind}",
        "title":           title,
        "body":            body,
        "meta":            {"alert_id": alert_id, "severity": severity},
        "read":            False,
        "created_at":      now,
    } for a in admins]
    if docs:
        await db.notifications.insert_many(docs)


# ---------------------------------------------------------------------
# Emergency bypass
# ---------------------------------------------------------------------
async def _maybe_emergency_email(now: datetime) -> None:
    """If the rolling-24h pending-alert count crosses the burst
    threshold, send an out-of-cycle digest (debounced).  Mirrors the
    weekly digest body so the operator has all the context they need
    to drill into /admin.
    """
    window_start = now - timedelta(hours=24)
    count = await db.admin_pending_alerts.count_documents({
        "status":     "pending",
        "created_at": {"$gte": window_start},
    })
    if count < EMERGENCY_BURST_THRESHOLD:
        return
    # Debounce: only send if we haven't already emergency-emailed
    # in the last EMERGENCY_DEBOUNCE_HOURS hours.
    debounce_after = now - timedelta(hours=EMERGENCY_DEBOUNCE_HOURS)
    recent = await db.admin_digest_runs.find_one({
        "kind":     "emergency",
        "sent_at":  {"$gte": debounce_after},
    })
    if recent:
        return
    logger.info(
        "admin alert: emergency burst (%d alerts in 24h) — sending out-of-cycle digest",
        count,
    )
    await _send_digest_email(window_days=1, kind_label="emergency")


# ---------------------------------------------------------------------
# Weekly digest
# ---------------------------------------------------------------------
async def weekly_admin_digest_tick() -> dict[str, Any]:
    """Send the weekly digest to every real admin.

    Sundays 09:00 UTC via the APScheduler config in ``server.py``.
    Idempotent within a 24-hour window — calling it twice the same
    day is a no-op.
    """
    now = datetime.now(timezone.utc)
    debounce_after = now - timedelta(hours=20)
    already = await db.admin_digest_runs.find_one({
        "kind":    "weekly",
        "sent_at": {"$gte": debounce_after},
    })
    if already:
        return {"sent": False, "reason": "debounced", "ran_at": already["sent_at"].isoformat()}
    result = await _send_digest_email(
        window_days=WEEKLY_WINDOW_DAYS, kind_label="weekly",
    )
    await _prune_old_alerts(now)
    return result


async def _prune_old_alerts(now: datetime) -> None:
    cutoff = now - timedelta(days=ALERT_RETENTION_DAYS)
    res = await db.admin_pending_alerts.delete_many({
        "status":     {"$in": ["delivered", "dismissed"]},
        "created_at": {"$lt": cutoff},
    })
    if res.deleted_count:
        logger.info("admin alert: pruned %d old delivered/dismissed rows", res.deleted_count)


async def _send_digest_email(
    *, window_days: int, kind_label: str,
) -> dict[str, Any]:
    """Render + send the digest to every real admin.  Marks the
    included alerts as ``delivered``.  Skips silently if Resend is
    not configured or there's nothing to digest.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)
    cursor = db.admin_pending_alerts.find({
        "status":     "pending",
        "created_at": {"$gte": window_start},
    }).sort("created_at", 1)
    alerts = await cursor.to_list(length=1000)

    # Also pull lightweight counters from collections that aren't
    # routed through ``queue_admin_alert`` yet — feedback inbox +
    # sign-up gate.  Quick wins for the digest body without
    # refactoring those code paths today.
    extras = await _digest_extras(window_start)

    if not alerts and not any(extras.values()):
        return {"sent": False, "reason": "nothing_to_send", "alerts": 0}

    admins = await _real_admin_emails()
    if not admins:
        return {"sent": False, "reason": "no_real_admins", "alerts": len(alerts)}

    resend_key = os.environ.get("RESEND_API_KEY") or ""
    sender = os.environ.get("SENDER_EMAIL") or ""
    if not resend_key or not sender:
        return {"sent": False, "reason": "resend_not_configured", "alerts": len(alerts)}

    subject, html, text = _render_digest(alerts, extras, kind_label, window_days)
    delivered_ids = [a["alert_id"] for a in alerts]
    sent_ok = 0
    sent_err = 0
    import asyncio as _asyncio
    import resend  # noqa: WPS433
    resend.api_key = resend_key
    for admin in admins:
        params = {
            "from":    sender,
            "to":      [admin["email"]],
            "subject": subject,
            "html":    html,
            "text":    text,
            "_kind":   f"admin_digest_{kind_label}",
        }
        try:
            await _asyncio.to_thread(resend.Emails.send, params)
            sent_ok += 1
        except Exception as exc:  # noqa: BLE001
            sent_err += 1
            logger.warning("admin digest: send to %s failed: %s", admin["email"], exc)
    await db.admin_pending_alerts.update_many(
        {"alert_id": {"$in": delivered_ids}},
        {"$set": {"status": "delivered", "delivered_at": now}},
    )
    await db.admin_digest_runs.insert_one({
        "kind":         kind_label,
        "sent_at":      now,
        "recipients":   [a["email"] for a in admins],
        "alert_count":  len(alerts),
        "extras":       extras,
        "ok":           sent_ok,
        "errors":       sent_err,
    })
    return {
        "sent":       True,
        "kind":       kind_label,
        "recipients": len(admins),
        "ok":         sent_ok,
        "errors":     sent_err,
        "alerts":     len(alerts),
        "extras":     extras,
    }


async def _digest_extras(window_start: datetime) -> dict[str, int]:
    """Cheap counters to enrich the digest beyond cron alerts."""
    out: dict[str, int] = {}
    try:
        out["new_signups"] = await db.users.count_documents({
            "created_at": {"$gte": window_start.isoformat()},
        })
    except Exception:
        out["new_signups"] = 0
    try:
        out["open_feedback"] = await db.suggestions.count_documents({
            "status":      "open",
            "suggestion_id": {"$exists": True},
        })
    except Exception:
        out["open_feedback"] = 0
    try:
        out["pending_approvals"] = await db.users.count_documents({
            "approval_status": "pending",
        })
    except Exception:
        out["pending_approvals"] = 0
    return out


def _render_digest(
    alerts: list[dict[str, Any]],
    extras: dict[str, int],
    kind_label: str,
    window_days: int,
) -> tuple[str, str, str]:
    """Render the digest HTML + text body.  Pure function — easy to
    unit-test."""
    when = datetime.now(timezone.utc).strftime("%b %d, %Y")
    window_word = "Past 24 h" if window_days == 1 else f"Past {window_days} days"
    label = "Emergency burst alert" if kind_label == "emergency" else "Weekly admin digest"
    subject = f"[Shelfsort] {label} — {when}"

    # Bucket alerts by kind for a clean summary list
    buckets: dict[str, list[dict[str, Any]]] = {}
    for a in alerts:
        buckets.setdefault(a.get("kind", "other"), []).append(a)

    bucket_lines_html: list[str] = []
    bucket_lines_text: list[str] = []
    for kind, items in sorted(buckets.items()):
        total_count = sum(int(it.get("count", 1)) for it in items)
        bucket_lines_html.append(
            f"<li style='margin:6px 0'><strong>{kind}</strong>: {len(items)} unique"
            f"{' (' + str(total_count) + ' total occurrences)' if total_count != len(items) else ''}</li>"
        )
        bucket_lines_text.append(
            f"  * {kind}: {len(items)} unique"
            f"{' (' + str(total_count) + ' total)' if total_count != len(items) else ''}"
        )
        # Detail block — first 5 items per kind
        for it in items[:5]:
            title = it.get("title", "(no title)")
            bucket_lines_html.append(
                f"<li style='margin:2px 0 2px 18px;color:#5b5b5b;font-size:13px'>↳ {title}</li>"
            )
            bucket_lines_text.append(f"      ↳ {title}")
        if len(items) > 5:
            extra = len(items) - 5
            bucket_lines_html.append(
                f"<li style='margin:2px 0 2px 18px;color:#9b9b9b;font-size:12px'>… +{extra} more in /admin</li>"
            )
            bucket_lines_text.append(f"      … +{extra} more in /admin")

    extras_html = "".join(
        f"<li style='margin:4px 0'><strong>{k.replace('_', ' ').title()}</strong>: {v}</li>"
        for k, v in extras.items() if v
    ) or "<li style='color:#888'>No new feedback / sign-ups / pending approvals</li>"

    extras_text = "\n".join(
        f"  * {k.replace('_', ' ').title()}: {v}"
        for k, v in extras.items() if v
    ) or "  (No new feedback / sign-ups / pending approvals)"

    summary_html = "".join(bucket_lines_html) or (
        "<li style='color:#888'>No alerts queued this period — nice and quiet 🌿</li>"
    )
    summary_text = "\n".join(bucket_lines_text) or "  (No alerts queued — quiet week)"

    html = f"""
<div style='font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;line-height:1.55;color:#262626;background:#FBFAF6;padding:24px;border-radius:12px;border:1px solid #E5DDC5'>
  <h2 style='margin:0 0 6px;color:#6B46C1'>{label}</h2>
  <p style='margin:0 0 18px;color:#6B705C;font-size:13px'>{window_word} · sent {when}</p>

  <h3 style='margin:18px 0 6px;font-size:15px'>System alerts</h3>
  <ul style='margin:0;padding-left:20px'>{summary_html}</ul>

  <h3 style='margin:22px 0 6px;font-size:15px'>Operator inbox</h3>
  <ul style='margin:0;padding-left:20px'>{extras_html}</ul>

  <p style='margin:24px 0 4px;font-size:13px;color:#5b5b5b'>
    Open <a href='/admin' style='color:#6B46C1'>/admin</a> for the full bell-icon list of pending alerts.
    To restore immediate-email mode, flip <code>cron_alerts_weekly_batch</code> OFF in /admin → Feature flags.
  </p>
</div>
"""
    text = (
        f"{label}\n"
        f"{window_word} · sent {when}\n\n"
        f"System alerts:\n{summary_text}\n\n"
        f"Operator inbox:\n{extras_text}\n\n"
        f"Open /admin for the full pending-alert list.\n"
        f"Restore immediate-email mode by flipping cron_alerts_weekly_batch OFF.\n"
    )
    return subject, html, text


# ---------------------------------------------------------------------
# Convenience helpers used by routes
# ---------------------------------------------------------------------
async def list_pending_alerts(limit: int = 50) -> list[dict[str, Any]]:
    cursor = db.admin_pending_alerts.find(
        {"status": "pending"},
        {"_id": 0},
    ).sort("last_seen_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def dismiss_alerts(alert_ids: Iterable[str] | None = None) -> int:
    """Mark alerts as dismissed (or all pending alerts if no ids
    given).  Dismissed rows are still kept around for the digest
    history but won't show in the bell."""
    now = datetime.now(timezone.utc)
    q: dict[str, Any] = {"status": "pending"}
    if alert_ids:
        ids = list(alert_ids)
        if not ids:
            return 0
        q["alert_id"] = {"$in": ids}
    res = await db.admin_pending_alerts.update_many(
        q, {"$set": {"status": "dismissed", "delivered_at": now}},
    )
    return res.modified_count
