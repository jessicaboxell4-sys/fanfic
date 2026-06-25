"""Pure-EPUB metadata helpers — Phase-6 split #2.

Extracted from ``routes/books.py`` (which is still 5,900+ lines after
the chapter-helper extraction on 2026-06-18).  These are the
file-format level helpers: read EPUB metadata, rewrite EPUB metadata
in-place, canonicalize relationships + fandoms, detect series, pull
URLs out, format the links.txt export.

Pure-ish module: depends only on stdlib + ebooklib + BeautifulSoup +
lxml + ``utils.ao3_metadata`` + ``utils.url_canonical``.  No FastAPI,
no Mongo.

``routes/books.py`` re-exports every public name so existing call
sites (tags route, fandoms route, exports, url_lists, refresh) keep
working unchanged.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

from utils.ao3_metadata import classify_subjects as _classify_subjects
from utils.url_canonical import URL_REGEX, _clean_url

logger = logging.getLogger(__name__)


# =====================================================================
# Authors
# =====================================================================

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
    s = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", s).strip()
    s = re.sub(r"^(?:by|written by|author[:\s])\s+", "", s, flags=re.IGNORECASE).strip()
    s = s.strip(" ,&;|/")
    s = re.sub(r"\s+", " ", s)
    low = s.lower()
    if low in ("anonymous", "anon", "anon.", "unknown", "unknown author",
               "n/a", "na", "various", "various authors"):
        return {"various": "Various", "various authors": "Various"}.get(low, "Unknown")
    return s


# =====================================================================
# Relationships / pairings
# =====================================================================

def _canonicalize_relationship(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    s = re.sub(r'\s*\([^)]+\)\s*$', '', s).strip()
    s = re.sub(
        r'\s*[-—]\s*(?:past|former|implied|mentioned|background|brief|one-sided|unrequited).*$',
        '', s, flags=re.IGNORECASE,
    ).strip()
    if '/' in s:
        sep = '/'
    elif ' & ' in s:
        sep = ' & '
    else:
        return None
    parts = [p.strip() for p in s.split(sep) if p.strip()]
    if len(parts) < 2:
        return None
    if any(len(p) < 2 or p.isdigit() for p in parts):
        return None
    parts.sort(key=lambda p: p.lower())
    return " / ".join(parts)


# =====================================================================
# Fandom canonicalization
# =====================================================================

_FANDOM_SPLIT_RE = re.compile(r'\s*(?:/|&|\+|,|\s+(?:x|×|and)\s+)\s*', re.IGNORECASE)


def _canonicalize_fandom(raw: Optional[str], aliases: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Normalize a fandom string. Crossovers collapse to a single canonical
    'A / B / C' form (alphabetical). Single-fandom strings are returned
    unchanged. Returns None for empty/whitespace input."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    parts = [p.strip() for p in _FANDOM_SPLIT_RE.split(s) if p and p.strip()]
    if aliases:
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
    """Return existing fandoms that look like a typo of `new_fandom`."""
    nf = (new_fandom or "").strip().lower()
    if not nf:
        return []
    candidates: List[str] = []
    nf_parts = [p.strip().lower() for p in nf.split(" / ") if p.strip()]
    nf_pool = set(nf_parts) | {nf}

    def _edit_dist(a: str, b: str) -> int:
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
        close = False
        for a in nf_pool:
            if len(a) < 4:
                continue
            for b in ex_pool:
                if len(b) < 4 or a == b:
                    continue
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


# =====================================================================
# Series detection
# =====================================================================

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


# =====================================================================
# EPUB read — full metadata extraction
# =====================================================================

NONFICTION_SIGNALS = [
    "memoir", "biography", "autobiography", "history of", "essay", "essays",
    "guide to", "how to", "handbook", "textbook", "self-help", "nonfiction",
    "non-fiction", "cookbook", "manual", "reference",
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

    if description:
        description = BeautifulSoup(description, 'html.parser').get_text(separator=' ').strip()

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

    all_subjects: List[str] = []
    try:
        for value, _attrs in (book.get_metadata('DC', 'subject') or []):
            if value:
                all_subjects.append(value.strip())
    except Exception:
        pass

    classified = _classify_subjects(all_subjects)
    rating = classified["rating"]
    warnings = classified["warnings"]
    categories = classified["categories"]
    ao3_freeform_tags = classified["tags"]

    relationships: List[str] = []
    seen_rel: set = set()

    def _add_rel(raw: str) -> None:
        canonical = _canonicalize_relationship(raw)
        if canonical and canonical not in seen_rel:
            seen_rel.add(canonical)
            relationships.append(canonical)

    for s in classified["relationships"]:
        _add_rel(s)

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
            cover_meta = book.get_metadata('OPF', 'cover')
            if cover_meta:
                cover_id = cover_meta[0][1].get('content')
                if cover_id:
                    cover_item = book.get_item_with_id(cover_id)
                    if cover_item:
                        cover_bytes = cover_item.get_content()
        if not cover_bytes:
            for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
                if 'cover' in item.get_name().lower():
                    cover_bytes = item.get_content()
                    break
    except Exception as e:
        logger.debug(f"Cover extraction failed: {e}")

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
        "rating": rating,
        "warnings": warnings,
        "categories": categories,
        "ao3_freeform_tags": ao3_freeform_tags,
        "parse_failed": False,
    }


# =====================================================================
# EPUB rewrite — in-place metadata edit
# =====================================================================

def update_epub_metadata(
    filepath: Path,
    *,
    title: Optional[str] = None,
    author: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Rewrite DC:title / DC:creator / DC:description on an EPUB in place.

    Returns ``{"ok": True}`` on success or ``{"ok": False, "error": ...}``
    if the parse / rewrite failed — callers should fall back to a
    DB-only edit.

    Only the supplied fields are touched; ``None`` means "leave alone".
    The file is overwritten atomically (.tmp → rename) so a crash
    mid-write can't corrupt the user's library.

    We edit the OPF XML directly with lxml instead of ebooklib's
    ``write_epub`` because the latter is fragile on the wild variety
    of EPUBs we ingest (AO3 / FFNet / Calibre / publisher exports all
    differ slightly).
    """
    if not filepath.exists():
        return {"ok": False, "error": "file_missing"}

    import zipfile
    from lxml import etree

    DC_NS = "http://purl.org/dc/elements/1.1/"
    OPF_NS = "http://www.idpf.org/2007/opf"
    nsmap = {"dc": DC_NS, "opf": OPF_NS}

    tmp = filepath.with_suffix(filepath.suffix + ".tmp")
    try:
        with zipfile.ZipFile(filepath, "r") as zin:
            try:
                container = zin.read("META-INF/container.xml")
            except KeyError:
                return {"ok": False, "error": "no_container_xml"}
            croot = etree.fromstring(container)
            rootfile = croot.find(
                ".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile"
            )
            if rootfile is None:
                return {"ok": False, "error": "no_rootfile"}
            opf_path = rootfile.get("full-path")
            if not opf_path:
                return {"ok": False, "error": "no_opf_path"}

            try:
                opf_bytes = zin.read(opf_path)
            except KeyError:
                return {"ok": False, "error": "opf_missing"}

            parser = etree.XMLParser(remove_blank_text=False, recover=True)
            opf = etree.fromstring(opf_bytes, parser=parser)
            metadata = opf.find("opf:metadata", nsmap)
            if metadata is None:
                metadata = opf.find("{*}metadata")
            if metadata is None:
                return {"ok": False, "error": "no_metadata_block"}

            def _replace_dc(tag: str, value: str) -> None:
                for el in metadata.findall(f"dc:{tag}", nsmap):
                    metadata.remove(el)
                new = etree.SubElement(metadata, f"{{{DC_NS}}}{tag}")
                new.text = value

            if title is not None:
                _replace_dc("title", title)
            if author is not None:
                _replace_dc("creator", author)
            if description is not None:
                _replace_dc("description", description)

            new_opf_bytes = etree.tostring(
                opf,
                xml_declaration=True,
                encoding="UTF-8",
                standalone=False,
            )

            with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
                if "mimetype" in zin.namelist():
                    info = zin.getinfo("mimetype")
                    zout.writestr(info, zin.read("mimetype"), compress_type=zipfile.ZIP_STORED)
                for name in zin.namelist():
                    if name == "mimetype":
                        continue
                    info = zin.getinfo(name)
                    if name == opf_path:
                        zout.writestr(info, new_opf_bytes)
                    else:
                        zout.writestr(info, zin.read(name))
    except Exception as e:
        logger.warning(f"EPUB in-place edit failed for {filepath}: {e}")
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return {"ok": False, "error": f"rewrite_failed: {e}"}

    try:
        tmp.replace(filepath)
    except Exception as e:
        logger.warning(f"EPUB swap failed for {filepath}: {e}")
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return {"ok": False, "error": f"swap_failed: {e}"}
    return {"ok": True}


