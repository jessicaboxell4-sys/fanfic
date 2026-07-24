"""Preset Marketplace — publish, browse, upvote user-shared column presets.

Users can publish a custom list-view preset from `AllBooksPage` and
other users can browse, upvote, and one-click install it as a local
custom chip.  Presets are small (label + visible-flags + order) so
sharing is cheap and validation is quick.

Endpoints:
    POST   /api/presets/marketplace            Publish
    GET    /api/presets/marketplace            List (sorted by upvotes desc)
    POST   /api/presets/marketplace/{id}/upvote  Toggle upvote
    DELETE /api/presets/marketplace/{id}       Author-only delete

Collection: ``shared_presets`` — plain dict docs, no pydantic BaseDocument
required since the shape is tiny and stable.
"""
from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth_dep import get_current_user
from deps import api_router, db
from models import User

logger = logging.getLogger(__name__)

_ALLOWED_COL_KEYS = {"fandom", "pairings", "wordcount", "size", "status", "added"}
_MAX_NAME_LEN = 60
_MAX_DESC_LEN = 400


class PresetBody(BaseModel):
    label: str = Field(..., min_length=1, max_length=40)
    visible: dict[str, bool]
    order: list[str] = Field(..., min_length=1, max_length=12)


class PublishBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=_MAX_NAME_LEN)
    description: str = Field("", max_length=_MAX_DESC_LEN)
    preset: PresetBody


def _sanitize_preset(preset: PresetBody) -> dict[str, Any]:
    """Strip unknown column keys and coerce visible-flags to bools."""
    order = [k for k in preset.order if k in _ALLOWED_COL_KEYS]
    if not order:
        raise HTTPException(status_code=400, detail="Preset order contains no recognised columns.")
    visible = {k: bool(preset.visible.get(k, False)) for k in _ALLOWED_COL_KEYS}
    return {
        "label": preset.label.strip()[:40],
        "visible": visible,
        "order": order,
    }


def _shape_public(doc: dict[str, Any], viewer_user_id: str | None) -> dict[str, Any]:
    upvotes = doc.get("upvotes") or []
    return {
        "id": doc["_id"],
        "author_user_id": doc.get("author_user_id"),
        "author_name": doc.get("author_name") or "Someone",
        "name": doc.get("name") or "Untitled preset",
        "description": doc.get("description") or "",
        "preset": doc.get("preset") or {},
        "upvote_count": int(doc.get("upvote_count") or 0),
        "viewer_upvoted": bool(viewer_user_id and viewer_user_id in upvotes),
        "created_at": doc.get("created_at"),
    }


@api_router.post("/presets/marketplace")
async def publish_preset(body: PublishBody, user: User = Depends(get_current_user)):
    payload = _sanitize_preset(body.preset)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "_id": f"preset_{secrets.token_hex(6)}",
        "author_user_id": user.user_id,
        "author_name": (getattr(user, "name", None) or "").strip()[:60] or "Someone",
        "name": re.sub(r"\s+", " ", body.name).strip()[:_MAX_NAME_LEN],
        "description": body.description.strip()[:_MAX_DESC_LEN],
        "preset": payload,
        "upvotes": [],
        "upvote_count": 0,
        "created_at": now,
    }
    await db.shared_presets.insert_one(doc)
    return _shape_public(doc, viewer_user_id=user.user_id)


