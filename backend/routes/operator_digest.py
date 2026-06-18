"""Weekly Operator Digest — Sunday rollup email for admin users.

Wraps the existing visitor-analytics `/api/analytics/summary` payload
into an email digest delivered every Sunday at 19:00 UTC (immediately
after the cover-ecosystem weekly recap, which fires at 18:00 UTC, so
the email line doesn't compete).

Opt-in lives on the user doc under ``operator_digest.email_enabled``
and defaults to ``False``. Only ``is_admin: True`` users see the
toggle (gated client-side) and only admins are considered by the
scheduler (gated server-side as well).

Reuses the same Resend pipeline + ``log_email_send`` helpers as the
other digests so deliverability shows up in the admin email log.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import resend
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router, logger, RESEND_API_KEY, SENDER_EMAIL, FRONTEND_URL
from models import User
from auth_dep import get_current_user, require_admin
from utils.email_log import log_email_send


# ---------------------------------------------------------------------
# Payload builder — reuses analytics aggregation directly.
# ---------------------------------------------------------------------

async def _gather_funnel(days: int) -> Dict[str, Any]:
    """Mirror of the funnel + ref bucket logic in
    `routes.analytics.admin_analytics_summary`, but module-local so we
    don't drag a FastAPI request object into the cron tick."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    by_page: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate([
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$page_type", "views": {"$sum": 1},
                    "unique_ips": {"$addToSet": "$ip_hash"}}},
        {"$project": {"page_type": "$_id", "_id": 0, "views": 1,
                      "unique": {"$size": "$unique_ips"}}},
    ]):
        by_page.append(r)

    cover_views = sum(r["views"] for r in by_page if r["page_type"] == "cover")
    explore_views = sum(r["views"] for r in by_page if r["page_type"] == "explore")
    signups = await db.users.count_documents({"created_at": {"$gte": cutoff}})

    by_ref: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate([
        {"$match": {"ts": {"$gte": cutoff}}},
        {"$group": {"_id": "$ref_bucket", "views": {"$sum": 1}}},
        {"$sort": {"views": -1}},
    ]):
        by_ref.append({"ref_bucket": r["_id"] or "direct", "views": r["views"]})

    top_covers_raw: List[Dict[str, Any]] = []
    async for r in db.page_views.aggregate([
        {"$match": {"ts": {"$gte": cutoff}, "page_type": "cover"}},
        {"$group": {"_id": "$slug", "views": {"$sum": 1}}},
        {"$sort": {"views": -1}},
        {"$limit": 5},
    ]):
        top_covers_raw.append({"cover_id": r["_id"], "views": r["views"]})

    if top_covers_raw:
        ids = [t["cover_id"] for t in top_covers_raw]
        by_id: Dict[str, Any] = {}
        async for c in db.community_covers.find(
            {"cover_id": {"$in": ids}},
            {"_id": 0, "cover_id": 1, "title": 1, "shared_by_username": 1},
        ):
            by_id[c["cover_id"]] = c
        for t in top_covers_raw:
            t.update(by_id.get(t["cover_id"], {}))

    return {
        "by_page":       by_page,
        "by_ref":        by_ref,
        "top_covers":    top_covers_raw,
        "funnel": {
            "explore_views": explore_views,
            "cover_views":   cover_views,
            "signups":       signups,
        },
    }


