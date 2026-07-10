"""Heuristics for the "Polish my library" bulk action (2026-06-16).

Given a book document from Mongo, decide whether the title and/or author
fields look "messy" enough that we should suggest a cleanup. Return a single
`PolishSuggestion` dict the API can ship to the frontend preview UI.

Why this lives in its own module
--------------------------------
`routes/books.py` is already nearly 5000 lines (Phase-6 refactor on the
backlog). Keeping these pure-function heuristics outside that file makes
them straightforward to unit-test and easy to retire / tune.

Heuristics — by design erring on the side of *not* suggesting a change. A
silent no-op is far better UX than a false "fix" that mangles a real title.
"""
from __future__ import annotations
import re
from typing import Dict, Optional, Tuple
from urllib.parse import urlparse


_GENERIC_TITLES = {"", "unknown", "untitled", "no title", "n/a", "na"}
_GENERIC_AUTHORS = {
    "", "unknown", "unknown author", "no author", "anonymous", "anon",
    "n/a", "na",
}

# Title clearly looks like an upload artefact — file extension, leading
# digits, underscore-heavy filename pattern, or a plain copy of the book_id.
_FILENAME_LOOKING = re.compile(r"\.epub$|_{2,}|^[A-Z0-9_]{6,}$", re.IGNORECASE)
_LEADING_DIGITS = re.compile(r"^\s*\d{3,}\s*[-_]?\s*")

# Small / lowercase words that should NOT be title-cased unless at start.
_LOWERCASE_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
    "of", "on", "or", "the", "to", "vs", "vs.",
}


def _smart_titlecase(s: str) -> str:
    """Title-case but keep articles / prepositions lowercase mid-string."""
    words = s.split()
    out = []
    for i, w in enumerate(words):
        # Preserve all-caps short tokens (POV, AU, BNHA, …).
        if 2 <= len(w) <= 5 and w.isupper():
            out.append(w)
            continue
        lower = w.lower()
        if i > 0 and lower in _LOWERCASE_WORDS:
            out.append(lower)
        else:
            out.append(lower[:1].upper() + lower[1:])
    return " ".join(out)


def _clean_title(raw: str) -> str:
    """Best-effort cleanup of a messy title string."""
    s = raw or ""
    s = re.sub(r"\.epub$", "", s, flags=re.IGNORECASE)
    s = s.replace("_", " ")
    s = _LEADING_DIGITS.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    # If the result is all-caps and longer than a few characters, lowercase it
    # first so smart-titlecase can do its job.
    if len(s) > 4 and s == s.upper():
        s = s.lower()
    return _smart_titlecase(s)


def _author_from_source_url(url: str) -> Optional[str]:
    """Extract the author handle from an AO3 / FFNet source URL.

    Returns None if the URL doesn't have a recognisable user / author handle.
    """
    if not url:
        return None
    try:
        u = urlparse(url)
    except Exception:
        return None
    host = (u.hostname or "").lower()
    path = u.path or ""

    # AO3:  /users/{handle}/works/{id}   or   /users/{handle}/pseuds/...
    if "archiveofourown.org" in host:
        m = re.search(r"/users/([^/]+)/", path)
        if m:
            return m.group(1).replace("_", " ")

    # FFNet: /u/{user_id}/{handle}   (we use handle if present, else id)
    if "fanfiction.net" in host:
        m = re.search(r"/u/(\d+)(?:/([^/?#]+))?", path)
        if m:
            handle = m.group(2)
            if handle:
                return handle.replace("_", " ")

    return None


def suggest_polish(book: Dict) -> Optional[Dict]:
    """Return a polish suggestion for the given book, or None if it's clean.

    The returned dict has both the current and suggested values so the
    frontend can render an inline diff and the user can pick per-book what
    to accept.
    """
    book_id = book.get("book_id", "")
    raw_title = (book.get("title") or "").strip()
    raw_author = (book.get("author") or "").strip()

    # --- TITLE check ---
    new_title: Optional[str] = None
    title_reason = None
    lt = raw_title.lower()
    if lt in _GENERIC_TITLES:
        title_reason = "generic"
    elif raw_title == book_id:
        title_reason = "filename"
    elif _FILENAME_LOOKING.search(raw_title):
        title_reason = "filename"
    if title_reason:
        cleaned = _clean_title(raw_title) if title_reason == "filename" else ""
        if cleaned and cleaned != raw_title and cleaned.lower() != book_id.lower():
            new_title = cleaned
        else:
            # No usable suggestion — don't list this book just for the title.
            title_reason = None

    # --- AUTHOR check ---
    new_author: Optional[str] = None
    author_reason = None
    la = raw_author.lower()
    if la in _GENERIC_AUTHORS or book_id in raw_author:
        # Try to pull from source_url
        guess = _author_from_source_url(book.get("source_url") or "")
        if guess and guess.lower() != la:
            new_author = guess
            author_reason = "source_url"

    if not new_title and not new_author:
        return None
    return {
        "book_id": book_id,
        "current_title": raw_title,
        "current_author": raw_author,
        "suggested_title": new_title,
        "suggested_author": new_author,
        "reasons": {
            "title": title_reason,
            "author": author_reason,
        },
    }


def polishable_mongo_filter() -> Dict:
    """Pre-filter that limits the candidate set we iterate in Python.

    Doesn't have to be perfectly precise — `suggest_polish` is the final
    arbiter — but a tight match keeps memory and latency low for users
    with thousands of books.
    """
    return {
        "$or": [
            {"title": {"$in": ["", "Unknown", "Untitled", "unknown", "untitled", None]}},
            {"author": {"$in": ["", "Unknown", "Unknown Author", "unknown", "anonymous", "n/a", None]}},
            {"title": {"$regex": r"\.epub$|_{2,}|^[A-Z0-9_]{6,}$", "$options": "i"}},
            # Title equal to book_id is harder to express server-side; we
            # handle that case in Python via `suggest_polish`.
        ]
    }
