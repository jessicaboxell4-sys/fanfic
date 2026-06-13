from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form, Query,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from starlette.background import BackgroundTask
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
from auth_dep import get_current_user, require_admin
from utils.admin_audit import record_admin_action


from emergentintegrations.llm.chat import LlmChat, UserMessage


# Heuristic fandom detection. Keys are the canonical shelf name (AO3-style
# canonicals where reasonable — see https://archiveofourown.org/wrangling for
# AO3's fandom-tag convention. When adding NEW fandoms, prefer AO3's exact
# canonical form, e.g. `Stargate SG-1`, `Stargate Atlantis`, `Stargate
# (Movies)` rather than colloquial short names. The umbrella term
# `Stargate - All Media Types` is intentionally NOT used as a default — we
# bucket into the specific sub-fandom so the user can find SG-1 vs Atlantis
# works at a glance, with a cross-listing shelf already auto-built when a
# work spans multiple sub-fandoms.
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
    # ── Stargate franchise ────────────────────────────────────────────
    # AO3 canonical names. SG-1 keywords are intentionally narrow (cast
    # of SG-1, Goa'uld, Cheyenne Mountain) so they don't fire on Atlantis
    # works, and vice-versa. The bare word "stargate" alone is NOT in any
    # list — it would trip every sub-fandom — so the AI classifier
    # decides ambiguous works.
    "Stargate SG-1": [
        "stargate sg-1", "stargate sg1", "sg-1 team",
        "jack o'neill", "jack oneill", "daniel jackson",
        "samantha carter", "sam carter", "teal'c", "teal c",
        "general hammond", "cheyenne mountain", "goa'uld", "goauld",
        "asgard", "tok'ra", "tokra", "stargate program", "stargate command",
        "sgc",
    ],
    "Stargate Atlantis": [
        "stargate atlantis", "sga ",  # trailing space to avoid SGU matches
        "atlantis expedition", "john sheppard", "rodney mckay",
        "mckay/sheppard", "mcshep", "teyla emmagan", "ronon dex",
        "elizabeth weir", "carson beckett", "pegasus galaxy", "wraith",
        "puddle jumper", "ancients", "lantean",
    ],
    "Stargate Universe": [
        "stargate universe", "sgu ", "stargate sgu",
        "everett young", "nicholas rush", "eli wallace", "chloe armstrong",
        "matthew scott", "ronald greer", "icarus base", "destiny ship",
        "the destiny",
    ],
    "Stargate (Movies)": [
        "stargate movie", "stargate (movies)", "stargate 1994",
        "stargate film", "ra abydos", "abydonian",
    ],
}


# Merge in the bundled AO3 top-fandoms seed (~100 popular fandoms across
# all media types) without overriding any hand-tuned entries above. The
# bundled file uses AO3-canonical names — the existing 16 short-name
# fandoms above stay because they're the canonical form for THIS user's
# library and renaming them would migrate every existing book's shelf.
try:
    from data.ao3_top_fandoms import AO3_TOP_FANDOMS  # noqa: WPS433
    for _canon, _kws in AO3_TOP_FANDOMS.items():
        FANDOM_KEYWORDS.setdefault(_canon, _kws)
    del _canon, _kws  # housekeeping
except Exception as _e:  # pragma: no cover — bundled file is always present
    logger.warning("Could not load AO3 top-fandoms seed: %s", _e)

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

    # --- Relationships / pairings ---------------------------------------
    # AO3 export EPUBs put each relationship tag in its own <dc:subject>
    # element (alongside fandom + freeform tags). We pick up everything that
    # looks like a pairing — i.e. contains "/" or " & " — and canonicalize.
    # FFnet/SpaceBattles tend to embed pairings in the description instead
    # ("Pairings: Harry/Hermione, Ron/Lavender") so we also scan there.
    relationships: List[str] = []
    seen_rel: set = set()

    def _add_rel(raw: str) -> None:
        canonical = _canonicalize_relationship(raw)
        if canonical and canonical not in seen_rel:
            seen_rel.add(canonical)
            relationships.append(canonical)

    try:
        for value, _attrs in (book.get_metadata('DC', 'subject') or []):
            if not value:
                continue
            s = value.strip()
            # Only treat the subject tag as a relationship if it looks like one
            if '/' in s or ' & ' in s:
                _add_rel(s)
    except Exception:
        pass

    # Fallback: parse "Pairings:" / "Relationship(s):" lines from the description
    if description:
        for m in re.finditer(
            r'(?:pairing|relationship)s?\s*[:\-—]\s*([^\n\r.;]+)',
            description,
            re.IGNORECASE,
        ):
            for piece in re.split(r',|;', m.group(1)):
                piece = piece.strip()
                if piece and ('/' in piece or ' & ' in piece):
                    _add_rel(piece)


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
        "author": _clean_author_string(creator),
        "description": description[:2000],
        "language": language,
        "publisher": publisher,
        "cover_bytes": cover_bytes,
        "sample_text": sample_text[:5000],
        "series_name": series_name,
        "series_index": series_index,
        "relationships": relationships,
        "parse_failed": False,
    }


# ---------------------------------------------------------------------------
# Relationship canonicalization
# ---------------------------------------------------------------------------
# Fanfic readers expect "Harry Potter/Hermione Granger" and
# "Hermione Granger/Harry Potter" to live on the same shelf. We canonicalize
# by:
#   1. splitting on the AO3 separator "/" (romantic) or " & " (platonic);
#      "/" wins when both appear so romantic > platonic for grouping.
#   2. stripping whitespace, fandom suffixes ("(Harry Potter)"), and any
#      trailing notes ("Harry/Draco - mentioned").
#   3. sorting the participants alphabetically with a stable lowercase key.
#   4. re-joining with " / " (single space, classic fandom convention).
# Three-or-more-way pairings are preserved as-is, just sorted.

def _canonicalize_relationship(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    # Drop trailing "(Fandom Name)" — common AO3 ambiguity disambiguator
    s = re.sub(r'\s*\([^)]+\)\s*$', '', s).strip()
    # Strip "- mentioned" / "- past" / etc.
    s = re.sub(r'\s*[-—]\s*(?:past|former|implied|mentioned|background|brief|one-sided|unrequited).*$', '', s, flags=re.IGNORECASE).strip()
    # Determine separator: prefer "/" (romantic) if present, else " & "
    if '/' in s:
        sep = '/'
    elif ' & ' in s:
        sep = ' & '
    else:
        # Single name — not a pairing
        return None
    parts = [p.strip() for p in s.split(sep) if p.strip()]
    if len(parts) < 2:
        return None
    # Reject if any part is suspiciously short (typo guard) or numeric-only
    if any(len(p) < 2 or p.isdigit() for p in parts):
        return None
    parts.sort(key=lambda p: p.lower())
    return " / ".join(parts)


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


# ---------------------------------------------------------------------------
# Crossover fandoms: multi-fandom works (Harry Potter & Twilight,
# Twilight/Lord of the Rings, etc.) should file together regardless of the
# order/separator the EPUB happened to use. Canonical form: alphabetically
# sorted, joined with " / ", so "Twilight & Harry Potter" and
# "Harry Potter/Twilight" both become "Harry Potter / Twilight".
# ---------------------------------------------------------------------------
# Common multi-fandom separators in EPUB metadata.
_FANDOM_SPLIT_RE = re.compile(r'\s*(?:/|&|\+|,|\s+(?:x|×|and)\s+)\s*', re.IGNORECASE)


def _canonicalize_fandom(raw: Optional[str], aliases: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Normalize a fandom string. Crossovers collapse to a single canonical
    'A / B / C' form (alphabetical). Single-fandom strings are returned
    unchanged. Returns None for empty/whitespace input.

    If `aliases` (case-insensitive mapping of raw_part -> canonical_part) is
    supplied, each part of a crossover is rewritten before sorting.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    parts = [p.strip() for p in _FANDOM_SPLIT_RE.split(s) if p and p.strip()]
    if aliases:
        # Lowercase-keyed lookup; preserve mapped value's case as authored.
        aliases_lc = {k.strip().lower(): v.strip() for k, v in aliases.items() if k and v}
        parts = [aliases_lc.get(p.lower(), p) for p in parts]
    if len(parts) <= 1:
        return parts[0] if parts else s
    seen: Dict[str, str] = {}
    for p in parts:
        key = p.lower()
        if key not in seen:
            seen[key] = p
    canonical = sorted(seen.values(), key=lambda x: x.lower())
    return " / ".join(canonical)


def _suggest_fandom_merges(new_fandom: str, existing: List[str], max_distance: int = 2) -> List[str]:
    """Return existing fandoms that look like a typo of `new_fandom`.

    Uses Levenshtein on lowercased strings. Skips exact matches and very
    short names (where 1-edit distance is meaningless). Each part of a
    crossover is compared independently — handy when the user mistypes one
    fandom in an otherwise-known crossover.
    """
    from difflib import SequenceMatcher
    nf = (new_fandom or "").strip().lower()
    if not nf:
        return []
    candidates: List[str] = []
    # Compare each part of a crossover, plus the whole string for single-fandom case.
    nf_parts = [p.strip().lower() for p in nf.split(" / ") if p.strip()]
    nf_pool = set(nf_parts) | {nf}

    def _edit_dist(a: str, b: str) -> int:
        # Compact dp Levenshtein.
        if a == b:
            return 0
        if len(a) < len(b):
            a, b = b, a
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i] + [0] * len(b)
            for j, cb in enumerate(b, 1):
                cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb))
            prev = cur
        return prev[-1]

    for ex in existing:
        if not ex or ex.lower() == nf:
            continue
        ex_parts = [p.strip() for p in ex.split(" / ") if p.strip()]
        ex_pool = {ex.lower()} | {p.lower() for p in ex_parts}
        # If any part is close to any new part — flag it.
        close = False
        for a in nf_pool:
            if len(a) < 4:
                continue
            for b in ex_pool:
                if len(b) < 4 or a == b:
                    continue
                # Quick reject if length difference > max_distance
                if abs(len(a) - len(b)) > max_distance:
                    continue
                if _edit_dist(a, b) <= max_distance:
                    close = True
                    break
            if close:
                break
        if close:
            candidates.append(ex)
        if len(candidates) >= 3:
            break
    return candidates





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


from utils.url_canonical import (  # noqa: E402  — top-of-module helpers
    URL_REGEX,
    _clean_url,
)


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
# URL canonicalization, source detection, and the per-host regex bank
# all live in `utils/url_canonical` — this module just re-exports them
# so existing call sites (and tests) keep working unchanged.
from utils.url_canonical import (  # noqa: E402
    _AO3_HOST_RE,
    _AO3_HOST_SUBSTRINGS,
    _AO3_NON_WORK_PATTERNS,
    _AO3_WORK_CANON_RE,
    _AFF_CANON_RE,
    _FFNET_CANON_RE,
    _FP_CANON_RE,
    _PS_CANON_RE,
    _QQ_CANON_RE,
    _RR_CANON_RE,
    _SB_CANON_RE,
    _SV_CANON_RE,
    _TWILIGHTED_CANON_RE,
    FANFIC_SOURCE_PATTERNS,
    _is_ao3_host,
    classify_ao3_non_work,
    normalize_fanfic_url,
)

FANFICFARE_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
)


# ----------------------------------------------------------------------
# EPUB TEMPLATE APPLIER
# Implementation lives in `utils/epub_template`. Re-exported here so the
# call sites in this module (and the test suite) keep working unchanged.
# ----------------------------------------------------------------------
from utils.epub_template import (  # noqa: E402
    SHELFSORT_TEMPLATE_CSS,
    SHELFSORT_TEMPLATE_MARKER,
    _html_escape,
    _build_intro_xhtml,
    apply_template_to_epub,
)

from utils.status_detector import (  # noqa: E402
    detect_status,
    effective_status,
    COMPLETE as STATUS_COMPLETE,
    ONGOING as STATUS_ONGOING,
)



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
    """Return the first URL in the list that points to a supported fanfic source,
    already normalized to its canonical form."""
    for item in links:
        url = (item.get('url') or '').strip()
        canon = normalize_fanfic_url(url)
        if canon:
            return canon
    return None


def extract_fanfic_urls(links: List[Dict[str, str]]) -> List[str]:
    """Return every canonical fanfic-permalink URL found in the EPUB's link set.

    We only keep URLs that match `FANFIC_SOURCE_PATTERNS` (AO3 /works/N, FFnet
    /s/N, RoyalRoad /fiction/N, etc.) so that duplicate detection doesn't trip
    on boilerplate navigation links shared by every AO3 EPUB. URLs are
    normalized (mobile host stripped, `www.` collapsed, AO3 collection prefix
    removed, chapter id dropped, http→https, etc.) so different surface forms
    of the same work dedupe correctly.
    """
    seen: set = set()
    out: List[str] = []
    for item in links or []:
        url = (item.get('url') or '').strip()
        canon = normalize_fanfic_url(url)
        if canon and canon not in seen:
            seen.add(canon)
            out.append(canon)
    return out


def _clean_author_string(raw: Optional[str]) -> str:
    """Tidy up messy author fields before storing.

    Handles common EPUB metadata patterns that make dedup + display worse:
      - 'by John Smith' → 'John Smith'
      - 'Smith, John & Doe, Jane' → 'Smith, John & Doe, Jane' (preserved,
        but trailing/leading separators stripped)
      - 'John Smith (a.k.a. Pseudonym)' → 'John Smith' (drop parenthetical)
      - 'Pseudonym [pen name]' → 'Pseudonym' (drop bracketed annotation)
      - 'anonymous', 'unknown author', '' → 'Unknown'
      - Collapse internal whitespace.

    We deliberately do NOT lowercase or reformat the case — only the
    matching helper does that, so display stays human-friendly.
    """
    s = (raw or "").strip()
    if not s:
        return "Unknown"
    # Drop parenthetical and bracketed annotations like "(pen name)" or "[a.k.a. X]"
    s = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", s).strip()
    # Strip leading "by " (case-insensitive)
    s = re.sub(r"^(?:by|written by|author[:\s])\s+", "", s, flags=re.IGNORECASE).strip()
    # Trim stray separators ("John Smith, " or "& Jane")
    s = s.strip(" ,&;|/")
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s)
    # Canonicalize common "unknown" sentinels
    low = s.lower()
    if low in ("anonymous", "anon", "anon.", "unknown", "unknown author", "n/a", "na", "various", "various authors"):
        return {"various": "Various", "various authors": "Various"}.get(low, "Unknown")
    return s


def _normalize_title_for_match(title: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (title or "").strip()).lower()


def _normalize_author_for_match(author: Optional[str]) -> str:
    """Normalize for cross-row comparison: lowercase, drop dots, collapse
    whitespace, and merge runs of single-letter "initials" so 'J. K. Rowling'
    and 'JK Rowling' compare equal. Empty stays empty so callers can detect
    missing-author and fall back to title-only matching."""
    s = re.sub(r"\.", "", (author or "")).strip()
    s = re.sub(r"\s+", " ", s).lower()
    # Concatenate runs of single-letter words: 'j k rowling' → 'jk rowling'
    s = re.sub(
        r"\b([a-z])(\s+[a-z]\b)+",
        lambda m: m.group(0).replace(" ", ""),
        s,
    )
    return s


# ---------------------------------------------------------------------------
# URL-list dedupe — treats a .txt of fanfic URLs as a wishlist and strips out
# URLs that already correspond to books in the user's library.
# ---------------------------------------------------------------------------

from utils.url_canonical import (  # noqa: E402
    _URL_RE,
    _canonical_fanfic_url,
    _looks_like_url_list,
)


