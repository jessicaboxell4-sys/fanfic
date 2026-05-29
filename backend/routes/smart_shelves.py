"""Smart Shelves: saved queries against the user's library."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import uuid

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user


# A SmartShelfQuery is shaped:
# {
#   "combinator": "AND" | "OR",
#   "rules": [
#       {"field": "tags_all", "values": ["fluff","au"]},
#       {"field": "tags_any", "values": ["wip"]},
#       {"field": "tags_none", "values": ["dnf"]},
#       {"field": "category", "value": "Fanfiction"},
#       {"field": "fandom", "value": "Harry Potter"},
#       {"field": "author", "value": "Ada"},
#       {"field": "status", "value": "reading" | "finished" | "unread"},
#       {"field": "words", "min": 10000, "max": 50000},
#   ]
# }
ALLOWED_FIELDS = {"tags_all", "tags_any", "tags_none", "category", "fandom", "author", "status", "words"}


def _rule_to_mongo(rule: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    field = rule.get("field")
    if field not in ALLOWED_FIELDS:
        return None
    if field == "tags_all":
        vs = [str(v).strip().lower() for v in (rule.get("values") or []) if v]
        return {"tags": {"$all": vs}} if vs else None
    if field == "tags_any":
        vs = [str(v).strip().lower() for v in (rule.get("values") or []) if v]
        return {"tags": {"$in": vs}} if vs else None
    if field == "tags_none":
        vs = [str(v).strip().lower() for v in (rule.get("values") or []) if v]
        return {"tags": {"$nin": vs}} if vs else None
    if field in ("category", "fandom", "author"):
        v = rule.get("value")
        if not v:
            return None
        return {field: v}
    if field == "status":
        v = rule.get("value")
        if v == "reading":
            return {"progress_percent": {"$gte": 0.05, "$lt": 0.95}}
        if v == "finished":
            return {"progress_percent": {"$gte": 0.99}}
        if v == "unread":
            return {"$or": [
                {"progress_percent": {"$exists": False}},
                {"progress_percent": None},
                {"progress_percent": {"$lt": 0.05}},
            ]}
        return None
    if field == "words":
        cond: Dict[str, Any] = {}
        mn = rule.get("min")
        mx = rule.get("max")
        if mn is not None:
            try:
                cond["$gte"] = int(mn)
            except (ValueError, TypeError):
                pass
        if mx is not None:
            try:
                cond["$lte"] = int(mx)
            except (ValueError, TypeError):
                pass
        return {"words": cond} if cond else None
    return None


def _query_to_mongo(user_id: str, query: Dict[str, Any]) -> Dict[str, Any]:
    """Compile a query JSON into a Mongo filter scoped to the user."""
    combinator = (query or {}).get("combinator", "AND").upper()
    rules = (query or {}).get("rules") or []
    clauses = [c for c in (_rule_to_mongo(r) for r in rules) if c]
    base: Dict[str, Any] = {"user_id": user_id}
    if not clauses:
        return base
    if combinator == "OR":
        base["$or"] = clauses
    else:
        base["$and"] = clauses
    return base


class SmartShelfBody(BaseModel):
    name: str
    query: Dict[str, Any]
    pinned: bool = False


class SmartShelfUpdateBody(BaseModel):
    name: Optional[str] = None
    query: Optional[Dict[str, Any]] = None
    pinned: Optional[bool] = None


class SmartShelfPreviewBody(BaseModel):
    query: Dict[str, Any]


@api_router.get("/smart-shelves")
async def list_smart_shelves(user: User = Depends(get_current_user)):
    shelves = await db.smart_shelves.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    # Attach a live count for each shelf
    out: List[Dict[str, Any]] = []
    for s in shelves:
        try:
            count = await db.books.count_documents(_query_to_mongo(user.user_id, s.get("query") or {}))
        except Exception as e:
            logger.warning("smart-shelf count failed: %s", e)
            count = 0
        out.append({**s, "count": count})
    return {"shelves": out}


@api_router.post("/smart-shelves")
async def create_smart_shelf(body: SmartShelfBody, user: User = Depends(get_current_user)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="Name too long (max 64 chars)")
    doc = {
        "shelf_id": f"shelf_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "name": name,
        "query": body.query or {"combinator": "AND", "rules": []},
        "pinned": bool(body.pinned),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.smart_shelves.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/smart-shelves/{shelf_id}")
async def update_smart_shelf(
    shelf_id: str, body: SmartShelfUpdateBody, user: User = Depends(get_current_user)
):
    update: Dict[str, Any] = {}
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        update["name"] = n[:64]
    if body.query is not None:
        update["query"] = body.query
    if body.pinned is not None:
        update["pinned"] = bool(body.pinned)
    if not update:
        return {"updated": 0}
    result = await db.smart_shelves.update_one(
        {"shelf_id": shelf_id, "user_id": user.user_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"updated": result.modified_count}


@api_router.delete("/smart-shelves/{shelf_id}")
async def delete_smart_shelf(shelf_id: str, user: User = Depends(get_current_user)):
    result = await db.smart_shelves.delete_one({"shelf_id": shelf_id, "user_id": user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@api_router.get("/smart-shelves/{shelf_id}/books")
async def get_smart_shelf_books(shelf_id: str, user: User = Depends(get_current_user)):
    shelf = await db.smart_shelves.find_one(
        {"shelf_id": shelf_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not shelf:
        raise HTTPException(status_code=404, detail="Not found")
    mongo_filter = _query_to_mongo(user.user_id, shelf.get("query") or {})
    books = await db.books.find(mongo_filter, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"shelf": shelf, "books": books, "count": len(books)}


@api_router.post("/smart-shelves/preview")
async def preview_smart_shelf(body: SmartShelfPreviewBody, user: User = Depends(get_current_user)):
    """Execute a draft query without saving — for live preview in the builder."""
    mongo_filter = _query_to_mongo(user.user_id, body.query or {})
    count = await db.books.count_documents(mongo_filter)
    sample = await db.books.find(mongo_filter, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    return {"count": count, "sample": sample}
