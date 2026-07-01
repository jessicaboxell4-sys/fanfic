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

There is also a tiny ``GET /api/version`` endpoint used by the frontend
``NewVersionBanner`` to detect deploys.  Every backend process boot
generates a fresh ``boot_id`` UUID — when the frontend sees that
change, it shows a "refresh for the latest version" banner.  No
admin involvement required; every redeploy is announced
automatically.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from deps import api_router, db


# ---------------------------------------------------------------------------
# Process-lifetime identifiers (generated once when this module is imported,
# which happens during backend startup).  A new container = new BOOT_ID, so
# the frontend can reliably tell when a deploy has just landed.
# ---------------------------------------------------------------------------
BOOT_ID = uuid.uuid4().hex[:12]
BOOT_TIME = datetime.now(timezone.utc).isoformat()


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
        # If AV_DISABLED=1 is set, the operator has deliberately turned
        # off virus scanning (e.g. 2 Gi pod tier that can't afford
        # clamd/clamscan memory).  Report ok=True with a distinct
        # ``disabled`` flag so /api/health doesn't fall into "degraded"
        # forever — the state IS the desired steady state.
        if os.environ.get("AV_DISABLED", "").lower() in ("1", "true", "yes"):
            return {"ok": True, "available": False, "disabled": True}
        available = antivirus.is_available()
        # AV being absent (without the explicit disable) is "degraded" —
        # we still allow uploads but they're unscanned, so flag it.
        # The eicar liveness check lives on
        # /api/admin/antivirus/status so we don't burn 10ms+ on every
        # /health hit from a monitor.
        return {"ok": available, "available": available}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _probe_env_config() -> Dict[str, Any]:
    """Surface the startup env-config self-check on the public health
    probe so the canary turns red the moment a deploy lands with
    missing MONGO_URL / DB_NAME / CORS_ORIGINS (the prod-outage
    fingerprint that caused 3 shelfsort.com 520 incidents)."""
    try:
        from utils import env_check
        return {
            "ok": env_check.CONFIG_OK,
            "findings": env_check.CONFIG_FINDINGS,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _probe_pod_memory() -> Dict[str, Any]:
    """Cgroup-v2 memory snapshot for the pod.  See utils/memory_canary
    for the rationale — two prod OOMKill incidents in 4 days motivated
    the always-on canary; surfacing it on /api/health lets the admin
    dashboard render a live "Pod: N% / X GB" pill without needing a
    separate endpoint.

    Returns ``{ok, available, used_mb, limit_mb, pct, over_warn}``.
    ``ok`` is True even when memory is high — the health endpoint's
    top-level ``status`` shouldn't flip degraded just because we're
    under memory pressure (that's what ``over_warn`` is for)."""
    try:
        from utils import memory_canary
        snap = memory_canary.sample_pod_memory()
        if snap is None:
            return {"ok": True, "available": False}
        return {
            "ok":         True,
            "available":  True,
            "used_mb":    snap["used_mb"],
            "limit_mb":   snap["limit_mb"],
            "pct":        snap["pct"],
            "over_warn":  snap["over_warn"],
        }
    except Exception as e:
        return {"ok": True, "available": False, "error": str(e)[:200]}


# ---------------------------------------------------------------------------
# Public endpoint
# ---------------------------------------------------------------------------
@api_router.get("/health")
async def health():
    mongo = await _probe_mongo()
    scheduler = _probe_scheduler()
    storage = _probe_storage()
    av = _probe_antivirus()
    env_config = _probe_env_config()
    pod_memory = _probe_pod_memory()

    # Mongo + env-config are the hard deps. A pod booting with no
    # MONGO_URL would already be crash-looping, but env_config also
    # catches the "MONGO_URL set but malformed" case that motor would
    # silently fail on.
    critical_ok = mongo["ok"] and env_config["ok"]
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
        "boot_id":   BOOT_ID,
        "checks": {
            "mongo":      mongo,
            "scheduler":  scheduler,
            "storage":    storage,
            "antivirus":  av,
            "env_config": env_config,
            "pod_memory": pod_memory,
        },
    }


@api_router.get("/version")
async def app_version():
    """Tiny endpoint the frontend polls every ~60s to detect deploys.

    Every backend process boot picks a fresh ``boot_id`` (see top of
    module).  When the frontend sees the value change from what it
    captured on initial page load, it surfaces a non-blocking
    "Refresh for the latest version" banner — the user keeps scrolling
    until they're ready, then one click reloads them into the new bundle.

    This is unauthenticated and cache-buster-safe: clients should
    fetch with no caching headers (the frontend uses axios which
    inherits the same ``no-store`` we already set globally).
    """
    return {
        "version": os.environ.get("APP_VERSION", "dev"),
        "boot_id": BOOT_ID,
        "build_time": BOOT_TIME,
    }
