"""Friend library sharing: mutual-count badge + browse-a-friend's-library
+ "I want this book" wishlist signal that auto-DMs the friend.

Privacy: opt-in. `users.library_visible_to_friends` defaults False; flip
on the Account page. The mutual-count uses cheap normalization (lowercase
title + author) so it works even when only one side has opted in (the
other side's titles aren't exposed in the response).
"""
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from fastapi import Depends, HTTPException
from fastapi.responses import Response as FastResponse
from pydantic import BaseModel, Field

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


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
    # Detect "first time turning ON" so the frontend can surface the
    # one-time "Your library is public — share it!" modal.  We use a
    # timestamp field on the user doc (not localStorage) so the modal
    # also shows up on a second device after the first opt-in.
    new_val = bool(body.library_visible_to_public)
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "library_visible_to_public": 1, "first_public_share_shown_at": 1},
    ) or {}
    was_already_on = bool(doc.get("library_visible_to_public", False))
    first_time = (
        new_val
        and not was_already_on
        and not doc.get("first_public_share_shown_at")
    )
    update: Dict[str, Any] = {"library_visible_to_public": new_val}
    if first_time:
        update["first_public_share_shown_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    return {
        "library_visible_to_public": new_val,
        # Frontend uses this flag to open the share modal exactly once.
        "show_first_share_modal": first_time,
    }


# -----------------------------------------------------------------------
# Anonymous "library preview" used by the sign-in gate (Task 10 follow-up
# to the 2026-06-26 auth-required policy).  Deliberately leaks the same
# minimal data the OG share endpoint leaks (count + top fandom) so the
# 401 gate can render "@alice has 247 books — sign in to see what they're
# reading" and convert curious anon visitors.  404 invariants preserved.
# -----------------------------------------------------------------------
@api_router.get("/users/{username}/library-preview")
async def library_preview(username: str):
    uname = (username or "").strip().lstrip("@").lower()
    if not uname or len(uname) > 64:
        raise HTTPException(status_code=404, detail="Not found")
    owner = await db.users.find_one(
        {"username": uname},
        {"_id": 0, "user_id": 1, "username": 1, "name": 1, "picture": 1,
         "bio": 1, "library_visible_to_public": 1, "approval_status": 1},
    )
    if (not owner
            or not owner.get("library_visible_to_public")
            or owner.get("approval_status") not in (None, "approved")):
        raise HTTPException(status_code=404, detail="Not found")
    books = await db.books.find(
        {"user_id": owner["user_id"], "av_status": {"$ne": "infected"}},
        {"_id": 0, "fandom": 1},
    ).limit(500).to_list(length=500)
    total = len(books)
    fandom_counts: Dict[str, int] = {}
    for b in books:
        f = (b.get("fandom") or "").strip()
        if f:
            fandom_counts[f] = fandom_counts.get(f, 0) + 1
    top_fandom = (
        max(fandom_counts.items(), key=lambda kv: kv[1])[0]
        if fandom_counts else ""
    )
    return {
        "username": owner.get("username") or "",
        "display_name": owner.get("name") or owner.get("username") or "",
        "picture": owner.get("picture") or "",
        "bio": (owner.get("bio") or "").strip(),
        "total_books": total,
        "top_fandom": top_fandom,
        "fandom_count": len(fandom_counts),
    }


# -----------------------------------------------------------------------
# Bio field — short "about" line on the user profile.  Surfaces on
# /u/<handle>, /u/<handle>/library, and the library-preview endpoint.
# 280-char cap mirrors a tweet; never required.
# -----------------------------------------------------------------------
class BioBody(BaseModel):
    bio: str = Field(default="", max_length=280)


@api_router.put("/account/bio")
async def set_bio(body: BioBody, user: User = Depends(get_current_user)):
    val = (body.bio or "").strip()
    await db.users.update_one(
        {"user_id": user.user_id}, {"$set": {"bio": val}},
    )
    return {"bio": val}


# -----------------------------------------------------------------------
# RSS feed for an opted-in user's library.  Token-gated so RSS readers
# can subscribe (they can't carry session cookies) without breaking the
# 2026-06-26 auth-required policy for browser visitors.
# -----------------------------------------------------------------------
def _xml_escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


@api_router.get("/account/library-rss-token")
async def get_library_rss_token(user: User = Depends(get_current_user)):
    """Return (and lazy-create) the user's library RSS token.  The
    frontend uses this to render the copyable URL on Account → Privacy.
    """
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "rss_token": 1},
    ) or {}
    token = doc.get("rss_token") or ""
    if not token:
        token = secrets.token_urlsafe(24)
        await db.users.update_one(
            {"user_id": user.user_id}, {"$set": {"rss_token": token}},
        )
    return {"rss_token": token}


@api_router.post("/account/library-rss-token/regenerate")
async def regenerate_library_rss_token(user: User = Depends(get_current_user)):
    """Invalidate the existing RSS URL and issue a new token."""
    token = secrets.token_urlsafe(24)
    await db.users.update_one(
        {"user_id": user.user_id}, {"$set": {"rss_token": token}},
    )
    return {"rss_token": token}


