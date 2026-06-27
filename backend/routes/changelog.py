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
_GH_RETRY_WORKFLOW = "prod-smoke-canary-retry.yml"
_GH_RUNS_URL = (
    f"https://api.github.com/repos/{_GH_OWNER}/{_GH_REPO}"
    f"/actions/workflows/{_GH_WORKFLOW}/runs?per_page=1"
)
_GH_RETRY_RUNS_URL = (
    f"https://api.github.com/repos/{_GH_OWNER}/{_GH_REPO}"
    f"/actions/workflows/{_GH_RETRY_WORKFLOW}/runs?per_page=1"
)

_CANARY_CACHE: Dict[str, Any] = {"data": None, "fetched_at": 0.0}
_CANARY_CACHE_TTL_S = 300.0  # 5 minutes


async def _fetch_one_workflow_run(client: httpx.AsyncClient, url: str) -> Optional[Dict[str, Any]]:
    """Fetch the latest workflow_run from a given GitHub Actions URL.

    Returns minimal dict or None on any error.  Used by both the
    primary canary fetch and the new retry-workflow fetch (so the
    public caption can distinguish *confirmed* failures from blips
    that the retry workflow is silently recovering).
    """
    try:
        resp = await client.get(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "shelfsort-canary-status/1.0",
            },
        )
        if resp.status_code != 200:
            return None
        runs = (resp.json() or {}).get("workflow_runs") or []
        if not runs:
            return None
        r = runs[0]
        return {
            "conclusion": r.get("conclusion"),
            "status":     r.get("status"),
            "updated_at": r.get("updated_at"),
            "html_url":   r.get("html_url"),
            "run_number": r.get("run_number"),
        }
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def _compute_effective_state(primary: Optional[Dict[str, Any]], retry: Optional[Dict[str, Any]]) -> str:
    """Collapse (primary, retry) into a single public-facing state.

    States used by the changelog caption:
      • "healthy"   — primary's latest run succeeded
      • "retrying"  — primary failed AND retry is in_progress / queued
      • "recovered" — primary failed AND a newer retry succeeded
      • "failing"   — primary failed AND a newer retry also failed
      • "unknown"   — primary status couldn't be fetched
    """
    if not primary:
        return "unknown"
    if primary.get("conclusion") == "success":
        return "healthy"
    # Primary failed (or is still running) — see what the retry says.
    if retry and retry.get("status") in ("in_progress", "queued", "waiting"):
        return "retrying"
    # Both must have finished_at-ish timestamps to compare ordering.
    if retry and retry.get("updated_at") and primary.get("updated_at"):
        if retry["updated_at"] >= primary["updated_at"]:
            return "recovered" if retry.get("conclusion") == "success" else "failing"
    # Primary failed and we have no fresher retry yet — it's either
    # within the 15-min cool-down or the retry workflow isn't wired.
    return "failing"


async def _fetch_canary_status() -> Optional[Dict[str, Any]]:
    """Return the latest canary run as a minimal dict, or ``None`` on error.

    Network errors and rate-limit responses are swallowed deliberately —
    the caption is a nice-to-have, never a blocker for the changelog
    page render.  2026-06-27: also fetches the retry workflow in
    parallel so the response can carry an ``effective_state`` field
    that distinguishes transient blips (status=retrying / recovered)
    from confirmed failures (status=failing).
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            primary, retry = await _asyncio_gather_safe(
                _fetch_one_workflow_run(client, _GH_RUNS_URL),
                _fetch_one_workflow_run(client, _GH_RETRY_RUNS_URL),
            )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    if primary is None:
        return None
    effective = _compute_effective_state(primary, retry)
    return {
        **primary,
        "effective_state": effective,
        "retry": retry,  # full retry-run details (or None) so the FE
                         # can deep-link to the recovery run when shown
    }


async def _asyncio_gather_safe(*coros):
    """Gather coroutines, swallowing exceptions to None.

    Mirrors what the caller used to do when only one fetch existed —
    keeps the caption resilient if one workflow fetch fails (e.g. the
    retry workflow doesn't exist yet on the repo) while the other
    succeeds.
    """
    import asyncio as _asyncio
    results = await _asyncio.gather(*coros, return_exceptions=True)
    return tuple(r if not isinstance(r, BaseException) else None for r in results)


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
async def canary_uptime(days: int = 30, include_daily: bool = False):
    """Aggregate uptime over the last ``days`` days.

    Anon-accessible.  Returns
    ``{available, days, total_runs, pass_count, fail_count, uptime_pct}``.

    ``available`` is False when zero runs have been recorded in the
    window (fresh install, secret not configured, or the canary
    workflow has been silent) so the FE can hide the pill.

    When ``include_daily=true``, also includes a ``daily`` array of
    ``{date, total, pass, fail}`` rows — one per day in the window,
    oldest first.  Powers the public 30-day sparkline on
    ``/changelog`` next to the uptime pill.

    Cached 5 min in-process to keep the public landing surface from
    hammering Mongo on every visit.
    """
    days = max(1, min(int(days), 90))
    cache_key = f"d{days}_daily{int(bool(include_daily))}"
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
        if include_daily:
            # Group runs by UTC calendar day so the FE can render a
            # one-cell-per-day sparkline.  The substr on the ISO
            # ``finished_at`` is fast (string prefix) and avoids
            # parsing the timestamp twice.
            daily_pipeline = [
                {"$match": {"finished_at": {"$gte": cutoff}}},
                {"$project": {
                    "day":    {"$substr": ["$finished_at", 0, 10]},
                    "status": 1,
                }},
                {"$group": {
                    "_id":   "$day",
                    "total": {"$sum": 1},
                    "pass":  {"$sum": {"$cond": [{"$eq": ["$status", "pass"]}, 1, 0]}},
                }},
                {"$sort": {"_id": 1}},
            ]
            day_rows = await db.canary_runs.aggregate(daily_pipeline).to_list(length=days + 5)
            # Build a dense day-by-day array — fill gaps where no
            # canary ran with `total=0` so the sparkline keeps a
            # consistent length and renders an empty slot.
            by_day = {r["_id"]: r for r in day_rows}
            today = datetime.now(timezone.utc).date()
            dense = []
            for i in range(days):
                d = today - _td(days=days - 1 - i)
                key = d.isoformat()
                src = by_day.get(key)
                if src:
                    dense.append({
                        "date":  key,
                        "total": src["total"],
                        "pass":  src["pass"],
                        "fail":  src["total"] - src["pass"],
                    })
                else:
                    dense.append({"date": key, "total": 0, "pass": 0, "fail": 0})
            result["daily"] = dense
    _CANARY_UPTIME_CACHE["data"][cache_key] = result
    _CANARY_UPTIME_CACHE["fetched_at"] = now
    return result
