"""User-to-user friendships + 1-on-1 direct messages.

Phase 1b: friend-request gated DMs.
Phase 1a: privacy toggle to receive DMs from anyone.

Schema:
  friendships {
    friendship_id, user_a, user_b,        # user_a < user_b alphabetically
    status: 'pending' | 'accepted' | 'blocked',
    requested_by,                          # user_id who initiated
    blocked_by,                            # who initiated the block (status='blocked' only)
    created_at, updated_at,
  }
  users.message_privacy: 'friends_only' | 'anyone'   # default 'friends_only'
  users.hidden_from_search: bool                      # default False
"""
import uuid
import re
from datetime import datetime, timezone
from typing import Optional, Literal, Dict, Any, Tuple, List

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user
from routes.notifications import create_notification


def _pair(a: str, b: str) -> Tuple[str, str]:
    """Canonical (small, large) tuple so each friendship has one row."""
    return (a, b) if a < b else (b, a)


def _serialize_friendship(doc: Dict[str, Any], me: str) -> Dict[str, Any]:
    """Surface from the perspective of `me` — who's the other person."""
    other = doc["user_b"] if doc["user_a"] == me else doc["user_a"]
    return {
        "friendship_id": doc["friendship_id"],
        "other_user_id": other,
        "status": doc["status"],
        "requested_by": doc.get("requested_by"),
        "blocked_by": doc.get("blocked_by"),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": doc["updated_at"].isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


async def _hydrate_users(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not user_ids:
        return {}
    docs = await db.users.find(
        {"user_id": {"$in": user_ids}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1, "previous_username": 1, "picture": 1},
    ).to_list(length=500)
    return {d["user_id"]: d for d in docs}


# ---------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------

class FriendRequestBody(BaseModel):
    target_user_id: Optional[str] = None
    target_email: Optional[str] = Field(default=None, max_length=200)
    # Lookup by public handle (e.g. "@john" or just "john"). Mutually
    # exclusive with target_email / target_user_id; first non-empty wins.
    target_username: Optional[str] = Field(default=None, max_length=64)


class PrivacyBody(BaseModel):
    message_privacy: Optional[Literal["friends_only", "anyone"]] = None
    hidden_from_search: Optional[bool] = None


# ---------------------------------------------------------------------
# GET /api/friends — three lists
# ---------------------------------------------------------------------

@api_router.get("/friends")
async def list_friends(user: User = Depends(get_current_user)):
    rows = await db.friendships.find(
        {"$or": [{"user_a": user.user_id}, {"user_b": user.user_id}]},
        {"_id": 0},
    ).to_list(length=1000)
    other_ids = [
        (r["user_b"] if r["user_a"] == user.user_id else r["user_a"])
        for r in rows
    ]
    by_id = await _hydrate_users(other_ids)

    accepted, pending_in, pending_out, blocked = [], [], [], []
    for r in rows:
        s = _serialize_friendship(r, user.user_id)
        other = by_id.get(s["other_user_id"], {})
        s["email"] = other.get("email", "")
        s["name"] = other.get("name", "")
        s["username"] = other.get("username")
        s["previous_username"] = other.get("previous_username")
        s["picture"] = other.get("picture", "")
        if r["status"] == "accepted":
            accepted.append(s)
        elif r["status"] == "pending":
            (pending_in if r["requested_by"] != user.user_id else pending_out).append(s)
        elif r["status"] == "blocked" and r.get("blocked_by") == user.user_id:
            # Only the blocker sees the block in their list.
            blocked.append(s)
    return {
        "accepted": accepted,
        "pending_in": pending_in,
        "pending_out": pending_out,
        "blocked": blocked,
    }


@api_router.get("/friends/pending-count")
async def pending_count(user: User = Depends(get_current_user)):
    """Just the incoming-pending count for the navbar combined badge."""
    n = await db.friendships.count_documents({
        "status": "pending",
        "requested_by": {"$ne": user.user_id},
        "$or": [{"user_a": user.user_id}, {"user_b": user.user_id}],
    })
    return {"pending_in": n}


# ---------------------------------------------------------------------
# POST /api/friends/request
# ---------------------------------------------------------------------

@api_router.post("/friends/request")
async def send_friend_request(body: FriendRequestBody, user: User = Depends(get_current_user)):
    target = None
    if body.target_user_id:
        target = await db.users.find_one(
            {"user_id": body.target_user_id},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1, "hidden_from_search": 1},
        )
    elif body.target_username:
        handle = (body.target_username or "").strip().lstrip("@")
        if handle:
            # Case-insensitive lookup so "@Brad" finds the user who registered
            # as "@brad" (or vice-versa).  Try the lowercase index first,
            # fall back to a case-insensitive regex for older users without
            # the username_lower field yet.
            target = await db.users.find_one(
                {"username_lower": handle.lower()},
                {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1, "hidden_from_search": 1},
            )
            if not target:
                target = await db.users.find_one(
                    {"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}},
                    {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1, "hidden_from_search": 1},
                )
    elif body.target_email:
        # Case-insensitive lookup — emails may have been stored with
        # original casing (older accounts, test fixtures).
        target = await db.users.find_one(
            {"email": {"$regex": f"^{re.escape(body.target_email.strip())}$", "$options": "i"}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1, "hidden_from_search": 1},
        )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["user_id"] == user.user_id:
        raise HTTPException(status_code=400, detail="You can't send a friend request to yourself")

    a, b = _pair(user.user_id, target["user_id"])
    now = datetime.now(timezone.utc)
    existing = await db.friendships.find_one({"user_a": a, "user_b": b}, {"_id": 0})
    if existing:
        if existing["status"] == "accepted":
            raise HTTPException(status_code=409, detail="You are already friends")
        if existing["status"] == "blocked":
            # Don't leak who blocked whom.
            raise HTTPException(status_code=403, detail="You can't send a request to this user")
        if existing["status"] == "pending":
            if existing["requested_by"] == user.user_id:
                raise HTTPException(status_code=409, detail="Request already pending")
            # The other person already sent one to us — auto-accept.
            await db.friendships.update_one(
                {"user_a": a, "user_b": b},
                {"$set": {"status": "accepted", "updated_at": now}},
            )
            await create_notification(
                target["user_id"], kind="friend_accepted",
                title=f"{user.name or user.email} accepted your friend request",
                body="You can now DM each other and share books.",
                link="/friends",
            )
            return {"status": "accepted", "other_user_id": target["user_id"]}

    fid = f"fr_{uuid.uuid4().hex[:12]}"
    await db.friendships.insert_one({
        "friendship_id": fid,
        "user_a": a,
        "user_b": b,
        "status": "pending",
        "requested_by": user.user_id,
        "blocked_by": None,
        "created_at": now,
        "updated_at": now,
    })
    await create_notification(
        target["user_id"], kind="friend_request",
        title=f"{user.name or user.email} wants to be friends",
        body="Open Friends to accept or decline.",
        link="/friends",
    )
    return {"status": "pending", "other_user_id": target["user_id"], "friendship_id": fid}


async def _find_relation(me: str, other: str) -> Optional[Dict[str, Any]]:
    a, b = _pair(me, other)
    return await db.friendships.find_one({"user_a": a, "user_b": b}, {"_id": 0})


# ---------------------------------------------------------------------
# Accept / decline / cancel / remove
# ---------------------------------------------------------------------

@api_router.post("/friends/{other_user_id}/accept")
async def accept_friend(other_user_id: str, user: User = Depends(get_current_user)):
    rel = await _find_relation(user.user_id, other_user_id)
    if not rel:
        raise HTTPException(status_code=404, detail="No request from this user")
    if rel["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Request is {rel['status']}, not pending")
    if rel["requested_by"] == user.user_id:
        raise HTTPException(status_code=400, detail="You can't accept your own request")
    now = datetime.now(timezone.utc)
    await db.friendships.update_one(
        {"friendship_id": rel["friendship_id"]},
        {"$set": {"status": "accepted", "updated_at": now}},
    )
    # Notify the original requester that their friend request was accepted.
    await create_notification(
        rel["requested_by"], kind="friend_accepted",
        title=f"{user.name or user.email} accepted your friend request",
        body="You can now DM each other and share books.",
        link="/friends",
    )
    return {"status": "accepted"}


@api_router.post("/friends/{other_user_id}/decline")
async def decline_or_cancel(other_user_id: str, user: User = Depends(get_current_user)):
    """Decline an incoming request OR cancel your outgoing one — same call."""
    rel = await _find_relation(user.user_id, other_user_id)
    if not rel or rel["status"] != "pending":
        raise HTTPException(status_code=404, detail="No pending request with this user")
    await db.friendships.delete_one({"friendship_id": rel["friendship_id"]})
    return {"status": "declined"}


@api_router.delete("/friends/{other_user_id}")
async def remove_friend(other_user_id: str, user: User = Depends(get_current_user)):
    """Remove an accepted friendship. Also wipes the DM room between them."""
    rel = await _find_relation(user.user_id, other_user_id)
    if not rel or rel["status"] != "accepted":
        raise HTTPException(status_code=404, detail="You are not friends with this user")
    await db.friendships.delete_one({"friendship_id": rel["friendship_id"]})
    # Best-effort: delete any DM room shared with this user.
    dm = await db.chat_rooms.find_one({
        "room_type": "dm",
        "member_user_ids": {"$all": [user.user_id, other_user_id]},
    }, {"_id": 0, "room_id": 1})
    if dm:
        await db.chat_rooms.delete_one({"room_id": dm["room_id"]})
        await db.chat_messages.delete_many({"room_id": dm["room_id"]})
        await db.chat_reads.delete_many({"room_id": dm["room_id"]})
    return {"status": "removed"}


# ---------------------------------------------------------------------
# Block / unblock
# ---------------------------------------------------------------------

@api_router.post("/friends/{other_user_id}/block")
async def block_user(other_user_id: str, user: User = Depends(get_current_user)):
    if other_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You can't block yourself")
    target = await db.users.find_one({"user_id": other_user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    a, b = _pair(user.user_id, other_user_id)
    now = datetime.now(timezone.utc)
    await db.friendships.update_one(
        {"user_a": a, "user_b": b},
        {
            "$set": {
                "status": "blocked",
                "blocked_by": user.user_id,
                "updated_at": now,
            },
            "$setOnInsert": {
                "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
                "user_a": a,
                "user_b": b,
                "requested_by": user.user_id,
                "created_at": now,
            },
        },
        upsert=True,
    )
    # Also tear down any existing DM with that user.
    dm = await db.chat_rooms.find_one({
        "room_type": "dm",
        "member_user_ids": {"$all": [user.user_id, other_user_id]},
    }, {"_id": 0, "room_id": 1})
    if dm:
        await db.chat_rooms.delete_one({"room_id": dm["room_id"]})
        await db.chat_messages.delete_many({"room_id": dm["room_id"]})
        await db.chat_reads.delete_many({"room_id": dm["room_id"]})
    return {"status": "blocked"}


@api_router.delete("/friends/{other_user_id}/block")
async def unblock_user(other_user_id: str, user: User = Depends(get_current_user)):
    rel = await _find_relation(user.user_id, other_user_id)
    if not rel or rel["status"] != "blocked" or rel.get("blocked_by") != user.user_id:
        raise HTTPException(status_code=404, detail="No active block to remove")
    await db.friendships.delete_one({"friendship_id": rel["friendship_id"]})
    return {"status": "unblocked"}


# ---------------------------------------------------------------------
# User search
# ---------------------------------------------------------------------

@api_router.get("/users/search")
async def search_users(
    q: str = "",
    limit: int = 20,
    user: User = Depends(get_current_user),
):
    """Find users by username (prefix), name, or email substring.

    - A leading `@` is stripped so `@imc` works like `imc`.
    - Username matches are anchored to the prefix (autocomplete-friendly)
      via the lowercase index field.
    - Name and email are case-insensitive substring matches so legacy
      callers (users without a claimed handle) keep working.
    - Excludes self, anyone hidden, and anyone in a blocked relation.
    - Always annotates `relation` so the UI can render the right CTA.
    """
    q = (q or "").strip().lstrip("@")
    if len(q) < 2:
        return {"users": []}
    limit = max(1, min(limit, 20))
    escaped = re.escape(q)
    pattern = re.compile(escaped, re.IGNORECASE)
    # Excluded user_ids: self + everyone in a 'blocked' row touching me.
    blocked_rows = await db.friendships.find(
        {"status": "blocked", "$or": [{"user_a": user.user_id}, {"user_b": user.user_id}]},
        {"_id": 0, "user_a": 1, "user_b": 1},
    ).to_list(length=500)
    excluded = {user.user_id}
    for r in blocked_rows:
        excluded.add(r["user_b"] if r["user_a"] == user.user_id else r["user_a"])

    candidates = await db.users.find(
        {
            "user_id": {"$nin": list(excluded)},
            "hidden_from_search": {"$ne": True},
            "$or": [
                {"username_lower": {"$regex": f"^{escaped.lower()}"}},
                {"email": {"$regex": pattern}},
                {"name": {"$regex": pattern}},
            ],
        },
        {
            "_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1,
            "message_privacy": 1, "username": 1, "previous_username": 1,
        },
    ).limit(limit).to_list(length=limit)

    # Annotate relation status so the UI can show the right CTA.
    pairs = [_pair(user.user_id, c["user_id"]) for c in candidates]
    if pairs:
        rels = await db.friendships.find(
            {"$or": [{"user_a": p[0], "user_b": p[1]} for p in pairs]},
            {"_id": 0},
        ).to_list(length=500)
        rel_by_other: Dict[str, Dict[str, Any]] = {}
        for r in rels:
            other = r["user_b"] if r["user_a"] == user.user_id else r["user_a"]
            rel_by_other[other] = r
    else:
        rel_by_other = {}

    out = []
    for c in candidates:
        rel = rel_by_other.get(c["user_id"])
        relation = "none"
        if rel:
            if rel["status"] == "accepted":
                relation = "friend"
            elif rel["status"] == "pending":
                relation = "pending_out" if rel["requested_by"] == user.user_id else "pending_in"
        out.append({
            "user_id": c["user_id"],
            "email": c.get("email", ""),
            "name": c.get("name", ""),
            "picture": c.get("picture", ""),
            "username": c.get("username"),
            "previous_username": c.get("previous_username"),
            "message_privacy": c.get("message_privacy") or "friends_only",
            "relation": relation,
        })
    return {"users": out}


# ---------------------------------------------------------------------
# Privacy settings
# ---------------------------------------------------------------------

@api_router.get("/account/privacy")
async def get_privacy(user: User = Depends(get_current_user)):
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "message_privacy": 1, "hidden_from_search": 1},
    ) or {}
    return {
        "message_privacy": doc.get("message_privacy") or "friends_only",
        "hidden_from_search": bool(doc.get("hidden_from_search", False)),
    }


@api_router.put("/account/privacy")
async def update_privacy(body: PrivacyBody, user: User = Depends(get_current_user)):
    update: Dict[str, Any] = {}
    if body.message_privacy is not None:
        update["message_privacy"] = body.message_privacy
    if body.hidden_from_search is not None:
        update["hidden_from_search"] = bool(body.hidden_from_search)
    if update:
        await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    return await get_privacy(user)


# ---------------------------------------------------------------------
# Open or create a 1-on-1 DM room
# ---------------------------------------------------------------------

@api_router.post("/chat/dm/{other_user_id}")
async def open_or_create_dm(other_user_id: str, user: User = Depends(get_current_user)):
    if other_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You can't DM yourself")
    other = await db.users.find_one(
        {"user_id": other_user_id},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "message_privacy": 1},
    )
    if not other:
        raise HTTPException(status_code=404, detail="User not found")

    # Block check — neither side may have blocked the other.
    rel = await _find_relation(user.user_id, other_user_id)
    if rel and rel["status"] == "blocked":
        raise HTTPException(status_code=403, detail="Messaging not allowed with this user")

    # Privacy gate — must be friends if the other side is friends_only.
    other_privacy = other.get("message_privacy") or "friends_only"
    is_friend = rel is not None and rel["status"] == "accepted"
    if other_privacy == "friends_only" and not is_friend:
        raise HTTPException(
            status_code=403,
            detail="This user only accepts DMs from friends. Send a friend request first.",
        )

    # Re-use an existing DM if any.
    existing = await db.chat_rooms.find_one(
        {
            "room_type": "dm",
            "member_user_ids": {"$all": [user.user_id, other_user_id], "$size": 2},
        },
        {"_id": 0},
    )
    if existing:
        return {"room_id": existing["room_id"], "created": False}

    now = datetime.now(timezone.utc)
    room_id = f"room_{uuid.uuid4().hex[:12]}"
    name = other.get("name") or other.get("email") or "Direct message"
    await db.chat_rooms.insert_one({
        "room_id": room_id,
        "name": f"DM with {name}",
        "member_user_ids": [user.user_id, other_user_id],
        "room_type": "dm",
        "dm_pair_key": "-".join(_pair(user.user_id, other_user_id)),
        "created_at": now,
        "created_by": user.user_id,
        "last_message_at": None,
    })
    return {"room_id": room_id, "created": True}
