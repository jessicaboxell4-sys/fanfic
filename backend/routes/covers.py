"""``routes/covers.py`` — AI-generated cover lifecycle + community pool.

Extracted from ``routes/books.py`` 2026-06-25 (Phase 6A refactor).
Behavior-preserving split: 17 endpoints + module-level state + the
``_norm_book_key`` helper moved verbatim.  The shared
``_write_local_and_mirror_to_r2`` helper still lives in
``routes/books.py`` because it's used by the upload pipeline too;
this module imports it.

================ ENDPOINTS IN THIS FILE ================
  Personal covers
    POST   /api/books/{book_id}/preview-cover
    POST   /api/books/{book_id}/apply-cover
    GET    /api/books/{book_id}/cover-variants
    POST   /api/books/{book_id}/cover-variants/{variant_id}/activate
    DELETE /api/books/{book_id}/cover-variants/{variant_id}
  Style catalog
    GET    /api/cover-styles
    POST   /api/cover-styles/custom
    DELETE /api/cover-styles/custom/{style_id}
  Community pool
    POST   /api/books/{book_id}/cover-variants/{variant_id}/share
    GET    /api/community-covers
    POST   /api/books/{book_id}/import-community-cover/{cover_id}
    DELETE /api/community-covers/{cover_id}
    POST   /api/community-covers/{cover_id}/vote
    GET    /api/community-covers/featured
    GET    /api/community-covers/{cover_id}/lineage
  Public profile
    GET    /api/users/{username}/cover-profile
  Polish my covers (bulk discovery)
    GET    /api/books/cover-less
"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router, logger, STORAGE_DIR
from models import User
from auth_dep import get_current_user, get_current_user_or_none

from utils.cover_gen import generate_cover as _generate_cover
from utils.cover_styles import built_in_list
from utils.cover_notifications import (
    notify_vote_milestone,
    notify_import_milestone,
    notify_friends_of_new_share,
)

# Shared helper still lives in routes.books because the upload pipeline
# uses it too.  One-way import (covers → books); books does NOT import
# from covers.
from routes.books import _write_local_and_mirror_to_r2


# ---------------------------------------------------------------------
# AI cover regeneration (2026-06-17)
# ---------------------------------------------------------------------
# Two-phase flow so the user previews before committing:
#   1. POST /api/books/{book_id}/preview-cover    → returns base64 PNG
#      + a short-lived preview_id stored in memory
#   2. POST /api/books/{book_id}/apply-cover      → persists the
#      previewed image to disk + flips has_cover on the doc
# Keeping the preview in memory (vs. on disk) means a rejected
# regeneration leaves zero artifacts.


# Per-user preview cache.  Bounded to ~1 hr by storing the timestamp.
# Trimmed lazily on each apply / on backend restart.  In a multi-worker
# deploy we'd need Redis — single-worker is fine for now.
_COVER_PREVIEW_CACHE: Dict[str, Dict[str, Any]] = {}
_COVER_PREVIEW_TTL_SECONDS = 60 * 60  # 1 hour

# Per-book cap on stored cover variants.  Each variant is ~1 MB so 20
# variants × ~50 actively-iterated books = ~1 GB max disk footprint per
# heavy user.  20 is the right ceiling: enough to keep iterations + a
# handful of community-imported covers without growing unboundedly.
# Bumped from 5 → 20 on 2026-06-17.
_COVER_VARIANT_CAP = 20


class CoverPreviewBody(BaseModel):
    nudge: Optional[str] = None
    style_id: Optional[str] = None


@api_router.post("/books/{book_id}/preview-cover")
async def preview_book_cover(
    book_id: str,
    body: CoverPreviewBody,
    user: User = Depends(get_current_user),
):
    """Generate a cover image via nano-banana and return it as base64 PNG.
    Does NOT persist anything — the user must call ``apply-cover`` to
    keep it.  Holds the bytes in memory keyed by a preview_id so the
    apply step doesn't re-bill another generation."""
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
         "tags": 1, "description": 1, "summary": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Book not found")

    # Resolve style: built-in slug → prompt string, or custom user style.
    from utils.cover_styles import get_style_prompt as _get_built_in_style
    style_prompt = ""
    if body.style_id:
        style_prompt = _get_built_in_style(body.style_id)
        if not style_prompt and body.style_id.startswith("custom:"):
            custom_id = body.style_id.split(":", 1)[1]
            custom = await db.user_cover_styles.find_one(
                {"style_id": custom_id, "user_id": user.user_id},
                {"_id": 0, "prompt": 1},
            )
            if custom:
                style_prompt = custom.get("prompt", "")

    try:
        png_bytes, prompt = await _generate_cover(
            doc, nudge=body.nudge, style_prompt=style_prompt or None,
        )
    except Exception as e:  # noqa: BLE001 — surface as 502 with detail
        logger.exception("cover_gen failed for %s", book_id)
        raise HTTPException(status_code=502, detail=f"Cover generation failed: {e}")
    preview_id = uuid.uuid4().hex
    _COVER_PREVIEW_CACHE[preview_id] = {
        "book_id": book_id,
        "user_id": user.user_id,
        "png_bytes": png_bytes,
        "prompt": prompt,
        "created_at": datetime.now(timezone.utc),
    }
    # Trim expired entries opportunistically so the cache doesn't grow
    # unbounded if users abandon previews.
    now = datetime.now(timezone.utc)
    for pid, entry in list(_COVER_PREVIEW_CACHE.items()):
        if (now - entry["created_at"]).total_seconds() > _COVER_PREVIEW_TTL_SECONDS:
            _COVER_PREVIEW_CACHE.pop(pid, None)
    return {
        "preview_id": preview_id,
        "image_base64": base64.b64encode(png_bytes).decode("ascii"),
        "mime_type": "image/png",
    }


