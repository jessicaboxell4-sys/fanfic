"""Re-engagement email (2026-06-29).

Once-per-user email sent to dormant users who haven't completed
their profile.  Goal: bring back the long tail of sign-ups that
drifted before they finished onboarding.

Trigger condition (all must be true):
  * ``created_at`` more than 7 days ago
  * ``last_login_at`` more than 14 days ago, OR absent (never logged in)
  * Profile completeness score < 3
        completeness = (bio set ? 1 : 0)
                     + (library_visible_to_public ? 1 : 0)
                     + (username set ? 1 : 0)   # implicit
  * ``re_engagement_sent_at`` is absent (once per user, ever)

Cadence: weekly cron tick (Tuesday 17:00 UTC).
Body tone: personal & encouraging — uses first name + lists the
exact missing steps ("Add a bio · Make your library public").

Reuses the welcome_email send pattern: Resend, email_logs, the
suppression layer, and the standard footer.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

import resend

from deps import db, FRONTEND_URL, RESEND_API_KEY, SENDER_EMAIL
from utils.email_log import log_email_send

logger = logging.getLogger(__name__)


# Returns a list of missing onboarding actions for the user.  Order
# matters: this is the order the email body lists them, so we put
# the highest-impact action first.
def _missing_steps(user_doc: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Return [(label, deeplink_path), ...] for each missing step.

    Excludes the username step — it's set at signup and effectively
    always present.
    """
    steps: List[Tuple[str, str]] = []
    if not (user_doc.get("bio") or "").strip():
        steps.append(("Add a bio to your profile", "/account"))
    if not user_doc.get("library_visible_to_public"):
        steps.append(("Make your library public so other readers can browse it", "/account"))
    return steps


def build_re_engagement_email(
    *,
    name: str,
    missing: List[Tuple[str, str]],
    frontend_url: str,
) -> Tuple[str, str, str]:
    """Return (subject, html, text) for the dormant-user nudge."""
    frontend = (frontend_url or "").rstrip("/") or "https://shelfsort.com"
    first_name = (name or "").split(" ")[0] or "there"
    n = len(missing)

    if n == 0:
        # Defensive — caller should filter these out, but if a
        # missed-condition slips through we still send something
        # helpful instead of a confusing empty email.
        subject = "Your Shelfsort shelf is waiting for you"
        intro = "We noticed you haven't been back in a while — your library is still here, waiting."
        steps_html = ""
        steps_text = ""
    else:
        subject = f"You're {n} step{'s' if n != 1 else ''} from being Featured on Shelfsort"
        intro = (
            f"You're {n} small step{'s' if n != 1 else ''} away from a complete profile — "
            "complete profiles get the gold ★ Featured stamp and show up first in the readers directory."
        )
        steps_html = (
            "<ul style='margin:14px 0 18px;padding-left:22px;line-height:1.7;color:#2C2C2C'>"
            + "".join(
                f"<li><a href='{frontend}{path}' style='color:#6B46C1;text-decoration:none;font-weight:600'>{label}</a></li>"
                for label, path in missing
            )
            + "</ul>"
        )
        steps_text = "\n".join(f"  • {label} — {frontend}{path}" for label, path in missing) + "\n\n"

    html = (
        "<div style='font-family:system-ui,-apple-system,sans-serif;max-width:560px;"
        "line-height:1.65;color:#2C2C2C'>"
        f"<h2 style='color:#6B46C1;margin:0 0 14px;font-family:Georgia,serif'>Hi {first_name},</h2>"
        f"<p style='margin:0 0 14px'>{intro}</p>"
        f"{steps_html}"
        f"<p style='margin:0 0 18px'>"
        f"<a href='{frontend}/account' "
        "style='background:#6B46C1;color:#fff;padding:10px 18px;border-radius:8px;"
        "text-decoration:none;display:inline-block;font-weight:600'>Finish my profile</a>"
        "</p>"
        "<p style='margin:18px 0 0;color:#5B5F4D;font-size:13px'>"
        "You're getting this once because you signed up but haven't filled out your profile yet. "
        "We won't email you about this again. Reply if you'd rather just have your account deleted."
        "</p>"
        "</div>"
    )

    text = (
        f"Hi {first_name},\n\n"
        f"{intro}\n\n"
        f"{steps_text}"
        f"Finish your profile: {frontend}/account\n\n"
        "You're getting this once because you signed up but haven't filled out your profile yet. "
        "We won't email you about this again. Reply if you'd rather just have your account deleted.\n"
    )
    return subject, html, text


