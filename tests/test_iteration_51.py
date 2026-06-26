"""Iteration 51 — Groups A + C feature tests.

Covers:
- /api/users/{handle}/library-preview (anon-allowed, 404 invariants).
- PUT /api/account/public-library-visibility first-time modal flag.
- PUT /api/account/bio (set, surfaces in profile, cover, library, preview).
- Bio 280-char Pydantic cap (422 on >280).
- GET /api/account/library-rss-token (lazy create + idempotent).
- POST /api/account/library-rss-token/regenerate.
- GET /api/feeds/library/{handle}.rss (token-gated, 404 invariants).
"""
import os
import uuid
import xml.etree.ElementTree as ET

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://genre-sort.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

OPTED_EMAIL = "TEST_fe_opted_e24c9d@example.com"
OPTED_PW = "hunter2pw!"
OPTED_HANDLE = "febopta508d"
PRIVATE_HANDLE = "febpri4c63f"


# ----------------------------------------------------------------- helpers


def _login_or_skip(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text[:120]}")
    return s


def _register_fresh(handle_prefix="iter51"):
    email = f"TEST_{handle_prefix}_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(
        f"{API}/auth/register",
        json={"email": email, "password": "hunter2pw!", "name": "Iter51 User"},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text[:160]}"
    return s, email


def _claim_handle(session, handle):
    """Try a few endpoints to claim a handle on the fresh user."""
    # The most common shape — PUT /api/account/handle {username: ...}
    for url, payload in [
        (f"{API}/account/handle", {"username": handle}),
        (f"{API}/account/username", {"username": handle}),
        (f"{API}/auth/profile", {"username": handle}),
    ]:
        r = session.put(url, json=payload, timeout=15)
        if r.status_code in (200, 201):
            return True
    return False


# ----------------------------------------------------------------- fixtures


@pytest.fixture(scope="module")
def opted_session():
    return _login_or_skip(OPTED_EMAIL, OPTED_PW)


@pytest.fixture(scope="module")
def anon_session():
    return requests.Session()


# ============================================================================
# library-preview (anon allowed + 404 invariants)
# ============================================================================
class TestLibraryPreviewAnon:
    def test_opted_in_returns_200_with_payload(self, anon_session):
        r = anon_session.get(f"{API}/users/{OPTED_HANDLE}/library-preview", timeout=20)
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text[:200]}"
        data = r.json()
        # required keys
        for key in ("username", "display_name", "picture", "bio",
                    "total_books", "top_fandom", "fandom_count"):
            assert key in data, f"missing key {key} in {data}"
        assert data["username"].lower() == OPTED_HANDLE.lower()
        assert isinstance(data["total_books"], int)
        assert data["total_books"] >= 0
        assert isinstance(data["fandom_count"], int)

    def test_not_opted_in_returns_404(self, anon_session):
        r = anon_session.get(f"{API}/users/{PRIVATE_HANDLE}/library-preview", timeout=20)
        assert r.status_code == 404

    def test_nonexistent_handle_returns_404(self, anon_session):
        r = anon_session.get(f"{API}/users/zzz_nonexistent_{uuid.uuid4().hex[:6]}/library-preview", timeout=20)
        assert r.status_code == 404

    def test_404_bodies_identical_no_enumeration(self, anon_session):
        r1 = anon_session.get(f"{API}/users/{PRIVATE_HANDLE}/library-preview", timeout=20)
        r2 = anon_session.get(f"{API}/users/zzz_nope_{uuid.uuid4().hex[:6]}/library-preview", timeout=20)
        assert r1.status_code == 404 and r2.status_code == 404
        assert r1.json() == r2.json(), f"404 bodies differ: {r1.json()} vs {r2.json()}"


