"""Lightweight readiness/liveness probe for deploys + uptime monitors.

``GET /api/health`` returns a JSON blob with the state of every external
dependency we care about:

  - Mongo connectivity (``ping`` admin command)
  - APScheduler running status + job count
  - Emergent Object Storage availability
  - App version / git sha (best-effort from env)

The endpoint deliberately stays unauthenticated so monitors like
UptimeRobot/BetterStack can hit it without juggling secrets, and it
*always returns HTTP 200* with ``status: "ok" | "degraded" | "down"``
so a monitor can branch on the JSON body rather than relying on HTTP
codes (which proxies sometimes flatten to 502).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict

from deps import api_router, db


# ---------------------------------------------------------------------------
# Per-dependency probes — each returns (ok: bool, detail: dict).
# Wrapped in narrow ``try`` blocks so one failing probe never tanks the rest.
# ---------------------------------------------------------------------------
async def _probe_mongo() -> Dict[str, Any]:
    try:
        await db.command("ping")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _probe_scheduler() -> Dict[str, Any]:
    try:
        from routes import digest as _digest
        sched = getattr(_digest, "_scheduler", None)
        if sched is None:
            return {"ok": False, "error": "scheduler not started"}
        running = bool(getattr(sched, "running", False))
        jobs = sched.get_jobs() if running else []
        return {
            "ok": running,
            "running": running,
            "job_count": len(jobs),
            "job_ids": [j.id for j in jobs],
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _probe_storage() -> Dict[str, Any]:
    try:
        from utils import storage_cloud
        enabled = storage_cloud.is_enabled()
        if not enabled:
            # Not a failure — local-disk fallback is a supported mode.
            return {"ok": True, "enabled": False, "mode": "local"}
        return {"ok": True, "enabled": True, "mode": "emergent_object_storage"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _probe_antivirus() -> Dict[str, Any]:
    try:
        from utils import antivirus
        available = antivirus.is_available()
        # AV being absent is "degraded" (we still allow uploads but
        # they're unscanned), so flag it but don't mark the system
        # down.  The eicar liveness check lives on
        # /api/admin/antivirus/status so we don't burn 10ms+ on every
        # /health hit from a monitor.
        return {"ok": available, "available": available}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ---------------------------------------------------------------------------
# Public endpoint
# ---------------------------------------------------------------------------
@api_router.get("/health")
async def health():
    mongo = await _probe_mongo()
    scheduler = _probe_scheduler()
    storage = _probe_storage()
    av = _probe_antivirus()

    critical_ok = mongo["ok"]  # Mongo is the only hard dep.
    degraded = not (scheduler["ok"] and storage["ok"] and av["ok"])

    if not critical_ok:
        status = "down"
    elif degraded:
        status = "degraded"
    else:
        status = "ok"

    return {
        "status":    status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version":   os.environ.get("APP_VERSION", "dev"),
        "checks": {
            "mongo":      mongo,
            "scheduler":  scheduler,
            "storage":    storage,
            "antivirus":  av,
        },
    }
