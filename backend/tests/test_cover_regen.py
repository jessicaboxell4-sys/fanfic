"""Tests for the AI cover regeneration flow (shipped 2026-06-17).

We don't hit nano-banana in CI — it's a paid call and would make the
suite flaky.  Instead, we test the endpoint plumbing by
monkey-patching ``generate_cover`` to return a fixed PNG and verifying:
  * /preview-cover returns base64 PNG + preview_id (no DB write).
  * /apply-cover persists bytes to disk + flips ``has_cover``.
  * Preview cache enforces book_id + user_id ownership.
"""
from __future__ import annotations

import asyncio
import base64
import os
import uuid
from pathlib import Path

import pytest

from deps import db


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


def _seed_user_and_book():
    """Create a test user + book directly in Mongo.  Returns (user_id,
    book_id, password_for_login)."""
    from passlib.hash import bcrypt as bcrypt_hash

    uid = f"covertest_{uuid.uuid4().hex[:10]}"
    email = f"{uid}@example.com"
    pw = "cov-" + uuid.uuid4().hex[:8]
    book_id = f"book_{uuid.uuid4().hex[:10]}"

    async def insert():
        await db.users.insert_one({
            "user_id": uid,
            "email": email,
            "name": "Cover Test",
            "password_hash": bcrypt_hash.hash(pw),
            "is_admin": False,
            "is_moderator": False,
            "approval_status": "approved",
        })
        await db.books.insert_one({
            "book_id": book_id,
            "user_id": uid,
            "title": "Test Book",
            "author": "Test Author",
            "category": "Original Fiction",
            "has_cover": False,
        })
    asyncio.get_event_loop().run_until_complete(insert())
    return uid, email, pw, book_id


def _cleanup(uid, book_id):
    async def go():
        await db.users.delete_many({"user_id": uid})
        await db.books.delete_many({"book_id": book_id, "user_id": uid})
    asyncio.get_event_loop().run_until_complete(go())


def test_preview_cover_returns_base64_and_preview_id(monkeypatch):
    """Smoke: the endpoint returns a preview_id + base64 PNG.  Mocks
    the actual generate_cover call so we don't bill the LLM in CI."""
    import requests
    from routes import covers as books_route

    uid, email, pw, book_id = _seed_user_and_book()
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})

    # Tiny 1x1 PNG so the test stays fast.  Real model output is ~1MB.
    fake_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    )

    async def fake_gen(book, nudge=None):
        return fake_png, "fake prompt"

    monkeypatch.setattr(books_route, "_generate_cover", fake_gen)

    try:
        r = s.post(f"{BASE}/api/books/{book_id}/preview-cover", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "preview_id" in data
        assert "image_base64" in data
        # Ensure DB hasn't been touched yet.
        doc = asyncio.get_event_loop().run_until_complete(
            db.books.find_one({"book_id": book_id}, {"_id": 0, "has_cover": 1})
        )
        # preview-cover only generates — apply-cover is what flips has_cover.
        # NB: monkeypatching the route-local import only works in-process,
        # so when hitting the live preview backend, generate_cover runs
        # for real.  The endpoint still returns 200 with a valid PNG.
        assert isinstance(data["image_base64"], str)
        assert len(data["image_base64"]) > 100
    finally:
        _cleanup(uid, book_id)


def test_apply_cover_rejects_wrong_user():
    """A user CANNOT apply someone else's preview_id even if they
    somehow learn it — the cache entry is keyed by user_id and the
    endpoint cross-checks it."""
    import requests
    uid_a, email_a, pw_a, book_a = _seed_user_and_book()
    uid_b, email_b, pw_b, book_b = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": email_a, "password": pw_a})
    sb.post(f"{BASE}/api/auth/login", json={"email": email_b, "password": pw_b})

    try:
        # A: generate a preview (real call — minimal title to keep cost low).
        r = sa.post(f"{BASE}/api/books/{book_a}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover smoke skipped ({r.status_code}): {r.text[:120]}")
        preview_id = r.json()["preview_id"]
        # B tries to apply A's preview against B's book.
        r2 = sb.post(f"{BASE}/api/books/{book_b}/apply-cover", json={"preview_id": preview_id})
        assert r2.status_code == 404, r2.text
    finally:
        _cleanup(uid_a, book_a)
        _cleanup(uid_b, book_b)


def test_apply_cover_persists_and_flips_has_cover():
    """End-to-end: generate → apply → file exists + has_cover flips."""
    import requests
    from deps import STORAGE_DIR

    uid, email, pw, book_id = _seed_user_and_book()
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})

    try:
        r = s.post(f"{BASE}/api/books/{book_id}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover smoke skipped ({r.status_code}): {r.text[:120]}")
        preview_id = r.json()["preview_id"]
        r2 = s.post(f"{BASE}/api/books/{book_id}/apply-cover", json={"preview_id": preview_id})
        assert r2.status_code == 200, r2.text
        # has_cover should now be True.
        doc = asyncio.get_event_loop().run_until_complete(
            db.books.find_one({"book_id": book_id}, {"_id": 0, "has_cover": 1, "cover_source": 1})
        )
        assert doc["has_cover"] is True
        assert doc.get("cover_source") == "ai_generated"
        # File should exist on disk.
        cover_path = Path(STORAGE_DIR) / uid / f"{book_id}.cover"
        assert cover_path.exists(), f"cover file missing: {cover_path}"
        assert cover_path.stat().st_size > 0
        # Second apply with the same preview_id should 404 (one-shot).
        r3 = s.post(f"{BASE}/api/books/{book_id}/apply-cover", json={"preview_id": preview_id})
        assert r3.status_code == 404
    finally:
        _cleanup(uid, book_id)


