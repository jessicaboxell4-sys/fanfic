"""User-submitted suggestions / feature requests / bug reports.

Anyone signed in can:
  - submit a suggestion (title + body + category)
  - browse all suggestions
  - upvote (toggle)
  - see their own submissions filtered

Admins can:
  - change status (open / under_review / planned / done / declined)
  - add an admin_note (e.g. "shipped in 1.4")
  - delete spam

Categories: bug, improvement, feature.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal, Dict, Any, List

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, require_admin
from utils.admin_audit import record_admin_action


CATEGORIES = ("bug", "improvement", "feature")
STATUSES = ("open", "under_review", "planned", "done", "declined")


class SuggestionCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    body: str = Field(default="", max_length=4000)
    category: Literal["bug", "improvement", "feature"] = "feature"


class SuggestionUpdate(BaseModel):
    status: Optional[Literal["open", "under_review", "planned", "done", "declined"]] = None
    admin_note: Optional[str] = Field(default=None, max_length=1000)


def _serialize(doc: Dict[str, Any], me: Optional[str] = None) -> Dict[str, Any]:
    return {
        "suggestion_id": doc["suggestion_id"],
        "title": doc["title"],
        "body": doc.get("body", ""),
        "category": doc["category"],
        "status": doc["status"],
        "admin_note": doc.get("admin_note"),
        "submitter_user_id": doc["submitter_user_id"],
        "submitter_name": doc.get("submitter_name", ""),
        "submitter_email": doc.get("submitter_email", ""),
        "votes_count": len(doc.get("voters", [])),
        "i_voted": (me in (doc.get("voters") or [])) if me else False,
        "is_mine": (doc["submitter_user_id"] == me) if me else False,
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": doc["updated_at"].isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


# ---------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------

@api_router.get("/suggestions")
async def list_suggestions(
    status: Optional[str] = None,
    category: Optional[str] = None,
    mine_only: bool = False,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if status and status in STATUSES:
        query["status"] = status
    if category and category in CATEGORIES:
        query["category"] = category
    if mine_only:
        query["submitter_user_id"] = user.user_id
    docs = await db.suggestions.find(query, {"_id": 0}).to_list(length=500)
    # Sort: open ones first, then by votes desc, then by recency.
    status_rank = {"open": 0, "under_review": 1, "planned": 2, "done": 3, "declined": 4}
    docs.sort(
        key=lambda d: (
            status_rank.get(d.get("status", "open"), 5),
            -len(d.get("voters") or []),
            -(d.get("created_at").timestamp() if isinstance(d.get("created_at"), datetime) else 0),
        )
    )
    return {"suggestions": [_serialize(d, user.user_id) for d in docs]}


@api_router.post("/suggestions")
async def submit_suggestion(body: SuggestionCreate, user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    doc = {
        "suggestion_id": f"sug_{uuid.uuid4().hex[:12]}",
        "title": body.title.strip(),
        "body": body.body.strip(),
        "category": body.category,
        "status": "open",
        "submitter_user_id": user.user_id,
        "submitter_name": user.name or (user.email or "").split("@")[0],
        "submitter_email": user.email or "",
        "voters": [user.user_id],  # submitter auto-votes for their own
        "admin_note": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.suggestions.insert_one(doc)
    return _serialize(doc, user.user_id)


@api_router.post("/suggestions/{sid}/vote")
async def vote_toggle(sid: str, user: User = Depends(get_current_user)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    voters = doc.get("voters") or []
    if user.user_id in voters:
        voters.remove(user.user_id)
        action = "unvoted"
    else:
        voters.append(user.user_id)
        action = "voted"
    await db.suggestions.update_one(
        {"suggestion_id": sid},
        {"$set": {"voters": voters, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"action": action, "votes_count": len(voters)}


@api_router.delete("/suggestions/{sid}")
async def delete_own_suggestion(sid: str, user: User = Depends(get_current_user)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if doc["submitter_user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Only the submitter can delete their own suggestion")
    await db.suggestions.delete_one({"suggestion_id": sid})
    return {"deleted": sid}


# ---------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------

@api_router.put("/admin/suggestions/{sid}")
async def admin_update(sid: str, body: SuggestionUpdate, user: User = Depends(require_admin)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    update: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if body.status is not None:
        update["status"] = body.status
    if body.admin_note is not None:
        update["admin_note"] = body.admin_note.strip() or None
    if not update:
        return _serialize(doc, user.user_id)
    await db.suggestions.update_one({"suggestion_id": sid}, {"$set": update})
    await record_admin_action(
        user, "suggestion.update", target=sid,
        metadata={"changed": [k for k in update.keys() if k != "updated_at"]},
    )
    refreshed = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    return _serialize(refreshed, user.user_id)


@api_router.delete("/admin/suggestions/{sid}")
async def admin_delete(sid: str, user: User = Depends(require_admin)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    await db.suggestions.delete_one({"suggestion_id": sid})
    await record_admin_action(
        user, "suggestion.delete", target=sid,
        metadata={"title": doc.get("title", "")[:80]},
    )
    return {"deleted": sid}


@api_router.get("/admin/suggestions/open-count")
async def admin_open_count(user: User = Depends(require_admin)):
    """Quick count for the Admin Console badge."""
    n = await db.suggestions.count_documents({"status": "open"})
    return {"open": n}