class UrlListBody(BaseModel):
    text: str


@api_router.post("/books/url-list/dedupe")
async def dedupe_url_list_endpoint(body: UrlListBody, user: User = Depends(get_current_user)):
    """Dedupe a list of URLs pasted/typed in by the user. Same logic as the
    upload-time path but without a file in between."""
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="No URL text provided")
    return await _dedupe_url_list(body.text, user.user_id)


async def _backfill_user_fanfic_urls(user_id: str, limit: int = 2000) -> int:
    """Repopulate `fanfic_urls` and `source_url` for any of the user's books
    that are missing the fields, using the on-disk `.links.txt` sidecar.

    Idempotent — books that already have a non-empty `fanfic_urls` are
    skipped. Returns the count of records actually updated.
    """
    user_dir = STORAGE_DIR / user_id
    if not user_dir.exists():
        return 0
    cursor = db.books.find(
        {
            "user_id": user_id,
            "$or": [
                {"fanfic_urls": {"$exists": False}},
                {"fanfic_urls": []},
                {"source_url": {"$exists": False}},
                {"source_url": None},
            ],
        },
        {"_id": 0, "book_id": 1, "fanfic_urls": 1, "source_url": 1},
    )
    updated = 0
    async for b in cursor:
        if updated >= limit:
            break
        sidecar = user_dir / f"{b['book_id']}.links.txt"
        raw_urls = _parse_urls_from_sidecar(sidecar)
        if not raw_urls:
            # Mark with an empty list so the next sweep skips this book.
            if b.get("fanfic_urls") is None or "fanfic_urls" not in b:
                await db.books.update_one(
                    {"book_id": b["book_id"], "user_id": user_id},
                    {"$set": {"fanfic_urls": []}},
                )
            continue
        canon: List[str] = []
        seen: set = set()
        for u in raw_urls:
            c = normalize_fanfic_url(u)
            if c and c not in seen:
                seen.add(c)
                canon.append(c)
        patch: Dict[str, Any] = {}
        existing = b.get("fanfic_urls") or []
        if canon and canon != existing:
            patch["fanfic_urls"] = canon
        if canon and not b.get("source_url"):
            patch["source_url"] = canon[0]
        if "fanfic_urls" not in b and not canon:
            patch["fanfic_urls"] = []
        if patch:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user_id},
                {"$set": patch},
            )
            updated += 1
    return updated


async def _dedupe_url_list(text: str, user_id: str) -> Dict[str, Any]:
    """Walk every URL in `text`, dedupe against the user's library.

    Returns `{total, already_owned, new_urls, unrecognized, by_source,
    ao3_non_work, duplicate_in_list}`.
    """
    raw_urls: List[str] = []
    seen: set = set()
    for m in _URL_RE.finditer(text):
        url = m.group(0).rstrip('.,);]>')
        if url in seen:
            continue
        seen.add(url)
        raw_urls.append(url)

    # Bucket each URL:
    #   * fanfic permalink → check ownership
    #   * AO3 non-work link (series / collection / user) → separate bucket
    #     (the user pasted it; we want to surface that we saw it but it's
    #     not a story to dedupe against)
    #   * everything else → "unrecognized"
    canonical_pairs: List[Dict[str, str]] = []
    canonical_first_seen: Dict[str, int] = {}
    duplicate_in_list: List[Dict[str, str]] = []
    unrecognized: List[str] = []
    ao3_non_work: List[Dict[str, str]] = []
    for url in raw_urls:
        canonical = _canonical_fanfic_url(url)
        if canonical:
            if canonical in canonical_first_seen:
                duplicate_in_list.append({"url": url, "canonical": canonical})
            else:
                canonical_first_seen[canonical] = len(canonical_pairs)
                canonical_pairs.append({"url": url, "canonical": canonical})
            continue
        non_work = classify_ao3_non_work(url)
        if non_work:
            ao3_non_work.append({"url": url, "kind": non_work})
            continue
        unrecognized.append(url)

    canonicals = sorted({p["canonical"] for p in canonical_pairs})
    # Look up everything in one Mongo round-trip
    owned_map: Dict[str, Dict[str, Any]] = {}
    if canonicals:
        # Opportunistic backfill: many books (especially older uploads) were
        # saved without `fanfic_urls` / `source_url` populated. Before the
        # match query, walk the user's books that are missing the field and
        # repopulate from the on-disk `.links.txt` sidecar so the match
        # actually works. Capped at 2000 sidecars per request — well above
        # any realistic library size for a single dedupe pass.
        await _backfill_user_fanfic_urls(user_id, limit=2000)

        cursor = db.books.find(
            {
                "user_id": user_id,
                "category": {"$ne": TRASH_SHELF},
                "$or": [
                    {"fanfic_urls": {"$in": canonicals}},
                    {"source_url": {"$in": canonicals}},
                ],
            },
            {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fanfic_urls": 1, "source_url": 1, "category": 1, "fandom": 1},
        )
        async for b in cursor:
            for u in (b.get("fanfic_urls") or []):
                if u in canonicals and u not in owned_map:
                    owned_map[u] = b
            if b.get("source_url") in canonicals and b["source_url"] not in owned_map:
                owned_map[b["source_url"]] = b

    already_owned: List[Dict[str, Any]] = []
    new_urls: List[Dict[str, str]] = []
    for p in canonical_pairs:
        match = owned_map.get(p["canonical"])
        if match:
            already_owned.append({
                "url": p["url"],
                "canonical": p["canonical"],
                "book_id": match["book_id"],
                "title": match.get("title") or "",
                "author": match.get("author") or "",
                "fandom": match.get("fandom") or "",
                "category": match.get("category") or "",
            })
        else:
            new_urls.append({"url": p["url"], "canonical": p["canonical"]})

    # Per-source breakdown across the whole list (including unrecognized).
    by_source: Dict[str, int] = {}
    for p in canonical_pairs:
        src = _source_for(p["canonical"]) or "Other"
        by_source[src] = by_source.get(src, 0) + 1
    for d in duplicate_in_list:
        src = _source_for(d["canonical"]) or "Other"
        by_source[src] = by_source.get(src, 0) + 1
    if ao3_non_work:
        by_source["AO3 (not a story)"] = len(ao3_non_work)
    if unrecognized:
        by_source["Unrecognized"] = len(unrecognized)

    # AO3 mirror detection — surface a friendly heads-up when the user
    # pasted URLs from a non-`.org` AO3 hostname (archiveofourown.com/net/gay,
    # ao3.org, archive.transformativeworks.org, insecure.archiveofourown.org).
    # All of them serve the same archive but the heads-up is useful when a
    # user wonders why every mirror dedupes to the same work.
    ao3_mirror_hosts: Dict[str, int] = {}
    for url_str in raw_urls:
        lower = url_str.lower()
        if not _is_ao3_host(lower):
            continue
        # Skip the canonical host — only surface the alt mirrors.
        if "archiveofourown.org" in lower and "insecure." not in lower:
            continue
        # Pull out just the hostname for the chip label.
        try:
            host = lower.split("://", 1)[1].split("/", 1)[0]
        except IndexError:
            continue
        ao3_mirror_hosts[host] = ao3_mirror_hosts.get(host, 0) + 1

    # Unknown-source recorder: log unrecognized URLs that LOOK story-shaped
    # (eFiction-style query string, forum thread, `/works/N`, `/s/N` etc.)
    # so we can surface new fic archives the accepted-list should be
    # extended to cover. Returns the de-duplicated list of hosts captured.
    from utils.unknown_sources import record_unknown_sources
    unknown_sources_found = await record_unknown_sources(
        db, unrecognized, context="paste", user_id=user_id,
    )

    return {
        "total": len(raw_urls),
        "already_owned": already_owned,
        "new_urls": new_urls,
        "unrecognized": unrecognized,
        "ao3_non_work": ao3_non_work,
        "duplicate_in_list": duplicate_in_list,
        "by_source": by_source,
        "ao3_mirrors": ao3_mirror_hosts,
        "unknown_sources_found": unknown_sources_found,
    }


class UrlListExportBody(BaseModel):
    urls: List[str]  # net-new URLs (not already owned)
    # Optional: when the frontend has the already-owned list, ship it so the
    # workbook contains BOTH sheets in one file. Each row is a {url, title?,
    # author?, book_id?} dict so we can show metadata for owned items.
    owned: Optional[List[Dict[str, Any]]] = None
    # Optional: surface forms of canonical URLs that appeared more than once
    # in the pasted text — e.g. the user pasted both
    # `/works/12345` and `/works/12345/chapters/9`. Each row is
    # {url, canonical}. Useful when auditing where AO3 link variants are
    # coming from.
    duplicates: Optional[List[Dict[str, Any]]] = None


from utils.url_canonical import _source_for  # noqa: E402


@api_router.post("/books/url-list/export-xlsx")
async def export_url_list_xlsx(body: UrlListExportBody, user: User = Depends(get_current_user)):
    """Build an Excel summarizing a URL-list dedupe pass.

    Sheet 1 — "New URLs": the net-new fanfic URLs (not in the library)
    Sheet 2 — "Already owned": URLs already in the library, with the matched
              book's title / author / id so the user can review what they
              already have without leaving the spreadsheet.
    Sheet 3 — "Duplicate pastes" (when present): surface forms of canonical
              URLs that appeared more than once in the pasted text — e.g.
              `/works/12345` and `/works/12345/chapters/9` both pointing to
              the same AO3 work. Helps audit messy bookmark dumps.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()

    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="3A5A40")

    # Sheet 1 — net-new
    ws_new = wb.active
    ws_new.title = "New URLs"
    ws_new.append(["URL", "Canonical", "Source"])
    for cell in ws_new[1]:
        cell.font = head_font
        cell.fill = head_fill
    for u in body.urls:
        c = _canonical_fanfic_url(u) or ""
        ws_new.append([u, c, _source_for(u)])
    for col, width in (("A", 60), ("B", 60), ("C", 18)):
        ws_new.column_dimensions[col].width = width
    ws_new.freeze_panes = "A2"
    if ws_new.max_row > 1:
        ws_new.auto_filter.ref = ws_new.dimensions

    # Sheet 2 — already owned
    ws_owned = wb.create_sheet("Already owned")
    ws_owned.append(["URL", "Title", "Author", "Book ID", "Source"])
    for cell in ws_owned[1]:
        cell.font = head_font
        cell.fill = head_fill
    for item in (body.owned or []):
        url = item.get("url") or ""
        ws_owned.append([
            url,
            item.get("title") or "",
            item.get("author") or "",
            item.get("book_id") or "",
            _source_for(url),
        ])
    for col, width in (("A", 60), ("B", 40), ("C", 24), ("D", 18), ("E", 18)):
        ws_owned.column_dimensions[col].width = width
    ws_owned.freeze_panes = "A2"
    if ws_owned.max_row > 1:
        ws_owned.auto_filter.ref = ws_owned.dimensions

    # Sheet 3 — duplicate pastes (only emitted when present so existing
    # workflows that don't pass `duplicates` see no change).
    if body.duplicates:
        ws_dups = wb.create_sheet("Duplicate pastes")
        ws_dups.append(["URL pasted", "Canonical", "Source"])
        for cell in ws_dups[1]:
            cell.font = head_font
            cell.fill = head_fill
        for item in body.duplicates:
            url = item.get("url") or ""
            ws_dups.append([
                url,
                item.get("canonical") or "",
                _source_for(url),
            ])
        for col, width in (("A", 60), ("B", 60), ("C", 18)):
            ws_dups.column_dimensions[col].width = width
        ws_dups.freeze_panes = "A2"
        if ws_dups.max_row > 1:
            ws_dups.auto_filter.ref = ws_dups.dimensions

    buf = io.BytesIO()
    wb.save(buf)
    payload = buf.getvalue()
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="shelfsort_url_list.xlsx"',
            "Content-Length": str(len(payload)),
        },
    )


class UrlListPullBody(BaseModel):
    """Body for the `/api/books/url-list/pull` endpoint. Either pass `urls`
    directly (post-dedupe) or `text` to re-extract URLs from a pasted blob.
    """
    urls: Optional[List[str]] = None
    text: Optional[str] = None


@api_router.post("/books/url-list/pull")
async def pull_url_list(body: UrlListPullBody, user: User = Depends(get_current_user)):
    """Fetch every URL in the list sequentially and add the resulting
    EPUBs to the user's library.

    Strictly one URL at a time — both the FanFicFare path and the FicHub
    fallback path go through their own single-flight locks/sleeps, so
    even if the user pastes 200 URLs we never blast any source site.
    Already-owned URLs (matched against `fanfic_urls`/`source_url`) are
    skipped without a network hit.
    """
    # 1) Pull the URL list. Either explicit `urls` or extract from `text`.
    raw_urls: List[str] = []
    seen: set = set()
    if body.urls:
        for u in body.urls:
            if u and u not in seen:
                seen.add(u)
                raw_urls.append(u)
    elif body.text:
        for m in _URL_RE.finditer(body.text):
            url = m.group(0).rstrip('.,);]>')
            if url and url not in seen:
                seen.add(url)
                raw_urls.append(url)

    # 2) Canonicalize each and skip anything that isn't a recognized fanfic
    #    permalink (also drops AO3 series / collection / user pages).
    canonicals: List[str] = []
    canon_seen: set = set()
    unrecognized: List[str] = []
    for u in raw_urls:
        c = _canonical_fanfic_url(u)
        if c:
            if c not in canon_seen:
                canon_seen.add(c)
                canonicals.append(c)
        else:
            unrecognized.append(u)

    if not canonicals:
        return {
            "queued": 0,
            "added": [],
            "already_owned": [],
            "failed": [],
            "unrecognized": unrecognized,
        }

    # 3) Skip canonical URLs the user already has on a shelf (not Trash).
    owned_cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"fanfic_urls": {"$in": canonicals}},
                {"source_url": {"$in": canonicals}},
            ],
        },
        {"_id": 0, "book_id": 1, "title": 1, "fanfic_urls": 1, "source_url": 1},
    )
    owned_canon: set = set()
    already_owned: List[Dict[str, Any]] = []
    async for b in owned_cursor:
        matched = None
        for c in canonicals:
            if c == b.get("source_url") or c in (b.get("fanfic_urls") or []):
                matched = c
                break
        if matched and matched not in owned_canon:
            owned_canon.add(matched)
            already_owned.append({
                "canonical": matched,
                "book_id": b["book_id"],
                "title": b.get("title") or "",
            })
    to_fetch = [c for c in canonicals if c not in owned_canon]

    # 4) Walk the list serially.
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1, "fandom_aliases": 1})
    fff_options = (user_doc or {}).get("fff_options") or {}
    user_aliases = (user_doc or {}).get("fandom_aliases") or {}
    from routes.admin import get_global_fandom_aliases_dict
    fandom_aliases = {**(await get_global_fandom_aliases_dict()), **user_aliases}
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    added: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for canon in to_fetch:
        try:
            epub_bytes, source_meta = await fetch_fanfic_with_fallback(canon, options=fff_options)
        except FanficNotFoundError as e:
            failed.append({"canonical": canon, "error": str(e)})
            await asyncio.sleep(0.5)
            continue
        except Exception as e:  # pragma: no cover — network errors etc.
            logger.warning("url-list/pull unexpected error for %s: %s", canon, e)
            failed.append({"canonical": canon, "error": str(e)})
            await asyncio.sleep(0.5)
            continue

        # Apply the FicHub-style template if the user wants it.
        if fff_options.get("apply_template", True):
            try:
                epub_bytes = await asyncio.get_event_loop().run_in_executor(
                    None, apply_template_to_epub, epub_bytes, source_meta, canon
                )
            except Exception as e:
                logger.warning("template apply failed for %s: %s", canon, e)

        # Write the EPUB and create the book record using the same pipeline
        # the upload endpoint uses.
        book_id = f"book_{uuid.uuid4().hex[:12]}"
        epub_path = user_dir / f"{book_id}.epub"
        epub_path.write_bytes(epub_bytes)
        try:
            meta = extract_epub_metadata(epub_path)
            links = extract_urls_from_epub(epub_path) or []
            classification = await classify_book(meta)
            series_name = meta.get("series_name")
            series_index = meta.get("series_index")
            if not series_name:
                sn, si = detect_series_from_title(meta["title"])
                if sn:
                    series_name = sn
                    series_index = si if si is not None else series_index
            doc = {
                "book_id": book_id,
                "user_id": user.user_id,
                "filename": f"{(meta.get('title') or 'untitled').strip()}.epub",
                "title": meta["title"],
                "author": meta["author"],
                "description": meta["description"],
                "language": meta["language"],
                "publisher": meta["publisher"],
                "has_cover": bool(meta.get("cover_bytes")),
                "category": classification["category"],
                "fandom": _canonicalize_fandom(classification.get("fandom"), fandom_aliases),
                "confidence": classification.get("confidence"),
                "classifier": classification.get("classifier"),
                "size_bytes": len(epub_bytes),
                "links_count": len(links),
                "source_url": canon,
                "fanfic_urls": extract_fanfic_urls(links),
                "last_refreshed_at": None,
                "series_name": series_name,
                "series_index": series_index,
                "relationships": meta.get("relationships") or [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            if meta.get("cover_bytes"):
                (user_dir / f"{book_id}.cover").write_bytes(meta["cover_bytes"])
            (user_dir / f"{book_id}.links.txt").write_text(
                format_links_txt(meta["title"], meta["author"], links),
                encoding="utf-8",
            )
            await db.books.insert_one(doc)
            added.append({
                "canonical": canon,
                "book_id": book_id,
                "title": doc["title"],
                "fandom": doc["fandom"],
            })
        except Exception as e:
            logger.warning("url-list/pull post-fetch processing failed for %s: %s", canon, e)
            try:
                epub_path.unlink(missing_ok=True)
            except Exception:
                pass
            failed.append({"canonical": canon, "error": f"Could not process EPUB: {e}"})

    return {
        "queued": len(to_fetch),
        "added": added,
        "already_owned": already_owned,
        "failed": failed,
        "unrecognized": unrecognized,
    }


async def find_duplicate_candidates(
    user_id: str,
    *,
    title: Optional[str],
    author: Optional[str] = None,
    source_url: Optional[str],
    fanfic_urls: Optional[List[str]] = None,
    exclude_book_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Find existing books in the user's library that look like duplicates.

    Match rules (any of):
      - normalized title + author equality (case-insensitive, whitespace-collapsed,
        dots stripped from author). When either side has no author on file we
        fall back to title-only matching so books that legitimately lack an
        author still dedupe.
      - exact source_url equality
      - any shared canonical fanfic URL (intersection on `fanfic_urls`)

    Archived versions are searched too — when a match lands on an archived
    book we walk the `replaced_by` chain to its current head and surface the
    head as the match (with `historical_version` added to match_reasons),
    so the upload can be offered as a historical version of a current copy.

    Returns a list of `{book_id, title, author, match_reasons: [...]}` dicts.
    """
    norm_title = _normalize_title_for_match(title)
    norm_author = _normalize_author_for_match(author)
    urls = [u for u in (fanfic_urls or []) if u]

    or_clauses: List[Dict[str, Any]] = []
    if norm_title:
        # Narrow the title regex pre-filter; we still verify title+author
        # equality in Python below.
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
            # Tightened rule: when both sides have an author, they must
            # match too — otherwise two different books with the same title
            # (e.g. retellings, generic titles like "Untitled") get
            # falsely paired. Fall back to title-only when either side is
            # missing an author.
            doc_norm_author = _normalize_author_for_match(doc.get("author"))
            if not norm_author or not doc_norm_author:
                reasons.append("title")
            elif doc_norm_author == norm_author:
                reasons.append("title+author")
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
        except fff_exc.UnknownSite:
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
                            "Source site blocked the request (HTTP 403, retried). The site may be rate-limiting, "
                            "behind a Cloudflare challenge, or restricting this work to registered users. "
                            "Try opening the URL in a browser to check."
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
            "author": _clean_author_string(story.getMetadata("author")),
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


async def fetch_fanfic_with_fallback(
    source_url: str,
    options: Optional[Dict[str, Any]] = None,
) -> tuple:
    """Try FanFicFare first; if it fails AND the user opted into the
    FicHub fallback, retry with FicHub. Returns the same `(epub_bytes,
    source_meta)` tuple as `fanfic_fetch_epub`.

    The fallback is serialized — even if many user requests hit this in
    parallel, they're drained through `routes.fichub_client._FETCH_LOCK`
    one at a time, with a 2s gap between consecutive FicHub fetches.
    """
    # Feature-flag kill switch — admin can pause remote fic fetching.
    from utils.feature_flags import is_enabled
    if not await is_enabled("fichub_enabled"):
        raise FanficNotFoundError("Fanfic fetching is temporarily disabled by an administrator.")
    options = options or {}
    try:
        return await fanfic_fetch_epub(source_url, options=options)
    except FanficNotFoundError as fff_err:
        if not options.get("try_fichub_fallback"):
            raise
        from routes.fichub_client import (  # local import to avoid circular
            fichub_fetch_epub,
            FichubUnsupportedURL,
            FichubError,
        )
        try:
            epub_bytes, _meta = await fichub_fetch_epub(source_url)
            logger.info("FicHub fallback succeeded for %s", source_url)
            return epub_bytes, {"source": "fichub", "url": source_url}
        except FichubUnsupportedURL:
            # Re-raise the original FFF error — that's the more informative
            # message ("Story not found", "Site not supported", etc.).
            raise fff_err
        except FichubError as e:
            logger.warning(
                "FicHub fallback also failed for %s: %s", source_url, e
            )
            raise fff_err


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
    # Honor per-user FanFicFare options (incl. opt-in FicHub fallback)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "fff_options": 1})
    fff_options = (user_doc or {}).get("fff_options") or {}
    epub_bytes, source_meta = await fetch_fanfic_with_fallback(source_url, options=fff_options)

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

    # Feature-flag kill switch — admin can pause Claude calls (e.g. cost control).
    from utils.feature_flags import is_enabled
    if not await is_enabled("ai_classify_enabled"):
        return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai_disabled"}

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
        '{"category": "Fanfiction|Original Fiction|Non-fiction", "fandom": "<specific fandom name, or null if not fanfiction>", "confidence": 0.0-1.0, "tags": ["tag1","tag2","tag3"]}. '
        "Use Fanfiction only when it is clearly fan-derived from another work. "
        "For original fiction novels (even popular ones like the actual Harry Potter series by Rowling), use Original Fiction, not Fanfiction. "
        "Fandom names: use AO3's canonical tag form. For multi-property franchises with distinct sub-fandoms, bucket into the specific sub-fandom rather than the umbrella. "
        "Examples: Stargate SG-1 (NOT 'Stargate'), Stargate Atlantis, Stargate Universe, Stargate (Movies). "
        "Common fandoms: Harry Potter, Twilight, Marvel, DC Comics, Star Wars, Lord of the Rings, Sherlock Holmes, Percy Jackson, Doctor Who, Supernatural, Game of Thrones, Hunger Games, Naruto, My Hero Academia, BTS, One Direction, Stargate SG-1, Stargate Atlantis, Stargate Universe, Stargate (Movies). "
        "If a work spans multiple sub-fandoms, return them joined with ' / ' (e.g. 'Stargate SG-1 / Stargate Atlantis') so it lands on the crossover shelf. "
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
    # Feature-flag kill switch — admin can pause Calibre conversions.
    from utils.feature_flags import is_enabled
    if not await is_enabled("calibre_convert_enabled"):
        return "Calibre conversion is temporarily disabled by an administrator."
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _convert_to_epub_sync, src_path, dest_path)


