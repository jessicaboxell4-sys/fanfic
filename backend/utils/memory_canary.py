"""Pod memory canary — early-warning signal for OOMKill loops.

We hit two prod OOM incidents in 4 days (2026-06-30 upload-burst, 2026-07-01
clamd steady-state).  In both cases the failure mode was the same: Cloudflare
started returning 520 with no forewarning, because the pod was OOMKilled and
Kubernetes was silently restarting it.

This canary reads the pod's cgroup-v2 memory usage every minute and logs a
WARNING when we cross 80% of the memory limit — enough warning to let an
operator see it coming, add capacity, or trip a feature flag before real
users notice.

The signal is intentionally very cheap:
  * `/sys/fs/cgroup/memory.current` — total resident bytes for the cgroup
    (includes uvicorn + any subprocesses we've spawned, e.g. clamd, calibre).
  * `/sys/fs/cgroup/memory.max`     — the K8s pod's memory limit in bytes.

Every tick also inserts one row into `db.pod_memory_samples` (48-hour TTL) so
the admin console can render a 48-hour sparkline — long enough that a spike
overnight is still visible when the operator checks in the morning after.

No `psutil` dependency; both files are readable by any process in the pod.

Falls back cleanly on non-Linux (dev laptops) or cgroup-v1 hosts — logs an
INFO once at startup that the canary is disabled and no-ops thereafter.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

from deps import db


logger = logging.getLogger(__name__)

_CGROUP_MAX = Path("/sys/fs/cgroup/memory.max")
_CGROUP_CURRENT = Path("/sys/fs/cgroup/memory.current")

# Env-tunable thresholds so operators can tighten/loosen without a code change.
_WARN_PCT = int(os.environ.get("POD_MEM_WARN_PCT", "80"))
_INFO_PCT = int(os.environ.get("POD_MEM_INFO_PCT", "60"))

# Guard against log flooding: only re-log at the same severity every N ticks.
# One tick = 1 minute (see server.py scheduler wiring), so N=15 = quarter-hour.
_REPEAT_TICKS = int(os.environ.get("POD_MEM_REPEAT_TICKS", "15"))
_state: Dict[str, int] = {"last_warn_tick": -_REPEAT_TICKS, "last_info_tick": -_REPEAT_TICKS, "tick": 0}

# 48-hour retention on the sample history.  Life happens — operator might
# not check until the morning after a Friday-night spike.
_HISTORY_TTL_SECONDS = 48 * 60 * 60
_HISTORY_MAX_HOURS = 48


def _read_int(p: Path) -> Optional[int]:
    try:
        txt = p.read_text().strip()
    except Exception:
        return None
    # cgroup-v2 "memory.max" reports "max" (unlimited) as a literal string.
    if txt == "max":
        return None
    try:
        return int(txt)
    except ValueError:
        return None


def sample_pod_memory() -> Optional[Dict[str, object]]:
    """Return a snapshot of the pod's memory usage vs its cgroup limit, or
    ``None`` when we can't read the cgroup (dev laptop, cgroup-v1, etc.)."""
    used = _read_int(_CGROUP_CURRENT)
    limit = _read_int(_CGROUP_MAX)
    if used is None or limit is None or limit <= 0:
        return None
    pct = round((used / limit) * 100, 1)
    return {
        "used_bytes":  used,
        "limit_bytes": limit,
        "used_mb":     round(used / (1024 * 1024), 1),
        "limit_mb":    round(limit / (1024 * 1024), 1),
        "pct":         pct,
        "over_warn":   pct >= _WARN_PCT,
        "sampled_at":  datetime.now(timezone.utc).isoformat(),
    }


async def pod_memory_canary_tick() -> Dict[str, object]:
    """APScheduler tick — sample cgroup memory, log if we cross a threshold,
    persist one row to ``db.pod_memory_samples`` for the 48-hour history
    sparkline.

    Returns the sample dict so tests + `/api/health` can plumb it through
    if we ever want to surface it in the admin dashboard."""
    _state["tick"] += 1
    snap = sample_pod_memory()
    if snap is None:
        return {"skipped": True, "reason": "cgroup unreadable"}

    pct = float(snap["pct"])  # type: ignore[arg-type]
    tick = _state["tick"]

    if pct >= _WARN_PCT and (tick - _state["last_warn_tick"]) >= _REPEAT_TICKS:
        logger.warning(
            "pod memory canary: %s%% used (%s MB / %s MB) — OOMKill risk. "
            "Consider raising the memory tier, disabling clamd daemon, or "
            "pausing uploads. Env vars: POD_MEM_WARN_PCT=%s, POD_MEM_REPEAT_TICKS=%s.",
            snap["pct"], snap["used_mb"], snap["limit_mb"],
            _WARN_PCT, _REPEAT_TICKS,
        )
        _state["last_warn_tick"] = tick
    elif pct >= _INFO_PCT and (tick - _state["last_info_tick"]) >= _REPEAT_TICKS:
        logger.info(
            "pod memory canary: %s%% used (%s MB / %s MB).",
            snap["pct"], snap["used_mb"], snap["limit_mb"],
        )
        _state["last_info_tick"] = tick

    # Persist a compact row for the 48-hour history sparkline.  Wrapped in
    # try/except so a Mongo blip never kills the canary tick — this is a
    # nice-to-have signal, not a hard dep.
    try:
        await db.pod_memory_samples.insert_one({
            "sampled_at": datetime.now(timezone.utc),
            "pct":        snap["pct"],
            "used_mb":    snap["used_mb"],
            "limit_mb":   snap["limit_mb"],
        })
    except Exception as e:  # noqa: BLE001
        logger.debug("pod_memory_samples insert failed (non-fatal): %s", e)

    return snap


