"""User in-app notifications.

Generic key-value style — any feature can drop a notification by calling
`create_notification(user_id, kind, title, body, link)`. The notifications
bell in the navbar polls /api/notifications/unread-count every 15s.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException
from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


async def create_notification(user_id: str, kind: str, title: str, body: str = "", link: str = ""):
    """Public helper for other routes to call. Auto-skips if user_id missing."""
    if not user_id:
        return
    await db.notifications.insert_one({
        "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "kind": kind,
        "title": title[:200],
        "body": body[:1000],
        "link": link[:300],
        "read": False,
        "created_at": datetime.now(timezone.utc),
    })


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "notification_id": doc["notification_id"],
        "kind": doc["kind"],
        "title": doc["title"],
        "body": doc.get("body", ""),
        "link": doc.get("link", ""),
        "read": bool(doc.get("read", False)),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


@api_router.get("/notifications")
async def list_notifications(limit: int = 50, user: User = Depends(get_current_user)):
    limit = max(1, min(int(limit or 50), 200))
    docs = await db.notifications.find(
        {"user_id": user.user_id}, {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(length=limit)
    return {"notifications": [_serialize(d) for d in docs]}


@api_router.get("/notifications/unread-count")
async def unread_count(user: User = Depends(get_current_user)):
    n = await db.notifications.count_documents({"user_id": user.user_id, "read": False})
    return {"unread": n}


@api_router.post("/notifications/{nid}/read")
async def mark_read(nid: str, user: User = Depends(get_current_user)):
    r = await db.notifications.update_one(
        {"notification_id": nid, "user_id": user.user_id},
        {"$set": {"read": True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"read": nid}


@api_router.post("/notifications/read-all")
async def mark_all_read(user: User = Depends(get_current_user)):
    r = await db.notifications.update_many(
        {"user_id": user.user_id, "read": False},
        {"$set": {"read": True}},
    )
    return {"marked": r.modified_count}