async def send_re_engagement_email(user_doc: Dict[str, Any]) -> bool:
    """Send the nudge to ``user_doc`` and stamp ``re_engagement_sent_at``.

    Best-effort.  Returns True on send success.  On failure the
    sent-at stamp is NOT written — letting a future tick retry.
    """
    to = (user_doc.get("email") or "").strip().lower()
    if not RESEND_API_KEY or not SENDER_EMAIL or not to:
        return False

    missing = _missing_steps(user_doc)
    subject, html, text = build_re_engagement_email(
        name=user_doc.get("name") or "",
        missing=missing,
        frontend_url=FRONTEND_URL or os.environ.get("FRONTEND_URL", ""),
    )

    try:
        resend.api_key = RESEND_API_KEY
        params = {
            "from":    SENDER_EMAIL,
            "to":      [to],
            "subject": subject,
            "html":    html,
            "text":    text,
            "_kind":   "re_engagement",  # consumed by email_suppression
        }
        await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send("re_engagement", to, "ok")
        # Stamp the user doc so we never re-send.
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {"re_engagement_sent_at": datetime.now(timezone.utc).isoformat()}},
        )
        return True
    except Exception as exc:
        logger.warning("re-engagement email to %s failed: %s", to, exc)
        try:
            await log_email_send("re_engagement", to, "error", error=str(exc)[:200])
        except Exception:
            pass
        return False


# Limit per tick so a backlog of dormant users doesn't burst the
# Resend quota.  Sends are sequential — Resend rate-limits at ~10/s
# soft, and we want each send fully retryable.
_MAX_PER_TICK = 30


async def re_engagement_tick() -> Dict[str, Any]:
    """Weekly cron handler — find eligible users and send the nudge.

    Returns a small stats dict so the cron wrapper / admin digest
    can surface the per-tick counts.
    """
    now = datetime.now(timezone.utc)
    seven_days_ago = (now - timedelta(days=7)).isoformat()
    fourteen_days_ago = (now - timedelta(days=14)).isoformat()

    # Mongo query: created >7d ago, never re-engaged, AND (no login
    # since fourteen_days_ago OR no login ever), AND incomplete
    # profile (missing bio or library not public).
    query: Dict[str, Any] = {
        "created_at": {"$lt": seven_days_ago},
        "re_engagement_sent_at": {"$exists": False},
        "$and": [
            {"$or": [
                {"last_login_at": {"$lt": fourteen_days_ago}},
                {"last_login_at": {"$exists": False}},
                {"last_login_at": None},
            ]},
            {"$or": [
                {"bio": {"$in": [None, ""]}},
                {"bio": {"$exists": False}},
                {"library_visible_to_public": {"$ne": True}},
            ]},
        ],
    }
    candidates = await db.users.find(
        query,
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "bio": 1, "library_visible_to_public": 1},
    ).limit(_MAX_PER_TICK).to_list(_MAX_PER_TICK)

    sent_ok = 0
    failed = 0
    for u in candidates:
        ok = await send_re_engagement_email(u)
        if ok:
            sent_ok += 1
        else:
            failed += 1
    stats = {
        "eligible_found": len(candidates),
        "sent_ok":        sent_ok,
        "failed":         failed,
        "ran_at":         now.isoformat(),
    }
    logger.info("re_engagement_tick: %s", stats)
    return stats
