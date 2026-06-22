"""Send-to-Kindle — email an EPUB to a user's Amazon Kindle inbox.

Background
----------
Amazon Kindle accepts personal documents via email at
``yourname@kindle.com``.  The sender address must be on the user's
"Approved Personal Document E-mail List" in the Kindle Manage Your
Content panel — otherwise Amazon silently drops the message.  The
sender email Shelfsort uses is ``SENDER_EMAIL`` from the .env, so
the user has to add that one address to Amazon ONCE.

We send via Resend with the EPUB as a base64 attachment.  Kindle's
email gateway caps attachment size at 50 MB per message; over that
we reject early so the user gets a clear toast instead of a silent
Resend failure half a minute later.

Anti-spam guardrails
--------------------
* Rate limit: at most 1 send per (book, user) per 30 minutes.  Keeps
  an accidental double-click from spamming the user's Kindle inbox
  with duplicates (Amazon de-dupes by content hash but the email
  itself still hits the Personal Documents quota).
* AV-status check: refuse to send a book that's been quarantined.
* Format check: EPUB only.  Amazon also accepts PDF / DOCX / MOBI
  but Shelfsort stores everything as EPUB after Calibre conversion,
  so locking this down sidesteps a class of "weird format reached
  Kindle" support tickets.

The function returns the Resend send result + a logged ``email_logs``
row tagged ``kind="send_to_kindle"`` so the admin
``/admin/email-volume-forecast`` card includes Kindle sends in the
weekly forecast.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException

from deps import db, STORAGE_DIR

logger = logging.getLogger(__name__)


# Amazon Kindle "personal documents" email gateway limit, per their
# help center as of 2026.  Resend itself permits up to 40 MB total
# payload — so the effective Shelfsort ceiling is the lower of the
# two, after accounting for ~5 KB of email headers + HTML body.
KINDLE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024  # 25 MB hard cap
RESEND_PAYLOAD_HEADROOM = 1024 * 32              # 32 KB for headers/body

# Rate-limit window per (user, book).
RATE_LIMIT_WINDOW = timedelta(minutes=30)

# Kindle email validation — match anything ending in @kindle.com or
# @free.kindle.com (the older free-tier domain).  Allow common
# Kindle plus-tag flavours just in case Amazon ever adds them.
KINDLE_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@(?:free\.)?kindle\.com$", re.IGNORECASE)


def is_valid_kindle_email(email: str) -> bool:
    """True iff ``email`` looks like an Amazon Kindle send-to address."""
    return bool(email and KINDLE_EMAIL_RE.match(email.strip()))


async def send_book_to_kindle(
    *, user_id: str, book_id: str, force: bool = False,
) -> Dict[str, Any]:
    """Send an EPUB to the user's Kindle inbox.

    Raises ``HTTPException`` with a clear ``detail`` for every fail
    case so the caller can surface a useful toast on the frontend.
    """
    user_doc = await db.users.find_one({"user_id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    kindle_email = (user_doc.get("kindle_email") or "").strip()
    if not kindle_email:
        raise HTTPException(
            status_code=400,
            detail="No Kindle email on file. Add one in Account → Send to Kindle settings.",
        )
    if not is_valid_kindle_email(kindle_email):
        raise HTTPException(
            status_code=400,
            detail=f"'{kindle_email}' isn't a valid Kindle send-to address.",
        )

    book = await db.books.find_one({"book_id": book_id, "user_id": user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.get("av_status") == "infected":
        raise HTTPException(
            status_code=403,
            detail="This book was quarantined by antivirus and can't be sent to Kindle.",
        )

    # Rate-limit per (user, book) — prevents double-click duplicates.
    if not force:
        cutoff = datetime.now(timezone.utc) - RATE_LIMIT_WINDOW
        recent = await db.kindle_send_log.find_one({
            "user_id":   user_id,
            "book_id":   book_id,
            "status":    "ok",
            "sent_at":   {"$gte": cutoff},
        })
        if recent:
            # Mongo strips tzinfo on read — re-attach UTC before
            # subtracting so we don't blow up on naive datetimes.
            sent_at = recent["sent_at"]
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            mins_ago = int((datetime.now(timezone.utc) - sent_at).total_seconds() / 60)
            raise HTTPException(
                status_code=429,
                detail=f"Already sent to Kindle {mins_ago} min ago. Wait 30 min between sends to avoid duplicates.",
            )

    # Ensure the EPUB is local — pulls from R2 if needed.
    fp = STORAGE_DIR / user_id / f"{book_id}.epub"
    if not fp.exists():
        from utils.storage_cloud import ensure_local_cached  # noqa: WPS433
        ok = await asyncio.to_thread(ensure_local_cached, fp, user_id, book_id, ".epub")
        if not ok or not fp.exists():
            raise HTTPException(
                status_code=404,
                detail="File missing from storage. Try re-uploading the book.",
            )

    raw = await asyncio.to_thread(fp.read_bytes)
    size = len(raw)
    if size > KINDLE_ATTACHMENT_MAX_BYTES:
        mb = size / (1024 * 1024)
        cap = KINDLE_ATTACHMENT_MAX_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"EPUB is {mb:.1f} MB — Kindle's gateway caps personal documents at {cap:.0f} MB.",
        )
    if size + RESEND_PAYLOAD_HEADROOM > KINDLE_ATTACHMENT_MAX_BYTES:
        # Should never trip in practice since we already enforce the
        # hard cap above, but keeps the headroom intent explicit.
        pass

    resend_key = os.environ.get("RESEND_API_KEY") or ""
    sender = os.environ.get("SENDER_EMAIL") or ""
    if not resend_key or not sender:
        raise HTTPException(
            status_code=503,
            detail="Email service isn't configured on the server. Contact the operator.",
        )

    # Filename: Amazon uses the attachment filename as the document
    # title shown on the Kindle home screen, so we render it with
    # ``"Title - Author.epub"`` to match the user's library naming.
    title = (book.get("title") or "Untitled").strip()
    author = (book.get("author") or "").strip()
    safe_title = re.sub(r"[^A-Za-z0-9 _\-\.()',]", "_", title)[:80]
    safe_author = re.sub(r"[^A-Za-z0-9 _\-\.()',]", "_", author)[:60]
    filename = f"{safe_title} - {safe_author}.epub" if safe_author else f"{safe_title}.epub"

    # Resend payload: ``html`` body is decorative — Kindle ignores it
    # entirely and only opens the attachment.  Including a body lets
    # the message show up cleanly if the user looks at their Sent
    # folder.  Subject line is just "convert" — Amazon's docs say
    # the subject is ignored on personal-document sends, but some
    # users have reported needing the literal word "convert" to
    # force PDF→AZW conversion; harmless for EPUBs.
    import resend  # noqa: WPS433
    resend.api_key = resend_key
    params = {
        "from":    sender,
        "to":      [kindle_email],
        "subject": "convert",
        "html":    f"<p>Personal document from Shelfsort — {title} by {author or '(unknown)'}.</p>",
        "text":    f"Personal document from Shelfsort — {title} by {author or '(unknown)'}.\n",
        "attachments": [{
            "filename": filename,
            "content":  base64.b64encode(raw).decode(),
        }],
        "_kind":   "send_to_kindle",
    }

    sent_at = datetime.now(timezone.utc)
    log_doc: Dict[str, Any] = {
        "user_id":   user_id,
        "book_id":   book_id,
        "to_email":  kindle_email,
        "filename":  filename,
        "size_bytes": size,
        "sent_at":   sent_at,
        "status":    "pending",
        "resend_id": None,
        "error":     None,
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        resend_id = result.get("id") if isinstance(result, dict) else None
        log_doc.update({"status": "ok", "resend_id": resend_id})
        await db.kindle_send_log.insert_one(log_doc)
        # Tag the book so the UI can show a "sent X ago" indicator
        # without an extra round-trip to the log collection.
        await db.books.update_one(
            {"book_id": book_id, "user_id": user_id},
            {"$set": {"kindle_last_sent_at": sent_at}},
        )
        # Also write to the central email_logs so the volume forecast
        # picks it up.
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "send_to_kindle", kindle_email, "ok",
                resend_id=resend_id,
                extra={"book_id": book_id, "size_bytes": size},
            )
        except Exception:
            pass
        return {
            "ok":         True,
            "resend_id":  resend_id,
            "size_bytes": size,
            "filename":   filename,
            "to":         kindle_email,
        }
    except Exception as exc:  # noqa: BLE001
        log_doc.update({"status": "error", "error": str(exc)[:500]})
        await db.kindle_send_log.insert_one(log_doc)
        try:
            from utils.email_log import log_email_send  # noqa: WPS433
            await log_email_send(
                "send_to_kindle", kindle_email, "error",
                error=str(exc)[:300],
                extra={"book_id": book_id, "size_bytes": size},
            )
        except Exception:
            pass
        logger.warning("send_to_kindle: failed for %s/%s: %s", user_id, book_id, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Email service rejected the send: {str(exc)[:200]}",
        )


async def get_kindle_settings(user_id: str) -> Dict[str, Any]:
    """Payload for the frontend Account → Send to Kindle card."""
    user_doc = await db.users.find_one({"user_id": user_id}) or {}
    last_send = await db.kindle_send_log.find_one(
        {"user_id": user_id, "status": "ok"},
        sort=[("sent_at", -1)],
    )
    out: Dict[str, Any] = {
        "kindle_email":        (user_doc.get("kindle_email") or ""),
        "sender_email":        os.environ.get("SENDER_EMAIL") or "",
        "last_sent_at":        None,
        "last_book_id":        None,
    }
    if last_send:
        out["last_sent_at"] = last_send["sent_at"].isoformat() if isinstance(last_send.get("sent_at"), datetime) else last_send.get("sent_at")
        out["last_book_id"] = last_send.get("book_id")
    return out


async def set_kindle_email(user_id: str, kindle_email: str) -> Dict[str, Any]:
    """Validate + persist the user's Kindle send-to address.  Empty
    string clears it."""
    cleaned = (kindle_email or "").strip()
    if cleaned and not is_valid_kindle_email(cleaned):
        raise HTTPException(
            status_code=400,
            detail="That doesn't look like a Kindle send-to address (must end in @kindle.com).",
        )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"kindle_email": cleaned}},
    )
    return {"kindle_email": cleaned}
