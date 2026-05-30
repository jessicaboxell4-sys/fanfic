from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
import os
import io
import re
import json
import uuid
import zipfile
import asyncio
import tempfile
import secrets
import bcrypt
import resend
import requests as http_requests

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from deps import (
    db, app, api_router, logger, ROOT_DIR, STORAGE_DIR,
    EMERGENT_LLM_KEY, RESET_TOKEN_TTL_HOURS, RESEND_API_KEY,
    SENDER_EMAIL, FRONTEND_URL,
)
from models import User, BookOut
from auth_dep import get_current_user


from emergentintegrations.llm.chat import LlmChat, UserMessage


FANDOM_KEYWORDS = {
    "Harry Potter": ["harry potter", "hogwarts", "hermione", "voldemort", "dumbledore", "weasley", "snape", "draco malfoy", "ron weasley"],
    "Twilight": ["twilight saga", "bella swan", "edward cullen", "stephenie meyer", "forks washington", "jacob black", "cullen family"],
    "Marvel": ["avengers", "iron man", "tony stark", "spider-man", "spider man", "captain america", "marvel comics", "x-men", "wolverine"],
    "DC Comics": ["batman", "superman", "wonder woman", "gotham", "bruce wayne", "clark kent", "dc comics"],
    "Star Wars": ["star wars", "jedi", "sith", "skywalker", "darth vader", "obi-wan", "the force"],
    "Lord of the Rings": ["lord of the rings", "frodo", "gandalf", "middle-earth", "middle earth", "hobbit", "tolkien"],
    "Sherlock Holmes": ["sherlock holmes", "221b baker", "john watson", "moriarty"],
    "Percy Jackson": ["percy jackson", "camp half-blood", "rick riordan"],
    "Doctor Who": ["doctor who", "tardis", "the doctor", "gallifrey"],
    "Supernatural": ["supernatural fic", "dean winchester", "sam winchester", "castiel"],
    "Game of Thrones": ["game of thrones", "westeros", "jon snow", "daenerys", "targaryen", "stark family"],
    "Hunger Games": ["hunger games", "katniss everdeen", "panem", "district 12"],
    "Naruto": ["naruto uzumaki", "konoha", "sasuke uchiha", "hokage", "akatsuki"],
    "My Hero Academia": ["my hero academia", "izuku midoriya", "u.a. high", "all might", "bakugou"],
    "BTS": ["bts fanfic", "jeon jungkook", "kim taehyung", "park jimin", "min yoongi"],
    "One Direction": ["one direction", "harry styles", "louis tomlinson", "larry stylinson"],
}

FANFIC_SIGNALS = [
    "fanfiction", "fan fiction", "fanfic", "ao3", "archive of our own",
    "fanfiction.net", "wattpad", "x reader", "x-reader", "reader insert",
    "y/n", "self-insert", "slash fic", "shipping", "alternate universe",
    "canon divergence", "what if", "one-shot", "drabble"
]

NONFICTION_SIGNALS = [
    "memoir", "biography", "autobiography", "history of", "essay", "essays",
    "guide to", "how to", "handbook", "textbook", "self-help", "nonfiction",
    "non-fiction", "cookbook", "manual", "reference"
]

def extract_epub_metadata(filepath: Path) -> Dict[str, Any]:
    """Extract title, author, description, cover from an EPUB file."""
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as e:
        logger.warning(f"EPUB parse failed for {filepath}: {e}")
        return {
            "title": filepath.stem,
            "author": "Unknown",
            "description": "",
            "language": "",
            "publisher": "",
            "cover_bytes": None,
            "series_name": None,
            "series_index": None,
            "parse_failed": True,
            "parse_error": str(e)[:200],
        }

    def m(field):
        items = book.get_metadata('DC', field)
        if items and len(items) > 0:
            return items[0][0] or ""
        return ""

    title = m('title') or filepath.stem
    creator = m('creator') or "Unknown"
    description = m('description') or ""
    language = m('language') or ""
    publisher = m('publisher') or ""

    # Strip HTML from description
    if description:
        description = BeautifulSoup(description, 'html.parser').get_text(separator=' ').strip()

    # --- Series metadata (Calibre custom meta) ----
    series_name: Optional[str] = None
    series_index: Optional[float] = None
    try:
        meta_items = book.get_metadata('OPF', 'meta')
        for value, attrs in meta_items or []:
            name = (attrs or {}).get('name', '').lower()
            content = (attrs or {}).get('content', '')
            if name == 'calibre:series' and content:
                series_name = content.strip()
            elif name == 'calibre:series_index' and content:
                try:
                    series_index = float(content)
                except ValueError:
                    pass
    except Exception:
        pass

    # Get cover
    cover_bytes = None
    try:
        for item in book.get_items_of_type(ebooklib.ITEM_COVER):
            cover_bytes = item.get_content()
            break
        if not cover_bytes:
            # Try cover id from metadata
            cover_meta = book.get_metadata('OPF', 'cover')
            if cover_meta:
                cover_id = cover_meta[0][1].get('content')
                if cover_id:
                    cover_item = book.get_item_with_id(cover_id)
                    if cover_item:
                        cover_bytes = cover_item.get_content()
        if not cover_bytes:
            # Look for an image item with 'cover' in name
            for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
                if 'cover' in item.get_name().lower():
                    cover_bytes = item.get_content()
                    break
    except Exception as e:
        logger.debug(f"Cover extraction failed: {e}")

    # Sample text from first chapters for classification
    sample_text = ""
    try:
        count = 0
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            if count >= 3:
                break
            content = item.get_content().decode('utf-8', errors='ignore')
            text = BeautifulSoup(content, 'html.parser').get_text(separator=' ')
            sample_text += " " + text[:2000]
            count += 1
    except Exception:
        pass

    return {
        "title": title.strip(),
        "author": creator.strip(),
        "description": description[:2000],
        "language": language,
        "publisher": publisher,
        "cover_bytes": cover_bytes,
        "sample_text": sample_text[:5000],
        "series_name": series_name,
        "series_index": series_index,
        "parse_failed": False,
    }


# Series patterns (used when EPUB has no calibre:series meta)
SERIES_TITLE_PATTERNS = [
    # "Title (Series Name #3)" or "Title (Series Name, #3)" or "Title (Series Name 3)"
    re.compile(r'^(?P<title>.+?)\s*\((?P<series>[^()]+?),?\s*#?\s*(?P<idx>\d+(?:\.\d+)?)\)\s*$', re.IGNORECASE),
    # "Series Name 03 - Title" or "Series Name #3 - Title"
    re.compile(r'^(?P<series>[A-Za-z][\w\s\'\-]+?)\s+#?(?P<idx>\d+(?:\.\d+)?)\s*[-–—:]\s*(?P<title>.+)$'),
    # "Title - Book 3 of Series Name"
    re.compile(r'^(?P<title>.+?)\s*[-–—,]\s*Book\s+(?P<idx>\d+(?:\.\d+)?)\s+of\s+(?P<series>.+)$', re.IGNORECASE),
    # "Series Name, Book 3: Title"
    re.compile(r'^(?P<series>.+?),?\s+Book\s+(?P<idx>\d+(?:\.\d+)?)\s*[:\-–—]\s*(?P<title>.+)$', re.IGNORECASE),
]


def detect_series_from_title(title: str) -> tuple:
    """Returns (series_name, series_index) or (None, None)."""
    if not title:
        return None, None
    for pat in SERIES_TITLE_PATTERNS:
        m = pat.match(title.strip())
        if m:
            try:
                return m.group('series').strip(), float(m.group('idx'))
            except (ValueError, IndexError):
                continue
    return None, None


URL_REGEX = re.compile(
    r'(?i)\b((?:https?://|www\.)[^\s<>"\')\]]+)'
)


def _clean_url(u: str) -> str:
    # Strip trailing punctuation common in prose
    return u.rstrip('.,;:)>]"\'')


def extract_urls_from_epub(filepath: Path) -> List[Dict[str, str]]:
    """Return a deduped list of {url, anchor} dicts extracted from EPUB content."""
    seen = set()
    results: List[Dict[str, str]] = []
    try:
        book = epub.read_epub(str(filepath), options={"ignore_ncx": True})
    except Exception as e:
        logger.warning(f"EPUB read failed for link extraction: {e}")
        return results

    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        try:
            raw = item.get_content().decode('utf-8', errors='ignore')
        except Exception:
            continue
        soup = BeautifulSoup(raw, 'html.parser')

        # <a href="..."> links
        for a in soup.find_all('a', href=True):
            href = (a.get('href') or '').strip()
            if not href:
                continue
            if href.startswith('#') or href.startswith('mailto:') or href.startswith('javascript:'):
                continue
            if not href.lower().startswith(('http://', 'https://', 'www.')):
                continue
            href = _clean_url(href)
            anchor = a.get_text(separator=' ', strip=True)[:200]
            key = href.lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": href, "anchor": anchor})

        # Plain text URLs (e.g., "Visit https://example.com")
        plain = soup.get_text(separator=' ')
        for m in URL_REGEX.finditer(plain):
            href = _clean_url(m.group(1))
            key = href.lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": href, "anchor": ""})

    return results


def format_links_txt(book_title: str, book_author: str, links: List[Dict[str, str]]) -> str:
    lines = []
    lines.append(f"Title:  {book_title}")
    lines.append(f"Author: {book_author}")
    lines.append(f"Links:  {len(links)}")
    lines.append("=" * 60)
    lines.append("")
    if not links:
        lines.append("(No URLs found in this EPUB.)")
    else:
        for i, item in enumerate(links, 1):
            lines.append(f"{i}. {item['url']}")
            if item.get('anchor'):
                lines.append(f"   ↳ {item['anchor']}")
        lines.append("")
    return "\n".join(lines) + "\n"


_CHAPTER_NORMALIZE_RE = re.compile(r'\s+')
_CHAPTER_PREFIX_RE = re.compile(r'^\s*(?:chapter|ch\.?|part|prologue|epilogue)\s*[:\-\.]?\s*\d*[:\-\.]?\s*', re.IGNORECASE)


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





# ============================================================
# FANFIC REFRESH — pull latest version of a fanfic from its source URL
# ============================================================
FANFIC_SOURCE_PATTERNS = [
    r'https?://(?:www\.)?archiveofourown\.org/works/\d+',
    r'https?://(?:www\.)?fanfiction\.net/s/\d+',
    r'https?://(?:www\.)?fictionpress\.com/s/\d+',
    r'https?://(?:www\.)?royalroad\.com/fiction/\d+',
    r'https?://(?:www\.)?spacebattles\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?sufficientvelocity\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?questionablequesting\.com/threads/[\w-]+\.\d+',
]

FANFICFARE_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
)


# ----------------------------------------------------------------------
# EPUB TEMPLATE APPLIER
# Post-processes every newly-downloaded fanfic EPUB so the structure
# matches the FicHub-style template the user provided:
#   * Intro page (BEFORE the TOC) with a clean info block + source URL
#   * Verdana sans-serif stylesheet, centred <h1>, left-aligned bold <h2>
# Idempotent: detects already-templated EPUBs and skips re-applying.
# ----------------------------------------------------------------------

SHELFSORT_TEMPLATE_CSS = """@namespace epub "http://www.idpf.org/2007/ops";

body {
    font-family: Verdana, Helvetica, Arial, sans-serif;
}

h1 {
    text-align: center;
}

h2 {
    text-align: left;
    font-weight: bold;
}

ol {
    list-style-type: none;
    margin: 0;
}

ol > li {
    margin-top: 0.3em;
}

ol > li > span {
    font-weight: bold;
}

ol > li > ol {
    margin-left: 0.5em;
}

.spoiler {
    padding-left: 0.4em;
    border-left: 0.2em solid #c7ccd1;
}
"""

SHELFSORT_TEMPLATE_MARKER = "shelfsort:templated"


def _html_escape(s: Any) -> str:
    if s is None:
        return ""
    import html as _h
    return _h.escape(str(s), quote=False)


def _build_intro_xhtml(meta: Dict[str, Any], source_url: str) -> str:
    """Build the FicHub-style intro page (matches the user's reference EPUB)."""
    raw = meta.get("rawExtendedMeta") or {}
    title = _html_escape(meta.get("title") or "Untitled")
    author = _html_escape(meta.get("author") or "Unknown")
    description = meta.get("description") or ""
    if description and "<" not in description:
        description = f"<p>{_html_escape(description)}</p>"

    status = _html_escape(raw.get("status") or "")
    published = _html_escape(raw.get("datePublished") or "")
    updated = _html_escape(raw.get("dateUpdated") or "")
    words_val = raw.get("words")
    words = f"{int(words_val):,}" if isinstance(words_val, (int, float)) and words_val else ""
    chapters = meta.get("chapters") or 0
    rating = _html_escape(raw.get("rating") or "")
    language = _html_escape(raw.get("language") or "English")
    reviews = _html_escape(raw.get("reviews") or "")
    favs = _html_escape(raw.get("favs") or "")
    follows = _html_escape(raw.get("follows") or "")

    # "Rated:" line — only show the parts we actually have, comma-separated
    rated_parts: List[str] = []
    if rating:
        rated_parts.append(f"Fiction {rating}")
    if language:
        rated_parts.append(f"Language: {language}")
    if reviews:
        rated_parts.append(f"Reviews: {reviews}")
    if favs:
        rated_parts.append(f"Favs: {favs}")
    if follows:
        rated_parts.append(f"Follows: {follows}")
    rated_line = " - ".join(rated_parts)

    src_url = _html_escape(source_url)

    body_chunks: List[str] = [
        f"<h1>{title}</h1>",
        f"<p><b>By: {author}</b></p>",
        "<p/>",
        description,
    ]
    if status:
        body_chunks.append(f"<p>Status: {status}</p>")
    if published:
        body_chunks.append(f"<p>Published: {published}</p>")
    if updated:
        body_chunks.append(f"<p>Updated: {updated}</p>")
    if words:
        body_chunks.append(f"<p>Words: {words}</p>")
    if chapters:
        body_chunks.append(f"<p>Chapters: {chapters}</p>")
    if rated_line:
        body_chunks.append(f"<p>Rated: {rated_line}</p>")
    body_chunks.append(
        f'<p>Original source:\n\t\t<a rel="noopener noreferrer" href="{src_url}">{src_url}</a></p>'
    )
    body_chunks.append(
        '<p>Exported with the assistance of\n\t\t<a href="https://github.com/JimmXinu/FanFicFare">FanFicFare</a> via Shelfsort</p>'
    )
    body = "\n\t".join(body_chunks)

    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" '
        f'epub:prefix="z3998: http://www.daisy.org/z3998/2012/vocab/structure/#" '
        f'lang="en" xml:lang="en" data-shelfsort="{SHELFSORT_TEMPLATE_MARKER}">\n'
        "  <head>\n"
        "    <title>Introduction</title>\n"
        "  </head>\n"
        f"  <body>{body}\n</body>\n"
        "</html>\n"
    )


def apply_template_to_epub(
    epub_bytes: bytes,
    meta: Dict[str, Any],
    source_url: str,
) -> bytes:
    """Inject a FicHub-style intro page + apply our stylesheet to a fanfic EPUB.

    Idempotent: if the EPUB already carries the Shelfsort marker (a `<meta>`
    in content.opf), returns the bytes unchanged. Errors are caught and the
    original bytes returned, so a malformed EPUB never blocks a refresh.
    """
    import zipfile
    from io import BytesIO

    try:
        src = BytesIO(epub_bytes)
        with zipfile.ZipFile(src, "r") as zin:
            names = zin.namelist()
            if not any(n.endswith(".opf") for n in names):
                return epub_bytes  # not an EPUB we can safely rewrite

            opf_path = next(n for n in names if n.endswith(".opf"))
            opf_xml = zin.read(opf_path).decode("utf-8", errors="ignore")
            if SHELFSORT_TEMPLATE_MARKER in opf_xml:
                return epub_bytes  # already templated — skip

            opf_dir = opf_path.rsplit("/", 1)[0] if "/" in opf_path else ""

            # Build the new intro page
            intro_xhtml = _build_intro_xhtml(meta, source_url)
            intro_filename = "shelfsort_intro.xhtml"
            intro_path = f"{opf_dir}/{intro_filename}" if opf_dir else intro_filename

            # Find or pick a stylesheet path inside the OPF dir
            css_path = next(
                (n for n in names if n.endswith(".css") and (opf_dir + "/") in (n + "/")),
                None,
            ) or (f"{opf_dir}/style/shelfsort.css" if opf_dir else "shelfsort.css")
            css_href = css_path[len(opf_dir) + 1:] if opf_dir and css_path.startswith(opf_dir + "/") else css_path

            # Mutate the OPF: inject the intro item + spine ref + a marker meta
            import re as _re

            # 1) Add marker meta inside <metadata>
            new_opf = _re.sub(
                r"(</metadata>)",
                f'    <meta name="generator" content="{SHELFSORT_TEMPLATE_MARKER}"/>\n  \\1',
                opf_xml,
                count=1,
            )

            # 2) Add intro manifest item (if not already there)
            if 'id="shelfsort-intro"' not in new_opf:
                new_opf = _re.sub(
                    r"(</manifest>)",
                    f'    <item href="{intro_filename}" id="shelfsort-intro" media-type="application/xhtml+xml"/>\n  \\1',
                    new_opf,
                    count=1,
                )
                # Ensure css is in the manifest too
                if css_href not in new_opf:
                    new_opf = _re.sub(
                        r"(</manifest>)",
                        f'    <item href="{css_href}" id="shelfsort-css" media-type="text/css"/>\n  \\1',
                        new_opf,
                        count=1,
                    )

            # 3) Prepend intro to the spine
            new_opf = _re.sub(
                r"(<spine[^>]*>)",
                '\\1\n    <itemref idref="shelfsort-intro"/>',
                new_opf,
                count=1,
            )

            # 4) Repack the EPUB
            out = BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
                # mimetype MUST be first + uncompressed
                if "mimetype" in names:
                    info = zipfile.ZipInfo("mimetype")
                    info.compress_type = zipfile.ZIP_STORED
                    zout.writestr(info, zin.read("mimetype"))
                for name in names:
                    if name == "mimetype":
                        continue
                    if name == opf_path:
                        zout.writestr(name, new_opf)
                    elif name == css_path:
                        zout.writestr(name, SHELFSORT_TEMPLATE_CSS)
                    else:
                        zout.writestr(name, zin.read(name))
                # New files
                zout.writestr(intro_path, intro_xhtml)
                if css_path not in names:
                    zout.writestr(css_path, SHELFSORT_TEMPLATE_CSS)
            return out.getvalue()
    except Exception as e:
        logger.warning("apply_template_to_epub failed for %s: %s", source_url, e)
        return epub_bytes



# ---- Tag helpers -----------------------------------------------------------
TAG_MAX_LENGTH = 32
TAG_MAX_PER_BOOK = 20


