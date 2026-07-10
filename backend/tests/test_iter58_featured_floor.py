"""Iter 58 — Featured Readers eligibility floor + directory ★ stamp.

GET /api/library/featured now requires a bio in addition to
library_visible_to_public (the latter is already the implicit
score=1 ingredient).  In effect: the featured strip only samples
users with completeness_score >= 2 (full profile).
"""
from __future__ import annotations

import os
import uuid
import datetime as _dt

import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _seed_user(
    *,
    username: str,
    bio: str = "",
    library_public: bool = False,
    with_book: bool = True,
) -> str:
    """Insert an opted-in user.  By default, also seeds one
    non-infected book so the user passes the ``total_books > 0``
    filter inside featured_libraries."""
    uid = f"user_iter58_{uuid.uuid4().hex[:10]}"
    c = _mongo()
    dbn = _db_name()
    c[dbn].users.insert_one({
        "user_id":            uid,
        "email":              f"{uid}@example.com",
        "name":               username,
        "username":           username,
        "username_lower":     username.lower(),
        "bio":                bio,
        "library_visible_to_public": library_public,
        "approval_status":    "approved",
        "hidden_from_search": False,
        "created_at":         _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "password_hash":      "",
    })
    if with_book:
        c[dbn].books.insert_one({
            "book_id":   f"bk_iter58_{uuid.uuid4().hex[:8]}",
            "user_id":   uid,
            "title":     "Iter58 Seed",
            "author":    "QA",
            "fandom":    "Iter58 Fandom",
            "av_status": "clean",
        })
    c.close()
    return uid


def _cleanup(uids: list[str]) -> None:
    if not uids:
        return
    c = _mongo()
    dbn = _db_name()
    c[dbn].users.delete_many({"user_id": {"$in": uids}})
    c[dbn].books.delete_many({"user_id": {"$in": uids}})
    c.close()


# -----------------------------------------------------------------
# (1) A bio-less opt-in user is EXCLUDED from the featured sample
# -----------------------------------------------------------------
def test_featured_excludes_bio_less_opt_in():
    """Library-public but no bio → must NOT appear in /library/featured."""
    nonce = uuid.uuid4().hex[:6]
    bareuser = f"zzz_iter58_bare_{nonce}"
    seeded: list[str] = []
    try:
        seeded.append(_seed_user(
            username=bareuser, bio="", library_public=True, with_book=True,
        ))
        # Call the endpoint enough times that the random sample would
        # almost certainly hit our bare user if it were eligible
        # (the implementation over-fetches 3x and there are typically
        # very few opted-in users in the preview DB).
        seen = set()
        for _ in range(8):
            r = requests.get(f"{BASE_URL}/api/library/featured?limit=10", timeout=15)
            assert r.status_code == 200, r.text
            for u in r.json().get("featured", []):
                seen.add(u.get("username"))
        assert bareuser not in seen, (
            f"bare user (no bio) should NOT appear in featured: saw {bareuser}"
        )
    finally:
        _cleanup(seeded)


# -----------------------------------------------------------------
# (2) A bio+public user IS eligible (sampled at least once)
# -----------------------------------------------------------------
def test_featured_includes_full_profile_user():
    """Library-public + bio + has books → eligible for featured."""
    nonce = uuid.uuid4().hex[:6]
    fulluser = f"zzz_iter58_full_{nonce}"
    seeded: list[str] = []
    try:
        seeded.append(_seed_user(
            username=fulluser,
            bio="QA bio for featured-eligibility test",
            library_public=True,
            with_book=True,
        ))
        # Sample repeatedly so even with a busy preview DB we hit them.
        seen = set()
        for _ in range(15):
            r = requests.get(f"{BASE_URL}/api/library/featured?limit=10", timeout=15)
            assert r.status_code == 200, r.text
            for u in r.json().get("featured", []):
                seen.add(u.get("username"))
        assert fulluser in seen, (
            f"full-profile user should appear in featured within 15 samples; saw {len(seen)} unique"
        )
    finally:
        _cleanup(seeded)


# -----------------------------------------------------------------
# (3) Featured payload always has non-empty bio
# -----------------------------------------------------------------
def test_featured_payload_all_have_bio():
    """Every row returned by /library/featured has a non-empty bio."""
    # This is a passive check — doesn't rely on seeding, just verifies
    # the existing prod-like sample's invariant.  If no rows come
    # back at all the test is a no-op (still passes).
    for _ in range(3):
        r = requests.get(f"{BASE_URL}/api/library/featured?limit=10", timeout=15)
        assert r.status_code == 200, r.text
        for u in r.json().get("featured", []):
            assert (u.get("bio") or "").strip(), (
                f"featured row {u.get('username')!r} has empty bio — floor broken"
            )
