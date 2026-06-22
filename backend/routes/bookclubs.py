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
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, require_moderator_or_admin
from utils.admin_audit import record_admin_action
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
        # Lock state (mod/admin freezes writes — reads still work). The
        # frontend surfaces a banner + hides the compose box when true.
        "is_locked": bool(doc.get("is_locked", False)),
        "locked_by_name": doc.get("locked_by_name"),
        "locked_at": _iso(doc.get("locked_at")) if doc.get("locked_at") else None,
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
        # Surface the platform-wide moderator / admin flags so chat
        # bubbles can render a "Mod" / "Admin" badge inline.  Visibility
        # decision (2026-06-17): public — helps users trust intervention.
        "is_moderator": bool(user_meta.get("is_moderator", False)),
        "is_admin": bool(user_meta.get("is_admin", False)),
    }


def _serialize_message(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "message_id": doc["message_id"],
        "room_id": doc["room_id"],
        "user_id": doc["user_id"],
        "user_name": doc.get("user_name", ""),
        "user_username": doc.get("user_username"),
        "user_previous_username": doc.get("user_previous_username"),
        "chapter_index": int(doc.get("chapter_index", 0) or 0),
        "body": doc.get("body", ""),
        "is_system": bool(doc.get("is_system", False)),
        "created_at": _iso(doc.get("created_at")),
    }


async def _maybe_post_buddy_pacing(
    room: Dict[str, Any], room_id: str, target_chapter: int,
) -> None:
    """Buddy-pacing: when both members of a 2-person room cross into a
    new chapter, post a system message inviting the discussion.

    Triggered from ``set_my_progress`` after a forward chapter move.
    Idempotent — checks for an existing system trigger for the same
    (room_id, chapter_index) before posting.  Only fires for rooms with
    exactly two active human members (oversight role excluded), so it
    stays out of larger clubs where chapter pacing is messier.
    """
    if target_chapter <= 0:
        return
    members = await db.bookclub_members.find(
        {
            "room_id": room_id,
            "status": "active",
            "role": {"$ne": "oversight"},
        },
        {"_id": 0, "user_id": 1, "current_chapter": 1},
    ).to_list(length=10)
    if len(members) != 2:
        return
    # Both must be at-or-past the target chapter for the nudge to make sense.
    if not all(int(m.get("current_chapter", 0) or 0) >= target_chapter for m in members):
        return

    # Idempotency: skip if we already posted a buddy-pacing nudge for this chapter.
    existing = await db.bookclub_messages.find_one(
        {"room_id": room_id, "chapter_index": target_chapter, "is_system": True,
         "system_kind": "buddy_pacing"},
        {"_id": 1},
    )
    if existing is not None:
        return

    now = datetime.now(timezone.utc)
    msg = {
        "message_id": f"clubmsg_{uuid.uuid4().hex[:12]}",
        "room_id": room_id,
        "user_id": "system",
        "user_name": "Shelfsort",
        "user_username": None,
        "user_previous_username": None,
        "chapter_index": target_chapter,
        "body": f"Both of you have reached Chapter {target_chapter}. Ready to talk about it?",
        "is_system": True,
        "system_kind": "buddy_pacing",
        "created_at": now,
    }
    await db.bookclub_messages.insert_one(msg)
    await db.bookclubs.update_one(
        {"room_id": room_id}, {"$set": {"updated_at": now}},
    )
    # Ping both members in-app so they discover the prompt.
    room_name = (room or {}).get("name", "")
    for m in members:
        await create_notification(
            m["user_id"],
            kind="bookclub_message",
            title=f"Both of you reached Chapter {target_chapter}",
            body=f'Time to discuss in "{room_name}".',
            link=f"/bookclubs/{room_id}?chapter={target_chapter}",
        )


