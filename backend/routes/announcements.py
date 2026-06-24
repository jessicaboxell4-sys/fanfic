"""Announcements: ship release notes / "What's new" cards without a deploy.

The Help page's "What's new" card pulls from `GET /api/announcements/latest`
and falls back to a hardcoded constant when the API returns nothing. To
push a new note, hit `POST /api/announcements` with a fresh `version`
string (e.g. "2026-06-15"). Frontend uses `version` as the per-user
localStorage dismissal key, so bumping it re-shows the card for everyone.

Auth: every authenticated user can read AND write. There is no admin role
in Shelfsort; this mirrors the existing `/api/admin/unknown-sources`
pattern (any logged-in user can curate). If/when an admin role lands,
gate writes by it.
"""
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

from deps import db, api_router
from models import User
from auth_dep import get_current_user, require_admin
from utils.admin_audit import record_admin_action


class AnnouncementItem(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    desc: str = Field(..., min_length=1, max_length=240)
    to: str = Field(..., min_length=1, max_length=200)
    link_to_2: Optional[str] = Field(default=None, max_length=200)


class AnnouncementIn(BaseModel):
    version: str = Field(..., min_length=1, max_length=40)
    title: str = Field(..., min_length=1, max_length=80)
    items: List[AnnouncementItem] = Field(..., min_length=1, max_length=10)


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "version": doc["version"],
        "title": doc["title"],
        "items": doc.get("items", []),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


@api_router.get("/announcements/latest")
async def get_latest_announcement(user: User = Depends(get_current_user)):
    """Return the most recently published announcement, or `null` if none.

    Shape: `{version, title, items: [{label, desc, to, link_to_2?}], created_at}`.
    Frontend treats a `null` body as "nothing new — fall back to baked-in
    constant".
    """
    doc = await db.announcements.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        return None
    return _serialize(doc)


@api_router.get("/changelog/public")
async def get_public_changelog(limit: int = 6):
    """PUBLIC list of recent announcements for the SEO-friendly
    `/changelog` route.  No auth required — Google needs to crawl
    this surface, and the content is the same broadcast we already
    show to logged-in users in the Help page.

    Returns ``[]`` if the collection is empty (lets the SPA render
    a calm empty state without throwing).
    """
    limit = max(1, min(20, int(limit or 6)))
    cursor = db.announcements.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    out = []
    async for d in cursor:
        out.append(_serialize(d))
    return out


@api_router.post("/announcements")
async def create_announcement(
    payload: AnnouncementIn,
    user: User = Depends(require_admin),
):
    """Insert a new announcement. `version` must be unique — pushing the
    same version twice is a 409, push a fresh version (YYYY-MM-DD-X) to
    force a re-show on every user. Admin-only.
    """
    existing = await db.announcements.find_one({"version": payload.version}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail=f"Version '{payload.version}' already exists")
    doc = {
        "version": payload.version,
        "title": payload.title,
        "items": [item.model_dump(exclude_none=True) for item in payload.items],
        "created_at": datetime.now(timezone.utc),
        "created_by": user.user_id,
    }
    await db.announcements.insert_one(doc)
    await record_admin_action(user, "announcement.publish", target=payload.version, metadata={"title": payload.title, "items": len(payload.items)})
    return _serialize(doc)


@api_router.delete("/announcements/{version}")
async def delete_announcement(
    version: str,
    user: User = Depends(require_admin),
):
    """Remove an announcement by version. Useful for undo / typo fixes. Admin-only."""
    result = await db.announcements.delete_one({"version": version})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Announcement not found")
    await record_admin_action(user, "announcement.delete", target=version)
    return {"deleted": version}
