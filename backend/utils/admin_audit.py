"""Admin audit log — records every admin write action.

Every endpoint that uses `Depends(require_admin)` for a write/destructive
operation should call `record_admin_action(...)` so we have a paper trail
in the `admin_audit` collection. The Admin Console UI surfaces this log
as a chronological table.

Schema (Mongo `admin_audit` collection):
    action:       str  — short slug (e.g. "announcement.publish")
    actor_id:     str  — user_id of the admin who did it
    actor_email:  str  — email at the time of action (denormalized for log)
    target:       str | None  — primary identifier (book_id, user_id, host…)
    metadata:     dict — small free-form context (kept under ~1KB)
    ts:           datetime (UTC)
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from deps import db, logger
from models import User


async def record_admin_action(
    actor: User,
    action: str,
    target: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Insert an audit entry. Never raises — audit failures must NOT block
    the underlying action. Errors are logged at WARNING level.
    """
    try:
        await db.admin_audit.insert_one({
            "action": action,
            "actor_id": actor.user_id,
            "actor_email": actor.email,
            "target": target,
            "metadata": metadata or {},
            "ts": datetime.now(timezone.utc),
        })
    except Exception as e:  # noqa: BLE001 — audit log is best-effort
        logger.warning("admin_audit insert failed (%s): %s", action, e)