async def _hydrate_users(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not user_ids:
        return {}
    docs = await db.users.find(
        {"user_id": {"$in": list(set(user_ids))}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1,
         "previous_username": 1, "picture": 1, "is_moderator": 1, "is_admin": 1},
    ).to_list(length=500)
    return {d["user_id"]: d for d in docs}


async def _get_member(room_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    return await db.bookclub_members.find_one(
        {"room_id": room_id, "user_id": user_id}, {"_id": 0},
    )


# ---------------------------------------------------------------------
# Platform-owner oversight ("Admin (oversight)" auto-membership)
# ---------------------------------------------------------------------
# Policy decided 2026-06-16: the original platform owner is automatically
# added as a silent-but-visible member of every book-club room so they can
# moderate abuse without needing to ask each owner for consent. The owner
# is shown to other members as role "oversight" (badge: "Admin (oversight)")
# and is explicitly excluded from kick / role-change / promote endpoints,
# from notification fan-outs, and from the weekly digest email opt-in flow.
# Friend DMs are NOT touched — only bookclubs (group rooms).

_PLATFORM_OWNER_ID_CACHE: Dict[str, Optional[str]] = {"v": None}


async def _get_platform_owner_id() -> Optional[str]:
    """Return the single ``is_platform_owner: true`` user_id, or None.

    Cached in-process; cache is cleared on server restart. If you ever
    transfer the platform-owner flag at runtime, restart the backend.
    """
    if _PLATFORM_OWNER_ID_CACHE["v"]:
        return _PLATFORM_OWNER_ID_CACHE["v"]
    doc = await db.users.find_one(
        {"is_platform_owner": True}, {"_id": 0, "user_id": 1},
    )
    uid = doc["user_id"] if doc else None
    _PLATFORM_OWNER_ID_CACHE["v"] = uid
    return uid


async def _ensure_oversight_member(room_id: str, *, creator_user_id: str) -> None:
    """Add the platform owner as an oversight member of the given room.

    No-op if (a) there is no platform-owner flagged user, (b) the creator
    IS the platform owner, or (c) the oversight member already exists.
    """
    owner_id = await _get_platform_owner_id()
    if not owner_id or owner_id == creator_user_id:
        return
    existing = await db.bookclub_members.find_one(
        {"room_id": room_id, "user_id": owner_id}, {"_id": 0, "role": 1, "status": 1},
    )
    if existing:
        # If they were previously removed / left, re-add them with the
        # oversight role and active status. The platform owner is sticky.
        await db.bookclub_members.update_one(
            {"room_id": room_id, "user_id": owner_id},
            {"$set": {"role": "oversight", "status": "active"}},
        )
        return
    now = datetime.now(timezone.utc)
    await db.bookclub_members.insert_one({
        "room_id": room_id,
        "user_id": owner_id,
        "role": "oversight",
        "status": "active",
        "invited_by": owner_id,
        "invited_at": now,
        "joined_at": now,
        "current_chapter": 0,
    })


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
        # Member-count UX displays "real" members, not the platform-owner
        # oversight row that's auto-added to every room.
        agg = db.bookclub_members.aggregate([
            {"$match": {"room_id": {"$in": room_ids}, "status": "active", "role": {"$ne": "oversight"}}},
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
    await _ensure_oversight_member(room_id, creator_user_id=user.user_id)
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
    # Sort: owner first, then moderators, then members alpha by name; the
    # platform-owner oversight row pins to the bottom so the member-list
    # visual hierarchy still reads "this room's people, then platform oversight".
    order = {"owner": 0, "moderator": 1, "member": 2, "oversight": 9}
    members.sort(key=lambda m: (order.get(m["role"], 5), (m.get("name") or m.get("email") or "").lower()))

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
# Moderation: lock / unlock a room
# ---------------------------------------------------------------------
# A locked room is read-only — existing members can still read every
# message but cannot post.  Used by moderators / admins to freeze a
# discussion that has gone off the rails without nuking the room
# outright.  Setting ``is_locked`` lives on the bookclubs document so
# the existing membership / invite flows don't need to know about it.

@api_router.post("/bookclubs/{room_id}/lock")
async def lock_bookclub(
    room_id: str,
    user: User = Depends(require_moderator_or_admin),
):
    """Freeze writes on this room.  Idempotent — locking an already-locked
    room is a no-op so the UI can fire-and-forget.  Returns the updated
    room snapshot so the frontend can rerender without a second fetch."""
    room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0, "name": 1, "is_locked": 1})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("is_locked"):
        return {"ok": True, "room_id": room_id, "is_locked": True}
    now = datetime.now(timezone.utc)
    await db.bookclubs.update_one(
        {"room_id": room_id},
        {"$set": {
            "is_locked": True,
            "locked_by": user.user_id,
            "locked_by_name": user.name or user.email,
            "locked_at": now,
            "updated_at": now,
        }},
    )
    await record_admin_action(
        user,
        "bookclub.lock",
        target=room_id,
        metadata={"room_name": room.get("name") or ""},
    )
    logger.info("bookclub %s locked by %s (%s)", room_id, user.user_id, "admin" if user.is_admin else "mod")
    return {"ok": True, "room_id": room_id, "is_locked": True}


@api_router.post("/bookclubs/{room_id}/unlock")
async def unlock_bookclub(
    room_id: str,
    user: User = Depends(require_moderator_or_admin),
):
    """Reopen writes on this room.  Idempotent."""
    room = await db.bookclubs.find_one({"room_id": room_id}, {"_id": 0, "is_locked": 1})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not room.get("is_locked"):
        return {"ok": True, "room_id": room_id, "is_locked": False}
    now = datetime.now(timezone.utc)
    await db.bookclubs.update_one(
        {"room_id": room_id},
        {
            "$set": {"is_locked": False, "updated_at": now},
            "$unset": {"locked_by": "", "locked_by_name": "", "locked_at": ""},
        },
    )
    await record_admin_action(
        user,
        "bookclub.unlock",
        target=room_id,
    )
    logger.info("bookclub %s unlocked by %s", room_id, user.user_id)
    return {"ok": True, "room_id": room_id, "is_locked": False}




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
    if me.get("role") == "oversight":
        # Platform-owner oversight is sticky — deleting the room is the
        # only way to drop it.
        raise HTTPException(
            status_code=400,
            detail="Platform oversight can't leave a room; delete the room instead.",
        )
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
    if target.get("role") == "oversight":
        raise HTTPException(status_code=400, detail="Platform oversight role is fixed and cannot be changed")
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
    if target.get("role") == "oversight":
        raise HTTPException(status_code=400, detail="Platform oversight can't be removed from a room")
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
        {"$set": {
            "current_chapter": target_chapter,
            # Engagement signal for the weekly digest pruner — bumped whenever
            # the user moves their reading marker, even backwards.
            "last_progress_update_at": datetime.now(timezone.utc),
        }},
    )
    # Milestone notification: notify other active members when this user
    # crosses into a new chapter (forward direction only) and finishes the book.
    if target_chapter > prev:
        others = await db.bookclub_members.find(
            {
                "room_id": room_id,
                "status": "active",
                "user_id": {"$ne": user.user_id},
                "role": {"$ne": "oversight"},
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
        # Buddy-pacing: 2-person rooms get a system "ready to discuss
        # chapter N?" prompt the first time both members cross into N.
        await _maybe_post_buddy_pacing(room or {}, room_id, target_chapter)
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
        {"room_id": room_id},
        {"_id": 0, "name": 1, "book_total_chapters": 1, "is_locked": 1},
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("is_locked"):
        # Mods / admins use the lock endpoint to freeze a room when a
        # discussion goes off the rails.  Everyone can still READ — we
        # only block writes.
        raise HTTPException(
            status_code=423,
            detail="This room has been locked by a moderator.",
        )
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
        "user_username": user.username,
        "user_previous_username": user.previous_username,
        "chapter_index": chapter_index,
        "body": body.body.strip(),
        "created_at": now,
    }
    await db.bookclub_messages.insert_one(msg)
    await db.bookclubs.update_one(
        {"room_id": room_id}, {"$set": {"updated_at": now}},
    )

    # Fan-out notifications to every OTHER active member, EXCEPT the
    # platform-owner oversight role — we promised that auto-membership
    # wouldn't drown the platform owner's inbox.
    others = await db.bookclub_members.find(
        {
            "room_id": room_id,
            "status": "active",
            "user_id": {"$ne": user.user_id},
            "role": {"$ne": "oversight"},
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


# =====================================================================
# Weekly book-club digest — Monday morning email rollup
# =====================================================================
#
# Opt-in email summarising chapter messages + finished-book milestones
# from every reading room the user is an active member of, over the
# past 7 days. Mirrors the friends_finished pattern: in-app pings
# already fire per-event (bookclub_message, bookclub_finished); this
# is purely the email-channel digest, default OFF.
#
# Preferences live on the user doc:
#   bookclub_digest: {
#     email_enabled: bool=False,
#     last_year_week: str|null,
#     last_email_sent_at: iso str|null,
#   }
#
# Fires from `routes/digest.py:_digest_tick` on Monday 08:00 UTC.
# Idempotent per ISO-year-week. Honours user.email_unsubscribed_all.

BOOKCLUB_DIGEST_LOOKBACK_DAYS = 7
# A user is considered "engaged" with bookclubs (and therefore eligible for
# the weekly digest email) if they've posted a message OR moved their reading
# marker in any room within this window.  Quiet readers who set up a room and
# walked away stop getting the Monday email after this many days of silence.
BOOKCLUB_DIGEST_ENGAGEMENT_DAYS = 28


async def _user_recently_engaged(
    user_id: str, lookback_days: int = BOOKCLUB_DIGEST_ENGAGEMENT_DAYS,
) -> bool:
    """Return True if the user has posted a bookclub message or moved their
    reading marker in any of their rooms within the last `lookback_days`."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    recent_msg = await db.bookclub_messages.find_one(
        {"user_id": user_id, "created_at": {"$gte": cutoff}},
        {"_id": 1},
    )
    if recent_msg is not None:
        return True
    recent_progress = await db.bookclub_members.find_one(
        {"user_id": user_id, "last_progress_update_at": {"$gte": cutoff}},
        {"_id": 1},
    )
    return recent_progress is not None



def _bc_year_week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _get_bookclub_digest_prefs(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    p = user_doc.get("bookclub_digest") or {}
    return {
        "email_enabled": bool(p.get("email_enabled", False)),
        "last_year_week": p.get("last_year_week"),
        "last_email_sent_at": p.get("last_email_sent_at"),
    }


async def _collect_bookclub_digest_payload(
    user_id: str, lookback_days: int = BOOKCLUB_DIGEST_LOOKBACK_DAYS,
) -> Dict[str, Any]:
    """Build a {rooms: [{room, messages_count, finishers, top_messages}]} payload
    summarising the last week of activity across the user's active rooms."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    member_rows = await db.bookclub_members.find(
        {"user_id": user_id, "status": "active"},
        {"_id": 0, "room_id": 1},
    ).to_list(length=500)
    if not member_rows:
        return {"rooms": [], "total_messages": 0, "total_finishers": 0}

    room_ids = [r["room_id"] for r in member_rows]
    rooms = await db.bookclubs.find(
        {"room_id": {"$in": room_ids}},
        {"_id": 0, "room_id": 1, "name": 1, "book_title": 1, "book_author": 1, "book_total_chapters": 1},
    ).to_list(length=500)
    rooms_by_id = {r["room_id"]: r for r in rooms}

    out_rooms = []
    grand_msgs = 0
    grand_finishers = 0
    for rid in room_ids:
        room_meta = rooms_by_id.get(rid)
        if not room_meta:
            continue
        # Messages in the past week, excluding the user's own.
        msgs = await db.bookclub_messages.find(
            {
                "room_id": rid,
                "created_at": {"$gte": cutoff},
                "user_id": {"$ne": user_id},
            },
            {"_id": 0, "user_name": 1, "body": 1, "chapter_index": 1, "created_at": 1},
        ).sort("created_at", -1).limit(5).to_list(length=5)
        total_msgs = await db.bookclub_messages.count_documents({
            "room_id": rid,
            "created_at": {"$gte": cutoff},
            "user_id": {"$ne": user_id},
        })
        # Finishers in the past week (members who hit current_chapter == total).
        finishers_cursor = db.bookclub_members.find(
            {
                "room_id": rid,
                "user_id": {"$ne": user_id},
                "status": "active",
                "current_chapter": {"$gte": int(room_meta.get("book_total_chapters") or 1)},
            },
            {"_id": 0, "user_id": 1},
        )
        finisher_ids = [m["user_id"] async for m in finishers_cursor]
        finishers = []
        if finisher_ids:
            udocs = await db.users.find(
                {"user_id": {"$in": finisher_ids}},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1},
            ).to_list(length=50)
            finishers = [u.get("name") or u.get("email") or "A friend" for u in udocs]
        if total_msgs == 0 and not finishers:
            continue
        top_messages = [
            {
                "user_name": m.get("user_name", ""),
                "chapter_index": int(m.get("chapter_index", 0) or 0),
                "preview": (m.get("body", "")[:140] + ("…" if len(m.get("body", "")) > 140 else "")),
            }
            for m in msgs
        ]
        out_rooms.append({
            "room_id": rid,
            "name": room_meta.get("name", ""),
            "book_title": room_meta.get("book_title", ""),
            "book_author": room_meta.get("book_author", ""),
            "total_messages": int(total_msgs),
            "finishers": finishers,
            "top_messages": top_messages,
        })
        grand_msgs += int(total_msgs)
        grand_finishers += len(finishers)
    out_rooms.sort(key=lambda r: r["total_messages"] + 5 * len(r["finishers"]), reverse=True)
    return {
        "rooms": out_rooms,
        "total_messages": grand_msgs,
        "total_finishers": grand_finishers,
    }


def _build_bookclub_digest_email_payload(
    user_doc: Dict[str, Any], payload: Dict[str, Any], base_url: str,
) -> Dict[str, str]:
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "there").split(" ")[0]
    rooms = payload["rooms"]
    subject = f"Your book-club week: {payload['total_messages']} message{'s' if payload['total_messages'] != 1 else ''} across {len(rooms)} room{'s' if len(rooms) != 1 else ''}"
    text_lines = [
        f"Hi {name},",
        "",
        "Here's what happened in your reading rooms this past week:",
        "",
    ]
    html_blocks = []
    for r in rooms[:10]:
        block_text = [f"# {r['name']} — {r['book_title']}"]
        if r["finishers"]:
            block_text.append(f"  Finishers: {', '.join(r['finishers'])}")
        block_text.append(f"  {r['total_messages']} message{'s' if r['total_messages'] != 1 else ''} this week")
        for m in r["top_messages"][:3]:
            ch = f"Ch. {m['chapter_index']}" if m['chapter_index'] > 0 else "Lobby"
            block_text.append(f"    [{ch}] {m['user_name']}: {m['preview']}")
        text_lines.extend(block_text + [""])

        html_messages = "".join(
            f'<div style="margin:6px 0 0 14px;font-size:13px;color:#2C2C2C;">'
            f'<span style="color:#6B46C1;font-weight:600;">'
            f'{"Ch. " + str(m["chapter_index"]) if m["chapter_index"] > 0 else "Lobby"}'
            f'</span> · <strong>{m["user_name"]}</strong>: {m["preview"]}'
            f'</div>'
            for m in r["top_messages"][:3]
        )
        finishers_html = (
            f'<p style="font-size:12px;color:#1F4D2A;margin:4px 0 0 0;">'
            f'<strong>Finishers:</strong> {", ".join(r["finishers"])}</p>'
            if r["finishers"] else ""
        )
        html_blocks.append(
            f'<div style="padding:12px 0;border-bottom:1px solid #EFEAE0;">'
            f'<a href="{base_url}/bookclubs/{r["room_id"]}" style="text-decoration:none;color:#2C2C2C;">'
            f'<div style="font-weight:700;font-size:16px;">{r["name"]}</div>'
            f'<div style="font-size:13px;color:#6B705C;">{r["book_title"]}</div>'
            f'</a>'
            f'<p style="font-size:13px;color:#6B705C;margin:4px 0 0 0;">'
            f'{r["total_messages"]} message{"s" if r["total_messages"] != 1 else ""} this week</p>'
            f'{finishers_html}'
            f'{html_messages}'
            f'</div>'
        )
    text_lines += [
        f"Open in Shelfsort: {base_url}/bookclubs",
        "",
        "Manage email preferences:",
        f"  {base_url}/account/emails",
        "",
        "— Shelfsort",
    ]
    text = "\n".join(text_lines)
    html = (
        '<div style="font-family:Georgia,serif;color:#2C2C2C;line-height:1.5;max-width:600px;">'
        f'<h2 style="font-size:22px;margin:0 0 6px 0;">Your book-club week</h2>'
        f'<p style="color:#6B705C;font-size:14px;margin:0 0 14px 0;">'
        f'{payload["total_messages"]} message{"s" if payload["total_messages"] != 1 else ""} across {len(rooms)} room{"s" if len(rooms) != 1 else ""}'
        f'{(", " + str(payload["total_finishers"]) + " finisher" + ("s" if payload["total_finishers"] != 1 else "")) if payload["total_finishers"] else ""}.'
        '</p>'
        + "".join(html_blocks) +
        f'<p style="margin:20px 0 0 0;"><a href="{base_url}/bookclubs" '
        'style="background:#6B46C1;color:white;text-decoration:none;padding:10px 18px;'
        'border-radius:8px;font-weight:600;display:inline-block;">'
        'Open your rooms</a></p>'
        f'<p style="font-size:11px;color:#6B705C;margin-top:24px;">'
        f'You\'re getting this because you opted into the "Book-club weekly digest" email channel. '
        f'<a href="{base_url}/account/emails" style="color:#6B46C1;">Manage preferences</a>.'
        '</p>'
        '</div>'
    )
    return {"subject": subject, "html": html, "text": text}


async def _send_bookclub_digest_email(user_doc: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    from deps import RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL
    import asyncio
    import resend
    from utils.email_log import log_email_send

    to_email = user_doc.get("email") or ""
    if not to_email:
        return {"delivered": False, "reason": "no_email"}
    base = (FRONTEND_URL or "").rstrip("/")
    msg = _build_bookclub_digest_email_payload(user_doc, payload, base)
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent bookclub digest to %s", to_email)
        return {"delivered": False, "logged": True}
    try:
        resend.api_key = RESEND_API_KEY
        params = {"from": SENDER_EMAIL, "to": [to_email], **msg}
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("bookclub_digest", to_email, "ok", resend_id=(result or {}).get("id"))
        return {"delivered": True, "id": (result or {}).get("id")}
    except Exception as e:
        logger.error("Bookclub digest email send failed for %s: %s", to_email, e)
        await log_email_send("bookclub_digest", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e)}


async def maybe_send_bookclub_digest(user_doc: Dict[str, Any]) -> bool:
    """Called from the weekly digest tick. Only sends email; in-app pings
    already fire per-message via bookclub_message / bookclub_finished kinds.
    Idempotent per ISO-year-week. Returns True if email actually delivered
    (or was logged in test envs)."""
    # 2026-06-22 — Resend quota brake.  Skip when the user opted into
    # the consolidated Friday weekly_summary email.
    try:
        from utils.weekly_user_summary import is_in_weekly_summary_mode  # noqa: WPS433
        if is_in_weekly_summary_mode(user_doc):
            return False
    except Exception:
        pass
    prefs = _get_bookclub_digest_prefs(user_doc)
    if not prefs.get("email_enabled"):
        return False
    now = datetime.now(timezone.utc)
    yw = _bc_year_week_key(now)
    if prefs.get("last_year_week") == yw:
        return False
    # Engagement gate — stop emailing users who haven't touched their rooms in
    # weeks.  Still mark the week as handled so a quiet user doesn't re-tick on
    # every subsequent run during the same calendar week.
    if not await _user_recently_engaged(user_doc["user_id"]):
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {"bookclub_digest.last_year_week": yw}},
        )
        return False
    payload = await _collect_bookclub_digest_payload(user_doc["user_id"])
    if not payload["rooms"]:
        # Quiet week — still mark handled to avoid re-checking 24x.
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {"bookclub_digest.last_year_week": yw}},
        )
        return False
    result = await _send_bookclub_digest_email(user_doc, payload)
    set_updates: Dict[str, Any] = {"bookclub_digest.last_year_week": yw}
    delivered = bool(result.get("delivered") or result.get("logged"))
    if delivered:
        set_updates["bookclub_digest.last_email_sent_at"] = now.isoformat()
    await db.users.update_one(
        {"user_id": user_doc["user_id"]},
        {"$set": set_updates},
    )
    return delivered


