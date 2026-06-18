"""User-submitted suggestions / feature requests / bug reports.

Anyone signed in can:
  - submit a suggestion (title + body + category)
  - browse all suggestions
  - upvote (toggle)
  - see their own submissions filtered

Admins can:
  - change status (open / under_review / planned / done / declined)
  - add an admin_note (e.g. "shipped in 1.4")
  - delete spam

Categories: bug, improvement, feature.
"""
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional, Literal, Dict, Any, List

import resend
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from deps import db, api_router, logger, RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL
from models import User
from auth_dep import get_current_user, require_admin
from utils.email_log import log_email_send
from utils.admin_audit import record_admin_action
from routes.notifications import create_notification


CATEGORIES = ("bug", "improvement", "feature")
STATUSES = ("open", "under_review", "planned", "done", "declined")


class SuggestionCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    body: str = Field(default="", max_length=4000)
    category: Literal["bug", "improvement", "feature"] = "feature"


class SuggestionUpdate(BaseModel):
    status: Optional[Literal["open", "under_review", "planned", "done", "declined"]] = None
    admin_note: Optional[str] = Field(default=None, max_length=1000)


def _serialize(doc: Dict[str, Any], me: Optional[str] = None) -> Dict[str, Any]:
    return {
        "suggestion_id": doc["suggestion_id"],
        "title": doc["title"],
        "body": doc.get("body", ""),
        "category": doc["category"],
        "status": doc["status"],
        "admin_note": doc.get("admin_note"),
        "submitter_user_id": doc["submitter_user_id"],
        "submitter_name": doc.get("submitter_name", ""),
        "submitter_email": doc.get("submitter_email", ""),
        "votes_count": len(doc.get("voters", [])),
        "i_voted": (me in (doc.get("voters") or [])) if me else False,
        "is_mine": (doc["submitter_user_id"] == me) if me else False,
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": doc["updated_at"].isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


# ---------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------

@api_router.get("/suggestions")
async def list_suggestions(
    status: Optional[str] = None,
    category: Optional[str] = None,
    mine_only: bool = False,
    user: User = Depends(get_current_user),
):
    # The ``suggestions`` collection is shared with the newer
    # Help-page feedback writer (which stores ``{text, page,
    # photo_b64}`` and has no ``suggestion_id``).  Scope this product
    # board to its own shape so the legacy serializer doesn't crash
    # on KeyError: 'suggestion_id' when the two streams co-exist.
    query: Dict[str, Any] = {"suggestion_id": {"$exists": True}}
    if status and status in STATUSES:
        query["status"] = status
    if category and category in CATEGORIES:
        query["category"] = category
    if mine_only:
        query["submitter_user_id"] = user.user_id
    docs = await db.suggestions.find(query, {"_id": 0}).to_list(length=500)
    # Sort: open ones first, then by votes desc, then by recency.
    status_rank = {"open": 0, "under_review": 1, "planned": 2, "done": 3, "declined": 4}
    docs.sort(
        key=lambda d: (
            status_rank.get(d.get("status", "open"), 5),
            -len(d.get("voters") or []),
            -(d.get("created_at").timestamp() if isinstance(d.get("created_at"), datetime) else 0),
        )
    )
    return {"suggestions": [_serialize(d, user.user_id) for d in docs]}


@api_router.post("/suggestions")
async def submit_suggestion(body: SuggestionCreate, user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    doc = {
        "suggestion_id": f"sug_{uuid.uuid4().hex[:12]}",
        "title": body.title.strip(),
        "body": body.body.strip(),
        "category": body.category,
        "status": "open",
        "submitter_user_id": user.user_id,
        "submitter_name": user.name or (user.email or "").split("@")[0],
        "submitter_email": user.email or "",
        "voters": [user.user_id],  # submitter auto-votes for their own
        "admin_note": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.suggestions.insert_one(doc)
    return _serialize(doc, user.user_id)


@api_router.post("/suggestions/{sid}/vote")
async def vote_toggle(sid: str, user: User = Depends(get_current_user)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    voters = doc.get("voters") or []
    if user.user_id in voters:
        voters.remove(user.user_id)
        action = "unvoted"
    else:
        voters.append(user.user_id)
        action = "voted"
    await db.suggestions.update_one(
        {"suggestion_id": sid},
        {"$set": {"voters": voters, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"action": action, "votes_count": len(voters)}


@api_router.delete("/suggestions/{sid}")
async def delete_own_suggestion(sid: str, user: User = Depends(get_current_user)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if doc["submitter_user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Only the submitter can delete their own suggestion")
    await db.suggestions.delete_one({"suggestion_id": sid})
    return {"deleted": sid}


# ---------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------

@api_router.put("/admin/suggestions/{sid}")
async def admin_update(sid: str, body: SuggestionUpdate, user: User = Depends(require_admin)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    update: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if body.status is not None:
        update["status"] = body.status
    if body.admin_note is not None:
        update["admin_note"] = body.admin_note.strip() or None
    if not update:
        return _serialize(doc, user.user_id)
    await db.suggestions.update_one({"suggestion_id": sid}, {"$set": update})
    await record_admin_action(
        user, "suggestion.update", target=sid,
        metadata={"changed": [k for k in update.keys() if k != "updated_at"]},
    )

    # Notify the submitter if the status (or admin_note) actually changed.
    status_changed = body.status is not None and body.status != doc.get("status")
    note_changed = body.admin_note is not None and (body.admin_note.strip() or None) != doc.get("admin_note")
    if (status_changed or note_changed) and doc["submitter_user_id"] != user.user_id:
        new_status_label = {
            "open": "Open",
            "under_review": "Under review",
            "planned": "Planned",
            "done": "Done",
            "declined": "Declined",
        }.get(body.status or doc.get("status", "open"), "Updated")
        link = "/suggestions"
        notif_title = f"Suggestion update: {new_status_label}"
        notif_body = f'Your suggestion "{doc["title"]}" is now {new_status_label}.'
        if body.admin_note:
            notif_body += f' Admin note: "{body.admin_note.strip()}"'
        # In-app notification
        await create_notification(
            doc["submitter_user_id"], kind="suggestion_status",
            title=notif_title, body=notif_body, link=link,
        )
        # Email — best-effort
        submitter_email = doc.get("submitter_email", "")
        if RESEND_API_KEY and submitter_email:
            try:
                resend.api_key = RESEND_API_KEY
                params = {
                    "from": SENDER_EMAIL,
                    "to": [submitter_email],
                    "subject": f"Shelfsort: your suggestion is {new_status_label.lower()}",
                    "html": f"""
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FBF7EE; border-radius: 12px;">
                      <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:#EDE7FB;border:1px solid rgba(58,90,64,0.3);border-radius:999px;margin-bottom:16px;font-size:12px;font-weight:600;color:#6B46C1;letter-spacing:0.5px;">💡 SUGGESTION UPDATE</div>
                      <h1 style="color:#2C2C2C;margin:0 0 12px;font-size:20px;font-family:Georgia,serif;">Your suggestion is now {new_status_label}</h1>
                      <p style="color:#4A4A4A;line-height:1.6;font-size:15px;margin:0 0 12px;">
                        <strong>"{doc['title']}"</strong>
                      </p>
                      {('<p style="margin:16px 0;padding:12px 16px;background:#EDE7FB;border-left:3px solid #6B46C1;border-radius:6px;font-size:14px;color:#4A4A4A;"><strong>Admin note:</strong> ' + body.admin_note.strip() + '</p>') if body.admin_note else ''}
                      <p style="margin:24px 0;text-align:center;">
                        <a href="{FRONTEND_URL.rstrip('/')}/suggestions" style="display:inline-block;padding:10px 20px;background:#6B46C1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">View on Shelfsort →</a>
                      </p>
                      <p style="color:#6B705C;font-size:11px;margin:0;">Thanks for helping make Shelfsort better.</p>
                    </div>
                    """,
                    "text": f"Your suggestion '{doc['title']}' is now {new_status_label}.\n\n"
                            + (f"Admin note: {body.admin_note.strip()}\n\n" if body.admin_note else "")
                            + f"View at: {FRONTEND_URL.rstrip('/')}/suggestions",
                }
                result = await asyncio.to_thread(resend.Emails.send, params)
                await log_email_send("suggestion_status", submitter_email, "ok", resend_id=(result or {}).get("id"))
            except Exception as e:  # noqa: BLE001
                logger.error("Suggestion status email failed: %s", e)
                await log_email_send("suggestion_status", submitter_email, "error", error=str(e))

    refreshed = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    return _serialize(refreshed, user.user_id)


@api_router.delete("/admin/suggestions/{sid}")
async def admin_delete(sid: str, user: User = Depends(require_admin)):
    doc = await db.suggestions.find_one({"suggestion_id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    await db.suggestions.delete_one({"suggestion_id": sid})
    await record_admin_action(
        user, "suggestion.delete", target=sid,
        metadata={"title": doc.get("title", "")[:80]},
    )
    return {"deleted": sid}


@api_router.get("/admin/suggestions/open-count")
async def admin_open_count(user: User = Depends(require_admin)):
    """Quick count for the Admin Console badge."""
    n = await db.suggestions.count_documents({"status": "open"})
    return {"open": n}
