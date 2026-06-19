"""Test-account detection helper.

Several flows in the codebase (signup, admin pending inbox, audit log)
need to know whether an email belongs to an automated test account so
the real admin queue doesn't fill up with fixtures from the testing
agent.

The detection is purely lexical — we look at the email's local part
and domain.  A central regex/predicate keeps the convention in one
place so changes ripple everywhere.

Patterns currently classed as "test":
  - Domain ends with ``@test.local`` (deliberate testing-agent convention)
  - Domain ends with ``@example.com`` / ``@example.org`` (RFC 2606 reserved
    test domains — never deliverable, only ever used by fixtures)
  - Local part starts with ``test_``, ``t_``, ``sync_``, ``linkless_``
    (testing-agent prefixes observed in /admin/pending)

Real users that happen to use ``example.com`` or these prefixes will
still be able to *sign up* (we never block in auth.py) — they just
end up on the separate ``/admin/test-accounts`` triage page rather
than the main inbox.
"""
from __future__ import annotations

_TEST_DOMAINS = ("@test.local", "@example.com", "@example.org", "@example.net")
_TEST_LOCAL_PREFIXES = ("test_", "t_", "sync_", "linkless_", "qa_", "fixture_")


def is_test_account(email: str | None) -> bool:
    """Return True if the given email is recognisably a testing fixture."""
    if not email:
        return False
    e = email.strip().lower()
    if any(e.endswith(d) for d in _TEST_DOMAINS):
        return True
    local = e.split("@", 1)[0]
    return any(local.startswith(p) for p in _TEST_LOCAL_PREFIXES)


def mongo_test_account_filter() -> dict:
    """Return a Mongo `$or` filter matching test-account emails.

    Use as part of a wider query, e.g.:
        ``{"approval_status": "pending", **{"$or": mongo_test_account_filter()["$or"]}}``
    Or invert with `$nor` to exclude them.
    """
    or_clauses: list[dict] = []
    backslash_dot = "\\."
    for dom in _TEST_DOMAINS:
        escaped = dom.replace(".", backslash_dot)
        or_clauses.append({"email": {"$regex": f"{escaped}$", "$options": "i"}})
    for pref in _TEST_LOCAL_PREFIXES:
        or_clauses.append({"email": {"$regex": f"^{pref}", "$options": "i"}})
    return {"$or": or_clauses}
