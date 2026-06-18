"""User suggestion box.

Tiny one-endpoint module that captures free-text feedback from the
nav-bar "Suggest something" pill.  Saves to ``suggestions``
collection with the calling user_id (or "anonymous") + the page
they were on so an admin can triage from `/admin/suggestions`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, Request
from pydantic import BaseModel, Field

from deps import api_router, db
from models import User
from auth_dep import get_current_user_or_none, require_admin


class SuggestionBody(BaseModel):
    text: str = Field(..., min_length=4, max_length=2000)
    page: Optional[str] = Field(None, max_length=200)


@api_router.post("/feedback")
async def submit_suggestion(
    body: SuggestionBody,
    request: Request,
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Append a single suggestion to the queue.

    Authenticated callers are linked to their user_id so admins can
    follow up; unauthenticated callers are saved as ``anonymous``
    (the suggestion form is intentionally open so visitors can
    leave feedback too).
    """
    user_id = user.user_id if user else "anonymous"
    user_email = user.email if user else None
    ip = (request.client.host if request.client else "0.0.0.0")
    now = datetime.now(timezone.utc).isoformat()
    await db.suggestions.insert_one({
        "user_id":    user_id,
        "user_email": user_email,
        "page":       (body.page or "")[:200],
        "text":       body.text.strip(),
        "status":     "open",
        "ts":         now,
        "ip":         ip,
    })
    return {"ok": True}


@api_router.get("/admin/feedback")
async def list_suggestions(
    status: str = "open", limit: int = 100,
    _admin: User = Depends(require_admin),
):
    """Admin triage feed of suggestions.  Sorted newest-first."""
    limit = max(1, min(int(limit or 100), 500))
    q = {"status": status} if status else {}
    rows: List[dict] = []
    async for r in db.suggestions.find(q).sort("ts", -1).limit(limit):
        r.pop("_id", None)
        rows.append(r)
    return {"rows": rows}


__all__ = []