def _normalize_tag(tag: Any) -> Optional[str]:
    """Lowercase, hyphenated, stripped. Returns None for empty/invalid input."""
    if not tag:
        return None
    s = str(tag).strip().lower()
    if not s:
        return None
    # Collapse whitespace -> hyphen; remove disallowed punctuation
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9\-_]", "", s)
    s = s.strip("-_")
    if not s:
        return None
    return s[:TAG_MAX_LENGTH]


def _normalize_tags(raw: Any) -> List[str]:
    """Take a list-like and return a clean, de-duped, capped list of tag slugs."""
    if not raw:
        return []
    if isinstance(raw, str):
        # Allow comma-separated strings too
        raw = [p for p in re.split(r"[,;]", raw) if p.strip()]
    out: List[str] = []
    seen: set = set()
    for t in raw:
        n = _normalize_tag(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
            if len(out) >= TAG_MAX_PER_BOOK:
                break
    return out


class FanficNotFoundError(Exception):
    """FanFicFare couldn't fetch this fanfic — mark the book as unavailable."""
    pass


def find_source_url(links: List[Dict[str, str]]) -> Optional[str]:
    """Return the first URL in the list that points to a supported fanfic source."""
    for item in links:
        url = (item.get('url') or '').strip()
        for pat in FANFIC_SOURCE_PATTERNS:
            m = re.search(pat, url, re.IGNORECASE)
            if m:
                return m.group(0)
    return None


def extract_fanfic_urls(links: List[Dict[str, str]]) -> List[str]:
    """Return every canonical fanfic-permalink URL found in the EPUB's link set.

    We only keep URLs that match `FANFIC_SOURCE_PATTERNS` (AO3 /works/N, FFnet
    /s/N, RoyalRoad /fiction/N, etc.) so that duplicate detection doesn't trip
    on boilerplate navigation links shared by every AO3 EPUB.
    """
    seen: set = set()
    out: List[str] = []
    for item in links or []:
        url = (item.get('url') or '').strip()
        for pat in FANFIC_SOURCE_PATTERNS:
            m = re.search(pat, url, re.IGNORECASE)
            if m:
                canonical = m.group(0)
                if canonical not in seen:
                    seen.add(canonical)
                    out.append(canonical)
                break
    return out


def _normalize_title_for_match(title: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (title or "").strip()).lower()


async def find_duplicate_candidates(
    user_id: str,
    *,
    title: Optional[str],
    source_url: Optional[str],
    fanfic_urls: Optional[List[str]] = None,
    exclude_book_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Find existing books in the user's library that look like duplicates.

    Match rules (any of):
      - normalized title equality (case-insensitive, whitespace-collapsed)
      - exact source_url equality
      - any shared canonical fanfic URL (intersection on `fanfic_urls`)

    Archived versions are searched too — when a match lands on an archived
    book we walk the `replaced_by` chain to its current head and surface the
    head as the match (with `historical_version` added to match_reasons),
    so the upload can be offered as a historical version of a current copy.

    Returns a list of `{book_id, title, author, match_reasons: [...]}` dicts.
    """
    norm_title = _normalize_title_for_match(title)
    urls = [u for u in (fanfic_urls or []) if u]

    or_clauses: List[Dict[str, Any]] = []
    if norm_title:
        # Case-insensitive exact match on title (with collapsed whitespace).
        # We use $regex anchored to ^…$ so partial matches don't trip.
        escaped = re.escape(norm_title)
        or_clauses.append({"title": {"$regex": f"^\\s*{escaped}\\s*$", "$options": "i"}})
    if source_url:
        or_clauses.append({"source_url": source_url})
    if urls:
        or_clauses.append({"fanfic_urls": {"$in": urls}})

    if not or_clauses:
        return []

    query: Dict[str, Any] = {"user_id": user_id, "$or": or_clauses}
    if exclude_book_id:
        query["book_id"] = {"$ne": exclude_book_id}

    projection = {"_id": 0, "book_id": 1, "title": 1, "author": 1, "source_url": 1, "fanfic_urls": 1, "category": 1, "replaced_by": 1}
    matches_by_head: Dict[str, Dict[str, Any]] = {}

    async def _walk_to_head(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Follow `replaced_by` until we hit a current (non-archived) copy."""
        current = doc
        seen: set = set()
        while current.get("replaced_by"):
            if current["book_id"] in seen:
                return None  # cycle guard
            seen.add(current["book_id"])
            nxt = await db.books.find_one(
                {"book_id": current["replaced_by"], "user_id": user_id},
                projection,
            )
            if not nxt:
                return None
            current = nxt
        if current.get("category") == OLD_STORIES_SHELF:
            return None  # orphaned archived chain
        return current

    async for doc in db.books.find(query, projection):
        is_archived = doc.get("category") == OLD_STORIES_SHELF or bool(doc.get("replaced_by"))
        head_doc = doc if not is_archived else await _walk_to_head(doc)
        if not head_doc:
            continue

        reasons: List[str] = []
        if norm_title and _normalize_title_for_match(doc.get("title")) == norm_title:
            reasons.append("title")
        if source_url and doc.get("source_url") == source_url:
            reasons.append("source_url")
        if urls:
            shared = [u for u in (doc.get("fanfic_urls") or []) if u in urls]
            if shared:
                reasons.append("url")
        if not reasons:
            continue
        if is_archived:
            reasons.append("historical_version")

        head_id = head_doc["book_id"]
        if head_id == exclude_book_id:
            continue
        existing = matches_by_head.get(head_id)
        if existing:
            # Merge reasons (de-duped)
            existing["match_reasons"] = sorted(set(existing["match_reasons"]) | set(reasons))
        else:
            matches_by_head[head_id] = {
                "book_id": head_id,
                "title": head_doc.get("title") or "",
                "author": head_doc.get("author") or "",
                "match_reasons": sorted(set(reasons)),
            }

    return list(matches_by_head.values())


async def _apply_duplicate_policy(
    user_id: str,
    new_book_id: str,
    target_book_id: Optional[str],
    policy: str,
) -> Optional[Dict[str, Any]]:
    """Apply a default-policy auto-resolution to a freshly-uploaded book.

    Returns a dict describing what was done, or None if the policy couldn't
    apply (e.g., no target). The expensive chapter-diff step from the
    interactive resolve flow is skipped for batch uploads — users running on
    a stand policy chose convenience over the bell badge.

    Side effect: every change is recorded under the book's `dupe_action_meta`
    field with the previous values so the action can be undone via
    `POST /api/books/{book_id}/undo-resolve`.
    """
    user_dir = STORAGE_DIR / user_id
    now_iso = datetime.now(timezone.utc).isoformat()

    if policy == "keep_both":
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
                "$set": {"dupe_action_meta": {"action": "keep_both", "applied_at": now_iso}},
            },
        )
        return {"action": "keep_both", "undoable": False}

    if policy == "discard":
        # Soft-delete: move to Trash shelf with a 30-day grace window so the
        # user can restore. A background sweep hard-deletes books whose
        # `trash_expires_at` is in the past.
        new_doc_before = await db.books.find_one({"book_id": new_book_id, "user_id": user_id})
        if not new_doc_before:
            return None
        expires_at = (datetime.now(timezone.utc) + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": new_doc_before.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {"action": "discard", "undoable": True, "trash_expires_at": expires_at}

    # The remaining two need a current head; bail if there isn't one
    if not target_book_id:
        return None
    target = await db.books.find_one({"book_id": target_book_id, "user_id": user_id})
    if not target or target.get("category") == OLD_STORIES_SHELF or target.get("replaced_by"):
        return None

    new_doc_before = await db.books.find_one({"book_id": new_book_id, "user_id": user_id})
    if not new_doc_before:
        return None

    if policy == "historical":
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": target_book_id,
                    "replaced_at": now_iso,
                    "dupe_action_meta": {
                        "action": "historical",
                        "target_book_id": target_book_id,
                        "prev_category_new": new_doc_before.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {
            "action": "historical",
            "target_book_id": target_book_id,
            "undoable": True,
        }

    if policy == "new_version":
        now_dt = datetime.now(timezone.utc)
        updated_shelf = _updated_shelf_name(now_dt)
        await db.books.update_one(
            {"book_id": new_book_id, "user_id": user_id},
            {
                "$set": {
                    "category": updated_shelf,
                    "replaces": target_book_id,
                    "last_refreshed_at": now_iso,
                    "update_seen": False,
                    "dupe_action_meta": {
                        "action": "new_version",
                        "target_book_id": target_book_id,
                        "prev_category_new": new_doc_before.get("category"),
                        "prev_category_target": target.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        await db.categories.update_one(
            {"user_id": user_id, "name": updated_shelf},
            {"$setOnInsert": {
                "user_id": user_id,
                "name": updated_shelf,
                "created_at": now_iso,
                "auto_created": True,
            }},
            upsert=True,
        )
        await db.books.update_one(
            {"book_id": target_book_id, "user_id": user_id},
            {"$set": {
                "category": OLD_STORIES_SHELF,
                "replaced_by": new_book_id,
                "replaced_at": now_iso,
            }},
        )
        return {
            "action": "new_version",
            "target_book_id": target_book_id,
            "updated_shelf": updated_shelf,
            "undoable": True,
        }

    return None


@api_router.post("/books/{book_id}/undo-resolve")
async def undo_resolve(book_id: str, user: User = Depends(get_current_user)):
    """Undo a recent policy-driven duplicate resolution.

    Reads `dupe_action_meta` from the book and reverses the field changes.
    For `historical` and `new_version` we restore the previous categories
    and unset `replaced_by`/`replaces`. `keep_both` and `discard` are not
    undoable (the former is a no-op; the latter is a hard delete).
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    meta = book.get("dupe_action_meta") or {}
    action = meta.get("action")
    if action not in ("historical", "new_version", "discard"):
        raise HTTPException(status_code=400, detail=f"Action '{action}' is not undoable")

    if action == "discard":
        prev_cat = meta.get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
            },
        )
        return {"ok": True, "undone": "discard", "book_id": book_id}

    if action == "historical":
        prev_cat = meta.get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"replaced_by": "", "replaced_at": "", "dupe_action_meta": ""},
            },
        )
        return {"ok": True, "undone": "historical", "book_id": book_id}

    # new_version
    target_id = meta.get("target_book_id")
    prev_cat_new = meta.get("prev_category_new") or "Unclassified"
    prev_cat_target = meta.get("prev_category_target") or "Fanfiction"
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {"category": prev_cat_new},
            "$unset": {"replaces": "", "last_refreshed_at": "", "update_seen": "", "dupe_action_meta": ""},
        },
    )
    if target_id:
        await db.books.update_one(
            {"book_id": target_id, "user_id": user.user_id},
            {
                "$set": {"category": prev_cat_target},
                "$unset": {"replaced_by": "", "replaced_at": ""},
            },
        )
    return {"ok": True, "undone": "new_version", "book_id": book_id, "target_book_id": target_id}


async def fanfic_fetch_epub(source_url: str, options: Optional[Dict[str, Any]] = None) -> tuple:
    """Generate an EPUB for the given fanfic URL using FanFicFare.

    Optional `options` dict (per-user FanFicFare prefs):
      - include_author_notes: bool (default True)
      - include_images: bool (default True)
      - keep_chapter_links: bool (default False)
    """
    loop = asyncio.get_event_loop()
    options = options or {}

    # Test hook: when set, returns canned content immediately so tests don't
    # need a real internet connection.
    canned = os.environ.get("SHELFSORT_TEST_FFF_RESPONSE")
    if canned:
        try:
            obj = json.loads(canned)
        except Exception:
            obj = {}
        if obj.get("not_found"):
            raise FanficNotFoundError(obj.get("detail", "Source unavailable"))
        # `epub_b64` is base64-encoded bytes; meta is a passthrough dict
        import base64
        epub_bytes = base64.b64decode(obj.get("epub_b64", ""))
        return epub_bytes, obj.get("meta") or {}

    def _do_download():
        import tempfile
        from fanficfare import adapters
        from fanficfare.configurable import Configuration
        from fanficfare import exceptions as fff_exc
        from urllib.parse import urlparse
        host = urlparse(source_url).hostname or ""
        try:
            config = Configuration([host], "EPUB")
            # Use a realistic browser User-Agent — AO3 / FFN / Cloudflare
            # actively block obvious scraper UAs with HTTP 403.
            try:
                config.set("defaults", "user_agent", FANFICFARE_USER_AGENT)
                config.set(host, "user_agent", FANFICFARE_USER_AGENT)
            except Exception:
                # Not all FFF builds expose the same INI sections; fall through.
                pass
            # Apply per-user FanFicFare options. FFF expects strings for ini values.
            try:
                if "include_author_notes" in options:
                    val = "true" if options["include_author_notes"] else "false"
                    config.set("epub", "include_author_notes", val)
                if "include_images" in options:
                    val = "true" if options["include_images"] else "false"
                    config.set("epub", "include_images", val)
                if "keep_chapter_links" in options:
                    val = "true" if options["keep_chapter_links"] else "false"
                    config.set("epub", "keep_summary_html", val)
            except Exception as cfg_err:
                logger.warning("Failed to apply FFF user options: %s", cfg_err)
            adapter = adapters.getAdapter(config, source_url)
        except fff_exc.UnknownSite as e:
            raise FanficNotFoundError(f"This site isn't supported: {host}")
        except fff_exc.InvalidStoryURL as e:
            raise FanficNotFoundError(f"Invalid story URL: {e}")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Adapter setup failed: {e}")

        try:
            adapter.getStoryMetadataOnly()
        except fff_exc.StoryDoesNotExist as e:
            # Heuristic: FFN's Cloudflare/anti-bot pages get parsed as
            # "story doesn't exist" because the real HTML isn't there. Give
            # the user a clearer hint when the site is FFN.
            if "fanfiction.net" in (host or "").lower():
                raise FanficNotFoundError(
                    "FanFiction.net's bot protection blocked the download. The work itself is "
                    "likely still online — try the 'Upload replacement' button on the book's page "
                    "to drop in a fresh EPUB you exported from your own browser/Calibre."
                )
            raise FanficNotFoundError(f"Story not found: {e}")
        except fff_exc.HTTPErrorFFF as e:
            msg = str(e)
            if "403" in msg:
                # 403 is frequently a transient rate-limit / Cloudflare challenge.
                # Wait briefly and try once more before flagging as unavailable.
                logger.info("403 from %s — backing off 30s and retrying once", host)
                import time as _time
                _time.sleep(30)
                try:
                    adapter.getStoryMetadataOnly()
                    # Retry succeeded — fall through to writeStory below
                except fff_exc.HTTPErrorFFF as e2:
                    if "403" in str(e2):
                        raise FanficNotFoundError(
                            f"Source site blocked the request (HTTP 403, retried). The site may be rate-limiting, "
                            f"behind a Cloudflare challenge, or restricting this work to registered users. "
                            f"Try opening the URL in a browser to check."
                        )
                    raise FanficNotFoundError(f"Couldn't reach source after retry: {e2}")
                except Exception as e2:
                    raise FanficNotFoundError(f"Couldn't reach source after retry: {e2}")
            else:
                raise FanficNotFoundError(f"Couldn't reach source: {e}")
        except fff_exc.RegularDelayException as e:
            raise HTTPException(status_code=503, detail=f"Source rate-limited: {e}")
        except Exception as e:
            raise FanficNotFoundError(f"Source error: {e}")

        # Write EPUB into a temp file
        out_fd, out_path = tempfile.mkstemp(suffix=".epub")
        os.close(out_fd)
        try:
            from fanficfare import writers
            writer = writers.getWriter("epub", config, adapter)
            writer.writeStory(outfilename=out_path, forceOverwrite=True)
            with open(out_path, "rb") as f:
                epub_bytes = f.read()
        finally:
            try:
                os.unlink(out_path)
            except Exception:
                pass

        story = adapter.story
        # Capture every field we'll need to build the template-style intro page.
        meta = {
            "chapters": int(story.getMetadata("numChapters") or 0),
            "rawExtendedMeta": {
                "dateUpdated": story.getMetadata("dateUpdated"),
                "datePublished": story.getMetadata("datePublished"),
                "words": int(story.getMetadata("numWords") or 0) if story.getMetadata("numWords") else None,
                "status": story.getMetadata("status"),
                "rating": story.getMetadata("rating"),
                "language": story.getMetadata("language"),
                "reviews": story.getMetadata("reviews"),
                "favs": story.getMetadata("favs"),
                "follows": story.getMetadata("follows"),
                "genre": story.getMetadata("genre"),
                "category": story.getMetadata("category"),
            },
            "title": story.getMetadata("title"),
            "author": story.getMetadata("author"),
            "description": story.getMetadata("description"),
            "source_url": source_url,
            "site": host,
        }
        return epub_bytes, meta

    try:
        return await loop.run_in_executor(None, _do_download)
    except FanficNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error("FanFicFare download failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Download error: {e}")


def _updated_shelf_name(now: Optional[datetime] = None) -> str:
    """Return the date-stamped 'Updated stories' shelf name for refreshes today.

    Each refresh batch gets its own dated bucket, so every run of updates is
    clearly separated. Example: "Updated stories 2026-03-01"."""
    now = now or datetime.now(timezone.utc)
    return f"Updated stories {now.strftime('%Y-%m-%d')}"


OLD_STORIES_SHELF = "Old stories"
TRASH_SHELF = "Trash"
TRASH_GRACE_DAYS = 30


async def apply_refresh(book: Dict[str, Any], user_id: str, source_url: str) -> Dict[str, Any]:
    """Refresh a fanfic by generating a new EPUB via FanFicFare.

    Behavior (2026-02, updated per user request): instead of overwriting the
    existing EPUB and book record, we create a NEW book in a date-stamped
    "Updated stories YYYY-MM-DD" shelf and move the original to the single
    "Old stories" shelf. Every refresh batch gets its own dated bucket so the
    history of updates stays clearly separated.

    Cross-links:
      - new book .replaces -> old book_id
      - old book .replaced_by -> new book_id
    """
    # Honor per-user FanFicFare options
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "fff_options": 1})
    fff_options = (user_doc or {}).get("fff_options") or {}
    epub_bytes, source_meta = await fanfic_fetch_epub(source_url, options=fff_options)

    # Apply the FicHub-style template (intro page + stylesheet) unless the
    # user has explicitly opted out. Idempotent: noop on already-templated EPUBs.
    if fff_options.get("apply_template", True):
        loop = asyncio.get_event_loop()
        epub_bytes = await loop.run_in_executor(
            None, apply_template_to_epub, epub_bytes, source_meta, source_url
        )

    user_dir = STORAGE_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    # Generate a fresh book_id + path for the new copy
    new_book_id = f"book_{uuid.uuid4().hex[:12]}"
    new_epub_path = user_dir / f"{new_book_id}.epub"
    new_epub_path.write_bytes(epub_bytes)

    new_meta = extract_epub_metadata(new_epub_path)
    new_cover_path = user_dir / f"{new_book_id}.cover"
    if new_meta.get("cover_bytes"):
        new_cover_path.write_bytes(new_meta["cover_bytes"])

    links = extract_urls_from_epub(new_epub_path)
    (user_dir / f"{new_book_id}.links.txt").write_text(
        format_links_txt(new_meta["title"], new_meta["author"], links),
        encoding="utf-8",
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_dt = datetime.now(timezone.utc)
    updated_shelf = _updated_shelf_name(now_dt)
    old_book_id = book["book_id"]

    # 1) Insert the new book in the date-stamped "Updated stories" shelf
    new_doc = {
        "book_id": new_book_id,
        "user_id": user_id,
        "filename": _templated_filename(new_meta.get("title"), new_meta.get("author"), new_book_id),
        "title": new_meta["title"],
        "author": new_meta["author"],
        "description": new_meta["description"],
        "language": new_meta["language"],
        "publisher": new_meta["publisher"],
        "has_cover": bool(new_meta.get("cover_bytes")),
        # Each refresh batch lives in its own dated bucket
        "category": updated_shelf,
        "fandom": book.get("fandom"),
        "series_name": book.get("series_name"),
        "series_index": book.get("series_index"),
        "tags": book.get("tags") or [],
        "confidence": book.get("confidence", 0.0),
        "classifier": book.get("classifier", "metadata"),
        "size_bytes": len(epub_bytes),
        "links_count": len(links),
        "source_url": source_url,
        "last_refreshed_at": now_iso,
        "source_meta": source_meta,
        "replaces": old_book_id,
        "created_at": now_iso,
    }
    await db.books.insert_one(new_doc)

    # Register the dated shelf as a custom category so it surfaces in the UI
    # chip list. Idempotent — same date is reused across a day's refreshes.
    await db.categories.update_one(
        {"user_id": user_id, "name": updated_shelf},
        {"$setOnInsert": {
            "user_id": user_id,
            "name": updated_shelf,
            "created_at": now_iso,
            "auto_created": True,
        }},
        upsert=True,
    )

    # 2) Move the old book to the "Old stories" shelf with a back-pointer
    await db.books.update_one(
        {"book_id": old_book_id, "user_id": user_id},
        {"$set": {
            "category": OLD_STORIES_SHELF,
            "replaced_by": new_book_id,
            "replaced_at": now_iso,
        }},
    )

    # 3) Compute a quick diff summary and stash it on the new book so the
    # "fics updated" navbar badge can query it cheaply (no per-poll EPUB
    # parsing). Failures here are non-fatal — the badge will just skip this
    # book. Always sets `update_seen=False` so the badge picks it up.
    refresh_summary: Optional[Dict[str, Any]] = None
    try:
        old_epub_path = user_dir / f"{old_book_id}.epub"
        if old_epub_path.exists():
            loop = asyncio.get_event_loop()
            old_chapters = await loop.run_in_executor(None, extract_chapters, old_epub_path)
            new_chapters = await loop.run_in_executor(None, extract_chapters, new_epub_path)
            d = diff_chapters(old_chapters, new_chapters)
            refresh_summary = {
                "chapters_added": d["summary"]["chapters_added"],
                "chapters_changed": d["summary"]["chapters_changed"],
                "chapters_removed": d["summary"]["chapters_removed"],
                "words_delta": d["summary"]["words_delta"],
                "first_changed_href": (d.get("first_changed_chapter") or {}).get("new_href", ""),
                "first_changed_title": (d.get("first_changed_chapter") or {}).get("title", ""),
                "first_changed_kind": (d.get("first_changed_chapter") or {}).get("kind", ""),
            }
    except Exception as e:
        logger.warning("refresh_summary diff failed for %s -> %s: %s", old_book_id, new_book_id, e)

    await db.books.update_one(
        {"book_id": new_book_id, "user_id": user_id},
        {"$set": {
            "refresh_summary": refresh_summary,
            "update_seen": False,
        }},
    )

    return {
        "new_book_id": new_book_id,
        "old_book_id": old_book_id,
        "title": new_meta["title"],
        "author": new_meta["author"],
        "last_refreshed_at": now_iso,
        "updated_shelf": updated_shelf,
    }


def classify_by_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Heuristic keyword classification. Returns dict with category, fandom, confidence."""
    blob = " ".join([
        meta.get("title", ""),
        meta.get("author", ""),
        meta.get("description", ""),
        meta.get("publisher", ""),
        meta.get("sample_text", "")[:2000],
    ]).lower()

    matched_fandom = None
    best_count = 0
    for fandom, keywords in FANDOM_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in blob)
        if count > best_count:
            best_count = count
            matched_fandom = fandom

    is_fanfic = any(s in blob for s in FANFIC_SIGNALS)
    is_nonfic = any(s in blob for s in NONFICTION_SIGNALS)

    if matched_fandom and best_count >= 1:
        return {
            "category": "Fanfiction",
            "fandom": matched_fandom,
            "confidence": min(0.6 + 0.1 * best_count, 0.95),
            "classifier": "metadata",
        }
    if is_fanfic:
        return {"category": "Fanfiction", "fandom": "Other", "confidence": 0.7, "classifier": "metadata"}
    if is_nonfic:
        return {"category": "Non-fiction", "fandom": None, "confidence": 0.7, "classifier": "metadata"}

    return {"category": "Unclassified", "fandom": None, "confidence": 0.2, "classifier": "metadata"}


async def classify_with_ai(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Use Claude to classify when metadata heuristics are uncertain."""
    if not EMERGENT_LLM_KEY:
        return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}

    # Test hook: when set, return this canned JSON instead of calling Claude.
    canned = os.environ.get("SHELFSORT_TEST_AI_RESPONSE")
    if canned:
        try:
            obj = json.loads(canned)
            return {
                "category": obj.get("category", "Unclassified"),
                "fandom": obj.get("fandom"),
                "confidence": float(obj.get("confidence", 0.8)),
                "classifier": "ai",
                "tags": _normalize_tags(obj.get("tags") or []),
            }
        except Exception:
            pass

    system_msg = (
        "You are a librarian classifying ebooks. Given book metadata, respond with strict JSON only: "
        '{"category": "Fanfiction|Original Fiction|Non-fiction", "fandom": "<specific fandom name like Harry Potter, Twilight, Marvel, or null if not fanfiction>", "confidence": 0.0-1.0, "tags": ["tag1","tag2","tag3"]}. '
        "Use Fanfiction only when it is clearly fan-derived from another work. "
        "For original fiction novels (even popular ones like the actual Harry Potter series by Rowling), use Original Fiction, not Fanfiction. "
        "Common fandoms: Harry Potter, Twilight, Marvel, DC Comics, Star Wars, Lord of the Rings, Sherlock Holmes, Percy Jackson, Doctor Who, Supernatural, Game of Thrones, Hunger Games, Naruto, My Hero Academia, BTS, One Direction. "
        "Tags: 2-4 short lowercase descriptive labels (e.g. 'fluff', 'angst', 'au', 'wip', 'slow-burn', 'enemies-to-lovers', 'romance', 'mystery', 'historical', 'biography', 'self-help'). "
        "Return ONLY the JSON object, no markdown."
    )
    user_text = (
        f"Title: {meta.get('title','')}\n"
        f"Author: {meta.get('author','')}\n"
        f"Publisher: {meta.get('publisher','')}\n"
        f"Description: {meta.get('description','')[:600]}\n"
        f"Sample text: {meta.get('sample_text','')[:800]}"
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"classify-{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=user_text))
        # Extract JSON
        text = resp.strip()
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            obj = json.loads(m.group(0))
            cat = obj.get('category', 'Unclassified')
            fandom = obj.get('fandom')
            if fandom in (None, "null", "None", ""):
                fandom = None
            conf = float(obj.get('confidence', 0.5))
            return {
                "category": cat, "fandom": fandom, "confidence": conf,
                "classifier": "ai",
                "tags": _normalize_tags(obj.get("tags") or []),
            }
    except Exception as e:
        logger.error(f"AI classify failed: {e}")
    return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}


async def classify_book(meta: Dict[str, Any], force_ai: bool = False) -> Dict[str, Any]:
    if not force_ai:
        meta_result = classify_by_metadata(meta)
        if meta_result['confidence'] >= 0.6:
            return meta_result
    ai_result = await classify_with_ai(meta)
    if ai_result['confidence'] > 0:
        return ai_result
    return classify_by_metadata(meta)


# ============================================================
# BOOK ROUTES

NEEDS_CONVERSION_EXTS = {
    ".pdf", ".mobi", ".azw", ".azw3", ".kf8", ".kfx",
    ".docx", ".doc", ".rtf", ".fb2", ".lit", ".lrf", ".pdb", ".txt", ".html", ".htm",
}
NEEDS_CONVERSION_SHELF = "Needs conversion"


def _convert_to_epub_sync(src_path: Path, dest_path: Path) -> Optional[str]:
    """Run `ebook-convert <src> <dest>` synchronously. Returns None on success,
    or an error message on failure. Called from an executor so the FastAPI
    event loop stays responsive."""
    import subprocess
    try:
        proc = subprocess.run(
            ["ebook-convert", str(src_path), str(dest_path)],
            capture_output=True,
            text=True,
            timeout=180,  # 3 min cap per book — heavy PDFs can be slow
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "")[-400:]
            return f"ebook-convert failed (rc={proc.returncode}): {tail.strip()}"
        if not dest_path.exists() or dest_path.stat().st_size < 256:
            return "ebook-convert produced no usable output"
        return None
    except FileNotFoundError:
        return "ebook-convert is not installed on the server"
    except subprocess.TimeoutExpired:
        return "ebook-convert timed out (>3 min)"
    except Exception as e:
        return f"ebook-convert crashed: {e}"


async def convert_to_epub(src_path: Path, dest_path: Path) -> Optional[str]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _convert_to_epub_sync, src_path, dest_path)


@api_router.post("/books/upload")
async def upload_books(
    request: Request,
    files: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
):
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    results = []

    for f in files:
        lower = (f.filename or "").lower()
        ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""

        # Non-EPUB but a known ebook format → auto-convert to EPUB via
        # Calibre's `ebook-convert`, then fall through to the normal EPUB
        # pipeline below (metadata / classification / fanfic / template).
        # On conversion failure we keep the original file under the
        # "Needs conversion" shelf with a friendly error message.
        original_format: Optional[str] = None
        convert_error: Optional[str] = None
        if ext != ".epub" and ext in NEEDS_CONVERSION_EXTS:
            book_id = f"book_{uuid.uuid4().hex[:12]}"
            src_target = user_dir / f"{book_id}{ext}"
            content = await f.read()
            src_target.write_bytes(content)
            epub_target = user_dir / f"{book_id}.epub"
            err = await convert_to_epub(src_target, epub_target)
            if err:
                base_name = (f.filename or "Untitled").rsplit(".", 1)[0]
                now_iso = datetime.now(timezone.utc).isoformat()
                doc = {
                    "book_id": book_id,
                    "user_id": user.user_id,
                    "filename": f.filename,
                    "title": base_name,
                    "author": "Unknown",
                    "description": (
                        f"Uploaded as .{ext.lstrip('.')} but auto-conversion failed: {err}. "
                        f"Convert it manually with Calibre's 'Convert books' tool and re-upload."
                    ),
                    "language": "",
                    "publisher": "",
                    "has_cover": False,
                    "category": NEEDS_CONVERSION_SHELF,
                    "fandom": None,
                    "confidence": 1.0,
                    "classifier": "needs-conversion",
                    "size_bytes": len(content),
                    "links_count": 0,
                    "source_url": None,
                    "last_refreshed_at": None,
                    "series_name": None,
                    "series_index": None,
                    "needs_conversion": True,
                    "original_format": ext.lstrip("."),
                    "conversion_error": err,
                    "created_at": now_iso,
                }
                await db.books.insert_one(doc)
                results.append({k: v for k, v in doc.items() if k != "_id"})
                continue
            # Conversion succeeded — keep the original file too (so the user
            # has the source) but route the rest of the pipeline at the EPUB.
            original_format = ext.lstrip(".")
            content = epub_target.read_bytes()
            target = epub_target
            # Fall through to the standard EPUB processing below using the
            # already-written EPUB. We jump straight to metadata extraction by
            # reusing the local `book_id` we generated above.
        elif ext != ".epub":
            results.append({"filename": f.filename, "error": "Not an EPUB"})
            continue
        else:
            book_id = f"book_{uuid.uuid4().hex[:12]}"
            target = user_dir / f"{book_id}.epub"
            content = await f.read()
            target.write_bytes(content)

        meta = extract_epub_metadata(target)

        # Short-circuit: if the EPUB can't be opened at all, file it under
        # "Can't Open" and skip classification / AI / links / series detection.
        if meta.get("parse_failed"):
            doc = {
                "book_id": book_id,
                "user_id": user.user_id,
                "filename": f.filename,
                "title": meta.get("title") or f.filename,
                "author": "Unknown",
                "description": "",
                "language": "",
                "publisher": "",
                "has_cover": False,
                "category": "Can't Open",
                "fandom": None,
                "confidence": 1.0,
                "classifier": "broken-epub",
                "size_bytes": len(content),
                "links_count": 0,
                "source_url": None,
                "last_refreshed_at": None,
                "series_name": None,
                "series_index": None,
                "epub_unreadable": True,
                "epub_parse_error": meta.get("parse_error"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.books.insert_one(doc)
            results.append({k: v for k, v in doc.items() if k != "_id"})
            continue

        classification = await classify_book(meta)

        # Save cover separately if exists
        cover_path = user_dir / f"{book_id}.cover"
        if meta.get('cover_bytes'):
            cover_path.write_bytes(meta['cover_bytes'])

        # Extract URLs and save to a notepad-friendly .txt file
        links = extract_urls_from_epub(target)
        links_path = user_dir / f"{book_id}.links.txt"
        links_path.write_text(
            format_links_txt(meta['title'], meta['author'], links),
            encoding='utf-8',
        )
        source_url = find_source_url(links)
        fanfic_urls = extract_fanfic_urls(links)

        # Series detection: prefer EPUB Calibre meta, fall back to title regex
        series_name = meta.get('series_name')
        series_index = meta.get('series_index')
        if not series_name:
            sn, si = detect_series_from_title(meta['title'])
            if sn:
                series_name = sn
                series_index = si if si is not None else series_index

        doc = {
            "book_id": book_id,
            "user_id": user.user_id,
            "filename": f.filename,
            "title": meta['title'],
            "author": meta['author'],
            "description": meta['description'],
            "language": meta['language'],
            "publisher": meta['publisher'],
            "has_cover": bool(meta.get('cover_bytes')),
            "category": classification['category'],
            "fandom": classification.get('fandom'),
            "confidence": classification['confidence'],
            "classifier": classification['classifier'],
            "tags": classification.get("tags") or [],
            "size_bytes": len(content),
            "links_count": len(links),
            "source_url": source_url,
            "fanfic_urls": fanfic_urls,
            "last_refreshed_at": None,
            "series_name": series_name,
            "series_index": series_index,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if original_format:
            # Surface the source format so the UI can show e.g. "Converted from PDF"
            doc["original_format"] = original_format
            doc["converted_from"] = original_format

        # Duplicate detection — flag, don't block. The UI pops a modal letting
        # the user choose: keep both / discard this upload / promote as new
        # version of the existing book.
        dupes = await find_duplicate_candidates(
            user.user_id,
            title=meta['title'],
            source_url=source_url,
            fanfic_urls=fanfic_urls,
        )
        if dupes:
            doc["duplicate_pending"] = True
            doc["duplicate_of"] = dupes

        await db.books.insert_one(doc)
        results.append({k: v for k, v in doc.items() if k != '_id'})

    # Auto-resolve based on the user's default duplicate policy. When the
    # policy is "ask" we leave duplicate_pending on every flagged book so the
    # UI pops the modal. For other policies we apply the action immediately.
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "duplicate_policy": 1})
    policy = (user_doc or {}).get("duplicate_policy") or DUPE_POLICY_DEFAULT
    auto_resolved = 0
    actions: List[Dict[str, Any]] = []
    if policy != "ask":
        for i, doc in enumerate(results):
            if not doc.get("duplicate_pending"):
                continue
            target_id = (doc.get("duplicate_of") or [{}])[0].get("book_id")
            applied = await _apply_duplicate_policy(
                user.user_id, doc["book_id"], target_id, policy,
            )
            if applied:
                auto_resolved += 1
                actions.append({
                    "book_id": doc["book_id"],
                    "title": doc.get("title") or "",
                    "action": applied.get("action"),
                    "target_book_id": applied.get("target_book_id"),
                    "undoable": applied.get("undoable", False),
                })
                # Reflect the auto-resolve in the response so the UI knows
                if applied.get("deleted"):
                    results[i] = {**doc, "duplicate_pending": False, "duplicate_resolved": "discard", "removed": True}
                else:
                    fresh = await db.books.find_one({"book_id": doc["book_id"], "user_id": user.user_id})
                    if fresh:
                        fresh.pop("_id", None)
                        fresh["duplicate_resolved"] = applied.get("action")
                        results[i] = fresh

    return {"uploaded": len(results), "books": results, "auto_resolved": auto_resolved, "policy": policy, "actions": actions}


@api_router.get("/books")
async def list_books(
    request: Request,
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    q: Optional[str] = None,
    smart: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query['category'] = category
    else:
        # Trash is opt-in — only show when the user explicitly asks for it
        query['category'] = {"$ne": TRASH_SHELF}
    if fandom:
        query['fandom'] = fandom

    or_clauses: List[List[Dict[str, Any]]] = []
    if q:
        or_clauses.append([
            {"title": {"$regex": q, "$options": "i"}},
            {"author": {"$regex": q, "$options": "i"}},
        ])

    if smart == "reading":
        query['progress_percent'] = {"$gte": 0.05, "$lt": 0.95}
    elif smart == "finished":
        query['progress_percent'] = {"$gte": 0.99}
    elif smart == "unavailable":
        query['unavailable'] = True
    elif smart == "unread":
        or_clauses.append([
            {"progress_percent": {"$exists": False}},
            {"progress_percent": None},
            {"progress_percent": {"$lt": 0.05}},
        ])

    if len(or_clauses) == 1:
        query["$or"] = or_clauses[0]
    elif len(or_clauses) > 1:
        query["$and"] = [{"$or": clauses} for clauses in or_clauses]

    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"books": books}


@api_router.get("/books/stats")
async def book_stats(user: User = Depends(get_current_user)):
    pipeline_cat = [
        {"$match": {"user_id": user.user_id}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]
    pipeline_fandom = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    cats = await db.books.aggregate(pipeline_cat).to_list(100)
    fandoms = await db.books.aggregate(pipeline_fandom).to_list(100)
    total = await db.books.count_documents({"user_id": user.user_id})
    reading = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_percent": {"$gte": 0.05, "$lt": 0.95},
    })
    finished = await db.books.count_documents({
        "user_id": user.user_id,
        "progress_percent": {"$gte": 0.99},
    })
    unreadable = await db.books.count_documents({
        "user_id": user.user_id,
        "epub_unreadable": True,
    })
    return {
        "total": total,
        "reading": reading,
        "finished": finished,
        "unreadable": unreadable,
        "categories": [{"name": c['_id'], "count": c['count']} for c in cats],
        "fandoms": [{"name": f['_id'], "count": f['count']} for f in fandoms],
    }


def _suggest_search_url(source_url: Optional[str], title: str, author: str) -> Optional[str]:
    """Build a 'find it again' search URL on the same site as the dead source."""
    from urllib.parse import quote_plus
    q = quote_plus(f"{title or ''} {author or ''}".strip())
    if not q:
        return None
    host = (source_url or "").lower()
    if "archiveofourown.org" in host:
        return f"https://archiveofourown.org/works/search?work_search%5Bquery%5D={q}"
    if "fanfiction.net" in host:
        return f"https://www.fanfiction.net/search/?keywords={q}&type=story"
    if "fictionpress.com" in host:
        return f"https://www.fictionpress.com/search/?keywords={q}&type=story"
    if "royalroad.com" in host:
        return f"https://www.royalroad.com/fictions/search?title={q}"
    if "spacebattles.com" in host or "sufficientvelocity.com" in host or "questionablequesting.com" in host:
        base = host.split("/")[2] if "://" in host else host
        return f"https://www.google.com/search?q=site%3A{base}+{q}"
    # Generic fallback: Google
    return f"https://www.google.com/search?q={q}"


@api_router.get("/books/export/unavailable")
async def export_unavailable_list(user: User = Depends(get_current_user)):
    """A plain .txt list of every book FanFicFare couldn't find — for manual lookup."""
    books = await db.books.find(
        {"user_id": user.user_id, "unavailable": True},
        {"_id": 0},
    ).sort("title", 1).to_list(5000)

    lines: List[str] = []
    lines.append("Shelfsort — books we couldn't fetch online")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"Count: {len(books)}")
    lines.append("=" * 70)
    lines.append("")
    if not books:
        lines.append("(none — every refreshable book updated successfully)")
    else:
        for i, b in enumerate(books, 1):
            shelf = b.get("category") or "Uncategorized"
            if shelf == "Fanfiction" and b.get("fandom"):
                shelf = f"Fanfiction / {b['fandom']}"
            lines.append(f"{i}. {b.get('title') or '(untitled)'}")
            lines.append(f"   Author:      {b.get('author') or 'Unknown'}")
            lines.append(f"   Shelf:       {shelf}")
            if b.get("source_url"):
                lines.append(f"   Source URL:  {b['source_url']}")
            if b.get("last_fetch_error"):
                lines.append(f"   Source said: {b['last_fetch_error']}")
            if b.get("last_fetch_attempt_at"):
                lines.append(f"   Last tried:  {b['last_fetch_attempt_at']}")
            search = _suggest_search_url(
                b.get("source_url"), b.get("title", ""), b.get("author", "")
            )
            if search:
                lines.append(f"   How to fix:  {search}")
            lines.append("")
    body = "\n".join(lines) + "\n"
    headers = {"Content-Disposition": "attachment; filename=shelfsort_cant_find_online.txt"}
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)


@api_router.get("/books/refresh-status")
async def refresh_status(user: User = Depends(get_current_user)):
    """How many books in the library can be refreshed from a known fanfic source?"""
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "source_url": 1, "title": 1, "last_refreshed_at": 1, "unavailable": 1, "category": 1, "replaced_by": 1},
    ).to_list(5000)
    refreshable = sum(
        1 for b in books
        if b.get("source_url")
        and not b.get("unavailable")
        and not b.get("replaced_by")
        and b.get("category") != OLD_STORIES_SHELF
    )
    unavailable = sum(1 for b in books if b.get("unavailable"))
    last = None
    for b in books:
        if b.get("last_refreshed_at"):
            if last is None or b["last_refreshed_at"] > last:
                last = b["last_refreshed_at"]
    return {
        "refreshable": refreshable,
        "unavailable": unavailable,
        "total": len(books),
        "last_refreshed_at": last,
    }


@api_router.get("/books/recent")
async def list_recent(limit: int = 8, user: User = Depends(get_current_user)):
    """Recently-opened books for the dashboard's Continue Reading rail."""
    cursor = db.books.find(
        {"user_id": user.user_id, "last_opened_at": {"$ne": None, "$exists": True}},
        {"_id": 0},
    ).sort("last_opened_at", -1).limit(max(1, min(int(limit), 24)))
    books = await cursor.to_list(24)
    return {"books": books}


@api_router.get("/books/recent-updates")
async def recent_updates(limit: int = 8, user: User = Depends(get_current_user)):
    """Fanfics that have been refreshed and haven't been marked as seen.
    Powers the "fics updated" navbar bell badge."""
    limit = max(1, min(int(limit), 24))
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "replaces": {"$ne": None, "$exists": True},
            "update_seen": {"$ne": True},
        },
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "fandom": 1,
            "category": 1,
            "last_refreshed_at": 1,
            "replaces": 1,
            "refresh_summary": 1,
            "has_cover": 1,
        },
    ).sort("last_refreshed_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    # Total unseen (so the badge can say "8+" if there are more)
    total_unseen = await db.books.count_documents({
        "user_id": user.user_id,
        "replaces": {"$ne": None, "$exists": True},
        "update_seen": {"$ne": True},
    })
    return {"updates": items, "total_unseen": total_unseen}


@api_router.post("/books/{book_id}/mark-update-seen")
async def mark_update_seen(book_id: str, user: User = Depends(get_current_user)):
    """Mark a single refreshed book as seen — removes it from the bell badge."""
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"update_seen": True, "update_seen_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.post("/books/mark-updates-seen")
async def mark_all_updates_seen(user: User = Depends(get_current_user)):
    """Mark every pending refreshed book as seen — clears the bell badge."""
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.books.update_many(
        {
            "user_id": user.user_id,
            "replaces": {"$ne": None, "$exists": True},
            "update_seen": {"$ne": True},
        },
        {"$set": {"update_seen": True, "update_seen_at": now_iso}},
    )
    return {"ok": True, "marked": result.modified_count}


# ============================================================
# FANFICFARE USER OPTIONS
# ============================================================
class FFFOptionsBody(BaseModel):
    include_author_notes: Optional[bool] = None
    include_images: Optional[bool] = None
    keep_chapter_links: Optional[bool] = None
    apply_template: Optional[bool] = None


FFF_OPTION_DEFAULTS = {
    "include_author_notes": True,
    "include_images": True,
    "keep_chapter_links": False,
    "apply_template": True,
}


@api_router.get("/user/fff-options")
async def get_fff_options(user: User = Depends(get_current_user)):
    """Return the user's FanFicFare options for fanfiction downloads."""
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1})
    stored = (user_doc or {}).get("fff_options") or {}
    return {**FFF_OPTION_DEFAULTS, **stored}