@api_router.get("/feeds/library/{username}.rss")
async def library_rss_feed(username: str, token: str = ""):
    """RSS feed of an opted-in user's library.  Token query param must
    match the user's ``rss_token``; otherwise 404 (same code as
    not-opted-in / nonexistent to keep handle-enumeration impossible).
    """
    uname = (username or "").strip().lstrip("@").lower()
    if not uname or not token:
        raise HTTPException(status_code=404, detail="Not found")
    owner = await db.users.find_one(
        {"username": uname},
        {"_id": 0, "user_id": 1, "username": 1, "name": 1,
         "library_visible_to_public": 1, "rss_token": 1, "approval_status": 1},
    )
    if (not owner
            or not owner.get("library_visible_to_public")
            or owner.get("approval_status") not in (None, "approved")
            or not owner.get("rss_token")
            or not secrets.compare_digest(token, owner["rss_token"])):
        raise HTTPException(status_code=404, detail="Not found")

    base = "https://shelfsort.com"
    handle = owner.get("username") or uname
    display = owner.get("name") or handle
    cursor = (
        db.books.find(
            {"user_id": owner["user_id"], "av_status": {"$ne": "infected"}},
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
             "category": 1, "created_at": 1},
        ).sort("created_at", -1).limit(50)
    )
    items_xml = []
    async for b in cursor:
        title = b.get("title") or "Untitled"
        author = b.get("author") or ""
        fandom = b.get("fandom") or ""
        created = b.get("created_at")
        if isinstance(created, datetime):
            pub_date = created.replace(tzinfo=timezone.utc).isoformat()
        else:
            pub_date = str(created or "")
        item_title = f"{title}" + (f" — {author}" if author else "")
        item_desc = (
            f"{author or 'Unknown author'}"
            + (f" · {fandom}" if fandom else "")
            + (f" · {b.get('category')}" if b.get("category") else "")
        )
        items_xml.append(
            "  <item>\n"
            f"    <title>{_xml_escape(item_title)}</title>\n"
            f"    <link>{_xml_escape(f'{base}/u/{handle}/library')}</link>\n"
            f"    <guid isPermaLink=\"false\">{_xml_escape(b.get('book_id') or '')}</guid>\n"
            f"    <description>{_xml_escape(item_desc)}</description>\n"
            f"    <pubDate>{_xml_escape(pub_date)}</pubDate>\n"
            "  </item>\n"
        )
    rss = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        '<channel>\n'
        f"  <title>{_xml_escape(f'{display} on Shelfsort')}</title>\n"
        f"  <link>{_xml_escape(f'{base}/u/{handle}/library')}</link>\n"
        f"  <description>{_xml_escape(f'Latest additions to @{handle} library on Shelfsort.')}</description>\n"
        f"{''.join(items_xml)}"
        "</channel>\n</rss>\n"
    )
    return FastResponse(content=rss, media_type="application/rss+xml")


@api_router.get("/users/{username}/public-library")
async def public_library(
    username: str,
    q: str = "",
    limit: int = 200,
    viewer: User = Depends(get_current_user),
):
    """Read-only browse of a user's library — **requires sign-in**.

    Policy as of 2026-06-26: nobody can read another user's library
    without first authenticating, even when the owner has opted into
    the "public library" mode.  This raises the bar against scraping
    and converts curious visitors into accounts.  Link previews on
    Facebook / Twitter still work because the OG share endpoint
    ``/api/share/u/{username}/library`` stays anonymous (crawlers
    can't sign in).

    Returns 401 when the caller is anonymous.  Returns 404 when the
    target user either doesn't exist or hasn't opted in (single
    response code prevents handle enumeration via 401 vs 404).

    When the caller is a different signed-in user, we additionally
    compute shelf-overlap: each returned book gets a ``you_also_have``
    boolean, and the response carries an ``overlap_count`` aggregate.
    """
    uname = (username or "").strip().lstrip("@").lower()
    if not uname or len(uname) > 64:
        raise HTTPException(status_code=404, detail="Library not found")
    owner = await db.users.find_one(
        {"username": uname},
        {"_id": 0, "user_id": 1, "username": 1, "name": 1, "bio": 1,
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

    # Shelf-overlap when caller isn't the owner.  Owner viewing their
    # own library skips the compute (no useful "you have this" badge
    # on a book you uploaded).
    overlap_count = 0
    if viewer.user_id != owner["user_id"]:
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
            "bio": (owner.get("bio") or "").strip(),
        },
        "books": books,
        "total_returned": len(books),
        "top_fandoms": [{"fandom": f, "count": n} for f, n in top_fandoms],
        "category_counts": category_counts,
        # Always present so the frontend can branch deterministically;
        # 0 when caller is anonymous OR is the owner.
        "overlap_count": overlap_count,
        # True iff a non-owner signed-in caller is reading. Per the
        # 2026-06-26 auth-required policy, anon callers are 401 before
        # they reach this line, so this is purely "is the viewer a
        # different signed-in user from the owner".
        "viewer_is_signed_in": viewer.user_id != owner["user_id"],
    }
