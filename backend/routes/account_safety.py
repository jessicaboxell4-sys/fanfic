"""User-facing antivirus dashboard ("Library safety report").

Distinct from the admin antivirus card — admins see *everyone's*
quarantine; this surface only shows the calling user their own
``av_status`` distribution and lets them re-run ClamAV across their
own files on demand.  Transparency feature: "yes, we scanned, here's
proof."
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import Depends, HTTPException

from deps import api_router, db
from models import User
from auth_dep import get_current_user
from utils import antivirus


# Local copy of the storage dir — books.py also imports this from
# config, but importing it indirectly creates a circular-ish path
# during cold starts.  Pulling from the env var matches every other
# storage-aware module in the codebase.
import os as _os
STORAGE_DIR = Path(_os.environ.get("STORAGE_DIR") or "/app/uploads")


@api_router.get("/account/safety")
async def my_safety_report(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Summary of the calling user's AV scan status across their library."""
    clean = await db.books.count_documents({"user_id": user.user_id, "av_status": "clean"})
    infected = await db.books.count_documents({"user_id": user.user_id, "av_status": "infected"})
    total = await db.books.count_documents({"user_id": user.user_id})
    unscanned = max(0, total - clean - infected)

    # Last 5 infected entries for this user — gives them concrete
    # filenames + signatures rather than just a scary counter.
    infected_list: List[Dict[str, Any]] = []
    async for r in db.av_quarantine.find(
        {"user_id": user.user_id, "infected": True}
    ).sort("ts", -1).limit(5):
        r.pop("_id", None)
        infected_list.append(r)

    # Last rescan timestamp — when the user last clicked "Rescan my library".
    last = await db.user_rescans.find_one({"user_id": user.user_id}, {"_id": 0})

    return {
        "total":            total,
        "clean":            clean,
        "infected":         infected,
        "unscanned":        unscanned,
        "av_available":     antivirus.is_available(),
        "recent_infected":  infected_list,
        "last_rescan_at":   (last or {}).get("ts"),
        "last_rescan_summary": (last or {}).get("summary"),
    }


