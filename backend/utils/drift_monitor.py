"""Proactive prod-vs-source drift monitor.

Runs the ``scripts/deploy_drift_check.py`` script on a schedule, stores
the latest result in Mongo (``drift_check_results`` collection, one
row per run), and exposes it to the admin console via the
``GET /api/admin/drift-status`` endpoint.

Added 2026-07-08 after the deploy that shipped a source tree with 19
missing testids — proactive detection catches drift the moment it
appears, not at deploy time.  The pre-deploy drift check in the SOP
still runs as the hard gate.
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCRIPT_PATH = Path("/app/scripts/deploy_drift_check.py")
RESULTS_COLLECTION = "drift_check_results"
# Only keep the last N runs — the collection is small and this keeps it
# from growing unboundedly.
KEEP_RECENT_RUNS = 168  # ~1 week at hourly ticks


async def run_drift_check_once(db) -> dict[str, Any]:
    """Invoke the drift-check script in a subprocess, capture output,
    persist a summary row.  Returns the summary dict.

    Non-crashing — any error in the check itself is captured as
    ``status="error"`` on the row so the endpoint can still surface it.
    """
    started_at = datetime.now(timezone.utc)
    if not SCRIPT_PATH.exists():
        row = {
            "checked_at":  started_at.isoformat(),
            "status":      "error",
            "error":       f"drift-check script missing at {SCRIPT_PATH}",
            "prod_testid_count": None,
            "drift_count": None,
            "drift":       [],
        }
        await _persist(db, row)
        return row

    proc = await asyncio.create_subprocess_exec(
        "python3", str(SCRIPT_PATH),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        row = {
            "checked_at":  started_at.isoformat(),
            "status":      "timeout",
            "error":       "drift check ran longer than 60s (fetch stall?)",
            "prod_testid_count": None,
            "drift_count": None,
            "drift":       [],
        }
        await _persist(db, row)
        return row

    stdout = stdout_b.decode("utf-8", "replace")
    # Parse the output — script prints lines like:
    #   → 2,013 distinct data-testid values in prod bundle
    #   🔴 19 testid(s) in prod but MISSING from source ...
    #       - dismissal-
    #       - ...
    prod_count = _grab_int(stdout, r"→\s+([\d,]+)\s+distinct")
    drift_count = _grab_int(stdout, r"prod-only \(drift\):\s+([\d,]+)")
    drift_items = []
    in_list = False
    for line in stdout.splitlines():
        if "MISSING from source" in line:
            in_list = True
            continue
        if in_list:
            s = line.strip()
            if s.startswith("- "):
                drift_items.append(s[2:].strip())
            else:
                # empty line or new section ends the list
                if not s or s.startswith("...") or s.startswith("Summary"):
                    in_list = False

    status = "ok" if proc.returncode == 0 else ("drift" if proc.returncode == 1 else "error")
    row = {
        "checked_at":  started_at.isoformat(),
        "status":      status,
        "exit_code":   proc.returncode,
        "prod_testid_count": prod_count,
        "drift_count": drift_count if drift_count is not None else len(drift_items),
        "drift":       drift_items,
    }
    await _persist(db, row)
    if drift_items:
        logger.warning(
            "Drift monitor: %d testid(s) in prod but missing from source: %s",
            len(drift_items),
            ", ".join(drift_items[:10]) + (" ..." if len(drift_items) > 10 else ""),
        )
    else:
        logger.info("Drift monitor: prod ↔ source parity OK (%s testids checked)", prod_count)
    return row


async def _persist(db, row: dict[str, Any]) -> None:
    """Insert the result row and trim the collection to KEEP_RECENT_RUNS."""
    try:
        await db[RESULTS_COLLECTION].insert_one(row.copy())
        cursor = db[RESULTS_COLLECTION].find({}, {"_id": 1}).sort("checked_at", -1).skip(KEEP_RECENT_RUNS)
        to_delete = [d["_id"] async for d in cursor]
        if to_delete:
            await db[RESULTS_COLLECTION].delete_many({"_id": {"$in": to_delete}})
    except Exception as e:
        logger.warning("Drift monitor persist failed (non-fatal): %s", e)


def _grab_int(text: str, pattern: str) -> int | None:
    import re
    m = re.search(pattern, text)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except (ValueError, IndexError):
        return None


async def latest_drift_result(db) -> dict[str, Any] | None:
    """Return the most recent drift-check result or None if never run."""
    row = await db[RESULTS_COLLECTION].find_one(
        {},
        {"_id": 0},
        sort=[("checked_at", -1)],
    )
    return row
