"""User in-app notifications.

Generic key-value style — any feature can drop a notification by calling
`create_notification(user_id, kind, title, body, link)`. The notifications
bell in the navbar polls /api/notifications/unread-count every 15s.

Users can mute specific `kind`s via /api/user/notification-mutes. Muted
kinds are silently dropped at insert time (no DB row created), so they
never count towards the unread badge or appear in the bell. Critical
kinds (e.g. friend_request) cannot be muted — the catalog below marks
which are user-mutable.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


# Catalog of known kinds: label, group, user-mutable flag, description.
# Single source of truth — used for the settings UI and to validate the
# muted_kinds list on save.
NOTIFICATION_CATALOG: List[Dict[str, Any]] = [
    # --- Friends ---
    {"kind": "friend_request",   "group": "Friends",   "label": "Friend request received",
     "description": "Someone wants to add you as a friend.", "mutable": False},
    {"kind": "friend_accepted",  "group": "Friends",   "label": "Friend request accepted",
     "description": "A friend request you sent (or got) was accepted.", "mutable": True},
    {"kind": "friend_new_book",  "group": "Friends",   "label": "Friend uploaded a new fic in your fandom",
     "description": "Pings you when a friend adds a fanfic in a fandom you also collect.", "mutable": True},
    # --- Book clubs ---
    {"kind": "bookclub_invite",  "group": "Book clubs", "label": "Book-club invitation",
     "description": "You've been invited to a reading room.", "mutable": False},
    {"kind": "bookclub_joined",  "group": "Book clubs", "label": "Someone joined your room",
     "description": "A friend accepted your reading-room invite.", "mutable": True},
    {"kind": "bookclub_message", "group": "Book clubs", "label": "New message in a reading room",
     "description": "A member posted in the Lobby or a chapter thread.", "mutable": True},
    {"kind": "bookclub_finished","group": "Book clubs", "label": "Someone finished the book",
     "description": "A reading-room member crossed the finish line.", "mutable": True},
    # --- Recommendations ---
    {"kind": "friends_finished_digest", "group": "Recommendations",
     "label": "Weekly 'From friends' digest",
     "description": "Sunday rollup of books your sharing friends finished.", "mutable": True},
    # --- Reading goals ---
    {"kind": "reading_goal_hit", "group": "Reading goals",
     "label": "Reading goal reached",
     "description": "Pings you the first time you cross a yearly or monthly goal.", "mutable": True},
    # --- Other ---
    {"kind": "suggestion_status", "group": "Suggestions",
     "label": "Status change on your suggestion",
     "description": "An admin reviewed, planned, or shipped one of your suggestions.", "mutable": True},
]

KNOWN_KINDS = {c["kind"] for c in NOTIFICATION_CATALOG}
MUTABLE_KINDS = {c["kind"] for c in NOTIFICATION_CATALOG if c["mutable"]}


async def _muted_kinds(user_id: str) -> set:
    if not user_id:
        return set()
    doc = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "notification_mutes": 1},
    ) or {}
    return set(doc.get("notification_mutes") or [])


async def create_notification(user_id: str, kind: str, title: str, body: str = "", link: str = ""):
    """Public helper for other routes to call. Auto-skips if user_id missing
    OR if the kind is in the user's mute list. Non-mutable kinds bypass the
    mute check (they're critical / actionable)."""
    if not user_id:
        return
    if kind in MUTABLE_KINDS:
        muted = await _muted_kinds(user_id)
        if kind in muted:
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


# ---------------------------------------------------------------------
# Per-kind mute matrix
# ---------------------------------------------------------------------

class NotificationMutesBody(BaseModel):
    muted_kinds: List[str] = Field(default_factory=list, max_length=50)


@api_router.get("/user/notification-mutes")
async def get_notification_mutes(user: User = Depends(get_current_user)):
    """Returns the user's muted-kinds list plus the full catalog so the
    UI can render labelled checkboxes and show which kinds are critical
    (mutable=False)."""
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "notification_mutes": 1},
    ) or {}
    return {
        "muted_kinds": list(doc.get("notification_mutes") or []),
        "catalog": NOTIFICATION_CATALOG,
    }


@api_router.put("/user/notification-mutes")
async def set_notification_mutes(
    body: NotificationMutesBody, user: User = Depends(get_current_user),
):
    """Replace the user's muted-kinds list. Silently ignores unknown
    kinds and rejects attempts to mute non-mutable (critical) kinds."""
    incoming = set(body.muted_kinds or [])
    invalid = incoming - KNOWN_KINDS
    non_mutable = incoming & (KNOWN_KINDS - MUTABLE_KINDS)
    cleaned = sorted(incoming & MUTABLE_KINDS)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"notification_mutes": cleaned}},
    )
    return {
        "muted_kinds": cleaned,
        "ignored_unknown": sorted(invalid),
        "ignored_non_mutable": sorted(non_mutable),
    }
