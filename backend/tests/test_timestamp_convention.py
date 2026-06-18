"""Regression test for the ISO-string timestamp convention.

Asserts that the critical timestamp-keyed collections only ever contain
ISO-8601 string values (never BSON ``Date``).  If this test ever fails,
a writer somewhere started stamping ``datetime`` objects instead of
calling :func:`utils.timestamps.utc_iso` — fix the writer, do NOT
loosen this test.
"""
from __future__ import annotations

import asyncio

import pytest

from deps import db


# (collection, timestamp_field)
CRITICAL_TIMESTAMPS = [
    ("community_covers", "shared_at"),
    ("page_views",       "ts"),
    ("page_views",       "hour_bucket"),
    ("cover_archive",    "archived_at"),
    ("reading_cursors",  "updated_at"),
    ("push_subscriptions", "created_at"),
]


def test_critical_timestamp_fields_are_iso_strings():
    """For every (collection, field) pair we care about, sample up to
    50 documents and assert each value is either missing or a `str`.
    BSON ``Date`` values fail-fast right here so we never have a
    silent-filter-mismatch bug in production again."""

    async def go():
        leaks = []
        for coll_name, field in CRITICAL_TIMESTAMPS:
            coll = db[coll_name]
            cursor = coll.find(
                {field: {"$exists": True}},
                {field: 1},
                limit=50,
            )
            async for doc in cursor:
                val = doc.get(field)
                if val is None:
                    continue
                if not isinstance(val, str):
                    leaks.append({
                        "collection": coll_name,
                        "field":      field,
                        "type":       type(val).__name__,
                        "_id":        str(doc.get("_id")),
                    })
        assert not leaks, (
            "Non-string timestamps found — a writer is bypassing "
            "utils.timestamps.utc_iso(): " + repr(leaks)
        )

    asyncio.get_event_loop().run_until_complete(go())


def test_utc_iso_helper_round_trips_to_string():
    """Smoke test for the helper itself — naïve, aware, and ``None``
    inputs all return an ISO-8601 UTC string with a ``+00:00`` offset."""
    from datetime import datetime, timezone
    from utils.timestamps import utc_iso, now_iso

    # None → now.
    s = utc_iso()
    assert isinstance(s, str)
    assert s.endswith("+00:00")
    # Naïve datetime is interpreted as UTC.
    s2 = utc_iso(datetime(2026, 6, 18, 12, 0, 0))
    assert s2 == "2026-06-18T12:00:00+00:00"
    # Aware datetime in another zone normalises to UTC.
    import datetime as _d
    pst = _d.timezone(_d.timedelta(hours=-8))
    s3 = utc_iso(datetime(2026, 6, 18, 4, 0, 0, tzinfo=pst))
    assert s3 == "2026-06-18T12:00:00+00:00"
    # now_iso is just a shorthand.
    assert isinstance(now_iso(), str)
