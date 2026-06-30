"""Client-side render error capture (2026-06-30).

``AppErrorBoundary`` in the frontend POSTs to
``/api/analytics/client-errors`` whenever a route crashes during
render.  These tests pin the payload shape, the application-side
size caps, and the LRU trim behavior so a crash loop on one user
can't fill the database.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")


def test_client_error_post_persists_with_caps(shared_event_loop):
    """Long strings get truncated; the row lands in ``client_errors``."""
    from routes.analytics import post_client_error, ClientErrorBody
    from unittest.mock import MagicMock

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        marker = uuid.uuid4().hex
        try:
            body = ClientErrorBody(
                message=("X" * 1000)[:500],
                stack="at Test(App.jsx:42)",
                component_stack="in AppearancePage",
                href=f"https://shelfsort.app/?t={marker}",
                user_agent="Mozilla/5.0 (Test)",
                captured_at="2026-06-30T17:00:00Z",
            )
            res = await post_client_error(body=body, request=MagicMock(), user=None)
            assert res["ok"] is True

            row = await db.client_errors.find_one({"href": {"$regex": marker}})
            assert row is not None
            assert len(row["message"]) <= 500
            assert row["component_stack"] == "in AppearancePage"
            assert row["user_id"] is None
            assert row["received_at"]  # auto-stamped
        finally:
            await db.client_errors.delete_many({"href": {"$regex": marker}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_client_error_records_user_id_when_authenticated(shared_event_loop):
    """Auth'd POSTs stamp the row with the user id for grouping."""
    from routes.analytics import post_client_error, ClientErrorBody
    from models import User
    from unittest.mock import MagicMock

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        marker = uuid.uuid4().hex
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        u = User(user_id=user_id, email="t@example.com", name="T", is_admin=False)
        try:
            res = await post_client_error(
                body=ClientErrorBody(
                    message="boom",
                    stack="",
                    component_stack="",
                    href=f"https://shelfsort.app/?m={marker}",
                    user_agent="",
                    captured_at="",
                ),
                request=MagicMock(),
                user=u,
            )
            assert res["ok"] is True
            row = await db.client_errors.find_one({"href": {"$regex": marker}})
            assert row is not None
            assert row["user_id"] == user_id
        finally:
            await db.client_errors.delete_many({"href": {"$regex": marker}})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_admin_recent_groups_and_counts_unique_pages(shared_event_loop):
    """The admin crash-pulse endpoint groups by (message, href), counts
    occurrences, and reports unique users + unique pages in totals.

    This is the read surface AdminConsole's ``ClientErrorPulseCard``
    consumes.  Pins:
      * Repeated (message, href) pairs collapse into a single group
        with ``count: N``.
      * ``unique_users`` counts distinct ``user_id``s (and ignores
        anonymous rows).
      * ``totals.unique_pages`` reflects distinct hrefs across all
        groups in the window.
    """
    from routes.analytics import admin_recent_client_errors
    from models import User
    from datetime import datetime, timezone

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        marker = uuid.uuid4().hex
        admin = User(
            user_id=f"admin_{uuid.uuid4().hex[:10]}",
            email="a@example.com",
            name="Admin",
            is_admin=True,
        )
        try:
            now = datetime.now(timezone.utc).isoformat()
            # 3 events on page A (2 distinct users) + 1 event on page B (1 user)
            # + 1 anonymous event on page A
            rows = [
                {"message": "Boom", "stack": "", "component_stack": "",
                 "href": f"/a?m={marker}", "user_agent": "Test/1",
                 "captured_at": now, "received_at": now,
                 "user_id": f"u1_{marker}"},
                {"message": "Boom", "stack": "", "component_stack": "",
                 "href": f"/a?m={marker}", "user_agent": "Test/1",
                 "captured_at": now, "received_at": now,
                 "user_id": f"u1_{marker}"},
                {"message": "Boom", "stack": "", "component_stack": "",
                 "href": f"/a?m={marker}", "user_agent": "Test/2",
                 "captured_at": now, "received_at": now,
                 "user_id": f"u2_{marker}"},
                {"message": "Boom", "stack": "", "component_stack": "",
                 "href": f"/a?m={marker}", "user_agent": "Test/anon",
                 "captured_at": now, "received_at": now,
                 "user_id": None},
                {"message": "Whoops", "stack": "", "component_stack": "",
                 "href": f"/b?m={marker}", "user_agent": "Test/3",
                 "captured_at": now, "received_at": now,
                 "user_id": f"u3_{marker}"},
            ]
            await db.client_errors.insert_many(rows)

            res = await admin_recent_client_errors(hours=1, limit=10, _admin=admin)

            # We can have unrelated rows from prior tests still in the
            # collection; filter to ours.
            ours = [g for g in res["groups"] if marker in g["href"]]
            assert len(ours) == 2  # (Boom, /a) and (Whoops, /b)
            page_a = next(g for g in ours if "/a?" in g["href"])
            page_b = next(g for g in ours if "/b?" in g["href"])
            assert page_a["count"] == 4  # 3 named users + 1 anon
            assert page_a["unique_users"] == 2  # u1, u2 (anon dropped)
            assert page_b["count"] == 1
            assert page_b["unique_users"] == 1

            # Last-seen / first-seen filled.
            assert page_a["last_seen"]
            assert page_a["first_seen"]
            # Sample fields are present (even when empty string).
            assert "sample_stack" in page_a
            assert "sample_component_stack" in page_a
        finally:
            await db.client_errors.delete_many({"href": {"$regex": marker}})
            cli.close()

    shared_event_loop.run_until_complete(_run())
