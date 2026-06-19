"""Cross-device reader prefs.

Reader theme + font are stored in localStorage on the client (fast
path, works offline).  But signing in on a new device shouldn't reset
your reading skin to defaults, so we *also* mirror the choice to a
``reader_prefs`` sub-doc on the User model.  Hydrate on mount,
debounced PATCH on every change.

Schema (User document):
    "reader_prefs": {
        "theme": "midnight" | "paper" | "white" | "sage" | "sepia-night" | "oled",
        "font":  "manrope"  | "lora"  | "cormorant" | "atkinson",
        "updated_at": "2026-06-19T15:00:00+00:00",
    }

Both fields are optional — a missing prefs doc = use the client-side
defaults (cream + manrope).
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import db, api_router
from auth_dep import get_current_user
from models import User


ALLOWED_THEMES = {"paper", "white", "sage", "midnight", "sepia-night", "oled"}
ALLOWED_FONTS  = {"manrope", "lora", "cormorant", "atkinson"}


class ReaderPrefsBody(BaseModel):
    """Partial-update body.  Either field can be omitted to leave the
    existing value untouched — the API is PATCH-style not PUT."""
    theme: Optional[str] = None
    font:  Optional[str] = None


@api_router.get("/account/reader-prefs")
async def get_reader_prefs(user: User = Depends(get_current_user)):
    """Read the caller's saved reader skin choice.  Returns ``{}`` if
    they've never customised — the client falls back to its defaults."""
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "reader_prefs": 1},
    ) or {}
    return doc.get("reader_prefs", {}) or {}


@api_router.patch("/account/reader-prefs")
async def patch_reader_prefs(
    body: ReaderPrefsBody,
    user: User = Depends(get_current_user),
):
    """Partial update.  Only writes the fields the client sent, so the
    frontend can PATCH theme alone without clobbering a fresh font
    change from another tab.  Rejects unknown theme/font values to
    keep junk out of the DB."""
    set_doc: dict = {}
    if body.theme is not None:
        if body.theme not in ALLOWED_THEMES:
            raise HTTPException(400, f"Unknown theme: {body.theme!r}")
        set_doc["reader_prefs.theme"] = body.theme
    if body.font is not None:
        if body.font not in ALLOWED_FONTS:
            raise HTTPException(400, f"Unknown font: {body.font!r}")
        set_doc["reader_prefs.font"] = body.font

    if not set_doc:
        return {"ok": True, "noop": True}

    set_doc["reader_prefs.updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": set_doc},
    )
    # Echo back the freshly-saved prefs so the client can confirm.
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "reader_prefs": 1},
    ) or {}
    return {"ok": True, "reader_prefs": doc.get("reader_prefs", {})}