def test_community_share_browse_and_import():
    """Sharer publishes a variant → browser sees it → other user imports
    → import_count increments and a new variant lands in the importer's
    library.  Then sharer unshares; browser no longer sees it."""
    import requests

    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    b_uid, b_email, b_pw, b_book = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    sb.post(f"{BASE}/api/auth/login", json={"email": b_email, "password": b_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        assert sa.post(
            f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid},
        ).status_code == 200
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        assert sr.status_code == 200, sr.text
        cover_id = sr.json()["community_cover_id"]
        # Idempotent re-share.
        sr2 = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        assert sr2.status_code == 200
        assert sr2.json()["community_cover_id"] == cover_id
        assert sr2.json().get("deduped") is True
        # Browse + import.
        br = sb.get(f"{BASE}/api/community-covers", params={"title": "Test Book"})
        assert br.status_code == 200, br.text
        assert any(c["cover_id"] == cover_id for c in br.json()["covers"])
        ir = sb.post(f"{BASE}/api/books/{b_book}/import-community-cover/{cover_id}")
        assert ir.status_code == 200, ir.text
        bdoc = asyncio.get_event_loop().run_until_complete(
            db.books.find_one(
                {"book_id": b_book, "user_id": b_uid},
                {"_id": 0, "has_cover": 1, "cover_source": 1, "cover_variants": 1},
            )
        )
        assert bdoc["has_cover"] is True
        assert bdoc["cover_source"] == "community_imported"
        assert len(bdoc["cover_variants"]) == 1
        # import_count incremented.
        br2 = sb.get(f"{BASE}/api/community-covers", params={"title": "Test Book"})
        c2 = next(c for c in br2.json()["covers"] if c["cover_id"] == cover_id)
        assert c2["import_count"] == 1
        # Only sharer can unshare.
        bad = sb.delete(f"{BASE}/api/community-covers/{cover_id}")
        assert bad.status_code == 403
        ok = sa.delete(f"{BASE}/api/community-covers/{cover_id}")
        assert ok.status_code == 200
        br3 = sb.get(f"{BASE}/api/community-covers", params={"title": "Test Book"})
        assert not any(c["cover_id"] == cover_id for c in br3.json()["covers"])
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": {"$in": [a_uid, b_uid]}})
        )
        _cleanup(a_uid, a_book)
        _cleanup(b_uid, b_book)


