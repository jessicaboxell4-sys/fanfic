"""Admin Console endpoints.

Every endpoint here uses `Depends(require_admin)`. All mutating endpoints
call `record_admin_action(...)` so the audit log is always populated.

Endpoint groups:
- Users:                 GET /admin/users, POST /admin/users/{id}/promote, POST /admin/users/{id}/demote
- Maintenance banner:    GET/PUT /admin/maintenance-banner
- System health:         GET /admin/system-health
- Global fandom aliases: GET/PUT /admin/global-fandom-aliases
- Global stats:          GET /admin/global-stats
- Feature flags:         GET/PUT /admin/feature-flags
- Audit log:             GET /admin/audit-log

The maintenance banner is also readable at `GET /maintenance-banner`
(no auth) so the public frontend can poll it.
"""
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import shutil
import os

from deps import db, api_router, logger, RESEND_API_KEY, EMERGENT_LLM_KEY, STORAGE_DIR
from models import User
from auth_dep import require_admin
from utils.admin_audit import record_admin_action
from utils.feature_flags import KNOWN_FLAGS, get_flags, set_flag


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@api_router.get("/admin/users")
async def list_users(user: User = Depends(require_admin)):
    """Return every user with admin badge + book/storage stats."""
    rows = await db.users.find(
        {},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "is_admin": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(length=2000)
    # Annotate with book counts (single aggregation, not per-row).
    counts_cursor = db.books.aggregate([
        {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}
    ])
    counts: Dict[str, int] = {}
    async for c in counts_cursor:
        counts[c["_id"]] = c["n"]
    for r in rows:
        r["book_count"] = counts.get(r["user_id"], 0)
        r["is_admin"] = bool(r.get("is_admin"))
        ts = r.get("created_at")
        if isinstance(ts, datetime):
            r["created_at"] = ts.isoformat()
    return {"users": rows, "count": len(rows)}


@api_router.post("/admin/users/{target_user_id}/promote")
async def promote_user(target_user_id: str, user: User = Depends(require_admin)):
    """Flag the target user as admin. Idempotent."""
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1, "is_admin": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"is_admin": True}})
    await record_admin_action(user, "user.promote", target=target_user_id, metadata={"email": target.get("email")})
    return {"ok": True, "user_id": target_user_id, "is_admin": True}


@api_router.post("/admin/users/{target_user_id}/demote")
async def demote_user(target_user_id: str, user: User = Depends(require_admin)):
    """Remove admin flag. Refuses to demote the last remaining admin so the
    console never becomes unreachable. Refuses self-demote for the same
    reason — use mongosh if you really want to."""
    if target_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="Use mongosh to demote yourself")
    admin_count = await db.users.count_documents({"is_admin": True})
    if admin_count <= 1:
        raise HTTPException(status_code=400, detail="Refusing to demote the last admin")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1, "is_admin": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.get("is_admin"):
        return {"ok": True, "user_id": target_user_id, "is_admin": False}  # idempotent
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"is_admin": False}})
    await record_admin_action(user, "user.demote", target=target_user_id, metadata={"email": target.get("email")})
    return {"ok": True, "user_id": target_user_id, "is_admin": False}


# ---------------------------------------------------------------------------
# Maintenance banner
# ---------------------------------------------------------------------------

class MaintenanceBannerBody(BaseModel):
    enabled: bool
    message: str = Field(default="", max_length=240)
    severity: str = Field(default="info", pattern="^(info|warn|error)$")


@api_router.get("/maintenance-banner")
async def get_maintenance_banner_public():
    """Public read — no auth. The frontend polls this on every navigation
    to decide whether to show the global banner. Returns `null` when off.
    """
    doc = await db.maintenance_banner.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc or not doc.get("enabled"):
        return None
    return {
        "message": doc.get("message", ""),
        "severity": doc.get("severity", "info"),
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else None,
    }


@api_router.get("/admin/maintenance-banner")
async def admin_get_maintenance_banner(user: User = Depends(require_admin)):
    doc = await db.maintenance_banner.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {
        "enabled": bool(doc.get("enabled")),
        "message": doc.get("message", ""),
        "severity": doc.get("severity", "info"),
        "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else None,
    }


@api_router.put("/admin/maintenance-banner")
async def admin_set_maintenance_banner(body: MaintenanceBannerBody, user: User = Depends(require_admin)):
    payload = {
        "enabled": body.enabled,
        "message": body.message.strip(),
        "severity": body.severity,
        "updated_at": datetime.now(timezone.utc),
    }
    await db.maintenance_banner.update_one({"_id": "singleton"}, {"$set": payload}, upsert=True)
    await record_admin_action(user, "maintenance.banner", metadata={
        "enabled": body.enabled, "severity": body.severity, "len": len(body.message),
    })
    return {**payload, "updated_at": payload["updated_at"].isoformat()}


# ---------------------------------------------------------------------------
# System health
# ---------------------------------------------------------------------------

