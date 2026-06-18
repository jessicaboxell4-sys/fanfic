"""Help-page section analytics.

A single anonymous counter per section id so we can sort the Help
TOC by popularity over time and surface the genuinely-confusing
features at the top.  Hits are deduplicated per-IP-per-hour so a
single user reloading 10 times doesn't skew the ranking.

Endpoints:
  POST /api/help/track        — body: {section: "..."}.  Public, no auth.
  GET  /api/help/popular      — top N section ids sorted by hits.  Public.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import Request
from pydantic import BaseModel, Field

from deps import api_router, db


class HelpTrackBody(BaseModel):
    section: str = Field(..., min_length=1, max_length=64)


@api_router.post("/help/track")
async def help_track(body: HelpTrackBody, request: Request):
    """Anonymous click counter.  Deduplicates by (section, ip_hash, hour)
    so a reload spam doesn't game the ranking.  No auth — public Help
    page can be read by anonymous visitors too.
    """
    # Whitelist the section id shape to keep junk out of the collection.
    section = "".join(c for c in body.section if c.isalnum() or c in "-_")[:64]
    if not section:
        return {"ok": False}
    ip = (request.client.host if request.client else "0.0.0.0")
    salt = os.environ.get("HELP_TRACK_SALT", "shelfsort-help")
    ip_hash = hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()[:16]
    hour_bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    # Idempotent insert with unique key so dedupe is enforced at the
    # DB layer (no race condition between two concurrent clicks).
    dedupe_key = f"{section}:{ip_hash}:{hour_bucket}"
    try:
        await db.help_clicks.update_one(
            {"dedupe_key": dedupe_key},
            {"$setOnInsert": {
                "section":    section,
                "ip_hash":    ip_hash,
                "hour":       hour_bucket,
                "dedupe_key": dedupe_key,
                "ts":         datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception:
        return {"ok": False}
    return {"ok": True}


@api_router.get("/help/popular")
async def help_popular(days: int = 30, limit: int = 50):
    """Top section ids by unique-IP-hour click count over the last
    ``days`` window.  Used by the Help page to sort its TOC by
    real user engagement instead of hand-curated order."""
    days = max(1, min(int(days or 30), 365))
    limit = max(1, min(int(limit or 50), 200))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$section", "hits": {"$sum": 1}}},
        {"$sort": {"hits": -1, "_id": 1}},
        {"$limit": limit},
        {"$project": {"_id": 0, "section": "$_id", "hits": 1}},
    ]
    rows: List[dict] = []
    async for r in db.help_clicks.aggregate(pipeline):
        rows.append(r)
    return {"rows": rows, "window_days": days}


__all__ = []