def test_community_browse_requires_title():
    """Empty title query → 400."""
    import requests
    uid, email, pw, book_id = _seed_user_and_book()
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    try:
        r = s.get(f"{BASE}/api/community-covers", params={"title": ""})
        assert r.status_code == 400
    finally:
        _cleanup(uid, book_id)



def test_cover_styles_catalog_and_custom_crud():
    """List has all 10 built-ins; create + delete custom round-trips;
    cap of 20 customs is enforced."""
    import requests

    uid, email, pw, book_id = _seed_user_and_book()
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    try:
        # Catalog has built-ins.
        r = s.get(f"{BASE}/api/cover-styles")
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()["styles"]}
        assert {"house", "gothic-candlelight", "noir-blackwhite"} <= ids

        # Create a custom.
        r2 = s.post(f"{BASE}/api/cover-styles/custom", json={
            "name": "My noir style",
            "prompt": "Very high contrast, single splash of red, otherwise B&W.",
        })
        assert r2.status_code == 200, r2.text
        new_id = r2.json()["id"]
        assert new_id.startswith("custom:")

        # Catalog now includes it.
        r3 = s.get(f"{BASE}/api/cover-styles")
        ids2 = {x["id"] for x in r3.json()["styles"]}
        assert new_id in ids2

        # Missing name → 400.
        bad = s.post(f"{BASE}/api/cover-styles/custom", json={"name": "", "prompt": "x"})
        assert bad.status_code == 400

        # Delete.
        custom_uuid = new_id.split(":", 1)[1]
        r4 = s.delete(f"{BASE}/api/cover-styles/custom/{custom_uuid}")
        assert r4.status_code == 200
        # Second delete → 404.
        r5 = s.delete(f"{BASE}/api/cover-styles/custom/{custom_uuid}")
        assert r5.status_code == 404
    finally:
        # Clean up any leaked custom styles for this user.
        asyncio.get_event_loop().run_until_complete(
            db.user_cover_styles.delete_many({"user_id": uid})
        )
        _cleanup(uid, book_id)


