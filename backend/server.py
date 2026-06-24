"""Shelfsort API entry-point.

The actual endpoint definitions live under ``backend/routes/*``. Importing
each routes module here registers its endpoints on the shared
``api_router`` (defined in ``deps.py``) by side effect. We then mount the
router and the CORS middleware on the FastAPI app and wire up the
startup/shutdown lifecycle hooks.
"""
from starlette.middleware.cors import CORSMiddleware
import os
from datetime import datetime, timezone

from deps import app, api_router, db, logger, client

# Import each routes module so its @api_router decorators register.
from routes import root, auth, books, conversions, user_prefs, library_backup, tags, authors, pairings, trash, bookmarks, library_discovery, stats, series_categories, digest, year, smart_shelves, announcements, admin, admin_db, fulltext, chat, friends, invites, friend_library, suggestions, notifications, bookclubs, recommendations, opds, wordcount, goals, refresh, duplicates, url_lists, fandoms, exports, reading_activity, library_views, duplicate_resolution, view_consents, cover_public, reading_sync, push, analytics, operator_digest, storage_admin, help_analytics, suggestions_box, signup_config, health, admin_antivirus, account_safety, reader_prefs, admin_whats_new, upload_jobs  # noqa: F401

# Some static-path routes (e.g. /api/books/refresh-status, /api/books/recent)
# live in route modules that are imported *after* books.py, which means
# books.py's dynamic /api/books/{book_id} route is registered first and would
# shadow them.  Re-sort the router so any route whose path contains a path
# parameter is matched LAST.  Static paths first, dynamic second — preserves
# the contract from before the Phase 4 refactor without re-ordering imports.
def _reorder_static_routes_first() -> None:
    static_routes = [r for r in api_router.routes if "{" not in getattr(r, "path", "")]
    dynamic_routes = [r for r in api_router.routes if "{" in getattr(r, "path", "")]
    api_router.routes[:] = static_routes + dynamic_routes