# Persistent conversion-job tracking — backed by MongoDB so jobs survive
# backend restarts, tab closes, and cross-device sessions. A TTL index on
# `expires_at` cleans up finished jobs after the 4-hour visibility window.
CONVERSION_VISIBILITY_HOURS = 4
_conversion_index_ensured = False


async def _ensure_conversion_index() -> None:
    """Lazily create a TTL index on conversion_jobs.expires_at."""
    global _conversion_index_ensured
    if _conversion_index_ensured:
        return
    try:
        await db.conversion_jobs.create_index("expires_at", expireAfterSeconds=0)
        await db.conversion_jobs.create_index([("user_id", 1), ("started_at", -1)])
        _conversion_index_ensured = True
    except Exception as e:
        logger.warning("Failed to create conversion_jobs indexes: %s", e)


async def _conversion_start(user_id: str, job: Dict[str, Any]) -> None:
    await _ensure_conversion_index()
    doc = {
        **job,
        "user_id": user_id,
        "status": "processing",
        # expires_at intentionally omitted so the TTL doesn't apply while
        # the job is still running.
    }
    await db.conversion_jobs.insert_one(doc)


async def _conversion_end(user_id: str, job_id: str, *, error: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=CONVERSION_VISIBILITY_HOURS)
    await db.conversion_jobs.update_one(
        {"id": job_id, "user_id": user_id},
        {
            "$set": {
                "status": "failed" if error else "done",
                "error": error,
                "finished_at": now.isoformat(),
                "expires_at": expires,
            }
        },
    )


@api_router.get("/conversions/status")
async def conversions_status(user: User = Depends(get_current_user)):
    """Return the user's conversion-job history within the visibility window
    (default 4 hours after completion). Includes both in-progress and recently
    completed/failed jobs."""
    await _ensure_conversion_index()
    cursor = db.conversion_jobs.find(
        {"user_id": user.user_id},
        {"_id": 0, "user_id": 0},
    ).sort("started_at", -1).limit(50)
    jobs = [j async for j in cursor]
    converting = sum(1 for j in jobs if j.get("status") == "processing")
    recent_done = sum(1 for j in jobs if j.get("status") == "done")
    recent_failed = sum(1 for j in jobs if j.get("status") == "failed")
    return {
        "converting": converting,
        "recent_done": recent_done,
        "recent_failed": recent_failed,
        "visibility_hours": CONVERSION_VISIBILITY_HOURS,
        "jobs": jobs,
    }


@api_router.post("/conversions/dismiss")
async def conversions_dismiss(user: User = Depends(get_current_user)):
    """Hide all completed/failed conversion jobs immediately (the chip will
    only show in-progress jobs after this). In-progress jobs are untouched."""
    result = await db.conversion_jobs.delete_many({
        "user_id": user.user_id,
        "status": {"$in": ["done", "failed"]},
    })
    return {"dismissed": result.deleted_count}


@api_router.post("/conversions/retry-all")
async def retry_all_failed_conversions(user: User = Depends(get_current_user)):
    """Re-run every failed conversion in the visibility window. Returns a
    per-job summary so the UI can show how many recovered vs are still failing."""
    cursor = db.conversion_jobs.find(
        {"user_id": user.user_id, "status": "failed"},
        {"_id": 0, "id": 1},
    )
    job_ids = [j["id"] async for j in cursor]
    succeeded = 0
    still_failed = 0
    errors: List[Dict[str, str]] = []
    for jid in job_ids:
        try:
            # Re-use the per-job retry logic by calling it directly.
            result = await retry_conversion(jid, user)
            if result.get("ok"):
                succeeded += 1
            else:
                still_failed += 1
                errors.append({"job_id": jid, "error": result.get("error") or "unknown"})
        except HTTPException as e:
            still_failed += 1
            errors.append({"job_id": jid, "error": e.detail})
        except Exception as e:
            still_failed += 1
            errors.append({"job_id": jid, "error": str(e)})
    return {
        "attempted": len(job_ids),
        "succeeded": succeeded,
        "still_failed": still_failed,
        "errors": errors,
    }


@api_router.post("/conversions/{job_id}/retry")
async def retry_conversion(job_id: str, user: User = Depends(get_current_user)):
    """Re-run a failed conversion against the original source file.

    Looks up the failed job, finds the source file on disk (still kept after
    failure), runs `ebook-convert` again, and on success extracts metadata +
    re-classifies the book so it lands on the right shelf and is openable in
    the Reader. The job record is updated in place (no new row).
    """
    job = await db.conversion_jobs.find_one({"id": job_id, "user_id": user.user_id})
    if not job:
        raise HTTPException(status_code=404, detail="Conversion job not found")
    if job.get("status") not in ("failed", "done"):
        raise HTTPException(status_code=400, detail="Job is still in progress")

    book_id = job.get("book_id")
    ext = "." + (job.get("original_format") or "")
    user_dir = STORAGE_DIR / user.user_id
    src_path = user_dir / f"{book_id}{ext}"
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Original source file is no longer on disk")
    epub_target = user_dir / f"{book_id}.epub"

    # Mark as processing again
    await db.conversion_jobs.update_one(
        {"id": job_id, "user_id": user.user_id},
        {
            "$set": {
                "status": "processing",
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {"finished_at": "", "expires_at": "", "error": ""},
        },
    )

    err = await convert_to_epub(src_path, epub_target)
    await _conversion_end(user.user_id, job_id, error=err)
    if err:
        return {"ok": False, "error": err}

    # Conversion succeeded — extract metadata + reclassify
    try:
        meta = extract_epub_metadata(epub_target)
        cls = await classify_book(meta)
        links = extract_urls_from_epub(epub_target)
        source_url = find_source_url(links)
        fanfic_urls = extract_fanfic_urls(links)
        update = {
            "title": meta.get("title") or "Untitled",
            "author": meta.get("author") or "Unknown",
            "description": meta.get("description") or "",
            "language": meta.get("language") or "",
            "publisher": meta.get("publisher") or "",
            "has_cover": bool(meta.get("cover_bytes")),
            "category": cls.get("category") or "Unclassified",
            "fandom": cls.get("fandom"),
            "confidence": cls.get("confidence") or 0.5,
            "classifier": cls.get("classifier") or "retry",
            "tags": cls.get("tags") or [],
            "links_count": len(links),
            "source_url": source_url,
            "fanfic_urls": fanfic_urls,
            "converted_from": ext.lstrip("."),
            "original_format": ext.lstrip("."),
        }
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": update,
                "$unset": {"needs_conversion": "", "conversion_error": ""},
            },
        )
    except Exception as e:
        logger.warning("retry_conversion metadata pass failed for %s: %s", book_id, e)
        return {"ok": True, "warning": f"Converted but metadata refresh failed: {e}"}

    return {"ok": True, "book_id": book_id, "category": update.get("category")}


