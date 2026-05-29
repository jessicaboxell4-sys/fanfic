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
    try:
        digest.start_digest_scheduler()
    except Exception as e:
        logger.warning(f"Digest scheduler failed to start: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
