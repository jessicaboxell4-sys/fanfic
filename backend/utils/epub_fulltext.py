"""EPUB full-text extraction + search helpers.

`extract_epub_text(path)` returns one big whitespace-normalised string
of every chapter's body text (spine order). Used by:

- The upload pipeline — hooks at the end of `upload_book` to populate
  `db.book_fulltext` for every new book.
- The admin backfill endpoint (`POST /api/admin/fulltext/backfill`)
  that walks existing books and indexes any that don't yet have an
  entry.
- The user-facing search endpoint (`GET /api/library/search/fulltext`)
  which uses Mongo's `$text` index to score+rank matches and produces
  a 200-char snippet around the first hit.

Why a separate collection
-------------------------
The full text of a single 100 k-word novel can easily be 600+ KB. Putting
that inline on the books doc inflates the working set and degrades every
metadata-only query unrelated to search. A sibling collection keyed by
`book_id` keeps `books` lean, and a single `$text` index on
`book_fulltext.text` powers all queries.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

logger = logging.getLogger(__name__)

# Skip files we'd never index — covers, nav docs, fonts.
SKIP_HREFS = ("cover", "toc", "nav", "title", "copyright")
# Hard cap total text per book at 5 MB to avoid one pathological epub
# blowing the 16 MB doc limit. Anything beyond is dropped from the index
# with a warning — search will still match the leading 5 MB.
MAX_TEXT_BYTES = 5 * 1024 * 1024


def extract_epub_text(filepath: Path) -> str:
    """Return the concatenated plain text of every spine document.

    Whitespace is aggressively collapsed: any run of whitespace becomes
    a single space, and paragraph boundaries become a single newline so
    snippets can still respect sentence breaks if we want them later.
    """
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as exc:
        logger.warning("EPUB read failed for fulltext extraction (%s): %s", filepath, exc)
        return ""

    items_by_id = {item.get_id(): item for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT)}
    spine_items = []
    try:
        for entry in book.spine or []:
            idref = entry[0] if isinstance(entry, (tuple, list)) else entry
            if idref in items_by_id:
                spine_items.append(items_by_id[idref])
    except Exception:
        pass
    if not spine_items:
        spine_items = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

    parts: list[str] = []
    total_bytes = 0
    for item in spine_items:
        href = (item.get_name() or "").lower()
        if any(skip in href for skip in SKIP_HREFS):
            continue
        try:
            raw = item.get_content().decode("utf-8", errors="ignore")
        except Exception:
            continue
        soup = BeautifulSoup(raw, "html.parser")
        # Drop everything that's not body text — scripts, styles, nav.
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        # Collapse runs of whitespace down to single spaces, but keep
        # explicit paragraph breaks.
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{2,}", "\n\n", text)
        text = text.strip()
        if not text:
            continue
        encoded = text.encode("utf-8", errors="ignore")
        if total_bytes + len(encoded) > MAX_TEXT_BYTES:
            logger.warning("EPUB %s exceeded MAX_TEXT_BYTES — truncating index", filepath)
            remainder = MAX_TEXT_BYTES - total_bytes
            if remainder > 0:
                parts.append(encoded[:remainder].decode("utf-8", errors="ignore"))
            break
        parts.append(text)
        total_bytes += len(encoded) + 2  # +2 for the joining "\n\n"
    return "\n\n".join(parts)


async def upsert_fulltext(db, book_id: str, user_id: str, text: str) -> None:
    """Write the extracted text to `book_fulltext` (one row per book).

    Empty / extraction-failed strings are still written so we don't
    re-extract on every backfill pass; the row's `text` field is just empty.
    """
    await db.book_fulltext.update_one(
        {"book_id": book_id},
        {"$set": {
            "book_id": book_id,
            "user_id": user_id,
            "text": text or "",
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )


# Default reading speed used when the user hasn't customised theirs.
# 250 wpm is the broadly-cited adult reading-speed average for fiction.
DEFAULT_WORDS_PER_MINUTE = 250


def count_words(text: str) -> int:
    """Cheap whitespace-token word count. Good enough for reading-time
    estimates — accuracy beyond ±5% is wasted effort here."""
    if not text:
        return 0
    return len(text.split())


def reading_minutes_for(word_count: int, wpm: int = DEFAULT_WORDS_PER_MINUTE) -> int:
    """Convert a word count into minutes, rounded up to the nearest minute
    so '900 words / 250 wpm = 3.6' becomes 4. Returns 0 for empty books."""
    if not word_count or word_count <= 0:
        return 0
    wpm = max(80, min(int(wpm or DEFAULT_WORDS_PER_MINUTE), 1500))
    import math
    return max(1, math.ceil(word_count / wpm))


async def ensure_text_index(db) -> None:
    """Create the Mongo `$text` index on `book_fulltext.text` if missing.

    Idempotent — safe to call on every server start. We deliberately
    don't compound the index with anything else so it stays small."""
    existing = await db.book_fulltext.list_indexes().to_list(length=20)
    if any(ix.get("name") == "text_search_idx" for ix in existing):
        return
    await db.book_fulltext.create_index(
        [("text", "text")],
        name="text_search_idx",
        default_language="english",
    )
    logger.info("Created text_search_idx on book_fulltext.text")


def make_snippet(text: str, query: str, window: int = 100) -> str:
    """Return a `…<window>…<match>…<window>…` excerpt around the first
    case-insensitive occurrence of any word in the query. Falls back to
    the leading 2*window chars if no exact substring matches (handles
    Mongo $text stemming where the matched form differs from the input).
    """
    if not text:
        return ""
    needle: Optional[re.Match] = None
    for word in query.split():
        word = word.strip().lower()
        if len(word) < 2:
            continue
        m = re.search(re.escape(word), text, re.IGNORECASE)
        if m and (needle is None or m.start() < needle.start()):
            needle = m
    if needle is None:
        return text[:2 * window].strip() + ("…" if len(text) > 2 * window else "")
    start = max(0, needle.start() - window)
    end = min(len(text), needle.end() + window)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end].strip() + suffix