@api_router.post("/books/upload")
async def upload_books(
    request: Request,
    files: List[UploadFile] = File(...),
    keep_originals: List[str] = Form([]),
    user: User = Depends(get_current_user),
):
    # Feature-flag kill switch — admin can pause uploads in maintenance.
    from utils.feature_flags import is_enabled
    if not await is_enabled("uploads_enabled"):
        raise HTTPException(status_code=503, detail="Uploads are temporarily disabled by an administrator.")
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    # Load fandom aliases once for the whole batch so per-book canonicalization
    # picks up user-defined merges (e.g. "HP" -> "Harry Potter"). Global
    # admin-managed aliases are merged in; per-user overrides on conflict.
    _udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    user_aliases = _udoc.get("fandom_aliases") or {}
    from routes.admin import get_global_fandom_aliases_dict
    global_aliases = await get_global_fandom_aliases_dict()
    fandom_aliases = {**global_aliases, **user_aliases}
    # Filenames the user explicitly asked to keep as the original format
    # (no Calibre conversion). They land on /library/originals separately
    # from the main EPUB library.
    keep_original_set = {n for n in keep_originals if n}
    results = []
    url_list_reports: List[Dict[str, Any]] = []
    upload_suggestions: List[Dict[str, Any]] = []
    cross_format_dupes: List[Dict[str, Any]] = []
    # Story-shaped URLs we found inside uploaded EPUBs whose host isn't on
    # the accepted-sources list. Collected across every file in the batch
    # and flushed to the `unknown_sources` collection just before the
    # response so the toast can echo back the new hosts.
    upload_unknown_urls: List[Dict[str, Any]] = []  # {url, book_id, title, author}

    for f in files:
        lower = (f.filename or "").lower()
        ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""

        # `.txt` is a special case — it could be a plain-text manuscript
        # (Calibre-convertible) OR a wishlist of fanfic URLs. If it's
        # dominantly URLs we route it through the dedupe pipeline instead of
        # converting it as a book.
        if ext == ".txt":
            try:
                raw_bytes = await f.read()
                text = raw_bytes.decode("utf-8", errors="ignore")
            except Exception:
                text, raw_bytes = "", b""
            looks_like_url_list = _looks_like_url_list(text)
            if looks_like_url_list:
                report = await _dedupe_url_list(text, user.user_id)
                report["filename"] = f.filename
                url_list_reports.append(report)
                continue
            # Not a URL list — restore the read pointer so the standard
            # Calibre-convert branch below picks it up. We re-write the file
            # to disk and skip ahead.
            await f.seek(0)

        # Non-EPUB but a known ebook format → auto-convert to EPUB via
        # Calibre's `ebook-convert`, then fall through to the normal EPUB
        # pipeline below (metadata / classification / fanfic / template).
        # On conversion failure we keep the original file under the
        # "Needs conversion" shelf with a friendly error message.
        original_format: Optional[str] = None
        if ext != ".epub" and ext in NEEDS_CONVERSION_EXTS:
            book_id = f"book_{uuid.uuid4().hex[:12]}"
            src_target = user_dir / f"{book_id}{ext}"
            content = await f.read()
            src_target.write_bytes(content)

            # Path 1 — "Keep original": user wants this file on the Originals
            # shelf without Calibre conversion. We do a quick title/author
            # guess from the filename (and cross-format dup check against
            # existing EPUBs) and store an original-only doc.
            if (f.filename or "") in keep_original_set:
                base_name = (f.filename or "Untitled").rsplit(".", 1)[0]
                # Title - Author pattern, common from manual exports
                guess_title = base_name
                guess_author = "Unknown"
                if " - " in base_name:
                    left, right = base_name.rsplit(" - ", 1)
                    if len(left) > 1 and len(right) > 1:
                        guess_title, guess_author = left.strip(), right.strip()
                # Cross-format duplicate detection — match title+author
                # case-insensitively against existing EPUB books.
                dup_match = await db.books.find_one(
                    {
                        "user_id": user.user_id,
                        "original_only": {"$ne": True},
                        "title": {"$regex": f"^{re.escape(guess_title)}$", "$options": "i"},
                        "author": {"$regex": f"^{re.escape(guess_author)}$", "$options": "i"},
                    },
                    {"_id": 0, "book_id": 1, "title": 1, "author": 1},
                )
                dup_ids = [dup_match["book_id"]] if dup_match else []
                if dup_match:
                    cross_format_dupes.append({
                        "new_filename": f.filename,
                        "new_book_id": book_id,
                        "matched_book_id": dup_match["book_id"],
                        "matched_title": dup_match.get("title"),
                        "matched_author": dup_match.get("author"),
                    })
                now_iso = datetime.now(timezone.utc).isoformat()
                doc = {
                    "book_id": book_id,
                    "user_id": user.user_id,
                    "filename": f.filename,
                    "title": guess_title,
                    "author": guess_author,
                    "description": f"Original {ext.lstrip('.').upper()} kept as-is (no Calibre conversion).",
                    "language": "",
                    "publisher": "",
                    "has_cover": False,
                    # Use a distinct shelf so these don't pollute the main library.
                    "category": "Originals",
                    "fandom": None,
                    "confidence": 1.0,
                    "classifier": "kept-original",
                    "tags": [],
                    "size_bytes": len(content),
                    "links_count": 0,
                    "source_url": None,
                    "fanfic_urls": [],
                    "last_refreshed_at": None,
                    "series_name": None,
                    "series_index": None,
                    "original_only": True,
                    "original_format": ext.lstrip("."),
                    "cross_format_duplicate_of": dup_ids,
                    "created_at": now_iso,
                }
                await db.books.insert_one(doc)
                results.append({k: v for k, v in doc.items() if k != "_id"})
                continue

            # Path 2 — normal "Convert" flow (existing behavior).
            epub_target = user_dir / f"{book_id}.epub"
            job_id = uuid.uuid4().hex
            await _conversion_start(user.user_id, {
                "id": job_id,
                "book_id": book_id,
                "title": (f.filename or "Untitled").rsplit(".", 1)[0],
                "original_format": ext.lstrip("."),
                "started_at": datetime.now(timezone.utc).isoformat(),
            })
            err = None
            try:
                err = await convert_to_epub(src_target, epub_target)
            finally:
                await _conversion_end(user.user_id, job_id, error=err)
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

        # Stash URLs that look story-shaped but didn't canonicalize so we
        # can record their hosts as "potential new sources" after the
        # batch finishes (one Mongo write per host, not per URL).
        for _link in links or []:
            _u = (_link.get("url") or "").strip()
            if _u and not normalize_fanfic_url(_u):
                upload_unknown_urls.append({
                    "url": _u, "book_id": book_id,
                    "title": meta.get("title"), "author": meta.get("author"),
                })

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
            "fandom": _canonicalize_fandom(classification.get('fandom'), fandom_aliases),
            "confidence": classification.get('confidence'),
            "classifier": classification.get('classifier'),
            "size_bytes": len(content),
            "links_count": len(links),
            "source_url": source_url,
            "fanfic_urls": fanfic_urls,
            "last_refreshed_at": None,
            "series_name": series_name,
            "series_index": series_index,
            "relationships": meta.get("relationships") or [],
            # Auto-detected completion status (complete | ongoing). User
            # override lives at `manual_status`; effective_status() picks
            # the override when set. Detection runs only at upload time —
            # users said they don't want re-detection on refresh (5a).
            "status": detect_status(
                title=meta.get("title"),
                description=meta.get("description"),
                raw_meta_text=meta.get("rawExtendedMeta_text"),
                tags=meta.get("tags") or [],
            ),
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
            author=meta.get('author'),
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

    # Fuzzy match suggestions — look at every fandom that landed in this
    # batch; if it's a brand-new fandom and close (≤2 edits) to an existing
    # one, surface a suggestion the UI can pop as a toast.
    batch_fandoms = {b.get("fandom") for b in results if isinstance(b, dict) and b.get("fandom")}
    if batch_fandoms:
        existing_rows = await db.books.aggregate([
            {"$match": {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}}},
            {"$group": {"_id": "$fandom"}},
        ]).to_list(5000)
        existing_fandoms = [r["_id"] for r in existing_rows if r.get("_id")]
        # Only suggest when the just-uploaded fandom is rare in the library
        # (otherwise it's clearly already an "established" shelf).
        counts: Dict[str, int] = {}
        for r in existing_rows:
            counts[r["_id"]] = counts.get(r["_id"], 0) + 1
        for nf in batch_fandoms:
            sug = _suggest_fandom_merges(nf, [e for e in existing_fandoms if e != nf])
            if sug:
                upload_suggestions.append({"new_fandom": nf, "suggestions": sug})

    # Unknown-source detector: flush all story-shaped URLs that didn't
    # canonicalize as a single Mongo upsert per distinct host. We record
    # the most recently-seen sample per host along with the book title/
    # author/id so the admin endpoint can show context.
    from utils.unknown_sources import record_unknown_sources
    unknown_hosts_recorded: List[str] = []
    if upload_unknown_urls:
        # Group by host so we attach the latest book context to each host.
        from utils.unknown_sources import _host_of, looks_like_fanfic_url
        seen_hosts: set = set()
        for item in upload_unknown_urls:
            u = item["url"]
            if not looks_like_fanfic_url(u):
                continue
            h = _host_of(u)
            if not h or h in seen_hosts:
                continue
            seen_hosts.add(h)
            rec = await record_unknown_sources(
                db, [u], context="upload",
                user_id=user.user_id,
                book_id=item.get("book_id"),
                book_title=item.get("title"),
                book_author=item.get("author"),
            )
            unknown_hosts_recorded.extend(rec)

    # Best-effort: notify friends who already collect any of the same
    # fandoms in this batch. Never raises — see helper for rules.
    await _notify_friends_of_shared_fandom_uploads(
        user.user_id,
        (user.name or user.email or "A friend"),
        results,
    )

    return {
        "uploaded": len(results),
        "books": results,
        "auto_resolved": auto_resolved,
        "policy": policy,
        "actions": actions,
        "url_lists": url_list_reports,
        "fandom_suggestions": upload_suggestions,
        "cross_format_duplicates": cross_format_dupes,
        "unknown_sources_found": unknown_hosts_recorded,
    }


async def _notify_friends_of_shared_fandom_uploads(
    uploader_id: str,
    uploader_display: str,
    uploaded_results: List[Dict[str, Any]],
) -> None:
    """When a user uploads fanfic in fandoms their friends also collect,
    drop one in-app notification per (friend, fandom) so the friend can
    peek at the new arrival. Best-effort only — failures are logged and
    swallowed so an upload never 500s on a notification hiccup.

    Rules:
      • Only books with a `fandom` value count (skips non-fic / original fic).
      • Books that were removed by an auto-resolve "discard" policy are
        skipped (`removed: True`).
      • One notification per (friend, fandom) per batch — not per book.
      • Hard cap of 50 notifications per upload to prevent runaway spam.
    """
    from routes.notifications import create_notification
    try:
        # 1) Distinct fandoms in this batch that we'd want to ping about.
        batch_fandoms: set = set()
        for b in uploaded_results or []:
            if not isinstance(b, dict):
                continue
            if b.get("removed"):
                continue
            fd = b.get("fandom")
            if fd and isinstance(fd, str) and fd.strip():
                batch_fandoms.add(fd.strip())
        if not batch_fandoms:
            return

        # 2) Accepted friends only.
        friend_rows = await db.friendships.find(
            {
                "status": "accepted",
                "$or": [{"user_a": uploader_id}, {"user_b": uploader_id}],
            },
            {"_id": 0, "user_a": 1, "user_b": 1},
        ).to_list(length=2000)
        friend_ids = [
            (r["user_b"] if r["user_a"] == uploader_id else r["user_a"])
            for r in friend_rows
        ]
        if not friend_ids:
            return

        # 3) For each friend, find which of the batch fandoms they also have.
        emitted = 0
        cap = 50
        for fid in friend_ids:
            if emitted >= cap:
                break
            rows = await db.books.find(
                {"user_id": fid, "fandom": {"$in": list(batch_fandoms)}},
                {"_id": 0, "fandom": 1},
            ).to_list(length=500)
            shared = sorted({r["fandom"] for r in rows if r.get("fandom")})
            for fandom in shared:
                if emitted >= cap:
                    break
                await create_notification(
                    fid,
                    kind="friend_new_book",
                    title=f"{uploader_display} just added a new {fandom} fic",
                    body="Peek their shelf to see what's new.",
                    link="/friends",
                )
                emitted += 1
    except Exception as e:  # pragma: no cover — defensive
        logger.warning(f"friend-fandom notifications skipped: {e}")


