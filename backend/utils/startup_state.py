"""Startup phase timing + readiness tracker.

Sibling of ``server.py`` — the app moves all heavy DB work into a
background task (``_deferred_startup_migrations``) so uvicorn can
respond to the K8s readiness probe within milliseconds.  This module
gives us a peek into that background task after the fact:

* ``phase("indexes")`` context manager wraps a block, records wall-time,
  and appends a row to the state dict.
* ``mark_finished()`` flips the top-level status to ``"done"`` when the
  outer function returns.
* ``get_state()`` returns a snapshot for the ``/api/health?deep=1``
  endpoint — used to debug slow migrations on prod without needing
  shell access.

Everything is best-effort: a raise inside a phase is caught and the
state is still updated so the operator can see which phase blew up.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterator


_STATE: Dict[str, Any] = {
    "started_at": None,       # ISO string — set when the deferred task starts
    "finished_at": None,      # ISO string — set when the deferred task returns
    "elapsed_seconds": None,  # float — total wall-time
    "status": "not_started",  # "not_started" | "running" | "done" | "failed"
    "phases": [],             # list of {name, elapsed_seconds, ok, error?}
    "current_phase": None,    # name of the phase in flight (nullable)
    "boot_id": None,          # copied from routes.health.BOOT_ID for correlation
}


def mark_start(boot_id: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    _STATE["started_at"] = now.isoformat()
    _STATE["finished_at"] = None
    _STATE["elapsed_seconds"] = None
    _STATE["status"] = "running"
    _STATE["phases"] = []
    _STATE["current_phase"] = None
    _STATE["boot_id"] = boot_id
    _STATE["_start_monotonic"] = time.monotonic()


def mark_finished(ok: bool = True) -> None:
    if _STATE.get("_start_monotonic") is not None:
        _STATE["elapsed_seconds"] = round(time.monotonic() - _STATE["_start_monotonic"], 3)
    _STATE["finished_at"] = datetime.now(timezone.utc).isoformat()
    _STATE["status"] = "done" if ok else "failed"
    _STATE["current_phase"] = None


@contextmanager
def phase(name: str) -> Iterator[None]:
    """Record wall-time for a named phase.

    Usage:
        with phase("indexes"):
            await db.users.create_index("email", unique=True)
            ...
    """
    begin_phase(name)
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        end_phase(ok=ok)


# Explicit begin/end variants for cases where re-indenting a large
# existing try/except block into a `with phase(...):` would touch too
# many lines.  Prefer the context manager when possible.
def begin_phase(name: str) -> None:
    _STATE["current_phase"] = name
    _STATE["_phase_started"] = time.monotonic()
    _STATE["_phase_name"] = name


def end_phase(ok: bool = True, error: str | None = None) -> None:
    started = _STATE.pop("_phase_started", None)
    name = _STATE.pop("_phase_name", None) or _STATE.get("current_phase") or "(unknown)"
    elapsed = round(time.monotonic() - started, 3) if started else None
    row: Dict[str, Any] = {"name": name, "ok": ok, "elapsed_seconds": elapsed}
    if error:
        row["error"] = str(error)[:400]
    _STATE["phases"].append(row)
    _STATE["current_phase"] = None


def get_state() -> Dict[str, Any]:
    """Snapshot for /api/health?deep=1.  Never mutates the state."""
    # Copy so callers can't accidentally poke the internal dict.
    snap = {k: v for k, v in _STATE.items() if not k.startswith("_")}
    return snap


async def persist_boot_row(db, budget_seconds: float) -> None:
    """Write the finished boot's timing to ``db.startup_timings`` so the
    admin sparkline + deploy-health probe can trend across deploys.

    Idempotent per boot_id — a re-run for the same boot updates the
    existing row.  Only writes when the state is ``done`` or ``failed``
    (skips ``running``/``not_started`` so we never persist a partial
    snapshot).  Includes a 90-day TTL so the collection doesn't grow
    unboundedly — the admin sparkline only needs the last ~20 boots.
    """
    snap = get_state()
    status = snap.get("status")
    if status not in ("done", "failed"):
        return
    boot_id = snap.get("boot_id")
    if not boot_id:
        return
    from datetime import datetime as _dt, timezone as _tz
    elapsed = snap.get("elapsed_seconds") or 0
    row = {
        "boot_id":         boot_id,
        "started_at":      snap.get("started_at"),
        "finished_at":     snap.get("finished_at"),
        "elapsed_seconds": elapsed,
        "status":          status,
        "phases":          snap.get("phases", []),
        "budget_seconds":  budget_seconds,
        "over_budget":     elapsed > budget_seconds,
        "over_budget_2x":  elapsed > 2 * budget_seconds,
        "created_at":      _dt.now(_tz.utc),
    }
    try:
        await db.startup_timings.update_one(
            {"boot_id": boot_id},
            {"$set": row},
            upsert=True,
        )
        # 90-day TTL — created_at is a real datetime so Mongo can index it.
        await db.startup_timings.create_index(
            "created_at",
            expireAfterSeconds=90 * 24 * 3600,
            name="startup_timings_ttl_90d",
        )
    except Exception:  # noqa: BLE001
        # Never let telemetry failure break boot.
        pass
