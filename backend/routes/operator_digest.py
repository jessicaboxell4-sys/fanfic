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


async def _gather_upload_failures(days: int = 7) -> Dict[str, Any]:
    """Aggregate upload_failures rows from the last ``days`` for the
    operator weekly digest.  Buckets by friendly cause family so a
    growing trend in one bucket is visible at a glance.

    Buckets (regex-matched on ``error`` field, fallback to ``failure_stage``):

    * ``cloudflare``  — Cloudflare 5xx / origin-overloaded class
    * ``mongo``       — Atlas transient / topology errors
    * ``staging``     — bytes lost to a pod restart
    * ``calibre``     — conversion crash / OOM
    * ``av``          — flagged by virus scan
    * ``classify``    — Claude / classifier failures
    * ``other``       — anything else

    Returns ``{total, users, buckets: [{label, count}, ...]}``.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    total = 0
    users: set[str] = set()
    bucket_counts: Dict[str, int] = {}
    cursor = db.upload_failures.find(
        {"created_at": {"$gte": cutoff}, "dismissed_at": None},
        {"_id": 0, "user_id": 1, "error": 1, "failure_stage": 1},
    )
    async for row in cursor:
        total += 1
        if row.get("user_id"):
            users.add(row["user_id"])
        err = (row.get("error") or "").lower()
        stage = (row.get("failure_stage") or "").lower()
        if "cloudflare" in err or "origin web server" in err or "overloaded" in err:
            label = "Cloudflare 5xx"
        elif "mongo" in err or "primary node" in err or "replica set" in err:
            label = "Atlas transient"
        elif "staging directory vanished" in err:
            label = "Staging vanished"
        elif "calibre" in err or "convert" in err or stage == "convert":
            label = "Calibre/convert"
        elif stage == "av" or "virus" in err or "flagged" in err:
            label = "AV-flagged"
        elif stage == "classify" or "classifier" in err or "claude" in err:
            label = "Classifier"
        else:
            label = "Other"
        bucket_counts[label] = bucket_counts.get(label, 0) + 1
    # Sort buckets newest-first by count, top 3 only — keeps the
    # digest line scannable.
    sorted_buckets = sorted(bucket_counts.items(), key=lambda x: -x[1])
    return {
        "total":   total,
        "users":   len(users),
        "buckets": [{"label": k, "count": v} for k, v in sorted_buckets[:3]],
    }


# Path to the forensic audit log that scripts/audit_gitignore_regression.py
# writes to.  Lives in the repo so it's visible to git tooling but isn't
# auto-committed (it's referenced from .gitignore — keep it out of git).
from pathlib import Path  # noqa: E402  (local import keeps the module surface lean)
_AUDIT_LOG_PATH = Path(__file__).resolve().parents[2] / "memory" / "gitignore_regression_audit.log"
_AUDIT_HEADER_RE = None  # built lazily on first parse


def _gather_gitignore_audit(since_iso: Optional[str]) -> List[Dict[str, Any]]:
    """Parse new records from gitignore_regression_audit.log since the
    last digest.  Returns at most 5 records, newest first.

    The audit log is a sequence of ``═══...═══`` separated blocks
    written by ``scripts/audit_gitignore_regression.py``.  Each block
    begins with ``GITIGNORE REGRESSION DETECTED — <iso8601>`` on its
    own line and contains several labeled sections.  We return a tiny
    summary per record (timestamp + first 2 hit lines + first 1 line
    of the process tree) — enough to spot a smoking gun in an email,
    without dumping the full forensic payload.

    Best-effort: any IO / parse error returns an empty list so a
    missing log can't ever block the digest.
    """
    global _AUDIT_HEADER_RE
    if _AUDIT_HEADER_RE is None:
        import re as _re
        _AUDIT_HEADER_RE = _re.compile(r"GITIGNORE REGRESSION DETECTED\s*—\s*(\S+)")

    if not _AUDIT_LOG_PATH.exists():
        return []
    try:
        text = _AUDIT_LOG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    # Each record begins with the literal "GITIGNORE REGRESSION
    # DETECTED — <iso>" line.  Slice the text between consecutive
    # header positions so each block is a whole record (sections
    # included).  Splitting on the ═══ divider would chop each
    # record into 3 fragments — header, body, trailer — and lose
    # the section body, which is why an earlier version returned
    # empty hit_lines.
    import re as _re
    matches = list(_AUDIT_HEADER_RE.finditer(text))
    if not matches:
        return []
    results: List[Dict[str, Any]] = []
    for i, m in enumerate(matches):
        ts = m.group(1).strip()
        if since_iso and ts <= since_iso:
            continue
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        hit_lines: List[str] = []
        proc_top: str = ""
        section: Optional[str] = None
        for ln in body.splitlines():
            stripped = ln.strip()
            if stripped.startswith("Hit lines"):
                section = "hits"
                continue
            if stripped.startswith("Process tree"):
                section = "proc"
                continue
            if stripped.startswith(("git author", "git status", "git log", "git diff",
                                    "Interactive-commit", "Curated env")):
                section = None
                continue
            if section == "hits" and stripped.startswith("line ") and len(hit_lines) < 2:
                hit_lines.append(stripped)
            elif section == "proc" and stripped and not proc_top:
                proc_top = stripped[:140]
        results.append({
            "ts":        ts,
            "hit_lines": hit_lines,
            "proc_top":  proc_top,
        })

    results.sort(key=lambda r: r["ts"], reverse=True)
    return results[:5]


async def _build_operator_payload(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    name = (user_doc.get("name") or user_doc.get("email", "").split("@")[0] or "Operator").split(" ")[0]
    data = await _gather_funnel(days=7)
    last_sent_at = (user_doc.get("operator_digest") or {}).get("last_sent_at")
    audit_records = _gather_gitignore_audit(since_iso=last_sent_at)
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

    # ── Gitignore regression forensic trail ──
    # Renders the new audit records since last_sent_at.  Section is
    # only emitted when there's at least one hit — quiet weeks stay
    # quiet so the digest doesn't become a noise email.
    audit_html = ""
    if audit_records:
        audit_rows = ""
        for rec in audit_records:
            hits_summary = " · ".join(rec["hit_lines"]) or "—"
            proc = rec["proc_top"] or "<unknown actor>"
            audit_rows += (
                f'<tr><td style="padding:10px 0;border-top:1px solid #E8E6E1;font-size:12px;color:#2C2C2C;font-family:Helvetica,Arial,sans-serif;">'
                f'<span style="color:#C75450;font-weight:600;">{rec["ts"]}</span><br>'
                f'<span style="color:#6B705C;">{hits_summary}</span><br>'
                f'<span style="color:#6B705C;font-family:Courier,monospace;font-size:11px;">↳ {proc}</span>'
                f'</td></tr>'
            )
        audit_html = (
            '<h2 style="margin:24px 0 8px 0;color:#7C2D2A;font-size:16px;font-family:Helvetica,Arial,sans-serif;">'
            f'⚠ .gitignore regression detected ({len(audit_records)} this week)'
            '</h2>'
            '<p style="margin:0 0 8px 0;color:#6B705C;font-size:12px;font-family:Helvetica,Arial,sans-serif;">'
            "Pre-commit forensic capture — full records in <code>memory/gitignore_regression_audit.log</code>."
            '</p>'
            f'<table width="100%" cellpadding="0" cellspacing="0">{audit_rows}</table>'
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
            {audit_html}
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