@api_router.get("/library/trends")
async def library_trends(days: int = 7, user: User = Depends(get_current_user)):
    """Counts of brand-new items in the user's library over the last `days`.

    Returns deltas for books / fandoms / crossovers / pairings — "brand-new"
    means the item didn't appear in any pre-window book (e.g. a fandom counts
    only if no older book in the library was already on that fandom).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()

    recent_cursor = db.books.find(
        {"user_id": user.user_id, "created_at": {"$gte": cutoff}, "original_only": {"$ne": True}},
        {"_id": 0, "book_id": 1, "fandom": 1, "relationships": 1},
    )
    recent = await recent_cursor.to_list(5000)
    older_cursor = db.books.find(
        {"user_id": user.user_id, "created_at": {"$lt": cutoff}, "original_only": {"$ne": True}},
        {"_id": 0, "fandom": 1, "relationships": 1},
    )
    older = await older_cursor.to_list(20000)

    older_fandoms = {b.get("fandom") for b in older if b.get("fandom")}
    older_pairings: set = set()
    for b in older:
        for r in (b.get("relationships") or []):
            if r:
                older_pairings.add(r)

    new_fandoms = set()
    new_crossovers = set()
    new_pairings = set()
    for b in recent:
        f = b.get("fandom")
        if f and f not in older_fandoms:
            new_fandoms.add(f)
            if " / " in f:
                new_crossovers.add(f)
        for r in (b.get("relationships") or []):
            if r and r not in older_pairings:
                new_pairings.add(r)

    return {
        "window_days": days,
        "books": len(recent),
        "fandoms": len(new_fandoms),
        "crossovers": len(new_crossovers),
        "pairings": len(new_pairings),
    }



@api_router.get("/library/originals")
async def list_originals(user: User = Depends(get_current_user)):
    """Books the user chose to keep as their original (non-EPUB) format —
    PDFs, MOBI/AZW, DOCX, etc. that were NOT routed through Calibre. They
    live on their own page so the EPUB library stays clean."""
    books = await db.books.find(
        {"user_id": user.user_id, "original_only": True},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)
    return {
        "count": len(books),
        "books": books,
    }


@api_router.post("/library/originals/convert-all")
async def convert_all_originals(
    skip_dups: bool = False,
    user: User = Depends(get_current_user),
):
    """Bulk-convert every original-only book to EPUB. With `skip_dups=true`
    we skip files whose `cross_format_duplicate_of` is non-empty — useful
    when the user already has the same book as an EPUB."""
    query: Dict[str, Any] = {"user_id": user.user_id, "original_only": True}
    if skip_dups:
        # Match either missing/empty array OR an empty list explicitly.
        query["$or"] = [
            {"cross_format_duplicate_of": {"$exists": False}},
            {"cross_format_duplicate_of": []},
            {"cross_format_duplicate_of": None},
        ]
    books = await db.books.find(query, {"_id": 0, "book_id": 1}).to_list(5000)
    converted: List[str] = []
    failed: List[Dict[str, str]] = []
    for b in books:
        try:
            resp = await convert_original_to_epub(b["book_id"], user)
            if resp.get("ok"):
                converted.append(b["book_id"])
            else:
                failed.append({"book_id": b["book_id"], "error": resp.get("error") or "unknown"})
        except Exception as e:
            failed.append({"book_id": b["book_id"], "error": str(e)})
    return {
        "scanned": len(books),
        "converted": len(converted),
        "failed": failed,
    }



async def convert_original_to_epub(book_id: str, user: User = Depends(get_current_user)):
    """Promote an original-format book (PDF/MOBI/AZW/DOCX/etc.) to a full
    EPUB by running Calibre on it. On success the book moves out of the
    Originals shelf into the regular library (classified by the new
    metadata) and becomes openable in the Reader.
    """
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book or not book.get("original_only"):
        raise HTTPException(status_code=404, detail="Original-format book not found")
    ext = "." + (book.get("original_format") or "")
    user_dir = STORAGE_DIR / user.user_id
    src_path = user_dir / f"{book_id}{ext}"
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Source file missing on disk")
    epub_target = user_dir / f"{book_id}.epub"

    err = await convert_to_epub(src_path, epub_target)
    if err:
        return {"ok": False, "error": err}

    # Re-extract metadata + classify the freshly converted EPUB so it lands
    # on the right shelf instead of staying as a stub "Originals" entry.
    try:
        meta = extract_epub_metadata(epub_target)
        cls = await classify_book(meta)
        links = extract_urls_from_epub(epub_target)
        source_url = find_source_url(links)
        fanfic_urls = extract_fanfic_urls(links)
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {
                "$set": {
                    "title": meta.get("title") or book.get("title") or "Untitled",
                    "author": meta.get("author") or book.get("author") or "Unknown",
                    "description": meta.get("description") or "",
                    "language": meta.get("language") or "",
                    "publisher": meta.get("publisher") or "",
                    "has_cover": bool(meta.get("cover_bytes")),
                    "category": cls["category"],
                    "fandom": _canonicalize_fandom(cls.get("fandom")),
                    "confidence": cls["confidence"],
                    "classifier": cls["classifier"],
                    "tags": cls.get("tags") or [],
                    "links_count": len(links),
                    "source_url": source_url,
                    "fanfic_urls": fanfic_urls,
                    # Out of the Originals room — keep `original_format` as a
                    # historical hint that it came from a non-EPUB.
                    "original_only": False,
                },
            },
        )
    except Exception as e:
        return {"ok": False, "error": f"Metadata extraction failed: {e}"}

    updated = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    return {"ok": True, "book": updated}




@api_router.get("/books")
async def list_books(
    request: Request,
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    relationship: Optional[str] = None,
    q: Optional[str] = None,
    smart: Optional[str] = None,
    include_originals: bool = False,
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
    if relationship:
        query['relationships'] = relationship
    # Originals (kept-as-is non-EPUBs) live on /library/originals — exclude
    # them from the main library unless explicitly asked.
    if not include_originals and not (category == "Originals"):
        query['original_only'] = {"$ne": True}

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
    pipeline_rel = [
        {"$match": {"user_id": user.user_id, "relationships": {"$exists": True, "$ne": []}}},
        {"$unwind": "$relationships"},
        {"$group": {"_id": "$relationships", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    cats = await db.books.aggregate(pipeline_cat).to_list(100)
    fandoms = await db.books.aggregate(pipeline_fandom).to_list(100)
    relationships = await db.books.aggregate(pipeline_rel).to_list(200)
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
        "relationships": [{"name": r['_id'], "count": r['count']} for r in relationships],
        "crossover_count": sum(
            1 for f in fandoms
            if f.get('_id') and len([p for p in str(f['_id']).split(' / ') if p.strip()]) >= 2
        ),
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
    # When True, falls back to fichub.net if FanFicFare fails for any
    # reason on a given URL. FicHub is a hosted scraping service so it
    # often works when our server's IP gets rate-limited by AO3/FFnet.
    # Off by default — opt-in per user. (Added 2026-06-07.)
    try_fichub_fallback: Optional[bool] = None


FFF_OPTION_DEFAULTS = {
    "include_author_notes": True,
    "include_images": True,
    "keep_chapter_links": False,
    "apply_template": True,
    "try_fichub_fallback": False,
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


# Per-format upload preferences for non-EPUB files. Each format group can be
# "ask" (default — show the per-upload Convert/Keep/Skip prompt) or "skip"
# (silently drop without uploading). We intentionally do NOT expose a
# silent auto-convert option: the user should always decide whether to run
# a Calibre conversion. Silent conversion was removed 2026-06-06.
FORMAT_GROUPS = ("pdf", "kindle", "word", "other_ebook", "txt", "html")
FORMAT_ACTIONS = ("ask", "skip")
FORMAT_PREFS_DEFAULT = {g: "ask" for g in FORMAT_GROUPS}


def _coerce_format_prefs(stored: Dict[str, Any]) -> Dict[str, str]:
    """Read-side migration. Any legacy `"convert"` (auto-add) value is
    coerced back to `"ask"` so the user is never silently auto-converted
    even if their stored prefs still have the old value."""
    out: Dict[str, str] = {}
    for k, v in (stored or {}).items():
        if k not in FORMAT_GROUPS:
            continue
        if v == "convert":
            out[k] = "ask"
        elif v in FORMAT_ACTIONS:
            out[k] = v
    return out


class FormatPrefsBody(BaseModel):
    # Partial patch — only keys actually present are updated.
    pdf: Optional[str] = None
    kindle: Optional[str] = None
    word: Optional[str] = None
    other_ebook: Optional[str] = None
    txt: Optional[str] = None
    html: Optional[str] = None


@api_router.get("/user/format-prefs")
async def get_format_prefs(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "format_prefs": 1})
    stored = (user_doc or {}).get("format_prefs") or {}
    return {**FORMAT_PREFS_DEFAULT, **_coerce_format_prefs(stored)}


@api_router.put("/user/format-prefs")
async def update_format_prefs(body: FormatPrefsBody, user: User = Depends(get_current_user)):
    patch = body.dict(exclude_none=True)
    for k, v in patch.items():
        if v not in FORMAT_ACTIONS:
            raise HTTPException(status_code=400, detail=f"{k} must be one of {list(FORMAT_ACTIONS)}")
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "format_prefs": 1})
    stored = _coerce_format_prefs((user_doc or {}).get("format_prefs") or {})
    stored.update(patch)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"format_prefs": stored}},
    )
    return {**FORMAT_PREFS_DEFAULT, **stored}


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
    category: Optional[List[str]] = Query(None),
    fandom: Optional[List[str]] = Query(None),
    relationship: Optional[List[str]] = Query(None),
    author: Optional[List[str]] = Query(None),
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
        query["category"] = {"$in": category} if len(category) > 1 else category[0]
    if fandom:
        query["fandom"] = {"$in": fandom} if len(fandom) > 1 else fandom[0]
    if relationship:
        query["relationships"] = {"$in": relationship} if len(relationship) > 1 else relationship[0]
    if author:
        query["author"] = {"$in": author} if len(author) > 1 else author[0]
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
            ("Filename", "filename", 32),
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
        payload = buf.getvalue()
        xlsx_name = "shelfsort_library.xlsx"
        if fandom and len(fandom) == 1:
            xlsx_name = f"shelfsort_{_safe_folder(fandom[0])}.xlsx"
        elif category and len(category) == 1:
            xlsx_name = f"shelfsort_{_safe_folder(category[0])}.xlsx"
        elif any([fandom, category, relationship, author]):
            xlsx_name = "shelfsort_filtered.xlsx"
        return Response(
            content=payload,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{xlsx_name}"',
                "Content-Length": str(len(payload)),
            },
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

        payload = buf.getvalue()
        zip_name = "shelfsort_links_by_fandom.zip"
        if fandom and len(fandom) == 1:
            zip_name = f"shelfsort_{_safe_folder(fandom[0])}_links.zip"
        elif category and len(category) == 1:
            zip_name = f"shelfsort_{_safe_folder(category[0])}_links.zip"
        elif any([fandom, category, relationship, author]):
            zip_name = "shelfsort_filtered_links.zip"
        return Response(
            content=payload,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_name}"',
                "Content-Length": str(len(payload)),
            },
        )

    # TXT format — combined single file (default, backward-compatible)
    scope = "your library"
    if fandom and len(fandom) == 1:
        scope = f"the {fandom[0]} shelf"
    elif category and len(category) == 1:
        scope = f"the {category[0]} shelf"
    elif any([fandom, category, relationship, author]):
        scope = "the filtered selection"

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
    if fandom and len(fandom) == 1:
        fname = f"shelfsort_{_safe_folder(fandom[0])}_links.txt"
    elif category and len(category) == 1:
        fname = f"shelfsort_{_safe_folder(category[0])}_links.txt"
    elif any([fandom, category, relationship, author]):
        fname = "shelfsort_filtered_links.txt"
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
            "fandom": _canonicalize_fandom(classification.get('fandom')),
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
        update["fandom"] = _canonicalize_fandom(body.fandom) if body.fandom else None
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
            set_common["fandom"] = _canonicalize_fandom(body.fandom.strip())
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
    if book is None:
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


@api_router.get("/fandoms")
async def list_fandoms(user: User = Depends(get_current_user)):
    """Distinct fandoms in the user's library with book counts.

    Used by the Download page so all fandoms appear (not just the top 8 that
    /stats/overview returns for the dashboard). Each row is annotated with
    `is_crossover` + `parts` so the UI can render the crossover treatment
    without re-parsing strings.
    """
    pipeline = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)
    fandoms: List[Dict[str, Any]] = []
    crossover_count = 0
    for r in rows:
        name = r.get("_id")
        if not name or not str(name).strip():
            continue
        parts = [p.strip() for p in str(name).split(" / ") if p.strip()]
        is_x = len(parts) >= 2
        if is_x:
            crossover_count += 1
        fandoms.append({
            "name": name,
            "count": r["count"],
            "is_crossover": is_x,
            "parts": parts if is_x else [],
        })
    return {"fandoms": fandoms, "crossover_count": crossover_count}


# ============================================================
# COMPLETION-STATUS SHELVES (complete / ongoing)
# Detection runs once at upload time and persists to `books.status`.
# User overrides land in `books.manual_status`; `effective_status()`
# picks the override when set. Counts on the dashboard come from
# `/library/status-counts` so the chips render before either shelf
# is opened.
# ============================================================
def _status_query(user_id: str, target: str) -> Dict[str, Any]:
    """Mongo query matching books whose EFFECTIVE status equals `target`.

    "Effective" = manual_status if set, else status, else "complete"
    (the default for unknown/old books per user choice 3b).
    """
    if target == STATUS_COMPLETE:
        # Book is complete when:
        #   manual_status == complete
        #   OR (manual_status not set AND status != ongoing)
        #     — the "!= ongoing" covers default-to-complete behaviour.
        return {
            "user_id": user_id,
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"manual_status": STATUS_COMPLETE},
                {"$and": [
                    {"manual_status": {"$nin": [STATUS_ONGOING]}},
                    {"status": {"$ne": STATUS_ONGOING}},
                ]},
            ],
        }
    # target == ongoing — explicit hit on either field.
    return {
        "user_id": user_id,
        "category": {"$ne": TRASH_SHELF},
        "$or": [
            {"manual_status": STATUS_ONGOING},
            {"$and": [
                {"manual_status": {"$nin": [STATUS_COMPLETE]}},
                {"status": STATUS_ONGOING},
            ]},
        ],
    }


@api_router.get("/library/status-counts")
async def get_status_counts(user: User = Depends(get_current_user)):
    """Tiny endpoint the dashboard polls to size the complete/ongoing
    chips before either shelf is opened. Trashed books are excluded."""
    complete_n = await db.books.count_documents(_status_query(user.user_id, STATUS_COMPLETE))
    ongoing_n = await db.books.count_documents(_status_query(user.user_id, STATUS_ONGOING))
    return {"complete": complete_n, "ongoing": ongoing_n}


async def _list_status_shelf(user_id: str, target: str) -> Dict[str, Any]:
    cursor = db.books.find(
        _status_query(user_id, target),
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "size_bytes": 1,
            "relationships": 1, "tags": 1, "series_name": 1, "series_index": 1,
            "source_url": 1, "fanfic_urls": 1, "links_count": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    # Annotate each row with the effective status + an `is_manual` flag so
    # the UI can show a small "Manually set" indicator on overrides.
    by_category: Dict[str, int] = {}
    for b in books:
        b["effective_status"] = effective_status(b)
        b["is_manual_status"] = bool(b.get("manual_status"))
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "books": books,
        "count": len(books),
        "by_category": by_category,
        "status": target,
    }


@api_router.get("/library/complete")
async def get_complete_library(user: User = Depends(get_current_user)):
    """Every active book whose effective status is `complete`. Includes
    Originals + any book without a detected ongoing signal (user chose
    default-to-complete in scoping question 3)."""
    return await _list_status_shelf(user.user_id, STATUS_COMPLETE)


@api_router.get("/library/ongoing")
async def get_ongoing_library(user: User = Depends(get_current_user)):
    """Every active book whose effective status is `ongoing` —
    explicitly marked WIP/in-progress/hiatus/abandoned/etc."""
    return await _list_status_shelf(user.user_id, STATUS_ONGOING)


class SetStatusBody(BaseModel):
    """Body for `PATCH /books/{book_id}/status`. `status=None` clears the
    manual override and falls back to the auto-detected value."""
    status: Optional[str] = None


@api_router.patch("/books/{book_id}/status")
async def set_book_status(
    book_id: str,
    body: SetStatusBody,
    user: User = Depends(get_current_user),
):
    """Override the auto-detected completion status for a single book.

    Persists to `manual_status` so a future re-detection (or refresh)
    can't blow the user's override away — choice 4b. Passing `status:
    null` clears the override and reverts to the auto-detected value.

    Accepts only `"complete"` / `"ongoing"` / `null`.
    """
    raw = (body.status or "").strip().lower()
    if raw and raw not in (STATUS_COMPLETE, STATUS_ONGOING):
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {STATUS_COMPLETE}, {STATUS_ONGOING}, null",
        )
    update = (
        {"$set": {"manual_status": raw}}
        if raw else
        {"$unset": {"manual_status": ""}}
    )
    res = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        update,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Book not found")
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "status": 1, "manual_status": 1},
    )
    return {
        "ok": True,
        "book_id": book_id,
        "status": book.get("status"),
        "manual_status": book.get("manual_status"),
        "effective_status": effective_status(book),
    }


# ============================================================
# AUTHOR SHELVES — directory + per-author book listing
# ============================================================
@api_router.get("/library/authors")
async def list_authors_directory(user: User = Depends(get_current_user)):
    """Return every distinct author in the user's library with a book
    count, sorted by count DESC then alphabetically. Excludes trash.

    Used by the Authors directory page and for autocomplete on tag/
    bulk-edit forms in the future.
    """
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "author": {"$nin": [None, "", "Unknown"]},
        }},
        {"$group": {
            "_id": "$author",
            "count": {"$sum": 1},
            "latest_at": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": 2000},
    ]
    rows = await db.books.aggregate(pipeline).to_list(2000)
    authors = [
        {"author": r["_id"], "count": r["count"], "latest_at": r.get("latest_at")}
        for r in rows
    ]
    return {"count": len(authors), "authors": authors}


@api_router.get("/library/by-author")
async def list_books_by_author(
    author: str,
    user: User = Depends(get_current_user),
):
    """Return every active book by a given author. Case-sensitive exact
    match — the listing endpoint above gives the canonical name so the
    frontend doesn't have to guess."""
    if not author or not author.strip():
        raise HTTPException(status_code=400, detail="Author is required")
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "author": author,
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "series_name": 1,
            "series_index": 1, "size_bytes": 1, "relationships": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    # Annotate effective status so the page can group finished/ongoing.
    for b in books:
        b["effective_status"] = effective_status(b)
    by_category: Dict[str, int] = {}
    for b in books:
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "author": author,
        "count": len(books),
        "books": books,
        "by_category": by_category,
    }


