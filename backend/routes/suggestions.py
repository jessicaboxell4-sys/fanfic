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
import base64
import asyncio
from datetime import datetime, timezone
from typing import Optional, Literal, Dict, Any, List

import resend
from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from deps import db, api_router, logger, RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL
from models import User
from auth_dep import get_current_user, require_admin
from utils.email_log import log_email_send
from utils.admin_audit import record_admin_action
from routes.notifications import create_notification


CATEGORIES = ("bug", "improvement", "feature")
STATUSES = ("open", "under_review", "planned", "done", "declined")

# Built-in device options on the suggestion form.  Stored in case-
# sensitive display form here but matched case-insensitively against
# user input so "iphone" and "iPhone" don't fork.  Sorted
# alphabetically, "Other" is handled by the picker (lets the user
# type a name; the typed value is persisted to ``custom_devices`` so
# the next person sees it as an option).
BUILT_IN_DEVICES: tuple[str, ...] = (
    "Amazon Fire (Kindle Fire, Fire HD, Fire Tablet)",
    "Android phone",
    "Android tablet",
    "Chromebook",
    "iPad",
    "iPhone",
    "Kindle e-reader",
    "Linux",
    "Mac",
    "Windows PC",
)
# Cap on custom device names so they fit the chip UI without
# overflowing and so they don't become rambling free-text.
_MAX_DEVICE_LEN = 40

# Attachment limits — keeps Mongo doc size manageable AND covers the
# common bug-report kit: screenshot (≤2 MB), small PDF / log dump
# (≤10 MB), tiny .zip with a couple of artefacts.  Anything bigger
# should go via the dedicated Resend support email instead.
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


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
        # Attachment metadata — bytes never leak in list responses; the
        # admin board fetches them separately via the existing detail
        # endpoint (which reads the same doc).
        "attachment_name": doc.get("attachment_name"),
        "attachment_mime": doc.get("attachment_mime"),
        "attachment_size": doc.get("attachment_size"),
        "has_attachment":  bool(doc.get("attachment_b64")),
        # Device the suggestion was filed from (e.g. "iPhone", "Amazon
        # Fire").  Older suggestions pre-2026-06-20 backfill to
        # "Unknown" via the startup migration in deps.py.
        "device": doc.get("device") or "Unknown",
    }


# ---------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------