async def ensure_indexes() -> None:
    """Idempotent — creates the 48h TTL indexes on ``pod_memory_samples``
    and ``pod_boots``.  Called from server.py startup alongside the other
    index-create sweeps."""
    try:
        # Mongo TTL granularity is ~60s so 48h is exact enough for our
        # "did we OOM overnight?" use case.
        await db.pod_memory_samples.create_index(
            "sampled_at", expireAfterSeconds=_HISTORY_TTL_SECONDS,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("pod_memory_samples TTL index create failed: %s", e)
    try:
        # 48h TTL on pod-boot events too — anything older than the
        # sparkline window is irrelevant for the "did a deploy cause
        # this spike?" question.
        await db.pod_boots.create_index(
            "booted_at", expireAfterSeconds=_HISTORY_TTL_SECONDS,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("pod_boots TTL index create failed: %s", e)


async def record_boot(boot_id: str) -> None:
    """One-shot insert on backend startup — records this pod's boot so
    the sparkline can draw a vertical marker at every deploy boundary.
    Best-effort; a Mongo blip here shouldn't crash the app boot."""
    try:
        await db.pod_boots.insert_one({
            "boot_id":   boot_id,
            "booted_at": datetime.now(timezone.utc),
        })
    except Exception as e:  # noqa: BLE001
        logger.warning("pod_boots insert failed (non-fatal): %s", e)


async def load_history(hours: int = _HISTORY_MAX_HOURS, max_points: int = 288) -> Dict[str, object]:
    """Return the pod-memory sample history for the last ``hours`` hours,
    downsampled to at most ``max_points`` points so an admin popover
    doesn't have to render 2880 SVG nodes.

    Downsample strategy: bucket the samples into ``max_points`` equal-time
    buckets and take the *peak* pct per bucket — peaks are what matter for
    an OOM investigation, not averages.

    Also returns any deploy-boundary events (pod boots) inside the window
    so the frontend can overlay vertical marker lines — turns the passive
    sparkline into an active regression detector ("did the spike start
    right after our deploy, or was it already climbing?").
    """
    hours = max(1, min(int(hours), _HISTORY_MAX_HOURS))
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    try:
        cursor = db.pod_memory_samples.find(
            {"sampled_at": {"$gte": since}},
            {"_id": 0, "sampled_at": 1, "pct": 1, "used_mb": 1, "limit_mb": 1},
        ).sort("sampled_at", 1)
        rows = [r async for r in cursor]
    except Exception as e:  # noqa: BLE001
        logger.warning("pod_memory_samples read failed: %s", e)
        rows = []

    # Deploy boundaries inside the window — one per pod boot.  Cheap read;
    # 48 h × ~1 deploy/hour worst case = ~50 docs.
    deploys = []
    try:
        cursor = db.pod_boots.find(
            {"booted_at": {"$gte": since}},
            {"_id": 0, "booted_at": 1, "boot_id": 1},
        ).sort("booted_at", 1)
        async for r in cursor:
            ts = r.get("booted_at")
            deploys.append({
                "t":       ts.isoformat() if hasattr(ts, "isoformat") else ts,
                "boot_id": r.get("boot_id"),
            })
    except Exception as e:  # noqa: BLE001
        logger.warning("pod_boots read failed: %s", e)

    if not rows:
        return {"points": [], "deploys": deploys, "hours": hours, "peak_pct": None, "downsampled": False}

    def _row_to_point(r):
        ts = r["sampled_at"]
        return {
            "t":        ts.isoformat() if hasattr(ts, "isoformat") else ts,
            "pct":      r.get("pct"),
            "used_mb":  r.get("used_mb"),
            "limit_mb": r.get("limit_mb"),
        }

    if len(rows) <= max_points:
        points = [_row_to_point(r) for r in rows]
        return {
            "points":      points,
            "deploys":     deploys,
            "hours":       hours,
            "peak_pct":    max((p["pct"] for p in points if p["pct"] is not None), default=None),
            "downsampled": False,
        }

    # Bucket-max downsample — peaks matter for OOM diagnostics, not averages.
    bucket_size = len(rows) / max_points
    points = []
    for i in range(max_points):
        start = int(i * bucket_size)
        end = int((i + 1) * bucket_size) or (start + 1)
        chunk = rows[start:end] or [rows[start]]
        peak_row = max(chunk, key=lambda r: r.get("pct") or 0)
        points.append(_row_to_point(peak_row))
    return {
        "points":      points,
        "deploys":     deploys,
        "hours":       hours,
        "peak_pct":    max((p["pct"] for p in points if p["pct"] is not None), default=None),
        "downsampled": True,
    }


__all__ = ["sample_pod_memory", "pod_memory_canary_tick", "ensure_indexes", "record_boot", "load_history"]