@api_router.put("/user/fff-options")
async def update_fff_options(body: FFFOptionsBody, user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1})
    stored = (user_doc or {}).get("fff_options") or {}
    patch = body.dict(exclude_none=True)
    stored.update(patch)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"fff_options": stored}},
    )
    return {**FFF_OPTION_DEFAULTS, **stored}


# Dashboard "At a glance" folder — user-orderable section list.
DASHBOARD_SECTIONS = ("continue", "stats", "shelves")
DASHBOARD_DEFAULT_ORDER = list(DASHBOARD_SECTIONS)


# Default duplicate-handling policy. "ask" = show the modal (current behavior);
# the rest run silently after upload, matching the resolve-duplicate actions.
DUPE_POLICIES = ("ask", "keep_both", "discard", "new_version", "historical")
DUPE_POLICY_DEFAULT = "ask"


class DuplicatePolicyBody(BaseModel):
    policy: str


@api_router.get("/user/duplicate-policy")
async def get_duplicate_policy(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "duplicate_policy": 1})
    return {"policy": (user_doc or {}).get("duplicate_policy") or DUPE_POLICY_DEFAULT}


@api_router.put("/user/duplicate-policy")
async def update_duplicate_policy(body: DuplicatePolicyBody, user: User = Depends(get_current_user)):
    if body.policy not in DUPE_POLICIES:
        raise HTTPException(status_code=400, detail=f"policy must be one of {list(DUPE_POLICIES)}")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"duplicate_policy": body.policy}},
    )
    return {"policy": body.policy}


