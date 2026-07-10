"""Staged-upload drafts (2026-06-30).

The frontend's "Stage before upload" tray persists file metadata
(names, sizes, relative paths) to ``/api/uploads/staged-drafts``
so the user can come back after a refresh and see a restore
banner like::

    "You had 47 files staged 12 minutes ago from `Books/Kindle`."

These tests pin the upsert / read / delete contract and the
server-side ``source_hints`` derivation, which is what powers the
banner's "From folders: ..." line.
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

from models import User  # noqa: E402


def _user_stub(user_id: str) -> User:
    return User(
        user_id=user_id,
        email=f"{user_id}@example.com",
        name="Draft Test",
        is_admin=False,
    )


def test_put_get_delete_round_trip(shared_event_loop):
    """Upsert a draft, read it back, delete it, confirm gone."""
    from routes.staged_drafts import (
        put_staged_draft,
        get_staged_draft,
        delete_staged_draft,
    )

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            res = await put_staged_draft(
                payload={
                    "files": [
                        {"name": "lotr.epub", "size": 12345, "rel_path": "Books/Fantasy/Tolkien/lotr.epub"},
                        {"name": "hobbit.epub", "size": 9999, "rel_path": "Books/Fantasy/Tolkien/hobbit.epub"},
                        {"name": "dune.epub", "size": 54321, "rel_path": "Books/SciFi/dune.epub"},
                    ]
                },
                user=_user_stub(user_id),
            )
            assert res["saved"] == 3
            assert res["cleared"] is False
            # ``Books/Fantasy/Tolkien`` (3 segs, the filename was dropped)
            # and ``Books/SciFi`` (only 2 levels deep).
            assert set(res["source_hints"]) == {"Books/Fantasy/Tolkien", "Books/SciFi"}
            assert res["total_bytes"] == 12345 + 9999 + 54321

            got = await get_staged_draft(user=_user_stub(user_id))
            assert got["draft"] is not None
            assert got["draft"]["user_id"] == user_id
            assert len(got["draft"]["files"]) == 3
            assert got["draft"]["total_bytes"] == 76665

            await delete_staged_draft(user=_user_stub(user_id))
            gone = await get_staged_draft(user=_user_stub(user_id))
            assert gone["draft"] is None
        finally:
            await db.staged_drafts.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_empty_files_clears_existing_draft(shared_event_loop):
    """PUT with empty ``files`` should delete the row, not write
    an empty stub.  Surface uses this when the tray hits zero."""
    from routes.staged_drafts import put_staged_draft, get_staged_draft

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            await put_staged_draft(
                payload={"files": [{"name": "a.epub", "size": 1, "rel_path": ""}]},
                user=_user_stub(user_id),
            )
            res = await put_staged_draft(payload={"files": []}, user=_user_stub(user_id))
            assert res["saved"] == 0
            assert res["cleared"] is True
            got = await get_staged_draft(user=_user_stub(user_id))
            assert got["draft"] is None
        finally:
            await db.staged_drafts.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_source_hints_skip_bare_filenames_and_dedupe(shared_event_loop):
    """Files without a folder component contribute no hint (we don't
    want to fabricate folders from single-file picks).  Hints across
    multiple files in the same root must dedupe."""
    from routes.staged_drafts import put_staged_draft

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            res = await put_staged_draft(
                payload={
                    "files": [
                        {"name": "bare.epub", "size": 1, "rel_path": ""},
                        {"name": "alpha.epub", "size": 2, "rel_path": "Library/alpha.epub"},
                        {"name": "beta.epub", "size": 3, "rel_path": "Library/beta.epub"},
                        {"name": "z.epub", "size": 4, "rel_path": "Other/z.epub"},
                    ]
                },
                user=_user_stub(user_id),
            )
            assert set(res["source_hints"]) == {"Library", "Other"}
            assert res["saved"] == 4
        finally:
            await db.staged_drafts.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_hard_caps_protect_against_runaway_payloads(shared_event_loop):
    """File count is capped at 5_000 and per-row strings get truncated."""
    from routes.staged_drafts import (
        put_staged_draft,
        get_staged_draft,
        _MAX_FILES_PER_DRAFT,
        _MAX_REL_PATH_LEN,
    )

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        user_id = f"user_{uuid.uuid4().hex[:10]}"
        try:
            huge_path = "a/" * (_MAX_REL_PATH_LEN + 50)
            payload_files = [
                {"name": f"f{i}.epub", "size": i, "rel_path": huge_path}
                for i in range(_MAX_FILES_PER_DRAFT + 25)
            ]
            res = await put_staged_draft(
                payload={"files": payload_files},
                user=_user_stub(user_id),
            )
            assert res["saved"] == _MAX_FILES_PER_DRAFT
            got = await get_staged_draft(user=_user_stub(user_id))
            stored = got["draft"]["files"]
            assert len(stored) == _MAX_FILES_PER_DRAFT
            assert len(stored[0]["rel_path"]) <= _MAX_REL_PATH_LEN
        finally:
            await db.staged_drafts.delete_many({"user_id": user_id})
            cli.close()

    shared_event_loop.run_until_complete(_run())
