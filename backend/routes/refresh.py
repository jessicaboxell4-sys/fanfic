"""Fanfic-refresh routes + health-probe state, extracted from ``routes/books.py``
as part of the Phase 4 refactor (2026-06-14).

Routes:
    GET  /api/books/refresh-status
    POST /api/books/refresh-all
    GET  /api/fanfic/status
    POST /api/books/retry-unavailable
    POST /api/books/{book_id}/refresh

Module-level health-probe state (``_fanfic_status_cache``, ``_probe_fanfic_now``,
``_sweep_user_unavailable``) used to live in books.py.  The weekly digest
scheduler in ``routes/digest.py`` flips the source from down→up by mutating
``_fanfic_status_cache`` directly, and triggers ``_sweep_user_unavailable``
for each user on recovery — same behaviour, just sourced from this module now.

The core *helper* ``apply_refresh`` stays in ``books.py`` because ``upload_books``
also uses it; we import it back here.
"""
import os
import asyncio
import requests as http_requests
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import Depends, HTTPException

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user
from routes.books import (
    OLD_STORIES_SHELF,
    STORAGE_DIR,
    FANFICFARE_USER_AGENT,
    FanficNotFoundError,
    apply_refresh,
    extract_urls_from_epub,
    find_source_url,
)


# ============================================================
# FANFIC STATUS PROBE (cached)
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


# ============================================================
# Routes
# ============================================================

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
