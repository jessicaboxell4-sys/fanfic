"""Relationships / pairings + series-detection endpoints — extracted from
``routes/books.py`` in the Phase 6C-A refactor (2026-07-XX).

Routes:
    GET  /api/relationships
    POST /api/relationships/backfill
    POST /api/books/detect-series-all
    PATCH /api/books/{book_id}/series

Note: shared helpers (``TRASH_SHELF``, ``extract_epub_metadata``,
``detect_series_from_title``) still live in ``routes/books.py``.
"""
import asyncio
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router, logger, STORAGE_DIR
from models import User
from auth_dep import get_current_user

from routes.books import (
    TRASH_SHELF,
    extract_epub_metadata,
    detect_series_from_title,
)


class SetSeriesBody(BaseModel):
    series_name: Optional[str] = None
    series_index: Optional[float] = None


@api_router.post("/books/detect-series-all")
async def detect_series_all(user: User = Depends(get_current_user)):
    """Re-scan every book without a series_name and try to detect one from the title."""
    books = await db.books.find(
        {"user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "series_name": 1},
    ).to_list(length=None)
    user_dir = STORAGE_DIR / user.user_id
    found = 0
    for b in books:
        if b.get("series_name"):
            continue
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


@api_router.get("/relationships")
async def list_relationships(user: User = Depends(get_current_user)):
    """Every distinct relationship across the user's library, with counts."""
    pipeline = [
        {"$match": {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}, "relationships": {"$exists": True, "$ne": []}}},
        {"$unwind": "$relationships"},
        {"$group": {"_id": "$relationships", "count": {"$sum": 1}, "fandoms": {"$addToSet": "$fandom"}}},
        # count desc, then canonical pairing name asc — gives a stable
        # ordering on ties instead of relying on MongoDB's insertion
        # order (which would shuffle as books get uploaded/deleted).
        {"$sort": {"count": -1, "_id": 1}},
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
            from utils.storage_hydration import hydrate_epub_if_missing
            await hydrate_epub_if_missing(user.user_id, b['book_id'])
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
