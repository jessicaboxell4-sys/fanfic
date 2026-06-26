"""Iteration 50 — auth-required policy on /public-library.

Verifies the 2026-06-26 policy:
- /api/users/{username}/public-library is LOGIN-GATED.
- Anon callers ALWAYS get 401 (regardless of whether the handle exists
  or is opted in) — no leakage about handle validity to anonymous callers.
- Authenticated callers see the standard 200 (opted-in) vs 404 (not
  opted-in OR nonexistent) split.
- /api/share/u/{username}/library stays anon-accessible so FB/Twitter
  crawlers can render rich link previews.
- The previously-passing anon assertions in iteration_48/49 needed to
  be rewritten — see test_public_library.py + test_iteration_49.py.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OPTED_EMAIL = "TEST_fe_opted_e24c9d@example.com"
OPTED_PW = "hunter2pw!"
OPTED_HANDLE = "febopta508d"
PRIVATE_HANDLE = "febpri4c63f"


def _login_or_skip(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code}")
    return s


def _register_fresh():
    """Always-works fallback: register a brand new user."""
    email = f"TEST_iter50_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register",
               json={"email": email, "password": "hunter2pw!", "name": "Iter50"},
               timeout=20)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    return s, email


@pytest.fixture(scope="module")
def opted_session():
    return _login_or_skip(OPTED_EMAIL, OPTED_PW)


@pytest.fixture(scope="module")
def fresh_session():
    s, _email = _register_fresh()
    return s


# ---------------------------------------------------------------- 401 invariants

class TestAuthGate401:
    def test_anon_opted_in_handle_returns_401(self):
        r = requests.get(f"{API}/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_anon_not_opted_in_handle_returns_401(self):
        r = requests.get(f"{API}/users/{PRIVATE_HANDLE}/public-library", timeout=15)
        assert r.status_code == 401

    def test_anon_nonexistent_handle_returns_401(self):
        r = requests.get(f"{API}/users/zzz_nope_{uuid.uuid4().hex[:6]}/public-library", timeout=15)
        assert r.status_code == 401

    def test_anon_with_query_params_still_401(self):
        """q/limit params must not bypass the auth gate."""
        r = requests.get(f"{API}/users/{OPTED_HANDLE}/public-library",
                         params={"q": "harry", "limit": 5}, timeout=15)
        assert r.status_code == 401


# ---------------------------------------------------------------- Authed access

class TestAuthedAccess:
    def test_signed_in_opted_in_returns_200(self, fresh_session):
        r = fresh_session.get(f"{API}/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "owner" in data and data["owner"].get("username") == OPTED_HANDLE
        assert isinstance(data.get("books"), list)
        assert "top_fandoms" in data
        assert "overlap_count" in data
        assert data.get("viewer_is_signed_in") is True

    def test_signed_in_not_opted_in_returns_404(self, fresh_session):
        r = fresh_session.get(f"{API}/users/{PRIVATE_HANDLE}/public-library", timeout=15)
        assert r.status_code == 404

    def test_signed_in_nonexistent_returns_404(self, fresh_session):
        r = fresh_session.get(
            f"{API}/users/zzz_nope_{uuid.uuid4().hex[:6]}/public-library", timeout=15)
        assert r.status_code == 404

    def test_handle_enumeration_prevention(self, fresh_session):
        """Not-opted-in vs nonexistent — both 404 with same body."""
        r1 = fresh_session.get(f"{API}/users/{PRIVATE_HANDLE}/public-library", timeout=15)
        r2 = fresh_session.get(
            f"{API}/users/zzz_nope_{uuid.uuid4().hex[:6]}/public-library", timeout=15)
        assert r1.status_code == 404 and r2.status_code == 404
        assert r1.json() == r2.json()

    def test_owner_self_view(self, opted_session):
        """Owner: 200, overlap_count=0, viewer_is_signed_in=False."""
        r = opted_session.get(f"{API}/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("overlap_count") == 0
        assert data.get("viewer_is_signed_in") is False


# ---------------------------------------------------------------- OG stays public

class TestOGShareStaysPublic:
    def test_og_opted_in_anon_200(self):
        r = requests.get(f"{API}/share/u/{OPTED_HANDLE}/library", timeout=15,
                         headers={"User-Agent": "facebookexternalhit/1.1"})
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        body = r.text
        assert 'property="og:title"' in body
        assert 'property="og:description"' in body
        assert 'property="og:image"' in body or "og:image" in body

    def test_og_not_opted_in_anon_404(self):
        r = requests.get(f"{API}/share/u/{PRIVATE_HANDLE}/library", timeout=15)
        assert r.status_code == 404

    def test_og_nonexistent_anon_404(self):
        r = requests.get(f"{API}/share/u/zzz_nope_{uuid.uuid4().hex[:6]}/library", timeout=15)
        assert r.status_code == 404
