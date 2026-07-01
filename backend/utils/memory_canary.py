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

No `psutil` dependency; both files are readable by any process in the pod.

Falls back cleanly on non-Linux (dev laptops) or cgroup-v1 hosts — logs an
INFO once at startup that the canary is disabled and no-ops thereafter.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional


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
    """APScheduler tick — sample cgroup memory, log if we cross a threshold.

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

    return snap


__all__ = ["sample_pod_memory", "pod_memory_canary_tick"]