class DashboardLayoutBody(BaseModel):
    order: List[str]
    hidden: Optional[List[str]] = None


@api_router.get("/user/dashboard-layout")
async def get_dashboard_layout(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "dashboard_layout": 1})
    stored = (user_doc or {}).get("dashboard_layout") or {}
    order = stored.get("order") or DASHBOARD_DEFAULT_ORDER
    hidden = stored.get("hidden") or []
    # Drop unknown keys, pad with any missing defaults so the UI is never empty
    seen: set = set()
    cleaned: List[str] = []
    for k in order:
        if k in DASHBOARD_SECTIONS and k not in seen:
            seen.add(k)
            cleaned.append(k)
    for k in DASHBOARD_DEFAULT_ORDER:
        if k not in seen:
            cleaned.append(k)
            seen.add(k)
    cleaned_hidden = [k for k in hidden if k in DASHBOARD_SECTIONS]
    return {"order": cleaned, "hidden": cleaned_hidden}


@api_router.put("/user/dashboard-layout")
async def update_dashboard_layout(body: DashboardLayoutBody, user: User = Depends(get_current_user)):
    # Validate: every item must be a known section, no duplicates
    seen: set = set()
    cleaned: List[str] = []
    for k in body.order:
        if k not in DASHBOARD_SECTIONS:
            raise HTTPException(status_code=400, detail=f"Unknown section '{k}'")
        if k in seen:
            raise HTTPException(status_code=400, detail=f"Section '{k}' appears more than once")
        seen.add(k)
        cleaned.append(k)
    # Pad missing sections at the end so the order is always complete
    for k in DASHBOARD_DEFAULT_ORDER:
        if k not in seen:
            cleaned.append(k)
            seen.add(k)
    cleaned_hidden: List[str] = []
    if body.hidden is not None:
        for k in body.hidden:
            if k not in DASHBOARD_SECTIONS:
                raise HTTPException(status_code=400, detail=f"Unknown hidden section '{k}'")
            if k not in cleaned_hidden:
                cleaned_hidden.append(k)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"dashboard_layout": {"order": cleaned, "hidden": cleaned_hidden}}},
    )
    return {"order": cleaned, "hidden": cleaned_hidden}


@api_router.post("/user/apply-template-to-all")
async def apply_template_to_all(user: User = Depends(get_current_user)):
    """Run apply_template_to_epub over every EPUB the user has on disk.

    Idempotent — already-templated EPUBs are detected via the marker in
    content.opf and skipped without rewriting bytes. Returns a summary.

    Implementation note: we run synchronously inside a worker thread so the
    request blocks until done. For typical libraries (≤500 books) this is
    well under a minute. We hard-cap at 1000 books so an outlier library
    doesn't hang the API; the user can re-run to pick up the rest.
    """
    user_dir = STORAGE_DIR / user.user_id
    if not user_dir.exists():
        return {"processed": 0, "templated": 0, "already_templated": 0, "errors": 0, "skipped": 0}

    # Pull a lean list of books (need: book_id, title, author, source_url, metadata, ...)
    books = await db.books.find(
        {"user_id": user.user_id},
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "description": 1,
            "source_url": 1,
            "source_meta": 1,
            "chapters": 1,
            "words": 1,
        },
    ).limit(1000).to_list(1000)

    processed = 0
    templated = 0
    already_templated = 0
    errors = 0
    skipped = 0

    loop = asyncio.get_event_loop()

    def _process_one(book: Dict[str, Any]) -> str:
        nonlocal processed, templated, already_templated, errors, skipped
        epub_path = user_dir / f"{book['book_id']}.epub"
        if not epub_path.exists():
            return "skipped"
        try:
            raw = epub_path.read_bytes()
        except Exception:
            return "error"
        # Build meta dict matching what apply_refresh would pass
        meta: Dict[str, Any] = {
            "title": book.get("title") or "",
            "author": book.get("author") or "",
            "description": book.get("description") or "",
            "chapters": book.get("chapters") or 0,
            "rawExtendedMeta": (book.get("source_meta") or {}).get("rawExtendedMeta") or {},
        }
        # source_url falls back to whatever's on the book or empty string
        src = book.get("source_url") or ""
        new_bytes = apply_template_to_epub(raw, meta, src)
        if new_bytes == raw:
            return "already_templated"
        try:
            epub_path.write_bytes(new_bytes)
            return "templated"
        except Exception:
            return "error"

    # Run in a thread pool so we don't block the event loop
    for book in books:
        outcome = await loop.run_in_executor(None, _process_one, book)
        processed += 1
        if outcome == "templated":
            templated += 1
        elif outcome == "already_templated":
            already_templated += 1
        elif outcome == "error":
            errors += 1
        elif outcome == "skipped":
            skipped += 1

    return {
        "processed": processed,
        "templated": templated,
        "already_templated": already_templated,
        "errors": errors,
        "skipped": skipped,
        "total_in_library": len(books),
    }


@api_router.post("/user/tidy-filenames")
async def tidy_filenames(user: User = Depends(get_current_user)):
    """Rename every book's stored `filename` field to the templated pattern:
       'Title_by_Author-<short_id>.epub' (matches the user's reference EPUB).

    On-disk filenames stay as `{book_id}.epub` (an internal id) — only the
    user-facing field changes. The single-book download endpoint and the ZIP
    export already build the templated name from book.title/author, so this is
    purely a cosmetic backfill for the BookDetail page's "File" line.
    """
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "filename": 1},
    ).limit(5000).to_list(5000)

    updated = 0
    already_correct = 0
    for b in books:
        target = _templated_filename(b.get("title"), b.get("author"), b["book_id"])
        current = b.get("filename") or ""
        if current == target:
            already_correct += 1
            continue
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {"$set": {"filename": target}},
        )
        updated += 1

    return {
        "updated": updated,
        "already_correct": already_correct,
        "total": len(books),
    }


# ============================================================
# Onboarding prompt — asks first-time users if they want their
# library polished with the Shelfsort template + tidy filenames.
# ============================================================
class OnboardingDecisionBody(BaseModel):
    accept: bool


@api_router.get("/user/onboarding-status")
async def onboarding_status(user: User = Depends(get_current_user)):
    """Return whether the template-onboarding banner should be shown."""
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "template_prompt_dismissed": 1, "created_at": 1},
    ) or {}
    book_count = await db.books.count_documents({"user_id": user.user_id})
    return {
        "template_prompt_pending": (
            book_count >= 1
            and not bool(user_doc.get("template_prompt_dismissed"))
        ),
        "book_count": book_count,
    }


@api_router.post("/user/dismiss-template-prompt")
async def dismiss_template_prompt(
    body: OnboardingDecisionBody,
    user: User = Depends(get_current_user),
):
    """Persist the user's onboarding choice. When `accept=true`, run both the
    template + tidy sweeps inline so the user sees the polished result on
    their very next page load."""
    # Mark dismissed regardless — we never want to ask twice
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "template_prompt_dismissed": True,
            "template_prompt_dismissed_at": datetime.now(timezone.utc).isoformat(),
            "template_prompt_accepted": bool(body.accept),
        }},
    )
    if not body.accept:
        return {"ok": True, "accepted": False}

    # Run both sweeps inline. Reuses the same logic as the standalone endpoints.
    user_dir = STORAGE_DIR / user.user_id
    template_summary: Dict[str, int] = {
        "templated": 0, "already_templated": 0, "errors": 0, "skipped": 0,
    }
    if user_dir.exists():
        books = await db.books.find(
            {"user_id": user.user_id},
            {
                "_id": 0, "book_id": 1, "title": 1, "author": 1, "description": 1,
                "source_url": 1, "source_meta": 1, "chapters": 1, "words": 1,
            },
        ).limit(1000).to_list(1000)
        loop = asyncio.get_event_loop()
        def _process(book: Dict[str, Any]) -> str:
            epub_path = user_dir / f"{book['book_id']}.epub"
            if not epub_path.exists():
                return "skipped"
            try:
                raw = epub_path.read_bytes()
            except Exception:
                return "error"
            meta: Dict[str, Any] = {
                "title": book.get("title") or "",
                "author": book.get("author") or "",
                "description": book.get("description") or "",
                "chapters": book.get("chapters") or 0,
                "rawExtendedMeta": (book.get("source_meta") or {}).get("rawExtendedMeta") or {},
            }
            new_bytes = apply_template_to_epub(raw, meta, book.get("source_url") or "")
            if new_bytes == raw:
                return "already_templated"
            try:
                epub_path.write_bytes(new_bytes)
                return "templated"
            except Exception:
                return "error"
        for b in books:
            outcome = await loop.run_in_executor(None, _process, b)
            if outcome in template_summary:
                template_summary[outcome] += 1

    # Tidy filenames sweep (DB-only, fast)
    tidied = 0
    tidied_already = 0
    all_books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "filename": 1},
    ).limit(5000).to_list(5000)
    for b in all_books:
        target = _templated_filename(b.get("title"), b.get("author"), b["book_id"])
        if (b.get("filename") or "") == target:
            tidied_already += 1
            continue
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {"$set": {"filename": target}},
        )
        tidied += 1

    return {
        "ok": True,
        "accepted": True,
        "template": template_summary,
        "filenames": {"updated": tidied, "already_correct": tidied_already},
    }










@api_router.get("/books/{book_id}")
async def get_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    return book


