"""FanFicFare + FicHub fetch and refresh flow.

Extracted from ``routes/books.py`` (Phase 6C slice 3, 2026-08-22).

Public surface (all re-exported from ``routes.books``):

  * ``FANFICFARE_USER_AGENT`` — spoofed UA (AO3 / FFN / Cloudflare
    actively block obvious scraper UAs with HTTP 403).
  * ``FanficNotFoundError`` — raised when the source itself is
    unavailable (not a transient network problem).
  * ``find_source_url`` — pick the first supported fanfic URL from an
    EPUB's link set.
  * ``extract_fanfic_urls`` — canonicalize every fanfic URL in a link
    set (used for dedup keys).
  * ``fanfic_fetch_epub`` — low-level FanFicFare EPUB generator.
  * ``fetch_fanfic_with_fallback`` — FanFicFare then, on failure and
    with the user's opt-in, FicHub.
  * ``apply_refresh`` — regenerate an existing fanfic and file the old
    copy under ``OLD_STORIES_SHELF`` with a cross-linked new copy in
    a date-stamped 'Updated stories YYYY-MM-DD' shelf.

The heavy filesystem/EPUB parsing helpers (``_write_local_and_mirror_to_r2``,
``_templated_filename``, ``extract_epub_metadata``, ``extract_urls_from_epub``,
``format_links_txt``, ``extract_chapters``, ``diff_chapters``,
``apply_template_to_epub``, ``STORAGE_DIR``) live in ``routes/books.py``
and ``utils/*``; they are imported inside :func:`apply_refresh` to avoid
a circular import with ``routes.books``.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from deps import db, logger
from utils.constants import OLD_STORIES_SHELF
from utils.duplicates import _clean_author_string, _updated_shelf_name
from utils.url_canonical import normalize_fanfic_url


# 2026-03: FanFicFare + FicHub both start hitting HTTP 403 pretty hard
# when the caller advertises a python/urllib UA.  Spoofing a recent
# Firefox works for the vast majority of AO3/FFN/RR requests we make.
FANFICFARE_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
)


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
    # Lazy imports — the following live in routes/books.py and utils/
    # sibling modules; importing them at module-import time would create
    # a circular dependency (routes.books imports this module too).
    from routes.books import (
        _write_local_and_mirror_to_r2,
        _templated_filename,
        STORAGE_DIR,
    )
    from utils.epub_metadata import (
        extract_epub_metadata,
        extract_urls_from_epub,
        format_links_txt,
    )
    from utils.epub_chapters import extract_chapters, diff_chapters
    from utils.epub_template import apply_template_to_epub

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
    await _write_local_and_mirror_to_r2(
        new_epub_path, epub_bytes, user_id, new_book_id, ".epub",
    )

    new_meta = extract_epub_metadata(new_epub_path)
    new_cover_path = user_dir / f"{new_book_id}.cover"
    if new_meta.get("cover_bytes"):
        await _write_local_and_mirror_to_r2(
            new_cover_path, new_meta["cover_bytes"], user_id, new_book_id, ".cover",
        )

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


__all__ = [
    "FANFICFARE_USER_AGENT",
    "FanficNotFoundError",
    "find_source_url",
    "extract_fanfic_urls",
    "fanfic_fetch_epub",
    "fetch_fanfic_with_fallback",
    "apply_refresh",
]
