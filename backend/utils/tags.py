"""Tag normalization helpers shared by the bulk-edit upload pipeline and
the dedicated tags endpoints.

A *tag* is a short, lowercase, hyphenated slug (e.g. ``"slow-burn"``,
``"fluff"``). Anything the user types or that the AI classifier proposes
runs through :func:`normalize_tag` so we get a canonical form before it
ever touches Mongo.

Constants
---------
``TAG_MAX_LENGTH``
    Hard cap on a single tag's length (32 chars).
``TAG_MAX_PER_BOOK``
    Hard cap on the number of tags one book can carry (20). The
    ``/books/{id}/tags`` endpoint refuses to add tags past this limit.
"""
from __future__ import annotations

import re
from typing import Any, List, Optional

TAG_MAX_LENGTH = 32
TAG_MAX_PER_BOOK = 20


def normalize_tag(tag: Any) -> Optional[str]:
    """Lowercase, hyphenate, strip. Returns ``None`` for empty/invalid input.

    Examples
    --------
    >>> normalize_tag("Slow Burn!")
    'slow-burn'
    >>> normalize_tag("  ")
    >>> normalize_tag("WIP")
    'wip'
    """
    if not tag:
        return None
    s = str(tag).strip().lower()
    if not s:
        return None
    # Collapse whitespace -> hyphen; remove disallowed punctuation.
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9\-_]", "", s)
    s = s.strip("-_")
    if not s:
        return None
    return s[:TAG_MAX_LENGTH]


def normalize_tags(raw: Any) -> List[str]:
    """Take a list-like (or comma-separated string) and return a clean,
    de-duped, capped list of tag slugs.

    The cap is :data:`TAG_MAX_PER_BOOK`; extras are silently dropped.
    """
    if not raw:
        return []
    if isinstance(raw, str):
        # Allow comma- or semicolon-separated strings too.
        raw = [p for p in re.split(r"[,;]", raw) if p.strip()]
    out: List[str] = []
    seen: set = set()
    for t in raw:
        n = normalize_tag(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
            if len(out) >= TAG_MAX_PER_BOOK:
                break
    return out


# Legacy names — keep the underscore-prefixed exports so existing callers
# in books.py (and any external code mid-refactor) keep working.
_normalize_tag = normalize_tag
_normalize_tags = normalize_tags
