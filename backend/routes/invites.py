"""Invite-by-email flow.

Closes the network-effect gap: when someone wants to add a friend who
isn't on Shelfsort yet, they enter the email. Two paths:

  1. Email already belongs to a Shelfsort user → fall through to a
     normal friend request (no email sent, no token created).
  2. Email is unknown → store an invite token, Resend an invite email
     with a one-click /invite/<token> link. When the recipient lands on
     that page (either before or after registering), they get a
     "Accept friendship with <inviter>" button that creates an accepted
     friendship and marks the invite as used.

Tokens last 30 days. Each inviter is capped at 10 pending invites at
once (cheap anti-spam).
"""
import re
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import resend
from fastapi import Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from deps import db, api_router, logger, RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL
from models import User
from auth_dep import get_current_user
from utils.email_log import log_email_send


INVITE_TTL_DAYS = 30
MAX_PENDING_INVITES_PER_USER = 10


def _pair(a: str, b: str):
    return (a, b) if a < b else (b, a)


class InviteBody(BaseModel):
    email: EmailStr
    note: Optional[str] = Field(default=None, max_length=200)


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "invite_id": doc["invite_id"],
        "target_email": doc["target_email"],
        "status": doc["status"],
        "inviter_user_id": doc["inviter_user_id"],
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "expires_at": doc["expires_at"].isoformat() if isinstance(doc.get("expires_at"), datetime) else doc.get("expires_at"),
        "note": doc.get("note"),
    }


# ---------------------------------------------------------------------
# POST /api/friends/invite — entry point
# ---------------------------------------------------------------------