# ============================================================================
# PUT /account/public-library-visibility — first-share-modal flag
# ============================================================================
class TestFirstShareModalFlag:
    def test_first_time_toggle_returns_modal_true_subsequent_false(self):
        s, _email = _register_fresh("firstshare")
        # First ON
        r1 = s.put(f"{API}/account/public-library-visibility",
                   json={"library_visible_to_public": True}, timeout=20)
        assert r1.status_code == 200, f"{r1.status_code} {r1.text[:200]}"
        d1 = r1.json()
        assert d1.get("library_visible_to_public") is True
        assert d1.get("show_first_share_modal") is True, f"expected first_time=True, got {d1}"

        # Toggle OFF
        r2 = s.put(f"{API}/account/public-library-visibility",
                   json={"library_visible_to_public": False}, timeout=20)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("library_visible_to_public") is False
        assert d2.get("show_first_share_modal") is False

        # Second ON — modal should NOT show again
        r3 = s.put(f"{API}/account/public-library-visibility",
                   json={"library_visible_to_public": True}, timeout=20)
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3.get("library_visible_to_public") is True
        assert d3.get("show_first_share_modal") is False, \
            f"second ON should not retrigger modal, got {d3}"


# ============================================================================
# Bio field
# ============================================================================
class TestBioField:
    def test_set_bio_returns_value(self, opted_session):
        bio = "a tweet-length blurb about my fic taste"
        r = opted_session.put(f"{API}/account/bio", json={"bio": bio}, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert r.json().get("bio") == bio

    def test_bio_surfaces_in_auth_me_and_profile(self, opted_session):
        bio = "surfaced bio " + uuid.uuid4().hex[:6]
        opted_session.put(f"{API}/account/bio", json={"bio": bio}, timeout=15)

        r_me = opted_session.get(f"{API}/auth/me", timeout=15)
        assert r_me.status_code == 200
        assert "bio" in r_me.json(), f"bio missing in /auth/me: keys={list(r_me.json().keys())}"
        assert r_me.json().get("bio") == bio

        r_prof = opted_session.get(f"{API}/auth/profile", timeout=15)
        assert r_prof.status_code == 200
        body = r_prof.json()
        # /auth/profile might wrap in a "profile" key — accept either
        candidate = body.get("bio") if "bio" in body else (body.get("profile") or {}).get("bio")
        assert candidate == bio, f"bio not surfaced in /auth/profile: {body}"

    def test_bio_over_280_rejected_422(self, opted_session):
        big = "x" * 290
        r = opted_session.put(f"{API}/account/bio", json={"bio": big}, timeout=15)
        assert r.status_code == 422, f"expected 422 for >280 chars, got {r.status_code} {r.text[:200]}"

    def test_bio_surfaces_in_library_preview_anon(self, opted_session, anon_session):
        bio = "preview bio " + uuid.uuid4().hex[:6]
        opted_session.put(f"{API}/account/bio", json={"bio": bio}, timeout=15)
        r = anon_session.get(f"{API}/users/{OPTED_HANDLE}/library-preview", timeout=15)
        assert r.status_code == 200
        assert r.json().get("bio") == bio

    def test_bio_surfaces_in_cover_profile_anon(self, opted_session, anon_session):
        bio = "cover bio " + uuid.uuid4().hex[:6]
        opted_session.put(f"{API}/account/bio", json={"bio": bio}, timeout=15)
        r = anon_session.get(f"{API}/users/{OPTED_HANDLE}/cover-profile", timeout=15)
        # anon may or may not be allowed — accept 200 with bio, or skip if 401
        if r.status_code == 401:
            pytest.skip("cover-profile requires auth in this env")
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        candidate = body.get("bio") or (body.get("profile") or {}).get("bio")
        assert candidate == bio, f"bio not in cover-profile: {body}"

    def test_bio_surfaces_in_public_library_owner(self, opted_session):
        bio = "lib bio " + uuid.uuid4().hex[:6]
        opted_session.put(f"{API}/account/bio", json={"bio": bio}, timeout=15)
        # Must be authed for public-library
        r = opted_session.get(f"{API}/users/{OPTED_HANDLE}/public-library", timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        owner = body.get("owner") or {}
        assert owner.get("bio") == bio, f"bio missing on owner block: owner={owner}"


# ============================================================================
# RSS token lazy-create + regenerate
# ============================================================================
class TestRssToken:
    def test_lazy_create_returns_token_and_idempotent(self, opted_session):
        r1 = opted_session.get(f"{API}/account/library-rss-token", timeout=15)
        assert r1.status_code == 200, f"{r1.status_code} {r1.text[:200]}"
        t1 = r1.json().get("rss_token", "")
        assert isinstance(t1, str) and len(t1) >= 24, f"token too short: {t1!r}"
        r2 = opted_session.get(f"{API}/account/library-rss-token", timeout=15)
        assert r2.status_code == 200
        t2 = r2.json().get("rss_token", "")
        assert t1 == t2, "token should be idempotent on subsequent GET"

    def test_regenerate_returns_new_token(self, opted_session):
        r0 = opted_session.get(f"{API}/account/library-rss-token", timeout=15)
        old = r0.json().get("rss_token", "")
        r1 = opted_session.post(f"{API}/account/library-rss-token/regenerate", timeout=15)
        assert r1.status_code == 200
        new = r1.json().get("rss_token", "")
        assert new and new != old, f"regenerate must return new token (old={old!r}, new={new!r})"
        # And subsequent GET returns the new one
        r2 = opted_session.get(f"{API}/account/library-rss-token", timeout=15)
        assert r2.json().get("rss_token", "") == new


# ============================================================================
# RSS feed endpoint
# ============================================================================
class TestRssFeed:
    def test_anon_with_correct_token_returns_valid_xml(self, opted_session, anon_session):
        # ensure user is opted in + has token
        opted_session.put(f"{API}/account/public-library-visibility",
                          json={"library_visible_to_public": True}, timeout=15)
        tok = opted_session.get(f"{API}/account/library-rss-token", timeout=15).json()["rss_token"]
        r = anon_session.get(
            f"{API}/feeds/library/{OPTED_HANDLE}.rss",
            params={"token": tok}, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        ct = r.headers.get("Content-Type", "")
        assert "application/rss+xml" in ct, f"unexpected content-type: {ct!r}"
        # Parse XML and verify structure
        root = ET.fromstring(r.content)
        assert root.tag.endswith("rss"), f"root tag is {root.tag!r}"
        channel = root.find("channel")
        assert channel is not None, "no <channel> element"
        assert channel.find("title") is not None, "no <title> in channel"
        # items may be 0 if library empty; if any, check structure
        items = channel.findall("item")
        for it in items:
            assert it.find("title") is not None

    def test_no_token_returns_404(self, anon_session):
        r = anon_session.get(f"{API}/feeds/library/{OPTED_HANDLE}.rss", timeout=15)
        assert r.status_code == 404

    def test_wrong_token_returns_404(self, anon_session):
        r = anon_session.get(
            f"{API}/feeds/library/{OPTED_HANDLE}.rss",
            params={"token": "definitely-not-the-token-xyz"}, timeout=15,
        )
        assert r.status_code == 404

    def test_not_opted_in_returns_404_with_any_token(self, anon_session):
        r = anon_session.get(
            f"{API}/feeds/library/{PRIVATE_HANDLE}.rss",
            params={"token": "anything"}, timeout=15,
        )
        assert r.status_code == 404

    def test_nonexistent_user_returns_404_with_any_token(self, anon_session):
        r = anon_session.get(
            f"{API}/feeds/library/zzz_nope_{uuid.uuid4().hex[:6]}.rss",
            params={"token": "anything"}, timeout=15,
        )
        assert r.status_code == 404

    def test_404_bodies_identical_no_enumeration(self, anon_session):
        bodies = []
        for url, params in [
            (f"{API}/feeds/library/{OPTED_HANDLE}.rss", {}),  # no token
            (f"{API}/feeds/library/{OPTED_HANDLE}.rss", {"token": "wrong"}),
            (f"{API}/feeds/library/{PRIVATE_HANDLE}.rss", {"token": "wrong"}),
            (f"{API}/feeds/library/zzz_nope_{uuid.uuid4().hex[:6]}.rss", {"token": "wrong"}),
        ]:
            r = anon_session.get(url, params=params, timeout=15)
            assert r.status_code == 404
            bodies.append(r.text)
        # all four 404 bodies must be identical (no enumeration)
        assert len(set(bodies)) == 1, f"404 bodies differ: {bodies}"
