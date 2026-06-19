"""Admin Console endpoints.

Every endpoint here uses `Depends(require_admin)`. All mutating endpoints
call `record_admin_action(...)` so the audit log is always populated.

Endpoint groups:
- Users:                 GET /admin/users, POST /admin/users/{id}/promote, POST /admin/users/{id}/demote
- Maintenance banner:    GET/PUT /admin/maintenance-banner
- System health:         GET /admin/system-health
- Global fandom aliases: GET/PUT /admin/global-fandom-aliases
- Global stats:          GET /admin/global-stats
- Feature flags:         GET/PUT /admin/feature-flags
- Audit log:             GET /admin/audit-log

The maintenance banner is also readable at `GET /maintenance-banner`
(no auth) so the public frontend can poll it.
"""
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
import shutil
import os
import asyncio
import resend

from deps import db, api_router, logger, RESEND_API_KEY, SENDER_EMAIL, EMERGENT_LLM_KEY, STORAGE_DIR, FRONTEND_URL
from models import User
from auth_dep import require_admin, require_moderator_or_admin
from utils.admin_audit import record_admin_action
from utils.test_account_filter import mongo_test_account_filter
from utils.email_log import log_email_send
from utils.feature_flags import KNOWN_FLAGS, get_flags, set_flag


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@api_router.get("/admin/users")
async def list_users(user: User = Depends(require_admin)):
    """Return every user with admin badge + book/storage stats."""
    rows = await db.users.find(
        {},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "is_admin": 1, "is_moderator": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(length=2000)
    # Annotate with book counts (single aggregation, not per-row).
    counts_cursor = db.books.aggregate([
        {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}
    ])
    counts: Dict[str, int] = {}
    async for c in counts_cursor:
        counts[c["_id"]] = c["n"]
    for r in rows:
        r["book_count"] = counts.get(r["user_id"], 0)
        r["is_admin"] = bool(r.get("is_admin"))
        r["is_moderator"] = bool(r.get("is_moderator"))
        ts = r.get("created_at")
        if isinstance(ts, datetime):
            r["created_at"] = ts.isoformat()
    return {"users": rows, "count": len(rows)}


@api_router.post("/admin/users/{target_user_id}/promote")
async def promote_user(target_user_id: str, user: User = Depends(require_admin)):
    """Flag the target user as admin. Idempotent."""
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1, "is_admin": 1})
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"is_admin": True}})
    await record_admin_action(user, "user.promote", target=target_user_id, metadata={"email": target.get("email")})
    return {"ok": True, "user_id": target_user_id, "is_admin": True}


@api_router.post("/admin/users/{target_user_id}/demote")
async def demote_user(target_user_id: str, user: User = Depends(require_admin)):
    """Remove admin flag. Refuses to demote the last remaining admin so the
    console never becomes unreachable. Refuses self-demote for the same
    reason — use mongosh if you really want to."""
    if target_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="Use mongosh to demote yourself")
    admin_count = await db.users.count_documents({"is_admin": True})
    if admin_count <= 1:
        raise HTTPException(status_code=400, detail="Refusing to demote the last admin")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1, "is_admin": 1})
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.get("is_admin"):
        return {"ok": True, "user_id": target_user_id, "is_admin": False}  # idempotent
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"is_admin": False}})
    await record_admin_action(user, "user.demote", target=target_user_id, metadata={"email": target.get("email")})
    return {"ok": True, "user_id": target_user_id, "is_admin": False}


# ---------------------------------------------------------------------------
# Moderator promotion (2026-06-17)
# ---------------------------------------------------------------------------
# Mods are a permission tier between regular users and full admins. They
# can approve / reject pending sign-ups and lock bookclub rooms, but
# CANNOT ban users, demote admins, set feature flags, or run destructive
# actions.  Promotion is admin-only.  ``is_moderator`` is independent
# from ``is_admin`` — promoting to mod doesn't touch admin, and an admin
# isn't auto-considered a mod (they bypass the ``require_moderator_or_admin``
# dep via their admin flag instead, see auth_dep.py).

@api_router.post("/admin/users/{target_user_id}/promote-mod")
async def promote_moderator(target_user_id: str, user: User = Depends(require_admin)):
    """Flag the target user as a moderator. Idempotent — re-promoting an
    existing mod is a no-op so the UI can be optimistic."""
    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "email": 1, "is_moderator": 1},
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("is_moderator"):
        return {"ok": True, "user_id": target_user_id, "is_moderator": True}
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$set": {"is_moderator": True}},
    )
    await record_admin_action(
        user,
        "user.promote_mod",
        target=target_user_id,
        metadata={"email": target.get("email")},
    )
    return {"ok": True, "user_id": target_user_id, "is_moderator": True}


@api_router.post("/admin/users/{target_user_id}/demote-mod")
async def demote_moderator(target_user_id: str, user: User = Depends(require_admin)):
    """Remove the moderator flag. Idempotent. Unlike admin demotion this
    has no "last mod" guard — admins can always cover the mod surface,
    so it's safe to drop to zero mods."""
    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "email": 1, "is_moderator": 1},
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.get("is_moderator"):
        return {"ok": True, "user_id": target_user_id, "is_moderator": False}
    await db.users.update_one(
        {"user_id": target_user_id},
        {"$set": {"is_moderator": False}},
    )
    await record_admin_action(
        user,
        "user.demote_mod",
        target=target_user_id,
        metadata={"email": target.get("email")},
    )
    return {"ok": True, "user_id": target_user_id, "is_moderator": False}


# ---------------------------------------------------------------------------
# New-user approval gate (2026-06-15)
# ---------------------------------------------------------------------------
# Every new sign-up — email/password OR Google OAuth — lands in
# ``approval_status="pending"`` and cannot use the API. Admins triage from
# /admin → Pending sign-ups. Approve flips status to ``"approved"`` and
# emails the user; reject flips to ``"rejected"`` with a reason and emails
# the user. The very first user ever to register is auto-approved + made
# admin so the install bootstraps itself (logic in ``routes/auth.py``).

class RejectUserBody(BaseModel):
    reason: str = Field(default="", max_length=500)


async def _send_approval_email(
    *,
    to: str,
    name: str,
    approved: bool,
    reason: str = "",
) -> None:
    """Best-effort approval / rejection email. Never raises."""
    if not RESEND_API_KEY or not SENDER_EMAIL or not to:
        # Resend not configured — log and move on. The user can still log
        # in once approved (login checks status, not the email arrival).
        return
    subject = (
        "Welcome to Shelfsort — your account is approved"
        if approved
        else "Your Shelfsort sign-up wasn't approved"
    )
    body_html = (
        f"<div style='font-family:system-ui,sans-serif;max-width:560px;line-height:1.6'>"
        f"<h2 style='color:#6B46C1;margin:0 0 12px'>Hi {name or 'there'},</h2>"
        + (
            f"<p style='margin:0 0 12px;color:#2C2C2C'>Your Shelfsort account has been "
            f"approved. You can sign in now and start uploading your library.</p>"
            f"<p style='margin:0 0 12px'><a href='{FRONTEND_URL or ''}/login' "
            f"style='background:#6B46C1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block'>"
            f"Sign in to Shelfsort</a></p>"
            if approved
            else (
                "<p style='margin:0 0 12px;color:#2C2C2C'>We took a look at your "
                "Shelfsort sign-up but won't be approving the account at this time."
                "</p>"
                + (
                    f"<p style='margin:0 0 12px;color:#2C2C2C'><strong>Reason from the admin:</strong> {reason}</p>"
                    if reason
                    else ""
                )
                + "<p style='margin:0 0 12px;color:#6B705C;font-size:13px'>"
                f"If you think this was a mistake, you're welcome to re-register at "
                f"<a href='{FRONTEND_URL or ''}/signup' style='color:#6B46C1'>{FRONTEND_URL or ''}/signup</a>.</p>"
            )
        )
        + "</div>"
    )
    body_text = (
        f"Hi {name or 'there'},\n\n"
        + (
            "Your Shelfsort account has been approved. You can sign in now and start uploading your library.\n\n"
            f"Sign in: {FRONTEND_URL or ''}/login\n"
            if approved
            else (
                "We took a look at your Shelfsort sign-up but won't be approving the account at this time.\n\n"
                + (f"Reason from the admin: {reason}\n\n" if reason else "")
                + f"If you think this was a mistake, you're welcome to re-register at {FRONTEND_URL or ''}/signup.\n"
            )
        )
    )
    kind = "approval_approved" if approved else "approval_rejected"
    try:
        from utils.email_log import log_email_send as _log
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [to],
            "subject": subject,
            "html": body_html,
            "text": body_text,
        }
        await asyncio.to_thread(resend.Emails.send, params)
        await _log(kind, to, "ok")
    except Exception as exc:
        logger.error("approval email failed for %s: %s", to, exc)
        try:
            from utils.email_log import log_email_send as _log
            await _log(kind, to, "error", error=str(exc))
        except Exception:
            pass


# `FRONTEND_URL` is imported at the top with the other deps; this block is
# intentionally left as a defensive shim in case the import ever moves out
# of ``deps`` so the approval-email helper degrades to "no link" rather
# than crashing the approval endpoint.
if "FRONTEND_URL" not in globals():
    FRONTEND_URL = ""  # pragma: no cover


