"""Parse the project CHANGELOG into structured entries for the
``/admin/changelog`` card (2026-06-22).

The CHANGELOG file at ``/app/memory/CHANGELOG.md`` follows a
strict convention: every entry begins with an H2 heading shaped
like ``## YYYY-MM-DD (slug) — title``.  We slice on those H2s and
hand each entry back as a small dict the frontend can render
without further string-mangling.

Read-only — never mutates the file.  Limit defaults conservatively
so the admin card stays snappy even when the changelog grows to
hundreds of entries.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

CHANGELOG_PATH = Path("/app/memory/CHANGELOG.md")
MAX_ENTRIES_HARD_CAP = 100  # ceiling regardless of the ``limit`` query param

# Every changelog H2 looks like: ``## 2026-06-22 (some-slug) — Title``.
# The em-dash separator is consistent across the file; if a future entry
# uses an ASCII ``--`` we still match it (the [—-]+ class covers both).
_H2_HEADER = re.compile(
    r"^##\s+(?P<date>\d{4}-\d{2}-\d{2})\s*(?:\((?P<slug>[^)]+)\))?\s*[—\-]+\s*(?P<title>.+?)\s*$",
    re.MULTILINE,
)


def get_changelog_entries(limit: int = 20) -> Dict[str, Any]:
    """Return the most-recent ``limit`` entries from the CHANGELOG.

    Order: the file is append-at-top (new entries are inserted at
    line ~9), so we take the first N matches we find — they're
    already the newest.
    """
    limit = max(1, min(limit, MAX_ENTRIES_HARD_CAP))

    try:
        text = CHANGELOG_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        return {"entries": [], "error": str(exc), "path": str(CHANGELOG_PATH)}

    headers = list(_H2_HEADER.finditer(text))
    entries: List[Dict[str, Any]] = []
    for i, m in enumerate(headers[:limit]):
        start = m.end()
        end = headers[i + 1].start() if (i + 1) < len(headers) else len(text)
        body = text[start:end].strip()
        # Trim noisy horizontal-rule separators that close each entry.
        body = re.sub(r"\n*-{3,}\s*$", "", body).rstrip()
        entries.append({
            "date":  m.group("date"),
            "slug":  m.group("slug") or "",
            "title": m.group("title").strip(),
            "body":  body,
            "lines": body.count("\n") + 1 if body else 0,
        })
    return {
        "entries":      entries,
        "total_in_file": len(headers),
        "returned":     len(entries),
        "limit":        limit,
        "path":         str(CHANGELOG_PATH),
    }
