"""Admin "unknown fanfic sources" queue routes — extracted from
``routes/books.py`` in the Phase 6C-A refactor (2026-07-XX).

Routes:
    GET    /api/admin/unknown-sources
    DELETE /api/admin/unknown-sources/{host}
    POST   /api/admin/unknown-sources
    PATCH  /api/admin/unknown-sources/{host}/mark-accepted

These endpoints let the platform owner review "new" host URLs users
have pasted or uploaded so they can be added to the accepted-fanfic-
sources canonicaliser. Global state (not per-user).
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router
from models import User
from auth_dep import require_admin
from utils.admin_audit import record_admin_action

from routes.books import (
    classify_ao3_non_work,
)


@api_router.get("/admin/unknown-sources")
async def list_unknown_sources(
    since: Optional[str] = None,
    user: User = Depends(require_admin),
):
    """Return every story-shaped URL host that's NOT on the accepted-sources
    list but has been pasted/uploaded by ANY user. Sorted by ``last_seen``
    descending so newly-spotted hosts surface first.

    Used by the Shelfsort dev (the agent reviewing this codebase) to
    decide which hosts to add to ``utils/url_canonical``. Returns:
      * ``host`` — the de-subdomain'd root host (e.g. ``scribblehub.com``)
      * ``hit_count`` — total times we saw a URL on this host
      * ``contexts`` — dict of {upload|paste|claim → count}
      * ``samples`` — up to 5 sample full URLs (most recent)
      * ``first_seen`` / ``last_seen``
      * ``last_book_title`` / ``last_book_author`` / ``last_book_id`` (upload-only)

    Optional ``?since=<iso8601>`` filters to hosts seen on/after the
    timestamp so the agent can poll for "what's new this session".
    Authentication is required; data is global (not per-user) because
    the accepted-list lives at the codebase level.
    """
    query: Dict[str, Any] = {}
    if since:
        try:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["last_seen"] = {"$gte": cutoff}
        except ValueError:
            pass  # silently ignore malformed cutoff
    cursor = db.unknown_sources.find(query, {"_id": 0}).sort("last_seen", -1)
    rows = await cursor.to_list(500)
    for r in rows:
        for k in ("first_seen", "last_seen"):
            v = r.get(k)
            if isinstance(v, datetime):
                r[k] = v.isoformat()
    return {"count": len(rows), "hosts": rows}


@api_router.delete("/admin/unknown-sources/{host}")
async def dismiss_unknown_source(host: str, user: User = Depends(require_admin)):
    """Drop a host record after it's been actioned (either added to the
    accepted-sources list or confirmed-not-fanfic). Idempotent — returns
    ``{ok: True, removed: 0|1}``."""
    res = await db.unknown_sources.delete_one({"host": host.lower()})
    if res.deleted_count:
        await record_admin_action(user, "unknown_source.dismiss", target=host.lower())
    return {"ok": True, "removed": res.deleted_count}


class MarkAcceptedBody(BaseModel):
    accepted: bool = True


class AddUnknownSourceBody(BaseModel):
    """Body for ``POST /api/admin/unknown-sources`` — manual queue add.

    The user is vouching for the URL (probably saw it on a new archive a
    friend mentioned), so we bypass the story-shape heuristic. Accepted
    sources are still skipped — no point logging a host the canonicalizer
    already knows about. ``note`` is a free-form comment that lives on
    the host record so the dev knows why it was queued.
    """
    url: str
    note: Optional[str] = None


@api_router.post("/admin/unknown-sources")
async def add_unknown_source_manual(
    body: AddUnknownSourceBody,
    user: User = Depends(require_admin),
):
    """Manually queue a host for review without an EPUB upload trigger.

    Returns ``{ok, host, already_accepted}`` — ``already_accepted=True``
    means the URL canonicalizes to a known source (no record created
    because we already support it). When ``host=None`` the URL parsed
    but we couldn't extract a hostname (e.g. user pasted just a path).
    """
    raw = (body.url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="URL is empty")

    from utils.unknown_sources import (
        record_unknown_sources, _host_of, normalize_fanfic_url,
    )

    # Already-accepted shortcut so the UI can tell the user "no need to
    # queue, we already support this" instead of silently doing nothing.
    if normalize_fanfic_url(raw) or classify_ao3_non_work(raw):
        return {
            "ok": True,
            "already_accepted": True,
            "host": _host_of(raw),
        }

    hosts = await record_unknown_sources(
        db, [raw], context="manual",
        user_id=user.user_id,
        note=body.note,
        skip_heuristic=True,
    )
    if not hosts:
        raise HTTPException(
            status_code=400,
            detail="Couldn't extract a hostname from that URL — please paste a full http(s):// URL.",
        )
    return {"ok": True, "already_accepted": False, "host": hosts[0]}


@api_router.patch("/admin/unknown-sources/{host}/mark-accepted")
async def mark_unknown_source_accepted(
    host: str,
    body: MarkAcceptedBody,
    user: User = Depends(require_admin),
):
    """Flag (or un-flag) an unknown-source host as "user wants this added to
    the accepted-sources list." The flag is purely a signal for the next
    Shelfsort dev session — the host stays in ``unknown_sources`` until
    it's either dismissed (DELETE) or the regex is actually added to
    ``utils/url_canonical.py`` and the host record explicitly dismissed.

    Idempotent; returns the updated host doc.
    """
    host_norm = host.lower()
    now = datetime.now(timezone.utc)
    update = (
        {"$set": {"marked_accepted": True, "marked_accepted_at": now,
                  "marked_accepted_by": user.user_id}}
        if body.accepted else
        {"$unset": {"marked_accepted": "", "marked_accepted_at": "",
                    "marked_accepted_by": ""}}
    )
    res = await db.unknown_sources.update_one({"host": host_norm}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Host not found")
    doc = await db.unknown_sources.find_one({"host": host_norm}, {"_id": 0})
    for k in ("first_seen", "last_seen", "marked_accepted_at"):
        v = doc.get(k) if doc else None
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return {"ok": True, "host": doc}