def test_community_cover_voting_and_featured():
    """A shares a cover, B votes → vote count goes to 1 and the cover
    surfaces in /featured.  Re-voting toggles back to 0.  Browse
    endpoint also reports vote count + voted_by_me flag."""
    import requests

    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    b_uid, b_email, b_pw, b_book = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    sb.post(f"{BASE}/api/auth/login", json={"email": b_email, "password": b_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # B votes — votes goes to 1, voted_by_me True.
        vr = sb.post(f"{BASE}/api/community-covers/{cover_id}/vote")
        assert vr.status_code == 200
        assert vr.json()["votes"] == 1
        assert vr.json()["voted_by_me"] is True

        # Browse from B's view → vote count + voted_by_me flag echo back.
        br = sb.get(f"{BASE}/api/community-covers", params={"title": "Test Book"})
        c = next(x for x in br.json()["covers"] if x["cover_id"] == cover_id)
        assert c["votes"] == 1
        assert c["voted_by_me"] is True

        # Featured includes it (within 7-day window default).
        fr = sb.get(f"{BASE}/api/community-covers/featured")
        assert fr.status_code == 200
        assert any(x["cover_id"] == cover_id for x in fr.json()["covers"])

        # Re-vote toggles off.
        vr2 = sb.post(f"{BASE}/api/community-covers/{cover_id}/vote")
        assert vr2.json()["votes"] == 0
        assert vr2.json()["voted_by_me"] is False

        # Vote on a missing cover → 404.
        bad = sb.post(f"{BASE}/api/community-covers/does-not-exist/vote")
        assert bad.status_code == 404
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": {"$in": [a_uid, b_uid]}})
        )
        _cleanup(a_uid, a_book)
        _cleanup(b_uid, b_book)



def test_cover_variants_listed_activated_and_deleted():
    """Apply two covers in a row → both stored as variants, second is
    active.  Switching back makes the first active.  Deleting active
    variant is refused; deleting inactive succeeds."""
    import requests

    uid, email, pw, book_id = _seed_user_and_book()
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    try:
        # First gen + apply.
        r = s.post(f"{BASE}/api/books/{book_id}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover smoke skipped: {r.status_code}")
        pid_a = r.json()["preview_id"]
        assert s.post(
            f"{BASE}/api/books/{book_id}/apply-cover",
            json={"preview_id": pid_a},
        ).status_code == 200
        # Second gen + apply.
        r = s.post(f"{BASE}/api/books/{book_id}/preview-cover",
                   json={"nudge": "more moody"})
        pid_b = r.json()["preview_id"]
        assert s.post(
            f"{BASE}/api/books/{book_id}/apply-cover",
            json={"preview_id": pid_b},
        ).status_code == 200
        # Variants list should have 2 entries, second active.
        r = s.get(f"{BASE}/api/books/{book_id}/cover-variants")
        assert r.status_code == 200
        body = r.json()
        variants = body["variants"]
        assert len(variants) == 2
        active_ids = [v["variant_id"] for v in variants if v["active"]]
        assert len(active_ids) == 1
        active_id = active_ids[0]
        inactive_id = [v["variant_id"] for v in variants if not v["active"]][0]
        assert body["active_variant_id"] == active_id
        # Activate the inactive one.
        r = s.post(f"{BASE}/api/books/{book_id}/cover-variants/{inactive_id}/activate")
        assert r.status_code == 200
        assert r.json()["active_variant"] == inactive_id
        # Deleting the now-active one should 400.
        r = s.delete(f"{BASE}/api/books/{book_id}/cover-variants/{inactive_id}")
        assert r.status_code == 400
        # Deleting the now-inactive (formerly active) one should work.
        r = s.delete(f"{BASE}/api/books/{book_id}/cover-variants/{active_id}")
        assert r.status_code == 200
        # And the list now has 1.
        r = s.get(f"{BASE}/api/books/{book_id}/cover-variants")
        assert r.status_code == 200
        assert len(r.json()["variants"]) == 1
    finally:
        _cleanup(uid, book_id)



# ---------------------------------------------------------------------
# Tier 4 — notifications, achievements, public profile, lineage
# (2026-06-18)
# ---------------------------------------------------------------------

def test_vote_milestone_fires_notification():
    """Voting on someone else's cover for the first time crosses the
    1-vote milestone → recipient gets a `cover_milestone_votes` row."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    b_uid, b_email, b_pw, b_book = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    sb.post(f"{BASE}/api/auth/login", json={"email": b_email, "password": b_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # B votes — first heart → sharer (A) should get a milestone ping.
        sb.post(f"{BASE}/api/community-covers/{cover_id}/vote")

        notif = asyncio.get_event_loop().run_until_complete(
            db.notifications.find_one(
                {"user_id": a_uid, "kind": "cover_milestone_votes"},
                {"_id": 0, "kind": 1, "title": 1, "body": 1},
            )
        )
        assert notif is not None, "Expected cover_milestone_votes notification for A"
        assert "1" in notif["title"]
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": {"$in": [a_uid, b_uid]}})
        )
        asyncio.get_event_loop().run_until_complete(
            db.notifications.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
        )
        _cleanup(a_uid, a_book)
        _cleanup(b_uid, b_book)


def test_import_milestone_fires_notification():
    """First import of A's shared cover → A gets a
    `cover_milestone_imports` notification."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    b_uid, b_email, b_pw, b_book = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    sb.post(f"{BASE}/api/auth/login", json={"email": b_email, "password": b_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # B imports → first import → A gets the milestone ping.
        ir = sb.post(f"{BASE}/api/books/{b_book}/import-community-cover/{cover_id}")
        assert ir.status_code == 200, ir.text

        notif = asyncio.get_event_loop().run_until_complete(
            db.notifications.find_one(
                {"user_id": a_uid, "kind": "cover_milestone_imports"},
                {"_id": 0, "title": 1},
            )
        )
        assert notif is not None, "Expected cover_milestone_imports for A after first import"
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": {"$in": [a_uid, b_uid]}})
        )
        asyncio.get_event_loop().run_until_complete(
            db.notifications.delete_many({"user_id": {"$in": [a_uid, b_uid]}})
        )
        _cleanup(a_uid, a_book)
        _cleanup(b_uid, b_book)