class CoverApplyBody(BaseModel):
    preview_id: str


@api_router.post("/books/{book_id}/apply-cover")
async def apply_book_cover(
    book_id: str,
    body: CoverApplyBody,
    user: User = Depends(get_current_user),
):
    """Persist the previewed cover bytes to disk + DB.  Stores up to
    ``_COVER_VARIANT_CAP`` historic variants per book so the user can
    switch back without re-paying for generation.

    Layout on disk:
        {user_dir}/{book_id}.cover             ← active cover (served)
        {user_dir}/{book_id}.cover-v-{nonce}   ← inactive variants

    Original EPUB is never touched.
    """
    entry = _COVER_PREVIEW_CACHE.get(body.preview_id)
    if not entry or entry["book_id"] != book_id or entry["user_id"] != user.user_id:
        raise HTTPException(status_code=404, detail="Preview expired or unknown")
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fetch the current variant list so we can append and FIFO-trim.
    book_doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "cover_variants": 1, "has_cover": 1},
    )
    if book_doc is None:
        raise HTTPException(status_code=404, detail="Book not found")
    variants = list(book_doc.get("cover_variants") or [])

    # 2. Mint a nonce for the new variant file.  Keeping a stable
    # filename on disk so the variant can be switched-to without
    # re-encoding.
    variant_id = uuid.uuid4().hex[:12]
    variant_filename = f"{book_id}.cover-v-{variant_id}"
    await _write_local_and_mirror_to_r2(
        user_dir / variant_filename,
        entry["png_bytes"],
        user.user_id, book_id, f".cover-v-{variant_id}",
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    # 3. Mark every existing variant as inactive, append the new one,
    # FIFO-drop the oldest if we'd exceed the cap.
    for v in variants:
        v["active"] = False
    variants.append({
        "variant_id": variant_id,
        "file": variant_filename,
        "generated_at": now_iso,
        "active": True,
        "prompt": entry.get("prompt", "")[:500],  # truncate for storage
    })
    if len(variants) > _COVER_VARIANT_CAP:
        # FIFO-drop the oldest INACTIVE variant — the active one we just
        # added is at the end so trimming from the front is safe.
        dropped = variants[: len(variants) - _COVER_VARIANT_CAP]
        variants = variants[len(variants) - _COVER_VARIANT_CAP:]
        for d in dropped:
            try:
                (user_dir / d["file"]).unlink(missing_ok=True)
            except Exception:
                logger.exception("failed to unlink dropped cover variant %s", d.get("file"))

    # 4. Refresh the active "served" file to point at the new variant
    # bytes (we just write them again — cheap, ~1 MB, avoids symlink
    # quirks on some filesystems).
    await _write_local_and_mirror_to_r2(
        user_dir / f"{book_id}.cover",
        entry["png_bytes"],
        user.user_id, book_id, ".cover",
    )

    # 5. Persist.
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "has_cover": True,
            "cover_source": "ai_generated",
            "cover_generated_at": now_iso,
            "cover_active_variant": variant_id,
            "cover_variants": variants,
        }},
    )
    _COVER_PREVIEW_CACHE.pop(body.preview_id, None)
    return {
        "ok": True,
        "book_id": book_id,
        "has_cover": True,
        "active_variant": variant_id,
        "variant_count": len(variants),
    }


