"""User suggestion box.

Captures free-text feedback (and optional photo attachment) from the
Help page.  Saves to ``suggestions`` collection with the calling
user_id (or "anonymous") + page they were viewing when they wrote
the suggestion so admins can spot per-page friction.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from deps import api_router, db
from models import User
from auth_dep import get_current_user_or_none, require_admin


@api_router.post("/feedback")
async def submit_suggestion(
    request: Request,
    text: str = Form(..., min_length=4, max_length=2000),
    page: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Append a single suggestion to the queue.  Optional ``photo``
    upload is base64-encoded in the row so admin triage can render
    the screenshot inline.  Capped at 5 MB."""
    user_id = user.user_id if user else "anonymous"
    user_email = user.email if user else None
    ip = (request.client.host if request.client else "0.0.0.0")
    now = datetime.now(timezone.utc).isoformat()

    photo_b64: Optional[str] = None
    photo_mime: Optional[str] = None
    if photo is not None:
        raw = await photo.read()
        if len(raw) > 10 * 1024 * 1024:
            # 413 so the client knows to keep the form populated and surface
            # a size-specific toast — returning 200 made the client clear the
            # form as if the submission succeeded.
            raise HTTPException(status_code=413, detail="photo_too_large")
        if raw and not (photo.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="not_an_image")
        if raw:
            # Antivirus pre-scan — same policy as /books/upload (2026-06-18).
            # Disguised executables sometimes ride in as image/jpeg, so we
            # don't trust the content-type alone.
            from utils.antivirus import scan_bytes, record_quarantine
            import asyncio as _asyncio
            _av = await _asyncio.to_thread(scan_bytes, raw, hint_name=photo.filename or "feedback.bin")
            if _av.get("infected"):
                await record_quarantine(
                    user_id=user.user_id,
                    filename=photo.filename or "",
                    scan=_av,
                    source="upload",
                    extra={"endpoint": "feedback", "size_bytes": len(raw)},
                )
                raise HTTPException(status_code=400, detail="photo_unsafe")
            photo_b64 = base64.b64encode(raw).decode()
            photo_mime = photo.content_type

    await db.suggestions.insert_one({
        "user_id":    user_id,
        "user_email": user_email,
        "page":       (page or "")[:200],
        "text":       text.strip(),
        "photo_b64":  photo_b64,
        "photo_mime": photo_mime,
        "status":     "open",
        "ts":         now,
        "ip":         ip,
    })
    return {"ok": True}


@api_router.get("/admin/feedback")
async def list_suggestions(
    status: str = "open", page: Optional[str] = None, limit: int = 100,
    include_tests: bool = False,
    _admin: User = Depends(require_admin),
):
    """Admin triage feed — sorted newest-first.  Optional ``page``
    filter (e.g., ``/library``) scopes to a single route so admins
    can dig into the friction on one screen.

    2026-06-27 — ``include_tests`` defaults to False so the admin
    inbox excludes Help-page feedback submitted by test-account
    users (@example.com / user_* / iter* / etc.).  Pass
    ``include_tests=true`` from the UI when debugging fixture
    leakage.  Detection matches the same canonical email predicate
    used by the suggestions board + email watchdog.
    """
    limit = max(1, min(int(limit or 100), 500))
    # The ``suggestions`` collection is shared with the older
    # /api/suggestions product-board (which uses {title, body, category,
    # suggestion_id}).  Discriminate to the Help-page shape by requiring
    # the ``text`` field so we don't render legacy rows that crash the
    # admin UI.
    q: Dict[str, Any] = {"text": {"$exists": True, "$ne": None}}
    if status:
        q["status"] = status
    if page:
        q["page"] = page
    if not include_tests:
        from utils.test_account_filter import mongo_exclude_tests_clause
        q.update(mongo_exclude_tests_clause("user_email"))
    rows: List[dict] = []
    async for r in db.suggestions.find(q).sort("ts", -1).limit(limit):
        r.pop("_id", None)
        rows.append(r)
    return {"rows": rows}


@api_router.get("/admin/feedback/by-page")
async def suggestions_by_page(
    status: str = "open", limit: int = 30,
    include_tests: bool = False,
    _admin: User = Depends(require_admin),
):
    """Aggregate count of suggestions grouped by page.  Powers an
    admin widget that surfaces which routes are causing the most
    user friction.

    2026-06-27 — Honours ``include_tests`` so the per-page friction
    counter matches the list endpoint and the rolled-up numbers don't
    include fixture noise from agent flows.
    """
    limit = max(1, min(int(limit or 30), 100))
    # Same shape-discriminator as the list endpoint above — legacy
    # rows from the /api/suggestions board don't carry a ``text``
    # field and shouldn't show up in the per-page friction widget.
    match: Dict[str, Any] = {"text": {"$exists": True, "$ne": None}}
    if status:
        match["status"] = status
    if not include_tests:
        from utils.test_account_filter import mongo_exclude_tests_clause
        match.update(mongo_exclude_tests_clause("user_email"))
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id":           {"$ifNull": ["$page", "(unknown)"]},
            "count":         {"$sum": 1},
            "latest_ts":     {"$max": "$ts"},
            "with_photo":    {"$sum": {"$cond": [{"$ifNull": ["$photo_b64", False]}, 1, 0]}},
        }},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": limit},
        {"$project": {
            "_id": 0,
            "page":       "$_id",
            "count":      1,
            "latest_ts":  1,
            "with_photo": 1,
        }},
    ]
    rows: List[dict] = []
    async for r in db.suggestions.aggregate(pipeline):
        rows.append(r)
    return {"rows": rows}


__all__ = []