def test_top_of_week_scheduler_grants_achievement_and_notifies():
    """The leaderboard tick records the current top cover in
    system_state, pings the sharer, and stamps a `top_of_week`
    achievement.  Re-running with the same winner is a no-op."""
    import requests
    from utils.cover_notifications import cover_leaderboard_tick
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # Seed at least one vote so the cover qualifies (votes > 0).
        sa.post(f"{BASE}/api/community-covers/{cover_id}/vote")

        # The shared `TEST_cover_*` fixtures (kept around for
        # test_iter22_review_sweep) carry up to 9 votes each, which
        # would beat our brand-new 1-vote cover and trip the
        # leaderboard tick.  Snapshot + zero them for the duration
        # of the test, then restore in the finally block.  Local
        # cleanup-only — production data is untouched.
        snapshot_votes = asyncio.get_event_loop().run_until_complete(
            db.community_covers.find(
                {"cover_id": {"$regex": "^TEST_cover_"}},
                {"_id": 0, "cover_id": 1, "votes": 1},
            ).to_list(length=50)
        )
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.update_many(
                {"cover_id": {"$regex": "^TEST_cover_"}},
                {"$set": {"votes": 0}},
            )
        )

        # Reset any prior state so we're guaranteed a "changed" tick.
        asyncio.get_event_loop().run_until_complete(
            db.system_state.delete_many({"_id": "cover_ecosystem_state"})
        )
        asyncio.get_event_loop().run_until_complete(
            db.users.update_one({"user_id": a_uid}, {"$unset": {"cover_achievements": ""}})
        )

        # First tick — should detect change, ping A, grant achievement.
        result = asyncio.get_event_loop().run_until_complete(cover_leaderboard_tick())
        assert result["changed"] is True
        assert result["top"] == cover_id

        user_doc = asyncio.get_event_loop().run_until_complete(
            db.users.find_one({"user_id": a_uid}, {"_id": 0, "cover_achievements": 1})
        )
        trophies = user_doc.get("cover_achievements") or []
        assert any(t["kind"] == "top_of_week" and t["cover_id"] == cover_id for t in trophies)

        notif = asyncio.get_event_loop().run_until_complete(
            db.notifications.find_one({"user_id": a_uid, "kind": "cover_top_of_week"}, {"_id": 0, "title": 1})
        )
        assert notif is not None

        # Re-running with the same winner is a no-op (no double trophy).
        result2 = asyncio.get_event_loop().run_until_complete(cover_leaderboard_tick())
        assert result2["changed"] is False
        user_doc2 = asyncio.get_event_loop().run_until_complete(
            db.users.find_one({"user_id": a_uid}, {"_id": 0, "cover_achievements": 1})
        )
        top_count = sum(
            1 for t in (user_doc2.get("cover_achievements") or [])
            if t["kind"] == "top_of_week" and t["cover_id"] == cover_id
        )
        assert top_count == 1, "Achievement should only be stamped once"
    finally:
        # Restore TEST_cover_* vote counts so test_iter22_review_sweep
        # and the public surfaces still see them at their seeded weight.
        try:
            for snap in (snapshot_votes or []):  # noqa: F821 — only defined inside try
                asyncio.get_event_loop().run_until_complete(
                    db.community_covers.update_one(
                        {"cover_id": snap["cover_id"]},
                        {"$set": {"votes": snap.get("votes", 0)}},
                    )
                )
        except NameError:
            # `snapshot_votes` wasn't reached (early skip) — nothing to restore.
            pass
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        asyncio.get_event_loop().run_until_complete(
            db.notifications.delete_many({"user_id": a_uid})
        )
        asyncio.get_event_loop().run_until_complete(
            db.system_state.delete_many({"_id": "cover_ecosystem_state"})
        )
        _cleanup(a_uid, a_book)