@api_router.get("/books/{book_id}/cover-variants")
async def list_cover_variants(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Return every stored variant for this book + the active one's id.
    The thumbnails are base64'd inline because the page only needs them
    when the user explicitly opens the variants drawer — no need for a
    separate `/cover-variants/{id}.png` endpoint just for previews."""
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "cover_variants": 1, "cover_active_variant": 1},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Book not found")
    variants = list(doc.get("cover_variants") or [])
    active_id = doc.get("cover_active_variant")
    user_dir = STORAGE_DIR / user.user_id
    out: List[Dict[str, Any]] = []
    for v in variants:
        path = user_dir / v["file"]
        if not path.exists():
            continue  # variant file was deleted on disk — skip silently
        out.append({
            "variant_id":   v["variant_id"],
            "generated_at": v["generated_at"],
            "active":       v["variant_id"] == active_id,
            "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "mime_type":    "image/png",
        })
    return {"variants": out, "active_variant_id": active_id}


@api_router.post("/books/{book_id}/cover-variants/{variant_id}/activate")
async def activate_cover_variant(
    book_id: str,
    variant_id: str,
    user: User = Depends(get_current_user),
):
    """Switch the active cover to a previously generated variant."""
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "cover_variants": 1},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Book not found")
    variants = list(doc.get("cover_variants") or [])
    target = next((v for v in variants if v["variant_id"] == variant_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Variant not found")
    user_dir = STORAGE_DIR / user.user_id
    src = user_dir / target["file"]
    if not src.exists():
        raise HTTPException(status_code=410, detail="Variant file missing on disk")
    await _write_local_and_mirror_to_r2(
        user_dir / f"{book_id}.cover",
        src.read_bytes(),
        user.user_id, book_id, ".cover",
    )
    for v in variants:
        v["active"] = (v["variant_id"] == variant_id)
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "cover_active_variant": variant_id,
            "cover_variants": variants,
            "cover_generated_at": target["generated_at"],
        }},
    )
    return {"ok": True, "active_variant": variant_id}


@api_router.delete("/books/{book_id}/cover-variants/{variant_id}")
async def delete_cover_variant(
    book_id: str,
    variant_id: str,
    user: User = Depends(get_current_user),
):
    """Drop a stored variant.  Refuses to delete the currently active
    variant (the user must activate a different one first) so the book
    never ends up with `has_cover: True` and no file on disk."""
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "cover_variants": 1, "cover_active_variant": 1},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Book not found")
    if doc.get("cover_active_variant") == variant_id:
        raise HTTPException(status_code=400, detail="Activate another variant first")
    variants = list(doc.get("cover_variants") or [])
    target = next((v for v in variants if v["variant_id"] == variant_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Variant not found")
    user_dir = STORAGE_DIR / user.user_id
    try:
        (user_dir / target["file"]).unlink(missing_ok=True)
    except Exception:
        logger.exception("failed to delete cover variant %s", target.get("file"))
    new_variants = [v for v in variants if v["variant_id"] != variant_id]
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {"cover_variants": new_variants}},
    )
    return {"ok": True, "remaining": len(new_variants)}




# ---------------------------------------------------------------------
# Community cover pool (2026-06-17)
# ---------------------------------------------------------------------
# Opt-in sharing: a user publishes one of their variants to a public
# pool keyed by normalized (title, author, fandom).  Other users
# importing the same fic can browse and adopt without re-paying for
# AI generation.  Bytes live in /app/uploads/community_covers/{id} so
# they're decoupled from per-user storage and survive user deletion.

_COMMUNITY_COVERS_DIR = STORAGE_DIR.parent / "community_covers"
_COMMUNITY_COVERS_DIR.mkdir(parents=True, exist_ok=True)


def _norm_book_key(title: str, author: str, fandom: str) -> Dict[str, str]:
    """Normalize the book identity for community pool lookups: lower,
    strip, collapse whitespace.  Two books that match on this triple
    are treated as the same work for cover-sharing purposes."""
    def clean(s):
        return " ".join((s or "").strip().lower().split())
    return {
        "title_key":  clean(title),
        "author_key": clean(author),
        "fandom_key": clean(fandom),
    }



# ---------------------------------------------------------------------
# Cover style catalog (2026-06-17 Tier 2)
# Built-in styles ship via utils/cover_styles.py; user-defined ones
# live in the `user_cover_styles` collection.
# ---------------------------------------------------------------------


class CustomStyleBody(BaseModel):
    name: str
    prompt: str


@api_router.get("/cover-styles")
async def list_cover_styles(user: User = Depends(get_current_user)):
    """List every style available to the caller — built-in + custom.
    Custom styles return with ``id`` already prefixed ``custom:`` so the
    frontend can pass it back into ``preview-cover`` without
    transformation."""
    custom_rows = await db.user_cover_styles.find(
        {"user_id": user.user_id},
        {"_id": 0, "style_id": 1, "name": 1, "description": 1, "prompt": 1},
    ).sort("created_at", -1).to_list(length=50)
    customs = [
        {
            "id": f"custom:{r['style_id']}",
            "name": r["name"],
            "description": r.get("description") or r.get("prompt", "")[:80],
            "kind": "custom",
        }
        for r in custom_rows
    ]
    return {"styles": built_in_list() + customs}


@api_router.post("/cover-styles/custom")
async def create_custom_style(
    body: CustomStyleBody,
    user: User = Depends(get_current_user),
):
    """Save a named user-defined style.  Prompt is appended verbatim to
    the generation prompt so users can express anything they like.
    Capped at 20 customs per user so a runaway user can't bloat Mongo."""
    name = (body.name or "").strip()
    prompt = (body.prompt or "").strip()
    if not name or not prompt:
        raise HTTPException(status_code=400, detail="name and prompt are required")
    if len(prompt) > 1000:
        raise HTTPException(status_code=400, detail="prompt too long (max 1000 chars)")
    existing = await db.user_cover_styles.count_documents({"user_id": user.user_id})
    if existing >= 20:
        raise HTTPException(status_code=400, detail="Custom style cap reached (20).  Delete one first.")
    style_id = uuid.uuid4().hex[:12]
    await db.user_cover_styles.insert_one({
        "style_id":   style_id,
        "user_id":    user.user_id,
        "name":       name[:60],
        "prompt":     prompt,
        "description": prompt[:80],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "id": f"custom:{style_id}", "name": name[:60]}


@api_router.delete("/cover-styles/custom/{style_id}")
async def delete_custom_style(
    style_id: str,
    user: User = Depends(get_current_user),
):
    """Remove a saved custom style.  No effect on covers already
    generated with it — those bytes are independent."""
    r = await db.user_cover_styles.delete_one(
        {"style_id": style_id, "user_id": user.user_id},
    )
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Custom style not found")
    return {"ok": True}



@api_router.post("/books/{book_id}/cover-variants/{variant_id}/share")
async def share_cover_to_community(
    book_id: str,
    variant_id: str,
    user: User = Depends(get_current_user),
):
    """Publish a variant to the public community cover pool.  Idempotent:
    re-sharing the same variant returns the existing community_cover_id."""
    doc = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "title": 1, "author": 1, "fandom": 1, "cover_variants": 1},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Book not found")
    target = next(
        (v for v in (doc.get("cover_variants") or []) if v["variant_id"] == variant_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Variant not found")
    src = STORAGE_DIR / user.user_id / target["file"]
    if not src.exists():
        raise HTTPException(status_code=410, detail="Variant file missing on disk")

    # Dedupe on (variant_id, sharer) so re-clicking is a no-op.
    existing = await db.community_covers.find_one(
        {"source_variant_id": variant_id, "shared_by_user_id": user.user_id},
        {"_id": 0, "cover_id": 1},
    )
    if existing:
        return {"ok": True, "community_cover_id": existing["cover_id"], "deduped": True}

    cover_id = uuid.uuid4().hex[:14]
    dest = _COMMUNITY_COVERS_DIR / cover_id
    dest.write_bytes(src.read_bytes())

    # Pull the sharer's username for attribution.  Fallback to email
    # local-part if they don't have a public handle yet.
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "username": 1, "email": 1, "name": 1},
    ) or {}
    shared_by = (
        user_doc.get("username")
        or (user_doc.get("email") or "").split("@", 1)[0]
        or "anon"
    )

    keys = _norm_book_key(doc.get("title", ""), doc.get("author", ""), doc.get("fandom", ""))
    # If this variant was originally imported from another community
    # cover, remember the lineage so the remix tree is visible.
    parent_cover_id = ""
    src_tag = (target.get("source") or "") if isinstance(target, dict) else ""
    if src_tag.startswith("community:"):
        parent_cover_id = src_tag.split(":", 1)[1]
    record = {
        "cover_id": cover_id,
        **keys,
        "title":             doc.get("title", ""),
        "author":            doc.get("author", ""),
        "fandom":            doc.get("fandom", ""),
        "file":              cover_id,                       # bare filename in community_covers/
        "source_book_id":    book_id,
        "source_variant_id": variant_id,
        "parent_cover_id":   parent_cover_id,
        "shared_by_user_id": user.user_id,
        "shared_by_username": shared_by,
        "shared_at":         datetime.now(timezone.utc).isoformat(),
        "import_count":      0,
    }
    await db.community_covers.insert_one(record)
    # Fan-out to friends — single in-app ping per friend, quiet failure.
    try:
        await notify_friends_of_new_share(
            cover_id=cover_id,
            sharer_user_id=user.user_id,
            title=doc.get("title", ""),
        )
    except Exception as e:
        logger.exception("notify_friends_of_new_share fan-out errored: %s", e)
    return {"ok": True, "community_cover_id": cover_id, "shared_by": shared_by}


@api_router.get("/community-covers")
async def browse_community_covers(
    title: str,
    author: str = "",
    fandom: str = "",
    limit: int = 24,
    user: User = Depends(get_current_user),
):
    """Browse community-shared covers for a given (title, author, fandom).
    Matching is case-insensitive on title (required); author + fandom are
    refinements that narrow when supplied.  Returns thumbnails inline
    so the frontend can render a grid in one round-trip."""
    limit = max(1, min(int(limit), 60))
    keys = _norm_book_key(title, author, fandom)
    if not keys["title_key"]:
        raise HTTPException(status_code=400, detail="title query is required")
    query: Dict[str, Any] = {"title_key": keys["title_key"]}
    if keys["author_key"]:
        query["author_key"] = keys["author_key"]
    if keys["fandom_key"]:
        query["fandom_key"] = keys["fandom_key"]
    cursor = (
        db.community_covers.find(query, {"_id": 0})
        .sort([("votes", -1), ("import_count", -1), ("shared_at", -1)])
        .limit(limit)
    )
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        path = _COMMUNITY_COVERS_DIR / r["file"]
        if not path.exists():
            continue
        rows.append({
            "cover_id":     r["cover_id"],
            "shared_by":    r.get("shared_by_username", "anon"),
            "shared_at":    r.get("shared_at"),
            "import_count": int(r.get("import_count", 0)),
            "votes":        int(r.get("votes", 0)),
            "voted_by_me":  user.user_id in (r.get("voters") or []),
            "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "mime_type":    "image/png",
        })
    return {"covers": rows, "count": len(rows)}


@api_router.post("/books/{book_id}/import-community-cover/{cover_id}")
async def import_community_cover(
    book_id: str,
    cover_id: str,
    user: User = Depends(get_current_user),
):
    """Adopt a community cover as a new variant for the caller's book.
    Doesn't re-pay any LLM cost — bytes copied directly.  Increments
    the community cover's import_count for popularity sorting."""
    src = _COMMUNITY_COVERS_DIR / cover_id
    if not src.exists():
        raise HTTPException(status_code=404, detail="Community cover not found")
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "cover_variants": 1},
    )
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    variant_id = uuid.uuid4().hex[:12]
    variant_filename = f"{book_id}.cover-v-{variant_id}"
    bytes_ = src.read_bytes()
    await _write_local_and_mirror_to_r2(
        user_dir / variant_filename,
        bytes_,
        user.user_id, book_id, f".cover-v-{variant_id}",
    )
    await _write_local_and_mirror_to_r2(
        user_dir / f"{book_id}.cover",
        bytes_,
        user.user_id, book_id, ".cover",
    )
    now_iso = datetime.now(timezone.utc).isoformat()

    variants = list(book.get("cover_variants") or [])
    for v in variants:
        v["active"] = False
    variants.append({
        "variant_id":   variant_id,
        "file":         variant_filename,
        "generated_at": now_iso,
        "active":       True,
        "source":       f"community:{cover_id}",
    })
    # FIFO cap (same logic as apply-cover).
    if len(variants) > _COVER_VARIANT_CAP:
        dropped = variants[: len(variants) - _COVER_VARIANT_CAP]
        variants = variants[len(variants) - _COVER_VARIANT_CAP:]
        for d in dropped:
            try:
                (user_dir / d["file"]).unlink(missing_ok=True)
            except Exception:
                logger.exception("failed to unlink dropped variant %s", d.get("file"))

    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "has_cover": True,
            "cover_source": "community_imported",
            "cover_generated_at": now_iso,
            "cover_active_variant": variant_id,
            "cover_variants": variants,
        }},
    )
    await db.community_covers.update_one(
        {"cover_id": cover_id},
        {"$inc": {"import_count": 1}},
    )
    # Read back the new import count so we can fire a milestone ping
    # if this import crossed a 1/5/10/25 boundary.
    try:
        post = await db.community_covers.find_one(
            {"cover_id": cover_id},
            {"_id": 0, "import_count": 1},
        )
        if post:
            await notify_import_milestone(
                cover_id=cover_id,
                new_import_count=int(post.get("import_count", 0)),
            )
    except Exception as e:
        logger.exception("notify_import_milestone errored: %s", e)
    return {"ok": True, "variant_id": variant_id, "active_variant": variant_id}


