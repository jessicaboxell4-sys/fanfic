"""Detect fanfic completion status (complete vs ongoing) at upload time.

Pure, deterministic, no I/O. Persists to `books.status` so the
complete/ongoing shelves can filter without re-reading EPUBs.

Signal order (first hit wins):
  1. Explicit "Status:" line in EPUB metadata / description — most
     fanfic exporters (FanFicFare, FicHub, AO3 download) inject one of
     "Status: Complete", "Status: In-Progress", "Status: Updated:".
  2. Tags — user/auto tags like `complete`, `wip`, `ongoing`,
     `in-progress`, `abandoned`, `discontinued`, `hiatus`.
  3. Heuristic A — "TBC" or "to be continued" anywhere in description.
  4. Heuristic B — "Chapter X of Y" with X < Y in title or description.

When none of the above match we default to "complete" — most uploaded
books are published novels (Originals) where ongoing has no meaning,
and ambiguous fanfic shouldn't keep the user staring at a WIP shelf
that's mostly false positives.
"""

import re
from typing import Iterable, Optional


# Possible status values written to `books.status` and `books.manual_status`.
COMPLETE = "complete"
ONGOING = "ongoing"


# ---------------------------------------------------------------------------
# Signal 1: explicit "Status:" line
# ---------------------------------------------------------------------------
# Matches "Status: Complete", "Status: Completed", "Status: In-Progress",
# "Status: In Progress", "Status: Ongoing", "Status: Updated: 2024-01-…",
# "Status: Abandoned", "Status: Hiatus", "Status: WIP" — case-insensitive.
_STATUS_LINE_RE = re.compile(
    r"\bstatus\s*[:=]\s*([A-Za-z][A-Za-z\- ]*)",
    re.IGNORECASE,
)

# Status keywords → bucket. Anything missing here is treated as ongoing
# because the explicit signal "this fic has a status field that says X"
# is strongest, and "Updated", "WIP", etc. are all ongoing markers.
_STATUS_KEYWORD_MAP = {
    "complete": COMPLETE,
    "completed": COMPLETE,
    "finished": COMPLETE,
    "done": COMPLETE,
    "in-progress": ONGOING,
    "in progress": ONGOING,
    "inprogress": ONGOING,
    "ongoing": ONGOING,
    "updating": ONGOING,
    "updated": ONGOING,
    "wip": ONGOING,
    "abandoned": ONGOING,    # treat as ongoing — never finished
    "discontinued": ONGOING,
    "hiatus": ONGOING,
    "on hiatus": ONGOING,
    "paused": ONGOING,
}


def _from_status_line(text: str) -> Optional[str]:
    if not text:
        return None
    m = _STATUS_LINE_RE.search(text)
    if not m:
        return None
    keyword = m.group(1).strip().lower()
    # "Updated: 2024-01-15" — strip everything after the first colon or space
    # so the lookup still matches the keyword bucket.
    for sep in (":", " - ", " · "):
        if sep in keyword:
            keyword = keyword.split(sep, 1)[0].strip()
            break
    keyword = keyword.strip("-:. ")
    return _STATUS_KEYWORD_MAP.get(keyword)


# ---------------------------------------------------------------------------
# Signal 2: tags
# ---------------------------------------------------------------------------
# Tags are stored slugified (lowercase, hyphens). Matching is exact —
# we never substring-match "complete" against "completely-incomplete".
_TAG_TO_STATUS = {
    "complete": COMPLETE,
    "completed": COMPLETE,
    "finished": COMPLETE,
    "wip": ONGOING,
    "ongoing": ONGOING,
    "in-progress": ONGOING,
    "in-process": ONGOING,
    "work-in-progress": ONGOING,
    "abandoned": ONGOING,
    "discontinued": ONGOING,
    "hiatus": ONGOING,
    "on-hiatus": ONGOING,
}


def _from_tags(tags: Iterable[str]) -> Optional[str]:
    if not tags:
        return None
    # Iterate so "complete" beats "wip" only when "complete" is checked
    # first in dict order — both Python and the typical user intent agree
    # that an explicit "completed" tag should win.
    for t in tags:
        slug = (t or "").strip().lower()
        if slug in _TAG_TO_STATUS:
            return _TAG_TO_STATUS[slug]
    return None


# ---------------------------------------------------------------------------
# Signal 3: "TBC" / "to be continued" heuristic
# ---------------------------------------------------------------------------
# Anchored to word boundaries so we don't false-match "TBChamber" or similar.
_TBC_RE = re.compile(
    r"\b(?:to\s+be\s+continued|tbc)\b\.?",
    re.IGNORECASE,
)


def _has_tbc_marker(text: str) -> bool:
    return bool(text and _TBC_RE.search(text))


# ---------------------------------------------------------------------------
# Signal 4: "Chapter X of Y" heuristic
# ---------------------------------------------------------------------------
# Matches "Chapter 5 of 12", "Ch. 5/12", "Part 3 of 10", "5 of 12 chapters".
# We treat X < Y as ongoing. X >= Y is inconclusive (could be a re-read
# count, could be a literal index that says "we're at the end") so we
# return None and let later signals / the default decide.
_CHAPTER_OF_RES = [
    re.compile(r"\b(?:chapter|ch\.?|part)\s*(\d+)\s*(?:of|/)\s*(\d+)\b", re.IGNORECASE),
    re.compile(r"\b(\d+)\s*of\s*(\d+)\s+chapters?\b", re.IGNORECASE),
]


def _from_chapter_count(text: str) -> Optional[str]:
    if not text:
        return None
    for pat in _CHAPTER_OF_RES:
        m = pat.search(text)
        if m:
            try:
                cur, total = int(m.group(1)), int(m.group(2))
            except ValueError:
                continue
            if 0 < cur < total:
                return ONGOING
            if cur >= total > 0:
                return COMPLETE
    return None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def detect_status(
    *,
    title: Optional[str] = None,
    description: Optional[str] = None,
    raw_meta_text: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
) -> str:
    """Return `"complete"` or `"ongoing"`. Never returns None — see module
    docstring for the default-to-complete rationale.

    Inputs are all optional so callers can pass whatever they have.
    Status-line search is run against `raw_meta_text || description ||
    title` (concatenated); the chapter-count heuristic is run against
    `title + description` so a "Chapter 5 of 12" title takes priority.
    """
    haystack_parts = [s for s in (raw_meta_text, description, title) if s]
    haystack = "\n".join(haystack_parts) if haystack_parts else ""

    s = _from_status_line(haystack)
    if s:
        return s

    s = _from_tags(tags or [])
    if s:
        return s

    # Chapter-count is stronger than TBC because it's quantitative.
    s = _from_chapter_count((title or "") + "\n" + (description or ""))
    if s:
        return s

    if _has_tbc_marker(haystack):
        return ONGOING

    return COMPLETE


def effective_status(book: dict) -> str:
    """Return the status the UI should show for a book, honoring the
    user's manual override (`manual_status`) when set.

    Centralized so every endpoint computes the same value and the
    `manual_status` field never gets accidentally bypassed.
    """
    ms = (book.get("manual_status") or "").lower()
    if ms in (COMPLETE, ONGOING):
        return ms
    s = (book.get("status") or "").lower()
    if s in (COMPLETE, ONGOING):
        return s
    return COMPLETE
