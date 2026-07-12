"""Weekly duplicate-rescan cron (2026-07-12).

Runs every Sunday at 04:00 UTC and, for every active user that has at
least one non-trash book, invokes :func:`routes.library_quarantine
._run_rescan_for_user`.  If new duplicates are flagged, drops an in-app
notification (``kind = "duplicate_rescan"``) linking to the Duplicates
page so the operator/user can act.

Users who have muted the ``duplicate_rescan`` kind are auto-skipped by
``create_notification``.  Users with no library changes (0 new flags)
get no notification at all — quiet weeks stay quiet.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from deps import db

logger = logging.getLogger(__name__)


async def weekly_duplicate_rescan_tick() -> dict:
    """Iterate active book-owning users, rescan each, and notify on hits.

    Returns a summary dict for observability:
      ``{users_scanned, total_new_flags, users_notified, errors}``
    """
    from routes.library_quarantine import _run_rescan_for_user
    from routes.notifications import create_notification

    started_at = datetime.now(timezone.utc)
    logger.info("weekly_duplicate_rescan_tick starting at %s", started_at.isoformat())

    # Distinct user_ids that actually own at least one non-trash book.
    # Cheap on Atlas because we already have a compound index on
    # (user_id, category).
    user_ids = await db.books.distinct(
        "user_id", {"category": {"$ne": "Trash"}}
    )

    users_scanned = 0
    total_new_flags = 0
    users_notified = 0
    errors = 0

    for uid in user_ids:
        if not isinstance(uid, str) or not uid:
            continue
        try:
            result = await _run_rescan_for_user(uid)
        except Exception:
            errors += 1
            logger.exception("rescan failed for user_id=%s", uid)
            continue

        users_scanned += 1
        new_flags = int(result.get("new_flagged") or 0)
        if new_flags <= 0:
            continue

        groups = int(result.get("groups_found") or 0)
        total_new_flags += new_flags
        try:
            await create_notification(
                user_id=uid,
                kind="duplicate_rescan",
                title=f"{new_flags} new likely duplicate{'' if new_flags == 1 else 's'} found",
                body=(
                    f"Weekly sweep of your library flagged {new_flags} book"
                    f"{'' if new_flags == 1 else 's'} across {groups} group"
                    f"{'' if groups == 1 else 's'} for review."
                ),
                link="/library/quarantine",
            )
            users_notified += 1
        except Exception:
            logger.exception("failed to write notification for user_id=%s", uid)

    finished_at = datetime.now(timezone.utc)
    elapsed = (finished_at - started_at).total_seconds()
    summary = {
        "users_scanned": users_scanned,
        "total_new_flags": total_new_flags,
        "users_notified": users_notified,
        "errors": errors,
        "elapsed_seconds": round(elapsed, 2),
    }
    logger.info("weekly_duplicate_rescan_tick complete: %s", summary)
    return summary
