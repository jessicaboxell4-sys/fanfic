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
    started = datetime.now(timezone.utc)
    scanned = 0
    flagged = 0
    skipped = 0
    flags: List[Dict[str, Any]] = []

    if user_dir.exists():
        for fp in user_dir.iterdir():
            if not fp.is_file():
                continue
            # Cap the per-user rescan at 500 files so a power user
            # with 5000 EPUBs doesn't pin the worker for too long.
            if scanned >= 500:
                skipped += 1
                continue
            book_id = fp.stem
            result = await asyncio.to_thread(antivirus.scan_path, fp)
            scanned += 1
            if result.get("infected"):
                flagged += 1
                sig = result.get("signature", "")
                flags.append({"book_id": book_id, "signature": sig})
                await antivirus.record_quarantine(
                    user_id=user.user_id,
                    filename=fp.name,
                    scan=result,
                    source="rescan",
                    extra={"book_id": book_id},
                )
                await db.books.update_one(
                    {"book_id": book_id, "user_id": user.user_id},
                    {"$set": {"av_status": "infected", "av_signature": sig}},
                )
            elif result.get("ok"):
                await db.books.update_one(
                    {"book_id": book_id, "user_id": user.user_id},
                    {"$set": {"av_status": "clean"}},
                )

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
        {"$set": {"ts": finished.isoformat(), "summary": summary}},
        upsert=True,
    )
    return summary