# =====================================================================
# URL extraction + links.txt formatting
# =====================================================================

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

        plain = soup.get_text(separator=' ')
        for m in URL_REGEX.finditer(plain):
            href = _clean_url(m.group(1))
            key = href.lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": href, "anchor": ""})

        # Reconstruct canonical URLs from bare "Storyid: N" + host
        # patterns (some FanFicFare cover pages drop the full URL).
        for rec in _reconstruct_bare_story_ids(plain):
            key = rec["url"].lower()
            if key not in seen:
                seen.add(key)
                results.append({"url": rec["url"], "anchor": rec.get("anchor") or ""})

    return results


# Mapping of host-name tokens (as they appear in EPUB cover pages) →
# canonical-URL template.  Used by ``_reconstruct_bare_story_ids`` to
# turn "Storyid: 6032563 ··· FanFiction.net" into a real URL even when
# the EPUB never embeds the full link.
#
# Add entries here as new sites surface in the unknown-sources admin
# panel — the keys are matched case-insensitive, so common spellings
# are covered by a single entry.
_HOST_TOKEN_TO_TEMPLATE = (
    # FanFiction.net
    ("fanfiction.net",     "https://www.fanfiction.net/s/{id}"),
    ("fanfiction .net",    "https://www.fanfiction.net/s/{id}"),  # OCR-style spacing
    ("fanfic.net",         "https://www.fanfiction.net/s/{id}"),  # rare typo
    # Archive of Our Own
    ("archiveofourown",    "https://archiveofourown.org/works/{id}"),
    ("archive of our own", "https://archiveofourown.org/works/{id}"),
    ("ao3.org",            "https://archiveofourown.org/works/{id}"),
    # Royal Road
    ("royalroad",          "https://www.royalroad.com/fiction/{id}"),
    ("royal road",         "https://www.royalroad.com/fiction/{id}"),
    # FictionPress (FFNet's sibling — same URL shape, /s/<id>)
    ("fictionpress.com",   "https://www.fictionpress.com/s/{id}"),
    ("fictionpress",       "https://www.fictionpress.com/s/{id}"),
    # Wattpad
    ("wattpad",            "https://www.wattpad.com/story/{id}"),
    # AO3 short token kept last so longer hosts above win the match
    ("ao3",                "https://archiveofourown.org/works/{id}"),
)

