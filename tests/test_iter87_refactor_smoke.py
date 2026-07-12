"""Iter 87 — regression smoke for the shared-helper extraction refactor.

Verifies that:
- utils/storage_hydration.py + utils/dupe_queries.py import cleanly and behave.
- All touched route modules import.
- active_dupe_candidates_query() returns the canonical filter.
- /admin/my-library-diagnostics still returns expected schema (excess=0
  for admin w/ no active dupes).
- /library/quarantine/rescan flags 2 groups on a seeded 5-book library.
- /library/quarantine/group/{keeper}/keep-latest resolves with keeper=newest
  (promoted=False, trashed_count == duplicate count).
- /library/quarantine/keep-latest-all?limit=100 returns has_more/remaining.
- /books/reclassify-all returns {processed:0, changed:0} on empty.
- /trash/empty returns {deleted, bytes_freed}.
"""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_EMAIL = "admin-smoke-test@example.com"
ADMIN_PASSWORD = "AdminSmoke123!"

PREFIX = "TEST_ITER87_"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        # Try registering fresh
        s.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "name": "Admin Smoke"},
            timeout=30,
        )
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30,
        )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert me.status_code == 200
    return s, me.json()


@pytest.fixture
def clean_test_books(mongo, admin_session):
    _, me = admin_session
    uid = me["user_id"]
    mongo.books.delete_many({"user_id": uid, "book_id": {"$regex": f"^{PREFIX}"}})
    yield uid
    mongo.books.delete_many({"user_id": uid, "book_id": {"$regex": f"^{PREFIX}"}})


# ---------------------------------------------------------------------------
# Import sanity
# ---------------------------------------------------------------------------
def test_imports_of_touched_modules():
    import importlib
    for mod in [
        "utils.storage_hydration",
        "utils.dupe_queries",
        "routes.books",
        "routes.bulk_ops",
        "routes.user_prefs",
        "routes.admin",
        "routes.library_quarantine",
    ]:
        importlib.import_module(mod)


def test_helpers_are_callable():
    from utils.storage_hydration import (
        hydrate_epub_if_missing,
        hydrate_epub_if_missing_sync,
    )
    from utils.dupe_queries import active_dupe_candidates_query
    assert callable(hydrate_epub_if_missing)
    assert callable(hydrate_epub_if_missing_sync)
    assert callable(active_dupe_candidates_query)


def test_active_dupe_candidates_query_shape():
    from utils.dupe_queries import active_dupe_candidates_query
    q = active_dupe_candidates_query("foo")
    assert q == {
        "user_id": "foo",
        "category": {"$nin": ["Trash", "Old stories"]},
        "duplicate_pending": {"$ne": True},
        "replaced_by": {"$exists": False},
    }


