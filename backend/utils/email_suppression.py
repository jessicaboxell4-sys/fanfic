"""Email suppression layer — monkey-patches ``resend.Emails.send``
at startup so every outbound email goes through two gates before
hitting Resend:

  1. **Test-account filter**: anything addressed to a synthetic domain
     (``@example.*``, ``@ft.local``, ``@bulkfx.*``, etc.) is short-
     circuited.  Stops pytest runs + load tests from eating real
     Resend quota.

  2. **Emergency outbound-pause flag**: when
     ``feature_flags.emails_suppress_outbound`` is true, every real
     email is suppressed AND a matching in-app notification is queued
     for the user instead.

Both paths still write a ``status="suppressed"`` row to ``email_logs``
so the admin email-logs page shows what would-have-been-sent.

Why a thread-safe sync pymongo client here?  Every Resend send in
this codebase is wrapped by ``await asyncio.to_thread(resend.Emails.send, ...)``,
so the patched function executes in a worker thread.  Blocking Mongo
calls inside a thread don't block the event loop.

Idempotent: calling ``install()`` twice is a no-op.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import resend
from pymongo import MongoClient

# Importing `deps` triggers `load_dotenv()` so ``MONGO_URL`` /
# ``DB_NAME`` are available when ``_get_sync_db()`` runs lazily.
# We don't actually use anything from deps directly — this is a
# load-order pin so the env vars are populated before our first
# Mongo call (which can happen mid-pytest before any other import
# touches deps).
import deps  # noqa: F401

from utils.test_account_filter import is_test_account

logger = logging.getLogger(__name__)

_INSTALLED = False
_ORIGINAL_SEND = None
# Dedicated sync client for the suppression layer.  Tiny connection
# pool — we only do 1-2 lookups per email.
_sync_db = None


def _get_sync_db():
    """Lazy-init a sync MongoClient.  Module-level so we don't
    open/close a connection per email."""
    global _sync_db
    if _sync_db is None:
        url = os.environ["MONGO_URL"]
        name = os.environ["DB_NAME"]
        _sync_db = MongoClient(url, maxPoolSize=4)[name]
    return _sync_db


def _is_test_recipient(to_email: str) -> bool:
    return is_test_account(to_email)


def _read_outbound_paused() -> bool:
    """Outbound is "paused" when the centralized
    ``outbound_emails_enabled`` flag is explicitly False.  Defaults
    to True (outbound on) — a flag-read glitch can never accidentally
    block real emails.
    """
    try:
        doc = _get_sync_db().feature_flags.find_one(
            {"_id": "singleton"}, {"outbound_emails_enabled": 1}
        ) or {}
        enabled = doc.get("outbound_emails_enabled", True)
        return enabled is False
    except Exception as e:  # noqa: BLE001
        logger.warning("feature_flag read failed in suppression layer: %s", e)
        return False


def _log_suppressed(to_email: str, subject: str, kind: str, reason: str) -> None:
    try:
        _get_sync_db().email_logs.insert_one({
            "log_id": uuid.uuid4().hex[:12],
            "to": to_email,
            "subject": subject or "",
            "kind": kind or "unknown",
            "sent_at": datetime.now(timezone.utc),
            "status": "suppressed",
            "error": None,
            "resend_id": None,
            "suppress_reason": reason,
        })
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to log suppressed email: %s", e)


def _queue_in_app_notification(to_email: str, subject: str, kind: str) -> None:
    """Drop an in-app notification row so the user still hears from us
    when outbound is paused.  Silently no-op when we can't find the
    user (system addresses, test domains, etc.)."""
    try:
        user = _get_sync_db().users.find_one(
            {"email": to_email}, {"user_id": 1}
        )
        if not user:
            return
        _get_sync_db().notifications.insert_one({
            "notification_id": uuid.uuid4().hex[:12],
            "user_id": user["user_id"],
            "kind": "email_substitute",
            "title": subject or "Update from Shelfsort",
            "body": (
                "Heads-up: an email we'd normally send was paused "
                "to save Resend quota. The full message is in your "
                "notification feed."
            ),
            "meta": {"original_email_kind": kind, "original_subject": subject},
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to queue in-app fallback notification: %s", e)


def _patched_send(params: dict[str, Any]):
    """Wrapper with the same signature as ``resend.Emails.send``."""
    to = params.get("to")
    if isinstance(to, list) and to:
        to_email = str(to[0])
    elif isinstance(to, str):
        to_email = to
    else:
        return _ORIGINAL_SEND(params)

    subject = params.get("subject", "")
    # Optional kind hint from call sites.  Pop before forwarding so
    # Resend doesn't reject the extra field.
    kind = params.pop("_kind", "unknown") if isinstance(params, dict) else "unknown"

    # Gate 1: test recipients never hit Resend
    if _is_test_recipient(to_email):
        logger.info("email suppression: test recipient %s — Resend skipped", to_email)
        _log_suppressed(to_email, subject, kind, "test_recipient")
        return {"id": f"suppressed-test-{uuid.uuid4().hex[:8]}"}

    # Gate 2: admin paused outbound (emergency brake)
    if _read_outbound_paused():
        logger.info(
            "email suppression: outbound_paused flag on — %s queued as in-app",
            to_email,
        )
        _log_suppressed(to_email, subject, kind, "outbound_paused")
        _queue_in_app_notification(to_email, subject, kind)
        return {"id": f"suppressed-paused-{uuid.uuid4().hex[:8]}"}

    # All gates clear — proceed with the real Resend send
    return _ORIGINAL_SEND(params)


def install() -> None:
    """Monkey-patch ``resend.Emails.send`` once."""
    global _INSTALLED, _ORIGINAL_SEND
    if _INSTALLED:
        return
    _ORIGINAL_SEND = resend.Emails.send
    resend.Emails.send = _patched_send  # type: ignore[assignment]
    _INSTALLED = True
    logger.info(
        "Email suppression installed — test-recipient skip + outbound-pause flag active"
    )
