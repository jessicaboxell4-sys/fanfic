"""Upload failure insights admin endpoint (iter 90 rebuild).

Every failed background upload job writes an ``upload_incomplete``
notification into ``db.notifications`` with a body like::

    • some-file.epub — AV scan flagged: EICAR test signature
    • other.epub — EPUB parse error: not a zip
    • 3 files vanished mid-pipeline (unexplained)

This endpoint walks those notifications, parses each bullet, and
returns a reason-grouped rollup so operators can see whether AV scans,
EPUB parsers, or classifier calls are the current bottleneck.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException

from auth_dep import require_admin
from deps import api_router, db
from models import User

logger = logging.getLogger(__name__)

_BULLET_RE = re.compile(r"^\s*[•\-\*]\s*(?P<file>[^—\-]+?)\s+—\s+(?P<reason>.+?)\s*$")
_VANISHED_RE = re.compile(r"^\s*[•\-\*]\s*(?P<count>\d+)\s+file", re.IGNORECASE)


def _normalize_reason(reason: str) -> str:
    """Strip the per-file detail after a colon so
    'AV scan: EICAR' and 'AV scan: variant-b' bucket as 'AV scan'."""
    r = (reason or "").strip()
    if ":" in r:
        r = r.split(":", 1)[0].strip()
    return r[:80] or "unknown"


@api_router.get("/admin/upload-failure-insights")
async def upload_failure_insights(
    days: int = 7,
    _user: User = Depends(require_admin),
):
    """N-day rollup of ``upload_incomplete`` notifications grouped by reason."""
    days = max(1, min(int(days or 7), 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        cursor = db.notifications.find(
            {"kind": "upload_incomplete", "created_at": {"$gte": since}},
            projection={"_id": 0, "user_id": 1, "body": 1, "created_at": 1},
        )
        rows = await cursor.to_list(length=10_000)
    except Exception as e:  # noqa: BLE001
        logger.warning("upload_failure_insights query failed: %s", e)
        raise HTTPException(status_code=500, detail="insights query failed")

    reason_counts: dict[str, int] = defaultdict(int)
    reason_examples: dict[str, list[str]] = defaultdict(list)
    users_seen: set[str] = set()
    total_files_affected = 0
    vanished_count = 0

    for r in rows:
        users_seen.add(str(r.get("user_id") or "anon"))
        body = str(r.get("body") or "")
        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            m = _BULLET_RE.match(line)
            if m:
                fname = m.group("file").strip()
                reason = _normalize_reason(m.group("reason"))
                reason_counts[reason] += 1
                if len(reason_examples[reason]) < 5 and fname:
                    if fname not in reason_examples[reason]:
                        reason_examples[reason].append(fname)
                total_files_affected += 1
                continue
            v = _VANISHED_RE.match(line)
            if v:
                try:
                    n = int(v.group("count"))
                except (ValueError, TypeError):
                    n = 1
                vanished_count += n
                total_files_affected += n

    reasons = sorted(
        (
            {"reason": rsn, "count": n, "examples": reason_examples[rsn]}
            for rsn, n in reason_counts.items()
        ),
        key=lambda x: x["count"],
        reverse=True,
    )

    return {
        "window_days": days,
        "since": since.isoformat(),
        "total_notifications": len(rows),
        "total_files_affected": total_files_affected,
        "unique_users": len(users_seen),
        "reasons": reasons,
        "vanished_count": vanished_count,
    }