_reorder_static_routes_first()

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
    # Install the email suppression layer FIRST so any startup hook
    # that might fire an email (digest backfill, etc.) routes through
    # the test-recipient + outbound-pause gates.
    try:
        from utils.email_suppression import install as _install_email_guards
        _install_email_guards()
    except Exception as e:
        logger.warning(f"email_suppression install failed: {e}")
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

    # 2026-06-20 — hydrate the Emergent fallback toggle from Mongo so
    # an admin-paused fallback survives a pod reboot.  See
    # ``utils/storage_cloud.set_emergent_fallback_paused``.
    try:
        from utils.storage_cloud import set_emergent_fallback_paused
        cfg = await db.storage_config.find_one({"_id": "singleton"}) or {}
        set_emergent_fallback_paused(bool(cfg.get("emergent_fallback_paused", False)))
    except Exception as e:
        logger.warning(f"Could not hydrate storage_config: {e}")

    # 2026-06-20 — Backfill the ``is_test_account`` flag on every user
    # whose email matches the current test-fixture patterns.  The
    # patterns expanded over time, so legacy users won't have the
    # flag set even though they match.  Idempotent — only writes when
    # ``is_test_account`` is missing or false. Cheap (single
    # ``update_many``) so safe to run on every boot.
    try:
        from utils.test_account_filter import mongo_test_account_filter
        # Step 1: stamp the is_test_account flag on every matching user.
        flt = {
            "is_test_account": {"$ne": True},
            **mongo_test_account_filter(),
        }
        result = await db.users.update_many(
            flt,
            {"$set": {"is_test_account": True, "auto_approved_test": True}},
        )
        if result.modified_count:
            logger.info(
                "test_account_filter backfill: stamped is_test_account=True on %d legacy users",
                result.modified_count,
            )
        # Step 2: flip every test-account user still stuck in
        # ``approval_status="pending"`` to ``"approved"``.  These
        # accounts pre-date the auto-accept logic and would otherwise
        # render with a "Pending" badge on the test-accounts
        # quarantine page even though they're already excluded from
        # the main pending-users inbox.  Idempotent — only touches
        # rows where the status isn't already approved.
        approval_result = await db.users.update_many(
            {
                "is_test_account": True,
                "approval_status": {"$ne": "approved"},
            },
            {"$set": {"approval_status": "approved"}},
        )
        if approval_result.modified_count:
            logger.info(
                "test_account_filter backfill: flipped approval_status='approved' on %d test fixtures",
                approval_result.modified_count,
            )
    except Exception as e:
        logger.warning(f"Test-account backfill failed: {e}")

    # 2026-06-20 — Backfill suggestion ``device`` to "Unknown" for
    # rows submitted before the device picker was introduced.  Single
    # update_many; idempotent (only touches rows where the field is
    # missing).  Also creates a case-insensitive unique index on the
    # ``custom_devices`` collection so concurrent inserts of the same
    # novel device don't duplicate.
    try:
        sug_res = await db.suggestions.update_many(
            {"suggestion_id": {"$exists": True}, "device": {"$exists": False}},
            {"$set": {"device": "Unknown"}},
        )
        if sug_res.modified_count:
            logger.info(
                "suggestions device backfill: stamped 'Unknown' on %d legacy rows",
                sug_res.modified_count,
            )
        await db.custom_devices.create_index("name_lc", unique=True)
    except Exception as e:
        logger.warning(f"Suggestion device backfill: {e}")

    # Auto-backfill on startup — fire-and-forget so a slow upload to
    # the object store doesn't delay the server accepting traffic.
    # Catches the "I just deployed, my pod just rebooted, are my files
    # safe?" case without needing the user to click anything.  The
    # 10-min cron tick continues afterwards for new uploads.
    try:
        import asyncio as _asyncio
        from routes.storage_admin import storage_backfill_tick

        async def _initial_backfill_delayed():
            # Wait 15 s after startup so the app is fully serving
            # traffic before we start chewing on disk + network for
            # the mirror.
            await _asyncio.sleep(15)
            try:
                await storage_backfill_tick()
            except Exception as e:
                logger.warning("Initial storage backfill failed: %s", e)

        _asyncio.create_task(_initial_backfill_delayed())
    except Exception as e:
        logger.warning(f"Could not schedule initial storage backfill: {e}")
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

    # cursor_history TTL — auto-delete reading-progress events older
    # than 180 days so the collection doesn't grow unboundedly.  The
    # re-read detector only walks the trailing 30-day window, so 180d
    # is generous head-room.  Idempotent: creating an index that
    # already exists is a no-op in Mongo.
    try:
        await db.cursor_history.create_index(
            "created_at",
            expireAfterSeconds=180 * 24 * 3600,
            name="cursor_history_ttl_180d",
        )
        logger.info("cursor_history TTL index live (180d retention).")
    except Exception as e:
        logger.warning("cursor_history TTL index create failed: %s", e)

    # Auto-purge fixture accounts (testing-agent leftovers like
    # ``@test.local``, ``test_*@example.com``) older than 7 days +
    # their books + sessions.  Runs daily at 03:00 UTC via APScheduler
    # so the admin's "/admin/test-accounts" page stays clean without
    # the operator needing to click "Purge all" manually.
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from utils.test_account_filter import mongo_test_account_filter
        from utils.cron_health import wrap_cron_job
        from datetime import timedelta as _td

        async def _purge_old_fixtures():
            cutoff = (datetime.now(timezone.utc) - _td(days=7)).isoformat()
            stale = await db.users.find(
                {
                    "created_at": {"$lt": cutoff},
                    **mongo_test_account_filter(),
                },
                {"_id": 0, "user_id": 1},
            ).to_list(length=10000)
            if not stale:
                return
            ids = [u["user_id"] for u in stale]
            await db.books.delete_many({"user_id": {"$in": ids}})
            await db.user_sessions.delete_many({"user_id": {"$in": ids}})
            res = await db.users.delete_many({"user_id": {"$in": ids}})
            logger.info("Auto-purged %d fixture accounts (older than 7d)", res.deleted_count)

        # Borrow the existing scheduler instance set up by
        # ``digest.start_digest_scheduler()`` so we don't run two.
        if digest._scheduler is not None:
            digest._scheduler.add_job(
                wrap_cron_job(_purge_old_fixtures, "fixture_auto_purge"),
                "cron",
                hour=3,
                minute=0,
                id="fixture_auto_purge",
                replace_existing=True,
            )
            logger.info("Fixture auto-purge job scheduled (daily 03:00 UTC).")

            # ClamAV watchdog — auto-pauses uploads if the scanner has
            # been unreachable for AV_DOWN_THRESHOLD_MIN minutes
            # straight.  Runs every minute so the longest a real outage
            # can leak unscanned uploads is roughly the threshold +
            # one tick.  See utils/av_watchdog.py for full rationale.
            try:
                from utils.av_watchdog import av_health_watchdog_tick
                digest._scheduler.add_job(
                    wrap_cron_job(av_health_watchdog_tick, "av_health_watchdog"),
                    "interval",
                    minutes=1,
                    id="av_health_watchdog",
                    replace_existing=True,
                )
                logger.info("ClamAV watchdog job scheduled (every 1 min).")
            except Exception as e:
                logger.warning("ClamAV watchdog failed to schedule: %s", e)

            # Weekly admin digest — Sundays 09:00 UTC.  Drains the
            # admin_pending_alerts queue (populated by cron-failure
            # alerts + other admin signals) into one consolidated
            # email per real admin.  Resend quota brake — replaces
            # the per-failure fan-out that was burning 100+
            # emails/day.  See utils/admin_alerts.py.
            try:
                from utils.admin_alerts import weekly_admin_digest_tick
                digest._scheduler.add_job(
                    wrap_cron_job(weekly_admin_digest_tick, "weekly_admin_digest"),
                    "cron",
                    day_of_week="sun",
                    hour=9,
                    minute=0,
                    id="weekly_admin_digest",
                    replace_existing=True,
                )
                logger.info("Weekly admin digest scheduled (Sundays 09:00 UTC).")
            except Exception as e:
                logger.warning("Weekly admin digest failed to schedule: %s", e)
    except Exception as e:
        logger.warning("Fixture auto-purge job failed to schedule: %s", e)

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

    # Calibre + ClamAV self-heal pipeline (2026-06-18) — chained
    # sequentially via a single task because apt-get holds an
    # exclusive lock; running both installs concurrently caused
    # the second to fail with "Could not get lock /var/lib/dpkg/
    # lock-frontend" in the first deploy attempt.
    try:
        import shutil
        import asyncio
        from pathlib import Path as _Path

        async def _self_heal_binaries():
            # ---- Step 1: Calibre (for PDF/MOBI/AZW conversion) -----------
            if not shutil.which("ebook-convert"):
                logger.info("Calibre missing — running `apt-get install -y calibre` in background")
                proc = await asyncio.create_subprocess_exec(
                    "apt-get", "install", "-y", "calibre",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode == 0 and shutil.which("ebook-convert"):
                    logger.info("Calibre installed — uploads will auto-convert from now on")
                else:
                    logger.warning("Calibre install failed (rc=%s): %s", proc.returncode, (stderr or b"").decode()[-300:])

            # ---- Step 2: ClamAV (uploads/restores/downloads scanner) ------
            if not shutil.which("clamscan"):
                logger.info("ClamAV missing — installing clamav + clamav-daemon")
                proc = await asyncio.create_subprocess_exec(
                    "apt-get", "install", "-y", "clamav", "clamav-daemon",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.warning("ClamAV install failed (rc=%s): %s", proc.returncode, (stderr or b"").decode()[-300:])
                    return
                # Bump scan size caps so larger EPUB/PDF uploads scan
                # in full instead of being truncated by clamd's 100M default.
                try:
                    cfg = _Path("/etc/clamav/clamd.conf")
                    if cfg.exists():
                        txt = cfg.read_text()
                        txt = txt.replace("MaxScanSize 100M", "MaxScanSize 500M")
                        txt = txt.replace("MaxFileSize 25M", "MaxFileSize 500M")
                        cfg.write_text(txt)
                except Exception as e:
                    logger.warning("clamd.conf cap bump failed: %s", e)

            # ---- Step 3: download virus signatures (~200 MB) --------------
            sig_dir = _Path("/var/lib/clamav")
            if not any(sig_dir.glob("*.c?d")):
                logger.info("ClamAV signatures missing — running freshclam")
                proc = await asyncio.create_subprocess_exec(
                    "freshclam",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.warning("freshclam failed (rc=%s): %s", proc.returncode, (stderr or b"").decode()[-300:])

            # ---- Step 4: start clamd as a background daemon ---------------
            sock = _Path("/var/run/clamav/clamd.ctl")
            if not sock.exists() and shutil.which("clamd"):
                logger.info("clamd not running — starting in background")
                _Path("/var/run/clamav").mkdir(parents=True, exist_ok=True)
                try:
                    import subprocess as _sp
                    _sp.run(["chown", "clamav:clamav", "/var/run/clamav"], check=False)
                except Exception:
                    pass
                await asyncio.create_subprocess_exec(
                    "clamd",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                # Wait up to 60 s for the socket — clamd loads ~3.6M
                # signatures on boot.
                for _ in range(60):
                    if sock.exists():
                        logger.info("clamd ready — uploads scan from now on")
                        break
                    await asyncio.sleep(1)
                else:
                    logger.warning("clamd socket never appeared — antivirus will fail open")

        asyncio.create_task(_self_heal_binaries())
    except Exception as e:
        logger.warning(f"Binary self-heal failed to schedule: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    # Stop the APScheduler BEFORE closing the Mongo client so in-flight
    # cron jobs don't try to read/write to a closed connection (was
    # spamming "Cannot use MongoClient after close" on every reload).
    try:
        digest.stop_digest_scheduler()
    except Exception as e:
        logger.warning("Scheduler shutdown raised: %s", e)
    client.close()
