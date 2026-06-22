"""Smart welcome email (2026-06-22).

Personalizes the one-shot post-approval / post-auto-approve email
using the four onboarding answers we already collect at sign-up:

* ``reader_type``      — fanfic | original | mix | organize
* ``favorite_fandom``  — free-text top fandom
* ``referral``         — where they heard about Shelfsort
* ``is_13_plus``       — gate-only, not surfaced in the email

The email body is composed of three blocks:

1. **Greeting**: name + a referral-specific thank-you when present.
2. **Personal tip**: a single 1-2 sentence callout that maps to the
   reader_type + the favorite_fandom.  Picked verbatim from a
   small dictionary so the copy stays curated, not LLM-generated
   (Resend quota + cost control).
3. **Three CTAs**: upload, find friends, help docs.  Same three
   links every email so the footer is predictable, but the order
   re-arranges to put the most relevant link first for each
   reader_type.

Reuses the existing Resend wrapper + ``utils.email_suppression``
test-account skip pattern.  Sends through ``email_logs`` so the
new card in `/admin/email-volume-forecast` already counts it.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Tuple

import resend

from deps import FRONTEND_URL, RESEND_API_KEY, SENDER_EMAIL
from utils.email_log import log_email_send

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Copy bank — picked verbatim, never LLM-generated.  Keeping it static
# means no quota burn on the welcome path and the operator can audit
# every line of copy that the platform sends.
# ---------------------------------------------------------------------------
_READER_TIPS: Dict[str, Dict[str, str]] = {
    "fanfic": {
        "heading":  "You're here for the fic.",
        "body":     "Shelfsort buckets every EPUB into its fandom shelf automatically — you'll see Harry Potter sit next to Marvel sit next to original-fiction without you lifting a finger.",
        "primary":  "library",
    },
    "original": {
        "heading":  "Original-fiction-first.",
        "body":     "Smart shelves catch authors and series you've started so your TBR stops being a single folder. Drop in a few EPUBs and watch them sort themselves.",
        "primary":  "library",
    },
    "mix": {
        "heading":  "Fic + originals, mixed.",
        "body":     "Most readers hit a wall when their Downloads folder mixes fanfic and original work. Shelfsort splits them on upload — no manual tagging needed.",
        "primary":  "library",
    },
    "organize": {
        "heading":  "You're here to organize.",
        "body":     "Bulk upload, let the AI sort, then drag any stragglers between shelves. Most people clear a 200-book Downloads folder in under 10 minutes.",
        "primary":  "library",
    },
}

# Fallback when reader_type is missing / unknown — generic but still
# warmer than the old "your account is approved" one-liner.
_DEFAULT_TIP = {
    "heading":  "Glad to have you.",
    "body":     "Shelfsort reads each EPUB's metadata and uses AI to file it by fandom — Harry Potter, Twilight, Marvel, original fiction, all auto-shelved.",
    "primary":  "library",
}

# Referral → opening-line thank-you.  Order matters: the longest match
# wins so "google.com" still maps to ``google``.  Anything not in this
# map gets a generic "Thanks for finding us" line.
_REFERRAL_LINES: Dict[str, str] = {
    "google":      "Thanks for finding us through Google.",
    "reddit":      "Thanks for finding us on Reddit.",
    "tumblr":      "Thanks for finding us on Tumblr.",
    "twitter":     "Thanks for finding us on Twitter.",
    "x":           "Thanks for finding us on X.",
    "tiktok":      "Thanks for finding us on TikTok.",
    "discord":     "Thanks for finding us through Discord.",
    "friend":      "Thanks for taking a friend's recommendation.",
    "word of mouth": "Thanks for taking a friend's recommendation.",
    "ao3":         "Thanks for finding us through AO3.",
    "youtube":     "Thanks for finding us on YouTube.",
}


def _referral_line(ref: Optional[str]) -> str:
    if not ref:
        return ""
    key = ref.strip().lower()
    return _REFERRAL_LINES.get(key, "Thanks for finding us.")


def _cta_order(primary: str) -> list:
    """Re-order the three CTAs so the reader_type-specific one is first."""
    ctas = [
        ("library",  "Upload your first books",  "/library"),
        ("friends",  "Find a reading friend",    "/friends"),
        ("help",     "How Shelfsort works",      "/help"),
    ]
    primary_idx = next((i for i, c in enumerate(ctas) if c[0] == primary), 0)
    return [ctas[primary_idx], *ctas[:primary_idx], *ctas[primary_idx + 1:]]


def build_welcome_email(
    *,
    name: str,
    onboarding: Optional[Dict[str, Any]] = None,
    frontend_url: str = "",
) -> Tuple[str, str, str]:
    """Compose the subject + HTML + plaintext for the welcome email.

    Pure function (no I/O) — exposed at module level so the
    backend tests can assert against the exact copy without
    spinning up Resend.
    """
    onboarding = onboarding or {}
    reader_type = (onboarding.get("reader_type") or "").strip().lower()
    fandom = (onboarding.get("favorite_fandom") or "").strip()
    referral = onboarding.get("referral") or ""

    tip = _READER_TIPS.get(reader_type, _DEFAULT_TIP)
    ref_line = _referral_line(referral)
    ctas = _cta_order(tip["primary"])
    frontend = (frontend_url or "").rstrip("/")

    subject = "Welcome to Shelfsort — your library is ready"

    # Fandom-specific second sentence — only added when both
    # reader_type fits and a fandom was supplied.  Keeps the body
    # short for the "organize" reader who didn't tell us a fandom.
    fandom_line = ""
    if fandom and reader_type in ("fanfic", "mix"):
        fandom_line = (
            f" You mentioned {fandom} — every {fandom} EPUB you upload "
            f"will land on its own shelf automatically."
        )

    # HTML body
    cta_buttons = "".join(
        f"<p style='margin:0 0 10px'><a href='{frontend}{path}' "
        f"style='background:#6B46C1;color:#fff;padding:10px 18px;border-radius:8px;"
        f"text-decoration:none;display:inline-block;font-weight:600'>{label}</a></p>"
        if i == 0 else
        f"<p style='margin:0 0 8px'><a href='{frontend}{path}' "
        f"style='color:#6B46C1;text-decoration:none'>→ {label}</a></p>"
        for i, (_, label, path) in enumerate(ctas)
    )

    body_html = (
        f"<div style='font-family:system-ui,-apple-system,sans-serif;max-width:560px;"
        f"line-height:1.65;color:#2C2C2C'>"
        f"<h2 style='color:#6B46C1;margin:0 0 14px;font-family:Georgia,serif'>"
        f"Hi {name or 'there'},</h2>"
        + (f"<p style='margin:0 0 14px'>{ref_line}</p>" if ref_line else "")
        + f"<p style='margin:0 0 6px;font-weight:600;color:#2C2C2C'>{tip['heading']}</p>"
        + f"<p style='margin:0 0 18px'>{tip['body']}{fandom_line}</p>"
        + f"<div style='margin:0 0 18px'>{cta_buttons}</div>"
        + "<p style='margin:18px 0 0;color:#6B705C;font-size:13px'>"
        "You're getting this because you just signed up for Shelfsort. "
        "Reply to this email if anything's off — a human (the operator) reads every reply."
        "</p>"
        "</div>"
    )

    # Plain-text body — same content, no styling.
    cta_lines = "\n".join(f"• {label}: {frontend}{path}" for _, label, path in ctas)
    body_text = (
        f"Hi {name or 'there'},\n\n"
        + (f"{ref_line}\n\n" if ref_line else "")
        + f"{tip['heading']}\n{tip['body']}{fandom_line}\n\n"
        + f"{cta_lines}\n\n"
        + "You're getting this because you just signed up for Shelfsort. "
        + "Reply if anything's off — a human reads every reply.\n"
    )
    return subject, body_html, body_text


# ---------------------------------------------------------------------------
# Sender wrapper — best-effort, never raises.  Mirrors the pattern used by
# every other email path so test-account filtering + email_logs work
# without special-casing.
# ---------------------------------------------------------------------------
async def send_welcome_email(
    user_doc: Dict[str, Any],
    *,
    source: str = "approval",
) -> bool:
    """Send the smart welcome email to ``user_doc`` if possible.

    ``source`` is recorded in ``email_logs`` for the admin's audit:
    ``approval`` (sent from the admin approve flow) or
    ``auto_approve`` (sent from register when the approval gate is
    off).  Returns True on send success, False otherwise — the
    caller is expected to swallow this and continue, since the
    welcome email is never load-bearing.
    """
    to = (user_doc.get("email") or "").strip().lower()
    name = (user_doc.get("name") or "").strip()
    onboarding = user_doc.get("onboarding") or {}

    if not RESEND_API_KEY or not SENDER_EMAIL or not to:
        return False

    subject, html, text = build_welcome_email(
        name=name,
        onboarding=onboarding,
        frontend_url=FRONTEND_URL or os.environ.get("FRONTEND_URL", ""),
    )
    kind = f"welcome_{source}"
    try:
        import asyncio
        resend.api_key = RESEND_API_KEY
        params = {
            "from":    SENDER_EMAIL,
            "to":      [to],
            "subject": subject,
            "html":    html,
            "text":    text,
            "_kind":   kind,  # consumed by utils/email_suppression for test filter + kill switch
        }
        await asyncio.to_thread(resend.Emails.send, params)
        await log_email_send(kind, to, "ok")
        return True
    except Exception as exc:
        logger.warning("welcome email to %s failed: %s", to, exc)
        try:
            await log_email_send(kind, to, "error", error=str(exc)[:200])
        except Exception:
            pass
        return False