@api_router.delete("/community-covers/{cover_id}")
async def unshare_community_cover(
    cover_id: str,
    user: User = Depends(get_current_user),
):
    """Remove a cover from the community pool — only the original sharer
    (or an admin / moderator) may unshare.  Doesn't touch any users who
    already imported the cover; those copies remain in their libraries."""
    record = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "shared_by_user_id": 1, "file": 1},
    )
    if not record:
        raise HTTPException(status_code=404, detail="Community cover not found")
    if (
        record["shared_by_user_id"] != user.user_id
        and not getattr(user, "is_admin", False)
        and not getattr(user, "is_moderator", False)
    ):
        raise HTTPException(status_code=403, detail="Not your cover to unshare")
    try:
        (_COMMUNITY_COVERS_DIR / record["file"]).unlink(missing_ok=True)
    except Exception:
        logger.exception("failed to unlink community cover %s", record["file"])
    await db.community_covers.delete_one({"cover_id": cover_id})
    return {"ok": True}


# ---------------------------------------------------------------------
# Community covers — voting + featured (Tier 3, 2026-06-17)
# ---------------------------------------------------------------------

@api_router.post("/community-covers/{cover_id}/vote")
async def vote_community_cover(
    cover_id: str,
    user: User = Depends(get_current_user),
):
    """Toggle the caller's heart on a community cover.  One vote per
    user — re-voting un-hearts it.  Voters are tracked in a per-cover
    list so we can show the user their current state on browse."""
    record = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "voters": 1, "votes": 1},
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Community cover not found")
    voters = set(record.get("voters") or [])
    if user.user_id in voters:
        voters.discard(user.user_id)
        action = "unvoted"
    else:
        voters.add(user.user_id)
        action = "voted"
    new_count = len(voters)
    await db.community_covers.update_one(
        {"cover_id": cover_id},
        {"$set": {"voters": list(voters), "votes": new_count}},
    )
    # Milestone notification — only fires on exact thresholds so the
    # toggle path doesn't re-fire.
    if action == "voted":
        try:
            await notify_vote_milestone(
                cover_id=cover_id,
                new_vote_count=new_count,
                voter_user_id=user.user_id,
            )
        except Exception as e:
            logger.exception("notify_vote_milestone errored: %s", e)
    return {"ok": True, "votes": new_count, "voted_by_me": action == "voted"}