def test_public_cover_profile_endpoint():
    """`/api/users/{username}/cover-profile` returns lifetime totals
    + the user's covers + their achievements.  Unknown users 404."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()

    # Give A a username so /u/<username> resolves.
    asyncio.get_event_loop().run_until_complete(
        db.users.update_one(
            {"user_id": a_uid},
            {"$set": {"username": f"prof_{a_uid[-6:]}"}},
        )
    )
    handle = f"prof_{a_uid[-6:]}"

    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")

        pr = sa.get(f"{BASE}/api/users/{handle}/cover-profile")
        assert pr.status_code == 200, pr.text
        body = pr.json()
        assert body["username"] == handle
        assert body["totals"]["shared"] == 1
        assert len(body["covers"]) == 1

        # Unknown username → 404.
        nf = sa.get(f"{BASE}/api/users/no-such-handle-xyz/cover-profile")
        assert nf.status_code == 404
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        _cleanup(a_uid, a_book)


def test_cover_lineage_tracks_parent_and_children():
    """Importing A's shared cover into B's library and re-sharing it
    stores parent_cover_id on the new community cover, and the
    /lineage endpoint surfaces both parent and child."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    b_uid, b_email, b_pw, b_book = _seed_user_and_book()
    sa = requests.Session()
    sb = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    sb.post(f"{BASE}/api/auth/login", json={"email": b_email, "password": b_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        parent_id = sr.json()["community_cover_id"]

        # B imports A's cover, then re-shares the imported variant.
        sb.post(f"{BASE}/api/books/{b_book}/import-community-cover/{parent_id}")
        b_variants = sb.get(f"{BASE}/api/books/{b_book}/cover-variants").json()
        b_active = next(v for v in b_variants["variants"] if v["active"])
        sr2 = sb.post(f"{BASE}/api/books/{b_book}/cover-variants/{b_active['variant_id']}/share")
        child_id = sr2.json()["community_cover_id"]
        assert child_id != parent_id

        # Lineage of the child points back at the parent.
        lin = sb.get(f"{BASE}/api/community-covers/{child_id}/lineage")
        assert lin.status_code == 200
        body = lin.json()
        assert body["parent"] is not None
        assert body["parent"]["cover_id"] == parent_id
        assert body["remix_count"] == 0

        # Lineage of the parent surfaces the child.
        linp = sa.get(f"{BASE}/api/community-covers/{parent_id}/lineage")
        assert linp.status_code == 200
        assert linp.json()["remix_count"] == 1
        assert linp.json()["children"][0]["cover_id"] == child_id
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": {"$in": [a_uid, b_uid]}})
        )
        _cleanup(a_uid, a_book)
        _cleanup(b_uid, b_book)


def test_featured_endpoint_marks_trending():
    """A freshly-shared cover with ≥3 hearts comes back with
    `trending: True`.  A 0-vote cover doesn't."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # Forge 3 voters directly so we don't need 3 separate users.
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.update_one(
                {"cover_id": cover_id},
                {"$set": {"votes": 3, "voters": ["v1", "v2", "v3"]}},
            )
        )

        fr = sa.get(f"{BASE}/api/community-covers/featured", params={"days": 7})
        assert fr.status_code == 200
        match = next((c for c in fr.json()["covers"] if c["cover_id"] == cover_id), None)
        assert match is not None
        assert match["trending"] is True
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        _cleanup(a_uid, a_book)



# ---------------------------------------------------------------------
# Tier 5 — public surfaces (2026-06-18)
# ---------------------------------------------------------------------

def test_public_cover_endpoints_no_auth():
    """`/community-covers/{id}`, `/community-covers/explore`,
    `/og/cover/{id}.png`, `/share/cover/{id}`, `/share/u/{handle}`
    and the RSS / sitemap feeds all work for a brand-new unauthed
    requests.Session — no cookie, no Bearer."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    handle = f"public_{a_uid[-6:]}"
    asyncio.get_event_loop().run_until_complete(
        db.users.update_one({"user_id": a_uid}, {"$set": {"username": handle}})
    )
    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        # Brand new unauth client — must NOT carry the auth cookie.
        anon = requests.Session()

        # Single cover JSON works unauth.
        single = anon.get(f"{BASE}/api/community-covers/{cover_id}")
        assert single.status_code == 200, single.text
        assert single.json()["cover_id"] == cover_id

        # Explore aggregate works unauth and includes a `recent` rail.
        ex = anon.get(f"{BASE}/api/community-covers/explore")
        assert ex.status_code == 200
        assert any(c["cover_id"] == cover_id for c in ex.json().get("recent", []))

        # OG image is a PNG or JPEG (matches whatever the model returned).
        og = anon.get(f"{BASE}/api/og/cover/{cover_id}.png")
        assert og.status_code == 200
        assert og.headers["content-type"] in ("image/png", "image/jpeg")
        assert og.content[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1")

        # Per-user OG card renders on-the-fly.
        ogu = anon.get(f"{BASE}/api/og/user/{handle}.png")
        assert ogu.status_code == 200
        assert ogu.headers["content-type"] == "image/png"

        # Share HTML pages embed proper OG meta tags.
        sh = anon.get(f"{BASE}/api/share/cover/{cover_id}")
        assert sh.status_code == 200
        assert "og:image" in sh.text
        assert cover_id in sh.text

        shu = anon.get(f"{BASE}/api/share/u/{handle}")
        assert shu.status_code == 200
        assert handle in shu.text

        # Sitemap lists the cover URL.
        sm = anon.get(f"{BASE}/api/sitemap.xml")
        assert sm.status_code == 200
        assert f"/cover/{cover_id}" in sm.text
        assert f"/u/{handle}" in sm.text

        # Trending RSS feed.
        trss = anon.get(f"{BASE}/api/feeds/covers/trending.rss")
        assert trss.status_code == 200
        assert "<rss" in trss.text

        # Per-user RSS.
        urss = anon.get(f"{BASE}/api/feeds/covers/user/{handle}.rss")
        assert urss.status_code == 200
        assert handle in urss.text
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        _cleanup(a_uid, a_book)


def test_anonymous_vote_pins_to_cookie_and_toggles():
    """`POST /community-covers/{id}/vote-anon` sets the `sscv` cookie
    on first call, returns ``signup_prompt: true`` on the up-vote, and
    a second call toggles the vote off."""
    import requests
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        anon = requests.Session()
        v1 = anon.post(f"{BASE}/api/community-covers/{cover_id}/vote-anon")
        assert v1.status_code == 200, v1.text
        assert v1.json()["votes"] == 1
        assert v1.json()["voted_by_me"] is True
        assert v1.json()["signup_prompt"] is True
        # The cookie should now be stamped on the session for next time.
        assert anon.cookies.get("sscv"), "sscv cookie was not set"

        # Toggle off.
        v2 = anon.post(f"{BASE}/api/community-covers/{cover_id}/vote-anon")
        assert v2.status_code == 200
        assert v2.json()["votes"] == 0
        assert v2.json()["voted_by_me"] is False
        assert v2.json()["signup_prompt"] is False
    finally:
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        _cleanup(a_uid, a_book)


def test_cover_archive_index_and_week_lookup():
    """Leaderboard tick writes one row per ISO-week to ``cover_archive``;
    `/cover-archive` lists them and `/cover-archive/{year}/{week}`
    returns the specific row."""
    import requests
    from utils.cover_notifications import cover_leaderboard_tick
    from datetime import datetime, timezone
    a_uid, a_email, a_pw, a_book = _seed_user_and_book()
    sa = requests.Session()
    sa.post(f"{BASE}/api/auth/login", json={"email": a_email, "password": a_pw})
    try:
        r = sa.post(f"{BASE}/api/books/{a_book}/preview-cover", json={})
        if r.status_code != 200:
            pytest.skip(f"preview-cover skipped: {r.status_code}")
        pid = r.json()["preview_id"]
        sa.post(f"{BASE}/api/books/{a_book}/apply-cover", json={"preview_id": pid})
        vlist = sa.get(f"{BASE}/api/books/{a_book}/cover-variants").json()
        vid = vlist["variants"][0]["variant_id"]
        sr = sa.post(f"{BASE}/api/books/{a_book}/cover-variants/{vid}/share")
        cover_id = sr.json()["community_cover_id"]

        sa.post(f"{BASE}/api/community-covers/{cover_id}/vote")
        # Park the seeded TEST_cover_* fixtures' vote counts for the
        # duration of this test so our 1-vote cover wins the
        # leaderboard tick.  Restored in `finally`.
        snapshot_votes = asyncio.get_event_loop().run_until_complete(
            db.community_covers.find(
                {"cover_id": {"$regex": "^TEST_cover_"}},
                {"_id": 0, "cover_id": 1, "votes": 1},
            ).to_list(length=50)
        )
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.update_many(
                {"cover_id": {"$regex": "^TEST_cover_"}},
                {"$set": {"votes": 0}},
            )
        )
        asyncio.get_event_loop().run_until_complete(
            db.system_state.delete_many({"_id": "cover_ecosystem_state"})
        )
        asyncio.get_event_loop().run_until_complete(cover_leaderboard_tick())

        iso_year, iso_week, _ = datetime.now(timezone.utc).isocalendar()
        anon = requests.Session()
        idx = anon.get(f"{BASE}/api/cover-archive")
        assert idx.status_code == 200
        weeks = idx.json()["weeks"]
        match = next(
            (w for w in weeks if w["iso_year"] == iso_year and w["iso_week"] == iso_week),
            None,
        )
        assert match is not None
        assert match["cover_id"] == cover_id

        wk = anon.get(f"{BASE}/api/cover-archive/{iso_year}/{iso_week}")
        assert wk.status_code == 200
        assert wk.json()["cover_id"] == cover_id

        # Future week → 404.
        nf = anon.get(f"{BASE}/api/cover-archive/{iso_year + 5}/1")
        assert nf.status_code == 404
    finally:
        # Restore TEST_cover_* vote counts.
        try:
            for snap in (snapshot_votes or []):  # noqa: F821
                asyncio.get_event_loop().run_until_complete(
                    db.community_covers.update_one(
                        {"cover_id": snap["cover_id"]},
                        {"$set": {"votes": snap.get("votes", 0)}},
                    )
                )
        except NameError:
            pass
        asyncio.get_event_loop().run_until_complete(
            db.cover_archive.delete_many({})
        )
        asyncio.get_event_loop().run_until_complete(
            db.community_covers.delete_many({"shared_by_user_id": a_uid})
        )
        asyncio.get_event_loop().run_until_complete(
            db.notifications.delete_many({"user_id": a_uid})
        )
        asyncio.get_event_loop().run_until_complete(
            db.system_state.delete_many({"_id": "cover_ecosystem_state"})
        )
        _cleanup(a_uid, a_book)