@api_router.get("/books/{book_id}/reading-stats")
async def book_reading_stats(book_id: str, user: User = Depends(get_current_user)):
    """Per-book reading stats for the book-detail page.

    Returns:
      - reading_minutes: total time spent in this book (from heartbeats)
      - session_count: distinct days this book was opened/read
      - first_opened_at: ISO date of the first reading_activity row with this book
      - last_opened_at: from book document
      - sparkline: last 30 days, binary { date, active } per day
    """
    from datetime import date as _date, timedelta as _td

    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "reading_minutes": 1, "last_opened_at": 1, "created_at": 1, "progress_percent": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    activity = await db.reading_activity.find(
        {"user_id": user.user_id, "book_ids": book_id},
        {"_id": 0, "date": 1, "book_minutes": 1},
    ).sort("date", 1).to_list(2000)
    dates: List[str] = [a["date"] for a in activity if a.get("date")]
    # Map date -> minutes spent on THIS book that day. Older activity rows
    # (before per-book tracking landed) lack `book_minutes`; treat as 0.
    minutes_by_date: Dict[str, float] = {}
    for a in activity:
        bm = a.get("book_minutes") or {}
        minutes_by_date[a["date"]] = float(bm.get(book_id, 0))

    today = datetime.now(timezone.utc).date()
    cutoff = today - _td(days=29)
    date_set = set(dates)
    sparkline: List[Dict[str, Any]] = []
    # Find the day's max minutes (within the window) so the UI can normalize
    # bar heights without a second pass.
    window_minutes: List[float] = [
        minutes_by_date.get((cutoff + _td(days=i)).isoformat(), 0) for i in range(30)
    ]
    max_minutes = max(window_minutes) if window_minutes else 0
    for i in range(30):
        d = cutoff + _td(days=i)
        key = d.isoformat()
        mins = minutes_by_date.get(key, 0)
        sparkline.append({
            "date": key,
            "active": key in date_set,
            "minutes": int(mins),
        })

    # Reading-pace estimate: time-to-finish based on minutes-per-progress so far.
    # Only show when there's enough signal to avoid wild extrapolations:
    #   * at least 5 minutes of tracked reading (otherwise per-progress is noisy)
    #   * progress between 5% and 99% (else division explodes or book is done)
    reading_minutes = int(book.get("reading_minutes") or 0)
    progress = float(book.get("progress_percent") or 0)
    estimated_minutes_left: Optional[int] = None
    if reading_minutes >= 5 and 0.05 <= progress < 0.99:
        try:
            estimated_minutes_left = max(0, int(round(
                (reading_minutes / progress) * (1 - progress)
            )))
            # Sanity cap at 1 week of reading (10080 min) — clamps wild outliers
            estimated_minutes_left = min(estimated_minutes_left, 10080)
        except (ZeroDivisionError, ValueError):
            estimated_minutes_left = None

    return {
        "book_id": book_id,
        "reading_minutes": reading_minutes,
        "session_count": len(dates),
        "first_opened_at": dates[0] if dates else None,
        "last_opened_at": book.get("last_opened_at"),
        "sparkline": sparkline,
        "sparkline_max_minutes": int(max_minutes),
        "progress_percent": progress,
        "estimated_minutes_left": estimated_minutes_left,
    }





@api_router.get("/books/{book_id}/cover")
async def get_cover(book_id: str, request: Request):
    # Allow token in query for img src
    token = request.query_params.get('t')
    user_id = None
    if token:
        sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if sess:
            user_id = sess['user_id']
    if not user_id:
        try:
            user = await get_current_user(request)
            user_id = user.user_id
        except HTTPException:
            raise HTTPException(status_code=401, detail="Not authenticated")
    book = await db.books.find_one({"book_id": book_id, "user_id": user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    cover = STORAGE_DIR / user_id / f"{book_id}.cover"
    if not cover.exists():
        raise HTTPException(status_code=404, detail="No cover")
    return FileResponse(str(cover), media_type="image/jpeg")


@api_router.get("/books/{book_id}/download")
async def download_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File missing")
    download_name = _templated_filename(book.get('title'), book.get('author'), book_id)
    return FileResponse(str(fp), media_type="application/epub+zip", filename=download_name)


@api_router.delete("/books/{book_id}")
async def delete_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    await db.books.delete_one({"book_id": book_id, "user_id": user.user_id})
    for ext in ['.epub', '.cover', '.links.txt']:
        p = STORAGE_DIR / user.user_id / f"{book_id}{ext}"
        if p.exists():
            p.unlink()
    return {"ok": True}


def _safe_filename(name: str, ext: str) -> str:
    # Strip path separators / control chars
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', name or 'book').strip().rstrip('.')
    base = base[:120] or 'book'
    return f"{base}{ext}"


def _templated_filename(title: Optional[str], author: Optional[str], book_id: str, ext: str = ".epub") -> str:
    """Build a filename matching the attachment template: 'Title_by_Author-id.epub'.
    Underscores replace spaces, control + filesystem-unsafe chars are stripped,
    and a short 8-char book_id suffix disambiguates same-name fics."""
    def _clean(s: str) -> str:
        s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', s or '')
        s = re.sub(r'\s+', '_', s.strip())
        return s.strip('._') or ''
    title_part = _clean(title or 'Untitled')[:80]
    author_part = _clean(author or 'Unknown')[:50]
    # Take the trailing 8 chars of the book_id for a stable, short, unique suffix
    short_id = (book_id or '').split('_')[-1][:8] or 'x'
    return f"{title_part}_by_{author_part}-{short_id}{ext}"


@api_router.get("/books/export/links")
async def export_all_links(
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    format: str = "txt",
    user: User = Depends(get_current_user),
):
    """Download every URL across the user's library (or a filter).

    `format=txt` (default): one combined .txt file.
    `format=zip`: a .zip with one .txt per fandom (grouped by like fanfiction).
    `format=xlsx`: a single .xlsx workbook with one sheet per fandom, each
        row containing the book's full metadata + extracted URL count.
    """
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = category
    if fandom:
        query["fandom"] = fandom
    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    user_dir = STORAGE_DIR / user.user_id

    # XLSX format — single workbook, one sheet per fandom, full metadata per row
    if format == "xlsx":
        import io as _io
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment

        wb = Workbook()
        # Group books by fandom (or category for non-fanfic)
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for b in books:
            cat = b.get('category') or 'Uncategorized'
            bucket = b.get('fandom') if cat == 'Fanfiction' and b.get('fandom') else cat
            buckets.setdefault(bucket, []).append(b)

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill("solid", fgColor="3A5A40")
        header_align = Alignment(horizontal="left", vertical="center")
        columns = [
            ("Title", "title", 36),
            ("Author", "author", 22),
            ("Fandom", "fandom", 22),
            ("Source URL", "source_url", 60),
        ]

        # Summary sheet first
        ws_summary = wb.active
        ws_summary.title = "Summary"
        ws_summary["A1"] = "Shelfsort library export"
        ws_summary["A1"].font = Font(bold=True, size=14)
        ws_summary["A2"] = f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
        ws_summary["A3"] = f"Books total: {len(books)}"
        ws_summary["A4"] = f"Fandoms / categories: {len(buckets)}"
        ws_summary["A6"] = "Fandom / Category"
        ws_summary["B6"] = "Books"
        ws_summary["A6"].font = header_font
        ws_summary["B6"].font = header_font
        ws_summary["A6"].fill = header_fill
        ws_summary["B6"].fill = header_fill
        for i, (bk, lst) in enumerate(sorted(buckets.items()), start=7):
            ws_summary[f"A{i}"] = bk
            ws_summary[f"B{i}"] = len(lst)
        ws_summary.column_dimensions["A"].width = 30
        ws_summary.column_dimensions["B"].width = 10

        def _sheet_name(name: str) -> str:
            # Excel limits: ≤31 chars, no : \ / ? * [ ]
            cleaned = re.sub(r'[:\\/?*\[\]]', '-', name)[:31] or "Sheet"
            return cleaned

        used_names: set = {"Summary"}
        for bucket_name, bucket_books in sorted(buckets.items()):
            base = _sheet_name(bucket_name)
            name = base
            suffix = 2
            while name in used_names:
                name = (base[:28] + f"_{suffix}")[:31]
                suffix += 1
            used_names.add(name)
            ws = wb.create_sheet(title=name)
            # Header row
            for col_idx, (label, _key, width) in enumerate(columns, start=1):
                cell = ws.cell(row=1, column=col_idx, value=label)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = header_align
                ws.column_dimensions[cell.column_letter].width = width
            ws.freeze_panes = "A2"
            # Data rows
            for r_idx, b in enumerate(bucket_books, start=2):
                for c_idx, (label, key, _w) in enumerate(columns, start=1):
                    ws.cell(row=r_idx, column=c_idx, value=b.get(key) or "")
            ws.auto_filter.ref = ws.dimensions

        buf = _io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        xlsx_name = "shelfsort_library.xlsx"
        if fandom:
            xlsx_name = f"shelfsort_{_safe_folder(fandom)}.xlsx"
        elif category:
            xlsx_name = f"shelfsort_{_safe_folder(category)}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={xlsx_name}"},
        )

    # ZIP format — one .txt per fandom (or category for non-fanfiction)
    if format == "zip":
        import io as _io
        # Group books by their bucket — fanfiction sub-groups by fandom,
        # everything else groups by category.
        buckets: Dict[str, List[Dict[str, Any]]] = {}
        for b in books:
            category_val = b.get('category') or 'Uncategorized'
            if category_val == 'Fanfiction':
                bucket = b.get('fandom') or 'Unsorted Fanfiction'
            else:
                bucket = category_val
            buckets.setdefault(bucket, []).append(b)

        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
            summary_lines = [
                "Shelfsort — links grouped by fandom",
                f"Generated: {now_str}",
                f"Books: {len(books)}",
                f"Fandoms / shelves: {len(buckets)}",
                "",
                "Each .txt file groups every fanfic from one fandom (or",
                "category, for non-fanfiction books). Stories are separated",
                "by blank lines so you can scan a whole fandom at a glance.",
                "",
            ]
            zf.writestr("README.txt", "\n".join(summary_lines))

            for bucket_name, bucket_books in sorted(buckets.items()):
                bucket_lines: List[str] = []
                bucket_lines.append(f"=== {bucket_name} ===")
                bucket_lines.append(
                    f"{len(bucket_books)} book{'s' if len(bucket_books) != 1 else ''} · generated {now_str}"
                )
                bucket_lines.append("")
                bucket_total = 0
                for b in bucket_books:
                    epub_path = user_dir / f"{b['book_id']}.epub"
                    bucket_lines.append(
                        f"{b.get('title','Untitled')} — {b.get('author','Unknown')}"
                    )
                    if not epub_path.exists():
                        bucket_lines.append("  (EPUB missing on disk)")
                        bucket_lines.append("")
                        continue
                    links = extract_urls_from_epub(epub_path)
                    bucket_total += len(links)
                    if not links:
                        bucket_lines.append("  (no URLs)")
                    else:
                        for item in links:
                            anchor = item.get('anchor')
                            if anchor:
                                bucket_lines.append(f"  {item['url']}  —  {anchor}")
                            else:
                                bucket_lines.append(f"  {item['url']}")
                    bucket_lines.append("")
                bucket_lines.insert(2, f"Total URLs: {bucket_total}")
                arcname = f"{_safe_folder(bucket_name)}.txt"
                zf.writestr(arcname, "\n".join(bucket_lines) + "\n")

        buf.seek(0)
        zip_name = "shelfsort_links_by_fandom.zip"
        if fandom:
            zip_name = f"shelfsort_{_safe_folder(fandom)}_links.zip"
        elif category:
            zip_name = f"shelfsort_{_safe_folder(category)}_links.zip"
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_name}"},
        )

    # TXT format — combined single file (default, backward-compatible)
    scope = "your library"
    if fandom:
        scope = f"the {fandom} shelf"
    elif category:
        scope = f"the {category} shelf"

    lines: List[str] = []
    lines.append(f"Shelfsort — links extracted from {scope}")
    lines.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append(f"Books scanned: {len(books)}")
    lines.append("=" * 70)
    lines.append("")

    total_links = 0
    for b in books:
        epub_path = user_dir / f"{b['book_id']}.epub"
        if not epub_path.exists():
            continue
        links = extract_urls_from_epub(epub_path)
        total_links += len(links)

        shelf = b.get('category') or 'Uncategorized'
        if shelf == 'Fanfiction' and b.get('fandom'):
            shelf = f"Fanfiction / {b['fandom']}"

        lines.append(f"[{shelf}] {b.get('title','')} — {b.get('author','')}")
        if not links:
            lines.append("  (no URLs)")
        else:
            for item in links:
                if item.get('anchor'):
                    lines.append(f"  {item['url']}  —  {item['anchor']}")
                else:
                    lines.append(f"  {item['url']}")
        lines.append("")

    lines.insert(3, f"Total URLs:    {total_links}")
    body = "\n".join(lines) + "\n"

    fname = "shelfsort_all_links.txt"
    if fandom:
        fname = f"shelfsort_{_safe_folder(fandom)}_links.txt"
    elif category:
        fname = f"shelfsort_{_safe_folder(category)}_links.txt"
    headers = {"Content-Disposition": f"attachment; filename={fname}"}
    return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)


@api_router.get("/books/{book_id}/links")
async def get_book_links(book_id: str, user: User = Depends(get_current_user)):
    """Download the extracted URLs for a single book as a .txt file."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    user_dir = STORAGE_DIR / user.user_id
    links_path = user_dir / f"{book_id}.links.txt"

    # Regenerate if missing (e.g., older book uploaded before this feature)
    if not links_path.exists():
        epub_path = user_dir / f"{book_id}.epub"
        if not epub_path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        links = extract_urls_from_epub(epub_path)
        links_path.write_text(
            format_links_txt(book['title'], book['author'], links),
            encoding='utf-8',
        )
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$set": {"links_count": len(links)}},
        )

    filename = _safe_filename(book.get('title') or book_id, '.links.txt')
    return FileResponse(str(links_path), media_type="text/plain; charset=utf-8", filename=filename)


class ReclassifyBody(BaseModel):
    use_ai: bool = True


class ReclassifyAllBody(BaseModel):
    only_unclassified: bool = True
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/reclassify-all")
async def reclassify_all(body: ReclassifyAllBody, user: User = Depends(get_current_user)):
    """Run the AI classifier on every matching book, then persist the new labels."""
    query: Dict[str, Any] = {"user_id": user.user_id}
    if body.only_unclassified:
        query["category"] = "Unclassified"
    else:
        if body.category:
            query["category"] = body.category
        if body.fandom:
            query["fandom"] = body.fandom

    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        return {"processed": 0, "changed": 0}

    user_dir = STORAGE_DIR / user.user_id
    sem = asyncio.Semaphore(3)  # cap concurrent AI calls

    async def process(b):
        async with sem:
            fp = user_dir / f"{b['book_id']}.epub"
            if not fp.exists():
                return None
            try:
                meta = extract_epub_metadata(fp)
                cls = await classify_with_ai(meta)
            except Exception as e:
                logger.error(f"AI reclass error for {b['book_id']}: {e}")
                return None
            if cls['confidence'] <= 0:
                return None
            return (b['book_id'], cls)

    results = await asyncio.gather(*[process(b) for b in books])
    changed = 0
    for r in results:
        if not r:
            continue
        bid, cls = r
        await db.books.update_one(
            {"book_id": bid, "user_id": user.user_id},
            {"$set": {
                "category": cls['category'],
                "fandom": cls.get('fandom'),
                "confidence": cls['confidence'],
                "classifier": cls['classifier'],
            }},
        )
        changed += 1
    return {"processed": len(books), "changed": changed}


@api_router.post("/books/{book_id}/reclassify")
async def reclassify_book(book_id: str, body: ReclassifyBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File missing")
    meta = extract_epub_metadata(fp)
    classification = await classify_book(meta, force_ai=body.use_ai)
    await db.books.update_one(
        {"book_id": book_id},
        {"$set": {
            "category": classification['category'],
            "fandom": classification.get('fandom'),
            "confidence": classification['confidence'],
            "classifier": classification['classifier'],
        }},
    )
    return classification


class UpdateBookBody(BaseModel):
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/refresh-all")
async def refresh_all(user: User = Depends(get_current_user)):
    """Re-pull every refreshable book from its source. Runs serially per FanFicFare guidance."""
    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    user_dir = STORAGE_DIR / user.user_id

    # Determine eligible books (have a known fanfic source URL AND not already marked unavailable)
    eligible: List[tuple] = []
    for b in books:
        if b.get("unavailable"):
            continue
        # Skip books that have already been superseded by a newer refresh
        if b.get("replaced_by") or b.get("category") == OLD_STORIES_SHELF:
            continue
        src = b.get("source_url")
        if not src:
            epub_path = user_dir / f"{b['book_id']}.epub"
            if epub_path.exists():
                src = find_source_url(extract_urls_from_epub(epub_path))
        if src:
            eligible.append((b, src))

    refreshed = 0
    refreshed_new_ids: List[str] = []
    failures: List[Dict[str, str]] = []
    marked_unavailable = 0
    for b, src in eligible:
        try:
            result = await apply_refresh(b, user.user_id, src)
            refreshed += 1
            if result.get("new_book_id"):
                refreshed_new_ids.append(result["new_book_id"])
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {"unavailable": False, "last_fetch_error": None}},
            )
        except FanficNotFoundError as e:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {
                    "unavailable": True,
                    "last_fetch_error": str(e),
                    "last_fetch_attempt_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            marked_unavailable += 1
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        except HTTPException as he:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": he.detail})
        except Exception as e:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        await asyncio.sleep(1.5)

    # If anything was refreshed, fire off the opt-in fic-update digest (best-effort)
    if refreshed_new_ids:
        try:
            from routes.digest import maybe_send_update_digest  # lazy to avoid circular
            asyncio.create_task(maybe_send_update_digest(user.user_id, refreshed_new_ids))
        except Exception as e:
            logger.warning("Failed to schedule update digest: %s", e)

    return {
        "eligible": len(eligible),
        "refreshed": refreshed,
        "marked_unavailable": marked_unavailable,
        "failures": failures,
    }


# ============================================================
# FANFIC STATUS PROBE (cached) + RETRY-UNAVAILABLE
# ============================================================
_fanfic_status_cache: Dict[str, Any] = {"checked_at": None, "ok": None, "detail": "", "previous_ok": None}
_FANFIC_PROBE_URL = "https://archiveofourown.org/works/30043233"  # a known-good AO3 work


async def _probe_fanfic_now() -> tuple:
    """Health probe — checks that FanFicFare can reach a supported site (AO3).
    Returns (ok, detail). Lightweight HEAD request, no story-fetch needed."""
    base = os.environ.get("FANFIC_BASE_URL", "")
    # If test suite has overridden the base URL, defer to FanFicFare-style probe
    if base:
        loop = asyncio.get_event_loop()
        def _probe():
            try:
                r = http_requests.get(
                    f"{base.rstrip('/')}/api/v0/epub",
                    params={"q": _FANFIC_PROBE_URL},
                    headers={"User-Agent": FANFICFARE_USER_AGENT, "Accept": "application/json"},
                    timeout=15,
                )
                r.raise_for_status()
                data = r.json()
                err = data.get("err", 0)
                if err in (-9, -1):
                    return False, f"Mock server err={err}"
                if not (data.get("urls") or {}).get("epub"):
                    return False, "Mock response missing EPUB URL"
                return True, "Mock fanfic source responding."
            except Exception as e:
                return False, f"Couldn't reach source: {e}"
        return await loop.run_in_executor(None, _probe)

    # Real probe: HEAD request to AO3 home (proxy for "is the internet healthy")
    loop = asyncio.get_event_loop()
    def _probe():
        try:
            r = http_requests.head(
                "https://archiveofourown.org/",
                headers={"User-Agent": FANFICFARE_USER_AGENT},
                timeout=10,
                allow_redirects=True,
            )
            if r.status_code in (200, 301, 302):
                return True, "Fanfic sources are reachable (AO3 healthy)."
            return False, f"AO3 returned HTTP {r.status_code}"
        except Exception as e:
            return False, f"Couldn't reach AO3: {e}"
    return await loop.run_in_executor(None, _probe)


async def _sweep_user_unavailable(user_id: str) -> Dict[str, int]:
    """Retry every unavailable book for one user. Called by the scheduler when
    the fanfic source flips from down→up. Returns counts."""
    books = await db.books.find(
        {"user_id": user_id, "unavailable": True},
        {"_id": 0},
    ).to_list(5000)
    if not books:
        return {"attempted": 0, "refreshed": 0, "still_unavailable": 0}

    await db.books.update_many(
        {"user_id": user_id, "unavailable": True},
        {"$unset": {"unavailable": "", "last_fetch_error": ""}},
    )

    refreshed = 0
    still_unavailable = 0
    refreshed_new_ids: List[str] = []
    for b in books:
        src = b.get("source_url")
        if not src:
            continue
        try:
            result = await apply_refresh(b, user_id, src)
            refreshed += 1
            if result.get("new_book_id"):
                refreshed_new_ids.append(result["new_book_id"])
        except FanficNotFoundError as e:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user_id},
                {"$set": {
                    "unavailable": True,
                    "last_fetch_error": str(e),
                    "last_fetch_attempt_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            still_unavailable += 1
        except Exception:
            pass
        await asyncio.sleep(1.5)
    # Best-effort opt-in digest
    if refreshed_new_ids:
        try:
            from routes.digest import maybe_send_update_digest  # lazy import
            asyncio.create_task(maybe_send_update_digest(user_id, refreshed_new_ids))
        except Exception as e:
            logger.warning("Failed to schedule update digest from sweep: %s", e)
    return {"attempted": len(books), "refreshed": refreshed, "still_unavailable": still_unavailable}


@api_router.get("/fanfic/status")
async def fanfic_status(force: bool = False, user: User = Depends(get_current_user)):
    """Probe the fanfic source (AO3) with a known-good URL. Cached for 5 minutes.

    Returns {ok: bool, detail: str, checked_at: iso, cached: bool}.
    """
    now = datetime.now(timezone.utc)
    cached_at = _fanfic_status_cache.get("checked_at")
    if (
        not force
        and cached_at
        and (now - cached_at) < timedelta(minutes=5)
        and _fanfic_status_cache.get("ok") is not None
    ):
        return {
            "ok": _fanfic_status_cache["ok"],
            "detail": _fanfic_status_cache["detail"],
            "checked_at": cached_at.isoformat(),
            "cached": True,
        }

    ok, detail = await _probe_fanfic_now()
    _fanfic_status_cache["previous_ok"] = _fanfic_status_cache.get("ok")
    _fanfic_status_cache["checked_at"] = now
    _fanfic_status_cache["ok"] = ok
    _fanfic_status_cache["detail"] = detail
    return {
        "ok": ok,
        "detail": detail,
        "checked_at": now.isoformat(),
        "cached": False,
    }


@api_router.post("/books/retry-unavailable")
async def retry_unavailable(user: User = Depends(get_current_user)):
    """Clear the unavailable flag on every previously-failed book and
    re-attempt FanFicFare for each. Sequential; respects FanFicFare's rate guidance.
    """
    books = await db.books.find(
        {"user_id": user.user_id, "unavailable": True},
        {"_id": 0},
    ).to_list(5000)

    if not books:
        return {"attempted": 0, "refreshed": 0, "still_unavailable": 0, "failures": []}

    # Clear flags up front so a partial failure doesn't strand books in a half-state.
    await db.books.update_many(
        {"user_id": user.user_id, "unavailable": True},
        {"$unset": {"unavailable": "", "last_fetch_error": ""}},
    )

    refreshed = 0
    still_unavailable = 0
    failures: List[Dict[str, str]] = []
    for b in books:
        src = b.get("source_url")
        if not src:
            # No URL → can't retry.
            failures.append({
                "book_id": b["book_id"],
                "title": b.get("title", ""),
                "error": "No source URL — set one on the book detail page first.",
            })
            continue
        try:
            await apply_refresh(b, user.user_id, src)
            refreshed += 1
        except FanficNotFoundError as e:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {
                    "unavailable": True,
                    "last_fetch_error": str(e),
                    "last_fetch_attempt_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            still_unavailable += 1
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        except HTTPException as he:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": he.detail})
        except Exception as e:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        await asyncio.sleep(1.5)

    return {
        "attempted": len(books),
        "refreshed": refreshed,
        "still_unavailable": still_unavailable,
        "failures": failures,
    }


class MarkBody(BaseModel):
    read: bool


@api_router.post("/books/{book_id}/mark")
async def mark_book(book_id: str, body: MarkBody, user: User = Depends(get_current_user)):
    """Mark a book as fully read or unread (sets progress to 100% / 0%)."""
    update: Dict[str, Any] = {
        "progress_percent": 1.0 if body.read else 0.0,
    }
    if body.read:
        update["last_opened_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "read": body.read}


async def _log_activity(user_id: str, book_id: str, minutes: float = 0.0):
    """Append today's reading activity for streak calculations.

    `minutes` adds to:
      - the day's total accumulated reading time (for streak/digest aggregates)
      - the day's per-book accumulator (for per-book sparklines)

    Pass 0 for plain "opened" events (progress updates, touch) so we don't
    double-count time but still register the day as active.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    update: Dict[str, Any] = {
        "$addToSet": {"book_ids": book_id},
        "$set": {"last_ts": datetime.now(timezone.utc).isoformat()},
    }
    if minutes and minutes > 0:
        update["$inc"] = {
            "minutes": float(minutes),
            # Per-book accumulator (book_id is safe — alphanumeric + underscore)
            f"book_minutes.{book_id}": float(minutes),
        }
    await db.reading_activity.update_one(
        {"user_id": user_id, "date": today},
        update,
        upsert=True,
    )