@api_router.get("/admin/pending-users")
async def list_pending_users(user: User = Depends(require_moderator_or_admin)):
    """List every user whose ``approval_status == "pending"`` so admins
    can triage them on the AdminConsole. Sorted oldest-first so the queue
    is FIFO — the user who has been waiting longest is at the top.

    Test-account fixtures (``@test.local``, ``@example.com``, etc. — see
    ``utils.test_account_filter``) are filtered out so the testing-agent
    seeds don't clog the real admin inbox; they're triageable on the
    separate ``/admin/test-accounts`` page if ever needed.
    """
    rows = await (
        db.users.find(
            {
                "approval_status": "pending",
                "$nor": mongo_test_account_filter()["$or"],
            },
            {
                "_id": 0,
                "user_id": 1,
                "email": 1,
                "name": 1,
                "username": 1,
                "picture": 1,
                "created_at": 1,
                "onboarding": 1,
            },
        )
        .sort("created_at", 1)
        .to_list(length=500)
    )
    return {"users": rows, "count": len(rows)}


class BulkApproveBody(BaseModel):
    ref: Optional[str] = None  # match onboarding.referral; None = approve all pending


@api_router.post("/admin/pending-users/approve-bulk")
async def approve_pending_bulk(
    body: BulkApproveBody,
    user: User = Depends(require_moderator_or_admin),
):
    """One-click bulk-approve every pending sign-up — optionally
    filtered to a single referral campaign (``ref="facebook"`` etc.).

    Mirrors `approve_user` per-row: flips status, stamps approver +
    timestamp, drops any rejection reason, writes an audit log entry,
    and best-effort sends the approval email.

    Excludes test-account fixtures so the bulk action is always safe
    on the real inbox.  Returns counts + a per-user breakdown.
    """
    query: Dict[str, Any] = {
        "approval_status": "pending",
        "$nor": mongo_test_account_filter()["$or"],
    }
    ref = (body.ref or "").strip().lower()
    if ref:
        query["onboarding.referral"] = ref

    targets = await db.users.find(
        query, {"_id": 0, "user_id": 1, "email": 1, "name": 1},
    ).to_list(length=500)

    if not targets:
        return {"ok": True, "approved": 0, "ref": ref or None, "users": []}

    now = datetime.now(timezone.utc).isoformat()
    user_ids = [t["user_id"] for t in targets]
    result = await db.users.update_many(
        {"user_id": {"$in": user_ids}, "approval_status": "pending"},
        {
            "$set": {
                "approval_status": "approved",
                "approved_by": user.user_id,
                "approved_at": now,
            },
            "$unset": {"approval_rejected_reason": ""},
        },
    )

    # Audit log a single bulk entry — too noisy to write N rows.
    await record_admin_action(
        user,
        "user.approve_bulk",
        target=f"ref:{ref}" if ref else "all-pending",
        metadata={"count": result.modified_count, "ref": ref or None},
    )

    # Send approval emails in parallel — best-effort.  Failures don't
    # block: the user can still log in, they just won't get the welcome
    # email until we add a retry queue (out of scope here).
    async def _send_one(t: Dict[str, Any]) -> bool:
        try:
            await _send_approval_email(
                to=t.get("email") or "",
                name=t.get("name") or "",
                approved=True,
            )
            return True
        except Exception:
            return False

    email_results = await asyncio.gather(*[_send_one(t) for t in targets], return_exceptions=False)
    emails_sent = sum(1 for ok in email_results if ok)

    return {
        "ok": True,
        "approved": result.modified_count,
        "emails_sent": emails_sent,
        "ref": ref or None,
        "users": [
            {"user_id": t["user_id"], "email": t.get("email")}
            for t in targets
        ],
    }


@api_router.get("/admin/test-accounts")
async def list_test_accounts(user: User = Depends(require_moderator_or_admin)):
    """Companion to ``/admin/pending-users`` — returns the *fixture*
    accounts created by the testing agent or seeded for QA, regardless
    of ``approval_status``.  Surfaced on the separate
    ``/admin/test-accounts`` page so the main pending inbox stays
    clean for real sign-ups.  Sorted newest-first because admins
    triaging fixtures usually want to act on the most recent batch.
    """
    rows = await (
        db.users.find(
            {**mongo_test_account_filter()},
            {
                "_id": 0,
                "user_id": 1,
                "email": 1,
                "name": 1,
                "username": 1,
                "picture": 1,
                "approval_status": 1,
                "created_at": 1,
                "approved_at": 1,
                "approval_rejected_reason": 1,
            },
        )
        .sort("created_at", -1)
        .to_list(length=500)
    )
    return {"users": rows, "count": len(rows)}


@api_router.get("/admin/campaign-stats")
async def get_campaign_stats(user: User = Depends(require_moderator_or_admin)):
    """Per-campaign conversion funnel.

    For each tracked invite source (``onboarding.referral``, populated
    either by the multi-step signup question OR by the ``?ref=<channel>``
    URL tracker on /login):

      - ``signups``   — total accounts that came via this channel
      - ``approved``  — how many of them passed the approval gate
      - ``uploaded``  — how many own ≥ 1 book (real engagement signal)
      - ``active_7d`` — how many have logged in in the last 7 days

    Test-account fixtures are excluded so the funnel reflects real
    humans only.  Returns a list sorted by signups desc so the top
    channel is first.  An ``organic`` synthetic row gathers users
    with no ``onboarding.referral`` set — the baseline for comparing
    paid/posted campaigns against people who found the site cold.
    """
    real_user_filter = {"$nor": mongo_test_account_filter()["$or"]}
    seven_days_ago = (
        datetime.now(timezone.utc) - timedelta(days=7)
    ).isoformat()

    # Group all real users by referral, counting approved + active_7d
    # in the same pass so we hit Mongo once.
    cursor = db.users.aggregate([
        {"$match": real_user_filter},
        {"$group": {
            "_id": {"$ifNull": ["$onboarding.referral", None]},
            "signups":   {"$sum": 1},
            "approved":  {"$sum": {"$cond": [{"$eq": ["$approval_status", "approved"]}, 1, 0]}},
            "pending":   {"$sum": {"$cond": [{"$eq": ["$approval_status", "pending"]},  1, 0]}},
            "active_7d": {"$sum": {"$cond": [{"$gte": ["$last_login_at", seven_days_ago]}, 1, 0]}},
            "user_ids":  {"$push": "$user_id"},
        }},
    ])
    groups = [g async for g in cursor]

    # "Uploaded" — separate query because ``db.books`` doesn't know
    # about ``onboarding.referral``.  Fetch the set of user_ids who own
    # ≥ 1 book, then intersect with each campaign's user_id list.
    uploader_ids: set[str] = set(
        await db.books.distinct("user_id")
    )

    out: list[dict] = []
    for g in groups:
        ref = g["_id"]
        ref_uploaders = sum(1 for uid in g["user_ids"] if uid in uploader_ids)
        out.append({
            "ref":       ref,  # None for organic
            "signups":   g["signups"],
            "approved":  g["approved"],
            "pending":   g["pending"],
            "uploaded":  ref_uploaders,
            "active_7d": g["active_7d"],
        })

    out.sort(key=lambda r: (-r["signups"], (r["ref"] or "zzz")))
    return {"campaigns": out, "computed_at": datetime.now(timezone.utc).isoformat()}


@api_router.post("/admin/test-accounts/purge")
async def purge_test_accounts(user: User = Depends(require_admin)):
    """Hard-delete every fixture account (and any books/sessions they
    own).  Admin-only — moderators can view fixtures but only an admin
    can wipe them.  Idempotent.  Returns a summary of what was deleted.
    """
    fixtures = await db.users.find(
        {**mongo_test_account_filter()},
        {"_id": 0, "user_id": 1, "email": 1},
    ).to_list(length=1000)
    user_ids = [u["user_id"] for u in fixtures]
    if not user_ids:
        return {"ok": True, "deleted_users": 0, "deleted_books": 0, "deleted_sessions": 0}

    books_res = await db.books.delete_many({"user_id": {"$in": user_ids}})
    sessions_res = await db.user_sessions.delete_many({"user_id": {"$in": user_ids}})
    users_res = await db.users.delete_many({"user_id": {"$in": user_ids}})

    await record_admin_action(
        user,
        action="purge_test_accounts",
        target_type="users",
        target_id="test-fixtures",
        details={"count": users_res.deleted_count, "emails": [u["email"] for u in fixtures[:50]]},
    )
    return {
        "ok": True,
        "deleted_users":    users_res.deleted_count,
        "deleted_books":    books_res.deleted_count,
        "deleted_sessions": sessions_res.deleted_count,
    }