@api_router.get("/community-covers/featured")
async def featured_community_covers(
    limit: int = 12,
    days: int = 7,
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Top-voted community covers across the whole pool, lifetime
    (``days=0``) or scoped to the recent ``days`` window.  Used by a
    "Featured this week" homepage strip + the dedicated discovery page.

    Each row carries a ``trending`` flag — covers that have collected
    ≥3 hearts AND were shared within the last 48 h.  These cards get a
    distinct pill on the homepage strip so high-velocity covers are
    visible even when a long-running cover holds the cumulative #1."""
    limit = max(1, min(int(limit), 60))
    days = max(0, min(int(days), 365))
    query: Dict[str, Any] = {}
    if days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        query["shared_at"] = {"$gte": cutoff}
    cursor = (
        db.community_covers.find(query, {"_id": 0})
        .sort([("votes", -1), ("import_count", -1), ("shared_at", -1)])
        .limit(limit)
    )
    trending_cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        path = _COMMUNITY_COVERS_DIR / r["file"]
        if not path.exists():
            continue
        votes = int(r.get("votes", 0))
        shared_at = r.get("shared_at") or ""
        rows.append({
            "cover_id":     r["cover_id"],
            "title":        r.get("title", ""),
            "author":       r.get("author", ""),
            "fandom":       r.get("fandom", ""),
            "shared_by":    r.get("shared_by_username", "anon"),
            "shared_by_user_id": r.get("shared_by_user_id", ""),
            "votes":        votes,
            "import_count": int(r.get("import_count", 0)),
            "voted_by_me":  bool(user) and user.user_id in (r.get("voters") or []),
            "trending":     votes >= 3 and shared_at >= trending_cutoff,
            "parent_cover_id": r.get("parent_cover_id", ""),
            "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "mime_type":    "image/png",
        })
    return {"covers": rows, "window_days": days}


# ---------------------------------------------------------------------
# Cover ecosystem Tier 4 — public profile, achievements, lineage
# (2026-06-18)
# ---------------------------------------------------------------------

@api_router.get("/users/{username}/cover-profile")
async def public_cover_profile(
    username: str,
    user: Optional[User] = Depends(get_current_user_or_none),  # noqa: ARG001 — public
):
    """Public-but-auth-gated profile page powering `/u/{username}`.
    Surfaces lifetime cover stats, the trophies the user has unlocked
    (e.g. ``top_of_week``), and a feed of their best community
    covers.  Returns 404 for unknown / username-less accounts so the
    URL doesn't leak existence of private users."""
    target = await db.users.find_one(
        {"username": username},
        {
            "_id": 0, "user_id": 1, "username": 1, "name": 1, "bio": 1,
            "cover_achievements": 1, "picture": 1, "created_at": 1,
        },
    )
    if target is None:
        raise HTTPException(status_code=404, detail="No such user")
    cursor = (
        db.community_covers.find(
            {"shared_by_user_id": target["user_id"]},
            {"_id": 0},
        )
        .sort([("votes", -1), ("import_count", -1), ("shared_at", -1)])
        .limit(48)
    )
    covers: List[Dict[str, Any]] = []
    lifetime_votes = 0
    lifetime_imports = 0
    total_shared = 0
    async for r in cursor:
        path = _COMMUNITY_COVERS_DIR / r["file"]
        if not path.exists():
            continue
        votes = int(r.get("votes", 0))
        imports = int(r.get("import_count", 0))
        lifetime_votes += votes
        lifetime_imports += imports
        total_shared += 1
        covers.append({
            "cover_id":     r["cover_id"],
            "title":        r.get("title", ""),
            "author":       r.get("author", ""),
            "fandom":       r.get("fandom", ""),
            "votes":        votes,
            "import_count": imports,
            "shared_at":    r.get("shared_at"),
            "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "mime_type":    "image/png",
        })
    achievements = target.get("cover_achievements") or []
    return {
        "username":       target.get("username"),
        "display_name":   target.get("name") or target.get("username"),
        "picture":        target.get("picture", ""),
        "bio":            (target.get("bio") or "").strip(),
        "joined_at":      target.get("created_at"),
        "covers":         covers,
        "achievements":   achievements,
        "totals": {
            "shared":  total_shared,
            "votes":   lifetime_votes,
            "imports": lifetime_imports,
        },
    }


@api_router.get("/community-covers/{cover_id}/lineage")
async def community_cover_lineage(
    cover_id: str,
    user: Optional[User] = Depends(get_current_user_or_none),  # noqa: ARG001 — public
):
    """Returns the parent (if this cover was imported + re-shared) and
    the direct children (covers downstream that name this one as
    parent).  Used by the cover-card UI to surface "Remixed from @x"
    and "Remixed 3 times" badges so the community can see lineage."""
    cur = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "cover_id": 1, "title": 1, "parent_cover_id": 1, "shared_by_username": 1},
    )
    if cur is None:
        raise HTTPException(status_code=404, detail="Community cover not found")
    parent = None
    pid = cur.get("parent_cover_id")
    if pid:
        parent = await db.community_covers.find_one(
            {"cover_id": pid},
            {"_id": 0, "cover_id": 1, "title": 1, "shared_by_username": 1},
        )
    children_cursor = db.community_covers.find(
        {"parent_cover_id": cover_id},
        {"_id": 0, "cover_id": 1, "title": 1, "shared_by_username": 1, "votes": 1},
    ).sort("shared_at", -1).limit(20)
    children = [c async for c in children_cursor]
    return {
        "cover_id": cover_id,
        "parent":   parent,
        "children": children,
        "remix_count": len(children),
    }



