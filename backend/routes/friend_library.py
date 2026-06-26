"""Friend library sharing: mutual-count badge + browse-a-friend's-library
+ "I want this book" wishlist signal that auto-DMs the friend.

Privacy: opt-in. `users.library_visible_to_friends` defaults False; flip
on the Account page. The mutual-count uses cheap normalization (lowercase
title + author) so it works even when only one side has opted in (the
other side's titles aren't exposed in the response).
"""
import re
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, get_current_user_or_none


def _pair(a: str, b: str):
    return (a, b) if a < b else (b, a)


async def _are_friends(me: str, other: str) -> bool:
    a, b = _pair(me, other)
    rel = await db.friendships.find_one({"user_a": a, "user_b": b, "status": "accepted"}, {"_id": 0})
    return rel is not None


def _norm_book_key(b: Dict[str, Any]) -> str:
    """Cheap dedup key for cross-user book matching."""
    t = (b.get("title") or "").strip().lower()
    a = (b.get("author") or "").strip().lower()
    # Strip "the " / "a " / "an " prefixes for fuzzier matching.
    for p in ("the ", "a ", "an "):
        if t.startswith(p):
            t = t[len(p):]
            break
    return f"{t}|{a}"


class BookRequestBody(BaseModel):
    book_id: str = Field(..., min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)


# ---------------------------------------------------------------------
# Mutual count + sample
# ---------------------------------------------------------------------

@api_router.get("/friends/{other_user_id}/mutual")
async def mutual_books(other_user_id: str, user: User = Depends(get_current_user)):
    if not await _are_friends(user.user_id, other_user_id):
        raise HTTPException(status_code=403, detail="Not friends with this user")
    # Pull just title+author for both sides (cheap on indexes).
    my_books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1},
    ).to_list(length=20000)
    their_books = await db.books.find(
        {"user_id": other_user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1},
    ).to_list(length=20000)
    mine_by_key = {_norm_book_key(b): b for b in my_books}
    overlap = []
    for b in their_books:
        k = _norm_book_key(b)
        if k and k in mine_by_key:
            overlap.append({"title": b.get("title", ""), "author": b.get("author", "")})
    return {
        "count": len(overlap),
        "sample": overlap[:5],
        "my_total": len(my_books),
        "their_total": len(their_books),
    }


# ---------------------------------------------------------------------
# Browse a friend's library — opt-in only
# ---------------------------------------------------------------------

@api_router.get("/friends/{other_user_id}/library")
async def friend_library(
    other_user_id: str,
    q: str = "",
    limit: int = 50,
    user: User = Depends(get_current_user),
):
    if not await _are_friends(user.user_id, other_user_id):
        raise HTTPException(status_code=403, detail="Not friends with this user")
    other = await db.users.find_one(
        {"user_id": other_user_id},
        {"_id": 0, "library_visible_to_friends": 1, "name": 1, "email": 1},
    )
    if not other:
        raise HTTPException(status_code=404, detail="User not found")
    if not other.get("library_visible_to_friends"):
        raise HTTPException(
            status_code=403,
            detail=f"{other.get('name') or other.get('email')} hasn't shared their library yet.",
        )
    query: Dict[str, Any] = {"user_id": other_user_id}
    # AV gate (2026-06-25) — never surface infected books to a friend.
    # Even browsing a list with malicious filenames is mildly hazardous
    # (an attacker could use the title field to phish), so we omit the
    # row entirely.  Unscanned + clean books are both visible — friends
    # see the same library state the owner sees in the Polish flow.
    query["av_status"] = {"$ne": "infected"}
    if q and len(q.strip()) >= 2:
        pat = re.compile(re.escape(q.strip()), re.IGNORECASE)
        query["$or"] = [{"title": {"$regex": pat}}, {"author": {"$regex": pat}}]
    limit = max(1, min(int(limit or 50), 200))
    books = await db.books.find(
        query,
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1, "category": 1},
    ).sort("title", 1).limit(limit).to_list(length=limit)

    # Annotate which ones the caller already owns.
    my_books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "title": 1, "author": 1},
    ).to_list(length=20000)
    mine_keys = {_norm_book_key(b) for b in my_books}
    for b in books:
        b["i_have_it"] = _norm_book_key(b) in mine_keys
    return {
        "books": books,
        "total_returned": len(books),
    }