@api_router.post("/admin/users/{target_user_id}/approve")
async def approve_user(target_user_id: str, user: User = Depends(require_moderator_or_admin)):
    """Flip a pending sign-up to ``"approved"`` so they can log in.
    Emails the user (best-effort). Idempotent on already-approved users."""
    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "email": 1, "name": 1, "approval_status": 1},
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    current_status = (target.get("approval_status") or "approved").lower()
    if current_status == "approved":
        return {"ok": True, "user_id": target_user_id, "approval_status": "approved"}
    await db.users.update_one(
        {"user_id": target_user_id},
        {
            "$set": {
                "approval_status": "approved",
                "approved_by": user.user_id,
                "approved_at": datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {"approval_rejected_reason": ""},
        },
    )
    await record_admin_action(
        user,
        "user.approve",
        target=target_user_id,
        metadata={"email": target.get("email"), "from_status": current_status},
    )
    await _send_approval_email(
        to=target.get("email") or "",
        name=target.get("name") or "",
        approved=True,
    )
    return {"ok": True, "user_id": target_user_id, "approval_status": "approved"}


@api_router.post("/admin/users/{target_user_id}/reject")
async def reject_user(
    target_user_id: str,
    body: RejectUserBody,
    user: User = Depends(require_moderator_or_admin),
):
    """Flip a pending sign-up to ``"rejected"`` with an optional reason.
    Emails the user the reason so they know whether to re-register."""
    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "email": 1, "name": 1, "approval_status": 1},
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    current_status = (target.get("approval_status") or "approved").lower()
    if current_status == "approved":
        raise HTTPException(
            status_code=400,
            detail="Cannot reject an already-approved user. Use the user-management UI to remove them instead.",
        )
    reason = (body.reason or "").strip()
    await db.users.update_one(
        {"user_id": target_user_id},
        {
            "$set": {
                "approval_status": "rejected",
                "approval_rejected_reason": reason,
                "rejected_by": user.user_id,
                "rejected_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await record_admin_action(
        user,
        "user.reject",
        target=target_user_id,
        metadata={"email": target.get("email"), "reason": reason[:120]},
    )
    await _send_approval_email(
        to=target.get("email") or "",
        name=target.get("name") or "",
        approved=False,
        reason=reason,
    )
    return {"ok": True, "user_id": target_user_id, "approval_status": "rejected"}


# ---------------------------------------------------------------------------
# Today pulse (mini-dashboard, 24-hour window)
# ---------------------------------------------------------------------------

@api_router.get("/admin/today-pulse")
async def get_today_pulse(user: User = Depends(require_admin)):
    """First-thing-in-the-morning glance: what happened in the last 24h.

    Returns:
      • ``signups_24h`` — users with ``created_at`` inside the window.
      • ``uploads_24h`` — books with ``created_at`` inside the window.
      • ``resend_errors_24h`` — failed Resend sends from ``email_logs``.
      • ``new_fandoms_24h`` — fandoms first seen inside the window
        (a fandom that appeared in any book before the window is NOT new).
      • ``pending_count`` — total users currently in ``"pending"``.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)
    win_iso = window_start.isoformat()

    # 1) Signups in the last 24h. ``created_at`` is stored as ISO string
    # at the moment, so we compare lexicographically — safe for ISO 8601.
    signups_24h = await db.users.count_documents({"created_at": {"$gte": win_iso}})

    # 2) Uploads. Some old books store ``created_at`` as datetime, newer
    # ones as ISO string — handle both with $or.
    uploads_24h = await db.books.count_documents({
        "$or": [
            {"created_at": {"$gte": window_start}},
            {"created_at": {"$gte": win_iso}},
        ]
    })

    # 3) Resend errors (any kind, not just cron-alerts).
    resend_errors_24h = await db.email_logs.count_documents({
        "status": "error",
        "sent_at": {"$gte": window_start},
    })

    # 4) New fandoms — fandoms whose earliest appearance is inside the
    # window. Aggregate min(created_at) per fandom across all books, then
    # filter to those whose minimum is inside the 24h window.
    fandom_pipeline = [
        {"$match": {"fandom": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": "$fandom", "first_seen": {"$min": "$created_at"}}},
    ]
    fandom_rows = await db.books.aggregate(fandom_pipeline).to_list(length=2000)
    new_fandoms: list[str] = []
    for r in fandom_rows:
        fs = r.get("first_seen")
        if isinstance(fs, str):
            try:
                fs_dt = datetime.fromisoformat(fs)
            except ValueError:
                continue
            if fs_dt.tzinfo is None:
                fs_dt = fs_dt.replace(tzinfo=timezone.utc)
        elif isinstance(fs, datetime):
            fs_dt = fs if fs.tzinfo else fs.replace(tzinfo=timezone.utc)
        else:
            continue
        if fs_dt >= window_start:
            new_fandoms.append(r["_id"])

    # 5) Pending count — independent of the 24h window because the queue
    # is the queue.  Excludes fixture accounts so the operator-digest
    # KPI matches what the admin sees in the inbox.
    pending_count = await db.users.count_documents({
        "approval_status": "pending",
        "$nor": mongo_test_account_filter()["$or"],
    })

    return {
        "window_hours": 24,
        "signups_24h": signups_24h,
        "uploads_24h": uploads_24h,
        "resend_errors_24h": resend_errors_24h,
        "new_fandoms_24h": len(new_fandoms),
        "new_fandom_names": new_fandoms[:10],
        "pending_count": pending_count,
    }


# ---------------------------------------------------------------------------
# Per-user storage view (2026-06-15) — option (g): counts + titles + sizes
# ---------------------------------------------------------------------------
# Surfaces the top-N library owners by total uploaded bytes so the admin
# can spot abandoned-but-huge accounts or power-users who might need their
# own performance tweaks. NEVER returns file contents — only metadata
# already visible in global stats (title, author, fandom, size_bytes).

@api_router.get("/admin/storage-by-user")
async def storage_by_user(
    limit: int = 20,
    user: User = Depends(require_admin),
):
    """Top N users ordered by ``sum(size_bytes)``. Books without
    ``size_bytes`` (≈58% of historical rows) contribute 0 to the
    user's total, which is good enough for triage — the largest
    accounts virtually always have at least one sized book."""
    limit = max(1, min(int(limit), 100))
    pipeline = [
        {"$match": {"size_bytes": {"$gt": 0}}},
        {"$group": {
            "_id": "$user_id",
            "total_bytes": {"$sum": "$size_bytes"},
            "book_count": {"$sum": 1},
            "last_upload": {"$max": "$created_at"},
        }},
        {"$sort": {"total_bytes": -1}},
        {"$limit": limit},
    ]
    rows = await db.books.aggregate(pipeline).to_list(length=limit)

    # Enrich with display name / email so the admin doesn't have to
    # cross-reference user_ids by hand.
    uids = [r["_id"] for r in rows]
    users_by_id = {}
    if uids:
        async for u in db.users.find(
            {"user_id": {"$in": uids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "username": 1, "approval_status": 1},
        ):
            users_by_id[u["user_id"]] = u

    enriched = []
    for r in rows:
        u = users_by_id.get(r["_id"], {})
        last_upload = r.get("last_upload")
        if isinstance(last_upload, datetime):
            last_upload = last_upload.isoformat()
        enriched.append({
            "user_id": r["_id"],
            "name": u.get("name") or "(unknown user)",
            "email": u.get("email") or "",
            "username": u.get("username"),
            "approval_status": u.get("approval_status") or "approved",
            "total_bytes": int(r["total_bytes"]),
            "book_count": int(r["book_count"]),
            "last_upload": last_upload,
        })

    # Global totals as a denominator so the FE can show "this user is
    # X% of all storage".
    grand_total_doc = await db.books.aggregate([
        {"$match": {"size_bytes": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$size_bytes"}, "count": {"$sum": 1}}},
    ]).to_list(length=1)
    grand_total = int(grand_total_doc[0]["total"]) if grand_total_doc else 0
    grand_count = int(grand_total_doc[0]["count"]) if grand_total_doc else 0

    return {
        "users": enriched,
        "limit": limit,
        "grand_total_bytes": grand_total,
        "grand_total_books_with_size": grand_count,
    }


@api_router.get("/admin/users/{target_user_id}/books")
async def list_user_books(
    target_user_id: str,
    limit: int = 200,
    user: User = Depends(require_admin),
):
    """Per-user book list for the storage-card drill-down. Returns ONLY
    metadata (title, author, fandom, size_bytes, created_at). Reading
    progress, bookmarks, fulltext, etc. are deliberately omitted — this
    is storage triage, not impersonation."""
    limit = max(1, min(int(limit), 1000))
    target = await db.users.find_one(
        {"user_id": target_user_id},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    rows = await db.books.find(
        {"user_id": target_user_id},
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "size_bytes": 1, "created_at": 1,
        },
    ).sort("size_bytes", -1).limit(limit).to_list(length=limit)
    # Normalize created_at to ISO string for the FE.
    for r in rows:
        ts = r.get("created_at")
        if isinstance(ts, datetime):
            r["created_at"] = ts.isoformat()
    total_books = await db.books.count_documents({"user_id": target_user_id})
    return {
        "user": target,
        "books": rows,
        "showing": len(rows),
        "total_books": total_books,
    }


# ---------------------------------------------------------------------------
# Storage trend (2026-06-15) — 30-day chart
# ---------------------------------------------------------------------------
# No snapshot cron yet (would need infrastructure to run daily) — the
# Year-1 implementation is **retroactive**: for each of the last N days,
# sum ``size_bytes`` of every book whose ``created_at <= that day``.
# That's a cheap aggregate against the books collection and produces a
# perfectly accurate cumulative-storage curve from existing data, so the
# chart works on day 1 instead of requiring 30 days of snapshots to build
# up. We persist a snapshot row per-call to ``storage_snapshots`` as a
# future-friendly side effect (the next round's cron will read this).

@api_router.get("/admin/storage-trend")
async def storage_trend(
    days: int = 30,
    user: User = Depends(require_admin),
):
    """Cumulative ``size_bytes`` over the last ``days`` days. Each point
    is the total bytes of all books whose ``created_at`` is on or before
    that day-end (UTC). The series is monotonically non-decreasing
    because we don't delete book rows on user deletion — we soft-tomb
    them via the trash shelf — so deletions don't show up as dips."""
    days = max(1, min(int(days), 90))
    now = datetime.now(timezone.utc)
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    # Get ALL (created_at, size_bytes) tuples once, sort, then walk
    # day-by-day from the oldest. Far cheaper than N aggregate queries.
    rows = await db.books.find(
        {"size_bytes": {"$gt": 0}},
        {"_id": 0, "created_at": 1, "size_bytes": 1},
    ).to_list(length=200000)

    # Normalize each created_at to a UTC datetime.
    normalized: list[tuple[datetime, int]] = []
    for r in rows:
        ts = r.get("created_at")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts)
            except ValueError:
                continue
        if not isinstance(ts, datetime):
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        normalized.append((ts, int(r.get("size_bytes") or 0)))
    normalized.sort(key=lambda x: x[0])

    # For each day in the window, compute cumulative bytes up to that
    # day's end. Walk both pointers in lock-step (O(books + days)).
    points = []
    running_total = 0
    running_count = 0
    idx = 0
    n = len(normalized)
    for i in range(days, -1, -1):  # oldest → newest
        cutoff = today - timedelta(days=i) + timedelta(days=1)  # day-end
        while idx < n and normalized[idx][0] < cutoff:
            running_total += normalized[idx][1]
            running_count += 1
            idx += 1
        points.append({
            "date": (cutoff - timedelta(days=1)).date().isoformat(),
            "total_bytes": running_total,
            "book_count": running_count,
        })

    # Best-effort snapshot persist for future cron to consume.
    try:
        await db.storage_snapshots.update_one(
            {"date": points[-1]["date"]},
            {"$set": {
                "date": points[-1]["date"],
                "total_bytes": points[-1]["total_bytes"],
                "book_count": points[-1]["book_count"],
                "snapshotted_at": datetime.now(timezone.utc),
                "source": "lazy",  # vs. "cron" once we wire that up
            }},
            upsert=True,
        )
    except Exception:
        pass  # non-critical

    return {
        "days": days,
        "points": points,
        "latest": points[-1] if points else None,
        # Growth-rate hint: total over the window vs. starting total.
        "growth_bytes": (points[-1]["total_bytes"] - points[0]["total_bytes"]) if len(points) > 1 else 0,
    }








# ---------------------------------------------------------------------------
# Maintenance banner
# ---------------------------------------------------------------------------

class MaintenanceBannerBody(BaseModel):
    enabled: bool
    message: str = Field(default="", max_length=240)
    severity: str = Field(default="info", pattern="^(info|warn|error)$")


@api_router.get("/maintenance-banner")
async def get_maintenance_banner_public():
    """Public read — no auth. The frontend polls this on every navigation
    to decide whether to show the global banner. Returns `null` when off.
    """
    doc = await db.maintenance_banner.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc or not doc.get("enabled"):
        return None
    return {
        "message": doc.get("message", ""),
        "severity": doc.get("severity", "info"),
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else None,
    }


@api_router.get("/admin/maintenance-banner")
async def admin_get_maintenance_banner(user: User = Depends(require_admin)):
    doc = await db.maintenance_banner.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {
        "enabled": bool(doc.get("enabled")),
        "message": doc.get("message", ""),
        "severity": doc.get("severity", "info"),
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else None,
    }


@api_router.put("/admin/maintenance-banner")
async def admin_set_maintenance_banner(body: MaintenanceBannerBody, user: User = Depends(require_admin)):
    payload = {
        "enabled": body.enabled,
        "message": body.message.strip(),
        "severity": body.severity,
        "updated_at": datetime.now(timezone.utc),
    }
    await db.maintenance_banner.update_one({"_id": "singleton"}, {"$set": payload}, upsert=True)
    await record_admin_action(user, "maintenance.banner", metadata={
        "enabled": body.enabled, "severity": body.severity, "len": len(body.message),
    })
    return {**payload, "updated_at": payload["updated_at"].isoformat()}


# ---------------------------------------------------------------------------
# System health
# ---------------------------------------------------------------------------

@api_router.get("/admin/system-health")
async def system_health(user: User = Depends(require_admin)):
    """One-shot health snapshot. Each check is independent — failures show
    up as `false`/error strings rather than crashing the response."""
    out: Dict[str, Any] = {}

    # Calibre (ebook-convert binary on PATH)
    out["calibre"] = {
        "ok": shutil.which("ebook-convert") is not None,
        "path": shutil.which("ebook-convert") or "",
    }

    # Resend (email)
    out["resend"] = {"configured": bool(RESEND_API_KEY)}

    # Emergent LLM key
    out["llm"] = {"configured": bool(EMERGENT_LLM_KEY)}

    # Digest scheduler — module exposes `_scheduler` after start_digest_scheduler()
    try:
        from routes import digest as digest_mod
        sched = getattr(digest_mod, "_scheduler", None)
        out["digest_scheduler"] = {"running": bool(sched and sched.running)}
    except Exception as e:  # noqa: BLE001
        out["digest_scheduler"] = {"running": False, "error": str(e)[:200]}

    # Mongo collection sizes (best-effort; counts are O(n) on some configs).
    collections = ["users", "user_sessions", "books", "categories", "smart_shelves",
                   "unknown_sources", "announcements", "feature_flags", "admin_audit"]
    coll_stats: Dict[str, int] = {}
    for c in collections:
        try:
            coll_stats[c] = await db[c].estimated_document_count()
        except Exception as e:  # noqa: BLE001
            logger.warning("collection count failed for %s: %s", c, e)
            coll_stats[c] = -1
    out["collections"] = coll_stats

    # Storage on disk
    try:
        total, used, free = shutil.disk_usage(STORAGE_DIR)
        out["storage"] = {
            "path": str(STORAGE_DIR),
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
        }
    except Exception as e:  # noqa: BLE001
        out["storage"] = {"error": str(e)[:200]}

    return out


# ---------------------------------------------------------------------------
# Global fandom aliases
# ---------------------------------------------------------------------------

class GlobalFandomAliasBody(BaseModel):
    aliases: Dict[str, str]


@api_router.get("/admin/global-fandom-aliases")
async def get_global_fandom_aliases(user: User = Depends(require_admin)):
    doc = await db.global_fandom_aliases.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {"aliases": doc.get("aliases", {})}


# Read-only helper for the classifier — callable from books.py without
# going through HTTP. Caches in-process for 30s.
_aliases_cache: Dict[str, str] = {}
_aliases_cache_ts: float = 0.0


async def get_global_fandom_aliases_dict() -> Dict[str, str]:
    """Return the effective global alias map. Cached for 30s. Falls back
    to an empty dict on read errors so the classifier never crashes."""
    import time as _t
    global _aliases_cache, _aliases_cache_ts
    if _aliases_cache and _t.monotonic() - _aliases_cache_ts < 30:
        return dict(_aliases_cache)
    try:
        doc = await db.global_fandom_aliases.find_one({"_id": "singleton"}, {"_id": 0}) or {}
        _aliases_cache = doc.get("aliases", {}) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning("global fandom aliases read failed: %s", e)
        _aliases_cache = {}
    _aliases_cache_ts = _t.monotonic()
    return dict(_aliases_cache)


@api_router.put("/admin/global-fandom-aliases")
async def set_global_fandom_aliases(body: GlobalFandomAliasBody, user: User = Depends(require_admin)):
    cleaned: Dict[str, str] = {}
    for k, v in (body.aliases or {}).items():
        ks = (k or "").strip()
        vs = (v or "").strip()
        if not ks or not vs or ks.lower() == vs.lower():
            continue
        cleaned[ks] = vs
    await db.global_fandom_aliases.update_one(
        {"_id": "singleton"},
        {"$set": {"aliases": cleaned, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Invalidate cache so next classification picks up the change.
    global _aliases_cache, _aliases_cache_ts
    _aliases_cache = {}
    _aliases_cache_ts = 0.0
    await record_admin_action(user, "fandom_aliases.global", metadata={"count": len(cleaned)})
    return {"aliases": cleaned}


# ---------------------------------------------------------------------------
# Global stats
# ---------------------------------------------------------------------------

@api_router.get("/admin/global-stats")
async def global_stats(user: User = Depends(require_admin)):
    """Tenant-wide rollup. Light aggregations only — no per-book scan."""
    user_count = await db.users.count_documents({})
    book_count = await db.books.count_documents({})
    admin_count = await db.users.count_documents({"is_admin": True})

    # Signups in last 7d / 30d (string ISO comparison works because we
    # store created_at as ISO 8601).
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()
    signups_7d = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    signups_30d = await db.users.count_documents({"created_at": {"$gte": month_ago}})

    # Top 10 fandoms across all libraries.
    top_fandoms = []
    pipeline = [
        {"$match": {"fandom": {"$ne": None, "$nin": ["", None]}}},
        {"$group": {"_id": "$fandom", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    async for r in db.books.aggregate(pipeline):
        top_fandoms.append({"fandom": r["_id"], "count": r["n"]})

    # Category split
    categories: Dict[str, int] = {}
    async for r in db.books.aggregate([{"$group": {"_id": "$category", "n": {"$sum": 1}}}]):
        categories[r["_id"] or "Uncategorized"] = r["n"]

    # Storage used on disk (sum of sizes in books collection).
    storage_pipeline = [{"$group": {"_id": None, "bytes": {"$sum": "$size_bytes"}}}]
    storage_doc = await db.books.aggregate(storage_pipeline).to_list(length=1)
    total_bytes = storage_doc[0]["bytes"] if storage_doc else 0

    return {
        "users": user_count,
        "admins": admin_count,
        "books": book_count,
        "signups_7d": signups_7d,
        "signups_30d": signups_30d,
        "top_fandoms": top_fandoms,
        "categories": categories,
        "total_storage_bytes": int(total_bytes or 0),
    }


# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------

class FeatureFlagBody(BaseModel):
    flag: str
    enabled: bool


@api_router.get("/admin/feature-flags")
async def list_feature_flags(user: User = Depends(require_admin)):
    return {
        "flags": await get_flags(),
        "known": KNOWN_FLAGS,
    }


@api_router.put("/admin/feature-flags")
async def set_feature_flag(body: FeatureFlagBody, user: User = Depends(require_admin)):
    try:
        flags = await set_flag(body.flag, body.enabled)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await record_admin_action(user, "feature_flag.set", target=body.flag, metadata={"enabled": body.enabled})
    return {"flags": flags, "known": KNOWN_FLAGS}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@api_router.get("/admin/audit-log")
async def get_audit_log(
    limit: int = 100,
    action_prefix: Optional[str] = None,
    user: User = Depends(require_admin),
):
    """Return the most recent audit entries (newest first). Use
    `?action_prefix=user.` to filter by action group. Capped at 500.
    """
    limit = max(1, min(int(limit), 500))
    query: Dict[str, Any] = {}
    if action_prefix:
        query["action"] = {"$regex": f"^{action_prefix}"}
    cursor = db.admin_audit.find(query, {"_id": 0}).sort("ts", -1).limit(limit)
    rows = await cursor.to_list(length=limit)
    for r in rows:
        ts = r.get("ts")
        if isinstance(ts, datetime):
            r["ts"] = ts.isoformat()
    return {"entries": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Moderation log (2026-06-17) — append-only history of every mod / approval
# / room-lock action ever taken on the platform.  Backed by the same
# ``admin_audit`` collection as the broader audit log, but scoped to the
# actions a moderator (or admin) can perform, with pagination so the UI
# can scroll the entire history rather than capping at 100.
# ---------------------------------------------------------------------------

# Action slugs that count as "moderation".  Kept as a single source of
# truth so the frontend filter pills and the backend query stay in sync.
# Order is intentional — most-likely-clicked filters first.
MODERATION_ACTION_SLUGS = [
    "user.approve",
    "user.reject",
    "bookclub.lock",
    "bookclub.unlock",
    "user.promote_mod",
    "user.demote_mod",
]


@api_router.get("/admin/moderation-log")
async def get_moderation_log(
    limit: int = 50,
    offset: int = 0,
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    user: User = Depends(require_moderator_or_admin),
):
    """Paginated, all-time history of moderator actions.

    Open to mods AND admins — mods need to see (at minimum) their own
    history.  Server-side pagination: ``offset`` + ``limit`` so the UI
    can scroll back to day-0 without us shipping megabytes per request.

    Query params:
        limit       1-200, default 50
        offset      ≥ 0, default 0
        actor_id    optional — show only actions by this user
        action      optional — exact match against ``MODERATION_ACTION_SLUGS``

    Returns:
        {
          "entries": [...],
          "count":   total number of matching rows (for pagination UI),
          "limit":   echoed back,
          "offset":  echoed back,
        }
    """
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))
    query: Dict[str, Any] = {"action": {"$in": MODERATION_ACTION_SLUGS}}
    if actor_id:
        query["actor_id"] = actor_id
    if action:
        if action not in MODERATION_ACTION_SLUGS:
            raise HTTPException(status_code=400, detail=f"Unknown moderation action: {action}")
        query["action"] = action  # narrow from the $in to a single value
    total = await db.admin_audit.count_documents(query)
    cursor = (
        db.admin_audit.find(query, {"_id": 0})
        .sort("ts", -1)
        .skip(offset)
        .limit(limit)
    )
    rows = await cursor.to_list(length=limit)
    # Hydrate target identifiers so the UI doesn't render a wall of
    # opaque uuids.  Two passes: collect user/room ids referenced by the
    # rows, fetch their display names in one round-trip each.
    user_targets = [r["target"] for r in rows
                    if r.get("target") and r["action"].startswith("user.")]
    room_targets = [r["target"] for r in rows
                    if r.get("target") and r["action"].startswith("bookclub.")]
    user_names: Dict[str, str] = {}
    room_names: Dict[str, str] = {}
    if user_targets:
        ucur = db.users.find(
            {"user_id": {"$in": user_targets}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        )
        async for u in ucur:
            user_names[u["user_id"]] = u.get("name") or u.get("email") or u["user_id"]
    if room_targets:
        rcur = db.bookclubs.find(
            {"room_id": {"$in": room_targets}},
            {"_id": 0, "room_id": 1, "name": 1},
        )
        async for r in rcur:
            room_names[r["room_id"]] = r.get("name") or r["room_id"]
    for r in rows:
        ts = r.get("ts")
        if isinstance(ts, datetime):
            r["ts"] = ts.isoformat()
        tgt = r.get("target")
        if tgt:
            if r["action"].startswith("user.") and tgt in user_names:
                r["target_display"] = user_names[tgt]
            elif r["action"].startswith("bookclub.") and tgt in room_names:
                r["target_display"] = room_names[tgt]
            else:
                # Fall back to the raw id — better than nothing for a
                # since-deleted user / room.
                r["target_display"] = tgt
    return {
        "entries": rows,
        "count": total,
        "limit": limit,
        "offset": offset,
    }




# ---------------------------------------------------------------------------
# Unknown fandoms — fandoms in `books` that aren't in the keyword classifier
# ---------------------------------------------------------------------------

def _known_fandoms() -> set:
    """Lazy import so this module doesn't pull in the giant books.py at
    server startup time. `FANDOM_KEYWORDS` already includes the merged
    AO3 seed list."""
    from routes.books import FANDOM_KEYWORDS
    return set(FANDOM_KEYWORDS.keys())


@api_router.get("/admin/unknown-fandoms")
async def get_unknown_fandoms(user: User = Depends(require_admin)):
    """Return any fandom currently present in the books collection that
    doesn't match a key in the keyword classifier. Dismissed entries are
    returned in a separate `dismissed` array so the UI can still offer
    "Rescan" / "Un-dismiss" actions on them."""
    from utils.unknown_fandoms import list_unknown_fandoms
    rows = await list_unknown_fandoms(_known_fandoms())
    # Also pull dismissed entries (with their current book counts) so the
    # admin can re-run rescan on previously-dismissed fandoms.
    dismissed_docs = await db.dismissed_unknown_fandoms.find({}, {"_id": 0}).to_list(length=200)
    dismissed_names = [d["fandom"] for d in dismissed_docs]
    dismissed_rows: List[Dict[str, Any]] = []
    if dismissed_names:
        pipeline = [
            {"$match": {"fandom": {"$in": dismissed_names}}},
            {"$group": {"_id": "$fandom", "n": {"$sum": 1}, "samples": {"$push": "$book_id"}}},
            {"$sort": {"n": -1}},
        ]
        async for r in db.books.aggregate(pipeline):
            dismissed_rows.append({
                "fandom": r["_id"],
                "count": r["n"],
                "sample_book_ids": (r.get("samples") or [])[:5],
            })
    return {"unknown": rows, "count": len(rows), "dismissed": dismissed_rows}


@api_router.get("/admin/unknown-fandoms/count")
async def get_unknown_fandoms_count(user: User = Depends(require_admin)):
    """Lightweight count for the navbar badge. Cached server-side for 60s."""
    from utils.unknown_fandoms import count_unknown_fandoms
    return {"count": await count_unknown_fandoms(_known_fandoms())}


@api_router.post("/admin/unknown-fandoms/{fandom}/dismiss")
async def dismiss_unknown_fandom(fandom: str, user: User = Depends(require_admin)):
    """Permanently hide a fandom from the unknown list (use for "Other",
    "Original Work", etc.). Idempotent."""
    await db.dismissed_unknown_fandoms.update_one(
        {"fandom": fandom},
        {"$set": {"fandom": fandom, "dismissed_at": datetime.now(timezone.utc), "by": user.user_id}},
        upsert=True,
    )
    from utils.unknown_fandoms import invalidate_count_cache
    invalidate_count_cache()
    await record_admin_action(user, "unknown_fandom.dismiss", target=fandom)
    return {"ok": True, "fandom": fandom}


@api_router.delete("/admin/unknown-fandoms/{fandom}/dismiss")
async def undismiss_unknown_fandom(fandom: str, user: User = Depends(require_admin)):
    """Un-dismiss — surface this fandom again in the unknown list."""
    res = await db.dismissed_unknown_fandoms.delete_one({"fandom": fandom})
    from utils.unknown_fandoms import invalidate_count_cache
    invalidate_count_cache()
    if res.deleted_count:
        await record_admin_action(user, "unknown_fandom.undismiss", target=fandom)
    return {"ok": True, "fandom": fandom, "removed": res.deleted_count}


class RescanBody(BaseModel):
    dry_run: bool = False


@api_router.post("/admin/unknown-fandoms/{fandom}/rescan")
async def rescan_unknown_fandom(
    fandom: str,
    body: RescanBody,
    user: User = Depends(require_admin),
):
    """Re-run `classify_by_metadata` against every book currently tagged
    with `fandom`. If the classifier now matches a real fandom (because
    the keyword set grew, or aliases improved), update the book. Uses
    only stored metadata — no EPUB re-parse, no AI call.

    Returns a summary + up to 10 sample reclassifications. `dry_run=true`
    skips the writes so the operator can preview impact first.
    """
    from routes.books import classify_by_metadata, FANDOM_KEYWORDS

    cursor = db.books.find(
        {"fandom": fandom},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "description": 1, "publisher": 1, "category": 1, "user_id": 1},
    )
    scanned = 0
    reclassified = 0
    samples: List[Dict[str, Any]] = []
    async for book in cursor:
        scanned += 1
        meta = {
            "title": book.get("title", "") or "",
            "author": book.get("author", "") or "",
            "description": book.get("description", "") or "",
            "publisher": book.get("publisher", "") or "",
            "sample_text": "",
        }
        result = classify_by_metadata(meta)
        new_fandom = result.get("fandom")
        # Only act if the new fandom is real (in the keyword set) AND
        # different from the current one. Skip "Other" → "Other", or
        # "Other" → None which would just clear the tag.
        if not new_fandom or new_fandom == fandom or new_fandom not in FANDOM_KEYWORDS:
            continue
        reclassified += 1
        if len(samples) < 10:
            samples.append({
                "book_id": book["book_id"],
                "title": book.get("title", ""),
                "old_fandom": fandom,
                "new_fandom": new_fandom,
            })
        if not body.dry_run:
            await db.books.update_one(
                {"book_id": book["book_id"]},
                {"$set": {
                    "fandom": new_fandom,
                    "category": result.get("category") or book.get("category"),
                    "classifier": "metadata_rescan",
                }},
            )
    if not body.dry_run:
        from utils.unknown_fandoms import invalidate_count_cache
        invalidate_count_cache()
        await record_admin_action(
            user,
            "unknown_fandom.rescan",
            target=fandom,
            metadata={"scanned": scanned, "reclassified": reclassified},
        )
    return {
        "scanned": scanned,
        "reclassified": reclassified,
        "samples": samples,
        "dry_run": body.dry_run,
    }


# ---------------------------------------------------------------------------
# Operator email diagnostic
# ---------------------------------------------------------------------------

class AdminEmailTestBody(BaseModel):
    target_user_id: Optional[str] = None
    target_email: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=200)


@api_router.post("/admin/email-test")
async def admin_email_test(
    body: AdminEmailTestBody,
    user: User = Depends(require_admin),
):
    """Operator-only: send a diagnostic email to a chosen user / arbitrary address.

    Resolution order:
      1. If `target_user_id` given → look up that user, send to their email.
      2. Else if `target_email` given → send directly to that address.
      3. Else → send to the calling admin.

    Note: while Resend is in sandbox mode (no verified domain), Resend will
    reject any recipient that is not the account-registered address. That
    rejection bubbles back as 502 so the operator sees exactly why delivery
    didn't happen.
    """
    target_email: str = ""
    target_user_id: Optional[str] = None
    target_name = ""

    if body.target_user_id:
        target = await db.users.find_one(
            {"user_id": body.target_user_id},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="Target user not found")
        target_email = target.get("email", "")
        target_user_id = target.get("user_id")
        target_name = target.get("name") or target_email.split("@")[0]
    elif body.target_email:
        target_email = body.target_email.strip().lower()
        target_name = target_email.split("@")[0]
    else:
        target_email = user.email
        target_user_id = user.user_id
        target_name = user.name or target_email.split("@")[0]

    if not target_email:
        raise HTTPException(status_code=400, detail="No target email resolved")

    if not RESEND_API_KEY:
        logger.warning("Admin email-test: RESEND_API_KEY unset — would have sent to %s", target_email)
        await record_admin_action(
            user, "email.test",
            target=target_user_id or target_email,
            metadata={"to": target_email, "delivered": False, "logged": True},
        )
        return {"delivered": False, "logged": True, "to": target_email}

    note_html = ""
    if body.note:
        safe = body.note.replace("<", "&lt;").replace(">", "&gt;")
        note_html = (
            '<p style="color:#4A4A4A;line-height:1.6;font-size:14px;'
            'margin:20px 0 0;padding:14px 16px;background:#FDF3E1;'
            'border-left:3px solid #B87A00;border-radius:6px;">'
            f'<strong>Note from operator:</strong> {safe}</p>'
        )

    subject = "Shelfsort — operator diagnostic email"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #FBF7EE; border-radius: 12px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #FBE8E0; border: 1px solid rgba(208,90,60,0.4); border-radius: 999px; margin-bottom: 16px; font-size: 12px; font-weight: 600; color: #B43F26; letter-spacing: 0.5px;">
        ★ OPERATOR DIAGNOSTIC
      </div>
      <h1 style="color: #2C2C2C; margin: 0 0 12px; font-size: 22px; font-family: Georgia, serif;">Hi {target_name},</h1>
      <p style="color: #4A4A4A; line-height: 1.6; font-size: 15px; margin: 0;">
        A Shelfsort operator sent this diagnostic message to confirm that email
        delivery to <strong>{target_email}</strong> is working. If you weren't
        expecting it, you can safely ignore it — no action is needed.
      </p>
      {note_html}
      <p style="color: #6B705C; font-size: 12px; margin: 28px 0 0; padding-top: 16px; border-top: 1px solid #E8E6E1;">
        Sent by an admin from the Shelfsort Admin Console.
      </p>
    </div>
    """
    text = (
        f"Hi {target_name},\n\nThis is an operator diagnostic email confirming that "
        f"Shelfsort can deliver mail to {target_email}. No action needed.\n"
        f"{('Note: ' + body.note) if body.note else ''}\n\n— Shelfsort Admin Console"
    )

    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [target_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("admin_test", target_email, "ok", resend_id=result.get("id"))
        await record_admin_action(
            user, "email.test",
            target=target_user_id or target_email,
            metadata={"to": target_email, "delivered": True, "id": result.get("id")},
        )
        return {"delivered": True, "id": result.get("id"), "to": target_email}
    except Exception as e:  # noqa: BLE001
        logger.error("Admin email-test Resend send failed for %s: %s", target_email, e)
        await log_email_send("admin_test", target_email, "error", error=str(e))
        await record_admin_action(
            user, "email.test",
            target=target_user_id or target_email,
            metadata={"to": target_email, "delivered": False, "error": str(e)[:300]},
        )
        raise HTTPException(status_code=502, detail=f"Resend rejected the send: {e}")



# ---------------------------------------------------------------------------
# Cron health — surfaces last-run telemetry for every scheduled job so
# silent failures never go undetected again.
# ---------------------------------------------------------------------------

# These are the jobs we expect to exist. Each entry says how often the job
# is expected to fire so the frontend can render a "stale" badge if the
# last run is suspiciously old.
KNOWN_CRON_JOBS: List[Dict[str, Any]] = [
    {
        "id": "weekly_digest_tick",
        "label": "Weekly digest + auto-tick (hourly check)",
        "schedule": "every hour at :00 UTC",
        "expected_max_gap_hours": 2,
    },
    {
        "id": "account_grace_tick",
        "label": "Account grace-period sweep (deletion + 7-day reminder)",
        "schedule": "daily at 03:17 UTC",
        "expected_max_gap_hours": 26,
    },
]


@api_router.get("/admin/cron-health")
async def get_cron_health(user: User = Depends(require_admin)):
    """Return last-run telemetry for every known scheduled job.

    For each job we return:
      • `last_run` — the most recent row from `db.cron_runs`
      • `last_ok` — the most recent successful run (so an error doesn't
        hide the last-known-good timestamp)
      • `runs_24h`, `errors_24h`, `error_rate_24h` — rolling counters
      • `stale` — True if `last_run.started_at` is older than the
        expected schedule cadence (so the dashboard can flag it red)
      • `recent` — the last 20 runs (started_at, status, duration_ms,
        error) so the admin can scroll through history
    """
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    out: List[Dict[str, Any]] = []
    for job in KNOWN_CRON_JOBS:
        jid = job["id"]
        last_run = await db.cron_runs.find_one(
            {"job_id": jid},
            sort=[("started_at", -1)],
        )
        last_ok = await db.cron_runs.find_one(
            {"job_id": jid, "status": "ok"},
            sort=[("started_at", -1)],
        )
        window_start = now - _td(hours=24)
        runs_24h = await db.cron_runs.count_documents(
            {"job_id": jid, "started_at": {"$gte": window_start}}
        )
        errors_24h = await db.cron_runs.count_documents(
            {"job_id": jid, "status": "error", "started_at": {"$gte": window_start}}
        )
        recent_cursor = (
            db.cron_runs.find({"job_id": jid})
            .sort("started_at", -1)
            .limit(20)
        )
        recent = []
        async for r in recent_cursor:
            started = r.get("started_at") or now
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            recent.append({
                "started_at": started.isoformat(),
                "duration_ms": r.get("duration_ms"),
                "status": r.get("status"),
                "error": r.get("error"),
            })

        # "Stale" = last run is older than the expected cadence.
        stale = True
        if last_run and last_run.get("started_at"):
            started = last_run["started_at"]
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            gap_hours = (now - started).total_seconds() / 3600
            stale = gap_hours > job["expected_max_gap_hours"]

        def _iso(dt):
            if dt is None:
                return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()

        out.append({
            **job,
            "last_run": (
                {
                    "started_at": _iso(last_run["started_at"]),
                    "duration_ms": last_run.get("duration_ms"),
                    "status": last_run.get("status"),
                    "error": last_run.get("error"),
                }
                if last_run else None
            ),
            "last_ok_at": (
                _iso(last_ok["started_at"]) if last_ok else None
            ),
            "runs_24h": runs_24h,
            "errors_24h": errors_24h,
            "error_rate_24h": (
                round(errors_24h / runs_24h, 3) if runs_24h else 0.0
            ),
            "stale": stale,
            "recent": recent,
        })
    return {"jobs": out, "checked_at": now.isoformat()}



# ---------------------------------------------------------------------------
# Route catalogue — lists every registered API route grouped by source
# module. Useful for "where does this URL live?" audits, especially
# while books.py is mid-refactor across many new modules.
# ---------------------------------------------------------------------------


@api_router.get("/admin/routes")
async def list_registered_routes(
    user: User = Depends(require_admin),
    stale_days: int = 90,
):
    """Return every registered ``/api/*`` route grouped by source file.

    For each route we expose: path, HTTP methods, endpoint function name,
    docstring summary (first line only), the module it lives in, and the
    timestamp of the module file's last `git` commit. Routes whose source
    module hasn't been touched in ``stale_days`` are flagged ``is_stale``
    so admins can spot forgotten dead code in one glance.

    The frontend widget renders this as a collapsible per-module list so
    you can answer "where the heck does this URL live?" in one click.
    """
    from fastapi.routing import APIRoute
    from deps import app  # FastAPI singleton
    from datetime import datetime, timezone, timedelta
    import asyncio
    import os.path
    import subprocess

    # Resolve repo root once. Walks up from this file until a ``.git`` dir
    # is found (or hits the filesystem root).
    repo_root = os.path.dirname(os.path.abspath(__file__))
    while repo_root != "/" and not os.path.isdir(os.path.join(repo_root, ".git")):
        repo_root = os.path.dirname(repo_root)

    # Cache: module file -> last-commit unix timestamp (or None if not in git).
    git_cache: Dict[str, Optional[int]] = {}

    def _module_file(mod_name: str) -> Optional[str]:
        try:
            mod = __import__(mod_name, fromlist=["_"])
            return getattr(mod, "__file__", None)
        except Exception:
            return None

    async def _last_commit_ts(file_path: str) -> Optional[int]:
        if file_path in git_cache:
            return git_cache[file_path]
        if not os.path.isdir(os.path.join(repo_root, ".git")):
            git_cache[file_path] = None
            return None
        try:
            # ``%ct`` = committer date, unix epoch. -1 = newest commit only.
            proc = await asyncio.to_thread(
                subprocess.run,
                ["git", "log", "-1", "--format=%ct", "--", file_path],
                cwd=repo_root,
                capture_output=True,
                text=True,
                timeout=2,
            )
            out = (proc.stdout or "").strip()
            ts = int(out) if out.isdigit() else None
        except Exception:
            ts = None
        git_cache[file_path] = ts
        return ts

    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(days=stale_days)

    groups: Dict[str, List[Dict[str, Any]]] = {}
    module_files: Dict[str, Optional[str]] = {}
    total = 0
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if not r.path.startswith("/api"):
            continue
        ep = r.endpoint
        mod = getattr(ep, "__module__", "?")
        doc = (ep.__doc__ or "").strip()
        first_line = doc.splitlines()[0].strip() if doc else ""
        if mod not in module_files:
            module_files[mod] = _module_file(mod)
        groups.setdefault(mod, []).append({
            "path": r.path,
            "methods": sorted(m for m in (r.methods or []) if m != "HEAD"),
            "name": ep.__name__,
            "doc": first_line[:140],
        })
        total += 1

    # Resolve last-commit timestamps for the small number of unique modules.
    last_ts_per_mod: Dict[str, Optional[int]] = {}
    for mod, mf in module_files.items():
        last_ts_per_mod[mod] = await _last_commit_ts(mf) if mf else None

    sorted_groups = []
    stale_total = 0
    for mod in sorted(groups):
        ts = last_ts_per_mod.get(mod)
        last_modified_iso = (
            datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None
        )
        is_stale = bool(ts and ts < stale_cutoff.timestamp())
        if is_stale:
            stale_total += len(groups[mod])
        rows = sorted(groups[mod], key=lambda x: x["path"])
        sorted_groups.append({
            "module": mod,
            "count": len(rows),
            "routes": rows,
            "last_modified": last_modified_iso,
            "is_stale": is_stale,
        })
    return {
        "total": total,
        "stale_total": stale_total,
        "stale_days": stale_days,
        "modules": sorted_groups,
    }



# ---------------------------------------------------------------------------
# A2 — GET /api/admin/email-stats  (Resend deliveries this week stat card)
# ---------------------------------------------------------------------------

@api_router.get("/admin/email-stats")
async def get_email_stats(user: User = Depends(require_admin)):
    """Resend deliveries telemetry for the admin dashboard card.

    Pulls from ``db.email_logs`` (populated by ``utils.email_log.log_email_send``).
    Returns:
      • ``total_7d`` / ``ok_7d`` / ``error_7d`` — rolling 7-day counters.
      • ``error_rate_7d`` — ratio 0..1.
      • ``by_kind`` — per-template breakdown for the last 7 days.
      • ``recent_failures`` — last 10 failures with kind + to + error.
      • ``last_send_at`` — most recent send (any status).
    """
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    window_start = now - _td(days=7)

    total_7d = await db.email_logs.count_documents({"sent_at": {"$gte": window_start}})
    ok_7d = await db.email_logs.count_documents(
        {"sent_at": {"$gte": window_start}, "status": "ok"}
    )
    error_7d = await db.email_logs.count_documents(
        {"sent_at": {"$gte": window_start}, "status": "error"}
    )

    # Group by kind for the per-template breakdown.
    by_kind_pipeline = [
        {"$match": {"sent_at": {"$gte": window_start}}},
        {"$group": {
            "_id": "$kind",
            "total": {"$sum": 1},
            "ok": {"$sum": {"$cond": [{"$eq": ["$status", "ok"]}, 1, 0]}},
            "error": {"$sum": {"$cond": [{"$eq": ["$status", "error"]}, 1, 0]}},
        }},
        {"$sort": {"total": -1}},
    ]
    by_kind_rows = await db.email_logs.aggregate(by_kind_pipeline).to_list(50)
    by_kind = [
        {"kind": r["_id"] or "?", "total": r["total"], "ok": r["ok"], "error": r["error"]}
        for r in by_kind_rows
    ]

    # Last 10 failures for debugging.
    fail_cursor = (
        db.email_logs.find(
            {"status": "error"},
            {"_id": 0, "sent_at": 1, "kind": 1, "to": 1, "error": 1},
        )
        .sort("sent_at", -1)
        .limit(10)
    )
    recent_failures = []
    async for r in fail_cursor:
        ts = r.get("sent_at")
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        recent_failures.append({
            "sent_at": ts.isoformat() if ts else None,
            "kind": r.get("kind"),
            "to": r.get("to"),
            "error": (r.get("error") or "")[:200],
        })

    last = await db.email_logs.find_one({}, sort=[("sent_at", -1)])
    last_ts = (last or {}).get("sent_at")
    if last_ts and last_ts.tzinfo is None:
        last_ts = last_ts.replace(tzinfo=timezone.utc)

    # Resend quota counters.  Limits are env-driven so an upgrade just
    # bumps the numbers in /app/backend/.env — no code change needed.
    # Defaults match Resend's free plan (100/day, 3000/month).  We only
    # count ``status == "ok"`` rows because failed sends don't draw down
    # the quota on Resend's side either.
    day_start = now - _td(days=1)
    month_start = now - _td(days=30)
    used_today = await db.email_logs.count_documents(
        {"sent_at": {"$gte": day_start}, "status": "ok"}
    )
    used_month = await db.email_logs.count_documents(
        {"sent_at": {"$gte": month_start}, "status": "ok"}
    )
    daily_limit   = int(os.environ.get("RESEND_DAILY_LIMIT",   "100"))
    monthly_limit = int(os.environ.get("RESEND_MONTHLY_LIMIT", "3000"))

    return {
        "window_days": 7,
        "total_7d": total_7d,
        "ok_7d": ok_7d,
        "error_7d": error_7d,
        "error_rate_7d": round(error_7d / total_7d, 3) if total_7d else 0.0,
        "by_kind": by_kind,
        "recent_failures": recent_failures,
        "last_send_at": last_ts.isoformat() if last_ts else None,
        "quota": {
            "used_today":      used_today,
            "used_month":      used_month,
            "daily_limit":     daily_limit,
            "monthly_limit":   monthly_limit,
            "daily_remaining": max(0, daily_limit - used_today),
            "monthly_remaining": max(0, monthly_limit - used_month),
        },
    }



# ---------------------------------------------------------------------------
# A3 — GET /api/admin/alert-health  (Cron-alert-failure banner)
# ---------------------------------------------------------------------------
# The cron-failure-alert path is best-effort: ``_maybe_alert_admins`` in
# ``utils.cron_health`` swallows ``RuntimeError``s from Mongo, missing
# Resend keys, and Resend 4xx/5xx responses so a flaky alerting pipeline
# can't *itself* crash the cron wrapper. That's the right call in prod,
# but it also means silent drop-outs go un-noticed until a human happens
# to read backend logs.
#
# This endpoint surfaces those failures in two ways for the AdminConsole
# top-of-page banner:
#   • ``alert_send_failures_24h`` — count of ``email_logs`` rows where
#     ``kind == "cron_failure_alert"`` AND ``status == "error"`` AND
#     ``sent_at >= now - 24h``. The banner shows a red strip if ≥1.
#   • ``cron_failures_uncovered_24h`` — count of ``cron_runs`` failures
#     in the last 24h whose ``job_id`` does *not* appear in
#     ``cron_alerts`` (i.e. an alert was never sent at all — usually
#     because Resend wasn't configured, the feature flag was off, or no
#     admin user has an email set). Shows an amber strip if ≥1.
#   • ``latest_failure`` — the most recent of the two for the banner copy.

@api_router.get("/admin/alert-health")
async def get_alert_health(user: User = Depends(require_admin)):
    """Surfaces silent cron-alert pipeline failures for the AdminConsole banner.

    Two failure modes are tracked separately because they need different
    operator actions:
      1. *Send failed* — Resend returned an error or threw mid-send. Check
         the Resend dashboard / API key.
      2. *No alert ever sent* — the cron run errored but no row was ever
         written to ``cron_alerts``. Usually Resend isn't configured at
         all, the feature flag is off, or there are no admin users with
         emails — none of which are visible from a single log line.
    """
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc)
    window_start = now - _td(hours=24)

    # 1) Send failures inside the 24h window.
    send_failures_q = {
        "kind": "cron_failure_alert",
        "status": "error",
        "sent_at": {"$gte": window_start},
    }
    send_failure_count = await db.email_logs.count_documents(send_failures_q)
    latest_send_failure = await db.email_logs.find_one(
        send_failures_q, sort=[("sent_at", -1)]
    )

    # 2) Cron runs that errored in the last 24h with no matching alert
    #    row. We can't trust ``cron_alerts.last_sent_at`` >= the run's
    #    finished_at directly because the alert is debounced 60 min/job,
    #    so we instead check whether *any* alert row exists at all for
    #    the failing job_id — if not, the alert path never fired (or
    #    fired before the table existed, which is what we want to flag).
    #
    #    Pytest fixtures use ``job_id`` prefix ``test_job_err_`` — those
    #    rows are noise in the prod-facing banner and are filtered out.
    #    Rows in ``cron_alerts`` with ``suppressed=True`` also count as
    #    "covered" because the alerter ran, decided not to send (Resend
    #    missing, flag off, etc.), and recorded the decision.
    failing_runs_cursor = db.cron_runs.find(
        {
            "status": "error",
            "finished_at": {"$gte": window_start},
            "job_id": {"$not": {"$regex": "^test_job_"}},
        },
        {"_id": 0, "job_id": 1, "finished_at": 1, "error": 1},
    ).sort("finished_at", -1)
    uncovered: list[dict] = []
    seen_job_ids: set[str] = set()
    async for run in failing_runs_cursor:
        jid = run.get("job_id")
        if not jid or jid in seen_job_ids:
            continue
        seen_job_ids.add(jid)
        alert_row = await db.cron_alerts.find_one({"job_id": jid})
        if alert_row is None:
            ts = run.get("finished_at")
            if ts and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            uncovered.append({
                "job_id": jid,
                "finished_at": ts.isoformat() if ts else None,
                "error": (run.get("error") or "")[:200],
            })

    latest = None
    if latest_send_failure:
        ts = latest_send_failure.get("sent_at")
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        latest = {
            "kind": "send_failed",
            "job_id": (latest_send_failure.get("job_id")
                       or (latest_send_failure.get("extra") or {}).get("job_id")
                       or "unknown"),
            "at": ts.isoformat() if ts else None,
            "error": (latest_send_failure.get("error") or "")[:240],
        }
    elif uncovered:
        latest = {
            "kind": "no_alert_sent",
            "job_id": uncovered[0]["job_id"],
            "at": uncovered[0]["finished_at"],
            "error": uncovered[0]["error"],
        }

    return {
        "window_hours": 24,
        "alert_send_failures_24h": send_failure_count,
        "cron_failures_uncovered_24h": len(uncovered),
        "uncovered_job_ids": [u["job_id"] for u in uncovered][:5],
        "latest_failure": latest,
        # 2026-06-18 — Suppression-reason audit so the admin banner can
        # tell operators *why* alerts aren't going out (Resend missing,
        # feature flag off, etc.).  Aggregated from rows that
        # ``_maybe_alert_admins`` upserts with ``suppressed=True``.
        "suppressed_reasons": await _aggregate_suppression_reasons(window_start),
    }


async def _aggregate_suppression_reasons(window_start) -> list[dict]:
    """Group suppressed cron_alerts rows by reason for the admin banner."""
    pipeline = [
        {"$match": {
            "suppressed": True,
            "last_seen_at": {"$gte": window_start},
        }},
        {"$group": {
            "_id":   {"$ifNull": ["$reason", "unknown"]},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$project": {"_id": 0, "reason": "$_id", "count": 1}},
    ]
    rows = []
    async for r in db.cron_alerts.aggregate(pipeline):
        rows.append(r)
    return rows


# ---------------------------------------------------------------------------
# Oversight tray — bookclub rooms the platform owner is auto-watching
# ---------------------------------------------------------------------------
# The platform owner is auto-added to every bookclub as role "oversight". This
# endpoint lists those rooms with enough context for a "Rooms I'm watching"
# admin card: room name, owner, real member count, last-message-at, and the
# deep-link straight into the room.

@api_router.get("/admin/bookclubs/watching")
async def list_watched_bookclubs(user: User = Depends(require_admin)):
    """Return rooms where the *requesting admin* is a member with role
    ``oversight`` OR ``owner``. We let any admin call this — but unless they
    are the platform owner, they'll usually see an empty list."""
    rows = await db.bookclub_members.find(
        {"user_id": user.user_id, "role": {"$in": ["oversight", "owner"]}, "status": "active"},
        {"_id": 0, "room_id": 1, "role": 1},
    ).to_list(length=2000)
    if not rows:
        return {"rooms": [], "total": 0}

    room_ids = [r["room_id"] for r in rows]
    role_by_room = {r["room_id"]: r["role"] for r in rows}

    rooms = await db.bookclubs.find(
        {"room_id": {"$in": room_ids}}, {"_id": 0},
    ).to_list(length=2000)
    owner_ids = list({r.get("owner_user_id") for r in rooms if r.get("owner_user_id")})
    owners_meta = {}
    if owner_ids:
        owner_docs = await db.users.find(
            {"user_id": {"$in": owner_ids}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1},
        ).to_list(length=2000)
        owners_meta = {d["user_id"]: d for d in owner_docs}

    # Member-count agg (real members, excludes oversight) + last-message-at.
    count_agg = db.bookclub_members.aggregate([
        {"$match": {"room_id": {"$in": room_ids}, "status": "active", "role": {"$ne": "oversight"}}},
        {"$group": {"_id": "$room_id", "n": {"$sum": 1}}},
    ])
    member_counts: Dict[str, int] = {}
    async for row in count_agg:
        member_counts[row["_id"]] = int(row["n"])

    msg_agg = db.bookclub_messages.aggregate([
        {"$match": {"room_id": {"$in": room_ids}}},
        {"$group": {"_id": "$room_id", "last_at": {"$max": "$created_at"}, "total": {"$sum": 1}}},
    ])
    msg_meta: Dict[str, Dict[str, Any]] = {}
    async for row in msg_agg:
        msg_meta[row["_id"]] = {"last_at": row["last_at"], "total": int(row["total"])}

    out = []
    for r in rooms:
        room_id = r["room_id"]
        owner_uid = r.get("owner_user_id")
        owner = owners_meta.get(owner_uid, {}) if owner_uid else {}
        m = msg_meta.get(room_id, {})
        last_at = m.get("last_at")
        out.append({
            "room_id": room_id,
            "name": r.get("name", ""),
            "book_title": r.get("book_title", ""),
            "book_author": r.get("book_author", ""),
            "owner_user_id": owner_uid,
            "owner_name": owner.get("name") or owner.get("username") or owner.get("email") or "",
            "owner_email": owner.get("email", ""),
            "my_role": role_by_room.get(room_id, "oversight"),
            "member_count": member_counts.get(room_id, 0),
            "message_count": int(m.get("total", 0) or 0),
            "last_message_at": last_at.isoformat() if hasattr(last_at, "isoformat") else last_at,
            "created_at": (
                r.get("created_at").isoformat()
                if hasattr(r.get("created_at"), "isoformat") else r.get("created_at")
            ),
        })
    # Sort: rooms with recent activity first, then rooms with any messages,
    # then by creation date.
    out.sort(key=lambda x: (x.get("last_message_at") or x.get("created_at") or ""), reverse=True)
    return {"rooms": out, "total": len(out)}
