"""Admin "What's new in Shelfsort" feed.

Parses ``/app/memory/CHANGELOG.md`` and exposes the most recent N
entries as JSON for the AdminHelp page's top-of-page changelog feed.

The CHANGELOG is the source-of-truth dev log; surfacing it inside the
app turns it into a passive "what shipped this week" check-in for
operators without requiring a separate CMS or Notion page.

Format expected (newest at top):

    ## 2026-06-20 — Title here ✅

    Body paragraph or **subhead**
    - bullet 1
    - bullet 2

    ---

    ## 2026-06-19 — Older entry 🔧
    ...

Multiple entries on the same date use an optional ``(later)`` /
``(part 2)`` suffix which we preserve in the title.

Cache: in-memory, 5 minutes. Invalidated on file mtime change.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime
from typing import Optional

from fastapi import Depends, Query
from pydantic import BaseModel

from deps import api_router
from auth_dep import require_admin
from models import User


CHANGELOG_PATH = "/app/memory/CHANGELOG.md"
_CACHE_TTL_SEC = 300

# Module-level cache: (entries, parsed_at_ts, source_mtime)
_cache: dict = {"entries": None, "ts": 0.0, "mtime": 0.0}

# Heading: "## 2026-06-20 (optional) — Title here ✅"
_HEADING_RE = re.compile(
    r"^##\s+(?P<date>\d{4}-\d{2}-\d{2})(?:\s*\((?P<suffix>[^)]+)\))?\s*[—\-]+\s*(?P<title>.+?)\s*$"
)
_STATUS_EMOJI_RE = re.compile(r"([\u2705\u26A0\U0001F527\U0001F525\U0001F389\U0001F6E0\U0001F4E6\U0001F4A1])\s*$")


class WhatsNewEntry(BaseModel):
    date: str  # ISO YYYY-MM-DD
    suffix: Optional[str] = None  # "(later)" / "(part 2)"
    title: str  # Title without trailing emoji
    status_emoji: Optional[str] = None  # Trailing emoji if present
    slug: str  # URL-safe anchor
    body_preview: str  # First ~6 non-empty lines, raw markdown bullets preserved
    body_full: str  # Full body markdown for the "expand" view


class WhatsNewResponse(BaseModel):
    entries: list[WhatsNewEntry]
    total: int
    cached_at: str  # ISO timestamp the cache was last refreshed
    source_mtime: str  # ISO mtime of CHANGELOG.md when parsed


def _slugify(date: str, title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]
    return f"{date}-{base}" if base else date


def _parse_changelog(text: str) -> list[WhatsNewEntry]:
    """Split the changelog on horizontal rules and parse each section.

    The very first "section" before any ``---`` is the file header
    (title + intro lines) — we skip it because it has no ``##`` heading.
    """
    # Normalize line endings, drop the file header above the first ---
    blocks = re.split(r"\n---+\n", text)
    entries: list[WhatsNewEntry] = []
    for block in blocks:
        lines = block.strip().split("\n")
        # Find the first ## heading line
        heading_idx = None
        for i, ln in enumerate(lines):
            if ln.startswith("## "):
                heading_idx = i
                break
        if heading_idx is None:
            continue
        m = _HEADING_RE.match(lines[heading_idx])
        if not m:
            continue
        date = m.group("date")
        suffix = m.group("suffix")
        raw_title = m.group("title").strip()
        emoji_m = _STATUS_EMOJI_RE.search(raw_title)
        status_emoji = None
        title = raw_title
        if emoji_m:
            status_emoji = emoji_m.group(1)
            title = raw_title[: emoji_m.start()].rstrip()
        body_lines = [ln.rstrip() for ln in lines[heading_idx + 1 :]]
        # Strip leading blank lines
        while body_lines and not body_lines[0].strip():
            body_lines.pop(0)
        body_full = "\n".join(body_lines).strip()
        # Preview = first 6 non-empty lines
        preview_lines: list[str] = []
        for ln in body_lines:
            if not ln.strip():
                if preview_lines:
                    preview_lines.append("")  # preserve paragraph break
                continue
            preview_lines.append(ln)
            if len([x for x in preview_lines if x.strip()]) >= 6:
                break
        body_preview = "\n".join(preview_lines).strip()
        entries.append(
            WhatsNewEntry(
                date=date,
                suffix=suffix,
                title=title,
                status_emoji=status_emoji,
                slug=_slugify(date, title),
                body_preview=body_preview,
                body_full=body_full,
            )
        )
    return entries


def _load_entries() -> tuple[list[WhatsNewEntry], float]:
    """Return (entries, source_mtime). Cached with TTL + mtime invalidation."""
    now = time.time()
    try:
        mtime = os.path.getmtime(CHANGELOG_PATH)
    except OSError:
        return [], 0.0
    cached = _cache.get("entries")
    if (
        cached is not None
        and (now - _cache["ts"]) < _CACHE_TTL_SEC
        and _cache["mtime"] == mtime
    ):
        return cached, mtime
    try:
        with open(CHANGELOG_PATH, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return [], mtime
    parsed = _parse_changelog(text)
    _cache["entries"] = parsed
    _cache["ts"] = now
    _cache["mtime"] = mtime
    return parsed, mtime


@api_router.get("/admin/whats-new", response_model=WhatsNewResponse)
async def admin_whats_new(
    limit: int = Query(5, ge=1, le=50),
    _user: User = Depends(require_admin),
):
    """Return the N most recent CHANGELOG entries for the admin Help feed."""
    entries, mtime = _load_entries()
    return WhatsNewResponse(
        entries=entries[:limit],
        total=len(entries),
        cached_at=datetime.fromtimestamp(_cache["ts"]).isoformat() if _cache["ts"] else "",
        source_mtime=datetime.fromtimestamp(mtime).isoformat() if mtime else "",
    )