# ---------------------------------------------------------------------
# "Polish my covers" — list cover-less books so the frontend can run
# the existing preview-cover / apply-cover flow against each one
# without polling every book in the library client-side.
# ---------------------------------------------------------------------

@api_router.get("/books/cover-less")
async def list_cover_less_books(
    limit: int = 100,
    user: User = Depends(get_current_user),
):
    """Return books owned by the caller that don't have a cover yet.

    Result is intentionally small (id + title + author + fandom + tags)
    — the bulk page renders them as placeholder tiles and lets the user
    kick off cover generation per-book.  Cap at 200 because generating
    a cover is a paid LLM call; we don't want the UI promising "all
    300" if it'll cost the user too much.
    """
    limit = max(1, min(int(limit), 200))
    cursor = db.books.find(
        {
            "user_id": user.user_id,
            "$or": [
                {"has_cover": {"$exists": False}},
                {"has_cover": False},
                {"has_cover": None},
            ],
        },
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
         "tags": 1, "category": 1},
    ).sort("title", 1).limit(limit)
    rows = await cursor.to_list(length=limit)
    total = await db.books.count_documents({
        "user_id": user.user_id,
        "$or": [
            {"has_cover": {"$exists": False}},
            {"has_cover": False},
            {"has_cover": None},
        ],
    })
    return {"books": rows, "total": total, "limit": limit}


__all__ = []