# ---------------------------------------------------------------------
# "I want this book" — DMs the friend a wishlist message
# ---------------------------------------------------------------------

@api_router.post("/friends/{other_user_id}/book-request")
async def request_book(
    other_user_id: str, body: BookRequestBody, user: User = Depends(get_current_user),
):
    if not await _are_friends(user.user_id, other_user_id):
        raise HTTPException(status_code=403, detail="Not friends with this user")
    book = await db.books.find_one(
        {"book_id": body.book_id, "user_id": other_user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "av_status": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="That book isn't in their library")
    # AV gate — refuse to even *signal interest* in a malicious file.
    # Belt-and-braces alongside the list-filter above, since clients
    # might cache a stale book_id from before AV flagged the file.
    if book.get("av_status") == "infected":
        raise HTTPException(
            status_code=409,
            detail="That book has been flagged as unsafe and can't be requested. Ask your friend to remove it from their library.",
        )

    # Open/create a DM room with this friend so the request lands somewhere.
    room = await db.chat_rooms.find_one(
        {"room_type": "dm", "member_user_ids": {"$all": [user.user_id, other_user_id], "$size": 2}},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc)
    if not room:
        room_id = f"room_{uuid.uuid4().hex[:12]}"
        await db.chat_rooms.insert_one({
            "room_id": room_id,
            "name": "Direct message",
            "member_user_ids": [user.user_id, other_user_id],
            "room_type": "dm",
            "dm_pair_key": "-".join(_pair(user.user_id, other_user_id)),
            "created_at": now,
            "created_by": user.user_id,
            "last_message_at": now,
        })
    else:
        room_id = room["room_id"]

    body_text = f"📚 Hey, can I borrow / get a copy of \"{book.get('title','this book')}\"?"
    if body.note:
        body_text += f"\n\n{body.note}"

    msg = {
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "room_id": room_id,
        "sender_user_id": user.user_id,
        "sender_name": user.name or user.email,
        "body": body_text,
        "kind": "book_request",
        "attachment": {
            "book_id": book["book_id"],
            "book_title": book.get("title", ""),
            "book_author": book.get("author", ""),
            "owner_user_id": other_user_id,
        },
        "created_at": now,
    }
    await db.chat_messages.insert_one(msg)
    await db.chat_rooms.update_one({"room_id": room_id}, {"$set": {"last_message_at": now}})
    return {"room_id": room_id, "message_id": msg["message_id"]}


# ---------------------------------------------------------------------
# Privacy toggle for library visibility (separate from message_privacy)
# ---------------------------------------------------------------------

class LibraryVisibilityBody(BaseModel):
    library_visible_to_friends: bool


@api_router.get("/account/library-visibility")
async def get_library_visibility(user: User = Depends(get_current_user)):
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "library_visible_to_friends": 1},
    ) or {}
    return {"library_visible_to_friends": bool(doc.get("library_visible_to_friends", False))}


@api_router.put("/account/library-visibility")
async def set_library_visibility(body: LibraryVisibilityBody, user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"library_visible_to_friends": bool(body.library_visible_to_friends)}},
    )
    return {"library_visible_to_friends": bool(body.library_visible_to_friends)}


# ---------------------------------------------------------------------
# PUBLIC library browsing — opt-in, no auth required to read.
# Mirrors the friend-only flow above but gated on
# ``library_visible_to_public`` (separate flag from the friends one so
# users can share with friends but stay off the public web, or vice
# versa).  Surfaces at /u/{username}/library on the frontend.
# ---------------------------------------------------------------------

class PublicLibraryVisibilityBody(BaseModel):
    library_visible_to_public: bool


@api_router.get("/account/public-library-visibility")
async def get_public_library_visibility(user: User = Depends(get_current_user)):
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "library_visible_to_public": 1},
    ) or {}
    return {"library_visible_to_public": bool(doc.get("library_visible_to_public", False))}


@api_router.put("/account/public-library-visibility")
async def set_public_library_visibility(
    body: PublicLibraryVisibilityBody, user: User = Depends(get_current_user),
):
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"library_visible_to_public": bool(body.library_visible_to_public)}},
    )
    return {"library_visible_to_public": bool(body.library_visible_to_public)}