@api_router.get("/presets/marketplace")
async def list_marketplace(
    user: User = Depends(get_current_user),
    limit: int = Query(60, ge=1, le=200),
    q: str = Query("", description="Case-insensitive substring search on name/description/author"),
    sort: str = Query("upvotes", pattern="^(upvotes|newest|mine)$"),
):
    limit = max(1, min(int(limit or 60), 200))
    query: dict[str, Any] = {}
    if sort == "mine":
        query["author_user_id"] = user.user_id
    if q:
        # Case-insensitive regex is fine at marketplace scale (hundreds
        # to low-thousands of docs).  Escape the query so a stray `.`
        # doesn't match everything.
        pattern = re.escape(q.strip())
        query["$or"] = [
            {"name":        {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
            {"author_name": {"$regex": pattern, "$options": "i"}},
        ]
    if sort == "newest":
        sort_spec = [("created_at", -1)]
    else:  # upvotes and mine both default to upvote-desc, then newest
        sort_spec = [("upvote_count", -1), ("created_at", -1)]
    cur = db.shared_presets.find(query, sort=sort_spec, limit=limit)
    docs = await cur.to_list(length=limit)
    # Attach comment_count in a single aggregation for the docs we're
    # about to return — cheap since it's a $group over a small subset.
    ids = [d["_id"] for d in docs]
    counts: dict[str, int] = {}
    if ids:
        pipeline = [
            {"$match": {"preset_id": {"$in": ids}}},
            {"$group": {"_id": "$preset_id", "n": {"$sum": 1}}},
        ]
        async for row in db.preset_comments.aggregate(pipeline):
            counts[row["_id"]] = int(row["n"])
    items = []
    for d in docs:
        shaped = _shape_public(d, viewer_user_id=user.user_id)
        shaped["comment_count"] = counts.get(d["_id"], 0)
        items.append(shaped)
    return {
        "items": items,
        "total": len(items),
        "applied": {"q": q, "sort": sort},
    }


@api_router.post("/presets/marketplace/{preset_id}/upvote")
async def toggle_upvote(preset_id: str, user: User = Depends(get_current_user)):
    doc = await db.shared_presets.find_one({"_id": preset_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Preset not found")
    upvotes: list[str] = list(doc.get("upvotes") or [])
    if user.user_id in upvotes:
        upvotes.remove(user.user_id)
        action = "removed"
    else:
        upvotes.append(user.user_id)
        action = "added"
    await db.shared_presets.update_one(
        {"_id": preset_id},
        {"$set": {"upvotes": upvotes, "upvote_count": len(upvotes)}},
    )
    return {
        "id": preset_id,
        "upvote_count": len(upvotes),
        "viewer_upvoted": user.user_id in upvotes,
        "action": action,
    }


@api_router.delete("/presets/marketplace/{preset_id}")
async def delete_preset(preset_id: str, user: User = Depends(get_current_user)):
    doc = await db.shared_presets.find_one({"_id": preset_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Preset not found")
    if doc.get("author_user_id") != user.user_id and not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete a shared preset.")
    await db.shared_presets.delete_one({"_id": preset_id})
    # Cascade — orphaned comments serve nobody.
    await db.preset_comments.delete_many({"preset_id": preset_id})
    return {"id": preset_id, "deleted": True}


# ---------------------------------------------------------------------
# Comments — short "tip / feedback" notes on a shared preset.
# ---------------------------------------------------------------------
_MAX_COMMENT_LEN = 500


class CommentBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=_MAX_COMMENT_LEN)


def _shape_comment(doc: dict[str, Any], viewer_user_id: str) -> dict[str, Any]:
    return {
        "id": doc["_id"],
        "preset_id": doc.get("preset_id"),
        "author_user_id": doc.get("author_user_id"),
        "author_name": doc.get("author_name") or "Someone",
        "body": doc.get("body") or "",
        "created_at": doc.get("created_at"),
        "can_delete": bool(viewer_user_id and doc.get("author_user_id") == viewer_user_id),
    }


@api_router.post("/presets/marketplace/{preset_id}/comments")
async def add_comment(preset_id: str, body: CommentBody, user: User = Depends(get_current_user)):
    preset = await db.shared_presets.find_one({"_id": preset_id}, projection={"_id": 1})
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "_id": f"comment_{secrets.token_hex(6)}",
        "preset_id": preset_id,
        "author_user_id": user.user_id,
        "author_name": (getattr(user, "name", None) or "").strip()[:60] or "Someone",
        "body": re.sub(r"\s+", " ", body.body).strip()[:_MAX_COMMENT_LEN],
        "created_at": now,
    }
    await db.preset_comments.insert_one(doc)
    return _shape_comment(doc, viewer_user_id=user.user_id)


@api_router.get("/presets/marketplace/{preset_id}/comments")
async def list_comments(preset_id: str, user: User = Depends(get_current_user), limit: int = Query(50, ge=1, le=200)):
    cur = db.preset_comments.find({"preset_id": preset_id}, sort=[("created_at", -1)], limit=limit)
    docs = await cur.to_list(length=limit)
    return {
        "items": [_shape_comment(d, viewer_user_id=user.user_id) for d in docs],
        "total": len(docs),
    }


@api_router.delete("/presets/marketplace/{preset_id}/comments/{comment_id}")
async def delete_comment(preset_id: str, comment_id: str, user: User = Depends(get_current_user)):
    doc = await db.preset_comments.find_one({"_id": comment_id, "preset_id": preset_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Comment not found")
    if doc.get("author_user_id") != user.user_id and not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Only the comment author or an admin can delete this.")
    await db.preset_comments.delete_one({"_id": comment_id})
    return {"id": comment_id, "deleted": True}
