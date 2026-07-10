"""Iter 59 — Community Recommendations (Phase 1 of community library).

Tests the new /api/community/* endpoints.

Eligibility gate (score >= 2 → bio + library_visible_to_public),
rate-limit (20/24h), idempotent recommend, ownership-enforced delete,
heart toggle, and the feed's privacy invariant (filters out
opted-out owners).
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


def _register(prefix: str = "iter59") -> tuple[requests.Session, str]:
    """Register a fresh user and return (session, user_id)."""
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
    return s, uid


def _make_eligible(uid: str, handle: str | None = None) -> None:
    """Patch a user in Mongo to score=3 (handle + bio + library_visible_to_public)."""
    c = _mongo()
    h = handle or f"qa{uuid.uuid4().hex[:8]}"
    c[_db_name()].users.update_one(
        {"user_id": uid},
        {"$set": {
            "username":           h,
            "username_lower":     h.lower(),
            "bio":                "QA bio for community-rec tests",
            "library_visible_to_public": True,
            "approval_status":    "approved",
        }},
    )
    c.close()


def _seed_book(uid: str, *, av_status: str = "clean", title: str = "Iter59 Book") -> str:
    book_id = f"bk_iter59_{uuid.uuid4().hex[:10]}"
    c = _mongo()
    c[_db_name()].books.insert_one({
        "book_id":   book_id,
        "user_id":   uid,
        "title":     title,
        "author":    "QA Author",
        "fandom":    "Iter59 Fandom",
        "av_status": av_status,
    })
    c.close()
    return book_id


def _cleanup(uids: list[str], book_ids: list[str] | None = None) -> None:
    if not uids and not book_ids:
        return
    c = _mongo()
    dbn = _db_name()
    if uids:
        c[dbn].users.delete_many({"user_id": {"$in": uids}})
        c[dbn].community_recommendations.delete_many({"owner_user_id": {"$in": uids}})
        c[dbn].recommendation_reactions.delete_many({"viewer_user_id": {"$in": uids}})
    if book_ids:
        c[dbn].books.delete_many({"book_id": {"$in": book_ids}})
        c[dbn].community_recommendations.delete_many({"book_id": {"$in": book_ids}})
    c.close()


# -----------------------------------------------------------------
# Eligibility gate
# -----------------------------------------------------------------
def test_recommend_requires_eligibility():
    """A fresh user (no handle, no bio, library private) gets 403."""
    s, uid = _register("iter59gate")
    book_id = _seed_book(uid)
    try:
        r = s.post(
            f"{BASE_URL}/api/community/recommend",
            json={"book_id": book_id, "note": "nope"},
            timeout=15,
        )
        # The exact reason in the detail can be either:
        #   * "Claim a @handle..." (no username),
        #   * "Add a bio..." (no bio),
        #   * "Share your library publicly..." (not opted-in),
        # depending on order — we don't care, just that the gate fires.
        assert r.status_code == 403, r.text
    finally:
        _cleanup([uid], [book_id])


def test_recommend_succeeds_when_eligible():
    """score=3 user can recommend a clean book in their own library."""
    s, uid = _register("iter59happy")
    _make_eligible(uid)
    book_id = _seed_book(uid)
    try:
        r = s.post(
            f"{BASE_URL}/api/community/recommend",
            json={"book_id": book_id, "note": "Best book ever"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("created") is True
        assert "rec_id" in body
        assert body["rate_limit"] == 20
    finally:
        _cleanup([uid], [book_id])


# -----------------------------------------------------------------
# Idempotency — recommending the same book twice updates the note
# -----------------------------------------------------------------
def test_recommend_idempotent_updates_note():
    """Second POST with same book_id → updated:true, no duplicate row."""
    s, uid = _register("iter59idem")
    _make_eligible(uid)
    book_id = _seed_book(uid)
    try:
        r1 = s.post(f"{BASE_URL}/api/community/recommend",
                    json={"book_id": book_id, "note": "first take"}, timeout=15)
        assert r1.status_code == 200 and r1.json().get("created") is True

        r2 = s.post(f"{BASE_URL}/api/community/recommend",
                    json={"book_id": book_id, "note": "even better"}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("updated") is True
        assert r2.json().get("rec_id") == r1.json().get("rec_id"), "rec_id must stay stable"

        # Confirm there's only ONE row.
        c = _mongo()
        n = c[_db_name()].community_recommendations.count_documents({
            "owner_user_id": uid, "book_id": book_id,
        })
        c.close()
        assert n == 1, f"expected 1 rec, found {n}"
    finally:
        _cleanup([uid], [book_id])


# -----------------------------------------------------------------
# Ownership — can't recommend someone else's book
# -----------------------------------------------------------------
def test_recommend_rejects_other_users_book():
    """Recommending a book owned by another user → 404."""
    s_owner, owner_uid = _register("iter59owner")
    s_other, other_uid = _register("iter59other")
    _make_eligible(other_uid)
    book_id = _seed_book(owner_uid)
    try:
        r = s_other.post(
            f"{BASE_URL}/api/community/recommend",
            json={"book_id": book_id, "note": "not mine"},
            timeout=15,
        )
        assert r.status_code == 404, r.text
    finally:
        _cleanup([owner_uid, other_uid], [book_id])


# -----------------------------------------------------------------
# AV — can't recommend an infected / unscanned book
# -----------------------------------------------------------------
def test_recommend_rejects_unscanned_book():
    """A book still in `scanning` state can't be recommended."""
    s, uid = _register("iter59av")
    _make_eligible(uid)
    book_id = _seed_book(uid, av_status="scanning")
    try:
        r = s.post(
            f"{BASE_URL}/api/community/recommend",
            json={"book_id": book_id, "note": "early"},
            timeout=15,
        )
        assert r.status_code == 400, r.text
    finally:
        _cleanup([uid], [book_id])


