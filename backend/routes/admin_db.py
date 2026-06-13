"""Admin DB Inspector — read-only Mongo browsing for operators.

Two endpoints, both admin-only, both read-only:

- `GET /api/admin/db/collections` → manifest of every collection with
  doc count, size, and the timestamp of the newest document.
- `GET /api/admin/db/collection/{name}` → paginated documents (newest
  first by `_id`) with optional text-search on `_id`/`email`/`name` fields.

Safety rails
------------
- Every endpoint requires `Depends(require_admin)`.
- The `SENSITIVE_COLLECTIONS` set blocks any collection that holds
  credential material — `user_sessions` (session tokens), `users` is
  allowed because passwords are bcrypt-hashed but the hash IS redacted
  in the response so it never crosses the wire.
- Pagination is hard-capped at 50 docs/page.
- Each document field longer than `MAX_FIELD_LEN` chars is replaced
  with a `"… [truncated NN KB]"` string so a single 5 MB EPUB blob can't
  blow up the response.
- Reads are sorted by `_id` descending which uses the existing primary
  index — no expensive scans even on 5,302-book tenants.

Audit
-----
List-style reads are not audited (they're effectively read-only
GETs already throttled by the admin pill in the navbar). If we ever
add a document-detail endpoint that could leak more, gate it via
`record_admin_action`.
"""
from fastapi import HTTPException, Depends, Query
from typing import Optional, List, Dict, Any
import re

from deps import db, api_router
from models import User
from auth_dep import require_admin


# Collections we never expose — any field/value in here is credential
# material that must not leak even to admins via this UI.
SENSITIVE_COLLECTIONS: set[str] = {
    "user_sessions",  # holds active session_tokens
}

# Fields that get redacted regardless of which collection holds them.
# `users.password_hash` is the obvious one — bcrypt-hashed but no reason
# to expose it. Same for any future API/access tokens.
REDACTED_FIELDS: set[str] = {
    "password_hash",
    "session_token",
    "api_key",
    "access_token",
    "refresh_token",
}

# Max chars per field before we replace the value with a truncation
# marker. 10 KB is enough for typical metadata; bigger blobs (EPUB
# contents, base64 covers, full audit-log payloads) get truncated.
MAX_FIELD_LEN = 10_000

# Hard page cap.
MAX_PAGE_SIZE = 50


def _redact_value(value: Any, depth: int = 0) -> Any:
    """Recursively walk a Mongo doc, stripping credential fields and
    truncating overlong scalars. Bounded recursion (depth 4) so a
    maliciously deep doc can't stack-overflow the response."""
    if depth > 4:
        return "… [nested too deep]"
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k in REDACTED_FIELDS else _redact_value(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list):
        # Don't recurse forever on huge arrays either.
        if len(value) > 100:
            head = [_redact_value(v, depth + 1) for v in value[:100]]
            return head + [f"… and {len(value) - 100} more items"]
        return [_redact_value(v, depth + 1) for v in value]
    if isinstance(value, str) and len(value) > MAX_FIELD_LEN:
        kb = len(value) // 1024
        return value[:MAX_FIELD_LEN] + f"… [truncated, full value {kb} KB]"
    # ObjectId / datetime / int / float / bool / None — let JSON serializer handle
    return value


def _normalise_doc_for_json(doc: dict) -> dict:
    """Convert Mongo's `ObjectId` _id into a string so the response is
    JSON-serialisable, redact sensitive fields, truncate huge values."""
    out = {}
    for k, v in doc.items():
        if k == "_id":
            out["_id"] = str(v)
            continue
        if k in REDACTED_FIELDS:
            out[k] = "[redacted]"
            continue
        out[k] = _redact_value(v)
    return out


@api_router.get("/admin/db/collections")
async def list_collections(_user: User = Depends(require_admin)):
    """Return every visible collection with `{name, doc_count, size_mb,
    last_doc_at}`. Sensitive collections are hidden entirely so a curious
    admin can't even see they exist via this UI."""
    names = await db.list_collection_names()
    visible = sorted(n for n in names if n not in SENSITIVE_COLLECTIONS)
    out: List[Dict[str, Any]] = []
    for name in visible:
        try:
            stats = await db.command("collStats", name)
            size_mb = round((stats.get("size") or 0) / (1024 * 1024), 2)
            count = int(stats.get("count") or 0)
        except Exception:
            # Some Mongo flavours / time-series collections don't support
            # collStats — fall back to a direct count.
            count = await db[name].count_documents({})
            size_mb = 0.0
        # Newest doc timestamp — use `_id` ordering (always indexed)
        # and pluck the ObjectId's `generation_time`. Cheap on any size.
        last_doc_at: Optional[str] = None
        try:
            newest = await db[name].find_one({}, sort=[("_id", -1)])
            if newest and "_id" in newest:
                gt = getattr(newest["_id"], "generation_time", None)
                if gt is not None:
                    last_doc_at = gt.isoformat()
        except Exception:
            pass
        out.append({
            "name": name,
            "doc_count": count,
            "size_mb": size_mb,
            "last_doc_at": last_doc_at,
        })
    # Heaviest first — most useful for admins triaging disk usage.
    out.sort(key=lambda c: c["size_mb"], reverse=True)
    return {"collections": out}


@api_router.get("/admin/db/collection/{name}")
async def get_collection_page(
    name: str,
    skip: int = Query(0, ge=0, le=10_000),
    limit: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
    q: Optional[str] = Query(None, max_length=200),
    _user: User = Depends(require_admin),
):
    """Return a page of documents from `name`, newest first by `_id`.

    Search behaviour: if `q` is provided, the query matches against any of:
      - `_id` (cast to string, prefix-or-substring match)
      - `email`         (case-insensitive contains)
      - `name`          (case-insensitive contains)
      - `user_id`       (exact match — useful for filtering "this user's books")
      - `title`         (case-insensitive contains — useful for books collection)

    Sensitive collections raise 404 so they're indistinguishable from
    typos. The endpoint never accepts a raw query expression — only the
    five whitelisted search fields.
    """
    if name in SENSITIVE_COLLECTIONS or name not in await db.list_collection_names():
        raise HTTPException(status_code=404, detail="collection not found")

    mongo_query: Dict[str, Any] = {}
    if q:
        clean = q.strip()
        # Escape regex special chars so a search for "foo.bar" doesn't
        # explode. Anchor case-insensitively.
        regex = {"$regex": re.escape(clean), "$options": "i"}
        mongo_query = {
            "$or": [
                {"_id": clean},                # exact-match _id (string or ObjectId)
                {"email": regex},
                {"name": regex},
                {"user_id": clean},
                {"title": regex},
            ]
        }
        # Attempt ObjectId cast for `_id` matching real ObjectIds too.
        try:
            from bson import ObjectId
            if ObjectId.is_valid(clean):
                mongo_query["$or"].append({"_id": ObjectId(clean)})
        except Exception:
            pass

    total = await db[name].count_documents(mongo_query)
    cursor = db[name].find(mongo_query).sort("_id", -1).skip(skip).limit(limit)
    docs = [_normalise_doc_for_json(d) async for d in cursor]
    return {
        "name": name,
        "skip": skip,
        "limit": limit,
        "total": total,
        "q": q or "",
        "docs": docs,
    }
