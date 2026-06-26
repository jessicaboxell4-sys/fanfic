"""Iter 57 — Profile-completeness directory sort.

Verifies that GET /api/users/directory sorts users by completeness
score (DESC), with username alphabetical as a tie-breaker.

Score = (has bio) + (library_visible_to_public).  Everyone in the
result has a username (it's a hard filter), so the max score is 2
and the min is 0.
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


def _register(prefix: str = "iter57") -> tuple[requests.Session, str, str]:
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw!", "name": f"{prefix} user"},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    data = r.json()
    uid = data.get("user_id") or data.get("user", {}).get("user_id")
    return s, email, uid


def _seed_user_in_directory(
    *,
    username: str,
    bio: str = "",
    library_public: bool = False,
) -> str:
    """Insert a user that will appear in /api/users/directory."""
    uid = f"user_iter57_{uuid.uuid4().hex[:10]}"
    c = _mongo()
    c[_db_name()].users.insert_one({
        "user_id":            uid,
        "email":              f"{uid}@example.com",
        "name":               username,
        "username":           username,
        "username_lower":     username.lower(),
        "bio":                bio,
        "library_visible_to_public": library_public,
        "hidden_from_search": False,
        "created_at":         _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "password_hash":      "",
    })
    c.close()
    return uid


def _cleanup(uids: list[str]) -> None:
    if not uids:
        return
    c = _mongo()
    c[_db_name()].users.delete_many({"user_id": {"$in": uids}})
    c.close()


# -----------------------------------------------------------------
# Completeness score surfaced in payload
# -----------------------------------------------------------------
def test_directory_returns_completeness_score():
    """Each row has a `completeness_score` int (0-2)."""
    s, _, _ = _register("iter57shape")
    r = s.get(f"{BASE_URL}/api/users/directory?page=1&limit=20", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("users"), list)
    for u in body["users"]:
        assert "completeness_score" in u, u
        assert isinstance(u["completeness_score"], int)
        assert 0 <= u["completeness_score"] <= 2


# -----------------------------------------------------------------
# Sort: bio + public bubbles to the top
# -----------------------------------------------------------------
def test_directory_sorts_high_completeness_first():
    """A 2/2 profile MUST sort before a 0/2 profile (same alphabetic prefix)."""
    nonce = uuid.uuid4().hex[:6]
    # Use a prefix that's late in the alphabet so alphabetical sort
    # would NOT naturally bring them to the top — only completeness
    # can.  Then 2/2 should still come before 0/2 regardless.
    high = f"zzz_iter57_{nonce}_a"  # alphabetically FIRST among these
    low  = f"zzz_iter57_{nonce}_b"
    seeded = []
    try:
        # Seed in REVERSE completeness order to prove the sort works.
        seeded.append(_seed_user_in_directory(
            username=low, bio="", library_public=False,  # 0/2
        ))
        seeded.append(_seed_user_in_directory(
            username=high, bio="reads romance + horror",
            library_public=True,  # 2/2
        ))

        s, _, _ = _register("iter57sort")
        # Fetch a wide page so both seeded users land in the same page.
        r = s.get(f"{BASE_URL}/api/users/directory?page=1&limit=100", timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()["users"]

        idx_high = next((i for i, u in enumerate(rows) if u["username"] == high), -1)
        idx_low  = next((i for i, u in enumerate(rows) if u["username"] == low), -1)
        assert idx_high != -1, f"high-completeness user missing: {[u['username'] for u in rows[-5:]]}"
        assert idx_low  != -1, "low-completeness user missing"
        # The score=2 row must come BEFORE the score=0 row.
        assert idx_high < idx_low, (
            f"2/2 profile (idx {idx_high}) should sort before 0/2 (idx {idx_low})"
        )

        # And the scores on the payload should reflect that.
        high_row = rows[idx_high]
        low_row  = rows[idx_low]
        assert high_row["completeness_score"] == 2, high_row
        assert low_row["completeness_score"]  == 0, low_row
        assert high_row["has_public_library"] is True
        assert low_row["has_public_library"]  is False
    finally:
        _cleanup(seeded)


# -----------------------------------------------------------------
# Tie-breaker: same score → alphabetical
# -----------------------------------------------------------------
def test_directory_alphabetical_tiebreaker_within_score_tier():
    """Two users with the same completeness score sort alphabetically."""
    nonce = uuid.uuid4().hex[:6]
    # Two 1/2 profiles (bio set, library not public).
    name_a = f"zzz_iter57alpha_{nonce}_aaa"
    name_b = f"zzz_iter57alpha_{nonce}_bbb"
    seeded = []
    try:
        # Seed in REVERSE alphabetical order
        seeded.append(_seed_user_in_directory(username=name_b, bio="bbb"))
        seeded.append(_seed_user_in_directory(username=name_a, bio="aaa"))
        s, _, _ = _register("iter57alpha")
        r = s.get(f"{BASE_URL}/api/users/directory?page=1&limit=100", timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()["users"]
        idx_a = next((i for i, u in enumerate(rows) if u["username"] == name_a), -1)
        idx_b = next((i for i, u in enumerate(rows) if u["username"] == name_b), -1)
        assert idx_a != -1 and idx_b != -1
        # Same score → alphabetical: _a should come before _b.
        assert idx_a < idx_b, "alphabetical tie-breaker broken within same score"
    finally:
        _cleanup(seeded)
