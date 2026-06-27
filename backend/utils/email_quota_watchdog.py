"""Email-quota watchdog — auto-pause Resend outbound when we're
forecasted to blow past the daily free-tier cap.

Pattern mirrors ``utils/av_watchdog.py``: a single cron tick that
reads the current state, evaluates an automated kill-switch, and
notifies admins.  Crucially, like the AV watchdog, this module
**does NOT auto-unpause**.  Once the brake is on, the operator
explicitly decides when to flip ``outbound_emails_enabled`` back
to True (after upgrading the Resend plan, pausing a noisy cron,
or auditing what blew up the volume).

Trigger logic
-------------
Each tick we call ``email_volume_forecast()`` and inspect:

* ``warning_level == "critical"`` — the 7-day moving daily-average
  (or the projected weekly daily-average) is at or above the
  100/day cap.  This is the operator-visible "we've hit it" state.
* ``cliff_eta_days is not None and cliff_eta_days <= 1`` —
  the linear projection says we'll cross the cap within 24h.
  Pre-emptive pause, gives the operator a buffer to react.

When either is true AND the flag is currently ON AND we haven't
auto-paused already, we:

1. Flip ``outbound_emails_enabled`` → False (silences `_patched_send`
   in ``email_suppression.py`` for any subsequent ``resend.Emails.send``
   call).
2. Write an ``audit_log`` row tagged ``email.auto_pause`` so the
   operator's audit trail surfaces it.
3. Drop an in-app notification into every admin's ``notifications``
   queue — same shape as the AV watchdog so it lights up
   ``/admin → Alerts``.
4. Append to ``admin_pending_alerts`` so the Sunday weekly admin
   digest also fans it out via email (only one will actually send —
   the others get queued as in-app notifications since outbound is
   now off).
5. Persist the auto-pause flag in ``system_health`` so we never
   double-fire the alerts on subsequent ticks while the brake is
   still on.

When ``available`` returns to a healthy level the watchdog records
the recovery but leaves the flag OFF — explicit operator action
required to resume sending.  Same safety posture as the AV pause.

Schedule
--------
Wired in ``routes/digest.py`` at the same place the other crons
register.  Cadence: **every 2 hours**.  The forecast itself runs
on 7-day averages so faster polling adds no signal, and 2h gives
enough resolution to catch a sudden cron-fanout spike between
runs without burning Mongo reads.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from deps import db, logger
from utils.feature_flags import is_enabled, set_flag
from utils.email_volume_forecast import email_volume_forecast


_STATE_DOC_ID = "email_quota_watchdog"


def watchdog_enabled() -> bool:
    """Hard kill-switch for the watchdog itself.

    Set ``EMAIL_QUOTA_WATCHDOG_DISABLED=1`` in env to silence the
    automation entirely (e.g. when the operator is doing controlled
    quota testing and doesn't want auto-pause to interfere).  Default
    OFF the disable, i.e. watchdog is ON.
    """
    return os.environ.get("EMAIL_QUOTA_WATCHDOG_DISABLED", "0").lower() not in ("1", "true", "yes")


async def _get_state() -> dict:
    doc = await db.system_health.find_one({"_id": _STATE_DOC_ID}) or {}
    return doc


async def _save_state(*, last_check: datetime, last_warning: str, auto_paused: bool, last_metrics: dict) -> None:
    await db.system_health.update_one(
        {"_id": _STATE_DOC_ID},
        {"$set": {
            "last_check":   last_check.isoformat(),
            "last_warning": last_warning,
            "auto_paused":  auto_paused,
            # Snapshot of the forecast metrics that triggered the
            # decision — handy for the audit log and for any
            # follow-up dashboard surfacing later.
            "last_metrics": last_metrics,
        }},
        upsert=True,
    )


async def _notify_admins_paused(reason: str, forecast: dict) -> None:
    """Drop an in-app notification into every admin's queue so the
    pause doesn't get noticed only when an admin opens the Email
    Volume card.  Best-effort — failures here must not block the
    pause itself (the flag is already flipped by the time we get here).
    """
    try:
        admins = await db.users.find(
            {"is_admin": True}, {"user_id": 1, "_id": 0}
        ).to_list(length=1000)
        if not admins:
            return
        now = datetime.now(timezone.utc).isoformat()
        daily_avg = forecast.get("daily_avg_7d", 0)
        forecast_avg = forecast.get("forecast_daily_avg", 0)
        cap = forecast.get("daily_cap", 100)
        body = (
            f"Outbound email auto-paused: {reason}.  "
            f"7-day avg = {daily_avg}/day · forecast = {forecast_avg}/day · "
            f"cap = {cap}/day.  Real emails are being suppressed and queued "
            f"as in-app notifications instead.  Re-enable from /admin → "
            f"Feature flags → outbound_emails_enabled once you've audited "
            f"the spike (most common cause: cron-failure fan-out)."
        )
        await db.notifications.insert_many([
            {
                "user_id": a["user_id"],
                "kind":    "email_quota_auto_pause",
                "title":   "Outbound email auto-paused: Resend quota guard",
                "body":    body,
                "read":    False,
                "created_at": now,
            }
            for a in admins
        ])
    except Exception as e:  # noqa: BLE001
        logger.warning("email_quota watchdog: notify_admins failed: %s", e)


async def _enqueue_admin_alert(reason: str, forecast: dict) -> None:
    """Append to ``admin_pending_alerts`` so the Sunday weekly admin
    digest cron picks this up alongside the other queued signals.
    Best-effort — like ``_notify_admins_paused`` above, a failure here
    must not block the pause itself.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.admin_pending_alerts.insert_one({
            "kind":       "email_quota_auto_pause",
            "title":      "Outbound email auto-paused",
            "summary":    reason,
            "created_at": now,
            "metadata":   {
                "daily_avg_7d":         forecast.get("daily_avg_7d"),
                "forecast_daily_avg":   forecast.get("forecast_daily_avg"),
                "forecast_daily_pct":   forecast.get("forecast_daily_pct"),
                "warning_level":        forecast.get("warning_level"),
                "cliff_eta_days":       forecast.get("cliff_eta_days"),
            },
        })
    except Exception as e:  # noqa: BLE001
        logger.warning("email_quota watchdog: enqueue admin alert failed: %s", e)


def _classify_trigger(forecast: dict) -> Optional[str]:
    """Decide whether the current forecast warrants an auto-pause.

    Returns a short human-readable reason when we should pause, or
    None when current conditions are fine.  Kept as a pure function
    so tests can drive it without DB I/O.
    """
    level = forecast.get("warning_level")
    cliff = forecast.get("cliff_eta_days")
    if level == "critical":
        daily_avg = forecast.get("daily_avg_7d", 0)
        forecast_avg = forecast.get("forecast_daily_avg", 0)
        cap = forecast.get("daily_cap", 100)
        if daily_avg >= cap:
            return f"7-day average of {daily_avg}/day has reached the {cap}/day cap"
        return f"forecasted average of {forecast_avg}/day has reached the {cap}/day cap"
    if cliff is not None and cliff <= 1:
        return f"linear projection puts us over the cap within {cliff} day(s)"
    return None


async def email_quota_watchdog_tick() -> dict:
    """One tick of the watchdog.  Exposed as a coroutine (not a
    closure) so ``digest.py``'s scheduler wiring can pass it directly
    into APScheduler AND so tests can drive it synchronously without
    spinning up the scheduler.

    Returns a small dict describing what the tick observed/did so the
    cron-runs log + any later admin surfacing has machine-readable
    breadcrumbs to render.
    """
    if not watchdog_enabled():
        return {"warning_level": None, "auto_paused": False, "skipped": True}

    now = datetime.now(timezone.utc)
    state = await _get_state()
    auto_paused_previously = bool(state.get("auto_paused"))

    try:
        forecast = await email_volume_forecast()
    except Exception as e:  # noqa: BLE001
        # If the forecast itself fails (e.g. Mongo blip) we DO NOT
        # auto-pause on absence of data — that would be brittle.
        # Log and bail; the next tick will retry.
        logger.warning("email_quota watchdog: forecast failed, skipping tick: %s", e)
        return {"warning_level": None, "auto_paused": auto_paused_previously, "error": str(e)[:200]}

    level = forecast.get("warning_level", "ok")
    reason = _classify_trigger(forecast)
    should_pause = (
        reason is not None
        and not auto_paused_previously
        and await is_enabled("outbound_emails_enabled")
    )

    if should_pause:
        try:
            await set_flag("outbound_emails_enabled", False)
            logger.warning(
                "email_quota watchdog: %s → auto-paused outbound_emails_enabled. "
                "Admin will need to flip it back on from /admin once the "
                "spike has been audited.",
                reason,
            )
            # Audit trail
            try:
                await db.audit_log.insert_one({
                    "ts":     now.isoformat(),
                    "actor":  "system.email_quota_watchdog",
                    "action": "email.auto_pause",
                    "metadata": {
                        "flag":               "outbound_emails_enabled",
                        "reason":             reason,
                        "warning_level":      level,
                        "daily_avg_7d":       forecast.get("daily_avg_7d"),
                        "forecast_daily_avg": forecast.get("forecast_daily_avg"),
                        "forecast_daily_pct": forecast.get("forecast_daily_pct"),
                        "cliff_eta_days":     forecast.get("cliff_eta_days"),
                        "daily_cap":          forecast.get("daily_cap"),
                    },
                })
            except Exception as e:  # noqa: BLE001
                logger.warning("email_quota watchdog: audit insert failed: %s", e)
            await _notify_admins_paused(reason, forecast)
            await _enqueue_admin_alert(reason, forecast)
            auto_paused_previously = True
        except Exception as e:  # noqa: BLE001
            # Flag write failed — let next tick retry rather than
            # spamming alerts every 2h on a transient Mongo blip.
            logger.error("email_quota watchdog: set_flag failed, will retry next tick: %s", e)

    await _save_state(
        last_check=now,
        last_warning=level,
        auto_paused=auto_paused_previously,
        last_metrics={
            "daily_avg_7d":       forecast.get("daily_avg_7d"),
            "forecast_daily_avg": forecast.get("forecast_daily_avg"),
            "forecast_daily_pct": forecast.get("forecast_daily_pct"),
            "cliff_eta_days":     forecast.get("cliff_eta_days"),
            "warning_level":      level,
        },
    )
    return {
        "warning_level":      level,
        "auto_paused":        auto_paused_previously,
        "reason":             reason,
        "daily_avg_7d":       forecast.get("daily_avg_7d"),
        "forecast_daily_avg": forecast.get("forecast_daily_avg"),
        "cliff_eta_days":     forecast.get("cliff_eta_days"),
    }


__all__ = [
    "email_quota_watchdog_tick",
    "watchdog_enabled",
    "_classify_trigger",  # exported for unit testing the pure logic
]
