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


# ============================================================
# FICHUB REFRESH — pull latest version of a fanfic from its source URL
# ============================================================
FICHUB_SOURCE_PATTERNS = [
    r'https?://(?:www\.)?archiveofourown\.org/works/\d+',
    r'https?://(?:www\.)?fanfiction\.net/s/\d+',
    r'https?://(?:www\.)?fictionpress\.com/s/\d+',
    r'https?://(?:www\.)?royalroad\.com/fiction/\d+',
    r'https?://(?:www\.)?spacebattles\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?sufficientvelocity\.com/threads/[\w-]+\.\d+',
    r'https?://(?:www\.)?questionablequesting\.com/threads/[\w-]+\.\d+',
]

FICHUB_USER_AGENT = "Shelfsort/0.1 (+https://github.com/shelfsort)"


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


class FicHubNotFoundError(Exception):
    """FicHub couldn't generate an EPUB for this URL — mark the book as unavailable."""
    pass


def find_source_url(links: List[Dict[str, str]]) -> Optional[str]:
    """Return the first URL in the list that points to a supported fanfic source."""
    for item in links:
        url = (item.get('url') or '').strip()
        for pat in FICHUB_SOURCE_PATTERNS:
            m = re.search(pat, url, re.IGNORECASE)
            if m:
                return m.group(0)
    return None


async def fichub_fetch_epub(source_url: str) -> tuple:
    """Call FicHub and download the resulting EPUB.

    Returns (epub_bytes, fichub_meta_dict). Raises HTTPException on failure.
    """
    loop = asyncio.get_event_loop()
    # FICHUB_BASE_URL lets the test suite redirect calls to a local mock server.
    base = os.environ.get("FICHUB_BASE_URL", "https://fichub.net").rstrip("/")

    def _meta_call():
        r = http_requests.get(
            f"{base}/api/v0/epub",
            params={"q": source_url},
            headers={"User-Agent": FICHUB_USER_AGENT, "Accept": "application/json"},
            timeout=90,
        )
        r.raise_for_status()
        return r.json()

    try:
        data = await loop.run_in_executor(None, _meta_call)
    except Exception as e:
        logger.error(f"FicHub meta failed: {e}")
        raise HTTPException(status_code=502, detail=f"FicHub error: {e}")

    if data.get("err", 0) != 0:
        err_code = data.get("err")
        msg = data.get("info") or data.get("msg") or "couldn't generate EPUB"
        # err -9 is FicHub's generic "couldn't fetch this story" code — treat as not-found.
        # Any non-zero err is also treated as unavailable so we stop hammering FicHub.
        detail = "FicHub couldn't find this story" if err_code in (-9, -1) else f"FicHub: {msg}"
        raise FicHubNotFoundError(detail)

    urls = data.get("urls") or {}
    epub_href = urls.get("epub") or data.get("epub_url")
    if not epub_href:
        raise HTTPException(status_code=502, detail="FicHub returned no EPUB URL")
    if epub_href.startswith("/"):
        epub_href = f"{base}{epub_href}"

    def _epub_call():
        r = http_requests.get(
            epub_href,
            headers={"User-Agent": FICHUB_USER_AGENT},
            timeout=180,
        )
        r.raise_for_status()
        return r.content

    try:
        epub_bytes = await loop.run_in_executor(None, _epub_call)
    except Exception as e:
        logger.error(f"FicHub download failed: {e}")
        raise HTTPException(status_code=502, detail=f"FicHub download failed: {e}")

    fichub_meta = {
        "chapters": data.get("meta", {}).get("chapters"),
        "updated": data.get("meta", {}).get("rawExtendedMeta", {}).get("dateUpdated")
                   or data.get("meta", {}).get("updated"),
        "words": data.get("meta", {}).get("rawExtendedMeta", {}).get("words"),
        "status": data.get("meta", {}).get("rawExtendedMeta", {}).get("status"),
    }
    return epub_bytes, fichub_meta


async def apply_refresh(book: Dict[str, Any], user_id: str, source_url: str) -> Dict[str, Any]:
    """Download from FicHub, replace local EPUB + cover + links, update DB. Returns updated fields."""
    epub_bytes, fichub_meta = await fichub_fetch_epub(source_url)

    user_dir = STORAGE_DIR / user_id
    epub_path = user_dir / f"{book['book_id']}.epub"
    epub_path.write_bytes(epub_bytes)

    new_meta = extract_epub_metadata(epub_path)
    cover_path = user_dir / f"{book['book_id']}.cover"
    if new_meta.get('cover_bytes'):
        cover_path.write_bytes(new_meta['cover_bytes'])

    links = extract_urls_from_epub(epub_path)
    (user_dir / f"{book['book_id']}.links.txt").write_text(
        format_links_txt(new_meta['title'], new_meta['author'], links),
        encoding='utf-8',
    )

    update = {
        "title": new_meta['title'],
        "author": new_meta['author'],
        "description": new_meta['description'],
        "language": new_meta['language'],
        "publisher": new_meta['publisher'],
        "has_cover": bool(new_meta.get('cover_bytes')),
        "size_bytes": len(epub_bytes),
        "links_count": len(links),
        "source_url": source_url,
        "last_refreshed_at": datetime.now(timezone.utc).isoformat(),
        "fichub_meta": fichub_meta,
    }
    await db.books.update_one(
        {"book_id": book['book_id'], "user_id": user_id},
        {"$set": update},
    )
    return update


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
        if not f.filename.lower().endswith('.epub'):
            results.append({"filename": f.filename, "error": "Not an EPUB"})
            continue

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
            "last_refreshed_at": None,
            "series_name": series_name,
            "series_index": series_index,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.books.insert_one(doc)
        results.append({k: v for k, v in doc.items() if k != '_id'})

    return {"uploaded": len(results), "books": results}


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
        query['fichub_unavailable'] = True
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
    """A plain .txt list of every book FicHub couldn't find — for manual lookup."""
    books = await db.books.find(
        {"user_id": user.user_id, "fichub_unavailable": True},
        {"_id": 0},
    ).sort("title", 1).to_list(5000)

    lines: List[str] = []
    lines.append("Shelfsort — books FicHub couldn't find online")
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
            if b.get("fichub_last_error"):
                lines.append(f"   FicHub said: {b['fichub_last_error']}")
            if b.get("fichub_last_attempt_at"):
                lines.append(f"   Last tried:  {b['fichub_last_attempt_at']}")
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
        {"_id": 0, "book_id": 1, "source_url": 1, "title": 1, "last_refreshed_at": 1, "fichub_unavailable": 1},
    ).to_list(5000)
    refreshable = sum(1 for b in books if b.get("source_url") and not b.get("fichub_unavailable"))
    unavailable = sum(1 for b in books if b.get("fichub_unavailable"))
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


