"""Pure-EPUB chapter helpers extracted from ``routes/books.py`` as the
first Phase-6 module split.

These functions don't touch FastAPI, Mongo, or anything else stateful
— they just read an EPUB off disk and return a chapter-list shape::

    [{"index": int, "title": str, "words": int, "href": str}, ...]

Keeping them in their own module makes ``routes/books.py`` (~6 100
lines) easier to navigate, and unblocks future work that wants to use
the chapter shape without dragging in the entire books-route module
graph (e.g., the conversion worker, the future Phase-6 fic-update
helper).

``routes/books.py`` re-exports the public names below so existing
callers keep working unchanged.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

logger = logging.getLogger(__name__)


# Module-level regexes — compiled once, reused per call.  Kept inside
# this module (and re-exported from books.py via `from utils.epub_chapters
# import …`) so existing call sites importing ``_CHAPTER_PREFIX_RE``
# from ``routes.books`` keep working.
_CHAPTER_NORMALIZE_RE = re.compile(r'\s+')
_CHAPTER_PREFIX_RE = re.compile(
    r'^\s*(?:chapter|ch\.?|part|prologue|epilogue)\s*[:\-\.]?\s*\d*[:\-\.]?\s*',
    re.IGNORECASE,
)


def _normalize_chapter_title(title: str) -> str:
    """Lowercase, strip common 'Chapter N: ' prefixes, collapse whitespace.
    Used to match chapters between an old and new EPUB."""
    if not title:
        return ""
    cleaned = _CHAPTER_PREFIX_RE.sub('', title.strip())
    cleaned = _CHAPTER_NORMALIZE_RE.sub(' ', cleaned).lower().strip()
    return cleaned


def extract_chapters(filepath: Path) -> List[Dict[str, Any]]:
    """Extract chapter list from an EPUB in spine order.
    Returns: [{index, title, words}] — index is 0-based spine position."""
    chapters: List[Dict[str, Any]] = []
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as e:
        logger.warning(f"EPUB read failed for chapter extraction: {e}")
        return chapters

    # Build href -> item map for spine resolution
    items_by_id = {item.get_id(): item for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT)}

    spine_items: List[Any] = []
    try:
        for spine_entry in book.spine or []:
            idref = spine_entry[0] if isinstance(spine_entry, (tuple, list)) else spine_entry
            if idref in items_by_id:
                spine_items.append(items_by_id[idref])
    except Exception:
        pass
    if not spine_items:
        # Fallback: just iterate documents in file order
        spine_items = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

    for idx, item in enumerate(spine_items):
        try:
            raw = item.get_content().decode('utf-8', errors='ignore')
        except Exception:
            continue
        soup = BeautifulSoup(raw, 'html.parser')

        # Title: prefer first h1/h2/h3, then <title>, then filename-based fallback
        title = ""
        for tag in ('h1', 'h2', 'h3'):
            el = soup.find(tag)
            if el:
                title = el.get_text(separator=' ', strip=True)
                if title:
                    break
        if not title and soup.title and soup.title.string:
            title = soup.title.string.strip()
        if not title:
            title = f"Chapter {idx + 1}"
        title = title[:200]

        text = soup.get_text(separator=' ', strip=True)
        words = len([w for w in text.split() if w])

        href = ""
        try:
            href = item.get_name() or item.file_name or ""
        except Exception:
            href = ""

        chapters.append({"index": idx, "title": title, "words": words, "href": href})

    return chapters


def diff_chapters(old: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compare two chapter lists. Match by normalized title first; fall back to
    spine position for any leftovers."""
    # Build lookup from normalized title -> list of (chapter, consumed-flag-idx)
    old_by_norm: Dict[str, List[int]] = {}
    for i, ch in enumerate(old):
        key = _normalize_chapter_title(ch["title"])
        old_by_norm.setdefault(key, []).append(i)

    matched_old: set = set()
    added: List[Dict[str, Any]] = []
    changed: List[Dict[str, Any]] = []
    unchanged: List[Dict[str, Any]] = []

    for new_ch in new:
        key = _normalize_chapter_title(new_ch["title"])
        candidates = old_by_norm.get(key, [])
        match_idx = None
        for cidx in candidates:
            if cidx not in matched_old:
                match_idx = cidx
                break
        if match_idx is None:
            added.append({
                "title": new_ch["title"],
                "words": new_ch["words"],
                "new_index": new_ch["index"],
                "new_href": new_ch.get("href", ""),
            })
            continue
        matched_old.add(match_idx)
        old_ch = old[match_idx]
        entry = {
            "title": new_ch["title"],
            "old_index": old_ch["index"],
            "new_index": new_ch["index"],
            "old_words": old_ch["words"],
            "new_words": new_ch["words"],
            "delta": new_ch["words"] - old_ch["words"],
            "new_href": new_ch.get("href", ""),
            "old_href": old_ch.get("href", ""),
        }
        if old_ch["words"] == new_ch["words"]:
            unchanged.append(entry)
        else:
            changed.append(entry)

    removed = [
        {"title": old[i]["title"], "words": old[i]["words"], "old_index": old[i]["index"], "old_href": old[i].get("href", "")}
        for i in range(len(old)) if i not in matched_old
    ]

    old_total = sum(ch["words"] for ch in old)
    new_total = sum(ch["words"] for ch in new)

    # Find the first "interesting" chapter in spine order on the NEW side so
    # the UI can offer a one-click "Re-read changed chapters only" jump.
    # Priority: added > changed (then earliest by new_index).
    interesting = (
        [(c["new_index"], c.get("new_href", ""), "added", c["title"]) for c in added]
        + [(c["new_index"], c.get("new_href", ""), "changed", c["title"]) for c in changed]
    )
    interesting.sort(key=lambda t: t[0])
    first_changed = None
    if interesting:
        idx, href, kind, title = interesting[0]
        first_changed = {"new_index": idx, "new_href": href, "kind": kind, "title": title}

    return {
        "added_chapters": added,
        "removed_chapters": removed,
        "changed_chapters": changed,
        "unchanged_chapters": unchanged,
        "first_changed_chapter": first_changed,
        "summary": {
            "old_chapter_count": len(old),
            "new_chapter_count": len(new),
            "chapters_added": len(added),
            "chapters_removed": len(removed),
            "chapters_changed": len(changed),
            "chapters_unchanged": len(unchanged),
            "old_total_words": old_total,
            "new_total_words": new_total,
            "words_delta": new_total - old_total,
        },
    }


__all__ = [
    "_CHAPTER_NORMALIZE_RE",
    "_CHAPTER_PREFIX_RE",
    "_normalize_chapter_title",
    "extract_chapters",
    "diff_chapters",
]