# ============================================================
# PAIRINGS / SHIP BROWSER — aggregates `relationships` across books
# ============================================================
@api_router.get("/library/pairings")
async def list_pairings(user: User = Depends(get_current_user)):
    """Return every canonical relationship across the user's library with
    a book count and 3 sample book titles, sorted by count DESC.

    `relationships` is already populated at upload time by the EPUB
    parser (line 185-265 of this file) and canonicalized via
    `_canonicalize_relationship`, so we can aggregate directly.
    """
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "relationships": {"$exists": True, "$ne": []},
        }},
        {"$unwind": "$relationships"},
        {"$group": {
            "_id": "$relationships",
            "count": {"$sum": 1},
            "sample_titles": {"$push": "$title"},
        }},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": 500},
    ]
    rows = await db.books.aggregate(pipeline).to_list(500)
    pairings = [
        {
            "pairing": r["_id"],
            "count": r["count"],
            # Cap samples at 3 client-side so MongoDB doesn't have to do
            # a $slice — keeps the pipeline simple and works on any version.
            "sample_titles": (r.get("sample_titles") or [])[:3],
        }
        for r in rows
    ]
    return {"count": len(pairings), "pairings": pairings}


@api_router.get("/library/by-pairing")
async def list_books_by_pairing(
    pairing: str,
    user: User = Depends(get_current_user),
):
    """Return every book whose `relationships` array contains `pairing`.
    The pairing string must be in canonical form (the listing endpoint
    above provides them)."""
    if not pairing or not pairing.strip():
        raise HTTPException(status_code=400, detail="Pairing is required")
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "relationships": pairing,
        },
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "has_cover": 1, "created_at": 1, "series_name": 1,
            "series_index": 1, "size_bytes": 1, "relationships": 1,
            "status": 1, "manual_status": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    for b in books:
        b["effective_status"] = effective_status(b)
    return {"pairing": pairing, "count": len(books), "books": books}


