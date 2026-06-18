"""Direct messaging between Shelfsort users.

Phase 1 — admin-curated rooms only:
  * Only admins can create rooms and set their member list.
  * Members of a room can list its messages and post new ones.
  * Each room is a separate thread; the UI shows them as a sidebar.
  * Three message kinds: text, book (snapshots a book the sender owns),
    palette (a Shelfsort palette token from /account/appearance).
  * Per-user read marker drives the unread badge in the navbar.

Future phases (parked):
  * 1a — open user-to-user messaging
  * 1b — friend-request gated messaging
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, require_admin
from utils.admin_audit import record_admin_action


# ---------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------

class ChatRoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    member_user_ids: List[str] = Field(..., min_length=1, max_length=50)


class ChatRoomUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    member_user_ids: Optional[List[str]] = Field(default=None, min_length=1, max_length=50)


class ChatAttachment(BaseModel):
    book_id: Optional[str] = None
    book_title: Optional[str] = Field(default=None, max_length=200)
    book_author: Optional[str] = Field(default=None, max_length=200)
    palette_token: Optional[str] = Field(default=None, max_length=4000)
    palette_name: Optional[str] = Field(default=None, max_length=80)


class ChatMessageCreate(BaseModel):
    body: str = Field(default="", max_length=4000)
    kind: Literal["text", "book", "palette"] = "text"
    attachment: Optional[ChatAttachment] = None


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _serialize_room(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "room_id": doc["room_id"],
        "name": doc["name"],
        "member_user_ids": doc.get("member_user_ids", []),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "created_by": doc.get("created_by"),
        "last_message_at": doc["last_message_at"].isoformat() if isinstance(doc.get("last_message_at"), datetime) else doc.get("last_message_at"),
    }


def _serialize_message(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "message_id": doc["message_id"],
        "room_id": doc["room_id"],
        "sender_user_id": doc["sender_user_id"],
        "sender_name": doc.get("sender_name", ""),
        "body": doc.get("body", ""),
        "kind": doc.get("kind", "text"),
        "attachment": doc.get("attachment"),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


async def _get_room_for_member(room_id: str, user_id: str) -> Dict[str, Any]:
    """Fetch a room and 404 if the user isn't a member. Admin status is
    NOT a bypass here — admins can manage rooms but must be added as a
    member to read/send in them, same as anyone else."""
    room = await db.chat_rooms.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if user_id not in (room.get("member_user_ids") or []):
        raise HTTPException(status_code=403, detail="You are not a member of this room")
    return room


# ---------------------------------------------------------------------
# Admin endpoints — room CRUD
# ---------------------------------------------------------------------

@api_router.get("/admin/chat-rooms")
async def admin_list_chat_rooms(user: User = Depends(require_admin)):
    rooms = await db.chat_rooms.find({}, {"_id": 0}).to_list(length=200)
    return {"rooms": [_serialize_room(r) for r in rooms]}


@api_router.post("/admin/chat-rooms")
async def admin_create_chat_room(body: ChatRoomCreate, user: User = Depends(require_admin)):
    # Validate every user_id exists
    member_set = list({uid for uid in body.member_user_ids if uid})
    if not member_set:
        raise HTTPException(status_code=400, detail="At least one member required")
    found = await db.users.count_documents({"user_id": {"$in": member_set}})
    if found != len(member_set):
        raise HTTPException(status_code=400, detail="One or more member_user_ids do not exist")

    now = datetime.now(timezone.utc)
    room = {
        "room_id": f"room_{uuid.uuid4().hex[:12]}",
        "name": body.name.strip(),
        "member_user_ids": member_set,
        "created_at": now,
        "created_by": user.user_id,
        "last_message_at": None,
    }
    await db.chat_rooms.insert_one(room)
    await record_admin_action(
        user, "chat_room.create", target=room["room_id"],
        metadata={"name": room["name"], "members": len(member_set)},
    )
    return _serialize_room(room)


@api_router.put("/admin/chat-rooms/{room_id}")
async def admin_update_chat_room(
    room_id: str, body: ChatRoomUpdate, user: User = Depends(require_admin),
):
    room = await db.chat_rooms.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    update: Dict[str, Any] = {}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.member_user_ids is not None:
        member_set = list({uid for uid in body.member_user_ids if uid})
        if not member_set:
            raise HTTPException(status_code=400, detail="At least one member required")
        found = await db.users.count_documents({"user_id": {"$in": member_set}})
        if found != len(member_set):
            raise HTTPException(status_code=400, detail="One or more member_user_ids do not exist")
        update["member_user_ids"] = member_set
    if not update:
        return _serialize_room(room)
    await db.chat_rooms.update_one({"room_id": room_id}, {"$set": update})
    await record_admin_action(
        user, "chat_room.update", target=room_id,
        metadata={"changed": list(update.keys())},
    )
    refreshed = await db.chat_rooms.find_one({"room_id": room_id}, {"_id": 0})
    return _serialize_room(refreshed)


@api_router.delete("/admin/chat-rooms/{room_id}")
async def admin_delete_chat_room(room_id: str, user: User = Depends(require_admin)):
    room = await db.chat_rooms.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    await db.chat_rooms.delete_one({"room_id": room_id})
    await db.chat_messages.delete_many({"room_id": room_id})
    await db.chat_reads.delete_many({"room_id": room_id})
    await record_admin_action(
        user, "chat_room.delete", target=room_id,
        metadata={"name": room.get("name")},
    )
    return {"deleted": room_id}


# ---------------------------------------------------------------------
# User endpoints — rooms + messages
# ---------------------------------------------------------------------

@api_router.get("/chat/rooms")
async def list_my_chat_rooms(user: User = Depends(get_current_user)):
    """Every room the current user is a member of, newest-active first."""
    rooms = await db.chat_rooms.find(
        {"member_user_ids": user.user_id}, {"_id": 0},
    ).to_list(length=200)
    rooms.sort(
        key=lambda r: r.get("last_message_at") or r.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    # Hydrate member emails so the UI can show who's in each room.
    member_ids = list({uid for r in rooms for uid in (r.get("member_user_ids") or [])})
    member_docs = await db.users.find(
        {"user_id": {"$in": member_ids}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1},
    ).to_list(length=500)
    by_id = {m["user_id"]: m for m in member_docs}

    # Compute unread per room.
    reads = await db.chat_reads.find(
        {"user_id": user.user_id, "room_id": {"$in": [r["room_id"] for r in rooms]}},
        {"_id": 0, "room_id": 1, "last_read_at": 1},
    ).to_list(length=200)
    last_read_by_room = {r["room_id"]: r.get("last_read_at") for r in reads}

    out = []
    for r in rooms:
        last_read = last_read_by_room.get(r["room_id"])
        if last_read:
            unread = await db.chat_messages.count_documents({
                "room_id": r["room_id"],
                "created_at": {"$gt": last_read},
                "sender_user_id": {"$ne": user.user_id},
            })
        else:
            unread = await db.chat_messages.count_documents({
                "room_id": r["room_id"],
                "sender_user_id": {"$ne": user.user_id},
            })
        d = _serialize_room(r)
        d["members"] = [
            {
                "user_id": uid,
                "email": by_id.get(uid, {}).get("email", ""),
                "name": by_id.get(uid, {}).get("name", ""),
            }
            for uid in r.get("member_user_ids", [])
        ]
        d["unread"] = unread
        out.append(d)
    return {"rooms": out}


@api_router.get("/chat/rooms/{room_id}/messages")
async def list_chat_messages(
    room_id: str, limit: int = 100, user: User = Depends(get_current_user),
):
    await _get_room_for_member(room_id, user.user_id)
    limit = max(1, min(int(limit or 100), 500))
    docs = await db.chat_messages.find(
        {"room_id": room_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(length=limit)
    return {"messages": [_serialize_message(d) for d in docs]}


@api_router.post("/chat/rooms/{room_id}/messages")
async def post_chat_message(
    room_id: str, body: ChatMessageCreate, user: User = Depends(get_current_user),
):
    await _get_room_for_member(room_id, user.user_id)
    if body.kind == "text" and not (body.body or "").strip():
        raise HTTPException(status_code=400, detail="Text messages cannot be empty")
    if body.kind == "book":
        if not body.attachment or not body.attachment.book_id:
            raise HTTPException(status_code=400, detail="book_id required for book messages")
        # Snapshot the book metadata at send time so deletes/edits later
        # don't break old messages. Only the sender's own books are allowed.
        book = await db.books.find_one(
            {"book_id": body.attachment.book_id, "user_id": user.user_id},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1},
        )
        if not book:
            raise HTTPException(status_code=404, detail="Book not found in your library")
        attachment = {
            "book_id": book["book_id"],
            "book_title": book.get("title", ""),
            "book_author": book.get("author", ""),
        }
    elif body.kind == "palette":
        if not body.attachment or not body.attachment.palette_token:
            raise HTTPException(status_code=400, detail="palette_token required for palette messages")
        attachment = {
            "palette_token": body.attachment.palette_token,
            "palette_name": (body.attachment.palette_name or "")[:80],
        }
    else:
        attachment = None

    now = datetime.now(timezone.utc)
    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "room_id": room_id,
        "sender_user_id": user.user_id,
        "sender_name": user.name or user.email,
        "body": (body.body or "").strip(),
        "kind": body.kind,
        "attachment": attachment,
        "created_at": now,
    }
    await db.chat_messages.insert_one(msg)
    await db.chat_rooms.update_one(
        {"room_id": room_id}, {"$set": {"last_message_at": now}},
    )
    # Auto-mark the sender as read up to this message.
    await db.chat_reads.update_one(
        {"room_id": room_id, "user_id": user.user_id},
        {"$set": {"last_read_at": now}},
        upsert=True,
    )
    # Push an "incoming message" envelope to every other room member's
    # open SSE channel so the messages-dropdown / friends-page badge
    # bumps in real time instead of waiting for the 15s poll.
    try:
        from utils.event_bus import publish as bus_publish
        room = await db.chat_rooms.find_one(
            {"room_id": room_id}, {"_id": 0, "member_user_ids": 1},
        ) or {}
        envelope = {
            "room_id":   room_id,
            "sender":    user.user_id,
            "preview":   msg["body"][:80],
        }
        for mid in (room.get("member_user_ids") or []):
            if mid != user.user_id:
                await bus_publish(mid, "chat-incoming", envelope)
    except Exception:
        pass
    return _serialize_message(msg)


@api_router.post("/chat/rooms/{room_id}/read")
async def mark_room_read(room_id: str, user: User = Depends(get_current_user)):
    await _get_room_for_member(room_id, user.user_id)
    now = datetime.now(timezone.utc)
    await db.chat_reads.update_one(
        {"room_id": room_id, "user_id": user.user_id},
        {"$set": {"last_read_at": now}},
        upsert=True,
    )
    return {"room_id": room_id, "last_read_at": now.isoformat()}


@api_router.get("/chat/unread-count")
async def my_chat_unread_count(user: User = Depends(get_current_user)):
    """Total unread messages for the navbar badge. Cheap; called every 15s
    by the frontend so we keep this query minimal."""
    rooms = await db.chat_rooms.find(
        {"member_user_ids": user.user_id},
        {"_id": 0, "room_id": 1, "last_message_at": 1},
    ).to_list(length=200)
    if not rooms:
        return {"unread": 0}

    reads = await db.chat_reads.find(
        {"user_id": user.user_id, "room_id": {"$in": [r["room_id"] for r in rooms]}},
        {"_id": 0, "room_id": 1, "last_read_at": 1},
    ).to_list(length=200)
    last_read_by_room = {r["room_id"]: r.get("last_read_at") for r in reads}

    total = 0
    for r in rooms:
        last_read = last_read_by_room.get(r["room_id"])
        q: Dict[str, Any] = {
            "room_id": r["room_id"],
            "sender_user_id": {"$ne": user.user_id},
        }
        if last_read:
            q["created_at"] = {"$gt": last_read}
        total += await db.chat_messages.count_documents(q)
    return {"unread": total}