async def _resolve_device(raw: str) -> str:
    """Match ``raw`` against built-in + previously-saved custom
    devices case-insensitively.  Returns the canonical display name.

    If the input is genuinely new, it's normalized (stripped, length-
    capped, single-line) and persisted to the ``custom_devices``
    collection so the picker shows it to the next user.  Empty input
    is rejected by the caller (Form validator); this helper assumes
    at least one non-whitespace char.
    """
    cleaned = " ".join(raw.split()).strip()[:_MAX_DEVICE_LEN]
    if not cleaned:
        raise HTTPException(status_code=422, detail="device_required")
    lc = cleaned.lower()
    # 1. Match against built-ins (case-insensitive)
    for name in BUILT_IN_DEVICES:
        if name.lower() == lc:
            return name
    # 2. Match against existing custom devices
    existing = await db.custom_devices.find_one(
        {"name_lc": lc}, {"_id": 0, "name": 1}
    )
    if existing:
        return existing["name"]
    # 3. New custom device — persist it.  Best-effort; if two users
    #    add the same novel device at the same instant, the unique
    #    index on ``name_lc`` (created lazily) avoids dupes.
    doc = {
        "name": cleaned,
        "name_lc": lc,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await db.custom_devices.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.info("custom_devices race on insert: %s", e)
    return cleaned


@api_router.get("/suggestions/devices")
async def list_devices(_user: User = Depends(get_current_user)):
    """Return the picker options: built-ins + any custom entries
    previously typed in the ``Other`` field.  Sorted alphabetically
    (case-insensitive) so the dropdown stays predictable."""
    customs = await db.custom_devices.find({}, {"_id": 0, "name": 1}).to_list(length=200)
    custom_names = [c["name"] for c in customs if c.get("name")]
    # Combine + dedupe case-insensitively, preferring the built-in
    # casing when both exist.
    seen: dict[str, str] = {n.lower(): n for n in BUILT_IN_DEVICES}
    for n in custom_names:
        seen.setdefault(n.lower(), n)
    return {"devices": sorted(seen.values(), key=lambda x: x.lower())}


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
async def submit_suggestion(
    title: str = Form(..., min_length=3, max_length=120),
    body: str = Form(default="", max_length=4000),
    category: Literal["bug", "improvement", "feature"] = Form("feature"),
    device: str = Form(..., min_length=1, max_length=_MAX_DEVICE_LEN),
    attachment: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
):
    """Create a new suggestion on the board.

    Multipart form so bug-reporters can attach a screenshot, a small
    PDF, a log file, or a tiny zip without leaving the form.  Cap at
    10 MB — anything bigger should go via support email instead.

    Attachments are antivirus-scanned (ClamAV) before being base64-
    encoded into the doc so the admin board can preview them inline.

    ``device`` is required so triage knows whether "the reader is
    laggy" means iPhone Safari or Amazon Fire — see _resolve_device
    for the auto-add-to-picker behaviour.
    """
    canonical_device = await _resolve_device(device)
    now = datetime.now(timezone.utc)
    doc: Dict[str, Any] = {
        "suggestion_id": f"sug_{uuid.uuid4().hex[:12]}",
        "title": title.strip(),
        "body": body.strip(),
        "category": category,
        "device": canonical_device,
        "status": "open",
        "submitter_user_id": user.user_id,
        "submitter_name": user.name or (user.email or "").split("@")[0],
        "submitter_email": user.email or "",
        "voters": [user.user_id],  # submitter auto-votes for their own
        "admin_note": None,
        "created_at": now,
        "updated_at": now,
    }

    if attachment is not None:
        raw = await attachment.read()
        if not raw:
            # Empty file picker = no attachment.  Don't fail, just skip.
            pass
        elif len(raw) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail="attachment_too_large")
        else:
            # 2026-06-20 — images only (per user direction).  Other file
            # types should go via the dedicated support email.
            mime = (attachment.content_type or "").lower()
            if not mime.startswith("image/"):
                raise HTTPException(status_code=400, detail="not_an_image")
            # Antivirus pre-scan — same policy as /books/upload + /feedback.
            from utils.antivirus import scan_bytes, record_quarantine
            scan = await asyncio.to_thread(
                scan_bytes, raw, hint_name=attachment.filename or "suggestion.bin",
            )
            if scan.get("infected"):
                await record_quarantine(
                    user_id=user.user_id,
                    filename=attachment.filename or "",
                    scan=scan,
                    source="upload",
                    extra={"endpoint": "suggestions", "size_bytes": len(raw)},
                )
                raise HTTPException(status_code=400, detail="attachment_unsafe")
            doc["attachment_b64"]  = base64.b64encode(raw).decode()
            doc["attachment_mime"] = attachment.content_type or "image/png"
            doc["attachment_name"] = (attachment.filename or "screenshot")[:200]
            doc["attachment_size"] = len(raw)

    await db.suggestions.insert_one(doc)
    return _serialize(doc, user.user_id)


@api_router.get("/suggestions/{sid}/attachment")
async def download_suggestion_attachment(
    sid: str,
    user: User = Depends(get_current_user),
):
    """Stream the attachment for a suggestion.

    Only the submitter or an admin can fetch the bytes — public
    visibility on the board doesn't include the file (the list
    response only exposes ``has_attachment`` metadata).
    """
    from fastapi.responses import Response
    doc = await db.suggestions.find_one(
        {"suggestion_id": sid},
        {"_id": 0, "submitter_user_id": 1, "attachment_b64": 1,
         "attachment_mime": 1, "attachment_name": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if not user.is_admin and doc.get("submitter_user_id") != user.user_id:
        raise HTTPException(status_code=403, detail="Not allowed to view attachment")
    if not doc.get("attachment_b64"):
        raise HTTPException(status_code=404, detail="No attachment on this suggestion")
    raw = base64.b64decode(doc["attachment_b64"])
    fn = doc.get("attachment_name") or "attachment"
    return Response(
        content=raw,
        media_type=doc.get("attachment_mime") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{fn}"'},
    )


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
