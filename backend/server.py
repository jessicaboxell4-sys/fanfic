"""Shelfsort API entry-point.

The actual endpoint definitions live under ``backend/routes/*``. Importing
each routes module here registers its endpoints on the shared
``api_router`` (defined in ``deps.py``) by side effect. We then mount the
router and the CORS middleware on the FastAPI app and wire up the
startup/shutdown lifecycle hooks.
"""
from starlette.middleware.cors import CORSMiddleware
import os

from deps import app, api_router, db, logger, client

# Import each routes module so its @api_router decorators register.
from routes import root, auth, books, stats, series_categories, digest, year, smart_shelves, announcements  # noqa: F401

# Mount the router and middleware.
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.login_attempts.create_index("identifier")
        await db.login_attempts.create_index("ts")
        await db.password_reset_tokens.create_index("token", unique=True)
        await db.password_reset_tokens.create_index("user_id")
        await db.year_in_books_shares.create_index("share_token", unique=True)
        await db.year_in_books_shares.create_index([("user_id", 1), ("year", 1)])
        await db.smart_shelves.create_index("shelf_id", unique=True)
        await db.smart_shelves.create_index([("user_id", 1), ("created_at", -1)])
        await db.books.create_index([("user_id", 1), ("tags", 1)])
    except Exception as e:
        logger.warning(f"Index setup: {e}")
    # One-time migration (2026-05): rename legacy `fichub_*` DB fields on
    # existing book records to their new names. Idempotent: only matches docs
    # that still have at least one legacy field. Safe to run on every startup.
    try:
        legacy_filter = {
            "$or": [
                {"fichub_unavailable": {"$exists": True}},
                {"fichub_last_error": {"$exists": True}},
                {"fichub_last_attempt_at": {"$exists": True}},
                {"fichub_meta": {"$exists": True}},
            ]
        }
        result = await db.books.update_many(
            legacy_filter,
            {"$rename": {
                "fichub_unavailable": "unavailable",
                "fichub_last_error": "last_fetch_error",
                "fichub_last_attempt_at": "last_fetch_attempt_at",
                "fichub_meta": "source_meta",
            }},
        )
        if result.modified_count:
            logger.info(
                "Migrated %d book records from legacy fichub_* fields to new names.",
                result.modified_count,
            )
    except Exception as e:
        logger.warning("Fanfic field rename migration: %s", e)

    # One-time migration (2026-06): renormalize existing `source_url` and
    # `fanfic_urls` to the canonical form (www/m subdomain collapsed, AO3
    # collection prefix dropped, chapter id stripped, http→https). Without
    # this, a freshly-pasted URL won't match a book whose stored URL was
    # captured under the old non-normalized rules. Idempotent: only writes
    # when normalization produces a different string.
    try:
        from routes.books import normalize_fanfic_url  # noqa: WPS433
        scanned = 0
        updated = 0
        cursor = db.books.find(
            {"$or": [
                {"source_url": {"$exists": True, "$ne": None}},
                {"fanfic_urls": {"$exists": True, "$ne": []}},
            ]},
            {"book_id": 1, "source_url": 1, "fanfic_urls": 1},
        )
        async for doc in cursor:
            scanned += 1
            patch = {}
            src = doc.get("source_url")
            if src:
                norm = normalize_fanfic_url(src)
                if norm and norm != src:
                    patch["source_url"] = norm
            urls = doc.get("fanfic_urls") or []
            if urls:
                seen = set()
                new_list = []
                for u in urls:
                    n = normalize_fanfic_url(u) or u
                    if n not in seen:
                        seen.add(n)
                        new_list.append(n)
                if new_list != urls:
                    patch["fanfic_urls"] = new_list
            if patch:
                await db.books.update_one({"book_id": doc["book_id"]}, {"$set": patch})
                updated += 1
        if updated:
            logger.info(
                "Renormalized fanfic URLs on %d/%d book records.", updated, scanned,
            )
    except Exception as e:
        logger.warning("Fanfic URL renormalization migration: %s", e)

    # One-time migration (2026-06-06): coerce stored `format_prefs.* == "convert"`
    # (silent auto-convert) to "ask". Silent conversion was removed — every
    # non-EPUB upload now always prompts the user. Idempotent: scoped to
    # users whose format_prefs actually contains a "convert" value.
    try:
        r = await db.users.update_many(
            {"format_prefs": {"$exists": True}},
            [{
                "$set": {
                    "format_prefs": {
                        "$arrayToObject": {
                            "$map": {
                                "input": {"$objectToArray": "$format_prefs"},
                                "as": "p",
                                "in": {
                                    "k": "$$p.k",
                                    "v": {
                                        "$cond": [
                                            {"$eq": ["$$p.v", "convert"]},
                                            "ask",
                                            "$$p.v",
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            }],
        )
        if getattr(r, "modified_count", 0):
            logger.info(
                "Coerced legacy `format_prefs: convert` → `ask` on %d user records.",
                r.modified_count,
            )
    except Exception as e:
        logger.warning("Format-prefs convert-to-ask migration: %s", e)
    try:
        digest.start_digest_scheduler()
    except Exception as e:
        logger.warning(f"Digest scheduler failed to start: {e}")

    # One-time bootstrap (2026-06): if no user is flagged is_admin yet,
    # promote the oldest existing account so the operator of a freshly
    # upgraded install can publish release-note announcements. Subsequent
    # admins must be promoted manually (Mongo update). Idempotent: noop
    # after the first run.
    try:
        admin_count = await db.users.count_documents({"is_admin": True})
        if admin_count == 0:
            oldest = await db.users.find_one(
                {},
                {"user_id": 1, "email": 1},
                sort=[("created_at", 1)],
            )
            if oldest:
                await db.users.update_one(
                    {"user_id": oldest["user_id"]},
                    {"$set": {"is_admin": True}},
                )
                logger.info(
                    "Bootstrapped first admin: %s (%s)",
                    oldest.get("email"),
                    oldest["user_id"],
                )
    except Exception as e:
        logger.warning("Admin-bootstrap migration: %s", e)

    # Calibre self-heal — the pod environment occasionally recycles apt packages.
    # If `ebook-convert` isn't on PATH, fire a background `apt-get install` so
    # PDF/MOBI/AZW uploads keep auto-converting without manual intervention.
    try:
        import shutil
        if not shutil.which("ebook-convert"):
            import asyncio
            async def _ensure_calibre():
                logger.info("Calibre missing on startup — running `apt-get install -y calibre` in background")
                proc = await asyncio.create_subprocess_exec(
                    "apt-get", "install", "-y", "calibre",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode == 0 and shutil.which("ebook-convert"):
                    logger.info("Calibre installed successfully — uploads will auto-convert from now on")
                else:
                    logger.warning("Calibre install failed (rc=%s): %s", proc.returncode, (stderr or b"").decode()[-300:])
            asyncio.create_task(_ensure_calibre())
    except Exception as e:
        logger.warning(f"Calibre self-heal failed to schedule: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
