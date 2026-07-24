"""Retry-dedup telemetry + admin dashboard endpoint (iter 89 rebuild).

Each time the frontend's ``sha256`` idempotency guard catches a retry
that would have created a duplicate book, ``check_upload_fingerprint``
(over in ``upload_jobs.py``) inserts a row into ``dedup_events``.  This
module exposes that data to the Admin Console.

Schema (``dedup_events`` collection)::

    {
        _id: ObjectId,
        user_id: str,
        ts: ISO8601 string,
        job_id: str,           # the previous job the retry matched
        fingerprint: str,      # sha256 hex (name || size || mtime)
        book_id: str | None,
    }
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException

from auth_dep import require_admin
from deps import api_router, db
from models import User

logger = logging.getLogger(__name__)


@api_router.get("/admin/dedup-retry-stats")
async def dedup_retry_stats(
    days: int = 7,
    _user: User = Depends(require_admin),
):
    """N-day rollup of retry-dedup hits."""
    days = max(1, min(int(days or 7), 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_iso = since.isoformat()

    try:
        cursor = db.dedup_events.find(
            {"ts": {"$gte": since_iso}},
            projection={"_id": 0, "user_id": 1, "ts": 1},
        )
        rows = await cursor.to_list(length=100_000)
    except Exception as e:  # noqa: BLE001
        logger.warning("dedup_retry_stats query failed: %s", e)
        raise HTTPException(status_code=500, detail="stats query failed")

    daily: dict[str, int] = defaultdict(int)
    user_counts: dict[str, int] = defaultdict(int)
    for r in rows:
        ts = str(r.get("ts") or "")
        if len(ts) >= 10:
            daily[ts[:10]] += 1
        uid = str(r.get("user_id") or "anon")
        user_counts[uid] += 1

    daily_list = []
    for i in range(days):
        d = (since + timedelta(days=i)).date().isoformat()
        daily_list.append({"date": d, "count": daily.get(d, 0)})

    top_users = sorted(
        ({"user_id": uid, "count": n} for uid, n in user_counts.items()),
        key=lambda x: x["count"],
        reverse=True,
    )[:10]

    return {
        "window_days": days,
        "since": since_iso,
        "total": len(rows),
        "daily": daily_list,
        "top_users": top_users,
        "unique_users": len(user_counts),
    }
