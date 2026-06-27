"""Test-account detection helper.

Several flows in the codebase (signup, admin pending inbox, audit log,
global-stats rollups, public ``/landing/stats`` counters) need to know
whether an email belongs to an automated test fixture so the real
admin queue, KPI cards, and homepage social proof don't get inflated
by agent-created accounts.

The detection is purely lexical — we look at the email's local part
and domain.  A central regex/predicate keeps the convention in one
place so changes ripple everywhere.

Patterns currently classed as "test":
  Domain endings:
    - ``@test.local``               (testing-agent convention)
    - ``@example.com|.org|.net``    (RFC 2606 reserved test domains)
    - ``@x.com``, ``@e.com``, ``@t.com``
                                    (single-letter throwaway domains
                                     only ever observed from QA seeds)
    - ``@ft.local``, ``@ft.loca``   (frontend-tester fixture domain;
                                     the truncated ``.loca`` variant
                                     is from a malformed seed)
  Local-part prefixes:
    - ``test_``, ``t_``, ``sync_``, ``linkless_``, ``qa_``, ``fixture_``
    - ``reg_``, ``check_``          (registration smoke fixtures)
    - ``open_user_``                (open-access tester seed)
    - ``user_``                     (catch-all agent prefix —
                                     ``user_a_*``, ``user_dk_*``,
                                     ``user_ft_*``, ``user_pull_*``,
                                     ``user_test_*``, ``user_ui_*``)

Real users that happen to use ``example.com`` or these prefixes will
still be able to *sign up* (we never block in auth.py) — they just
end up on the separate ``/admin/test-accounts`` triage page rather
than the main inbox.

If you change this list, also call
``/api/admin/test-account-backfill`` (or restart the backend — the
startup hook reapplies the flag) so the ``is_test_account=True`` flag
on existing user docs is regenerated.
"""
from __future__ import annotations

_TEST_DOMAINS = (
    "@test.local",
    "@test.com",
    "@test.example",
    "@example.com",
    "@example.org",
    "@example.net",
    "@x.com",
    "@e.com",
    "@t.com",
    "@ft.local",
    "@ft.loca",  # truncated agent seed — keep until those rows are cleaned
)

_TEST_LOCAL_PREFIXES = (
    "test_",
    "t_",
    "sync_",
    "linkless_",
    "qa_",
    "fixture_",
    "reg_",
    "check_",
    "open_user_",
    "user_",
    "iter",  # iter17_, iter18_, etc. — periodic agent fixtures
    "admin-smoke",
    "admin_smoke",
)


def is_test_account(email: str | None) -> bool:
    """Return True if the given email is recognisably a testing fixture.

    Also catches malformed emails that don't contain an ``@`` at all
    (e.g. ``user_ft_a_518edb``, ``user_ft_admin_3d963fAdmin``) — these
    are agent-created seed rows where the email field was set to a
    raw user_id, never a deliverable address.  Treating them as test
    keeps them out of the public counters.
    """
    if not email:
        return False
    e = email.strip().lower()
    if "@" not in e:
        # Malformed email — only ever produced by fixtures.
        return True
    if any(e.endswith(d) for d in _TEST_DOMAINS):
        return True
    local = e.split("@", 1)[0]
    return any(local.startswith(p) for p in _TEST_LOCAL_PREFIXES)


def mongo_test_account_filter() -> dict:
    """Return a Mongo ``$or`` filter matching test-account emails.

    Use as part of a wider query, e.g.::

        {"approval_status": "pending", **mongo_test_account_filter()}

    Or invert with ``$nor`` to exclude::

        {"$nor": mongo_test_account_filter()["$or"]}

    Mirrors ``is_test_account`` exactly — domain endings + local-part
    prefixes + missing-@ malformed addresses.
    """
    or_clauses: list[dict] = []
    backslash_dot = "\\."
    for dom in _TEST_DOMAINS:
        escaped = dom.replace(".", backslash_dot)
        or_clauses.append({"email": {"$regex": f"{escaped}$", "$options": "i"}})
    for pref in _TEST_LOCAL_PREFIXES:
        or_clauses.append({"email": {"$regex": f"^{pref}", "$options": "i"}})
    # Malformed emails with no @ at all — agent seeds where the
    # email field was set to a raw user_id.
    or_clauses.append({"email": {"$not": {"$regex": "@", "$options": "i"}}})
    return {"$or": or_clauses}


def mongo_exclude_tests_clause(email_field: str = "email") -> dict:
    """Return a Mongo ``$nor`` clause that excludes test-fixture rows
    by checking ``email_field`` against the same domain/prefix rules
    used by :func:`is_test_account`.

    Examples::

        # On the ``suggestions`` collection (Suggestions board, field
        # ``submitter_email``)
        q = {"suggestion_id": {"$exists": True}, **mongo_exclude_tests_clause("submitter_email")}

        # On the Help-page feedback rows (field ``user_email``)
        q = {"text": {"$exists": True}, **mongo_exclude_tests_clause("user_email")}

    Internally rewrites the canonical "match-test" $or to target the
    chosen field, then wraps in $nor.  Used by the admin Feedback inbox
    to hide TEST_ fixture rows from the human-facing queue without
    deleting them (so integration tests keep passing).
    """
    or_clauses = mongo_test_account_filter()["$or"]
    rewritten: list[dict] = []
    for c in or_clauses:
        # Each canonical clause is shaped {"email": {...}}.  Move the
        # body under the caller's field name.
        if "email" in c:
            rewritten.append({email_field: c["email"]})
        else:
            rewritten.append(c)
    # Also exclude rows where the email is null/missing — those are
    # ambiguous (anonymous Help-page feedback can have user_email=None)
    # and should not be treated as test fixtures.  The $nor only fires
    # on rows that POSITIVELY match a test pattern; null falls through
    # to "visible" automatically.  No extra clause needed.
    return {"$nor": rewritten}
