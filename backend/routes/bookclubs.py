"""Book-club reading rooms.

Shared private rooms where friends read a single book together and discuss
chapter-by-chapter. P2 backlog item (2026-06-15).

Collections
-----------
bookclubs:
    {
      room_id, name, description,
      book_id (the owner's copy used as the canonical reference),
      book_title, book_author, book_total_chapters,
      owner_user_id,
      schedule: str (free-form, e.g. "2 chapters / week"),
      created_at, updated_at,
    }

bookclub_members:
    {
      room_id, user_id,
      role: "owner" | "moderator" | "member",
      status: "invited" | "active",
      invited_by, invited_at,
      joined_at,
      current_chapter: int   # 0 = haven't started; otherwise 1-based chapter
    }

bookclub_messages:
    {
      message_id, room_id, user_id, user_name,
      chapter_index: int     # 0 = general / lobby; 1..N = chapter thread
      body, created_at,
    }
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user
from routes.notifications import create_notification


# ---------------------------------------------------------------------
# Pydantic bodies
# ---------------------------------------------------------------------

class BookclubCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    book_id: str = Field(..., min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    schedule: str = Field(default="", max_length=200)


class BookclubUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=2000)
    schedule: Optional[str] = Field(default=None, max_length=200)


class BookclubInvite(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=80)


class BookclubProgress(BaseModel):
    current_chapter: int = Field(..., ge=0, le=2000)


class BookclubMessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    chapter_index: int = Field(default=0, ge=0, le=2000)


class BookclubRoleUpdate(BaseModel):
    role: Literal["moderator", "member"]


class BookclubTransfer(BaseModel):
    new_owner_user_id: str = Field(..., min_length=1, max_length=80)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _iso(dt: Any) -> Optional[str]:
    return dt.isoformat() if isinstance(dt, datetime) else dt


def _serialize_room(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "room_id": doc["room_id"],
        "name": doc.get("name", ""),
        "description": doc.get("description", ""),
        "book_id": doc.get("book_id"),
        "book_title": doc.get("book_title", ""),
        "book_author": doc.get("book_author", ""),
        "book_total_chapters": int(doc.get("book_total_chapters", 0) or 0),
        "owner_user_id": doc.get("owner_user_id"),
        "schedule": doc.get("schedule", ""),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


def _serialize_member(doc: Dict[str, Any], user_meta: Dict[str, Any] = None) -> Dict[str, Any]:
    user_meta = user_meta or {}
    return {
        "user_id": doc["user_id"],
        "role": doc.get("role", "member"),
        "status": doc.get("status", "active"),
        "current_chapter": int(doc.get("current_chapter", 0) or 0),
        "invited_by": doc.get("invited_by"),
        "invited_at": _iso(doc.get("invited_at")),
        "joined_at": _iso(doc.get("joined_at")),
        "name": user_meta.get("name", ""),
        "email": user_meta.get("email", ""),
        "picture": user_meta.get("picture", ""),
    }


def _serialize_message(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "message_id": doc["message_id"],
        "room_id": doc["room_id"],
        "user_id": doc["user_id"],
        "user_name": doc.get("user_name", ""),
        "chapter_index": int(doc.get("chapter_index", 0) or 0),
        "body": doc.get("body", ""),
        "created_at": _iso(doc.get("created_at")),
    }


async def _hydrate_users(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not user_ids:
        return {}
    docs = await db.users.find(
        {"user_id": {"$in": list(set(user_ids))}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1},
    ).to_list(length=500)
    return {d["user_id"]: d for d in docs}


async def _get_member(room_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    return await db.bookclub_members.find_one(
        {"room_id": room_id, "user_id": user_id}, {"_id": 0},
    )


async def _require_active_member(room_id: str, user_id: str) -> Dict[str, Any]:
    m = await _get_member(room_id, user_id)
    if not m or m.get("status") != "active":
        raise HTTPException(status_code=403, detail="You are not a member of this room")
    return m


async def _require_role(room_id: str, user_id: str, allowed: List[str]) -> Dict[str, Any]:
    m = await _require_active_member(room_id, user_id)
    if m.get("role") not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient role for this action")
    return m


async def _are_friends(a: str, b: str) -> bool:
    if a == b:
        return False
    lo, hi = (a, b) if a < b else (b, a)
    row = await db.friendships.find_one(
        {"user_a": lo, "user_b": hi, "status": "accepted"},
        {"_id": 0, "status": 1},
    )
    return bool(row)


# ---------------------------------------------------------------------
# GET /api/bookclubs — list rooms I'm a member of (+ pending invites)
# ---------------------------------------------------------------------

@api_router.get("/bookclubs")
async def list_my_bookclubs(user: User = Depends(get_current_user)):
    member_rows = await db.bookclub_members.find(
        {"user_id": user.user_id, "status": {"$in": ["active", "invited"]}},
        {"_id": 0},
    ).to_list(length=500)
    if not member_rows:
        return {"rooms": [], "invites": []}

    room_ids = [r["room_id"] for r in member_rows]
    room_docs = await db.bookclubs.find(
        {"room_id": {"$in": room_ids}}, {"_id": 0},
    ).to_list(length=500)
    by_room = {r["room_id"]: r for r in room_docs}

    # Count active members per room — single aggregation for cheap counts.
    active_counts: Dict[str, int] = {}
    if room_ids:
        agg = db.bookclub_members.aggregate([
            {"$match": {"room_id": {"$in": room_ids}, "status": "active"}},
            {"$group": {"_id": "$room_id", "n": {"$sum": 1}}},
        ])
        async for row in agg:
            active_counts[row["_id"]] = int(row["n"])

    active, invites = [], []
    for m in member_rows:
        rdoc = by_room.get(m["room_id"])
        if not rdoc:
            continue
        out = _serialize_room(rdoc)
        out["my_role"] = m.get("role", "member")
        out["my_current_chapter"] = int(m.get("current_chapter", 0) or 0)
        out["member_count"] = active_counts.get(m["room_id"], 0)
        if m.get("status") == "active":
            active.append(out)
        else:
            out["invited_by"] = m.get("invited_by")
            out["invited_at"] = _iso(m.get("invited_at"))
            invites.append(out)
    # Newest first.
    active.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
    invites.sort(key=lambda r: r.get("invited_at") or "", reverse=True)
    return {"rooms": active, "invites": invites}


@api_router.get("/bookclubs/pending-count")
async def pending_invite_count(user: User = Depends(get_current_user)):
    n = await db.bookclub_members.count_documents(
        {"user_id": user.user_id, "status": "invited"},
    )
    return {"pending_in": n}


# ---------------------------------------------------------------------
# POST /api/bookclubs — create a room (owner adds themselves as owner)
# ---------------------------------------------------------------------

@api_router.post("/bookclubs")
async def create_bookclub(body: BookclubCreate, user: User = Depends(get_current_user)):
    book = await db.books.find_one(
        {"book_id": body.book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "chapters": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found in your library")

    chapters = book.get("chapters") or []
    total_chapters = len(chapters) if isinstance(chapters, list) else 0

    now = datetime.now(timezone.utc)
    room_id = f"club_{uuid.uuid4().hex[:12]}"
    room = {
        "room_id": room_id,
        "name": body.name.strip(),
        "description": (body.description or "").strip(),
        "book_id": book["book_id"],
        "book_title": book.get("title", ""),
        "book_author": book.get("author", ""),
        "book_total_chapters": total_chapters,
        "owner_user_id": user.user_id,
        "schedule": (body.schedule or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await db.bookclubs.insert_one(room)
    await db.bookclub_members.insert_one({
        "room_id": room_id,
        "user_id": user.user_id,
        "role": "owner",
        "status": "active",
        "invited_by": user.user_id,
        "invited_at": now,
        "joined_at": now,
        "current_chapter": 0,
    })
    return _serialize_room(room)


# ---------------------------------------------------------------------
# GET /api/bookclubs/{room_id} — room detail
# ---------------------------------------------------------------------

@api_router.get("/bookclubs/{room_id}")
async def get_bookclub(room_id: str, user: User = Depends(get_current_user)):
    me = await _get_member(room_id, user.user_id)
    if not me or me.get("status") == "left":
        raise HTTPException(status_code=403, detail="You are not a member of this room")

    room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    member_rows = await db.bookclub_members.find(
        {"room_id": room_id, "status": {"$in": ["active", "invited"]}}, {"_id": 0},
    ).to_list(length=500)
    user_meta = await _hydrate_users([m["user_id"] for m in member_rows])

    members = [
        _serialize_member(m, user_meta.get(m["user_id"], {}))
        for m in member_rows
    ]
    # Sort: owner first, then moderators, then members alpha by name.
    order = {"owner": 0, "moderator": 1, "member": 2}
    members.sort(key=lambda m: (order.get(m["role"], 9), (m.get("name") or m.get("email") or "").lower()))

    out = _serialize_room(room)
    out["members"] = members
    out["my_role"] = me.get("role", "member")
    out["my_status"] = me.get("status", "active")
    out["my_current_chapter"] = int(me.get("current_chapter", 0) or 0)
    return out


# ---------------------------------------------------------------------
# PATCH /api/bookclubs/{room_id} — owner/moderator update
# ---------------------------------------------------------------------

@api_router.patch("/bookclubs/{room_id}")
async def update_bookclub(room_id: str, body: BookclubUpdate, user: User = Depends(get_current_user)):
    await _require_role(room_id, user.user_id, ["owner", "moderator"])
    update: Dict[str, Any] = {}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.schedule is not None:
        update["schedule"] = body.schedule.strip()
    if not update:
        room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0})
        return _serialize_room(room)
    update["updated_at"] = datetime.now(timezone.utc)
    await db.bookclubs.update_one({"room_id": room_id}, {"$set": update})
    refreshed = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0})
    return _serialize_room(refreshed)


# ---------------------------------------------------------------------
# DELETE /api/bookclubs/{room_id} — owner only, cascade
# ---------------------------------------------------------------------

@api_router.delete("/bookclubs/{room_id}")
async def delete_bookclub(room_id: str, user: User = Depends(get_current_user)):
    me = await _get_member(room_id, user.user_id)
    if not me or me.get("role") != "owner" or me.get("status") != "active":
        raise HTTPException(status_code=403, detail="Only the room owner can delete this room")
    await db.bookclubs.delete_one({"room_id": room_id})
    await db.bookclub_members.delete_many({"room_id": room_id})
    await db.bookclub_messages.delete_many({"room_id": room_id})
    return {"deleted": room_id}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/invite
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/invite")
async def invite_to_bookclub(room_id: str, body: BookclubInvite, user: User = Depends(get_current_user)):
    await _require_role(room_id, user.user_id, ["owner", "moderator"])
    target_id = body.user_id.strip()
    if target_id == user.user_id:
        raise HTTPException(status_code=400, detail="You can't invite yourself")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not await _are_friends(user.user_id, target_id):
        raise HTTPException(status_code=403, detail="You can only invite friends to your reading room")

    existing = await _get_member(room_id, target_id)
    if existing:
        if existing.get("status") == "active":
            raise HTTPException(status_code=409, detail="That user is already a member")
        if existing.get("status") == "invited":
            raise HTTPException(status_code=409, detail="That user has already been invited")

    room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0, "name": 1, "book_title": 1})
    now = datetime.now(timezone.utc)
    await db.bookclub_members.insert_one({
        "room_id": room_id,
        "user_id": target_id,
        "role": "member",
        "status": "invited",
        "invited_by": user.user_id,
        "invited_at": now,
        "joined_at": None,
        "current_chapter": 0,
    })
    await create_notification(
        target_id,
        kind="bookclub_invite",
        title=f"{user.name or user.email} invited you to a reading room",
        body=f'Join "{(room or {}).get("name", "")}" to read {(room or {}).get("book_title", "this book")} together.',
        link="/bookclubs",
    )
    return {"status": "invited", "user_id": target_id}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/accept | /decline
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/accept")
async def accept_bookclub_invite(room_id: str, user: User = Depends(get_current_user)):
    me = await _get_member(room_id, user.user_id)
    if not me or me.get("status") != "invited":
        raise HTTPException(status_code=404, detail="No pending invite for this room")
    now = datetime.now(timezone.utc)
    await db.bookclub_members.update_one(
        {"room_id": room_id, "user_id": user.user_id},
        {"$set": {"status": "active", "joined_at": now}},
    )
    # Notify the inviter that we joined.
    inviter = me.get("invited_by")
    if inviter and inviter != user.user_id:
        room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0, "name": 1})
        await create_notification(
            inviter,
            kind="bookclub_joined",
            title=f"{user.name or user.email} joined your reading room",
            body=f'They are now in "{(room or {}).get("name", "")}".',
            link=f"/bookclubs/{room_id}",
        )
    return {"status": "active"}


@api_router.post("/bookclubs/{room_id}/decline")
async def decline_bookclub_invite(room_id: str, user: User = Depends(get_current_user)):
    me = await _get_member(room_id, user.user_id)
    if not me or me.get("status") != "invited":
        raise HTTPException(status_code=404, detail="No pending invite for this room")
    await db.bookclub_members.delete_one({"room_id": room_id, "user_id": user.user_id})
    return {"status": "declined"}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/leave
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/leave")
async def leave_bookclub(room_id: str, user: User = Depends(get_current_user)):
    me = await _get_member(room_id, user.user_id)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="You are not a member of this room")
    if me.get("role") == "owner":
        # The owner can't leave without transferring (or deleting) first.
        # Count other active members.
        others = await db.bookclub_members.count_documents({
            "room_id": room_id,
            "status": "active",
            "user_id": {"$ne": user.user_id},
        })
        if others > 0:
            raise HTTPException(
                status_code=400,
                detail="Transfer ownership before leaving, or delete the room.",
            )
        # No one else is here — cascade delete is cleanest.
        await db.bookclubs.delete_one({"room_id": room_id})
        await db.bookclub_members.delete_many({"room_id": room_id})
        await db.bookclub_messages.delete_many({"room_id": room_id})
        return {"status": "left", "room_deleted": True}
    await db.bookclub_members.delete_one({"room_id": room_id, "user_id": user.user_id})
    return {"status": "left"}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/members/{user_id}/role
# POST /api/bookclubs/{room_id}/members/{user_id}/remove
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/members/{target_user_id}/role")
async def set_member_role(
    room_id: str, target_user_id: str, body: BookclubRoleUpdate,
    user: User = Depends(get_current_user),
):
    await _require_role(room_id, user.user_id, ["owner"])
    if target_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You can't change your own role here")
    target = await _get_member(room_id, target_user_id)
    if not target or target.get("status") != "active":
        raise HTTPException(status_code=404, detail="Member not found")
    if target.get("role") == "owner":
        raise HTTPException(status_code=400, detail="Use transfer to change the owner")
    await db.bookclub_members.update_one(
        {"room_id": room_id, "user_id": target_user_id},
        {"$set": {"role": body.role}},
    )
    return {"user_id": target_user_id, "role": body.role}


@api_router.post("/bookclubs/{room_id}/members/{target_user_id}/remove")
async def remove_member(room_id: str, target_user_id: str, user: User = Depends(get_current_user)):
    await _require_role(room_id, user.user_id, ["owner", "moderator"])
    if target_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="Use /leave to remove yourself")
    target = await _get_member(room_id, target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.get("role") == "owner":
        raise HTTPException(status_code=400, detail="The owner can't be removed")
    await db.bookclub_members.delete_one({"room_id": room_id, "user_id": target_user_id})
    return {"removed": target_user_id}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/transfer — owner hands off
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/transfer")
async def transfer_ownership(
    room_id: str, body: BookclubTransfer, user: User = Depends(get_current_user),
):
    await _require_role(room_id, user.user_id, ["owner"])
    new_owner = body.new_owner_user_id.strip()
    if new_owner == user.user_id:
        raise HTTPException(status_code=400, detail="You are already the owner")
    target = await _get_member(room_id, new_owner)
    if not target or target.get("status") != "active":
        raise HTTPException(status_code=404, detail="New owner must be an active member")

    await db.bookclub_members.update_one(
        {"room_id": room_id, "user_id": user.user_id},
        {"$set": {"role": "moderator"}},
    )
    await db.bookclub_members.update_one(
        {"room_id": room_id, "user_id": new_owner},
        {"$set": {"role": "owner"}},
    )
    await db.bookclubs.update_one(
        {"room_id": room_id},
        {"$set": {"owner_user_id": new_owner, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"owner_user_id": new_owner}


# ---------------------------------------------------------------------
# POST /api/bookclubs/{room_id}/progress
# ---------------------------------------------------------------------

@api_router.post("/bookclubs/{room_id}/progress")
async def set_my_progress(
    room_id: str, body: BookclubProgress, user: User = Depends(get_current_user),
):
    me = await _require_active_member(room_id, user.user_id)
    room = await db.bookclubs.find_one(
        {"room_id": room_id}, {"_id": 0, "book_total_chapters": 1, "name": 1},
    )
    total = int((room or {}).get("book_total_chapters", 0) or 0)
    target_chapter = int(body.current_chapter)
    if total and target_chapter > total:
        target_chapter = total
    prev = int(me.get("current_chapter", 0) or 0)
    await db.bookclub_members.update_one(
        {"room_id": room_id, "user_id": user.user_id},
        {"$set": {"current_chapter": target_chapter}},
    )
    # Milestone notification: notify other active members when this user
    # crosses into a new chapter (forward direction only) and finishes the book.
    if target_chapter > prev:
        others = await db.bookclub_members.find(
            {
                "room_id": room_id,
                "status": "active",
                "user_id": {"$ne": user.user_id},
            },
            {"_id": 0, "user_id": 1},
        ).to_list(length=200)
        room_name = (room or {}).get("name", "")
        if total and target_chapter >= total:
            for o in others:
                await create_notification(
                    o["user_id"],
                    kind="bookclub_finished",
                    title=f"{user.name or user.email} finished the book",
                    body=f'They wrapped up your "{room_name}" read.',
                    link=f"/bookclubs/{room_id}",
                )
    return {"current_chapter": target_chapter}


# ---------------------------------------------------------------------
# GET /api/bookclubs/{room_id}/messages?chapter=N
# POST /api/bookclubs/{room_id}/messages
# ---------------------------------------------------------------------

@api_router.get("/bookclubs/{room_id}/messages")
async def list_messages(
    room_id: str,
    chapter: Optional[int] = None,
    limit: int = 200,
    user: User = Depends(get_current_user),
):
    await _require_active_member(room_id, user.user_id)
    q: Dict[str, Any] = {"room_id": room_id}
    if chapter is not None:
        q["chapter_index"] = int(chapter)
    limit = max(1, min(int(limit or 200), 500))
    docs = await db.bookclub_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(length=limit)
    return {"messages": [_serialize_message(d) for d in docs]}


@api_router.post("/bookclubs/{room_id}/messages")
async def post_message(
    room_id: str, body: BookclubMessageCreate, user: User = Depends(get_current_user),
):
    await _require_active_member(room_id, user.user_id)
    room = await db.bookclubs.find_one(
        {"room_id": room_id}, {"_id": 0, "name": 1, "book_total_chapters": 1},
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    chapter_index = int(body.chapter_index)
    total = int(room.get("book_total_chapters", 0) or 0)
    if total and chapter_index > total:
        raise HTTPException(status_code=400, detail=f"Chapter {chapter_index} exceeds book length ({total})")

    now = datetime.now(timezone.utc)
    msg = {
        "message_id": f"clubmsg_{uuid.uuid4().hex[:12]}",
        "room_id": room_id,
        "user_id": user.user_id,
        "user_name": user.name or user.email,
        "chapter_index": chapter_index,
        "body": body.body.strip(),
        "created_at": now,
    }
    await db.bookclub_messages.insert_one(msg)
    await db.bookclubs.update_one(
        {"room_id": room_id}, {"$set": {"updated_at": now}},
    )

    # Fan-out notifications to every OTHER active member.
    others = await db.bookclub_members.find(
        {
            "room_id": room_id,
            "status": "active",
            "user_id": {"$ne": user.user_id},
        },
        {"_id": 0, "user_id": 1},
    ).to_list(length=200)
    ch_label = f"Ch. {chapter_index}" if chapter_index > 0 else "Lobby"
    preview = msg["body"][:80] + ("…" if len(msg["body"]) > 80 else "")
    for o in others:
        await create_notification(
            o["user_id"],
            kind="bookclub_message",
            title=f"{msg['user_name']} posted in {room.get('name', '')}",
            body=f"{ch_label}: {preview}",
            link=f"/bookclubs/{room_id}?chapter={chapter_index}",
        )
    return _serialize_message(msg)
