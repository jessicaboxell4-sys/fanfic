"""Polish-my-library routes — extracted from ``routes/books.py`` in the
Phase 6C-A refactor (2026-07-XX).

Routes:
    GET  /api/books/polish/preview
    POST /api/books/polish/apply

The core helpers (``suggest_polish``, ``polishable_mongo_filter``,
``update_epub_metadata``) live in ``utils/polish.py`` and are imported
here directly. The routes stay wired to the shared ``api_router`` from
``deps`` so URLs are unchanged.
"""
from typing import Any, Dict, List, Optional

from fastapi import Depends
from pydantic import BaseModel

from deps import db, api_router, logger, STORAGE_DIR
from models import User
from auth_dep import get_current_user

from utils.polish import suggest_polish, polishable_mongo_filter
from utils.epub_metadata import update_epub_metadata


class PolishApplyItem(BaseModel):
    book_id: str
    apply_title: bool = False
    apply_author: bool = False


class PolishApplyBody(BaseModel):
    items: List[PolishApplyItem]


@api_router.get("/books/polish/preview")
async def polish_preview(
    limit: int = 200,
    user: User = Depends(get_current_user),
):
    """Scan the user's library for polishable books and return a preview.

    ``limit`` caps the number of *suggestions* returned (not the number of
    books scanned) so the UI can paginate later if needed. Default 200 is
    plenty for the typical "click through and accept" workflow.
    """
    limit = max(1, min(limit, 500))
    candidate_cursor = db.books.find(
        {"user_id": user.user_id, **polishable_mongo_filter()},
        {
            "_id": 0,
            "book_id": 1,
            "title": 1,
            "author": 1,
            "source_url": 1,
            "fandom": 1,
        },
    ).limit(limit * 3)  # over-fetch a bit; suggest_polish filters again.

    suggestions: List[Dict[str, Any]] = []
    async for b in candidate_cursor:
        s = suggest_polish(b)
        if s:
            s["fandom"] = b.get("fandom")
            suggestions.append(s)
            if len(suggestions) >= limit:
                break

    total_candidates = await db.books.count_documents(
        {"user_id": user.user_id, **polishable_mongo_filter()}
    )
    return {
        "suggestions": suggestions,
        "returned": len(suggestions),
        "candidates_scanned": total_candidates,
        "limit": limit,
    }


@api_router.post("/books/polish/apply")
async def polish_apply(
    body: PolishApplyBody,
    user: User = Depends(get_current_user),
):
    """Apply the user-accepted polish suggestions.

    For each item: re-runs ``suggest_polish`` server-side (defence in depth
    against tampered payloads), then updates DB + rewrites EPUB in place
    for whichever of title / author the caller opted in on.

    Reuses the same write path as ``PATCH /books/{book_id}`` so the EPUB
    metadata is always kept in sync with the DB.
    """
    if not body.items:
        return {"updated": 0, "skipped": 0, "details": []}

    book_ids = [it.book_id for it in body.items if (it.apply_title or it.apply_author)]
    if not book_ids:
        return {"updated": 0, "skipped": 0, "details": []}

    rows = await db.books.find(
        {"user_id": user.user_id, "book_id": {"$in": book_ids}},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "source_url": 1},
    ).to_list(length=len(book_ids))
    by_id = {r["book_id"]: r for r in rows}

    items_by_id = {it.book_id: it for it in body.items}

    updated = 0
    skipped = 0
    details: List[Dict[str, Any]] = []
    for bid in book_ids:
        row = by_id.get(bid)
        opt = items_by_id.get(bid)
        if not row or not opt:
            skipped += 1
            details.append({"book_id": bid, "ok": False, "error": "not_found"})
            continue
        sug = suggest_polish(row)
        if not sug:
            skipped += 1
            details.append({"book_id": bid, "ok": False, "error": "no_longer_polishable"})
            continue
        update: Dict[str, Any] = {}
        if opt.apply_title and sug.get("suggested_title"):
            update["title"] = sug["suggested_title"][:500]
        if opt.apply_author and sug.get("suggested_author"):
            update["author"] = sug["suggested_author"][:500]
        if not update:
            skipped += 1
            details.append({"book_id": bid, "ok": False, "error": "nothing_to_apply"})
            continue

        await db.books.update_one(
            {"book_id": bid, "user_id": user.user_id},
            {"$set": update},
        )
        # Mirror into the EPUB file if it's on disk. DB always wins —
        # an EPUB write failure here is logged but doesn't fail the request.
        fp = STORAGE_DIR / user.user_id / f"{bid}.epub"
        epub_written: Optional[bool] = None
        if fp.exists():
            result = update_epub_metadata(
                fp,
                title=update.get("title"),
                author=update.get("author"),
            )
            epub_written = bool(result.get("ok"))
            if not epub_written:
                logger.info(
                    "polish_apply: EPUB write skipped for %s — %s",
                    bid, result.get("error"),
                )
        updated += 1
        details.append({"book_id": bid, "ok": True, "epub_written": epub_written, "applied": update})

    return {"updated": updated, "skipped": skipped, "details": details}