@api_router.get("/books/{book_id}")
async def get_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    return book


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
    return FileResponse(str(fp), media_type="application/epub+zip", filename=book['filename'])


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


@api_router.get("/books/export/links")
async def export_all_links(
    category: Optional[str] = None,
    fandom: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Download a single .txt file with every URL across the user's library (or a filter)."""
    query: Dict[str, Any] = {"user_id": user.user_id}
    if category:
        query["category"] = category
    if fandom:
        query["fandom"] = fandom
    books = await db.books.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if not books:
        raise HTTPException(status_code=404, detail="No books")

    user_dir = STORAGE_DIR / user.user_id
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
    """Re-pull every refreshable book from FicHub. Runs serially per FicHub guidance."""
    books = await db.books.find({"user_id": user.user_id}, {"_id": 0}).to_list(5000)
    user_dir = STORAGE_DIR / user.user_id

    # Determine eligible books (have a known fanfic source URL AND not already marked unavailable)
    eligible: List[tuple] = []
    for b in books:
        if b.get("fichub_unavailable"):
            continue
        src = b.get("source_url")
        if not src:
            epub_path = user_dir / f"{b['book_id']}.epub"
            if epub_path.exists():
                src = find_source_url(extract_urls_from_epub(epub_path))
        if src:
            eligible.append((b, src))

    refreshed = 0
    failures: List[Dict[str, str]] = []
    marked_unavailable = 0
    for b, src in eligible:
        try:
            await apply_refresh(b, user.user_id, src)
            refreshed += 1
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {"fichub_unavailable": False, "fichub_last_error": None}},
            )
        except FicHubNotFoundError as e:
            await db.books.update_one(
                {"book_id": b["book_id"], "user_id": user.user_id},
                {"$set": {
                    "fichub_unavailable": True,
                    "fichub_last_error": str(e),
                    "fichub_last_attempt_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            marked_unavailable += 1
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        except HTTPException as he:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": he.detail})
        except Exception as e:
            failures.append({"book_id": b["book_id"], "title": b.get("title", ""), "error": str(e)})
        await asyncio.sleep(1.5)

    return {
        "eligible": len(eligible),
        "refreshed": refreshed,
        "marked_unavailable": marked_unavailable,
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


async def _log_activity(user_id: str, book_id: str):
    """Append today's reading activity for streak calculations."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.reading_activity.update_one(
        {"user_id": user_id, "date": today},
        {
            "$addToSet": {"book_ids": book_id},
            "$set": {"last_ts": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
    )


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
    """Re-download the latest version of this book from its FicHub-supported source."""
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
    except FicHubNotFoundError as e:
        await db.books.update_one(
            {"book_id": book_id, "user_id": user.user_id},
            {"$set": {
                "fichub_unavailable": True,
                "fichub_last_error": str(e),
                "fichub_last_attempt_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=404, detail=str(e))
    # Clear unavailable flag on success
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"fichub_unavailable": False, "fichub_last_error": None}},
    )
    return {
        "ok": True,
        "source_url": source_url,
        "title": updated["title"],
        "last_refreshed_at": updated["last_refreshed_at"],
        "fichub_meta": updated.get("fichub_meta"),
    }


class BulkIdsBody(BaseModel):
    book_ids: List[str]


class BulkMoveBody(BaseModel):
    book_ids: List[str]
    category: Optional[str] = None
    fandom: Optional[str] = None


@api_router.post("/books/bulk/delete")
async def bulk_delete(body: BulkIdsBody, user: User = Depends(get_current_user)):
    if not body.book_ids:
        return {"deleted": 0}
    user_dir = STORAGE_DIR / user.user_id
    for bid in body.book_ids:
        for ext in ['.epub', '.cover', '.links.txt']:
            p = user_dir / f"{bid}{ext}"
            if p.exists():
                p.unlink()
    result = await db.books.delete_many(
        {"book_id": {"$in": body.book_ids}, "user_id": user.user_id}
    )
    return {"deleted": result.deleted_count}


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
                arcname = f"{folder}/{b['filename']}"
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
    """Manually correct the fanfic source URL (e.g., when FicHub couldn't find it).
    Clears the unavailable flag so the next refresh will try the new URL."""
    new_url = (body.source_url or "").strip()
    if not new_url:
        raise HTTPException(status_code=400, detail="Source URL is empty")
    if not re.match(r"^https?://", new_url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Please paste a full http(s):// URL")
    # Validate it's a supported fanfic source
    matched = None
    for pat in FICHUB_SOURCE_PATTERNS:
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
            "fichub_unavailable": False,
            "fichub_last_error": None,
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
