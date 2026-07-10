"""Single source of truth for timestamp serialisation.

Shelfsort stores every timestamp as an ISO-8601 UTC string with the
``+00:00`` offset (NOT a BSON ``Date``).  This convention lets us use
plain ``$gte`` / ``$lt`` Mongo comparisons against literal strings (e.g.
``{"shared_at": {"$gte": cutoff.isoformat()}}``) without parsing on
either side — at the cost of being one fragile typo away from a silent
filter mismatch if a future writer ever decides to store a BSON ``Date``
instead.

To make the convention impossible to violate, every writer should call
:func:`utc_iso` (or :func:`now_iso`) when stamping a timestamp.  The
companion test in ``tests/test_timestamp_convention.py`` asserts the
critical collections continue to only contain strings in this format.

Why not BSON Date?

* ISO strings sort lexically the same as chronologically (when zero-
  padded UTC offsets are used), so range queries work without parsing.
* No deserialisation needed in the API layer — strings round-trip
  through JSON natively.
* Pre-existing data is already stringly-typed; switching now requires
  a one-shot migration we don't need.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def utc_iso(dt: Optional[datetime] = None) -> str:
    """Return ``dt`` (default ``now``) as an ISO-8601 UTC string with
    ``+00:00`` offset.  Naïve datetimes are assumed to be UTC."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def now_iso() -> str:
    """Shorthand for ``utc_iso(datetime.now(timezone.utc))``."""
    return datetime.now(timezone.utc).isoformat()