@api_router.get("/admin/system-health")
async def system_health(user: User = Depends(require_admin)):
    """One-shot health snapshot. Each check is independent — failures show
    up as `false`/error strings rather than crashing the response."""
    out: Dict[str, Any] = {}

    # Calibre (ebook-convert binary on PATH)
    out["calibre"] = {
        "ok": shutil.which("ebook-convert") is not None,
        "path": shutil.which("ebook-convert") or "",
    }

    # Resend (email)
    out["resend"] = {"configured": bool(RESEND_API_KEY)}

    # Emergent LLM key
    out["llm"] = {"configured": bool(EMERGENT_LLM_KEY)}

    # Digest scheduler — module exposes `_scheduler` after start_digest_scheduler()
    try:
        from routes import digest as digest_mod
        sched = getattr(digest_mod, "_scheduler", None)
        out["digest_scheduler"] = {"running": bool(sched and sched.running)}
    except Exception as e:  # noqa: BLE001
        out["digest_scheduler"] = {"running": False, "error": str(e)[:200]}

    # Mongo collection sizes (best-effort; counts are O(n) on some configs).
    collections = ["users", "user_sessions", "books", "categories", "smart_shelves",
                   "unknown_sources", "announcements", "feature_flags", "admin_audit"]
    coll_stats: Dict[str, int] = {}
    for c in collections:
        try:
            coll_stats[c] = await db[c].estimated_document_count()
        except Exception as e:  # noqa: BLE001
            logger.warning("collection count failed for %s: %s", c, e)
            coll_stats[c] = -1
    out["collections"] = coll_stats

    # Storage on disk
    try:
        total, used, free = shutil.disk_usage(STORAGE_DIR)
        out["storage"] = {
            "path": str(STORAGE_DIR),
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
        }
    except Exception as e:  # noqa: BLE001
        out["storage"] = {"error": str(e)[:200]}

    return out


# ---------------------------------------------------------------------------
# Global fandom aliases
# ---------------------------------------------------------------------------

class GlobalFandomAliasBody(BaseModel):
    aliases: Dict[str, str]


@api_router.get("/admin/global-fandom-aliases")
async def get_global_fandom_aliases(user: User = Depends(require_admin)):
    doc = await db.global_fandom_aliases.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return {"aliases": doc.get("aliases", {})}


# Read-only helper for the classifier — callable from books.py without
# going through HTTP. Caches in-process for 30s.
_aliases_cache: Dict[str, str] = {}
_aliases_cache_ts: float = 0.0


async def get_global_fandom_aliases_dict() -> Dict[str, str]:
    """Return the effective global alias map. Cached for 30s. Falls back
    to an empty dict on read errors so the classifier never crashes."""
    import time as _t
    global _aliases_cache, _aliases_cache_ts
    if _aliases_cache and _t.monotonic() - _aliases_cache_ts < 30:
        return dict(_aliases_cache)
    try:
        doc = await db.global_fandom_aliases.find_one({"_id": "singleton"}, {"_id": 0}) or {}
        _aliases_cache = doc.get("aliases", {}) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning("global fandom aliases read failed: %s", e)
        _aliases_cache = {}
    _aliases_cache_ts = _t.monotonic()
    return dict(_aliases_cache)


