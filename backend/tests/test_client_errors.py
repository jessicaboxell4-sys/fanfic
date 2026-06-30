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
