"""Cloud-staging durability tests — verify the 3× retry + backfill
sweeper close the "Staging directory vanished" failure window.

Motivated by the 2026-07-01 morning incident where 8 uploads landed
during an OOM crisis, had their first R2 mirror attempt fail (silently
swallowed → ``cloud_key=None``), then the pod restarted and the local
bytes were wiped.  The recovery path couldn't restore because there
was no cloud copy.  These tests pin:

  1. ``backfill_cloud_staging`` finds queued/processing jobs whose
     ``staged_files`` have ``cloud_key=None`` but the file still
     exists on local disk, and writes the cloud_key back.
  2. Files whose local path no longer exists are skipped (not
     re-mirrored — impossible anyway) and don't crash the sweeper.
  3. Files that already have a cloud_key are left alone (idempotent).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _make_fake_storage(mirror_up_ok: bool = True):
    ns = MagicMock()
    ns.is_enabled.return_value = True
    ns.mirror_up.return_value = mirror_up_ok
    return ns


@pytest.fixture
def tmp_staged_file(tmp_path):
    f = tmp_path / "0000__book.epub"
    f.write_bytes(b"epub bytes")
    return f


def _drive(coro):
    """Small helper — the file uses conftest's shared_event_loop
    convention elsewhere but this test doesn't need the shared loop."""
    return asyncio.get_event_loop().run_until_complete(coro)


def test_backfill_mirrors_missing_cloud_keys(shared_event_loop, tmp_staged_file, monkeypatch):
    """Job with cloud_key=None but local file present → gets mirrored."""
    from routes import upload_jobs

    job = {
        "job_id": "job_abc",
        "user_id": "user_test",
        "staged_files": [
            {"path": str(tmp_staged_file), "cloud_key": None, "original_name": "book.epub", "size": 10},
        ],
    }
    # Fake the mongo cursor + updates.
    fake_db = MagicMock()
    fake_cursor = MagicMock()

    async def _agen(items):
        for it in items:
            yield it
    fake_cursor.__aiter__ = lambda self: _agen([job])
    fake_db.upload_jobs.find.return_value = fake_cursor
    fake_db.upload_jobs.update_one = AsyncMock()

    fake_storage = _make_fake_storage(mirror_up_ok=True)

    monkeypatch.setattr(upload_jobs, "db", fake_db)
    with patch.dict("sys.modules", {"utils.storage_cloud": fake_storage}):
        mirrored = shared_event_loop.run_until_complete(upload_jobs.backfill_cloud_staging())

    assert mirrored == 1
    fake_storage.mirror_up.assert_called_once()
    fake_db.upload_jobs.update_one.assert_awaited_once()
    # The staged_files array passed to update_one should now have cloud_key set.
    args = fake_db.upload_jobs.update_one.await_args
    updated = args.args[1]["$set"]["staged_files"][0]
    assert updated["cloud_key"] is not None
    assert "_staging/user_test/job_abc/" in updated["cloud_key"]


def test_backfill_skips_files_whose_local_path_is_gone(shared_event_loop, tmp_path, monkeypatch):
    """Local file already vanished → skip silently, don't crash."""
    from routes import upload_jobs

    ghost = str(tmp_path / "gone.epub")  # never created
    job = {
        "job_id": "job_ghost",
        "user_id": "user_test",
        "staged_files": [
            {"path": ghost, "cloud_key": None, "original_name": "gone.epub", "size": 10},
        ],
    }
    fake_db = MagicMock()
    fake_cursor = MagicMock()

    async def _agen(items):
        for it in items:
            yield it
    fake_cursor.__aiter__ = lambda self: _agen([job])
    fake_db.upload_jobs.find.return_value = fake_cursor
    fake_db.upload_jobs.update_one = AsyncMock()

    fake_storage = _make_fake_storage(mirror_up_ok=True)
    monkeypatch.setattr(upload_jobs, "db", fake_db)
    with patch.dict("sys.modules", {"utils.storage_cloud": fake_storage}):
        mirrored = shared_event_loop.run_until_complete(upload_jobs.backfill_cloud_staging())

    assert mirrored == 0
    fake_storage.mirror_up.assert_not_called()
    fake_db.upload_jobs.update_one.assert_not_awaited()


def test_backfill_leaves_already_mirrored_files_alone(shared_event_loop, tmp_staged_file, monkeypatch):
    """cloud_key already set → nothing to do."""
    from routes import upload_jobs

    job = {
        "job_id": "job_ok",
        "user_id": "user_test",
        "staged_files": [
            {"path": str(tmp_staged_file), "cloud_key": "_staging/user_test/job_ok/0000__book.epub", "original_name": "book.epub", "size": 10},
        ],
    }
    fake_db = MagicMock()
    fake_cursor = MagicMock()

    async def _agen(items):
        for it in items:
            yield it
    fake_cursor.__aiter__ = lambda self: _agen([job])
    fake_db.upload_jobs.find.return_value = fake_cursor
    fake_db.upload_jobs.update_one = AsyncMock()

    fake_storage = _make_fake_storage(mirror_up_ok=True)
    monkeypatch.setattr(upload_jobs, "db", fake_db)
    with patch.dict("sys.modules", {"utils.storage_cloud": fake_storage}):
        mirrored = shared_event_loop.run_until_complete(upload_jobs.backfill_cloud_staging())

    assert mirrored == 0
    fake_storage.mirror_up.assert_not_called()


def test_backfill_no_op_when_cloud_storage_disabled(shared_event_loop, monkeypatch):
    """If storage_cloud.is_enabled() is False → return 0 immediately."""
    from routes import upload_jobs

    ns = MagicMock()
    ns.is_enabled.return_value = False
    with patch.dict("sys.modules", {"utils.storage_cloud": ns}):
        mirrored = shared_event_loop.run_until_complete(upload_jobs.backfill_cloud_staging())

    assert mirrored == 0
    ns.mirror_up.assert_not_called()