@api_router.put("/admin/global-fandom-aliases")
async def set_global_fandom_aliases(body: GlobalFandomAliasBody, user: User = Depends(require_admin)):
    cleaned: Dict[str, str] = {}
    for k, v in (body.aliases or {}).items():
        ks = (k or "").strip()
        vs = (v or "").strip()
        if not ks or not vs or ks.lower() == vs.lower():
            continue
        cleaned[ks] = vs
    await db.global_fandom_aliases.update_one(
        {"_id": "singleton"},
        {"$set": {"aliases": cleaned, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Invalidate cache so next classification picks up the change.
    global _aliases_cache, _aliases_cache_ts
    _aliases_cache = {}
    _aliases_cache_ts = 0.0
    await record_admin_action(user, "fandom_aliases.global", metadata={"count": len(cleaned)})
    return {"aliases": cleaned}


# ---------------------------------------------------------------------------
# Global stats
# ---------------------------------------------------------------------------

@api_router.get("/admin/global-stats")
async def global_stats(user: User = Depends(require_admin)):
    """Tenant-wide rollup. Light aggregations only — no per-book scan."""
    user_count = await db.users.count_documents({})
    book_count = await db.books.count_documents({})
    admin_count = await db.users.count_documents({"is_admin": True})

    # Signups in last 7d / 30d (string ISO comparison works because we
    # store created_at as ISO 8601).
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()
    signups_7d = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    signups_30d = await db.users.count_documents({"created_at": {"$gte": month_ago}})

    # Top 10 fandoms across all libraries.
    top_fandoms = []
    pipeline = [
        {"$match": {"fandom": {"$ne": None, "$nin": ["", None]}}},
        {"$group": {"_id": "$fandom", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    async for r in db.books.aggregate(pipeline):
        top_fandoms.append({"fandom": r["_id"], "count": r["n"]})

    # Category split
    categories: Dict[str, int] = {}
    async for r in db.books.aggregate([{"$group": {"_id": "$category", "n": {"$sum": 1}}}]):
        categories[r["_id"] or "Uncategorized"] = r["n"]

    # Storage used on disk (sum of sizes in books collection).
    storage_pipeline = [{"$group": {"_id": None, "bytes": {"$sum": "$size_bytes"}}}]
    storage_doc = await db.books.aggregate(storage_pipeline).to_list(length=1)
    total_bytes = storage_doc[0]["bytes"] if storage_doc else 0

    return {
        "users": user_count,
        "admins": admin_count,
        "books": book_count,
        "signups_7d": signups_7d,
        "signups_30d": signups_30d,
        "top_fandoms": top_fandoms,
        "categories": categories,
        "total_storage_bytes": int(total_bytes or 0),
    }


# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------

class FeatureFlagBody(BaseModel):
    flag: str
    enabled: bool


@api_router.get("/admin/feature-flags")
async def list_feature_flags(user: User = Depends(require_admin)):
    return {
        "flags": await get_flags(),
        "known": KNOWN_FLAGS,
    }


@api_router.put("/admin/feature-flags")
async def set_feature_flag(body: FeatureFlagBody, user: User = Depends(require_admin)):
    try:
        flags = await set_flag(body.flag, body.enabled)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await record_admin_action(user, "feature_flag.set", target=body.flag, metadata={"enabled": body.enabled})
    return {"flags": flags, "known": KNOWN_FLAGS}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@api_router.get("/admin/audit-log")
async def get_audit_log(
    limit: int = 100,
    action_prefix: Optional[str] = None,
    user: User = Depends(require_admin),
):
    """Return the most recent audit entries (newest first). Use
    `?action_prefix=user.` to filter by action group. Capped at 500.
    """
    limit = max(1, min(int(limit), 500))
    query: Dict[str, Any] = {}
    if action_prefix:
        query["action"] = {"$regex": f"^{action_prefix}"}
    cursor = db.admin_audit.find(query, {"_id": 0}).sort("ts", -1).limit(limit)
    rows = await cursor.to_list(length=limit)
    for r in rows:
        ts = r.get("ts")
        if isinstance(ts, datetime):
            r["ts"] = ts.isoformat()
    return {"entries": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Unknown fandoms — fandoms in `books` that aren't in the keyword classifier
# ---------------------------------------------------------------------------

def _known_fandoms() -> set:
    """Lazy import so this module doesn't pull in the giant books.py at
    server startup time. `FANDOM_KEYWORDS` already includes the merged
    AO3 seed list."""
    from routes.books import FANDOM_KEYWORDS
    return set(FANDOM_KEYWORDS.keys())


@api_router.get("/admin/unknown-fandoms")
async def get_unknown_fandoms(user: User = Depends(require_admin)):
    """Return any fandom currently present in the books collection that
    doesn't match a key in the keyword classifier. Dismissed entries are
    hidden."""
    from utils.unknown_fandoms import list_unknown_fandoms
    rows = await list_unknown_fandoms(_known_fandoms())
    return {"unknown": rows, "count": len(rows)}


@api_router.get("/admin/unknown-fandoms/count")
async def get_unknown_fandoms_count(user: User = Depends(require_admin)):
    """Lightweight count for the navbar badge. Cached server-side for 60s."""
    from utils.unknown_fandoms import count_unknown_fandoms
    return {"count": await count_unknown_fandoms(_known_fandoms())}


@api_router.post("/admin/unknown-fandoms/{fandom}/dismiss")
async def dismiss_unknown_fandom(fandom: str, user: User = Depends(require_admin)):
    """Permanently hide a fandom from the unknown list (use for "Other",
    "Original Work", etc.). Idempotent."""
    await db.dismissed_unknown_fandoms.update_one(
        {"fandom": fandom},
        {"$set": {"fandom": fandom, "dismissed_at": datetime.now(timezone.utc), "by": user.user_id}},
        upsert=True,
    )
    from utils.unknown_fandoms import invalidate_count_cache
    invalidate_count_cache()
    await record_admin_action(user, "unknown_fandom.dismiss", target=fandom)
    return {"ok": True, "fandom": fandom}


@api_router.delete("/admin/unknown-fandoms/{fandom}/dismiss")
async def undismiss_unknown_fandom(fandom: str, user: User = Depends(require_admin)):
    """Un-dismiss — surface this fandom again in the unknown list."""
    res = await db.dismissed_unknown_fandoms.delete_one({"fandom": fandom})
    from utils.unknown_fandoms import invalidate_count_cache
    invalidate_count_cache()
    if res.deleted_count:
        await record_admin_action(user, "unknown_fandom.undismiss", target=fandom)
    return {"ok": True, "fandom": fandom, "removed": res.deleted_count}
