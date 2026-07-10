"""Conversion routes — non-EPUB → EPUB via Calibre's ``ebook-convert``.

Extracted from ``routes.books`` on 2026-06-13 (Phase 3a). Contains:

* The user-facing ``/api/conversions/*`` endpoints that track per-job
  status, dismiss completed jobs, and retry failed ones.
* The Originals-shelf endpoints (``/api/library/originals``,
  ``/api/library/originals/convert-all``) plus the internal
  ``convert_original_to_epub`` helper that backs the bulk-convert.

The Calibre executor (``convert_to_epub``) and the persistent job
tracking helpers (``_conversion_start`` / ``_conversion_end`` / TTL
index) intentionally stay in ``routes.books`` because the upload
endpoint also uses them — we import what we need rather than move the
helpers and pull a chain of upload-pipeline imports along with them.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import Depends, HTTPException

from auth_dep import get_current_user
from deps import api_router, db, logger, STORAGE_DIR
from models import User


# ----- /conversions/* --------------------------------------------------------

@api_router.get("/conversions/status")
async def conversions_status(user: User = Depends(get_current_user)):
    """Return the user's conversion-job history within the visibility
    window (default 4 hours after completion). Includes both
    in-progress and recently completed/failed jobs."""
    from routes.books import _ensure_conversion_index, CONVERSION_VISIBILITY_HOURS
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
    """Hide all completed/failed conversion jobs immediately (the chip
    will only show in-progress jobs after this). In-progress jobs are
    untouched."""
    result = await db.conversion_jobs.delete_many({
        "user_id": user.user_id,
        "status": {"$in": ["done", "failed"]},
    })
    return {"dismissed": result.deleted_count}


@api_router.post("/conversions/retry-all")
async def retry_all_failed_conversions(user: User = Depends(get_current_user)):
    """Re-run every failed conversion in the visibility window. Returns
    a per-job summary so the UI can show how many recovered vs are
    still failing."""
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

    Looks up the failed job, finds the source file on disk (still kept
    after failure), runs ``ebook-convert`` again, and on success
    extracts metadata + re-classifies the book so it lands on the right
    shelf and is openable in the Reader. The job record is updated in
    place (no new row).
    """
    from routes.books import (
        convert_to_epub, _conversion_end,
        extract_epub_metadata, classify_book,
        extract_urls_from_epub, find_source_url, extract_fanfic_urls,
    )

    job = await db.conversion_jobs.find_one({"id": job_id, "user_id": user.user_id})
    if not job:
        raise HTTPException(status_code=404, detail="Conversion job not found")
    if job.get("status") not in ("failed", "done"):
        raise HTTPException(status_code=400, detail="Job is still in progress")

    book_id = job.get("book_id")
    ext = "." + (job.get("original_format") or "")
    user_dir = STORAGE_DIR / user.user_id
    src_path = user_dir / f"{book_id}{ext}"
    # 2026-06-21 R2 migration fix: post-migration, original-format files
    # (PDF/MOBI/AZW) live in R2 alongside their converted EPUBs.  Without
    # this restore, retrying a failed conversion always 404'd "Original
    # source file is no longer on disk" — making the conversion-retry
    # feature unusable in prod.
    from utils.storage_cloud import ensure_local_cached
    import asyncio as _asyncio
    ok = await _asyncio.to_thread(
        ensure_local_cached, src_path, user.user_id, book_id, ext,
    )
    if not ok:
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


# ----- /library/originals/* --------------------------------------------------

@api_router.get("/library/originals")
async def list_originals(user: User = Depends(get_current_user)):
    """Books the user chose to keep as their original (non-EPUB) format —
    PDFs, MOBI/AZW, DOCX, etc. that were NOT routed through Calibre.
    They live on their own page so the EPUB library stays clean."""
    books = await db.books.find(
        {"user_id": user.user_id, "original_only": True},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)
    return {"count": len(books), "books": books}


@api_router.post("/library/originals/convert-all")
async def convert_all_originals(
    skip_dups: bool = False,
    user: User = Depends(get_current_user),
):
    """Bulk-convert every original-only book to EPUB. With ``skip_dups=true``
    we skip files whose ``cross_format_duplicate_of`` is non-empty —
    useful when the user already has the same book as an EPUB."""
    query: Dict[str, Any] = {"user_id": user.user_id, "original_only": True}
    if skip_dups:
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


async def convert_original_to_epub(book_id: str, user: User) -> Dict[str, Any]:
    """Promote an original-format book (PDF/MOBI/AZW/DOCX/etc.) to a
    full EPUB by running Calibre on it. On success the book moves out
    of the Originals shelf into the regular library (classified by the
    new metadata) and becomes openable in the Reader.

    Internal helper, not exposed as a route. Called by
    ``convert_all_originals`` above.
    """
    from routes.books import (
        convert_to_epub,
        extract_epub_metadata, classify_book,
        extract_urls_from_epub, find_source_url, extract_fanfic_urls,
        _canonicalize_fandom,
    )

    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id})
    if not book or not book.get("original_only"):
        raise HTTPException(status_code=404, detail="Original-format book not found")
    ext = "." + (book.get("original_format") or "")
    user_dir = STORAGE_DIR / user.user_id
    src_path = user_dir / f"{book_id}{ext}"
    # 2026-06-21 R2 migration fix: same as the retry endpoint above —
    # the "convert this original-only book to EPUB" path needs to pull
    # the source from R2 if it's not on local disk.
    from utils.storage_cloud import ensure_local_cached
    import asyncio as _asyncio
    ok = await _asyncio.to_thread(
        ensure_local_cached, src_path, user.user_id, book_id, ext,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Source file missing on disk")
    epub_target = user_dir / f"{book_id}.epub"

    err = await convert_to_epub(src_path, epub_target)
    if err:
        return {"ok": False, "error": err}

    # Re-extract metadata + classify the freshly converted EPUB so it
    # lands on the right shelf instead of staying as a stub "Originals"
    # entry.
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
                    # Out of the Originals room — keep `original_format`
                    # as a historical hint that it came from a non-EPUB.
                    "original_only": False,
                },
            },
        )
    except Exception as e:
        return {"ok": False, "error": f"Metadata extraction failed: {e}"}

    updated = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id}, {"_id": 0},
    )
    return {"ok": True, "book": updated}