class HeartbeatBody(BaseModel):
    seconds: float = Field(..., ge=0, le=600)  # cap at 10 min per ping (sanity)


@api_router.post("/books/{book_id}/heartbeat")
async def reading_heartbeat(
    book_id: str,
    body: HeartbeatBody,
    user: User = Depends(get_current_user),
):
    """Record reading time for the Reader page. Frontend sends one ping per
    minute (with `seconds`=60) while the tab is focused and the user is active.
    Server caps each ping at 10 min to defend against clock-skew / replay."""
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id}, {"_id": 0, "book_id": 1}
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    minutes = float(body.seconds) / 60.0
    await _log_activity(user.user_id, book_id, minutes=minutes)
    # Mirror onto the book itself for per-book stats
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$inc": {"reading_minutes": minutes}},
    )
    return {"ok": True, "minutes_added": minutes}


class ProgressBody(BaseModel):
    percent: float
    cfi: Optional[str] = None


@api_router.post("/books/{book_id}/progress")
async def update_progress(book_id: str, body: ProgressBody, user: User = Depends(get_current_user)):
    """Persist reading progress (0.0-1.0) and last CFI for this book."""
    pct = max(0.0, min(1.0, float(body.percent)))
    update: Dict[str, Any] = {
        "progress_percent": pct,
        "last_opened_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.cfi:
        update["progress_cfi"] = body.cfi
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True, "percent": pct}


@api_router.post("/books/{book_id}/touch")
async def touch_book(book_id: str, user: User = Depends(get_current_user)):
    """Mark the book as opened just now (used for the Continue Reading rail)."""
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"last_opened_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await _log_activity(user.user_id, book_id)
    return {"ok": True}


@api_router.post("/books/{book_id}/refresh")
async def refresh_book(book_id: str, user: User = Depends(get_current_user)):
    """Re-download the latest version of this book from its FanFicFare-supported source."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    user_dir = STORAGE_DIR / user.user_id
    epub_path = user_dir / f"{book_id}.epub"
    if not epub_path.exists():
        raise HTTPException(status_code=404, detail="File missing")

    source_url = book.get("source_url")
    if not source_url:
        source_url = find_source_url(extract_urls_from_epub(epub_path))
    if not source_url:
        raise HTTPException(
            status_code=400,
            detail="No supported fanfic URL found inside this EPUB (need AO3, FFnet, Royal Road, etc.)",
        )

    try:
        updated = await apply_refresh(book, user.user_id, source_url)
    except FanficNotFoundError as e:
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$set": {
                "unavailable": True,
                "last_fetch_error": str(e),
                "last_fetch_attempt_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=404, detail=str(e))
    # Clear unavailable flag on the (now-old) book
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"unavailable": False, "last_fetch_error": None}},
    )
    return {
        "ok": True,
        "source_url": source_url,
        "title": updated["title"],
        "last_refreshed_at": updated["last_refreshed_at"],
        "new_book_id": updated.get("new_book_id"),
        "old_book_id": updated.get("old_book_id"),
        "updated_shelf": updated.get("updated_shelf"),
        "message": f"Created a refreshed copy in '{updated.get('updated_shelf')}'; the original moved to Old stories.",
    }


@api_router.get("/books/{book_id}/diff")
async def book_diff(
    book_id: str,
    vs: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Per-chapter diff between two versions of a book.

    If `vs` is omitted, auto-resolves the counterpart via the book's
    `replaces` (current is "Updated stories") or `replaced_by` (current is
    "Old stories") link.

    Returns: old + new metadata, chapter lists, and a structured diff payload.
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    counterpart_id = vs
    if not counterpart_id:
        counterpart_id = book.get("replaces") or book.get("replaced_by")
    if not counterpart_id:
        raise HTTPException(
            status_code=400,
            detail="No counterpart version found. Refresh this book first to create a version history, or pass ?vs={other_book_id}.",
        )

    other = await db.books.find_one(
        {"book_id": counterpart_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not other:
        raise HTTPException(status_code=404, detail="Counterpart book not found")

    # Order them: old version first, new version second
    if book.get("replaced_by") == counterpart_id:
        old_doc, new_doc = book, other
    elif book.get("replaces") == counterpart_id:
        old_doc, new_doc = other, book
    else:
        # Explicit vs= without a link — use timestamps to order
        old_doc, new_doc = book, other
        if (other.get("created_at") or "") < (book.get("created_at") or ""):
            old_doc, new_doc = other, book

    user_dir = STORAGE_DIR / user.user_id
    old_path = user_dir / f"{old_doc['book_id']}.epub"
    new_path = user_dir / f"{new_doc['book_id']}.epub"
    if not old_path.exists() or not new_path.exists():
        raise HTTPException(status_code=404, detail="One or both EPUB files are missing on disk")

    loop = asyncio.get_event_loop()
    old_chapters = await loop.run_in_executor(None, extract_chapters, old_path)
    new_chapters = await loop.run_in_executor(None, extract_chapters, new_path)
    diff = diff_chapters(old_chapters, new_chapters)

    def _doc_summary(d: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "book_id": d["book_id"],
            "title": d.get("title", ""),
            "author": d.get("author", ""),
            "category": d.get("category", ""),
            "created_at": d.get("created_at"),
            "last_refreshed_at": d.get("last_refreshed_at"),
            "replaced_at": d.get("replaced_at"),
        }

    return {
        "old": {**_doc_summary(old_doc), "chapters": old_chapters},
        "new": {**_doc_summary(new_doc), "chapters": new_chapters},
        "diff": diff,
    }




class BulkIdsBody(BaseModel):
    book_ids: List[str]


class BulkMoveBody(BaseModel):
    book_ids: List[str]
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/bulk/delete")
async def bulk_delete(body: BulkIdsBody, user: User = Depends(get_current_user)):
    """Bulk soft-delete — books move to Trash with a 30-day grace window so
    accidental "select all → delete" mishaps are reversible. Use
    `/api/trash/empty` if you want immediate hard deletion afterwards.
    """
    if not body.book_ids:
        return {"deleted": 0}
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    expires_at = (now_dt + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
    # Record each book's prior category so it can be restored from Trash
    cursor = db.books.find(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
        {"_id": 0, "book_id": 1, "category": 1},
    )
    moved = 0
    async for b in cursor:
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": b.get("category"),
                        "applied_at": now_iso,
                    },
                },
            },
        )
        moved += 1
    return {"deleted": moved, "trashed": moved, "trash_expires_at": expires_at}


class ResetStateBody(BaseModel):
    reset_progress: bool = False  # progress_percent, last_opened_at, reading_minutes, reading_activity
    reset_tags: bool = False       # clear book.tags
    reset_smart_shelves: bool = False  # drop user's smart_shelves
    reset_versions: bool = False   # collapse "Old stories"/"Updated stories YYYY-MM-DD" back into a single category


@api_router.post("/books/reset-state")
async def reset_state(body: ResetStateBody, user: User = Depends(get_current_user)):
    """Selectively wipe non-book metadata while keeping every EPUB intact.

    Each flag is independent — pass `true` only on the dimensions you want to clear.
    All books and their files stay on disk; only DB metadata is touched.
    """
    if not any([body.reset_progress, body.reset_tags, body.reset_smart_shelves, body.reset_versions]):
        raise HTTPException(status_code=400, detail="Pick at least one thing to reset.")

    summary: Dict[str, int] = {}

    if body.reset_progress:
        r = await db.books.update_many(
            {"user_id": user.user_id},
            {"$unset": {
                "progress_percent": "",
                "last_opened_at": "",
                "reading_minutes": "",
                "manually_uploaded_at": "",
            }},
        )
        ra = await db.reading_activity.delete_many({"user_id": user.user_id})
        summary["books_progress_cleared"] = r.modified_count
        summary["activity_rows_deleted"] = ra.deleted_count

    if body.reset_tags:
        r = await db.books.update_many(
            {"user_id": user.user_id},
            {"$set": {"tags": []}},
        )
        summary["books_tags_cleared"] = r.modified_count

    if body.reset_smart_shelves:
        ss = await db.smart_shelves.delete_many({"user_id": user.user_id})
        summary["smart_shelves_deleted"] = ss.deleted_count

    if body.reset_versions:
        # Collapse old/updated shelves back to their best-guess category.
        # If a book has a fandom we send it to "Fanfiction", else to "Unclassified".
        cursor = db.books.find(
            {
                "user_id": user.user_id,
                "$or": [
                    {"category": OLD_STORIES_SHELF},
                    {"category": {"$regex": r"^Updated stories \d{4}-\d{2}-\d{2}$"}},
                ],
            },
            {"_id": 0, "book_id": 1, "fandom": 1},
        )
        count = 0
        async for b in cursor:
            target = "Fanfiction" if b.get("fandom") else "Unclassified"
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {
                    "$set": {"category": target},
                    "$unset": {"replaced_by": "", "replaces": "", "replaced_at": "", "refresh_summary": "", "update_seen": "", "manually_uploaded_at": ""},
                },
            )
            count += 1
        # And remove any auto-created dated-shelf entries in `categories`
        await db.categories.delete_many({
            "user_id": user.user_id,
            "auto_created": True,
            "name": {"$regex": r"^Updated stories \d{4}-\d{2}-\d{2}$"},
        })
        summary["versions_collapsed"] = count

    return {"ok": True, **summary}


class WipeLibraryBody(BaseModel):
    confirm: str  # must equal "DELETE_EVERYTHING"


@api_router.post("/books/wipe-library")
async def wipe_library(body: WipeLibraryBody, user: User = Depends(get_current_user)):
    """Delete every book the user owns — DB rows, EPUBs, covers, link sidecars.
    Requires `confirm == "DELETE_EVERYTHING"` so an accidental POST won't nuke a library.

    Note: also clears reading_activity, smart_shelves, and the templated-onboarding
    flag so the user effectively starts fresh.
    """
    if body.confirm != "DELETE_EVERYTHING":
        raise HTTPException(
            status_code=400,
            detail='Confirmation required. Pass {"confirm": "DELETE_EVERYTHING"} to proceed.',
        )

    # Drop every on-disk file under the user's storage dir
    user_dir = STORAGE_DIR / user.user_id
    files_removed = 0
    if user_dir.exists():
        for p in user_dir.iterdir():
            try:
                if p.is_file():
                    p.unlink()
                    files_removed += 1
            except Exception as e:
                logger.warning("wipe_library couldn't delete %s: %s", p, e)

    # Drop collections scoped to this user
    deletes = {
        "books": (await db.books.delete_many({"user_id": user.user_id})).deleted_count,
        "reading_activity": (await db.reading_activity.delete_many({"user_id": user.user_id})).deleted_count,
        "smart_shelves": (await db.smart_shelves.delete_many({"user_id": user.user_id})).deleted_count,
        "categories": (await db.categories.delete_many({"user_id": user.user_id})).deleted_count,
    }
    # Reset onboarding so the user-prompt can show again on fresh re-upload
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$unset": {
            "template_prompt_dismissed": "",
            "template_prompt_accepted": "",
            "template_prompt_dismissed_at": "",
        }},
    )

    return {
        "ok": True,
        "files_removed": files_removed,
        **deletes,
        "message": f"Library wiped: {deletes['books']} books and {files_removed} files removed.",
    }




@api_router.post("/books/bulk/move")
async def bulk_move(body: BulkMoveBody, user: User = Depends(get_current_user)):
    if not body.book_ids:
        return {"updated": 0}
    update: Dict[str, Any] = {"classifier": "manual", "confidence": 1.0}
    if body.category is not None:
        update["category"] = body.category
    if body.fandom is not None:
        update["fandom"] = body.fandom if body.fandom else None
    if len(update) == 2:  # only classifier+confidence — nothing to move to
        raise HTTPException(status_code=400, detail="No category or fandom provided")
    result = await db.books.update_many(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
        {"$set": update},
    )
    return {"updated": result.modified_count}


class BulkMetadataBody(BaseModel):
    book_ids: List[str]
    author: Optional[str] = None      # if provided & non-empty, sets author on all
    fandom: Optional[str] = None      # "" => clear fandom (None); None => leave as-is
    category: Optional[str] = None    # category to set on all
    series_name: Optional[str] = None # "" => clear series; None => leave as-is
    series_start_index: Optional[float] = None  # if set, assigns series_index sequentially starting at this value
    title_prefix_strip: Optional[str] = None    # if provided & non-empty, strips this prefix from each book's title
    add_tags: Optional[List[str]] = None         # tags to ADD to every selected book
    remove_tags: Optional[List[str]] = None      # tags to REMOVE from every selected book


@api_router.post("/books/bulk/metadata")
async def bulk_metadata(body: BulkMetadataBody, user: User = Depends(get_current_user)):
    """Edit metadata across many books at once.

    Use cases: fix a misspelled author across a series, drop everything into a
    new fandom shelf, group books into a series and number them in upload order,
    or strip a common prefix from titles (e.g. "[OLD] ").
    """
    if not body.book_ids:
        return {"updated": 0}

    # Fields that apply identically to every selected book
    set_common: Dict[str, Any] = {}
    unset_common: Dict[str, Any] = {}
    if body.author and body.author.strip():
        set_common["author"] = body.author.strip()
    if body.category is not None:
        set_common["category"] = body.category
        set_common["classifier"] = "manual"
        set_common["confidence"] = 1.0
    if body.fandom is not None:
        if body.fandom.strip():
            set_common["fandom"] = body.fandom.strip()
        else:
            unset_common["fandom"] = ""
    if body.series_name is not None and body.series_start_index is None:
        if body.series_name.strip():
            set_common["series_name"] = body.series_name.strip()
        else:
            unset_common["series_name"] = ""
            unset_common["series_index"] = ""

    updated = 0

    if set_common or unset_common:
        ops: Dict[str, Any] = {}
        if set_common:
            ops["$set"] = set_common
        if unset_common:
            ops["$unset"] = unset_common
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            ops,
        )
        updated = max(updated, result.modified_count)

    # Series numbering: assign sequentially in the order book_ids was provided
    if body.series_name is not None and body.series_start_index is not None and body.series_name.strip():
        idx = float(body.series_start_index)
        for bid in body.book_ids:
            await db.books.update_one(
                {"book_id": bid, "user_id": user.user_id},
                {"$set": {"series_name": body.series_name.strip(), "series_index": idx}},
            )
            idx += 1
        updated = max(updated, len(body.book_ids))

    # Title prefix strip (per-book, since each title is different)
    if body.title_prefix_strip and body.title_prefix_strip.strip():
        prefix = body.title_prefix_strip
        books = await db.books.find(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"_id": 0, "book_id": 1, "title": 1},
        ).to_list(5000)
        for b in books:
            t = b.get("title") or ""
            if t.startswith(prefix):
                new_t = t[len(prefix):].lstrip()
                if new_t and new_t != t:
                    await db.books.update_one(
                        {"book_id": b["book_id"], "user_id": user.user_id},
                        {"$set": {"title": new_t}},
                    )
                    updated += 1

    # Bulk tag add/remove
    add = _normalize_tags(body.add_tags or [])
    rm = _normalize_tags(body.remove_tags or [])
    if add:
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$addToSet": {"tags": {"$each": add}}},
        )
        updated = max(updated, result.modified_count)
    if rm:
        result = await db.books.update_many(
            {"book_id": {"$in": body.book_ids}, "user_id": user.user_id},
            {"$pull": {"tags": {"$in": rm}}},
        )
        updated = max(updated, result.modified_count)

    return {"updated": updated}


# ============================================================
# TAGS ROUTES
# ============================================================
@api_router.get("/tags")
async def list_tags(user: User = Depends(get_current_user)):
    """Distinct tags across the user's library with counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "tags": {"$exists": True, "$ne": []}}},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    return {
        "tags": [
            {"name": r["_id"], "count": r["count"]}
            for r in rows if r.get("_id")
        ]
    }


