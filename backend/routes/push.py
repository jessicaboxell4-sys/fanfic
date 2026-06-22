"""Web Push (VAPID) — cross-device push notifications.

Used to bridge the "you stopped reading on laptop, here's the resume
prompt on your phone" handoff: when the Reader's tab visibility
flips to hidden after recent progress, the frontend posts the active
book_id + current cursor + the device_id of the closing tab to the
backend.  The backend then sends a Web Push to every push
subscription belonging to that user *other than* the closing device.

Public surface:

* ``GET  /api/push/vapid-public-key`` — public key the browser uses
  during ``PushManager.subscribe``.
* ``POST /api/push/subscribe`` — register an endpoint + p256dh + auth.
* ``POST /api/push/unsubscribe`` — drop a subscription.
* ``POST /api/push/handoff`` — fired by the Reader tab on
  visibilitychange; pushes a "Continue reading on …" notification
  to every other live subscription belonging to the same user.

Subscription doc shape::

    {
      user_id, device_id, device_label, endpoint,
      keys: {p256dh, auth}, created_at, last_sent_at,
    }
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from pywebpush import webpush, WebPushException

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_PEM = os.environ.get("VAPID_PRIVATE_KEY_PEM", "").encode("ascii") if os.environ.get("VAPID_PRIVATE_KEY_PEM") else b""
VAPID_SUB = os.environ.get("VAPID_CONTACT_EMAIL", "mailto:noreply@shelfsort.com")


# ---------------------------------------------------------------------
# Public key bootstrap
# ---------------------------------------------------------------------

@api_router.get("/push/vapid-public-key")
async def vapid_public_key():
    """Browser fetches this on permission grant and passes it into
    ``PushManager.subscribe({applicationServerKey})``."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push not configured")
    return {"public_key": VAPID_PUBLIC_KEY}


# ---------------------------------------------------------------------
# Subscription CRUD
# ---------------------------------------------------------------------

class PushKeys(BaseModel):
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=80)


class SubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=500)
    keys: PushKeys
    device_id: str = Field("", max_length=64)
    device_label: str = Field("", max_length=120)


@api_router.post("/push/subscribe")
async def push_subscribe(body: SubscribeBody, user: User = Depends(get_current_user)):
    """Idempotently store a Web Push subscription for the caller."""
    await db.push_subscriptions.update_one(
        {"endpoint": body.endpoint},
        {"$set": {
            "user_id":      user.user_id,
            "device_id":    body.device_id,
            "device_label": body.device_label,
            "endpoint":     body.endpoint,
            "keys":         body.keys.model_dump(),
            "created_at":   datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


class UnsubBody(BaseModel):
    endpoint: str


@api_router.post("/push/unsubscribe")
async def push_unsubscribe(body: UnsubBody, user: User = Depends(get_current_user)):
    res = await db.push_subscriptions.delete_one(
        {"endpoint": body.endpoint, "user_id": user.user_id},
    )
    return {"ok": True, "deleted": res.deleted_count}


# ---------------------------------------------------------------------
# Send helper
# ---------------------------------------------------------------------

async def _send_one(sub: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    """Best-effort single-subscription send.  Returns True on success.
    410/404 from the push service means the subscription is gone — we
    delete it so we don't keep retrying."""
    if not VAPID_PRIVATE_PEM:
        return False
    try:
        webpush(
            subscription_info={
                "endpoint": sub["endpoint"],
                "keys": sub.get("keys") or {},
            },
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_PEM,
            vapid_claims={"sub": VAPID_SUB},
        )
        await db.push_subscriptions.update_one(
            {"_id": sub["_id"]},
            {"$set": {"last_sent_at": datetime.now(timezone.utc).isoformat()}},
        )
        return True
    except WebPushException as e:  # noqa: BLE001
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            await db.push_subscriptions.delete_one({"_id": sub["_id"]})
        else:
            logger.warning("webpush send failed: %s", e)
        return False


async def send_push_to_user(
    user_id: str,
    *,
    title: str,
    body: str,
    url: str = "/",
    exclude_device_id: Optional[str] = None,
) -> Dict[str, int]:
    """Send a push to every subscription of ``user_id`` except the one
    whose ``device_id`` matches ``exclude_device_id``.  Returns
    ``{sent, failed}`` counts."""
    if not user_id:
        return {"sent": 0, "failed": 0}
    q: Dict[str, Any] = {"user_id": user_id}
    if exclude_device_id:
        q["device_id"] = {"$ne": exclude_device_id}
    sent = 0
    failed = 0
    cursor = db.push_subscriptions.find(q)
    payload = {"title": title, "body": body, "url": url}
    async for s in cursor:
        ok = await _send_one(s, payload)
        if ok:
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed}


# ---------------------------------------------------------------------
# Handoff endpoint — fired by the Reader on visibilitychange
# ---------------------------------------------------------------------

class HandoffBody(BaseModel):
    book_id: str = Field(..., max_length=64)
    closing_device_id: str = Field("", max_length=64)
    closing_device_label: str = Field("", max_length=120)
    percent: float = Field(0.0, ge=0.0, le=1.0)


@api_router.post("/push/handoff")
async def push_reading_handoff(body: HandoffBody, user: User = Depends(get_current_user)):
    """Called by the Reader when its tab goes hidden after recent
    progress.  Pings every other device the user has registered."""
    book = await db.books.find_one(
        {"book_id": body.book_id, "user_id": user.user_id},
        {"_id": 0, "title": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    title = book.get("title", "your book")
    pct_txt = f" ({int(body.percent * 100)}%)" if body.percent > 0 else ""
    from_label = body.closing_device_label or "another device"
    result = await send_push_to_user(
        user.user_id,
        title="Resume reading?",
        body=f"You were on \u201c{title}\u201d{pct_txt} on {from_label}.",
        url=f"/read/{body.book_id}",
        exclude_device_id=body.closing_device_id or None,
    )
    return {"ok": True, **result}


__all__ = []