# -----------------------------------------------------------------
# Feed — privacy invariant: filters out opted-out owners
# -----------------------------------------------------------------
def test_feed_filters_out_opted_out_owner():
    """A rec from a user who flips library-public OFF after creating
    the rec must disappear from the feed."""
    s, uid = _register("iter59privacy")
    _make_eligible(uid)
    book_id = _seed_book(uid, title=f"PrivacyTest_{uuid.uuid4().hex[:6]}")
    try:
        r = s.post(f"{BASE_URL}/api/community/recommend",
                   json={"book_id": book_id, "note": "test"}, timeout=15)
        assert r.status_code == 200, r.text

        # Owner is now eligible → rec should appear in feed.
        r2 = s.get(f"{BASE_URL}/api/community/feed?limit=50", timeout=15)
        assert r2.status_code == 200
        titles = [it["book"]["title"] for it in r2.json()["items"]]
        assert any("PrivacyTest" in t for t in titles), "rec should be visible while owner is public"

        # Flip opt-in off → rec must vanish.
        c = _mongo()
        c[_db_name()].users.update_one(
            {"user_id": uid}, {"$set": {"library_visible_to_public": False}},
        )
        c.close()
        r3 = s.get(f"{BASE_URL}/api/community/feed?limit=50", timeout=15)
        titles_after = [it["book"]["title"] for it in r3.json()["items"]]
        assert not any("PrivacyTest" in t for t in titles_after), "rec must vanish after opt-out"
    finally:
        _cleanup([uid], [book_id])


# -----------------------------------------------------------------
# Heart toggle — second call removes the heart
# -----------------------------------------------------------------
def test_heart_toggle_is_idempotent_pair():
    """Two heart-POSTs from the same viewer flips on then off."""
    s_owner, owner_uid = _register("iter59hearter")
    _make_eligible(owner_uid)
    book_id = _seed_book(owner_uid)
    r = s_owner.post(f"{BASE_URL}/api/community/recommend",
                     json={"book_id": book_id, "note": ""}, timeout=15)
    rec_id = r.json()["rec_id"]
    s_viewer, viewer_uid = _register("iter59viewer")
    try:
        r1 = s_viewer.post(f"{BASE_URL}/api/community/recommend/{rec_id}/heart", timeout=15)
        assert r1.status_code == 200 and r1.json()["hearted"] is True

        # Self-heart from owner is a no-op.
        r_self = s_owner.post(f"{BASE_URL}/api/community/recommend/{rec_id}/heart", timeout=15)
        assert r_self.status_code == 200
        assert r_self.json().get("self_react") is True

        r2 = s_viewer.post(f"{BASE_URL}/api/community/recommend/{rec_id}/heart", timeout=15)
        assert r2.status_code == 200 and r2.json()["hearted"] is False
    finally:
        _cleanup([owner_uid, viewer_uid], [book_id])


# -----------------------------------------------------------------
# Delete — owner-only retract
# -----------------------------------------------------------------
def test_delete_recommend_owner_only():
    s, uid = _register("iter59del")
    _make_eligible(uid)
    book_id = _seed_book(uid)
    r = s.post(f"{BASE_URL}/api/community/recommend",
               json={"book_id": book_id, "note": ""}, timeout=15)
    rec_id = r.json()["rec_id"]
    # Different user can't delete it
    s_other, other_uid = _register("iter59delother")
    try:
        r1 = s_other.delete(f"{BASE_URL}/api/community/recommend/{rec_id}", timeout=15)
        assert r1.status_code == 403, r1.text
        # Owner can.
        r2 = s.delete(f"{BASE_URL}/api/community/recommend/{rec_id}", timeout=15)
        assert r2.status_code == 200 and r2.json()["deleted"] is True
        # Second delete → 404 (already gone).
        r3 = s.delete(f"{BASE_URL}/api/community/recommend/{rec_id}", timeout=15)
        assert r3.status_code == 404
    finally:
        _cleanup([uid, other_uid], [book_id])


# -----------------------------------------------------------------
# my-recommendations — owner sees their own list
# -----------------------------------------------------------------
def test_my_recommendations_lists_own_recs():
    s, uid = _register("iter59my")
    _make_eligible(uid)
    book_id = _seed_book(uid)
    try:
        s.post(f"{BASE_URL}/api/community/recommend",
               json={"book_id": book_id, "note": "x"}, timeout=15)
        r = s.get(f"{BASE_URL}/api/community/my-recommendations", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert book_id in body["book_ids"]
        assert body["rec_count"] >= 1
        assert body["rate_limit"] == 20
    finally:
        _cleanup([uid], [book_id])


# -----------------------------------------------------------------
# Auth gate — anon must get 401 on every endpoint
# -----------------------------------------------------------------
def test_endpoints_require_auth():
    r1 = requests.get(f"{BASE_URL}/api/community/feed", timeout=10)
    r2 = requests.post(f"{BASE_URL}/api/community/recommend",
                       json={"book_id": "x", "note": "y"}, timeout=10)
    r3 = requests.post(f"{BASE_URL}/api/community/recommend/x/heart", timeout=10)
    r4 = requests.delete(f"{BASE_URL}/api/community/recommend/x", timeout=10)
    r5 = requests.get(f"{BASE_URL}/api/community/my-recommendations", timeout=10)
    for r in (r1, r2, r3, r4, r5):
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:120]}"
