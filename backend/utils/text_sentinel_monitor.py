"""Proactive text-sentinel monitor.

Companion to ``utils/drift_monitor.py``. The drift monitor tracks
``data-testid`` values. This one tracks a curated set of **visible copy
strings** — the kind of regression where the testid survives but a
card's title / empty-state line / primary action label silently
disappears (that's how the 2026-07-09 presence-pill copy regression
slipped past drift).

Runs the ``scripts/deploy_text_sentinel.py`` script on a schedule,
persists a summary row to ``text_sentinel_results``, and exposes it via
``GET /api/admin/text-sentinel-status``.

Ships 2026-07-12 alongside the Phase 6C-A refactor to lock down the
deploy pipeline that the refactor stressed.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCRIPT_PATH = Path("/app/scripts/deploy_text_sentinel.py")
RESULTS_COLLECTION = "text_sentinel_results"
KEEP_RECENT_RUNS = 168  # ~1 week at hourly ticks


async def run_text_sentinel_once(db) -> dict[str, Any]:
    """Invoke the text-sentinel script in a subprocess, capture output,
    persist a summary row. Returns the summary dict.

    Non-crashing — any error in the check itself is captured as
    ``status="error"`` on the row so the endpoint can still surface it.
    """
    started_at = datetime.now(timezone.utc)
    if not SCRIPT_PATH.exists():
        row = {
            "checked_at":    started_at.isoformat(),
            "status":        "error",
            "error":         f"text-sentinel script missing at {SCRIPT_PATH}",
            "total_checks":  None,
            "missing_count": None,
            "missing":       [],
        }
        await _persist(db, row)
        return row

    proc = await asyncio.create_subprocess_exec(
        "python3", str(SCRIPT_PATH),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_b, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        row = {
            "checked_at":    started_at.isoformat(),
            "status":        "timeout",
            "error":         "text-sentinel ran longer than 60s (fetch stall?)",
            "total_checks":  None,
            "missing_count": None,
            "missing":       [],
        }
        await _persist(db, row)
        return row

    stdout = stdout_b.decode("utf-8", "replace")
    # Parse the summary line:
    #   → Text sentinel scan of prod main.abc123.js — 26 checks, 0 missing.
    summary_re = re.search(
        r"Text sentinel scan of .+?—\s+(\d+)\s+checks,\s+(\d+)\s+missing",
        stdout,
    )
    total_checks = int(summary_re.group(1)) if summary_re else None
    missing_count = int(summary_re.group(2)) if summary_re else None

    # Parse the itemised "sentinel string(s) NOT FOUND" block. The script
    # groups by surface, so each ``✗ '<needle>' # <note>`` line is what
    # we want to surface.
    missing: list[dict[str, str]] = []
    current_surface = ""
    for line in stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("▸ "):
            current_surface = stripped[2:].strip()
            continue
        if stripped.startswith("✗"):
            # Format: ✗  '<needle>'  # <note>
            m = re.search(r"'(?P<needle>[^']*)'\s+#\s*(?P<note>.*)", line)
            if m:
                missing.append({
                    "surface": current_surface,
                    "needle":  m.group("needle"),
                    "note":    m.group("note").strip(),
                })

    status = "ok" if proc.returncode == 0 else ("missing" if proc.returncode == 1 else "error")
    row = {
        "checked_at":    started_at.isoformat(),
        "status":        status,
        "exit_code":     proc.returncode,
        "total_checks":  total_checks,
        "missing_count": missing_count if missing_count is not None else len(missing),
        "missing":       missing,
    }
    await _persist(db, row)
    if missing:
        preview = ", ".join(f"{m['surface']}:{m['needle']!r}" for m in missing[:5])
        logger.warning(
            "Text-sentinel: %d string(s) missing from prod bundle: %s%s",
            len(missing), preview,
            " ..." if len(missing) > 5 else "",
        )
    else:
        logger.info(
            "Text-sentinel: prod copy intact (%s sentinels checked)",
            total_checks,
        )
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
        logger.warning("Text-sentinel persist failed (non-fatal): %s", e)


async def latest_text_sentinel_result(db) -> dict[str, Any] | None:
    """Return the most recent text-sentinel result or None if never run."""
    row = await db[RESULTS_COLLECTION].find_one(
        {},
        {"_id": 0},
        sort=[("checked_at", -1)],
    )
    return row
