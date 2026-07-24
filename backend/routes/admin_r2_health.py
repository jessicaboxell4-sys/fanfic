"""Admin R2-mirror-health endpoint.

Aggregates the ``upload_r2_failures`` collection (populated by the
strict-mode 503 handler in ``routes/upload_jobs.py``) into a
per-hour count so the AdminConsole can surface a persistent banner
when R2 mirroring silently breaks.

Threshold (default 10 failures / rolling hour) is env-tunable via
``R2_MIRROR_FAILURE_ALERT_THRESHOLD``.  Above the threshold the
health status flips to ``"outage"``; between 1 and threshold it's
``"degraded"``; empty is ``"healthy"``.  Also creates a 7-day TTL
index on ``created_at`` so the collection can't grow unboundedly.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import Depends, HTTPException
from deps import api_router, db
from auth_dep import get_current_user
from models import User


def _threshold() -> int:
    try:
        return max(1, int(os.environ.get("R2_MIRROR_FAILURE_ALERT_THRESHOLD", "10")))
    except (TypeError, ValueError):
        return 10


@api_router.get("/admin/r2-mirror-health")
async def r2_mirror_health(
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return R2 mirror-failure counts and health status."""
    if not (user.is_admin or getattr(user, "is_moderator", False)):
        raise HTTPException(status_code=403, detail="Admin only")

    threshold = _threshold()
    now = datetime.now(timezone.utc)
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(hours=24)

    last_hour = await db.upload_r2_failures.count_documents({"created_at": {"$gte": hour_ago}})
    last_24h  = await db.upload_r2_failures.count_documents({"created_at": {"$gte": day_ago}})

    # Recent examples for the banner tooltip / drill-down.
    recent = await db.upload_r2_failures.find(
        {"created_at": {"$gte": hour_ago}},
        {"_id": 0, "user_id": 1, "filename": 1, "size": 1, "created_at": 1, "reason": 1},
    ).sort("created_at", -1).limit(5).to_list(length=5)
    for r in recent:
        if r.get("created_at") is not None:
            r["created_at"] = r["created_at"].isoformat()

    if last_hour >= threshold:
        status = "outage"
        reason = (
            f"R2 mirror rejected {last_hour} uploads in the last hour "
            f"(threshold: {threshold}). Storage layer is likely broken — "
            f"check Cloudflare R2 credentials + bucket status. Every "
            f"strict-mode 503 blocks a real user upload."
        )
    elif last_hour > 0:
        status = "degraded"
        reason = (
            f"{last_hour} R2 mirror failures in the last hour "
            f"(threshold before alarm: {threshold}). Transient blip — "
            f"monitor for escalation."
        )
    else:
        status = "healthy"
        reason = None

    # TTL — 7 days is enough for retro on any incident.
    try:
        await db.upload_r2_failures.create_index(
            "created_at",
            expireAfterSeconds=7 * 24 * 3600,
            name="upload_r2_failures_ttl_7d",
        )
    except Exception:  # noqa: BLE001
        pass

    return {
        "status":         status,
        "reason":         reason,
        "last_hour":      last_hour,
        "last_24h":       last_24h,
        "threshold":      threshold,
        "recent":         recent,
    }