# "Storyid:" patterns we've seen in the wild — FanFicFare's cover page
# prefixes the field with "Storyid:" while older Calibre exports use
# "Story ID:" or "story_id:".  Match all three (case-insensitive) and
# capture the trailing digits.
_STORYID_RE = re.compile(
    r"story\s*[_\-]?\s*id\s*[:\-]?\s*(\d+)",
    re.IGNORECASE,
)


def _reconstruct_bare_story_ids(text: str) -> List[Dict[str, str]]:
    """Find ``Storyid: 12345`` patterns paired with a nearby host name
    and reconstruct the canonical URL.

    Example input::

        Storyid: 6032563
        FanFiction.net
        Name: Absolute Promise
        Author: Bittersweet Alias

    →  ``[{"url": "https://www.fanfiction.net/s/6032563", "anchor": "Absolute Promise"}]``

    The host token must appear within 200 characters BEFORE or AFTER
    the Storyid marker — close enough to be on the same cover page,
    not so far that we accidentally match a different story's host.

    Returns an empty list when no host can be paired with the ID.
    """
    out: List[Dict[str, str]] = []
    if not text:
        return out
    low = text.lower()
    for m in _STORYID_RE.finditer(text):
        story_id = m.group(1)
        # 200-char window around the match.  Wide enough for a typical
        # "Storyid:\nHost\nName:\nAuthor:" cover page, narrow enough
        # that we don't grab a host name from a completely different
        # work later in the file.
        start = max(0, m.start() - 200)
        end   = min(len(low), m.end() + 200)
        # Find every candidate host in the window and pick the one
        # closest to the Storyid match — works correctly for compilation
        # EPUBs that list multiple stories on one page.  Ties broken by
        # the priority order in _HOST_TOKEN_TO_TEMPLATE.
        best: Optional[tuple] = None  # (distance, idx, token, template)
        for idx, (token, template) in enumerate(_HOST_TOKEN_TO_TEMPLATE):
            pos = low.find(token, start, end)
            if pos == -1:
                continue
            # Distance from the nearest edge of the Storyid match.
            dist = min(abs(pos - m.start()), abs(pos - m.end()))
            cand = (dist, idx, token, template)
            if best is None or cand < best:
                best = cand
        if best is None:
            continue
        _, _, _, template = best
        # Best-effort: grab the human-readable story name from
        # the "Name:" line that usually follows the host.
        name_match = re.search(
            r"name\s*[:\-]\s*([^\n\r]{1,200})",
            text[m.end():m.end() + 400],
            re.IGNORECASE,
        )
        anchor = (name_match.group(1).strip() if name_match else "")[:200]
        url = template.format(id=story_id)
        out.append({"url": url, "anchor": anchor})

    return out



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


__all__ = [
    "NONFICTION_SIGNALS",
    "SERIES_TITLE_PATTERNS",
    "_FANDOM_SPLIT_RE",
    "_clean_author_string",
    "_canonicalize_relationship",
    "_canonicalize_fandom",
    "_suggest_fandom_merges",
    "detect_series_from_title",
    "extract_epub_metadata",
    "update_epub_metadata",
    "extract_urls_from_epub",
    "format_links_txt",
]
