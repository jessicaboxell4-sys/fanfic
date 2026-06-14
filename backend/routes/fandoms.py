"""Fandom listing + canonicalisation routes. Extracted from
``routes/books.py`` as part of the Phase 5 refactor (2026-06-14).

Routes:
    GET  /api/fandoms/{name}/crossovers
    GET  /api/fandoms/grouped
    POST /api/fandoms/canonicalize-crossovers
"""
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

from deps import db, api_router
from models import User
from auth_dep import get_current_user
from utils.constants import TRASH_SHELF
from routes.books import _canonicalize_fandom


@api_router.get("/fandoms/{name}/crossovers")
async def list_crossovers_for_fandom(name: str, user: User = Depends(get_current_user)):
    """Every crossover fandom in the user's library that contains `name`."""
    target = name.strip()
    if not target:
        raise HTTPException(status_code=400, detail="fandom name is required")
    # Canonical form uses " / " as separator. A fandom contains `target` iff
    # the slash-split list contains it (case-insensitive).
    pipeline = [
        {"$match": {
            "user_id": user.user_id,
            "fandom": {"$regex": r"\s/\s", "$options": "i"},
        }},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)
    needle = target.lower()
    out: List[Dict[str, Any]] = []
    for r in rows:
        nm = r.get("_id") or ""
        parts = [p.strip() for p in str(nm).split(" / ") if p.strip()]
        if any(p.lower() == needle for p in parts):
            out.append({"name": nm, "count": r["count"], "parts": parts})
    return {"target": target, "crossovers": out}


@api_router.get("/fandoms/grouped")
async def get_fandoms_grouped(user: User = Depends(get_current_user)):
    """Return the user's fandoms rolled up by franchise.

    For each franchise that has at least one matching fandom in the user's
    library we emit a parent row with `children: [{name, count}]`. Fandoms
    that don't belong to any franchise group are emitted as leaf rows at
    the top level. The frontend's "Group by franchise" treemap mode
    renders this directly with recharts' nested layout.
    """
    from data.fandom_franchises import FRANCHISE_GROUPS, franchise_for  # noqa: WPS433

    pipeline = [
        {"$match": {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}}},
        {"$group": {"_id": "$fandom", "count": {"$sum": 1}}},
        {"$match": {"_id": {"$nin": [None, ""]}}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(5000)

    # Bucket each fandom under its franchise, or keep standalone.
    franchise_buckets: Dict[str, List[Dict[str, Any]]] = {}
    standalone: List[Dict[str, Any]] = []
    for r in rows:
        nm = r["_id"]
        parent = franchise_for(nm)
        if parent and parent != nm:
            franchise_buckets.setdefault(parent, []).append({"name": nm, "count": r["count"]})
        else:
            standalone.append({"name": nm, "count": r["count"]})

    out: List[Dict[str, Any]] = []
    for franchise, members in franchise_buckets.items():
        # Single-member buckets aren't really "groups" — bubble the member
        # back up to the top level so the treemap doesn't waste a parent
        # cell on it.
        if len(members) == 1:
            out.append(members[0])
            continue
        members.sort(key=lambda m: m["count"], reverse=True)
        out.append({
            "name": franchise,
            "count": sum(m["count"] for m in members),
            "children": members,
        })
    out.extend(standalone)
    out.sort(key=lambda r: r["count"], reverse=True)
    return {"fandoms": out, "franchise_count": sum(1 for r in out if r.get("children"))}



# /user/fandom-aliases endpoints live in routes/user_prefs.py
# (extracted 2026-06-13).


@api_router.post("/fandoms/canonicalize-crossovers")
async def canonicalize_crossover_fandoms(user: User = Depends(get_current_user)):
    """Walk every book in the user's library and rewrite any crossover
    fandom strings (e.g. "Twilight & Harry Potter", "Harry Potter/Twilight")
    into the canonical alphabetical form "Harry Potter / Twilight" so they
    file together. Also applies the user's manual fandom aliases. Returns a
    per-mapping report.
    """
    udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    aliases = udoc.get("fandom_aliases") or {}
    books = await db.books.find(
        {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}},
        {"_id": 0, "book_id": 1, "fandom": 1},
    ).to_list(20000)
    mapping: Dict[str, str] = {}
    updated = 0
    for b in books:
        old = b.get("fandom")
        if not old:
            continue
        new = _canonicalize_fandom(old, aliases)
        if new and new != old:
            await db.books.update_one(
                {"user_id": user.user_id, "book_id": b["book_id"]},
                {"$set": {"fandom": new}},
            )
            mapping.setdefault(old, new)
            updated += 1
    return {
        "scanned": len(books),
        "updated": updated,
        "mappings": [{"from": k, "to": v} for k, v in mapping.items()],
    }