async def _build_operator_payload(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "Operator").split(" ")[0]
    data = await _gather_funnel(days=7)
    funnel = data["funnel"]
    base = (FRONTEND_URL or os.environ.get("REACT_APP_BACKEND_URL", "") or "").rstrip("/")
    admin_url = f"{base}/admin"

    # Subject — quiet weeks fall back to "operator weekly".
    if funnel["signups"]:
        subject = f"Shelfsort operator weekly · {funnel['signups']} signup{'s' if funnel['signups'] != 1 else ''}"
    else:
        subject = "Shelfsort operator weekly"

    top_covers_html = ""
    for c in data["top_covers"][:5]:
        title = (c.get("title") or "Untitled").strip()[:60]
        sharer = c.get("shared_by_username") or ""
        sharer_html = f" · @{sharer}" if sharer else ""
        top_covers_html += (
            f'<tr><td style="padding:8px 0;border-top:1px solid #E8E6E1;font-size:13px;color:#2C2C2C;">'
            f'{title}<span style="color:#6B705C;font-size:12px;">{sharer_html}</span>'
            f'<span style="float:right;color:#6B46C1;font-weight:600;">{c["views"]}</span>'
            f'</td></tr>'
        )
    if not top_covers_html:
        top_covers_html = (
            '<tr><td style="padding:8px 0;font-size:13px;color:#6B705C;">'
            'No cover-page views in the last 7 days.</td></tr>'
        )

    ref_rows_html = ""
    for r in data["by_ref"][:6]:
        ref_rows_html += (
            f'<tr><td style="padding:6px 0;font-size:13px;color:#2C2C2C;">'
            f'{r["ref_bucket"]}'
            f'<span style="float:right;color:#6B46C1;font-weight:600;">{r["views"]}</span>'
            f'</td></tr>'
        )

    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 0;font-family:Georgia,serif;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E8E6E1;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 8px 0;font-size:11px;letter-spacing:3px;color:#6B46C1;font-weight:bold;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;">Shelfsort · operator weekly</p>
            <h1 style="margin:0 0 8px 0;color:#2C2C2C;font-size:28px;line-height:1.15;">Hi {name},</h1>
            <p style="margin:0 0 24px 0;color:#6B705C;font-size:15px;line-height:1.6;">
              Past 7 days at a glance.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;font-family:Helvetica,Arial,sans-serif;">
              <tr>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#E07A5F;font-family:Georgia,serif;line-height:1;">{funnel['explore_views']}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Explore views</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#6B46C1;font-family:Georgia,serif;line-height:1;">{funnel['cover_views']}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Cover page views</p>
                </td>
                <td width="33%" style="text-align:center;padding:12px;">
                  <p style="margin:0;font-size:32px;color:#B87A00;font-family:Georgia,serif;line-height:1;">{funnel['signups']}</p>
                  <p style="margin:4px 0 0 0;font-size:11px;color:#6B705C;text-transform:uppercase;letter-spacing:1.5px;">Signups</p>
                </td>
              </tr>
            </table>
            <h2 style="margin:24px 0 8px 0;color:#2C2C2C;font-size:16px;font-family:Helvetica,Arial,sans-serif;">Top covers (by views)</h2>
            <table width="100%" cellpadding="0" cellspacing="0">{top_covers_html}</table>
            <h2 style="margin:24px 0 8px 0;color:#2C2C2C;font-size:16px;font-family:Helvetica,Arial,sans-serif;">Referrers</h2>
            <table width="100%" cellpadding="0" cellspacing="0">{ref_rows_html}</table>
            <p style="margin:32px 0 0 0;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              <a href="{admin_url}" style="display:inline-block;background:#6B46C1;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;font-size:14px;">Open Admin Console</a>
            </p>
            <p style="margin:28px 0 0 0;color:#6B705C;font-size:11px;text-align:center;font-family:Helvetica,Arial,sans-serif;">
              You're receiving this because you're a Shelfsort operator and turned on the operator digest.
              Toggle it any time in <a href="{base}/account" style="color:#6B46C1;">your account</a>.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

    text_lines = [
        f"Hi {name},",
        "",
        "Shelfsort operator weekly — past 7 days",
        f"  - Explore views: {funnel['explore_views']}",
        f"  - Cover page views: {funnel['cover_views']}",
        f"  - Signups: {funnel['signups']}",
        "",
        "Top covers:",
    ]
    for c in data["top_covers"][:5]:
        text_lines.append(
            f"  · {(c.get('title') or 'Untitled')[:60]} — {c['views']} views"
        )
    text_lines.append("")
    text_lines.append("Referrers:")
    for r in data["by_ref"][:6]:
        text_lines.append(f"  · {r['ref_bucket']}: {r['views']}")
    text_lines.append("")
    text_lines.append(f"Admin Console: {admin_url}")
    text_lines.append("")
    text_lines.append("— Shelfsort")
    text = "\n".join(text_lines)

    summary = {
        "explore_views": funnel["explore_views"],
        "cover_views":   funnel["cover_views"],
        "signups":       funnel["signups"],
        "top_covers":    len(data["top_covers"]),
    }
    return {"subject": subject, "html": html, "text": text, "summary": summary}