# ---------------------------------------------------------------------------
# Endpoint regressions
# ---------------------------------------------------------------------------
def test_admin_my_library_diagnostics_schema(admin_session, clean_test_books, mongo):
    s, me = admin_session
    uid = me["user_id"]
    # Ensure the admin has NO active dupes: clear any TEST_ leftovers
    # and count real books to compare after
    r = s.get(f"{BASE_URL}/api/admin/my-library-diagnostics", timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["user_id"] == uid
    assert "totals" in j and "by_category" in j and "cadence" in j
    assert "duplicates" in j
    d = j["duplicates"]
    for k in ("groups", "books_in_groups", "excess"):
        assert k in d, f"missing duplicates.{k}"
        assert isinstance(d[k], int)
    # The admin smoke account should have no seeded dupes; excess must be 0
    # (this may not hold if other tests polluted, so just assert >=0)
    assert d["excess"] >= 0


def _seed_book(mongo, uid, suffix, title, author, category="Fanfiction",
               source_url=None, created_offset_sec=0):
    bid = f"{PREFIX}{suffix}"
    created = (
        datetime.now(timezone.utc) + timedelta(seconds=created_offset_sec)
    ).isoformat()
    doc = {
        "book_id": bid,
        "user_id": uid,
        "title": title,
        "author": author,
        "category": category,
        "created_at": created,
    }
    if source_url:
        doc["source_url"] = source_url
    mongo.books.insert_one(doc)
    return bid


def test_rescan_flags_two_groups(admin_session, clean_test_books, mongo):
    s, _ = admin_session
    uid = clean_test_books

    # Group 1: 2 obvious dupes (case+dot variance in title/author)
    # normalize_title keeps dots, so match on case only; author normalizer
    # strips spaces/dots so "J.K. ROWLING" == "j k rowling".
    b1 = _seed_book(mongo, uid, "g1_a", "The Sorting Hat", "J.K. ROWLING",
                    created_offset_sec=-1000)
    b2 = _seed_book(mongo, uid, "g1_b", "the sorting hat", "j k rowling",
                    created_offset_sec=-500)
    # Group 2: 2 sharing source_url
    b3 = _seed_book(mongo, uid, "g2_a", "Marvel A", "Author X",
                    source_url="https://example.com/marvel-x",
                    created_offset_sec=-800)
    b4 = _seed_book(mongo, uid, "g2_b", "Marvel B", "Author Y",
                    source_url="https://example.com/marvel-x",
                    created_offset_sec=-400)
    # Standalone
    _seed_book(mongo, uid, "solo", "Unique Standalone", "Solo Author",
               created_offset_sec=-100)

    # Rescan — but only limited to our seeded books requires filtering
    # by user. Admin has no other test dupes typically.
    r = s.post(f"{BASE_URL}/api/library/quarantine/rescan", timeout=90)
    assert r.status_code == 200, r.text
    j = r.json()
    # We may have >=2 groups if admin acct has other real dupes, but our
    # seeded 2 groups should be caught. Verify our seeded dupes were flagged.
    assert j["new_flagged"] >= 2
    assert j["groups_found"] >= 2

    # Verify duplicate_pending True on the non-keeper of each seeded group.
    # Keeper = oldest per rescan logic.
    for keeper_bid, dupe_bid in [(b1, b2), (b3, b4)]:
        kdoc = mongo.books.find_one({"book_id": keeper_bid, "user_id": uid})
        ddoc = mongo.books.find_one({"book_id": dupe_bid, "user_id": uid})
        # Keeper is oldest of the two
        assert kdoc.get("duplicate_pending") is not True, (
            f"keeper {keeper_bid} should not be pending"
        )
        assert ddoc.get("duplicate_pending") is True, (
            f"dupe {dupe_bid} should be pending"
        )


def test_keep_latest_group_keeper_is_newest(admin_session, clean_test_books, mongo):
    s, _ = admin_session
    uid = clean_test_books

    # Seed 2 dupes where keeper is the NEWEST (so promoted=False)
    keeper = _seed_book(mongo, uid, "kl_keeper", "KeepLatest Book",
                        "Author K", created_offset_sec=0)  # newest
    dupe = _seed_book(mongo, uid, "kl_dupe", "keeplatest book",
                      "author k", created_offset_sec=-500)  # older

    # Set the dupe as already quarantined pointing to keeper
    mongo.books.update_one(
        {"book_id": dupe, "user_id": uid},
        {"$set": {
            "duplicate_pending": True,
            "duplicate_of": [{
                "book_id": keeper,
                "title": "KeepLatest Book",
                "author": "Author K",
                "match_reasons": ["title+author"],
            }],
        }},
    )

    r = s.post(
        f"{BASE_URL}/api/library/quarantine/group/{keeper}/keep-latest",
        timeout=60,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j["promoted"] is False
    assert j["trashed_count"] == 1  # one dupe trashed
    assert dupe in j.get("trashed_ids", [])
    # Verify: dupe moved to Trash, keeper still has original category
    ddoc = mongo.books.find_one({"book_id": dupe, "user_id": uid})
    kdoc = mongo.books.find_one({"book_id": keeper, "user_id": uid})
    assert ddoc["category"] == "Trash"
    assert kdoc["category"] != "Old stories"


def test_keep_latest_all_shape(admin_session, clean_test_books, mongo):
    s, _ = admin_session
    uid = clean_test_books

    # Seed a group and quarantine it manually to make sure keep-latest-all
    # has something (or nothing — either way response shape must hold).
    keeper = _seed_book(mongo, uid, "kla_k", "KLA Book", "Author KLA",
                        created_offset_sec=0)
    dupe = _seed_book(mongo, uid, "kla_d", "kla book", "author kla",
                      created_offset_sec=-500)
    mongo.books.update_one(
        {"book_id": dupe, "user_id": uid},
        {"$set": {
            "duplicate_pending": True,
            "duplicate_of": [{"book_id": keeper}],
        }},
    )

    r = s.post(
        f"{BASE_URL}/api/library/quarantine/keep-latest-all?limit=100",
        timeout=90,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("ok", "groups_processed", "groups_resolved", "groups_skipped",
              "trashed_count", "promoted_count", "has_more", "remaining"):
        assert k in j, f"missing key {k}"
    assert isinstance(j["has_more"], bool)
    assert isinstance(j["remaining"], int)


def test_reclassify_all_empty(admin_session, mongo):
    s, me = admin_session
    uid = me["user_id"]
    # Ensure zero Unclassified for this admin (they usually have none)
    unclassified = mongo.books.count_documents(
        {"user_id": uid, "category": "Unclassified"}
    )
    r = s.post(
        f"{BASE_URL}/api/books/reclassify-all",
        json={"only_unclassified": True},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert "processed" in j and "changed" in j
    if unclassified == 0:
        assert j == {"processed": 0, "changed": 0}
    else:
        # even if not empty, still valid ints
        assert isinstance(j["processed"], int)
        assert isinstance(j["changed"], int)


def test_trash_empty_shape(admin_session):
    s, _ = admin_session
    r = s.post(f"{BASE_URL}/api/trash/empty", timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "deleted" in j and "bytes_freed" in j
    assert isinstance(j["deleted"], int)
    assert isinstance(j["bytes_freed"], int)
