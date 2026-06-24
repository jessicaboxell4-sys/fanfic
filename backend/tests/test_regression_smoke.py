"""Regression smoke — fast cross-cutting sweep of the endpoints we
care about most when refactoring.

This file is the "1-minute confidence" suite.  Every test is tagged
``@pytest.mark.regression_smoke`` (module-level pytestmark) so you can
run JUST these without paying for the rest of the integration suite:

    pytest -m regression_smoke              # ~5 s, no LLM calls
    ./scripts/run_regression_smoke.sh       # same, wrapped

History:
- 2026-06-25 — Born as iter37 regression for the Phase 6A cover
  extraction.  Renamed to ``test_regression_smoke.py`` and adopted as
  the permanent post-refactor guardrail.

Coverage scope:
  - Health endpoint (mongo + storage + scheduler)
  - routes/covers.py (Phase 6A extracted)
  - routes/books.py (after extraction)
  - routes/friends.py (directory + friend request)
  - routes/suggestions.py (status, is_mine, shipped exemplars)

Add to this file any time you do a refactor that touches multiple
route modules — the goal is a single ``pytest -m regression_smoke``
catches the obvious breakage.
"""
import os
import time
import uuid
import pytest
import requests

# Module-level mark — every test in this file is part of the
# regression smoke band.  Run with `pytest -m regression_smoke`.
pytestmark = pytest.mark.regression_smoke

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Fresh registration — seeded tester password may have rotated.
    email = f"iter37-{int(time.time())}-{uuid.uuid4().hex[:6]}@example.com"
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "hunter2pw", "name": "Iter37 Tester"},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:300]}"
    return s


# -------------------------------------------------------------------- #
# Health                                                              #
# -------------------------------------------------------------------- #

def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    checks = data.get("checks", {})
    assert checks.get("mongo", {}).get("ok") is True, data
    assert checks.get("storage", {}).get("ok") is True, data
    assert checks.get("scheduler", {}).get("running") is True, data


# -------------------------------------------------------------------- #
# Refactor regression: routes/covers.py (extracted from books.py)     #
# -------------------------------------------------------------------- #

def test_cover_styles_returns_at_least_8(session):
    r = session.get(f"{BASE_URL}/api/cover-styles", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "styles" in data
    assert len(data["styles"]) >= 8, f"only {len(data['styles'])} styles"


def test_books_cover_less_shape(session):
    r = session.get(f"{BASE_URL}/api/books/cover-less", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "books" in data and "total" in data and "limit" in data


def test_community_covers_featured(session):
    r = session.get(f"{BASE_URL}/api/community-covers/featured?limit=3", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "covers" in data and "window_days" in data


def test_community_covers_browse_with_title(session):
    r = session.get(f"{BASE_URL}/api/community-covers?title=foo", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "covers" in data and "count" in data


def test_community_covers_requires_title(session):
    r = session.get(f"{BASE_URL}/api/community-covers", timeout=15)
    assert r.status_code in (400, 422), r.text[:300]


# -------------------------------------------------------------------- #
# Refactor regression: routes/books.py still wired                    #
# -------------------------------------------------------------------- #

@pytest.mark.parametrize("path", [
    "/api/books",
    "/api/books/recent",
    "/api/books/stats",
    "/api/fandoms",
    "/api/books/recent-updates",
])
def test_books_routes_still_200(session, path):
    r = session.get(f"{BASE_URL}{path}", timeout=20)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:300]}"


# -------------------------------------------------------------------- #
# Users directory (friends.py)                                        #
# -------------------------------------------------------------------- #

def test_users_directory_shape(session):
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=5", timeout=15)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    for k in ("users", "page", "limit", "total", "has_more"):
        assert k in data, f"missing {k}"
    assert isinstance(data["users"], list)
    # Each row: {user_id, username} — and crucially nothing else identifying.
    for u in data["users"]:
        assert "user_id" in u and "username" in u
        # No email / name / picture leak in the directory.
        assert "email" not in u
        assert "name" not in u
        assert "picture" not in u


def test_users_directory_excludes_requester(session):
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=10).json()
    my_id = me.get("user_id")
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=100", timeout=15)
    assert r.status_code == 200
    ids = [u["user_id"] for u in r.json().get("users", [])]
    assert my_id not in ids, "requester should be excluded from /users/directory"


# -------------------------------------------------------------------- #
# Friend request idempotency                                          #
# -------------------------------------------------------------------- #

def test_friend_request_idempotent(session):
    # Pick an arbitrary target from the directory.
    r = session.get(f"{BASE_URL}/api/users/directory?page=1&limit=20", timeout=15)
    rows = r.json().get("users", [])
    target = next((u for u in rows if u.get("username")), None)
    if not target:
        pytest.skip("no users with username in directory to friend")
    payload = {"target_username": target["username"]}
    r1 = session.post(f"{BASE_URL}/api/friends/request", json=payload, timeout=15)
    assert r1.status_code in (200, 409), r1.text[:300]
    # Re-sending: server returns 409 'Request already pending' OR 200
    # 'accepted'.  Both are acceptable idempotent behaviour.
    r2 = session.post(f"{BASE_URL}/api/friends/request", json=payload, timeout=15)
    assert r2.status_code in (200, 409), r2.text[:300]


# -------------------------------------------------------------------- #
# Suggestions list shape (status + submitter_name + is_mine)          #
# -------------------------------------------------------------------- #

def test_suggestions_list_shape(session):
    r = session.get(f"{BASE_URL}/api/suggestions", timeout=20)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    rows = data.get("suggestions", [])
    if not rows:
        pytest.skip("no suggestions seeded")
    for s in rows[:5]:
        for k in ("suggestion_id", "status", "submitter_name", "is_mine"):
            assert k in s, f"missing {k} in suggestion {s.get('suggestion_id')}"
        assert s["status"] in ("open", "under_review", "planned", "done", "declined")


def test_shipped_suggestions_present(session):
    """The two known shipped suggestions mentioned in the spec should
    exist with status='done' so the frontend can render the ribbon."""
    r = session.get(f"{BASE_URL}/api/suggestions?status=done", timeout=20)
    assert r.status_code == 200
    titles = [s.get("title", "") for s in r.json().get("suggestions", [])]
    found_dnd = any("drag-and-drop reorder" in t.lower() for t in titles)
    found_dark = any("dark mode reader skin" in t.lower() for t in titles)
    # At least one of the two shipped exemplars should be present.
    assert found_dnd or found_dark, f"no known shipped suggestions in done list: {titles[:10]}"


# -------------------------------------------------------------------- #
# Preview-cover sanity: must not 5xx-crash backend.  We DO NOT call   #
# the real LLM-billed path against a book; instead we hit it with a  #
# bogus book_id to confirm the endpoint exists + returns a structured#
# 404 (proves the route is wired post-extraction).                    #
# -------------------------------------------------------------------- #

def test_preview_cover_route_wired(session):
    r = session.post(
        f"{BASE_URL}/api/books/__nonexistent__/preview-cover",
        json={"nudge": None, "style_id": None},
        timeout=20,
    )
    # 404 ("Book not found") proves the route handler executed.  500
    # would mean the extraction broke something.
    assert r.status_code in (404, 422), f"got {r.status_code} {r.text[:300]}"
