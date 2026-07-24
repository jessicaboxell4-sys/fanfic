"""Admin startup-timing endpoints.

Exposes the ``db.startup_timings`` collection (populated per-boot by
``utils.startup_state.persist_boot_row``) so the AdminConsole can:

1. Draw a deploy-to-deploy sparkline of ``elapsed_seconds`` — the
   earliest visual signal that a migration is creeping toward the
   K8s readiness timeout.
2. Flag the console header when the last two consecutive boots both
   exceeded 2× the budget (``STARTUP_SLOW_THRESHOLD_S``).  Two in a
   row rules out a one-off Atlas hiccup and points to a real drift.
"""
from __future__ import annotations

import os
from typing import Any, Dict

from fastapi import Depends, HTTPException
from deps import api_router, db
from auth_dep import get_current_user
from models import User


def _budget_seconds() -> float:
    try:
        return float(os.environ.get("STARTUP_SLOW_THRESHOLD_S", "20"))
    except (TypeError, ValueError):
        return 20.0


@api_router.get("/admin/startup-timing/history")
async def startup_timing_history(
    limit: int = 20,
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return the most recent boot rows for the AdminConsole sparkline.

    Also computes ``at_risk``: True when the two most recent boots
    (i.e. the current pod and the one immediately before) both
    exceeded 2× the configured budget.  Consumers use this to flip a
    red flag on the AdminConsole header.
    """
    if not (user.is_admin or getattr(user, "is_moderator", False)):
        raise HTTPException(status_code=403, detail="Admin only")

    applied_limit = max(1, min(int(limit), 100))
    budget = _budget_seconds()
    docs = await db.startup_timings.find(
        {},
        {
            "_id": 0,
            "boot_id": 1,
            "started_at": 1,
            "finished_at": 1,
            "elapsed_seconds": 1,
            "status": 1,
            "budget_seconds": 1,
            "over_budget": 1,
            "over_budget_2x": 1,
            "created_at": 1,
        },
    ).sort("created_at", -1).limit(applied_limit).to_list(length=applied_limit)

    # ISO-serialize created_at so the client JSON parses cleanly.
    for d in docs:
        if d.get("created_at") is not None:
            d["created_at"] = d["created_at"].isoformat()

    # `at_risk` = last 2 boots both over 2× budget.  We fetch in
    # descending order (newest first) so docs[0] is current pod.
    at_risk = False
    at_risk_reason = None
    if len(docs) >= 2:
        recent2 = docs[:2]
        if all((d.get("elapsed_seconds") or 0) > 2 * budget for d in recent2):
            at_risk = True
            at_risk_reason = (
                f"Last {len(recent2)} boots both exceeded "
                f"2× the {budget:.0f}s budget "
                f"({recent2[0].get('elapsed_seconds'):.1f}s and "
                f"{recent2[1].get('elapsed_seconds'):.1f}s). "
                f"Next deploy is at risk of failing the K8s readiness probe."
            )

    return {
        "points":          docs,           # descending — newest first
        "budget_seconds":  budget,
        "at_risk":         at_risk,
        "at_risk_reason":  at_risk_reason,
        "count":           len(docs),
        "applied_limit":   applied_limit,
    }