class TagAddBody(BaseModel):
    tags: List[str]


@api_router.post("/books/{book_id}/tags")
async def add_book_tags(book_id: str, body: TagAddBody, user: User = Depends(get_current_user)):
    """Add one or more tags to a book (idempotent)."""
    new_tags = _normalize_tags(body.tags)
    if not new_tags:
        raise HTTPException(status_code=400, detail="No valid tags provided")
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0, "tags": 1})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    current = list(book.get("tags") or [])
    # Enforce per-book cap
    remaining = max(0, TAG_MAX_PER_BOOK - len(current))
    if remaining == 0:
        raise HTTPException(status_code=400, detail=f"This book already has the maximum of {TAG_MAX_PER_BOOK} tags")
    to_add = [t for t in new_tags if t not in current][:remaining]
    if not to_add:
        return {"tags": current}
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$addToSet": {"tags": {"$each": to_add}}},
    )
    return {"tags": current + to_add}


@api_router.delete("/books/{book_id}/tags/{tag}")
async def remove_book_tag(book_id: str, tag: str, user: User = Depends(get_current_user)):
    tag = _normalize_tag(tag)
    if not tag:
        raise HTTPException(status_code=400, detail="Invalid tag")
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$pull": {"tags": tag}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


class TagRenameBody(BaseModel):
    new_name: str


@api_router.put("/tags/{old_name}")
async def rename_tag(old_name: str, body: TagRenameBody, user: User = Depends(get_current_user)):
    """Rename a tag across all of the user's books."""
    old = _normalize_tag(old_name)
    new = _normalize_tag(body.new_name)
    if not old or not new:
        raise HTTPException(status_code=400, detail="Invalid tag name")
    if old == new:
        return {"updated": 0}
    # Books that have `old` but NOT yet `new` → safely swap via the positional $ operator
    r1 = await db.books.update_many(
        {
            "user_id": user.user_id,
            "$and": [{"tags": old}, {"tags": {"$nin": [new]}}],
        },
        {"$set": {"tags.$": new}},
    )
    # Books that already had BOTH `old` and `new` → just remove `old`
    r2 = await db.books.update_many(
        {"user_id": user.user_id, "tags": old},
        {"$pull": {"tags": old}},
    )
    return {"updated": (r1.modified_count or 0) + (r2.modified_count or 0)}


class TagMergeBody(BaseModel):
    sources: List[str]
    target: str


@api_router.post("/tags/merge")
async def merge_tags(body: TagMergeBody, user: User = Depends(get_current_user)):
    """Merge multiple tags into a single target tag across the user's books."""
    target = _normalize_tag(body.target)
    sources = _normalize_tags(body.sources)
    if not target or not sources:
        raise HTTPException(status_code=400, detail="Provide non-empty sources and target")
    sources = [s for s in sources if s != target]
    if not sources:
        return {"updated": 0}
    # Books that match any source: add target, then pull all sources.
    match = {"user_id": user.user_id, "tags": {"$in": sources}}
    r1 = await db.books.update_many(match, {"$addToSet": {"tags": target}})
    r2 = await db.books.update_many(match, {"$pull": {"tags": {"$in": sources}}})
    return {"updated": (r1.modified_count or 0) + (r2.modified_count or 0)}


@api_router.delete("/tags/{name}")
async def delete_tag(name: str, user: User = Depends(get_current_user)):
    """Remove a tag from every book in the user's library."""
    tag = _normalize_tag(name)
    if not tag:
        raise HTTPException(status_code=400, detail="Invalid tag")
    result = await db.books.update_many(
        {"user_id": user.user_id, "tags": tag},
        {"$pull": {"tags": tag}},
    )
    return {"updated": result.modified_count}


@api_router.post("/books/{book_id}/suggest-tags")
async def suggest_book_tags(book_id: str, user: User = Depends(get_current_user)):
    """Use the AI classifier to suggest tags for an existing book.

    Excludes tags the book already has; returns up to 5 suggestions.
    """
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    # Try to grab a sample of body text if the EPUB is still on disk
    sample_text = ""
    try:
        epub_path = STORAGE_DIR / book["user_id"] / f"{book_id}.epub"
        if epub_path.exists():
            meta = extract_epub_metadata(epub_path)
            sample_text = (meta or {}).get("sample_text", "") if isinstance(meta, dict) else ""
    except Exception as e:
        logger.warning("suggest-tags: epub read failed: %s", e)

    meta_for_ai = {
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "publisher": book.get("publisher", ""),
        "description": book.get("description", ""),
        "sample_text": sample_text,
    }
    ai = await classify_with_ai(meta_for_ai)
    suggested = _normalize_tags(ai.get("tags") or [])
    existing = set(book.get("tags") or [])
    filtered = [t for t in suggested if t not in existing][:5]
    return {
        "suggested": filtered,
        "all": suggested,
        "ai_used": bool(EMERGENT_LLM_KEY) or bool(os.environ.get("SHELFSORT_TEST_AI_RESPONSE")),
    }


