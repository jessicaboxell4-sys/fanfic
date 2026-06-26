"""Public changelog endpoint — amplifies community contributions.

Two sections returned:
  1. ``community_shipped`` — Suggestions with ``status=done`` shipped
     on/after ``SHIPPED_CREDIT_CUTOFF`` (forward-only, per operator
     choice 2026-06-27).  Each entry includes the submitter's @handle
     when the user has opted into the public directory, otherwise the
     suggestion is anonymized.
  2. ``engineering_log`` — Parsed dated sections from
     ``/app/memory/CHANGELOG.md`` so the public site can show the
     "what shipped when" timeline without exposing the raw markdown.

Public — no auth required, deliberately so unauthenticated visitors
can see the responsiveness flywheel and feel invited to contribute.
"""
from __future__ import annotations

import re
import time as _time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from deps import db, api_router, ROOT_DIR


# Forward-only cutoff for the credit email + the community-shipped
# panel.  Suggestions shipped BEFORE this date are excluded — the
# operator opted not to retroactively credit historical work on
# 2026-06-27.
SHIPPED_CREDIT_CUTOFF = datetime(2026, 6, 25, 0, 0, 0, tzinfo=timezone.utc)

# Parse "## YYYY-MM-DD — Title ✅" headings.  The ✅ is optional so a
# work-in-progress entry without the checkmark still renders.
_CHANGELOG_HEADING_RE = re.compile(
    r"^##\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+?)\s*$",
    re.MULTILINE,
)

_CHANGELOG_PATH = Path("/app/memory/CHANGELOG.md")
# In-process cache so we're not re-reading the file on every page view.
# 5 min is the right TTL — operator edits CHANGELOG.md by hand and
# refreshes are rare; we can wait a few minutes for the cache to clear.
_CHANGELOG_CACHE: Dict[str, Any] = {"entries": None, "fetched_at": 0.0}
_CHANGELOG_CACHE_TTL_S = 300.0


def _parse_changelog_md(text: str, *, limit: int = 25) -> List[Dict[str, Any]]:
    """Pull dated sections out of CHANGELOG.md as plain-text records.

    Each entry: ``{date: "YYYY-MM-DD", title: str, body: str}``.
    The body is the markdown block between headings, stripped of
    leading/trailing whitespace.  Returned newest-first, capped at
    ``limit`` so the JSON payload stays bounded.
    """
    headings = list(_CHANGELOG_HEADING_RE.finditer(text))
    entries: List[Dict[str, Any]] = []
    for i, m in enumerate(headings):
        date = m.group(1)
        title = m.group(2).strip()
        body_start = m.end()
        body_end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        body = text[body_start:body_end].strip()
        entries.append({"date": date, "title": title, "body": body})
    # Sort newest-first (string sort works on ISO dates).
    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries[:limit]


async def _load_changelog_cached(limit: int = 25) -> List[Dict[str, Any]]:
    """Parse + cache the changelog markdown."""
    import time as _t
    now = _t.monotonic()
    if (
        _CHANGELOG_CACHE["entries"] is not None
        and (now - _CHANGELOG_CACHE["fetched_at"]) < _CHANGELOG_CACHE_TTL_S
    ):
        return _CHANGELOG_CACHE["entries"][:limit]
    try:
        text = _CHANGELOG_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    entries = _parse_changelog_md(text, limit=limit)
    _CHANGELOG_CACHE["entries"] = entries
    _CHANGELOG_CACHE["fetched_at"] = now
    return entries


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@api_router.get("/changelog")
async def public_changelog():
    """Public changelog feed — engineering log + recent shipped suggestions
    with @handle credit (forward-only, opt-in handles only)."""

    # ---- 1. Community-shipped (forward-only) -------------------------------
    cutoff_iso = SHIPPED_CREDIT_CUTOFF.isoformat()
    shipped_rows = await db.suggestions.find(
        {
            "status": "done",
            # ``shipped_at`` is the timestamp we set when admin marks a
            # suggestion as done (see admin_update in suggestions.py).
            # ``$gte`` ensures we never expose pre-cutoff work.
            "shipped_at": {"$gte": cutoff_iso},
        },
        {
            "_id": 0,
            "suggestion_id": 1, "title": 1, "category": 1,
            "shipped_at": 1, "submitter_user_id": 1,
            "admin_note": 1,
        },
    ).sort("shipped_at", -1).limit(50).to_list(50)

    # Look up handles in a single roundtrip — only users with a
    # ``username`` get a public credit; everyone else stays anonymous.
    submitter_ids = list({r["submitter_user_id"] for r in shipped_rows if r.get("submitter_user_id")})
    user_rows = await db.users.find(
        {
            "user_id": {"$in": submitter_ids},
            "username":         {"$nin": [None, ""]},
            # Respect the directory opt-out — if a user hid themselves
            # from search, also hide them from credits.
            "hidden_from_search": {"$ne": True},
        },
        {"_id": 0, "user_id": 1, "username": 1},
    ).to_list(length=len(submitter_ids) or 1)
    handle_by_uid = {u["user_id"]: u["username"] for u in user_rows}

    community_shipped: List[Dict[str, Any]] = []
    for r in shipped_rows:
        handle = handle_by_uid.get(r.get("submitter_user_id"))
        community_shipped.append({
            "title":      r.get("title", ""),
            "category":   r.get("category", ""),
            "shipped_at": r.get("shipped_at"),
            "handle":     handle,  # None → anonymous credit
            "admin_note": r.get("admin_note") or "",
        })

    # ---- 2. Engineering log ------------------------------------------------
    engineering_log = await _load_changelog_cached(limit=25)

    return {
        "community_shipped": community_shipped,
        "engineering_log":   engineering_log,
        "credit_cutoff":     cutoff_iso,
    }


