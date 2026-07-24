"""Unit tests for the MaxTimeMSExpired-tolerant retry in upsert_fulltext.

Regression guard for the 2026-07-21 prod incident where 46 uploads
failed with ``code:50 MaxTimeMSExpired`` from the fulltext write.
The retry loop must swallow up to 3 transient timeouts on a single
book and keep the upload pipeline moving; a persistent failure must
NOT re-raise (fulltext is best-effort).

No pytest-asyncio in this project — tests use ``asyncio.run``.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


class _FakeCollection:
    def __init__(self, fail_times: int, exc):
        self.fail_times = fail_times
        self.exc = exc
        self.calls = 0

    async def update_one(self, *args, **kwargs):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self.exc
        return SimpleNamespace(matched_count=1, upserted_id=None)


async def _no_sleep(*_a, **_kw):
    """Replacement for asyncio.sleep so the retry test is instant."""
    return None


def _patch_sleep(monkeypatch):
    from utils import epub_fulltext
    monkeypatch.setattr(epub_fulltext.__asyncio, "sleep", _no_sleep)


def test_upsert_fulltext_succeeds_on_first_try(monkeypatch):
    from utils import epub_fulltext
    _patch_sleep(monkeypatch)
    coll = _FakeCollection(fail_times=0, exc=Exception("nope"))
    db = SimpleNamespace(book_fulltext=coll)
    asyncio.run(epub_fulltext.upsert_fulltext(db, "book_x", "user_x", "hello"))
    assert coll.calls == 1


def test_upsert_fulltext_retries_on_timeout(monkeypatch):
    from utils import epub_fulltext
    from pymongo.errors import ExecutionTimeout
    _patch_sleep(monkeypatch)
    coll = _FakeCollection(fail_times=2, exc=ExecutionTimeout("operation exceeded time limit"))
    db = SimpleNamespace(book_fulltext=coll)
    asyncio.run(epub_fulltext.upsert_fulltext(db, "book_x", "user_x", "a" * 100_000))
    # 2 timeouts + 1 success = 3 total calls
    assert coll.calls == 3


def test_upsert_fulltext_gives_up_after_3_timeouts(monkeypatch):
    """Persistent timeouts should NOT re-raise — fulltext is
    best-effort, admin backfill card can re-run missing rows later."""
    from utils import epub_fulltext
    from pymongo.errors import ExecutionTimeout
    _patch_sleep(monkeypatch)
    coll = _FakeCollection(fail_times=99, exc=ExecutionTimeout("boom"))
    db = SimpleNamespace(book_fulltext=coll)
    asyncio.run(epub_fulltext.upsert_fulltext(db, "book_persistent", "user_x", "text"))
    assert coll.calls == 3


def test_upsert_fulltext_rethrows_non_timeout_op_failures(monkeypatch):
    """Non-timeout OperationFailure (e.g. code 121 DocumentValidationFailure)
    must propagate — bad input is not something we want to silently swallow."""
    from utils import epub_fulltext
    from pymongo.errors import OperationFailure
    _patch_sleep(monkeypatch)
    err = OperationFailure("bad document", code=121)
    coll = _FakeCollection(fail_times=99, exc=err)
    db = SimpleNamespace(book_fulltext=coll)
    with pytest.raises(OperationFailure):
        asyncio.run(epub_fulltext.upsert_fulltext(db, "book_bad", "user_x", "text"))
    assert coll.calls == 1  # rethrown on the first non-timeout error


def test_upsert_fulltext_swallows_code_50_operation_failure(monkeypatch):
    """Some driver versions raise OperationFailure(code=50) instead of
    ExecutionTimeout for MaxTimeMSExpired.  Both must be treated as
    transient timeouts."""
    from utils import epub_fulltext
    from pymongo.errors import OperationFailure
    _patch_sleep(monkeypatch)
    err = OperationFailure("operation exceeded time limit", code=50)
    coll = _FakeCollection(fail_times=2, exc=err)
    db = SimpleNamespace(book_fulltext=coll)
    asyncio.run(epub_fulltext.upsert_fulltext(db, "book_x", "user_x", "text"))
    assert coll.calls == 3