@api_router.get("/users/{username}/public-library")
async def public_library(
    username: str,
    q: str = "",
    limit: int = 200,
    viewer: Optional[User] = Depends(get_current_user_or_none),
):
    """Read-only browse of a user's library, no auth required.

    When the caller IS signed in (``viewer`` is not None and isn't the
    owner), we additionally compute shelf-overlap: each returned book
    gets a ``you_also_have`` boolean, and the response carries an
    ``overlap_count`` aggregate.  Lets the visitor instantly see how
    many books they have in common.  Match key is the same one used
    by the friend-library mutual-count: ``lower(title)|lower(author)``.

    Returns 404 (not 403) when the target user either doesn't exist or
    hasn't opted in, to avoid revealing handle existence to scrapers.
    The endpoint deliberately omits sensitive fields (file size, AV
    status detail, raw filename) — only title/author/fandom/category
    + per-fandom aggregate counts make it out.
    """
    uname = (username or "").strip().lstrip("@").lower()
    if not uname or len(uname) > 64:
        raise HTTPException(status_code=404, detail="Library not found")
    owner = await db.users.find_one(
        {"username": uname},
        {"_id": 0, "user_id": 1, "username": 1, "name": 1,
         "library_visible_to_public": 1, "hidden_from_search": 1, "approval_status": 1,
         "created_at": 1, "picture": 1},
    )
    # Treat "not opted in" and "doesn't exist" identically to keep the
    # endpoint from doubling as a handle-enumeration oracle.
    if (not owner
            or not owner.get("library_visible_to_public")
            or owner.get("approval_status") not in (None, "approved")):
        raise HTTPException(status_code=404, detail="Library not found")

    query: Dict[str, Any] = {
        "user_id": owner["user_id"],
        "av_status": {"$ne": "infected"},
    }
    if q and len(q.strip()) >= 2:
        pat = re.compile(re.escape(q.strip()), re.IGNORECASE)
        query["$or"] = [{"title": {"$regex": pat}}, {"author": {"$regex": pat}}]

    limit = max(1, min(int(limit or 200), 500))
    books = await db.books.find(
        query,
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1, "category": 1},
    ).sort("title", 1).limit(limit).to_list(length=limit)

    # Shelf-overlap when caller is signed in (and isn't the owner).
    # We build a Set of normalized "title|author" keys from the
    # visitor's own books, then mark each returned book with
    # ``you_also_have`` if its key is in the set.  Cheap O(N+M)
    # in-memory join, no extra round-trip.
    overlap_count = 0
    if viewer is not None and viewer.user_id != owner["user_id"]:
        my_books = await db.books.find(
            {"user_id": viewer.user_id, "av_status": {"$ne": "infected"}},
            {"_id": 0, "title": 1, "author": 1},
        ).to_list(length=10000)
        my_keys = {
            f"{(b.get('title') or '').strip().lower()}|"
            f"{(b.get('author') or '').strip().lower()}"
            for b in my_books
            if (b.get("title") or "").strip()
        }
        for b in books:
            key = (
                f"{(b.get('title') or '').strip().lower()}|"
                f"{(b.get('author') or '').strip().lower()}"
            )
            if key and key in my_keys:
                b["you_also_have"] = True
                overlap_count += 1
            else:
                b["you_also_have"] = False

    # Cheap aggregate stats — fandom histogram + category breakdown
    # for the header.  Computed in-process to avoid a second round-trip.
    fandom_counts: Dict[str, int] = {}
    category_counts: Dict[str, int] = {}
    for b in books:
        f = (b.get("fandom") or "").strip()
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
        c = (b.get("category") or "").strip() or "Uncategorized"
        category_counts[c] = category_counts.get(c, 0) + 1
    top_fandoms = sorted(
        fandom_counts.items(), key=lambda kv: (-kv[1], kv[0]),
    )[:8]

    return {
        "owner": {
            "username": owner.get("username", ""),
            "display_name": owner.get("name") or owner.get("username") or "",
            "joined_at": owner.get("created_at"),
            "picture": owner.get("picture") or "",
        },
        "books": books,
        "total_returned": len(books),
        "top_fandoms": [{"fandom": f, "count": n} for f, n in top_fandoms],
        "category_counts": category_counts,
        # Always present so the frontend can branch deterministically;
        # 0 when caller is anonymous OR is the owner.
        "overlap_count": overlap_count,
        "viewer_is_signed_in": viewer is not None and viewer.user_id != owner["user_id"],
    }
