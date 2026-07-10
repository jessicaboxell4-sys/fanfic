"""Per-admin user consent for read-only view-as-user + activity timeline.

The flow
--------
1. Admin opens /admin → Top storage users (or any user row) and clicks
   "Request view access" with an optional reason. This writes a pending
   ``view_consents`` row.
2. The user sees the incoming request in /account → Admin access. They
   either Grant (with a duration: 24h / 7d / 30d) or Deny. Granting flips
   the row to ``status="granted"`` and stamps ``expires_at``.
3. With an active consent the admin can read:
     • GET /api/admin/users/{uid}/view-as-data    (library snapshot)
     • GET /api/admin/users/{uid}/timeline        (chronological events)
   The endpoints write an ``admin_audit`` row per request so every read
   is traceable.
4. Either party can revoke at any time (user from /account, admin
   implicitly by letting it expire). The admin sees the status flip in
   their /admin → My view requests panel.

Scope is intentionally limited:
  • Consent is PER-ADMIN. Granting to admin Alice does NOT grant to admin
    Bob — each admin must request separately.
  • Consent is READ-ONLY. The admin never assumes the user's session;
    they remain logged in as themselves. No writes/uploads/messages can
    be made on the user's behalf through these endpoints.
  • Consents auto-expire. The default is 7 days; the user can pick
    24h / 7d / 30d at grant time. Expired consents go to ``"expired"``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field

from deps import db, api_router
from models import User
from auth_dep import get_current_user, require_admin
from utils.admin_audit import record_admin_action


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_DURATIONS_HOURS = {24, 24 * 7, 24 * 30}


async def _expire_stale_consents(filter_query: dict | None = None) -> None:
    """Lazily mark any granted consent past its ``expires_at`` as ``"expired"``.

    Called from every list endpoint so the FE never sees a stale row.
    Cheap because we only target ``granted`` rows with an expiry in the
    past.
    """
    q = {
        "status": "granted",
        "expires_at": {"$lt": datetime.now(timezone.utc)},
    }
    if filter_query:
        q = {**q, **filter_query}
    await db.view_consents.update_many(
        q, {"$set": {"status": "expired", "expired_at": datetime.now(timezone.utc)}}
    )


async def _active_consent(admin_id: str, target_user_id: str) -> Optional[dict]:
    """Return the active (granted, not-yet-expired) consent for an
    (admin, user) pair, or None.

    Auto-expires stale rows as a side effect so a slow-clicking admin
    can never read after the expiry instant."""
    await _expire_stale_consents({"admin_id": admin_id, "user_id": target_user_id})
    return await db.view_consents.find_one(
        {
            "admin_id": admin_id,
            "user_id": target_user_id,
            "status": "granted",
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        },
        {"_id": 0},
    )


def _normalize(consent: dict) -> dict:
    """Strip ``_id`` and stringify datetimes for JSON."""
    if not consent:
        return consent
    out = {**consent}
    out.pop("_id", None)
    for k in ("created_at", "granted_at", "revoked_at", "expired_at", "expires_at", "last_used_at"):
        v = out.get(k)
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ---------------------------------------------------------------------------
# Admin → Request view access
# ---------------------------------------------------------------------------

class ViewRequestBody(BaseModel):
    reason: str = Field(default="", max_length=500)


@api_router.post("/admin/users/{target_user_id}/view-request")
async def request_view_access(
    target_user_id: str,
    body: ViewRequestBody,
    admin: User = Depends(require_admin),
):
    """Create a pending consent request for the (admin, user) pair.

    If a pending request already exists, it's returned as-is (idempotent).
    If a granted-but-expired consent exists, a new pending row is created
    so the user has to re-grant rather than the admin silently extending."""
    if target_user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="You don't need to request view access to your own account.")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Idempotent: an existing pending or granted-and-active row wins.
    existing = await db.view_consents.find_one({
        "admin_id": admin.user_id,
        "user_id": target_user_id,
        "status": {"$in": ["pending", "granted"]},
    })
    if existing:
        # If granted but expired in the meantime, treat as stale and
        # carry on to a fresh pending row.
        if existing.get("status") == "granted" and existing.get("expires_at") and existing["expires_at"] < datetime.now(timezone.utc):
            await db.view_consents.update_one(
                {"consent_id": existing["consent_id"]},
                {"$set": {"status": "expired", "expired_at": datetime.now(timezone.utc)}},
            )
        else:
            return {"consent": _normalize(existing), "created": False}

    consent_id = f"vc_{uuid.uuid4().hex[:16]}"
    doc = {
        "consent_id": consent_id,
        "admin_id": admin.user_id,
        "admin_name": admin.name,
        "admin_email": admin.email,
        "user_id": target_user_id,
        "user_name": target.get("name") or "",
        "user_email": target.get("email") or "",
        "status": "pending",
        "reason": (body.reason or "").strip()[:500],
        "scope": ["view_library", "timeline"],
        "created_at": datetime.now(timezone.utc),
        "expires_at": None,
        "granted_at": None,
        "revoked_at": None,
    }
    await db.view_consents.insert_one(doc)
    await record_admin_action(
        admin, "view_consent.request",
        target=target_user_id,
        metadata={"consent_id": consent_id, "reason": doc["reason"][:120]},
    )
    return {"consent": _normalize(doc), "created": True}


@api_router.get("/admin/view-requests/mine")
async def list_my_view_requests(admin: User = Depends(require_admin)):
    """Outgoing requests for the calling admin — pending + active
    granted rows, sorted newest first. Expired/revoked included for the
    last 30 days so the admin can see why a previously-working consent
    stopped working."""
    await _expire_stale_consents({"admin_id": admin.user_id})
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    rows = await db.view_consents.find(
        {
            "admin_id": admin.user_id,
            "$or": [
                {"status": {"$in": ["pending", "granted"]}},
                {"status": {"$in": ["revoked", "expired", "denied"]}, "created_at": {"$gte": cutoff}},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(length=200)
    return {"consents": [_normalize(r) for r in rows]}


# ---------------------------------------------------------------------------
# User → Manage incoming requests
# ---------------------------------------------------------------------------

class ConsentRespondBody(BaseModel):
    accept: bool
    hours: int = Field(default=24 * 7, ge=1, le=24 * 30)


@api_router.get("/account/view-requests")
async def list_my_consents(user: User = Depends(get_current_user)):
    """Incoming consent requests + currently-active grants for the
    calling user. The FE renders these as 'Admin access' on /account."""
    await _expire_stale_consents({"user_id": user.user_id})
    rows = await db.view_consents.find(
        {"user_id": user.user_id, "status": {"$in": ["pending", "granted"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(length=100)
    return {"consents": [_normalize(r) for r in rows]}


@api_router.post("/account/view-requests/{consent_id}/respond")
async def respond_to_view_request(
    consent_id: str,
    body: ConsentRespondBody,
    user: User = Depends(get_current_user),
):
    """User grants or denies a pending consent request.

    Granting requires picking a duration; 24h / 7d (default) / 30d are
    the supported choices. Denying just marks the row ``"denied"`` —
    the admin must re-request to try again.
    """
    consent = await db.view_consents.find_one({"consent_id": consent_id, "user_id": user.user_id})
    if not consent:
        raise HTTPException(status_code=404, detail="Consent request not found")
    if consent.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"This request is already {consent.get('status')}.")
    if not body.accept:
        await db.view_consents.update_one(
            {"consent_id": consent_id},
            {"$set": {"status": "denied", "denied_at": datetime.now(timezone.utc)}},
        )
        return {"ok": True, "status": "denied"}

    # Round to one of the canonical durations to keep the audit trail
    # readable (24h / 7d / 30d).
    hours = body.hours
    if hours not in VALID_DURATIONS_HOURS:
        # Pick the closest canonical duration to whatever the FE sent.
        hours = min(VALID_DURATIONS_HOURS, key=lambda h: abs(h - body.hours))
    expires_at = datetime.now(timezone.utc) + timedelta(hours=hours)
    await db.view_consents.update_one(
        {"consent_id": consent_id},
        {
            "$set": {
                "status": "granted",
                "granted_at": datetime.now(timezone.utc),
                "expires_at": expires_at,
                "granted_duration_hours": hours,
            }
        },
    )
    return {"ok": True, "status": "granted", "expires_at": expires_at.isoformat()}


@api_router.delete("/account/view-consents/{consent_id}")
async def revoke_consent(consent_id: str, user: User = Depends(get_current_user)):
    """User revokes a granted consent. The admin's next view-as-data or
    timeline call returns 403 immediately."""
    consent = await db.view_consents.find_one({"consent_id": consent_id, "user_id": user.user_id})
    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")
    if consent.get("status") != "granted":
        raise HTTPException(status_code=400, detail=f"Can only revoke granted consents (this one is {consent.get('status')}).")
    await db.view_consents.update_one(
        {"consent_id": consent_id},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin → Read consented user data
# ---------------------------------------------------------------------------

@api_router.get("/admin/users/{target_user_id}/view-as-data")
async def view_as_user(
    target_user_id: str,
    admin: User = Depends(require_admin),
):
    """Read-only snapshot of a consented user's library + shelves +
    recent uploads. Returns 403 if no active consent for this
    (admin, user) pair. Writes an ``admin_audit`` row on every read so
    the user can see who looked at their account from the audit log.

    Important: the admin does NOT assume the user's session — they
    remain logged in as themselves. Writes from these endpoints are
    impossible; this is purely a diagnostic surface.
    """
    consent = await _active_consent(admin.user_id, target_user_id)
    if not consent:
        raise HTTPException(
            status_code=403,
            detail={"code": "no_consent", "message": "No active view-access consent for this user."},
        )

    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "username": 1, "created_at": 1, "approval_status": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Library snapshot: most-recent 100 books with the fields the admin
    # actually needs to debug "where did my fandom go" complaints.
    books = await db.books.find(
        {"user_id": target_user_id},
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "shelves": 1, "progress_fraction": 1,
            "size_bytes": 1, "created_at": 1, "last_opened_at": 1,
        },
    ).sort("created_at", -1).limit(100).to_list(length=100)
    for b in books:
        for k in ("created_at", "last_opened_at"):
            v = b.get(k)
            if isinstance(v, datetime):
                b[k] = v.isoformat()

    # Fandom + category breakdown of THE ENTIRE library (not just the
    # 100 above) so the admin can verify "I should have X HP books".
    fandom_rows = await db.books.aggregate([
        {"$match": {"user_id": target_user_id, "fandom": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 30},
    ]).to_list(length=30)
    total_books = await db.books.count_documents({"user_id": target_user_id})

    # Bump consent.last_used_at so the user can see "admin Alice last
    # used this 5 minutes ago" in their /account view.
    await db.view_consents.update_one(
        {"consent_id": consent["consent_id"]},
        {"$set": {"last_used_at": datetime.now(timezone.utc)}, "$inc": {"use_count": 1}},
    )
    await record_admin_action(
        admin, "view_consent.read_library",
        target=target_user_id,
        metadata={"consent_id": consent["consent_id"]},
    )

    return {
        "consent": _normalize(consent),
        "user": target,
        "library": {
            "total_books": total_books,
            "recent_books": books,
            "fandoms": [{"name": r["_id"], "count": r["count"]} for r in fandom_rows],
        },
    }


@api_router.get("/admin/users/{target_user_id}/timeline")
async def view_user_timeline(
    target_user_id: str,
    limit: int = 100,
    admin: User = Depends(require_admin),
):
    """Chronological activity for a consented user: book uploads,
    deletions (from admin_audit), account events, last-opened. Sorted
    newest first. Same consent gating as ``/view-as-data``.
    """
    consent = await _active_consent(admin.user_id, target_user_id)
    if not consent:
        raise HTTPException(
            status_code=403,
            detail={"code": "no_consent", "message": "No active view-access consent for this user."},
        )

    limit = max(1, min(int(limit), 500))
    events: list[dict] = []

    # 1) Uploads (books.created_at).
    async for b in db.books.find(
        {"user_id": target_user_id},
        {"_id": 0, "book_id": 1, "title": 1, "fandom": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit):
        ts = b.get("created_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        events.append({
            "kind": "book_uploaded",
            "at": ts,
            "title": b.get("title"),
            "fandom": b.get("fandom"),
            "book_id": b.get("book_id"),
        })

    # 2) Recent last-opened (books with last_opened_at).
    async for b in db.books.find(
        {"user_id": target_user_id, "last_opened_at": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "book_id": 1, "title": 1, "last_opened_at": 1, "progress_fraction": 1},
    ).sort("last_opened_at", -1).limit(50):
        ts = b.get("last_opened_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        events.append({
            "kind": "book_opened",
            "at": ts,
            "title": b.get("title"),
            "book_id": b.get("book_id"),
            "progress_fraction": b.get("progress_fraction"),
        })

    # 3) Admin actions taken AGAINST this user (e.g. approval, role
    # changes) so the admin reviewing can see "this account was approved
    # by Bob on 2026-06-15 then promoted to admin by Carol".
    async for a in db.admin_audit.find(
        {"target": target_user_id},
        {"_id": 0, "action": 1, "at": 1, "actor_name": 1, "metadata": 1},
    ).sort("at", -1).limit(50):
        ts = a.get("at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        events.append({
            "kind": "admin_action",
            "at": ts,
            "action": a.get("action"),
            "actor": a.get("actor_name"),
            "metadata": a.get("metadata") or {},
        })

    # Sort all event types together, newest first.
    events.sort(key=lambda e: e.get("at") or "", reverse=True)
    events = events[:limit]

    await db.view_consents.update_one(
        {"consent_id": consent["consent_id"]},
        {"$set": {"last_used_at": datetime.now(timezone.utc)}, "$inc": {"use_count": 1}},
    )
    await record_admin_action(
        admin, "view_consent.read_timeline",
        target=target_user_id,
        metadata={"consent_id": consent["consent_id"], "event_count": len(events)},
    )
    return {
        "consent": _normalize(consent),
        "events": events,
        "count": len(events),
    }