@api_router.post("/friends/invite")
async def invite_by_email(body: InviteBody, user: User = Depends(get_current_user)):
    target_email = body.email.strip().lower()
    if target_email == (user.email or "").strip().lower():
        raise HTTPException(status_code=400, detail="You can't invite yourself")

    # Case 1: email already belongs to a user — bypass the email send,
    # create a friend request directly.
    existing_user = await db.users.find_one(
        {"email": {"$regex": f"^{re.escape(target_email)}$", "$options": "i"}},
        {"_id": 0, "user_id": 1},
    )
    if existing_user:
        # Reuse the same logic as POST /api/friends/request (pair + status).
        a, b = _pair(user.user_id, existing_user["user_id"])
        now = datetime.now(timezone.utc)
        existing = await db.friendships.find_one({"user_a": a, "user_b": b}, {"_id": 0})
        if existing:
            if existing["status"] == "accepted":
                return {"path": "already_friends", "other_user_id": existing_user["user_id"]}
            if existing["status"] == "blocked":
                raise HTTPException(status_code=403, detail="Messaging not allowed with this user")
            if existing["status"] == "pending":
                if existing["requested_by"] == user.user_id:
                    return {"path": "request_already_pending", "other_user_id": existing_user["user_id"]}
                await db.friendships.update_one(
                    {"user_a": a, "user_b": b},
                    {"$set": {"status": "accepted", "updated_at": now}},
                )
                return {"path": "auto_accepted", "other_user_id": existing_user["user_id"]}
        await db.friendships.insert_one({
            "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
            "user_a": a, "user_b": b,
            "status": "pending",
            "requested_by": user.user_id,
            "blocked_by": None,
            "created_at": now, "updated_at": now,
        })
        return {"path": "friend_request_sent", "other_user_id": existing_user["user_id"]}

    # Case 2: brand-new email — create an invite token + email it.
    # Anti-spam: cap pending invites per user.
    open_count = await db.invites.count_documents({
        "inviter_user_id": user.user_id,
        "status": "pending",
    })
    if open_count >= MAX_PENDING_INVITES_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"You have {open_count} pending invites already. Wait for some to accept or expire.",
        )

    # If an unused invite for the same email already exists, return it
    # instead of stacking duplicates.
    existing_invite = await db.invites.find_one(
        {"inviter_user_id": user.user_id, "target_email": target_email, "status": "pending"},
        {"_id": 0},
    )
    if existing_invite:
        return {"path": "invite_already_pending", **_serialize(existing_invite)}

    now = datetime.now(timezone.utc)
    token = uuid.uuid4().hex + uuid.uuid4().hex[:8]  # 40-char opaque
    invite = {
        "invite_id": f"inv_{uuid.uuid4().hex[:12]}",
        "token": token,
        "inviter_user_id": user.user_id,
        "target_email": target_email,
        "status": "pending",
        "note": (body.note or "").strip() or None,
        "created_at": now,
        "expires_at": now + timedelta(days=INVITE_TTL_DAYS),
    }
    await db.invites.insert_one(invite)

    # Email the recipient. Silently skip if RESEND isn't configured.
    invite_url = f"{FRONTEND_URL.rstrip('/')}/invite/{token}"
    inviter_name = user.name or user.email
    note_html = ""
    if invite["note"]:
        safe = invite["note"].replace("<", "&lt;").replace(">", "&gt;")
        note_html = (
            '<p style="margin:16px 0 0;padding:12px 16px;background:#FDF3E1;'
            'border-left:3px solid #B87A00;border-radius:6px;font-size:14px;color:#4A4A4A;">'
            f'<strong>Note from {inviter_name}:</strong> {safe}</p>'
        )
    if RESEND_API_KEY:
        try:
            resend.api_key = RESEND_API_KEY
            params = {
                "from": SENDER_EMAIL,
                "to": [target_email],
                "subject": f"{inviter_name} invited you to Shelfsort",
                "html": f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FBF7EE; border-radius: 12px;">
                  <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:#FDF3E1;border:1px solid rgba(184,122,0,0.3);border-radius:999px;margin-bottom:16px;font-size:12px;font-weight:600;color:#B87A00;letter-spacing:0.5px;">📚 SHELFSORT INVITE</div>
                  <h1 style="color:#2C2C2C;margin:0 0 12px;font-size:22px;font-family:Georgia,serif;">{inviter_name} thinks you'd like Shelfsort.</h1>
                  <p style="color:#4A4A4A;line-height:1.6;font-size:15px;margin:0 0 16px;">
                    Shelfsort is a personal library tool that auto-sorts your EPUB collection by fandom, author, tag and more.
                    {inviter_name} sent you an invite so the two of you can swap book recommendations, palettes, and chat directly.
                  </p>
                  {note_html}
                  <p style="margin:24px 0;text-align:center;">
                    <a href="{invite_url}" style="display:inline-block;padding:12px 24px;background:#6B46C1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Accept your invite →</a>
                  </p>
                  <p style="color:#6B705C;font-size:12px;margin:0;">
                    Or copy this link: <code style="font-size:11px;">{invite_url}</code><br/>
                    The invite expires in {INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore it — no account was created.
                  </p>
                </div>
                """,
                "text": (
                    f"{inviter_name} invited you to Shelfsort.\n\n"
                    + (f"Note: {invite['note']}\n\n" if invite["note"] else "")
                    + f"Accept at: {invite_url}\n\n(The link expires in {INVITE_TTL_DAYS} days.)"
                ),
            }
            result = await asyncio.to_thread(resend.Emails.send, params)
            await log_email_send("invite", target_email, "ok", resend_id=(result or {}).get("id"))
        except Exception as e:  # noqa: BLE001
            logger.error("Invite Resend send failed for %s: %s", target_email, e)
            await log_email_send("invite", target_email, "error", error=str(e))
            # Don't raise — the invite is still valid via direct URL.
            return {"path": "invite_created_email_failed", **_serialize(invite), "url": invite_url}

    return {"path": "invite_sent", **_serialize(invite), "url": invite_url}


# ---------------------------------------------------------------------
# GET /api/invites/{token} — public preview (no auth required)
# ---------------------------------------------------------------------

@api_router.get("/invites/{token}")
async def preview_invite(token: str):
    doc = await db.invites.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invite not found")
    expires_at = doc.get("expires_at")
    expired = False
    if isinstance(expires_at, datetime):
        # Mongo strips tzinfo on read; treat naive as UTC.
        ea = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        if ea < datetime.now(timezone.utc):
            expired = True
    status = "expired" if expired else doc.get("status", "pending")
    inviter = await db.users.find_one(
        {"user_id": doc["inviter_user_id"]},
        {"_id": 0, "name": 1, "email": 1, "picture": 1},
    ) or {}
    return {
        "token": token,
        "status": status,
        "inviter_name": inviter.get("name") or inviter.get("email", "Someone"),
        "target_email": doc.get("target_email"),
        "note": doc.get("note"),
    }


# ---------------------------------------------------------------------
# POST /api/invites/{token}/accept — auth required
# ---------------------------------------------------------------------

@api_router.post("/invites/{token}/accept")
async def accept_invite(token: str, user: User = Depends(get_current_user)):
    doc = await db.invites.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invite not found")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Invite is {doc['status']}")
    expires_at = doc.get("expires_at")
    if isinstance(expires_at, datetime):
        ea = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        if ea < datetime.now(timezone.utc):
            await db.invites.update_one({"token": token}, {"$set": {"status": "expired"}})
            raise HTTPException(status_code=410, detail="Invite has expired")
    if doc["inviter_user_id"] == user.user_id:
        raise HTTPException(status_code=400, detail="You can't accept your own invite")

    # Create the friendship as accepted right away.
    a, b = _pair(user.user_id, doc["inviter_user_id"])
    now = datetime.now(timezone.utc)
    existing = await db.friendships.find_one({"user_a": a, "user_b": b}, {"_id": 0})
    if existing:
        if existing["status"] == "blocked":
            raise HTTPException(status_code=403, detail="Messaging not allowed with this user")
        if existing["status"] != "accepted":
            await db.friendships.update_one(
                {"user_a": a, "user_b": b},
                {"$set": {"status": "accepted", "updated_at": now}},
            )
    else:
        await db.friendships.insert_one({
            "friendship_id": f"fr_{uuid.uuid4().hex[:12]}",
            "user_a": a, "user_b": b,
            "status": "accepted",
            "requested_by": doc["inviter_user_id"],
            "blocked_by": None,
            "created_at": now, "updated_at": now,
        })
    await db.invites.update_one(
        {"token": token},
        {"$set": {"status": "accepted", "accepted_at": now, "accepted_by": user.user_id}},
    )
    return {"status": "accepted", "inviter_user_id": doc["inviter_user_id"]}


# ---------------------------------------------------------------------
# GET /api/friends/invites — list mine
# ---------------------------------------------------------------------

@api_router.get("/friends/invites")
async def list_my_invites(user: User = Depends(get_current_user)):
    docs = await db.invites.find(
        {"inviter_user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(length=100)
    return {"invites": [_serialize(d) for d in docs]}


@api_router.delete("/friends/invites/{invite_id}")
async def cancel_invite(invite_id: str, user: User = Depends(get_current_user)):
    doc = await db.invites.find_one({"invite_id": invite_id, "inviter_user_id": user.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invite not found")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Invite is {doc['status']}")
    await db.invites.delete_one({"invite_id": invite_id})
    return {"cancelled": invite_id}