# ---------------------------------------------------------------------
# Preferences + preview
# ---------------------------------------------------------------------

class BookclubDigestPrefsBody(BaseModel):
    email_enabled: bool


@api_router.get("/bookclubs/digest/settings")
async def get_bookclub_digest_settings(user: User = Depends(get_current_user)):
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "bookclub_digest": 1},
    ) or {}
    from deps import RESEND_API_KEY
    prefs = _get_bookclub_digest_prefs(doc)
    prefs["email_configured"] = bool(RESEND_API_KEY)
    return prefs


@api_router.put("/bookclubs/digest/settings")
async def update_bookclub_digest_settings(
    body: BookclubDigestPrefsBody, user: User = Depends(get_current_user),
):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"bookclub_digest.email_enabled": bool(body.email_enabled)}},
    )
    return await get_bookclub_digest_settings(user)


@api_router.post("/bookclubs/digest/preview")
async def preview_bookclub_digest(
    send_email: bool = False, user: User = Depends(get_current_user),
):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    payload = await _collect_bookclub_digest_payload(user.user_id)
    if not payload["rooms"]:
        return {"sent": False, "reason": "no_activity", **payload}
    email_result = {"delivered": False, "skipped": True}
    if send_email:
        email_result = await _send_bookclub_digest_email(user_doc, payload)
    return {
        "sent": bool(email_result.get("delivered")),
        "logged": bool(email_result.get("logged")),
        "error": email_result.get("error"),
        **payload,
    }