# ============================================================
# AUTHOR ROUTES
# ============================================================
@api_router.get("/authors")
async def list_authors(user: User = Depends(get_current_user)):
    """Distinct authors in the user's library with book counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "author": {"$ne": None, "$exists": True}}},
        {"$group": {"_id": "$author", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    authors = [
        {"name": r["_id"], "count": r["count"]}
        for r in rows
        if r.get("_id") and r["_id"].strip() and r["_id"].strip().lower() != "unknown"
    ]
    return {"authors": authors}


@api_router.get("/authors/{name}")
async def get_author(name: str, user: User = Depends(get_current_user)):
    """All books by this author, newest first."""
    books = await db.books.find(
        {"user_id": user.user_id, "author": name},
        {"_id": 0},
    ).sort("created_at", -1).to_list(2000)
    return {"name": name, "books": books}


@api_router.patch("/books/{book_id}")
async def update_book(book_id: str, body: UpdateBookBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    update: Dict[str, Any] = {"classifier": "manual", "confidence": 1.0}
    if body.category is not None:
        update['category'] = body.category
    if body.fandom is not None:
        update['fandom'] = body.fandom if body.fandom else None
    await db.books.update_one({"book_id": book_id, "user_id": user.user_id}, {"$set": update})
    return {"ok": True}


def _safe_folder(name: str) -> str:
    name = re.sub(r'[^\w\s-]', '', name or 'Uncategorized').strip()
    name = re.sub(r'\s+', '_', name)
    return name or 'Uncategorized'


@api_router.get("/books/export/zip")
async def export_zip(
    request: Request,
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = category
    if fandom:
        query["fandom"] = fandom
    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    def iter_zip():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for b in books:
                fp = STORAGE_DIR / user.user_id / f"{b['book_id']}.epub"
                if not fp.exists():
                    continue
                cat = _safe_folder(b.get('category') or 'Uncategorized')
                fnd = b.get('fandom')
                if cat == 'Fanfiction' and fnd:
                    folder = f"Fanfiction/{_safe_folder(fnd)}"
                else:
                    folder = cat
                arcname = f"{folder}/{_templated_filename(b.get('title'), b.get('author'), b['book_id'])}"
                zf.write(str(fp), arcname=arcname)
        buf.seek(0)
        return buf

    buf = iter_zip()
    zip_name = "shelfsort_library.zip"
    if fandom:
        zip_name = f"shelfsort_{_safe_folder(fandom)}.zip"
    elif category:
        zip_name = f"shelfsort_{_safe_folder(category)}.zip"
    headers = {"Content-Disposition": f"attachment; filename={zip_name}"}
    return StreamingResponse(buf, media_type="application/zip", headers=headers)


@api_router.post("/books/detect-series-all")
async def detect_series_all(user: User = Depends(get_current_user)):
    """Re-scan every book without a series_name and try to detect one from the title."""
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "series_name": 1},
    ).to_list(5000)
    user_dir = STORAGE_DIR / user.user_id
    found = 0
    for b in books:
        if b.get("series_name"):
            continue
        # Try filesystem EPUB metadata first
        sn = None
        si = None
        fp = user_dir / f"{b['book_id']}.epub"
        if fp.exists():
            try:
                m = extract_epub_metadata(fp)
                sn = m.get("series_name")
                si = m.get("series_index")
            except Exception:
                pass
        if not sn:
            sn, si = detect_series_from_title(b.get("title") or "")
        if sn:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {"series_name": sn, "series_index": si}},
            )
            found += 1
    return {"scanned": len(books), "found": found}


class SetSourceBody(BaseModel):
    source_url: str

class SetSeriesBody(BaseModel):
    series_name: Optional[str] = None
    series_index: Optional[float] = None


@api_router.patch("/books/{book_id}/source-url")
async def set_source_url(book_id: str, body: SetSourceBody, user: User = Depends(get_current_user)):
    """Manually correct the fanfic source URL (e.g., when FanFicFare couldn't find it).
    Clears the unavailable flag so the next refresh will try the new URL."""
    new_url = (body.source_url or "").strip()
    if not new_url:
        raise HTTPException(status_code=400, detail="Source URL is empty")
    if not re.match(r"^https?://", new_url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Please paste a full http(s):// URL")
    # Validate it's a supported fanfic source
    matched = None
    for pat in FANFIC_SOURCE_PATTERNS:
        m = re.search(pat, new_url, re.IGNORECASE)
        if m:
            matched = m.group(0)
            break
    if not matched:
        raise HTTPException(
            status_code=400,
            detail="That URL isn't a supported fanfic source (AO3, FFnet, Royal Road, SpaceBattles, SufficientVelocity, FictionPress).",
        )
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "source_url": matched,
            "unavailable": False,
            "last_fetch_error": None,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "source_url": matched}


@api_router.patch("/books/{book_id}/series")
async def set_series(book_id: str, body: SetSeriesBody, user: User = Depends(get_current_user)):
    update: Dict[str, Any] = {
        "series_name": (body.series_name.strip() if body.series_name else None),
        "series_index": body.series_index,
    }
    result = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}



@api_router.post("/books/{book_id}/upload-new-version")
async def upload_new_version(
    book_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Upload a freshly-downloaded EPUB as a NEW version of the given book.

    Mirrors the refresh flow exactly:
      * new book record on a date-stamped 'Updated stories YYYY-MM-DD' shelf
      * old book archived to 'Old stories' (with replaced_by back-pointer)
      * tags / source_url / fandom / series / classifier carried over
      * refresh_summary computed for the bell badge + email digest
      * house template applied (if enabled)
      * existing "Old stories" / archived books are NOT re-versioned

    Use case: when FanFicFare can't fetch from the source (bot protection,
    Cloudflare, locked work) you grab the EPUB locally and drop it here.
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    # Block uploads onto already-archived books — pick the current copy instead
    if book.get("category") == OLD_STORIES_SHELF or book.get("replaced_by"):
        raise HTTPException(
            status_code=400,
            detail="This is already an archived copy. Open the current version and upload there.",
        )

    # Validate
    name = (file.filename or "").lower()
    if not name.endswith(".epub"):
        raise HTTPException(status_code=400, detail="Please upload an .epub file")
    raw = await file.read()
    if not raw or len(raw) < 256:
        raise HTTPException(status_code=400, detail="That file is empty or too small to be an EPUB")
    if not raw.startswith(b"PK\x03\x04"):
        raise HTTPException(status_code=400, detail="That doesn't look like a valid EPUB (zip header missing)")

    # Apply the house template (idempotent — noop if already templated)
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    old_book_id = book_id

    fff_options = (
        (await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1}) or {})
        .get("fff_options") or {}
    )
    loop = asyncio.get_event_loop()
    if fff_options.get("apply_template", True):
        meta_for_template = {
            "title": book.get("title") or "",
            "author": book.get("author") or "",
            "description": book.get("description") or "",
            "chapters": book.get("chapters") or 0,
            "rawExtendedMeta": (book.get("source_meta") or {}).get("rawExtendedMeta") or {},
        }
        raw = await loop.run_in_executor(
            None,
            apply_template_to_epub,
            raw,
            meta_for_template,
            book.get("source_url") or "",
        )

    # Allocate new book_id and persist the bytes
    new_book_id = f"book_{uuid.uuid4().hex[:12]}"
    new_epub_path = user_dir / f"{new_book_id}.epub"
    new_epub_path.write_bytes(raw)

    # Try to extract fresh metadata (chapters/words) — non-fatal
    new_meta: Dict[str, Any] = {
        "title": book.get("title") or "Untitled",
        "author": book.get("author") or "Unknown",
        "description": book.get("description") or "",
        "language": book.get("language") or "en",
        "publisher": book.get("publisher") or "",
    }
    extracted_extra: Dict[str, Any] = {}
    try:
        ex = extract_epub_metadata(new_epub_path) or {}
        if ex.get("title"):
            new_meta["title"] = ex["title"]
        if ex.get("author"):
            new_meta["author"] = ex["author"]
        if ex.get("description"):
            new_meta["description"] = ex["description"]
        if ex.get("chapters"):
            extracted_extra["chapters"] = int(ex["chapters"])
        if ex.get("words"):
            extracted_extra["words"] = int(ex["words"])
    except Exception as e:
        logger.warning("upload_new_version metadata extract failed: %s", e)

    # Re-extract embedded URLs
    try:
        new_links = extract_urls_from_epub(new_epub_path) or []
        links_path = user_dir / f"{new_book_id}.links.txt"
        links_path.write_text(
            format_links_txt(new_meta["title"], new_meta["author"], new_links),
            encoding="utf-8",
        )
        links_count = len(new_links)
    except Exception as e:
        logger.warning("upload_new_version link extract failed: %s", e)
        links_count = 0

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    updated_shelf = _updated_shelf_name(now_dt)

    # 1) Insert the new book on the dated shelf
    new_doc = {
        "book_id": new_book_id,
        "user_id": user.user_id,
        "filename": _templated_filename(new_meta["title"], new_meta["author"], new_book_id),
        "title": new_meta["title"],
        "author": new_meta["author"],
        "description": new_meta["description"],
        "language": new_meta["language"],
        "publisher": new_meta["publisher"],
        "has_cover": book.get("has_cover", False),  # cover preserved separately if needed
        "category": updated_shelf,
        "fandom": book.get("fandom"),
        "series_name": book.get("series_name"),
        "series_index": book.get("series_index"),
        "tags": book.get("tags") or [],
        "confidence": book.get("confidence", 0.0),
        "classifier": "manual_upload",
        "size_bytes": len(raw),
        "links_count": links_count,
        "source_url": book.get("source_url"),
        "last_refreshed_at": now_iso,
        "manually_uploaded_at": now_iso,
        "replaces": old_book_id,
        "created_at": now_iso,
        **extracted_extra,
    }
    await db.books.insert_one(new_doc)

    # Register the dated shelf as a custom category
    await db.categories.update_one(
        {"user_id": user.user_id, "name": updated_shelf},
        {"$setOnInsert": {
            "user_id": user.user_id,
            "name": updated_shelf,
            "created_at": now_iso,
            "auto_created": True,
        }},
        upsert=True,
    )

    # 2) Archive the old book
    await db.books.update_one(
        {"book_id": old_book_id, "user_id": user.user_id},
        {"$set": {
            "category": OLD_STORIES_SHELF,
            "replaced_by": new_book_id,
            "replaced_at": now_iso,
        }},
    )

    # 3) Compute refresh_summary for the bell badge / email digest
    refresh_summary: Optional[Dict[str, Any]] = None
    try:
        old_epub_path = user_dir / f"{old_book_id}.epub"
        if old_epub_path.exists():
            old_chapters = await loop.run_in_executor(None, extract_chapters, old_epub_path)
            new_chapters = await loop.run_in_executor(None, extract_chapters, new_epub_path)
            d = diff_chapters(old_chapters, new_chapters)
            refresh_summary = {
                "chapters_added": d["summary"]["chapters_added"],
                "chapters_changed": d["summary"]["chapters_changed"],
                "chapters_removed": d["summary"]["chapters_removed"],
                "words_delta": d["summary"]["words_delta"],
                "first_changed_href": (d.get("first_changed_chapter") or {}).get("new_href", ""),
                "first_changed_title": (d.get("first_changed_chapter") or {}).get("title", ""),
                "first_changed_kind": (d.get("first_changed_chapter") or {}).get("kind", ""),
            }
    except Exception as e:
        logger.warning("upload_new_version diff failed for %s -> %s: %s", old_book_id, new_book_id, e)

    await db.books.update_one(
        {"book_id": new_book_id, "user_id": user.user_id},
        {"$set": {"refresh_summary": refresh_summary, "update_seen": False}},
    )

    return {
        "ok": True,
        "new_book_id": new_book_id,
        "old_book_id": old_book_id,
        "title": new_meta["title"],
        "updated_shelf": updated_shelf,
        "message": f'Saved as a new version in "{updated_shelf}". The previous copy moved to Old stories.',
    }



# ----------------------------------------------------------------------
# DUPLICATE RESOLUTION
# When an upload trips dup detection (matching title / source_url / shared
# fanfic permalink), the book is saved with `duplicate_pending=true` and a
# `duplicate_of` list. The UI shows a modal that POSTs here to resolve.
# ----------------------------------------------------------------------

class ResolveDuplicateBody(BaseModel):
    action: str  # "keep" | "discard" | "new_version_of"
    target_book_id: Optional[str] = None


@api_router.post("/books/{book_id}/resolve-duplicate")
async def resolve_duplicate(
    book_id: str,
    body: ResolveDuplicateBody,
    user: User = Depends(get_current_user),
):
    """Resolve a pending-duplicate upload.

    Actions:
      * `keep`              — clear the `duplicate_pending` flag (keep both copies)
      * `discard`           — delete the just-uploaded book + its files
      * `new_version_of`    — archive `target_book_id` to "Old stories" and
                              move the new book to a dated "Updated stories"
                              shelf with a proper chapter-diff refresh_summary
      * `link_as_old_version` — archive the just-uploaded book under
                                `target_book_id` (the current head). Use this
                                when the upload is actually an older snapshot
                                of a fic you've since re-fetched.
    """
    if body.action not in ("keep", "discard", "new_version_of", "link_as_old_version"):
        raise HTTPException(status_code=400, detail="action must be one of keep/discard/new_version_of/link_as_old_version")

    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    user_dir = STORAGE_DIR / user.user_id

    if body.action == "keep":
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
        )
        return {"ok": True, "action": "keep", "book_id": book_id}

    if body.action == "discard":
        # Soft-delete: move to Trash shelf with a 30-day grace window. Files
        # stay on disk so the user can restore from /library/trash.
        now_iso = datetime.now(timezone.utc).isoformat()
        expires_at = (datetime.now(timezone.utc) + timedelta(days=TRASH_GRACE_DAYS)).isoformat()
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": TRASH_SHELF,
                    "trash_expires_at": expires_at,
                    "dupe_action_meta": {
                        "action": "discard",
                        "prev_category_new": book.get("category"),
                        "applied_at": now_iso,
                    },
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {"ok": True, "action": "discard", "book_id": book_id, "trash_expires_at": expires_at}

    # link_as_old_version + new_version_of both need a target
    if not body.target_book_id:
        raise HTTPException(status_code=400, detail="target_book_id is required")
    if body.target_book_id == book_id:
        raise HTTPException(status_code=400, detail="target_book_id cannot equal the uploaded book")

    target = await db.books.find_one({"book_id": body.target_book_id, "user_id": user.user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Target book not found")
    if target.get("category") == OLD_STORIES_SHELF or target.get("replaced_by"):
        raise HTTPException(status_code=400, detail="Target book is already archived; pick its current version instead")

    if body.action == "link_as_old_version":
        # Archive the just-uploaded book under the target (current head).
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": target["book_id"],
                    "replaced_at": now_iso,
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        return {
            "ok": True,
            "action": "link_as_old_version",
            "old_book_id": book_id,
            "head_book_id": target["book_id"],
            "message": f'Linked as a historical version of "{target.get("title") or "the current copy"}".',
        }

    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    updated_shelf = _updated_shelf_name(now_dt)

    # Carry over user-curated fields from the target onto the new book so the
    # user's tagging/shelving doesn't get lost.
    carry = {
        "fandom": book.get("fandom") or target.get("fandom"),
        "series_name": book.get("series_name") or target.get("series_name"),
        "series_index": book.get("series_index") or target.get("series_index"),
        "tags": list({*(book.get("tags") or []), *(target.get("tags") or [])}),
        "source_url": book.get("source_url") or target.get("source_url"),
    }

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {
                "category": updated_shelf,
                "replaces": target["book_id"],
                "last_refreshed_at": now_iso,
                "update_seen": False,
                **{k: v for k, v in carry.items() if v is not None},
            },
            "$unset": {"duplicate_pending": "", "duplicate_of": ""},
        },
    )

    # Register the dated shelf as a custom category
    await db.categories.update_one(
        {"user_id": user.user_id, "name": updated_shelf},
        {"$setOnInsert": {
            "user_id": user.user_id,
            "name": updated_shelf,
            "created_at": now_iso,
            "auto_created": True,
        }},
        upsert=True,
    )

    # Archive the target
    await db.books.update_one(
        {"book_id": target["book_id"], "user_id": user.user_id},
        {"$set": {
            "category": OLD_STORIES_SHELF,
            "replaced_by": book_id,
            "replaced_at": now_iso,
        }},
    )

    # Chapter diff for refresh_summary so the bell badge + Compare page work
    refresh_summary: Optional[Dict[str, Any]] = None
    try:
        loop = asyncio.get_event_loop()
        old_epub = user_dir / f"{target['book_id']}.epub"
        new_epub = user_dir / f"{book_id}.epub"
        if old_epub.exists() and new_epub.exists():
            old_chapters = await loop.run_in_executor(None, extract_chapters, old_epub)
            new_chapters = await loop.run_in_executor(None, extract_chapters, new_epub)
            d = diff_chapters(old_chapters, new_chapters)
            refresh_summary = {
                "chapters_added": d["summary"]["chapters_added"],
                "chapters_changed": d["summary"]["chapters_changed"],
                "chapters_removed": d["summary"]["chapters_removed"],
                "words_delta": d["summary"]["words_delta"],
                "first_changed_href": (d.get("first_changed_chapter") or {}).get("new_href", ""),
                "first_changed_title": (d.get("first_changed_chapter") or {}).get("title", ""),
                "first_changed_kind": (d.get("first_changed_chapter") or {}).get("kind", ""),
            }
    except Exception as e:
        logger.warning("resolve_duplicate diff failed for %s -> %s: %s", target["book_id"], book_id, e)

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"refresh_summary": refresh_summary}},
    )

    return {
        "ok": True,
        "action": "new_version_of",
        "new_book_id": book_id,
        "old_book_id": target["book_id"],
        "updated_shelf": updated_shelf,
        "message": f'Saved as a new version in "{updated_shelf}". The previous copy moved to Old stories.',
    }



# ----------------------------------------------------------------------
# FIND DUPLICATES IN LIBRARY
# Scans the user's library after-the-fact and surfaces groups of books
# that look like dupes — same title, same source URL, or shared fanfic
# permalinks. Legacy books that pre-date the `fanfic_urls` field get a
# lazy backfill from the on-disk `.links.txt` sidecar before grouping.
# ----------------------------------------------------------------------

FIND_DUPES_BACKFILL_LIMIT = 1000  # max books to backfill in a single call


def _parse_urls_from_sidecar(path: Path) -> List[str]:
    """Pull URLs out of a `<book_id>.links.txt` sidecar (one URL per line, the
    sidecar's `format_links_txt` writes each URL on its own line)."""
    if not path.exists():
        return []
    out: List[str] = []
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("http://") or line.startswith("https://"):
                out.append(line)
    except OSError:
        return []
    return out


@api_router.get("/library/duplicates/count")
async def find_duplicates_count(user: User = Depends(get_current_user)):
    """Cheap pre-flight count of likely duplicates without the expensive
    backfill step. Used by the Account-page card to nudge users when there's
    cleanup to be done. Counts groups by:
      * normalized title equality
      * exact `source_url` equality
      * shared `fanfic_urls` (only on books that already have the field; no
        sidecar backfill — that's reserved for the full scan)
    """
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": OLD_STORIES_SHELF},
            "replaced_by": {"$exists": False},
        },
        {"_id": 0, "book_id": 1, "title": 1, "source_url": 1, "fanfic_urls": 1},
    )

    by_title: Dict[str, List[int]] = {}
    by_source: Dict[str, List[int]] = {}
    by_url: Dict[str, List[int]] = {}
    books: List[Dict[str, Any]] = []
    async for b in cursor:
        i = len(books)
        books.append(b)
        nt = _normalize_title_for_match(b.get("title"))
        if nt:
            by_title.setdefault(nt, []).append(i)
        s = b.get("source_url")
        if s:
            by_source.setdefault(s, []).append(i)
        for u in (b.get("fanfic_urls") or []):
            by_url.setdefault(u, []).append(i)

    parent = list(range(len(books)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for indexes in list(by_title.values()) + list(by_source.values()) + list(by_url.values()):
        if len(indexes) < 2:
            continue
        head = indexes[0]
        for j in indexes[1:]:
            union(head, j)

    counts_by_root: Dict[int, int] = {}
    for i in range(len(books)):
        counts_by_root[find(i)] = counts_by_root.get(find(i), 0) + 1

    total_groups = sum(1 for c in counts_by_root.values() if c >= 2)
    total_dupe_books = sum(c for c in counts_by_root.values() if c >= 2)
    return {"total_groups": total_groups, "total_dupe_books": total_dupe_books}


@api_router.get("/library/duplicates")
async def find_duplicates(user: User = Depends(get_current_user)):
    """Group the user's library by potential duplicate signal.

    Returns `{groups: [...], total_groups, total_dupe_books, backfilled}`.
    Archived (`Old stories` / `replaced_by`) books are excluded.
    """
    user_dir = STORAGE_DIR / user.user_id

    # 1) Load all non-archived books for the user
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": OLD_STORIES_SHELF},
            "replaced_by": {"$exists": False},
        },
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "category": 1,
            "fandom": 1,
            "source_url": 1,
            "fanfic_urls": 1,
            "created_at": 1,
            "reading_minutes": 1,
            "progress_percent": 1,
        },
    )
    books: List[Dict[str, Any]] = []
    async for b in cursor:
        books.append(b)

    # 2) Opportunistic backfill of `fanfic_urls` for legacy books (capped)
    backfilled = 0
    for b in books:
        if "fanfic_urls" in b:
            continue
        if backfilled >= FIND_DUPES_BACKFILL_LIMIT:
            break
        urls_raw = _parse_urls_from_sidecar(user_dir / f"{b['book_id']}.links.txt")
        canonical: List[str] = []
        seen: set = set()
        for u in urls_raw:
            for pat in FANFIC_SOURCE_PATTERNS:
                m = re.search(pat, u, re.IGNORECASE)
                if m and m.group(0) not in seen:
                    seen.add(m.group(0))
                    canonical.append(m.group(0))
                    break
        b["fanfic_urls"] = canonical
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {"$set": {"fanfic_urls": canonical}},
        )
        backfilled += 1

    # 3) Build inverted indexes for fast grouping
    by_title: Dict[str, List[int]] = {}
    by_source: Dict[str, List[int]] = {}
    by_url: Dict[str, List[int]] = {}
    for i, b in enumerate(books):
        nt = _normalize_title_for_match(b.get("title"))
        if nt:
            by_title.setdefault(nt, []).append(i)
        s = b.get("source_url")
        if s:
            by_source.setdefault(s, []).append(i)
        for u in (b.get("fanfic_urls") or []):
            by_url.setdefault(u, []).append(i)

    # 4) Union-find across the three indexes
    parent = list(range(len(books)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    reasons_for_group: Dict[int, set] = {}

    def link_group(indexes: List[int], reason: str):
        if len(indexes) < 2:
            return
        head = indexes[0]
        for j in indexes[1:]:
            union(head, j)
        reasons_for_group.setdefault(find(head), set()).add(reason)

    for nt, idxs in by_title.items():
        link_group(idxs, "title")
    for src, idxs in by_source.items():
        link_group(idxs, "source_url")
    for url, idxs in by_url.items():
        link_group(idxs, "url")

    # 5) Materialise groups (only those with >1 member)
    groups_by_root: Dict[int, List[int]] = {}
    for i in range(len(books)):
        r = find(i)
        groups_by_root.setdefault(r, []).append(i)

    out_groups: List[Dict[str, Any]] = []
    for root, member_ids in groups_by_root.items():
        if len(member_ids) < 2:
            continue
        reasons = sorted(reasons_for_group.get(root, set()))
        # Stable ordering: oldest first so the "keeper" defaults to the
        # original copy.
        member_books = [books[i] for i in member_ids]
        member_books.sort(key=lambda b: b.get("created_at") or "")
        out_groups.append({
            "match_reasons": reasons,
            "books": [
                {
                    "book_id": b["book_id"],
                    "title": b.get("title") or "",
                    "author": b.get("author") or "",
                    "category": b.get("category") or "",
                    "fandom": b.get("fandom") or "",
                    "created_at": b.get("created_at") or "",
                    "reading_minutes": int(b.get("reading_minutes") or 0),
                    "progress_percent": float(b.get("progress_percent") or 0.0),
                }
                for b in member_books
            ],
        })

    # Largest groups first so the worst offenders are visible
    out_groups.sort(key=lambda g: len(g["books"]), reverse=True)

    return {
        "groups": out_groups,
        "total_groups": len(out_groups),
        "total_dupe_books": sum(len(g["books"]) for g in out_groups),
        "backfilled": backfilled,
    }


class GroupDecision(BaseModel):
    book_id: str
    action: str  # "keep" | "discard" | "archive"


class ResolveGroupBody(BaseModel):
    keeper_id: str
    decisions: List[GroupDecision]


@api_router.post("/books/resolve-group")
async def resolve_group(body: ResolveGroupBody, user: User = Depends(get_current_user)):
    """Resolve a single duplicate group.

    The caller picks a `keeper_id` (the book that should stay current) and a
    per-book action for every other book in the group:
      * `keep`      — leave it alone (sit alongside the keeper)
      * `discard`   — delete the book + its on-disk files
      * `archive`   — move it to "Old stories" with `replaced_by = keeper_id`
                      so the keeper becomes its current version

    The keeper itself is implicitly kept and must appear in `decisions` as
    `keep` (or be omitted — we ignore any decision referring to the keeper).
    """
    keeper = await db.books.find_one({"book_id": body.keeper_id, "user_id": user.user_id})
    if not keeper:
        raise HTTPException(status_code=404, detail="Keeper book not found")
    if keeper.get("category") == OLD_STORIES_SHELF or keeper.get("replaced_by"):
        raise HTTPException(status_code=400, detail="Keeper is already archived; pick a current copy instead")

    user_dir = STORAGE_DIR / user.user_id
    now_iso = datetime.now(timezone.utc).isoformat()

    summary = {"kept": 1, "discarded": 0, "archived": 0, "skipped": 0}

    for d in body.decisions:
        if d.book_id == body.keeper_id:
            continue
        if d.action not in ("keep", "discard", "archive"):
            raise HTTPException(status_code=400, detail=f"Unknown action '{d.action}' for {d.book_id}")

        b = await db.books.find_one({"book_id": d.book_id, "user_id": user.user_id})
        if not b:
            summary["skipped"] += 1
            continue

        if d.action == "keep":
            summary["kept"] += 1
            continue

        if d.action == "discard":
            for ext in (".epub", ".cover", ".links.txt"):
                p = user_dir / f"{d.book_id}{ext}"
                if p.exists():
                    try:
                        p.unlink()
                    except OSError:
                        pass
            await db.books.delete_one({"book_id": d.book_id, "user_id": user.user_id})
            summary["discarded"] += 1
            continue

        # archive
        await db.books.update_one(
            {"book_id": d.book_id, "user_id": user.user_id},
            {
                "$set": {
                    "category": OLD_STORIES_SHELF,
                    "replaced_by": body.keeper_id,
                    "replaced_at": now_iso,
                },
                "$unset": {"duplicate_pending": "", "duplicate_of": ""},
            },
        )
        summary["archived"] += 1

    # Clear any lingering duplicate_pending flag on the keeper
    await db.books.update_one(
        {"book_id": body.keeper_id, "user_id": user.user_id},
        {"$unset": {"duplicate_pending": "", "duplicate_of": ""}},
    )

    return {"ok": True, **summary}



# ----------------------------------------------------------------------
# TRASH SHELF — 30-day grace window before hard deletion
# ----------------------------------------------------------------------

@api_router.get("/trash")
async def list_trash(user: User = Depends(get_current_user)):
    """List every book currently sitting in Trash for the user."""
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "trash_expires_at": 1, "dupe_action_meta": 1},
    ).sort("trash_expires_at", 1)
    books = [b async for b in cursor]
    return {"books": books, "count": len(books), "grace_days": TRASH_GRACE_DAYS}


@api_router.post("/trash/restore/{book_id}")
async def restore_from_trash(book_id: str, user: User = Depends(get_current_user)):
    """Restore a book from Trash to its previous category."""
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.get("category") != TRASH_SHELF:
        raise HTTPException(status_code=400, detail="Book is not in Trash")
    prev_cat = (book.get("dupe_action_meta") or {}).get("prev_category_new") or "Unclassified"
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {
            "$set": {"category": prev_cat},
            "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
        },
    )
    return {"ok": True, "book_id": book_id, "restored_to": prev_cat}


@api_router.post("/trash/restore-all")
async def restore_all_trash(user: User = Depends(get_current_user)):
    """Restore every book in the user's Trash to its previous category."""
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {"_id": 0, "book_id": 1, "dupe_action_meta": 1},
    )
    restored = 0
    async for b in cursor:
        prev_cat = (b.get("dupe_action_meta") or {}).get("prev_category_new") or "Unclassified"
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user.user_id},
            {
                "$set": {"category": prev_cat},
                "$unset": {"trash_expires_at": "", "dupe_action_meta": ""},
            },
        )
        restored += 1
    return {"restored": restored}


@api_router.post("/trash/empty")
async def empty_trash(user: User = Depends(get_current_user)):
    """Hard-delete every book currently in Trash for the user."""
    user_dir = STORAGE_DIR / user.user_id
    cursor = db.books.find(
        {"user_id": user.user_id, "category": TRASH_SHELF},
        {"_id": 0, "book_id": 1},
    )
    book_ids = [b["book_id"] async for b in cursor]
    for bid in book_ids:
        for ext in (".epub", ".cover", ".links.txt"):
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass
    result = await db.books.delete_many(
        {"user_id": user.user_id, "category": TRASH_SHELF},
    )
    return {"deleted": result.deleted_count}


async def sweep_expired_trash() -> int:
    """Background sweep — hard-delete books whose Trash grace window expired.

    Returns the total number of books removed. Walks every user's storage dir
    to also drop the EPUB/cover/links sidecar.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.books.find(
        {"category": TRASH_SHELF, "trash_expires_at": {"$lt": now_iso}},
        {"_id": 0, "book_id": 1, "user_id": 1},
    )
    to_delete = [b async for b in cursor]
    removed = 0
    for b in to_delete:
        uid = b.get("user_id")
        bid = b.get("book_id")
        if not uid or not bid:
            continue
        user_dir = STORAGE_DIR / uid
        for ext in (".epub", ".cover", ".links.txt"):
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass
        res = await db.books.delete_one({"book_id": bid, "user_id": uid})
        removed += res.deleted_count
    return removed