@api_router.post("/account/safety/rescan")
async def rescan_my_library(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Re-run ClamAV across every cached file in this user's library.

    Bounded by a 10-minute hard timeout and the per-scan caps in
    ``utils.antivirus``.  We scan files that are already on local
    disk (the download path lazy-restores from cloud storage on
    demand, so the in-cache set is the realistic safety surface).
    """
    if not antivirus.is_available():
        raise HTTPException(
            status_code=503,
            detail="Antivirus is currently unavailable. Please try again in a minute.",
        )

    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    scanned = 0
    flagged = 0
    skipped = 0
    flags: List[Dict[str, Any]] = []

    # 2026-07-04 — Live progress tracking.  We need real-time progress
    # for the Polish-library page (X/Y books scanned).  Count the total
    # upfront, then update the `current_progress` field on the user's
    # rescan doc every N books so a separate GET endpoint can return
    # accurate live progress without paying per-document write costs
    # for every single book.
    total_books = await db.books.count_documents(
        {"user_id": user.user_id, "status": {"$ne": "trash"}},
    )
    total_books = min(total_books, 500)  # respect the per-scan cap below

    async def _publish_progress(scanned_so_far: int) -> None:
        await db.user_rescans.update_one(
            {"user_id": user.user_id},
            {"$set": {
                "current_progress": {
                    "scanned": scanned_so_far,
                    "total": total_books,
                    "started_at": started.isoformat(),
                    "in_progress": True,
                },
            }},
            upsert=True,
        )

    await _publish_progress(0)

    # 2026-07-04 — Smart rotation across rescans.  Previously the query
    # had no sort, so MongoDB returned books in insertion order and the
    # same first 500 always got scanned — books #501+ in a >500-book
    # library would NEVER get scanned no matter how often the user
    # polished.  Now we sort by:
    #   1. av_status ascending — "clean" sorts after "infected" and
    #      after no-field-set (treated as unscanned), so unscanned
    #      books get scanned first.
    #   2. av_scanned_at ascending — among books with the SAME status,
    #      the oldest-scanned (or never-scanned) go first.
    # Result: each scan picks the 500 books that need it most, and
    # after enough polishes every book in any library gets covered.
    #
    # We also pull cloud-only files to disk before scanning (via
    # ensure_local_cached) so the rescan covers the user's whole
    # library, not just their warm cache.
    from utils.storage_cloud import ensure_local_cached
    book_cursor = db.books.find(
        {"user_id": user.user_id, "status": {"$ne": "trash"}},
        {"_id": 0, "book_id": 1, "title": 1},
    ).sort([("av_status", 1), ("av_scanned_at", 1)]).limit(500)
    async for book in book_cursor:
        book_id = book.get("book_id")
        if not book_id:
            continue
        fp = user_dir / f"{book_id}.epub"
        if not fp.exists():
            # Pull from object storage; if that fails the book has no
            # scannable file (e.g. URL-only entry) and we skip it.
            ok = await asyncio.to_thread(ensure_local_cached, fp, user.user_id, book_id, ".epub")
            if not ok:
                skipped += 1
                # Still count skipped towards progress so the bar fills
                # smoothly even on URL-only entries.
                if (scanned + skipped) % 5 == 0:
                    await _publish_progress(scanned + skipped)
                continue
        result = await asyncio.to_thread(antivirus.scan_path, fp)
        scanned += 1
        if result.get("infected"):
            flagged += 1
            sig = result.get("signature", "")
            flags.append({"book_id": book_id, "signature": sig, "title": book.get("title", "")})
            await antivirus.record_quarantine(
                user_id=user.user_id,
                filename=fp.name,
                scan=result,
                source="rescan",
                extra={"book_id": book_id},
            )
            await db.books.update_one(
                {"book_id": book_id, "user_id": user.user_id},
                {"$set": {
                    "av_status": "infected",
                    "av_signature": sig,
                    "av_scanned_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        elif result.get("ok"):
            await db.books.update_one(
                {"book_id": book_id, "user_id": user.user_id},
                {"$set": {
                    "av_status": "clean",
                    "av_scanned_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        # Update progress every 5 books so the polling endpoint sees
        # the counter climb without writing on every single iteration.
        if (scanned + skipped) % 5 == 0:
            await _publish_progress(scanned + skipped)

    finished = datetime.now(timezone.utc)
    summary = {
        "scanned": scanned,
        "flagged": flagged,
        "skipped": skipped,
        "elapsed_s": int((finished - started).total_seconds()),
        "flags":    flags[:20],
    }
    await db.user_rescans.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "ts": finished.isoformat(),
            "summary": summary,
            # Clear the in-progress marker so polling endpoints know
            # the scan is done. We keep the final counts on the same
            # field so a poll right at completion still gets the
            # finished state.
            "current_progress": {
                "scanned": scanned + skipped,
                "total": total_books,
                "started_at": started.isoformat(),
                "in_progress": False,
                "finished_at": finished.isoformat(),
            },
        }},
        upsert=True,
    )
    return summary


@api_router.get("/account/safety/rescan-progress")
async def my_rescan_progress(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Lightweight progress endpoint polled by the Polish-library page
    while a rescan is running.  Returns the current scanned/total
    counter so the UI can show "X of Y books scanned" in real time.

    Returns ``{in_progress: false, scanned: 0, total: 0}`` when no
    scan has ever run, or when the last scan is done.
    """
    doc = await db.user_rescans.find_one({"user_id": user.user_id})
    progress = (doc or {}).get("current_progress") or {}
    return {
        "in_progress": bool(progress.get("in_progress")),
        "scanned": int(progress.get("scanned") or 0),
        "total": int(progress.get("total") or 0),
        "started_at": progress.get("started_at"),
        "finished_at": progress.get("finished_at"),
    }
