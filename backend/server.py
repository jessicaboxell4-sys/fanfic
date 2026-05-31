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
from routes import root, auth, books, stats, series_categories, digest, year, smart_shelves  # noqa: F401

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
    try:
        digest.start_digest_scheduler()
    except Exception as e:
        logger.warning(f"Digest scheduler failed to start: {e}")

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