def invalidate_changelog_cache() -> None:
    """Public hook so ``/admin/cache/clear`` and CHANGELOG edits can
    force the next public-changelog read to re-parse the file."""
    _CHANGELOG_CACHE["entries"] = None
    _CHANGELOG_CACHE["fetched_at"] = 0.0


# ---------------------------------------------------------------------------
# Canary status — public trust signal under the shields.io badge
# ---------------------------------------------------------------------------
# We hit GitHub's REST API for the latest run of `prod-smoke-canary.yml`,
# cache it for 5 min, and return just the fields the badge caption needs.
# The repo is public, so no auth token is required — unauthenticated
# GitHub API allows 60 req/hr per IP, which our 5-min cache stays
# under by orders of magnitude (max 12 req/hr per backend instance).

_GH_OWNER = "jessicaboxell4-sys"
_GH_REPO = "fanfic"
_GH_WORKFLOW = "prod-smoke-canary.yml"
_GH_RUNS_URL = (
    f"https://api.github.com/repos/{_GH_OWNER}/{_GH_REPO}"
    f"/actions/workflows/{_GH_WORKFLOW}/runs?per_page=1"
)

_CANARY_CACHE: Dict[str, Any] = {"data": None, "fetched_at": 0.0}
_CANARY_CACHE_TTL_S = 300.0  # 5 minutes


async def _fetch_canary_status() -> Optional[Dict[str, Any]]:
    """Return the latest canary run as a minimal dict, or ``None`` on error.

    Network errors and rate-limit responses are swallowed deliberately —
    the caption is a nice-to-have, never a blocker for the changelog
    page render.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                _GH_RUNS_URL,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "shelfsort-canary-status/1.0",
                },
            )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        runs = payload.get("workflow_runs") or []
        if not runs:
            return None
        run = runs[0]
        return {
            # ``conclusion`` is the final state (success/failure/cancelled);
            # ``status`` describes the lifecycle (completed/in_progress).
            "conclusion": run.get("conclusion"),
            "status":     run.get("status"),
            "updated_at": run.get("updated_at"),
            "html_url":   run.get("html_url"),
            "run_number": run.get("run_number"),
        }
    except (httpx.HTTPError, ValueError, KeyError):
        return None


@api_router.get("/canary/status")
async def canary_status():
    """Latest production smoke canary run summary, cached 5 min.

    Returns ``{"available": False}`` when GitHub is unreachable or
    rate-limited so the frontend can gracefully hide the caption.
    """
    now = _time.monotonic()
    cached = _CANARY_CACHE.get("data")
    if cached is not None and (now - _CANARY_CACHE["fetched_at"]) < _CANARY_CACHE_TTL_S:
        return cached

    data = await _fetch_canary_status()
    if data is None:
        response = {"available": False}
    else:
        response = {"available": True, **data}
    _CANARY_CACHE["data"] = response
    _CANARY_CACHE["fetched_at"] = now
    return response


# ---------------------------------------------------------------------------
# Public canary uptime — anon-safe slice of the admin canary-runs feed
# ---------------------------------------------------------------------------
# Operators run the prod-smoke-canary hourly; each run POSTs a row to
# ``/api/canary/report`` (secret-gated).  ``GET /api/admin/canary-runs``
# returns the full timeline (including log tails) to admins; this
# endpoint exposes ONLY the aggregate uptime percentage + counts so the
# changelog page can surface "99.7% over the last 30 days" as a public
# trust signal.  No log tails, no per-run row data.

_CANARY_UPTIME_CACHE: Dict[str, Any] = {"data": {}, "fetched_at": 0.0}
_CANARY_UPTIME_CACHE_TTL_S = 300.0  # 5 min — matches /canary/status


@api_router.get("/canary/uptime")
async def canary_uptime(days: int = 30):
    """Aggregate uptime over the last ``days`` days.

    Anon-accessible.  Returns
    ``{available, days, total_runs, pass_count, fail_count, uptime_pct}``.

    ``available`` is False when zero runs have been recorded in the
    window (fresh install, secret not configured, or the canary
    workflow has been silent) so the FE can hide the pill.

    Cached 5 min in-process to keep the public landing surface from
    hammering Mongo on every visit.
    """
    days = max(1, min(int(days), 90))
    cache_key = f"d{days}"
    now = _time.monotonic()
    cached = _CANARY_UPTIME_CACHE["data"].get(cache_key)
    if cached is not None and (now - _CANARY_UPTIME_CACHE["fetched_at"]) < _CANARY_UPTIME_CACHE_TTL_S:
        return cached

    from datetime import timedelta as _td
    cutoff = (datetime.now(timezone.utc) - _td(days=days)).isoformat()
    # Count + pass-count in a tiny aggregation so we never load the
    # full row payload (some include 4KB ``tail`` log excerpts).
    pipeline = [
        {"$match": {"finished_at": {"$gte": cutoff}}},
        {"$group": {
            "_id":   None,
            "total": {"$sum": 1},
            "pass":  {"$sum": {"$cond": [{"$eq": ["$status", "pass"]}, 1, 0]}},
        }},
    ]
    rows = await db.canary_runs.aggregate(pipeline).to_list(length=1)
    if not rows or not rows[0].get("total"):
        result = {"available": False, "days": days}
    else:
        total = rows[0]["total"]
        passed = rows[0]["pass"]
        result = {
            "available":   True,
            "days":        days,
            "total_runs":  total,
            "pass_count":  passed,
            "fail_count":  total - passed,
            "uptime_pct":  round((passed / total) * 100.0, 2),
        }
    _CANARY_UPTIME_CACHE["data"][cache_key] = result
    _CANARY_UPTIME_CACHE["fetched_at"] = now
    return result
