"""ClamAV watchdog — auto-pause uploads when the scanner is unreachable.

The admin already has a manual "uploads_enabled" feature flag they can
flip from /admin during an incident.  But on a free-tier infra without
an oncall rotation, ClamAV can silently go DOWN on the production pod
(daemon crashed, OOM-killed, container restart blip) and uploads will
keep going through UNSCANNED until someone notices the red "DOWN" card.

This watchdog runs every minute and:

  1. Probes `utils.antivirus.is_available()` (cheap socket-handshake,
     doesn't run a real scan).
  2. If the scanner has been DOWN for ``AV_DOWN_THRESHOLD_MIN`` minutes
     straight, it auto-flips ``uploads_enabled`` OFF, stamps an audit
     log entry tagged ``av.auto_pause``, and writes an admin notification
     so the next admin to log in sees it immediately.
  3. Tracks state in a singleton doc so the down-streak survives pod
     restarts (i.e. a flap that crosses a redeploy still counts).
  4. **Does NOT auto re-enable.** This is intentional — once paused,
     a human eyeballs the situation and flips it back on.  Auto-enable
     would risk flapping uploads on/off if ClamAV bounces.

Idempotent: re-runs while already paused are no-ops.  The watchdog
also gracefully handles the case where ``set_flag`` raises (e.g.
Mongo unreachable) by logging and trying again next tick.

**Disabling in dev/preview**: set ``AV_WATCHDOG_ENABLED=false`` in the
backend .env.  Preview pods don't have clamd installed at all, so the
watchdog would auto-pause every fresh pod after 5 min and block any
local upload testing — disable it there.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from deps import db, logger
from utils import antivirus
from utils.feature_flags import is_enabled, set_flag

# How many consecutive minutes of clamd being unreachable before we
# auto-pause uploads.  5 minutes is short enough that real outages don't
# burn through more than a handful of unscanned uploads, but long enough
# that a single 30-second daemon restart doesn't trigger a false alarm.
AV_DOWN_THRESHOLD_MIN = 5

_STATE_DOC_ID = "av_watchdog_state"


def watchdog_enabled() -> bool:
    """Env-var kill switch for the watchdog itself.

    Defaults ON so production deploys are protected without any extra
    config.  Set ``AV_WATCHDOG_ENABLED=false`` in preview to keep the
    pod usable for upload-flow testing despite clamd not being installed.
    """
    raw = os.environ.get("AV_WATCHDOG_ENABLED", "true")
    return raw.strip().lower() not in ("false", "0", "no", "off")


async def _get_state() -> dict:
    doc = await db.system_health.find_one({"_id": _STATE_DOC_ID}) or {}
    return doc


async def _save_state(*, down_since: Optional[datetime], last_check: datetime, last_status: bool, auto_paused: bool) -> None:
    await db.system_health.update_one(
        {"_id": _STATE_DOC_ID},
        {"$set": {
            "down_since":  down_since.isoformat() if down_since else None,
            "last_check":  last_check.isoformat(),
            "last_status": last_status,
            "auto_paused": auto_paused,
        }},
        upsert=True,
    )


async def _notify_admins_paused(down_for_min: int) -> None:
    """Drop a high-priority notification into every admin's inbox so the
    pause doesn't get noticed only when an admin happens to scroll the
    Antivirus card.  Best-effort — failures here must not block the
    pause itself.
    """
    try:
        admins = await db.users.find(
            {"is_admin": True}, {"user_id": 1, "_id": 0}
        ).to_list(length=1000)
        if not admins:
            return
        now = datetime.now(timezone.utc).isoformat()
        await db.notifications.insert_many([
            {
                "user_id": a["user_id"],
                "kind":    "av_auto_pause",
                "title":   "Uploads auto-paused: ClamAV unreachable",
                "body":    (
                    f"The antivirus scanner has been unreachable for "
                    f"{down_for_min} minutes. Uploads are paused via the "
                    f"uploads_enabled feature flag. Re-enable from /admin "
                    f"once the scanner is healthy again."
                ),
                "read":    False,
                "created_at": now,
            }
            for a in admins
        ])
    except Exception as e:  # noqa: BLE001
        logger.warning("av watchdog: notify_admins failed: %s", e)


async def av_health_watchdog_tick() -> dict:
    """One tick of the watchdog.  Exposed as a coroutine (not a closure)
    so the server.py wiring can pass it directly into APScheduler AND so
    tests can drive it synchronously without spinning up the scheduler.

    Returns a small dict describing what the tick observed/did so the
    `/admin/system-health` endpoint can surface the latest snapshot if
    we want to plumb it through later.
    """
    if not watchdog_enabled():
        return {"available": None, "auto_paused": False, "down_for_min": 0, "skipped": True}
    now = datetime.now(timezone.utc)
    state = await _get_state()
    auto_paused_previously = bool(state.get("auto_paused"))

    # Cheap availability check — does NOT run an EICAR scan, just a
    # socket handshake against clamd.  ~5 ms when healthy.
    available = False
    try:
        available = antivirus.is_available()
    except Exception as e:  # noqa: BLE001
        logger.warning("av watchdog: availability probe raised %s", e)
        available = False

    if available:
        # Healthy — clear the down-streak.  Do NOT auto-unpause uploads;
        # that's an admin decision (see module docstring).
        await _save_state(
            down_since=None, last_check=now,
            last_status=True, auto_paused=auto_paused_previously,
        )
        return {"available": True, "auto_paused": auto_paused_previously, "down_for_min": 0}

    # Scanner is DOWN.  Anchor the down-streak.
    raw_down_since = state.get("down_since")
    down_since: Optional[datetime] = None
    if isinstance(raw_down_since, str):
        try:
            down_since = datetime.fromisoformat(raw_down_since)
        except ValueError:
            down_since = None
    if down_since is None:
        down_since = now

    down_for_min = int((now - down_since).total_seconds() // 60)

    should_pause = (
        down_for_min >= AV_DOWN_THRESHOLD_MIN
        and not auto_paused_previously
        and await is_enabled("uploads_enabled")
    )

    if should_pause:
        try:
            await set_flag("uploads_enabled", False)
            logger.warning(
                "av watchdog: clamd unreachable for %d min → auto-paused "
                "uploads_enabled.  Admin will need to flip it back on "
                "from /admin once the scanner is healthy.",
                down_for_min,
            )
            # Audit log so /admin/audit-log surfaces the pause clearly.
            try:
                await db.audit_log.insert_one({
                    "ts": now.isoformat(),
                    "actor": "system.av_watchdog",
                    "action": "av.auto_pause",
                    "metadata": {
                        "flag": "uploads_enabled",
                        "down_for_min": down_for_min,
                        "threshold_min": AV_DOWN_THRESHOLD_MIN,
                    },
                })
            except Exception as e:  # noqa: BLE001
                logger.warning("av watchdog: audit insert failed: %s", e)
            await _notify_admins_paused(down_for_min)
            auto_paused_previously = True
        except Exception as e:  # noqa: BLE001
            # If the flag write fails, log loudly and let next tick retry.
            logger.error("av watchdog: set_flag failed, will retry: %s", e)

    await _save_state(
        down_since=down_since, last_check=now,
        last_status=False, auto_paused=auto_paused_previously,
    )
    return {
        "available":    False,
        "auto_paused":  auto_paused_previously,
        "down_for_min": down_for_min,
    }
