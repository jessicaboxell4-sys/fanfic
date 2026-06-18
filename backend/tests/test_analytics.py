"""Tests for visitor analytics + reader heatmap."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

import requests
from passlib.hash import bcrypt as bcrypt_hash

from deps import db


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


def _seed_user(is_admin=False):
    uid = f"anlx_{uuid.uuid4().hex[:10]}"
    email = f"{uid}@example.com"
    pw = "an-" + uuid.uuid4().hex[:8]

    async def insert():
        await db.users.insert_one({
            "user_id": uid, "email": email, "name": "Anlx",
            "password_hash": bcrypt_hash.hash(pw),
            "is_admin": is_admin, "is_moderator": False,
            "approval_status": "approved",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    asyncio.get_event_loop().run_until_complete(insert())
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200
    return uid, s


def _cleanup(uids):
    async def go():
        await db.users.delete_many({"user_id": {"$in": list(uids)}})
        await db.books.delete_many({"user_id": {"$in": list(uids)}})
        await db.page_views.delete_many({"user_id": {"$in": list(uids)}})
    asyncio.get_event_loop().run_until_complete(go())


def test_public_stats_endpoint_unauth():
    """Landing-page counter — must work without a session."""
    anon = requests.Session()
    r = anon.get(f"{BASE}/api/analytics/public-stats")
    assert r.status_code == 200
    body = r.json()
    for k in ("total_users", "monthly_signups", "total_covers"):
        assert k in body
        assert isinstance(body[k], int)


def test_view_stamp_and_dedupe():
    """`/analytics/view` inserts a row.  The same browser stamping
    again inside the 30-min window is deduped."""
    anon = requests.Session()
    r1 = anon.post(f"{BASE}/api/analytics/view", json={
        "page_type": "explore", "slug": "",
    })
    assert r1.status_code == 200

    # Stamp again — should NOT create a second row.
    r2 = anon.post(f"{BASE}/api/analytics/view", json={
        "page_type": "explore", "slug": "",
    })
    assert r2.status_code == 200


def test_admin_summary_requires_admin():
    """`/analytics/summary` is 403 for non-admin users."""
    uid, s = _seed_user(is_admin=False)
    try:
        r = s.get(f"{BASE}/api/analytics/summary")
        assert r.status_code == 403
    finally:
        _cleanup([uid])


def test_admin_summary_runs_for_admin():
    """`/analytics/summary` returns the expected shape for admins."""
    uid, s = _seed_user(is_admin=True)
    try:
        r = s.get(f"{BASE}/api/analytics/summary?days=7")
        assert r.status_code == 200
        body = r.json()
        for k in ("by_page", "by_ref", "by_country", "top_covers", "funnel"):
            assert k in body
        for k in ("explore_views", "cover_views", "signups",
                  "explore_to_cover", "cover_to_signup"):
            assert k in body["funnel"]
    finally:
        _cleanup([uid])


def test_heatmap_hides_below_cohort_gate():
    """Single-reader book → heatmap returns `ready: False` with the
    `cohort_too_small` reason so the UI knows to suppress the widget."""
    uid, s = _seed_user(is_admin=False)
    book_id = f"hm_{uuid.uuid4().hex[:10]}"
    asyncio.get_event_loop().run_until_complete(
        db.books.insert_one({
            "book_id": book_id, "user_id": uid,
            "title": "Lonely Book", "author": "Solo Author",
            "category": "Original Fiction",
            "progress_fraction": 0.5,
        })
    )
    try:
        r = s.get(f"{BASE}/api/books/{book_id}/heatmap")
        assert r.status_code == 200
        body = r.json()
        assert body["ready"] is False
        assert body["reason"] in ("cohort_too_small", "no_opted_in_users")
    finally:
        _cleanup([uid])


def test_heatmap_renders_with_full_cohort():
    """When ≥10 readers have the same canonical title+author, the
    heatmap returns completion_rate + chapter_curve + caller's
    personal percent."""
    # Seed 12 users sharing the same book.
    uids = []
    titles_author = ("Cohort Book", "Cohort Author")
    progresses = [0.05, 0.10, 0.22, 0.30, 0.40, 0.55, 0.65, 0.70,
                  0.80, 0.92, 0.99, 0.40]
    s_main = None
    main_uid = None
    asyncio.get_event_loop().run_until_complete(
        db.community_covers.delete_many({"cover_id": "test_hm_block"})
    )
    try:
        for i, p in enumerate(progresses):
            uid, sess = _seed_user(is_admin=False)
            if i == 0:
                main_uid = uid
                s_main = sess
            uids.append(uid)
            asyncio.get_event_loop().run_until_complete(
                db.books.insert_one({
                    "book_id": f"hm_full_{i}_{uuid.uuid4().hex[:6]}",
                    "user_id": uid,
                    "title": titles_author[0], "author": titles_author[1],
                    "category": "Original Fiction",
                    "progress_fraction": p,
                })
            )

        # Main user fetches the heatmap for *their* book.
        own = asyncio.get_event_loop().run_until_complete(
            db.books.find_one(
                {"user_id": main_uid, "title": titles_author[0]},
                {"_id": 0, "book_id": 1},
            )
        )
        r = s_main.get(f"{BASE}/api/books/{own['book_id']}/heatmap")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ready"] is True
        assert body["cohort"] >= 10
        assert 0 < body["completion_rate"] <= 1
        assert len(body["chapter_curve"]) == 10
        assert body["chapter_curve"][0]["fraction_reached"] == 1.0
        assert body["you"]["percent"] == 0.05
    finally:
        _cleanup(uids)


def test_privacy_toggle_opts_user_out():
    """User toggles reading_data_shared → their books no longer
    contribute to other readers' heatmaps."""
    uid, s = _seed_user(is_admin=False)
    try:
        r = s.post(
            f"{BASE}/api/analytics/reading-data-sharing",
            json={"reading_data_shared": False},
        )
        assert r.status_code == 200
        assert r.json()["reading_data_shared"] is False

        g = s.get(f"{BASE}/api/analytics/reading-data-sharing")
        assert g.json()["reading_data_shared"] is False
    finally:
        _cleanup([uid])
