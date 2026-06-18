"""Backend regression sweep for iteration 22 review request.

Covers public unauthenticated surfaces, anon vote, analytics view+stats,
admin gating for tester, push public key, reading-sync stuck books, and
affinity recommendations - per the testing-agent-to-agent context note.
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
TESTER_EMAIL = "shelfsort-tester@example.com"
TESTER_PASSWORD = "tester123!"
SEEDED_COVER_ID = "TEST_cover_1781750581_0"


@pytest.fixture(scope="module")
def anon_session():
    return requests.Session()


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TESTER_EMAIL, "password": TESTER_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    return s


# ---- Public / unauth surfaces ----------------------------------------
class TestPublicSurfaces:
    def test_explore_covers_endpoint(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/community-covers/explore", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("top_of_week", "trending", "recent"):
            assert k in d and isinstance(d[k], list)

    def test_single_cover_public(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/community-covers/{SEEDED_COVER_ID}", timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cover_id"] == SEEDED_COVER_ID
        assert d["shared_by"] == "tester"
        assert "votes" in d and "image_base64" in d

    def test_share_cover_html(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/share/cover/{SEEDED_COVER_ID}", timeout=10)
        assert r.status_code == 200
        assert "<!doctype html>" in r.text.lower()
        assert "tester" in r.text.lower()

    def test_share_user_html(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/share/u/tester", timeout=10)
        assert r.status_code == 200
        assert "@tester" in r.text or "tester" in r.text.lower()

    def test_sitemap(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/sitemap.xml", timeout=10)
        assert r.status_code == 200
        assert "<urlset" in r.text


# ---- Anonymous vote --------------------------------------------------
class TestAnonVote:
    def test_anon_vote_then_unvote_persists_via_cookie(self):
        s = requests.Session()  # fresh session for cookie isolation
        r1 = s.post(f"{BASE_URL}/api/community-covers/{SEEDED_COVER_ID}/vote-anon", json={}, timeout=10)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["ok"] is True
        assert "sscv" in s.cookies
        # voted_by_me + signup_prompt should be true on first vote
        assert d1.get("voted_by_me") is True
        assert d1.get("signup_prompt") is True
        # second click toggles off
        r2 = s.post(f"{BASE_URL}/api/community-covers/{SEEDED_COVER_ID}/vote-anon", json={}, timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("voted_by_me") is False


# ---- Analytics -------------------------------------------------------
class TestAnalytics:
    def test_view_anon(self, anon_session):
        r = anon_session.post(
            f"{BASE_URL}/api/analytics/view",
            json={"page_type": "explore", "slug": ""},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_public_stats(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/analytics/public-stats", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_users", "monthly_signups", "total_covers"):
            assert k in d and isinstance(d[k], int)

    def test_admin_summary_forbidden_for_tester(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/analytics/summary", timeout=10)
        assert r.status_code == 403

    def test_reading_privacy_toggle(self, auth_session):
        r = auth_session.post(
            f"{BASE_URL}/api/analytics/reading-data-sharing",
            json={"reading_data_shared": True},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("reading_data_shared") is True


# ---- Reading sync / stuck / affinity / push --------------------------
class TestReadingAndRecs:
    def test_stuck_books_endpoint(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/books/stuck", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "books" in d and isinstance(d["books"], list)
        assert "window_days" in d

    def test_affinity_recommendations(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/recommendations/by-affinity", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "recommendations" in d and isinstance(d["recommendations"], list)
        assert "top_fandoms" in d

    def test_push_vapid_public_key(self, anon_session):
        r = anon_session.get(f"{BASE_URL}/api/push/vapid-public-key", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("public_key") and len(d["public_key"]) > 20