# ============================================================
# LIBRARY BACKUP — full export of EPUBs + metadata as a single ZIP
# ============================================================
@api_router.get("/library/backup")
async def export_library_backup(user: User = Depends(get_current_user)):
    """Stream a complete library backup as a single ZIP.

    Archive layout:
      backup-manifest.json   ← every book record + tags + smart shelves +
                               user prefs as JSON. ~2KB per book.
      epubs/<book_id>.epub   ← the actual file for every active book
                               that's still on disk.

    The streaming pattern matches `/library/download-zip` so first-byte
    latency stays low (~1s) even for 5000+ book libraries; nothing is
    buffered server-side. The output filename is namespaced with the
    current ISO date so multiple backups don't overwrite each other.

    Restore is intentionally NOT exposed here — it requires conflict
    resolution (book_id collisions, missing categories, tag merges)
    that the user should drive interactively. The manifest format is
    documented and stable so a future restore endpoint can read it.
    """
    from stream_zip import stream_zip, ZIP_64
    from stat import S_IFREG
    from datetime import datetime as _dt
    import json as _json

    # Pull everything we need from Mongo in one pass per collection so
    # the response can start streaming without 5 round-trips per book.
    books = await db.books.find(
        {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
        {"_id": 0},
    ).to_list(50000)
    smart_shelves = await db.smart_shelves.find(
        {"user_id": user.user_id}, {"_id": 0},
    ).to_list(1000)
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "session_token": 0, "password_hash": 0},
    ) or {}

    iso_today = _dt.now(timezone.utc).strftime("%Y-%m-%d")
    manifest = {
        "schema_version": 1,
        "generated_at": _dt.now(timezone.utc).isoformat(),
        "user": user_doc,
        "books": books,
        "smart_shelves": smart_shelves,
        "stats": {
            "book_count": len(books),
            "smart_shelf_count": len(smart_shelves),
        },
    }
    # `default=str` so datetime / ObjectId etc. survive serialization.
    manifest_bytes = _json.dumps(manifest, default=str, indent=2).encode("utf-8")

    modified_at = _dt.now()
    mode = S_IFREG | 0o600
    user_dir = STORAGE_DIR / user.user_id

    def _file_chunks(path: Path):
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    return
                yield chunk

    def _bytes_chunks(data: bytes):
        yield data

    def _members():
        # 1) manifest first so a curl-aborted backup still has the index
        yield (
            "backup-manifest.json",
            modified_at,
            mode,
            ZIP_64,
            _bytes_chunks(manifest_bytes),
        )
        # 2) every EPUB that still exists on disk. We skip ones whose
        #    files are missing — better partial backup than failed.
        for b in books:
            bid = b.get("book_id")
            if not bid:
                continue
            ext = (b.get("original_format") or "epub").lstrip(".")
            # Try the EPUB first (the canonical readable form), then fall
            # back to the original source file for failed-conversion books.
            for candidate in (user_dir / f"{bid}.epub", user_dir / f"{bid}.{ext}"):
                if candidate.exists():
                    yield (
                        f"epubs/{candidate.name}",
                        modified_at,
                        mode,
                        ZIP_64,
                        _file_chunks(candidate),
                    )
                    break

    download_name = f"shelfsort-backup-{iso_today}.zip"

    # Record the successful start of the backup so the reminder banner
    # quiets down. We update BEFORE returning the StreamingResponse so
    # the "I just backed up" state persists even if the user closes the
    # tab before the stream finishes — they've at least started a backup.
    now_iso = _dt.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"last_backup_at": now_iso}},
    )
    # Append to the per-user backup history (capped at 50 most recent
    # entries by a trim-on-insert below) so the user can answer "did I
    # back up before <bad date>?" from the Account page. We only store
    # metadata — never the ZIP itself.
    await db.backup_history.insert_one({
        "user_id": user.user_id,
        "started_at": now_iso,
        "book_count": len(books),
        "smart_shelf_count": len(smart_shelves),
    })
    # Trim to the 50 most recent so this collection never grows unbounded.
    # We keep deletions cheap by deleting by _id older than the 50th.
    cutoff_doc = await db.backup_history.find(
        {"user_id": user.user_id}, {"_id": 1},
    ).sort("started_at", -1).skip(49).limit(1).to_list(1)
    if cutoff_doc:
        cutoff_id = cutoff_doc[0]["_id"]
        await db.backup_history.delete_many({
            "user_id": user.user_id,
            "_id": {"$lt": cutoff_id},
        })

    return StreamingResponse(
        stream_zip(_members()),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# ============================================================
# BACKUP REMINDER — gentle nudge so the backup feature actually gets used
# ============================================================
# Thresholds picked to be helpful without nagging — a power user who
# uploads daily sees the banner every ~3 months on the cadence trigger,
# or whenever they add 100+ new books between backups. The 14-day
# dismissal grace means clicking X buys two weeks of quiet.
_BACKUP_REMIND_AFTER_DAYS = 30
_BACKUP_REMIND_AFTER_NEW_BOOKS = 100
_BACKUP_DISMISS_GRACE_DAYS = 14


def _parse_iso_to_aware(s: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 string back to a tz-aware datetime; None if empty
    or malformed (so callers don't need a try/except around every read)."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


@api_router.get("/user/backup-reminder")
async def get_backup_reminder(user: User = Depends(get_current_user)):
    """Should we show the backup reminder banner right now?

    Returns `{should_show: bool, reason: str|None, books_count, books_since_backup,
    days_since_backup, last_backup_at, dismiss_active_until}`. Reasons:
      * `never_backed_up` — user has 100+ active books but no recorded
        backup. Most common trigger for fresh installs.
      * `cadence` — 30+ days since the last backup.
      * `new_books` — 100+ books added since the last backup.
    Dismissal lasts 14 days regardless of trigger — same nudge won't
    pop right back the next day.
    """
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "last_backup_at": 1, "last_backup_dismissed_at": 1},
    ) or {}

    now = datetime.now(timezone.utc)
    last_backup = _parse_iso_to_aware(user_doc.get("last_backup_at"))
    last_dismiss = _parse_iso_to_aware(user_doc.get("last_backup_dismissed_at"))

    book_count = await db.books.count_documents(
        {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
    )

    # Compute "books added since last backup" — only useful when there's
    # been at least one backup; otherwise the count IS the trigger.
    books_since_backup = book_count
    if last_backup:
        books_since_backup = await db.books.count_documents({
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "created_at": {"$gt": last_backup.isoformat()},
        })

    days_since_backup = None
    if last_backup:
        days_since_backup = (now - last_backup).days

    # Dismissal grace check — within 14 days of clicking X, stay quiet
    # regardless of trigger.
    dismiss_active_until = None
    if last_dismiss:
        grace_end = last_dismiss + timedelta(days=_BACKUP_DISMISS_GRACE_DAYS)
        if grace_end > now:
            dismiss_active_until = grace_end.isoformat()

    should_show = False
    reason = None
    if dismiss_active_until is None:
        if last_backup is None and book_count >= _BACKUP_REMIND_AFTER_NEW_BOOKS:
            should_show, reason = True, "never_backed_up"
        elif days_since_backup is not None and days_since_backup >= _BACKUP_REMIND_AFTER_DAYS:
            should_show, reason = True, "cadence"
        elif books_since_backup >= _BACKUP_REMIND_AFTER_NEW_BOOKS:
            should_show, reason = True, "new_books"

    return {
        "should_show": should_show,
        "reason": reason,
        "book_count": book_count,
        "books_since_backup": books_since_backup,
        "days_since_backup": days_since_backup,
        "last_backup_at": (last_backup.isoformat() if last_backup else None),
        "dismiss_active_until": dismiss_active_until,
    }


@api_router.post("/user/backup-reminder/dismiss")
async def dismiss_backup_reminder(user: User = Depends(get_current_user)):
    """Quiet the banner for 14 days from now. Idempotent."""
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"last_backup_dismissed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@api_router.get("/user/backup-history")
async def get_backup_history(user: User = Depends(get_current_user)):
    """Return the user's last 50 backup runs (started_at + book/shelf
    counts), newest first. Useful for answering "did I back up before
    the great Aug 1st tag-purge incident?" without storing the ZIPs."""
    cursor = db.backup_history.find(
        {"user_id": user.user_id},
        {"_id": 0, "user_id": 0},
    ).sort("started_at", -1).limit(50)
    rows = await cursor.to_list(50)
    return {"count": len(rows), "entries": rows}


# ============================================================
# RESTORE FROM BACKUP — preview + selective apply
# ============================================================
# Restore is intentionally split into preview + apply so the user can
# tick exactly which books / smart shelves to bring back. Already-owned
# book_ids surface as `collisions` in the preview and default to OFF
# in the wizard — we never overwrite existing books silently.

def _read_backup_manifest(file_bytes: bytes) -> Dict[str, Any]:
    """Parse a backup ZIP. Returns the manifest dict; raises HTTPException
    with a helpful message on every failure path."""
    import zipfile as _zipfile
    import json as _json
    import io as _io
    try:
        zf = _zipfile.ZipFile(_io.BytesIO(file_bytes))
    except _zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="That file isn't a valid ZIP.")
    names = zf.namelist()
    if "backup-manifest.json" not in names:
        raise HTTPException(
            status_code=400,
            detail="This ZIP doesn't look like a Shelfsort backup — `backup-manifest.json` is missing.",
        )
    try:
        manifest = _json.loads(zf.read("backup-manifest.json").decode("utf-8"))
    except (UnicodeDecodeError, _json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Couldn't parse the manifest: {e}")
    if not isinstance(manifest, dict):
        raise HTTPException(status_code=400, detail="Manifest is malformed.")
    sv = manifest.get("schema_version")
    if sv != 1:
        raise HTTPException(
            status_code=400,
            detail=f"Backup schema version {sv} isn't supported by this Shelfsort. Expected: 1.",
        )
    return manifest


@api_router.post("/library/restore/preview")
async def restore_preview(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Inspect a backup ZIP without writing anything. Returns the books +
    smart shelves the ZIP contains and flags any `book_id`s already in
    the user's library so the wizard can default them to OFF."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")
    manifest = _read_backup_manifest(content)

    books = manifest.get("books") or []
    shelves = manifest.get("smart_shelves") or []
    # Existing book_ids → collision set.
    existing_ids = {
        b["book_id"]
        async for b in db.books.find(
            {"user_id": user.user_id}, {"_id": 0, "book_id": 1},
        )
        if b.get("book_id")
    }
    existing_shelf_names = {
        s["name"]
        async for s in db.smart_shelves.find(
            {"user_id": user.user_id}, {"_id": 0, "name": 1},
        )
        if s.get("name")
    }

    # Trim each preview row to UI-relevant fields so the response stays
    # small even for 5000-book backups.
    preview_books = [
        {
            "book_id": b.get("book_id"),
            "title": b.get("title") or "Untitled",
            "author": b.get("author") or "Unknown",
            "category": b.get("category"),
            "fandom": b.get("fandom"),
            "collision": b.get("book_id") in existing_ids,
        }
        for b in books if b.get("book_id")
    ]
    preview_shelves = [
        {
            "name": s.get("name"),
            "filter": s.get("filter"),
            "collision": (s.get("name") in existing_shelf_names),
        }
        for s in shelves if s.get("name")
    ]

    return {
        "schema_version": manifest.get("schema_version"),
        "generated_at": manifest.get("generated_at"),
        "books": preview_books,
        "smart_shelves": preview_shelves,
        "stats": {
            "book_count": len(preview_books),
            "collision_count": sum(1 for b in preview_books if b["collision"]),
            "smart_shelf_count": len(preview_shelves),
        },
    }


class RestoreApplyBody(BaseModel):
    """Body for `POST /library/restore/apply`. The wizard sends the
    book_ids and shelf names the user explicitly chose to restore;
    everything else stays untouched."""
    book_ids: Optional[List[str]] = None
    shelf_names: Optional[List[str]] = None
    # When true, restored books with a colliding book_id overwrite the
    # existing record. Default False — the wizard checkbox makes this
    # an explicit opt-in per row.
    overwrite_collisions: bool = False


@api_router.post("/library/restore/apply")
async def restore_apply(
    file: UploadFile = File(...),
    selection: str = Form("{}"),
    user: User = Depends(get_current_user),
):
    """Restore selected books + shelves from a backup ZIP into the
    current library. Files inside `epubs/` are copied to the user's
    storage dir; existing files are NOT overwritten unless
    `overwrite_collisions` is true on the selection."""
    import zipfile as _zipfile
    import io as _io
    import json as _json
    try:
        sel = RestoreApplyBody(**_json.loads(selection))
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Bad selection payload: {e}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")
    manifest = _read_backup_manifest(content)
    zf = _zipfile.ZipFile(_io.BytesIO(content))
    names = set(zf.namelist())

    chosen_books = set(sel.book_ids or [])
    chosen_shelves = set(sel.shelf_names or [])

    # Existing IDs/names for collision handling.
    existing_book_ids = set()
    async for b in db.books.find({"user_id": user.user_id}, {"_id": 0, "book_id": 1}):
        if b.get("book_id"):
            existing_book_ids.add(b["book_id"])
    existing_shelf_names = set()
    async for s in db.smart_shelves.find({"user_id": user.user_id}, {"_id": 0, "name": 1}):
        if s.get("name"):
            existing_shelf_names.add(s["name"])

    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    restored_books = 0
    skipped_books = 0
    overwritten_books = 0
    restored_files = 0
    for b in (manifest.get("books") or []):
        bid = b.get("book_id")
        if not bid or bid not in chosen_books:
            continue
        collision = bid in existing_book_ids
        if collision and not sel.overwrite_collisions:
            skipped_books += 1
            continue
        # Strip Mongo-injected fields if any.
        doc = {k: v for k, v in b.items() if not k.startswith("_")}
        doc["user_id"] = user.user_id  # always re-anchor to the importing user
        if collision:
            await db.books.replace_one(
                {"user_id": user.user_id, "book_id": bid}, doc,
            )
            overwritten_books += 1
        else:
            await db.books.insert_one(doc)
            restored_books += 1
        # Copy EPUB / original-format file if present in the zip.
        for candidate in (f"epubs/{bid}.epub", f"epubs/{bid}.{(b.get('original_format') or 'epub').lstrip('.')}"):
            if candidate in names:
                target = user_dir / candidate.split("/", 1)[1]
                if not target.exists() or sel.overwrite_collisions:
                    with open(target, "wb") as out:
                        out.write(zf.read(candidate))
                    restored_files += 1
                break

    restored_shelves = 0
    skipped_shelves = 0
    for s in (manifest.get("smart_shelves") or []):
        name = s.get("name")
        if not name or name not in chosen_shelves:
            continue
        collision = name in existing_shelf_names
        if collision and not sel.overwrite_collisions:
            skipped_shelves += 1
            continue
        doc = {k: v for k, v in s.items() if not k.startswith("_")}
        doc["user_id"] = user.user_id
        if collision:
            await db.smart_shelves.replace_one(
                {"user_id": user.user_id, "name": name}, doc,
            )
        else:
            await db.smart_shelves.insert_one(doc)
        restored_shelves += 1

    return {
        "ok": True,
        "restored_books": restored_books,
        "overwritten_books": overwritten_books,
        "skipped_books": skipped_books,
        "restored_files": restored_files,
        "restored_shelves": restored_shelves,
        "skipped_shelves": skipped_shelves,
    }


@api_router.get("/library/linkless")
async def get_linkless_library(user: User = Depends(get_current_user)):
    """Return every active book that has NO embedded fanfic URLs.

    A book counts as "linkless" when either field is empty:
      * `source_url` is null / missing / empty string
      * `fanfic_urls` is missing / empty array

    These are books we have no source-side identity for — typically
    scanned originals, hand-curated EPUBs, or imports from outside the
    supported fanfic source list. Useful when the user wants to find
    everything that wouldn't dedupe against a pasted URL list.
    """
    query = {
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "$and": [
            {"$or": [
                {"source_url": {"$exists": False}},
                {"source_url": None},
                {"source_url": ""},
            ]},
            {"$or": [
                {"fanfic_urls": {"$exists": False}},
                {"fanfic_urls": []},
            ]},
        ],
    }
    cursor = db.books.find(
        query,
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "filename": 1, "has_cover": 1, "size_bytes": 1,
            "created_at": 1, "tags": 1, "original_format": 1, "links_count": 1,
        },
    ).sort("created_at", -1)
    books = await cursor.to_list(5000)
    # Breakdown by category for the dashboard chip.
    by_category: Dict[str, int] = {}
    for b in books:
        cat = b.get("category") or "Uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "books": books,
        "count": len(books),
        "by_category": by_category,
    }


@api_router.get("/admin/unknown-sources")
async def list_unknown_sources(
    since: Optional[str] = None,
    user: User = Depends(require_admin),
):
    """Return every story-shaped URL host that's NOT on the accepted-sources
    list but has been pasted/uploaded by ANY user. Sorted by `last_seen`
    descending so newly-spotted hosts surface first.

    Used by the Shelfsort dev (the agent reviewing this codebase) to
    decide which hosts to add to `utils/url_canonical`. Returns:
      * `host` — the de-subdomain'd root host (e.g. `scribblehub.com`)
      * `hit_count` — total times we saw a URL on this host
      * `contexts` — dict of {upload|paste|claim → count}
      * `samples` — up to 5 sample full URLs (most recent)
      * `first_seen` / `last_seen`
      * `last_book_title` / `last_book_author` / `last_book_id` (upload-only)

    Optional `?since=<iso8601>` filters to hosts seen on/after the
    timestamp so the agent can poll for "what's new this session".
    Authentication is required; data is global (not per-user) because
    the accepted-list lives at the codebase level.
    """
    query: Dict[str, Any] = {}
    if since:
        try:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["last_seen"] = {"$gte": cutoff}
        except ValueError:
            pass  # silently ignore malformed cutoff
    cursor = db.unknown_sources.find(query, {"_id": 0}).sort("last_seen", -1)
    rows = await cursor.to_list(500)
    # ISO-serialize datetimes so the response is JSON-safe.
    for r in rows:
        for k in ("first_seen", "last_seen"):
            v = r.get(k)
            if isinstance(v, datetime):
                r[k] = v.isoformat()
    return {"count": len(rows), "hosts": rows}


@api_router.delete("/admin/unknown-sources/{host}")
async def dismiss_unknown_source(host: str, user: User = Depends(require_admin)):
    """Drop a host record after it's been actioned (either added to the
    accepted-sources list or confirmed-not-fanfic). Idempotent — returns
    `{ok: True, removed: 0|1}`."""
    res = await db.unknown_sources.delete_one({"host": host.lower()})
    if res.deleted_count:
        await record_admin_action(user, "unknown_source.dismiss", target=host.lower())
    return {"ok": True, "removed": res.deleted_count}


class MarkAcceptedBody(BaseModel):
    accepted: bool = True


class AddUnknownSourceBody(BaseModel):
    """Body for `POST /api/admin/unknown-sources` — manual queue add.

    The user is vouching for the URL (probably saw it on a new archive a
    friend mentioned), so we bypass the story-shape heuristic. Accepted
    sources are still skipped — no point logging a host the canonicalizer
    already knows about. `note` is a free-form comment that lives on the
    host record so the dev knows why it was queued.
    """
    url: str
    note: Optional[str] = None


@api_router.post("/admin/unknown-sources")
async def add_unknown_source_manual(
    body: AddUnknownSourceBody,
    user: User = Depends(require_admin),
):
    """Manually queue a host for review without an EPUB upload trigger.

    Returns `{ok, host, already_accepted}` — `already_accepted=True`
    means the URL canonicalizes to a known source (no record created
    because we already support it). When `host=None` the URL parsed but
    we couldn't extract a hostname (e.g. user pasted just a path).
    """
    raw = (body.url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="URL is empty")

    from utils.unknown_sources import (
        record_unknown_sources, _host_of, normalize_fanfic_url,
        classify_ao3_non_work,
    )

    # Already-accepted shortcut so the UI can tell the user "no need to
    # queue, we already support this" instead of silently doing nothing.
    if normalize_fanfic_url(raw) or classify_ao3_non_work(raw):
        return {
            "ok": True,
            "already_accepted": True,
            "host": _host_of(raw),
        }

    hosts = await record_unknown_sources(
        db, [raw], context="manual",
        user_id=user.user_id,
        note=body.note,
        skip_heuristic=True,
    )
    if not hosts:
        # Either the URL was un-parseable or had no hostname.
        raise HTTPException(
            status_code=400,
            detail="Couldn't extract a hostname from that URL — please paste a full http(s):// URL.",
        )
    return {"ok": True, "already_accepted": False, "host": hosts[0]}


@api_router.patch("/admin/unknown-sources/{host}/mark-accepted")
async def mark_unknown_source_accepted(
    host: str,
    body: MarkAcceptedBody,
    user: User = Depends(require_admin),
):
    """Flag (or un-flag) an unknown-source host as "user wants this added to
    the accepted-sources list." The flag is purely a signal for the next
    Shelfsort dev session — the host stays in `unknown_sources` until it's
    either dismissed (DELETE) or the regex is actually added to
    `utils/url_canonical.py` and the host record explicitly dismissed.

    Idempotent; returns the updated host doc.
    """
    host_norm = host.lower()
    now = datetime.now(timezone.utc)
    update = (
        {"$set": {"marked_accepted": True, "marked_accepted_at": now,
                  "marked_accepted_by": user.user_id}}
        if body.accepted else
        {"$unset": {"marked_accepted": "", "marked_accepted_at": "",
                    "marked_accepted_by": ""}}
    )
    res = await db.unknown_sources.update_one({"host": host_norm}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Host not found")
    doc = await db.unknown_sources.find_one({"host": host_norm}, {"_id": 0})
    for k in ("first_seen", "last_seen", "marked_accepted_at"):
        v = doc.get(k) if doc else None
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return {"ok": True, "host": doc}


@api_router.get("/library/unreadable")
async def get_unreadable_library(user: User = Depends(get_current_user)):
    """Return every active book that couldn't be parsed at upload time.

    Two flavors land here, both already filed by the upload pipeline:
      * `epub_unreadable=True` — EPUB zip is corrupt / can't be opened
        by ebooklib. The bytes are still on disk at `{book_id}.epub`.
      * `needs_conversion=True` — non-EPUB source (PDF/Kindle/DOCX/…)
        that Calibre's `ebook-convert` couldn't process. The original
        bytes are kept on disk at `{book_id}.{original_format}`.

    Per-book the response includes the `reason` (`corrupt_epub` or
    `failed_conversion`), the underlying parser/converter error text, and
    the `download_path` the frontend should hit — either the standard
    `/api/books/{id}/download` for corrupt EPUBs, or
    `/api/books/{id}/download-original` for failed conversions.
    """
    query = {
        "user_id": user.user_id,
        "category": {"$ne": TRASH_SHELF},
        "$or": [
            {"epub_unreadable": True},
            {"needs_conversion": True},
        ],
    }
    cursor = db.books.find(
        query,
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "filename": 1,
            "category": 1, "size_bytes": 1, "created_at": 1,
            "original_format": 1, "epub_unreadable": 1, "epub_parse_error": 1,
            "needs_conversion": 1, "conversion_error": 1,
        },
    ).sort("created_at", -1)
    raw = await cursor.to_list(5000)

    books: List[Dict[str, Any]] = []
    by_reason: Dict[str, int] = {"corrupt_epub": 0, "failed_conversion": 0}
    for b in raw:
        if b.get("epub_unreadable"):
            reason = "corrupt_epub"
            error = b.get("epub_parse_error") or "EPUB could not be opened."
            download_path = f"/books/{b['book_id']}/download"
        else:
            reason = "failed_conversion"
            error = b.get("conversion_error") or "Conversion to EPUB failed."
            download_path = f"/books/{b['book_id']}/download-original"
        by_reason[reason] += 1
        books.append({
            "book_id": b["book_id"],
            "title": b.get("title") or b.get("filename") or "Untitled",
            "author": b.get("author") or "Unknown",
            "filename": b.get("filename"),
            "original_format": b.get("original_format") or "epub",
            "size_bytes": b.get("size_bytes") or 0,
            "created_at": b.get("created_at"),
            "category": b.get("category"),
            "reason": reason,
            "error": (error or "")[:240],
            "download_path": download_path,
        })
    return {
        "books": books,
        "count": len(books),
        "by_reason": by_reason,
    }


@api_router.get("/books/{book_id}/download-original")
async def download_original_file(book_id: str, user: User = Depends(get_current_user)):
    """Serve the user's original (pre-conversion) source file.

    Used by the Unreadable shelf when an upload was a PDF/Kindle/DOCX that
    Calibre couldn't convert — the EPUB target was never written, but the
    original bytes still live at `{book_id}.{original_format}`. Falls back
    to whichever `.{format}` file actually exists on disk so this also
    works for an `Originals` book the user wants the source for.
    """
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1,
         "original_format": 1, "filename": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    ext = (book.get("original_format") or "").lstrip(".")
    user_dir = STORAGE_DIR / user.user_id
    candidate = user_dir / f"{book_id}.{ext}" if ext else None
    fp = None
    if candidate and candidate.exists():
        fp = candidate
    else:
        # Last-ditch fallback: scan the user dir for any file starting with
        # the book id. Covers the case where `original_format` was lost or
        # stored without an extension.
        for p in user_dir.glob(f"{book_id}.*"):
            if p.suffix.lower() not in (".cover", ".links.txt"):
                fp = p
                ext = p.suffix.lstrip(".")
                break
    if not fp or not fp.exists():
        raise HTTPException(status_code=404, detail="Original file missing on disk")
    download_name = _templated_filename(
        book.get("title"), book.get("author"), book_id, ext=f".{ext or 'bin'}",
    )
    return FileResponse(str(fp), filename=download_name)



class ClaimSourceUrlBody(BaseModel):
    """Body for `PATCH /books/{book_id}/source-url`.

    Accepts either field name — `url` (newer Linkless-shelf clients) or
    `source_url` (older "manual correction" clients / tests) — so we
    don't break either caller while we have just one endpoint.
    """
    url: Optional[str] = None
    source_url: Optional[str] = None


@api_router.patch("/books/{book_id}/source-url")
async def claim_source_url(
    book_id: str,
    body: ClaimSourceUrlBody,
    user: User = Depends(get_current_user),
):
    """Attach (or correct) the fanfic source URL on an existing book.

    Used by:
      * the Linkless library shelf — paste the URL the book "actually"
        came from to drop it out of `/library/linkless`;
      * the "Can't find online" flow — manually correct the URL after
        FanFicFare failed to identify it.

    The URL is normalized to canonical form (per source site) and
    written to BOTH `source_url` and `fanfic_urls` so future URL-list
    dedupe matches it. Also clears the `unavailable` / `last_fetch_error`
    flags so the next refresh tries the new URL.

    Rejects URLs that don't match any known fanfic source.
    """
    raw = (body.url or body.source_url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Source URL is empty")
    canon = _canonical_fanfic_url(raw)
    if not canon:
        # User pasted something they THOUGHT was a fanfic URL but the host
        # isn't on the accepted list. Log it for review before rejecting.
        try:
            from utils.unknown_sources import record_unknown_sources
            await record_unknown_sources(
                db, [raw], context="claim", user_id=user.user_id, book_id=book_id,
            )
        except Exception as _e:
            logger.warning("unknown_sources record failed for claim_source_url: %s", _e)
        raise HTTPException(
            status_code=400,
            detail="Not a recognized fanfic source URL. We support AO3, FFnet, FictionPress, RoyalRoad, SpaceBattles, SufficientVelocity, QQ, AFF, Potions & Snitches, and Twilighted.",
        )
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "fanfic_urls": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    existing_urls = book.get("fanfic_urls") or []
    if canon not in existing_urls:
        existing_urls = [canon, *existing_urls]
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "source_url": canon,
            "fanfic_urls": existing_urls,
            "unavailable": False,
            "last_fetch_error": None,
        }},
    )
    return {
        "ok": True,
        "book_id": book_id,
        "source_url": canon,
        "fanfic_urls": existing_urls,
    }


@api_router.get("/fandoms/{name}/crossovers")
async def list_crossovers_for_fandom(name: str, user: User = Depends(get_current_user)):
    """Every crossover fandom in the user's library that contains `name`."""
    target = name.strip()
    if not target:
        raise HTTPException(status_code=400, detail="fandom name is required")
    # Canonical form uses " / " as separator. A fandom contains `target` iff
    # the slash-split list contains it (case-insensitive).
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "fandom": {"$regex": r"\s/\s", "$options": "i"},
        }},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)
    needle = target.lower()
    out: List[Dict[str, Any]] = []
    for r in rows:
        nm = r.get("_id") or ""
        parts = [p.strip() for p in str(nm).split(" / ") if p.strip()]
        if any(p.lower() == needle for p in parts):
            out.append({"name": nm, "count": r["count"], "parts": parts})
    return {"target": target, "crossovers": out}