async def _send_operator_digest_email(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    payload = await _build_operator_payload(user_doc)
    to_email = user_doc.get("email") or ""
    if not to_email:
        return {"delivered": False, "reason": "no_email"}
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — would have sent operator digest to %s", to_email)
        return {"delivered": False, "logged": True, "summary": payload["summary"]}
    try:
        resend.api_key = RESEND_API_KEY
        result = await asyncio.to_thread(resend.Emails.send, {
            "from":    SENDER_EMAIL,
            "to":      [to_email],
            "subject": payload["subject"],
            "html":    payload["html"],
            "text":    payload["text"],
        })
        await log_email_send("operator_digest", to_email, "ok", resend_id=result.get("id"))
        return {"delivered": True, "id": result.get("id"), "summary": payload["summary"]}
    except Exception as e:
        logger.error("Operator-digest Resend send failed for %s: %s", to_email, e)
        await log_email_send("operator_digest", to_email, "error", error=str(e))
        return {"delivered": False, "error": str(e), "summary": payload["summary"]}


# ---------------------------------------------------------------------
# Settings endpoints (admin-only)
# ---------------------------------------------------------------------

class OperatorDigestBody(BaseModel):
    email_enabled: Optional[bool] = None


@api_router.get("/admin/operator-digest")
async def get_operator_digest_settings(user: User = Depends(require_admin)):
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = user_doc.get("operator_digest") or {}
    return {
        "email_enabled":      bool(prefs.get("email_enabled", False)),
        "last_sent_at":       prefs.get("last_sent_at"),
        "email_configured":   bool(RESEND_API_KEY),
    }


@api_router.put("/admin/operator-digest")
async def set_operator_digest_settings(
    body: OperatorDigestBody,
    user: User = Depends(require_admin),
):
    update: Dict[str, Any] = {}
    if body.email_enabled is not None:
        update["operator_digest.email_enabled"] = bool(body.email_enabled)
    if update:
        await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    user_doc = await db.users.find_one({"user_id": user.user_id}) or {}
    prefs = user_doc.get("operator_digest") or {}
    return {"email_enabled": bool(prefs.get("email_enabled", False))}


@api_router.post("/admin/operator-digest/preview")
async def send_operator_digest_preview(user: User = Depends(require_admin)):
    """Send the operator-digest right now to the caller (for testing)."""
    user_doc = await db.users.find_one({"user_id": user.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return await _send_operator_digest_email(user_doc)


# ---------------------------------------------------------------------
# Scheduler tick (called from routes.digest._digest_tick)
# ---------------------------------------------------------------------

async def maybe_send_operator_digest_for_all() -> int:
    """Fan-out the operator digest to every admin with the email toggle on.

    Idempotent per ISO week: each user gets at most one digest per
    Mon-Sun window (tracked by ``operator_digest.last_sent_at``).
    Returns the number of emails actually dispatched (or logged) so
    the parent tick can log a count.
    """
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=now.weekday())
    week_floor = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    week_floor_iso = week_floor.isoformat()

    sent = 0
    async for u in db.users.find(
        {"is_admin": True, "operator_digest.email_enabled": True},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "operator_digest": 1},
    ):
        last = (u.get("operator_digest") or {}).get("last_sent_at")
        if isinstance(last, str) and last >= week_floor_iso:
            continue   # already sent this ISO week
        try:
            await _send_operator_digest_email(u)
            await db.users.update_one(
                {"user_id": u["user_id"]},
                {"$set": {"operator_digest.last_sent_at": now.isoformat()}},
            )
            sent += 1
        except Exception as e:
            logger.warning("Operator-digest send failed for %s: %s", u.get("email"), e)
    return sent


__all__ = ["maybe_send_operator_digest_for_all"]
