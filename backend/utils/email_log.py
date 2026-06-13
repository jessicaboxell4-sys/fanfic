"""Email-send telemetry.

Every Resend send across the codebase calls :func:`log_email_send`
right after it gets a response (success or failure). The admin
"Resend deliveries this week" stat card reads from this collection.

Schema (``db.email_logs``)
---------------------------
``{
    sent_at: datetime,
    kind: str,           # "digest", "grace_reminder", "password_reset",
                         # "suggestion_admin", "invite", "year_in_books",
                         # "test_email", ...
    to: str,             # recipient email
    status: "ok" | "error",
    error: str | None,
    resend_id: str | None,
}``

Retention is intentionally generous (90 days) since these rows are
tiny — the rolling stat card only needs the last 7 days but the
admin audit might want to drill back further.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from deps import db

logger = logging.getLogger(__name__)

# Drop email-log rows older than this. The "this week" stat card only
# needs the last 7 days; the extra retention is for ad-hoc audits.
EMAIL_LOG_RETENTION_DAYS = 90


async def log_email_send(
    kind: str,
    to: str,
    status: str,
    *,
    error: Optional[str] = None,
    resend_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist a single Resend send to ``db.email_logs``. Defensive —
    never raises, so a logging hiccup can't break an email send."""
    try:
        doc = {
            "sent_at": datetime.now(timezone.utc),
            "kind": kind,
            "to": to,
            "status": status,
            "error": error,
            "resend_id": resend_id,
        }
        if extra:
            doc.update(extra)
        await db.email_logs.insert_one(doc)
        # Lazy retention trim (cheap — only fires on insert, bounded query).
        cutoff = datetime.now(timezone.utc) - timedelta(days=EMAIL_LOG_RETENTION_DAYS)
        await db.email_logs.delete_many({"sent_at": {"$lt": cutoff}})
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("email_logs telemetry write failed for %s: %s", kind, exc)