@api_router.get("/fandoms/grouped")
async def get_fandoms_grouped(user: User = Depends(get_current_user)):
    """Return the user's fandoms rolled up by franchise.

    For each franchise that has at least one matching fandom in the user's
    library we emit a parent row with `children: [{name, count}]`. Fandoms
    that don't belong to any franchise group are emitted as leaf rows at
    the top level. The frontend's "Group by franchise" treemap mode
    renders this directly with recharts' nested layout.
    """
    from data.fandom_franchises import FRANCHISE_GROUPS, franchise_for  # noqa: WPS433

    pipeline = [
        {"$match": {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$match": {"_id": {"$nin": [None, ""]}}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)

    # Bucket each fandom under its franchise, or keep standalone.
    franchise_buckets: Dict[str, List[Dict[str, Any]]] = {}
    standalone: List[Dict[str, Any]] = []
    for r in rows:
        nm = r["_id"]
        parent = franchise_for(nm)
        if parent and parent != nm:
            franchise_buckets.setdefault(parent, []).append({"name": nm, "count": r["count"]})
        else:
            standalone.append({"name": nm, "count": r["count"]})

    out: List[Dict[str, Any]] = []
    for franchise, members in franchise_buckets.items():
        # Single-member buckets aren't really "groups" — bubble the member
        # back up to the top level so the treemap doesn't waste a parent
        # cell on it.
        if len(members) == 1:
            out.append(members[0])
            continue
        members.sort(key=lambda m: m["count"], reverse=True)
        out.append({
            "name": franchise,
            "count": sum(m["count"] for m in members),
            "children": members,
        })
    out.extend(standalone)
    out.sort(key=lambda r: r["count"], reverse=True)
    return {"fandoms": out, "franchise_count": sum(1 for r in out if r.get("children"))}



@api_router.get("/user/fandom-aliases")
async def get_fandom_aliases(user: User = Depends(get_current_user)):
    """Manual fandom aliases (e.g. {'HP': 'Harry Potter'}). These are applied
    during canonicalization so books tagged with the abbreviation file
    alongside the full name."""
    udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    return {"aliases": udoc.get("fandom_aliases") or {}}


class FandomAliasBody(BaseModel):
    aliases: Dict[str, str]


@api_router.put("/user/fandom-aliases")
async def update_fandom_aliases(body: FandomAliasBody, user: User = Depends(get_current_user)):
    """Replace the user's alias map. Empty keys/values are dropped silently."""
    cleaned: Dict[str, str] = {}
    for k, v in (body.aliases or {}).items():
        ks = (k or "").strip()
        vs = (v or "").strip()
        if not ks or not vs or ks.lower() == vs.lower():
            continue
        cleaned[ks] = vs
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"fandom_aliases": cleaned}},
        upsert=True,
    )
    return {"aliases": cleaned}



@api_router.post("/fandoms/canonicalize-crossovers")
async def canonicalize_crossover_fandoms(user: User = Depends(get_current_user)):
    """Walk every book in the user's library and rewrite any crossover
    fandom strings (e.g. "Twilight & Harry Potter", "Harry Potter/Twilight")
    into the canonical alphabetical form "Harry Potter / Twilight" so they
    file together. Also applies the user's manual fandom aliases. Returns a
    per-mapping report.
    """
    udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    aliases = udoc.get("fandom_aliases") or {}
    books = await db.books.find(
        {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}},
        {"_id": 0, "book_id": 1, "fandom": 1},
    ).to_list(20000)
    mapping: Dict[str, str] = {}
    updated = 0
    for b in books:
        old = b.get("fandom")
        if not old:
            continue
        new = _canonicalize_fandom(old, aliases)
        if new and new != old:
            await db.books.update_one(
                {"user_id": user.user_id, "book_id": b["book_id"]},
                {"$set": {"fandom": new}},
            )
            mapping.setdefault(old, new)
            updated += 1
    return {
        "scanned": len(books),
        "updated": updated,
        "mappings": [{"from": k, "to": v} for k, v in mapping.items()],
    }




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
        update['fandom'] = _canonicalize_fandom(body.fandom) if body.fandom else None
    await db.books.update_one({"book_id": book_id, "user_id": user.user_id}, {"$set": update})
    return {"ok": True}


def _safe_folder(name: str) -> str:
    name = re.sub(r'[^\w\s-]', '', name or 'Uncategorized').strip()
    name = re.sub(r'\s+', '_', name)
    return name or 'Uncategorized'


@api_router.get("/books/export/zip")
async def export_zip(
    request: Request,
    category: Optional[List[str]] = Query(None),
    fandom: Optional[List[str]] = Query(None),
    relationship: Optional[List[str]] = Query(None),
    author: Optional[List[str]] = Query(None),
    user: User = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = {"$in": category} if len(category) > 1 else category[0]
    if fandom:
        query["fandom"] = {"$in": fandom} if len(fandom) > 1 else fandom[0]
    if relationship:
        # Match books listing ANY of the chosen pairings.
        query["relationships"] = {"$in": relationship} if len(relationship) > 1 else relationship[0]
    if author:
        query["author"] = {"$in": author} if len(author) > 1 else author[0]
    books = await db.books.find(query, {"_id": 0}).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    # True streaming zip: bytes start flowing to the client within ~1 second,
    # even for libraries with thousands of books. We don't pre-build a temp
    # file — the archive is generated and shipped on the fly via stream-zip,
    # which means no proxy can time out waiting for the first byte.
    from stream_zip import stream_zip, ZIP_64
    from stat import S_IFREG
    from datetime import datetime as _dt

    modified_at = _dt.now()
    mode = S_IFREG | 0o600

    def _file_chunks(path: Path):
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    return
                yield chunk

    def _bytes_chunks(data: bytes):
        yield data

    # Pre-bucket books by folder path so we can sort within each folder and
    # emit a clean README. Fanfiction is grouped Fanfiction/<Fandom>/<Pairing>/,
    # with books that have no pairing landing in Fanfiction/<Fandom>/_No_pairing/.
    # Books with multiple relationships file under their FIRST one (alphabetical),
    # which matches how the dashboard relationship chips already work.
    def _folder_for(b: Dict[str, Any]) -> str:
        cat = _safe_folder(b.get('category') or 'Uncategorized')
        fnd = b.get('fandom')
        if cat == 'Fanfiction' and fnd:
            rels = b.get('relationships') or []
            if rels:
                rel = sorted([r for r in rels if r])[0]
                return f"Fanfiction/{_safe_folder(fnd)}/{_safe_folder(rel)}"
            return f"Fanfiction/{_safe_folder(fnd)}/_No_pairing"
        if cat == 'Fanfiction':
            # Fanfic with no fandom — rare but keep it visible.
            return "Fanfiction/_Unsorted"
        return cat

    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for b in books:
        fp = STORAGE_DIR / user.user_id / f"{b['book_id']}.epub"
        if not fp.exists():
            continue
        buckets.setdefault(_folder_for(b), []).append(b)
    # Sort each bucket alphabetically by title (case-insensitive), tiebreak
    # on author then book_id so the ordering is deterministic.
    for folder in buckets:
        buckets[folder].sort(key=lambda x: (
            (x.get('title') or '').lower(),
            (x.get('author') or '').lower(),
            x.get('book_id') or '',
        ))

    # Build a friendly README that explains the layout + lists every folder
    # with a per-bucket book count. This goes in first so it's the first
    # thing the user sees when they open the zip.
    def _build_readme() -> bytes:
        now_str = _dt.utcnow().strftime('%Y-%m-%d %H:%M UTC')
        total_books = sum(len(v) for v in buckets.values())
        scope_lines: List[str] = []
        if fandom:
            scope_lines.append(f"Filter: fandom = {', '.join(fandom)}")
        if relationship:
            scope_lines.append(f"Filter: pairing = {', '.join(relationship)}")
        if author:
            scope_lines.append(f"Filter: author = {', '.join(author)}")
        if category:
            scope_lines.append(f"Filter: category = {', '.join(category)}")
        lines: List[str] = [
            "Shelfsort library export",
            f"Generated: {now_str}",
            f"Books: {total_books}",
            f"Folders: {len(buckets)}",
        ]
        if scope_lines:
            lines.append("")
            lines.extend(scope_lines)
        lines.extend([
            "",
            "Folder layout",
            "-------------",
            "Fanfiction/<Fandom>/<Pairing>/Title_by_Author-<id>.epub",
            "  — fanfic, grouped first by fandom (Harry Potter, Twilight, ...)",
            "    then by ship/pairing (Harry-Severus, Edward-Bella, ...).",
            "  — books with multiple pairings file under the first one (alphabetical).",
            "  — fanfic with no pairing landing under '_No_pairing/' in that fandom.",
            "",
            "<Category>/Title_by_Author-<id>.epub",
            "  — Original Fiction, Non-fiction, custom shelves, etc.",
            "",
            "Filenames mirror the user's preferred 'Title_by_Author-<short-id>' format.",
            "Books are sorted alphabetically by title within each folder.",
            "",
            "Also included: library_index.xlsx — one row per book with Folder,",
            "Fandom, Pairing, Title, Author, Source URL, Words. Paste-friendly",
            "for spreadsheets.",
            "",
            "Index",
            "-----",
        ])
        for folder, items in sorted(buckets.items()):
            lines.append(f"{folder}/  ({len(items)} book{'s' if len(items) != 1 else ''})")
        lines.append("")
        return ("\n".join(lines)).encode("utf-8")

    readme_bytes = _build_readme()

    # Excel index: one row per book with the columns the user asked for.
    # Built in-memory via openpyxl. Lives at the top of the zip alongside
    # the README so the user has a paste-friendly inventory.
    def _build_index_xlsx() -> bytes:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from io import BytesIO as _BIO
        wb = Workbook()
        ws = wb.active
        ws.title = "Library"
        headers = ["Folder", "Fandom", "Pairing", "Title", "Author", "Source URL", "Words"]
        ws.append(headers)
        # Header styling — matches the existing xlsx export's look.
        head_font = Font(bold=True, color="FFFFFF")
        head_fill = PatternFill("solid", fgColor="3A5A40")
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = head_font
            cell.fill = head_fill
            cell.alignment = Alignment(horizontal="left", vertical="center")
        for folder in sorted(buckets.keys()):
            for b in buckets[folder]:
                # Parse fandom + pairing from the folder path so the index
                # matches the on-disk layout exactly.
                if folder.startswith("Fanfiction/"):
                    parts = folder.split("/")
                    fnd_cell = parts[1].replace("_", " ") if len(parts) > 1 else ""
                    pair_cell = parts[2].replace("_", " ") if len(parts) > 2 else ""
                else:
                    fnd_cell = b.get("fandom") or ""
                    pair_cell = ""
                rels = b.get("relationships") or []
                if not pair_cell and rels:
                    pair_cell = sorted([r for r in rels if r])[0]
                ws.append([
                    folder,
                    fnd_cell,
                    pair_cell,
                    b.get("title") or "Untitled",
                    b.get("author") or "Unknown",
                    b.get("source_url") or "",
                    b.get("words") or "",
                ])
        # Sensible column widths + freeze + autofilter
        widths = [32, 22, 22, 38, 22, 48, 10]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        bio = _BIO()
        wb.save(bio)
        return bio.getvalue()

    index_xlsx_bytes = _build_index_xlsx()

    def _members():
        # README + Excel index first so they're visible at the top of the archive.
        yield ("README.txt", modified_at, mode, ZIP_64, _bytes_chunks(readme_bytes))
        yield ("library_index.xlsx", modified_at, mode, ZIP_64, _bytes_chunks(index_xlsx_bytes))
        for folder in sorted(buckets.keys()):
            for b in buckets[folder]:
                fp = STORAGE_DIR / user.user_id / f"{b['book_id']}.epub"
                arcname = f"{folder}/{_templated_filename(b.get('title'), b.get('author'), b['book_id'])}"
                yield (arcname, modified_at, mode, ZIP_64, _file_chunks(fp))

    # Build a friendly zip filename. For a single-value filter we use it
    # directly; multi-value filters collapse to "filtered" to keep things short.
    def _single(v): return v[0] if v and len(v) == 1 else None
    sf, sr, sa, sc = _single(fandom), _single(relationship), _single(author), _single(category)
    zip_name = "shelfsort_library.zip"
    if sf and sr:
        zip_name = f"shelfsort_{_safe_folder(sf)}_{_safe_folder(sr)}.zip"
    elif sf:
        zip_name = f"shelfsort_{_safe_folder(sf)}.zip"
    elif sr:
        zip_name = f"shelfsort_{_safe_folder(sr)}.zip"
    elif sa:
        zip_name = f"shelfsort_{_safe_folder(sa)}.zip"
    elif sc:
        zip_name = f"shelfsort_{_safe_folder(sc)}.zip"
    elif any([fandom, relationship, author, category]):
        zip_name = "shelfsort_filtered.zip"

    logger.info(
        "export-zip streaming start: user=%s books=%d", user.user_id, len(books),
    )
    # StreamingResponse with a sync generator → Starlette runs it in a thread
    # pool, so file I/O doesn't block the event loop. No Content-Length is set
    # (chunked transfer); browsers handle this fine for downloads.
    return StreamingResponse(
        stream_zip(_members()),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_name}"',
            # Tell upstreams (nginx, cloudflare) not to buffer — we want the
            # client to get bytes as fast as we produce them.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-store",
        },
    )


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
    """Pull URLs out of a `<book_id>.links.txt` sidecar.

    `format_links_txt` writes each URL with a leading ordinal (`1. http://...`)
    so we use a permissive URL regex rather than `startswith("http://")`.
    """
    if not path.exists():
        return []
    out: List[str] = []
    seen: set = set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    for m in _URL_RE.finditer(text):
        url = m.group(0).rstrip('.,);]>')
        if url not in seen:
            seen.add(url)
            out.append(url)
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



# ----------------------------------------------------------------------
# RELATIONSHIPS / PAIRINGS — first-class browsable dimension
# ----------------------------------------------------------------------

@api_router.get("/relationships")
async def list_relationships(user: User = Depends(get_current_user)):
    """Every distinct relationship across the user's library, with counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}, "relationships": {"$exists": True, "$ne": []}}},
        {"$unwind": "$relationships"},
        {"$group": {"_id": "$relationships", "count": {"$sum": 1}, "fandoms": {"$addToSet": "$fandom"}}},
        {"$sort": {"count": -1}},
    ]
    out = []
    async for r in db.books.aggregate(pipeline):
        out.append({
            "name": r["_id"],
            "count": r["count"],
            "fandoms": [f for f in (r.get("fandoms") or []) if f],
        })
    return {"relationships": out, "count": len(out)}


@api_router.post("/relationships/backfill")
async def backfill_relationships(user: User = Depends(get_current_user)):
    """Walk every book in the library and re-extract relationships from the
    EPUB metadata. Useful for libraries seeded before this feature shipped."""
    user_dir = STORAGE_DIR / user.user_id
    cursor = db.books.find(
        {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
        {"_id": 0, "book_id": 1, "description": 1, "relationships": 1},
    )
    updated = 0
    skipped = 0
    async for b in cursor:
        epub_path = user_dir / f"{b['book_id']}.epub"
        if not epub_path.exists():
            skipped += 1
            continue
        try:
            loop = asyncio.get_event_loop()
            meta = await loop.run_in_executor(None, extract_epub_metadata, epub_path)
            new_rels = meta.get("relationships") or []
            old_rels = b.get("relationships") or []
            if sorted(new_rels) != sorted(old_rels):
                await db.books.update_one(
                    {"book_id": b["book_id"], "user_id": user.user_id},
                    {"$set": {"relationships": new_rels}},
                )
                updated += 1
        except Exception as e:
            logger.warning("backfill_relationships failed for %s: %s", b.get("book_id"), e)
            skipped += 1
    return {"updated": updated, "skipped": skipped}

