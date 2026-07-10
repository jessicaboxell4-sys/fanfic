"""Unknown-fandom detector — finds fandoms appearing in books that aren't
in the keyword classifier yet.

This is a PASSIVE aggregator: it queries the books collection at request
time rather than tracking ingestion events. That keeps the upload path
zero-cost and means we instantly reflect any DB changes (manual edits,
admin reclassifies, etc.).

Dismissals are persisted in the `dismissed_unknown_fandoms` collection
so the admin can hide "Other", "Original Work", etc. permanently.
"""
from typing import Set, List, Dict, Any
import time

from deps import db, logger

# 60s in-process cache to keep the navbar-badge endpoint cheap (it's hit
# on every page navigation). Aggregation across the entire books
# collection is fast for our scale but we still don't want it per-request.
_count_cache: Dict[str, Any] = {"count": 0, "ts": 0.0}
COUNT_TTL_SEC = 60


async def _dismissed() -> Set[str]:
    docs = await db.dismissed_unknown_fandoms.find({}, {"_id": 0, "fandom": 1}).to_list(length=1000)
    return {d["fandom"] for d in docs}


async def list_unknown_fandoms(known: Set[str]) -> List[Dict[str, Any]]:
    """Return rows like
        [{"fandom": "Foo", "count": 12, "sample_book_ids": [..]}, ...]
    sorted by count descending. Excludes dismissed entries.
    """
    dismissed = await _dismissed()
    pipeline = [
        {"$match": {"fandom": {"$ne": None, "$nin": ["", None]}}},
        {"$group": {
            "_id": "$fandom",
            "n": {"$sum": 1},
            "samples": {"$push": "$book_id"},
        }},
        {"$sort": {"n": -1}},
    ]
    rows: List[Dict[str, Any]] = []
    async for r in db.books.aggregate(pipeline):
        f = r["_id"]
        if f in known or f in dismissed:
            continue
        rows.append({
            "fandom": f,
            "count": r["n"],
            "sample_book_ids": (r.get("samples") or [])[:5],
        })
    return rows


async def count_unknown_fandoms(known: Set[str]) -> int:
    """Same as `list_unknown_fandoms` but only the row count. Cached for
    `COUNT_TTL_SEC` so the navbar badge endpoint is essentially free."""
    now = time.monotonic()
    if _count_cache["count"] is not None and now - _count_cache["ts"] < COUNT_TTL_SEC:
        return _count_cache["count"]
    try:
        rows = await list_unknown_fandoms(known)
        c = len(rows)
    except Exception as e:  # noqa: BLE001
        logger.warning("count_unknown_fandoms failed: %s", e)
        c = 0
    _count_cache["count"] = c
    _count_cache["ts"] = now
    return c


def invalidate_count_cache() -> None:
    _count_cache["count"] = None
    _count_cache["ts"] = 0.0
