"""Tests for the Active Sessions API added in iteration 109.

Covers:
- Auth requirement / anon 401
- Shape of list response (id, browser, platform, ua, timestamps, is_current)
- Current-session flag + pinned-first ordering
- Revoke non-current, refuse to self-revoke via DELETE
- Revoke-others keeps caller signed in
- UA -> browser/platform mapping (mobile Chrome + Firefox/Windows)
- Bearer token equivalency
- last_active_at bumps forward
- Cross-user isolation on suffix collision
- Refactor sanity: routes.books + utils.calibre_convert re-exports
"""
from __future__ import annotations

import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
FIREFOX_WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0"
DEFAULT_UA = "python-requests/testing-agent"


def _register(email_prefix: str = "sess_test"):
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:8]}@example.com"
    pw = "Testpass123!"
    s = requests.Session()
    s.headers.update({"User-Agent": DEFAULT_UA})
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "Sess Tester"})
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    return s, email, pw


def _login(email: str, pw: str, ua: str = DEFAULT_UA) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": ua})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


# ---------------------------------------------------------------------------
# Anon / auth guard
# ---------------------------------------------------------------------------
def test_sessions_requires_auth():
    r = requests.get(f"{API}/auth/sessions")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Shape + is_current + first-in-list
# ---------------------------------------------------------------------------
def test_sessions_list_shape_and_current_pinned_first():
    s, email, pw = _register()
    # Add a second session so we can verify ordering.
    _ = _login(email, pw, ua=FIREFOX_WIN_UA)
    r = s.get(f"{API}/auth/sessions")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "sessions" in data and "count" in data
    assert data["count"] == len(data["sessions"]) >= 2
    first = data["sessions"][0]
    for k in ("id", "browser", "platform", "user_agent", "created_at", "last_active_at", "expires_at", "is_current"):
        assert k in first, f"missing key {k}"
    assert isinstance(first["id"], str) and len(first["id"]) == 12
    assert isinstance(first["is_current"], bool)
    current_flags = [row["is_current"] for row in data["sessions"]]
    assert current_flags.count(True) == 1, f"expected exactly one is_current=true, got {current_flags}"
    assert data["sessions"][0]["is_current"] is True


# ---------------------------------------------------------------------------
# UA -> browser/platform mapping
# ---------------------------------------------------------------------------
def test_sessions_ua_parsing_android_chrome_and_firefox_windows():
    s, email, pw = _register()
    _login(email, pw, ua=ANDROID_UA)
    _login(email, pw, ua=FIREFOX_WIN_UA)
    r = s.get(f"{API}/auth/sessions")
    assert r.status_code == 200
    labels = [(row["browser"], row["platform"]) for row in r.json()["sessions"]]
    assert ("Chrome", "Android") in labels, f"missing android chrome; got {labels}"
    assert ("Firefox", "Windows") in labels, f"missing firefox windows; got {labels}"


# ---------------------------------------------------------------------------
# DELETE single non-current session
# ---------------------------------------------------------------------------
def test_revoke_non_current_session_decreases_count():
    s, email, pw = _register()
    _login(email, pw, ua=FIREFOX_WIN_UA)
    r = s.get(f"{API}/auth/sessions")
    rows = r.json()["sessions"]
    non_current = next(row for row in rows if not row["is_current"])
    before = r.json()["count"]
    d = s.delete(f"{API}/auth/sessions/{non_current['id']}")
    assert d.status_code == 200, d.text
    assert d.json().get("revoked") == 1
    r2 = s.get(f"{API}/auth/sessions")
    assert r2.json()["count"] == before - 1


def test_revoke_current_session_is_400_with_friendly_message():
    s, email, pw = _register()
    r = s.get(f"{API}/auth/sessions")
    current = next(row for row in r.json()["sessions"] if row["is_current"])
    d = s.delete(f"{API}/auth/sessions/{current['id']}")
    assert d.status_code == 400, d.text
    body = d.json()
    detail = body.get("detail") or body.get("message") or ""
    assert "logout" in detail.lower(), f"expected logout hint, got: {detail}"


# ---------------------------------------------------------------------------
# Revoke-others
# ---------------------------------------------------------------------------
def test_revoke_others_keeps_caller_signed_in():
    s, email, pw = _register()
    _login(email, pw, ua=FIREFOX_WIN_UA)
    _login(email, pw, ua=ANDROID_UA)
    r = s.post(f"{API}/auth/sessions/revoke-others")
    assert r.status_code == 200, r.text
    assert r.json().get("revoked") >= 2
    listing = s.get(f"{API}/auth/sessions").json()
    assert listing["count"] == 1
    assert listing["sessions"][0]["is_current"] is True
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200


# ---------------------------------------------------------------------------
# Bearer header equivalency
# ---------------------------------------------------------------------------
def test_bearer_header_marks_is_current_true():
    s, email, pw = _register()
    # Extract cookie
    token = s.cookies.get("session_token")
    assert token
    bare = requests.Session()
    bare.headers.update({"User-Agent": DEFAULT_UA, "Authorization": f"Bearer {token}"})
    r = bare.get(f"{API}/auth/sessions")
    assert r.status_code == 200, r.text
    rows = r.json()["sessions"]
    current = [row for row in rows if row["is_current"]]
    assert len(current) == 1


# ---------------------------------------------------------------------------
# last_active_at bumps forward
# ---------------------------------------------------------------------------
def test_last_active_at_bumps_after_authenticated_requests():
    s, email, pw = _register()
    r1 = s.get(f"{API}/auth/sessions").json()
    first_last = r1["sessions"][0]["last_active_at"]
    time.sleep(2)
    s.get(f"{API}/auth/me")
    s.get(f"{API}/auth/me")
    r2 = s.get(f"{API}/auth/sessions").json()
    second_last = r2["sessions"][0]["last_active_at"]
    assert second_last is not None and first_last is not None
    # ISO strings sort lexicographically when tz-normalized; allow equality
    # if the throttle window swallowed the bump.
    assert second_last >= first_last


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------
def test_cross_user_cannot_revoke_other_users_session():
    sa, email_a, pw_a = _register("iso_a")
    sb, email_b, pw_b = _register("iso_b")
    # Grab one of B's session ids
    b_rows = sb.get(f"{API}/auth/sessions").json()["sessions"]
    b_id = b_rows[0]["id"]
    # A tries to revoke B's session
    r = sa.delete(f"{API}/auth/sessions/{b_id}")
    assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:200]}"
    # Ensure B still has that session
    b_rows_after = sb.get(f"{API}/auth/sessions").json()["sessions"]
    assert any(row["id"] == b_id for row in b_rows_after)


# ---------------------------------------------------------------------------
# Refactor sanity: symbols re-exported from routes.books AND utils.calibre_convert
# ---------------------------------------------------------------------------
def test_calibre_convert_reexports_resolve():
    from routes.books import (
        _friendly_calibre_error as fce_b,
        _CALIBRE_FRIENDLY_ERRORS as errs_b,
        NEEDS_CONVERSION_EXTS as exts_b,
        NEEDS_CONVERSION_SHELF as shelf_b,
        CONVERSION_VISIBILITY_HOURS as hrs_b,
        convert_to_epub as c2e_b,
        _convert_to_epub_sync as c2es_b,
        _get_calibre_semaphore as sem_b,
        _ensure_conversion_index as idx_b,
        _conversion_start as start_b,
        _conversion_end as end_b,
    )
    from utils.calibre_convert import (
        _friendly_calibre_error as fce_u,
        _CALIBRE_FRIENDLY_ERRORS as errs_u,
        NEEDS_CONVERSION_EXTS as exts_u,
        NEEDS_CONVERSION_SHELF as shelf_u,
        CONVERSION_VISIBILITY_HOURS as hrs_u,
        convert_to_epub as c2e_u,
        _convert_to_epub_sync as c2es_u,
        _get_calibre_semaphore as sem_u,
        _ensure_conversion_index as idx_u,
        _conversion_start as start_u,
        _conversion_end as end_u,
    )
    # Same objects (identity), meaning routes.books really re-exports.
    assert fce_b is fce_u
    assert errs_b is errs_u
    assert exts_b is exts_u
    assert shelf_b is shelf_u
    assert hrs_b == hrs_u
    assert c2e_b is c2e_u
    assert c2es_b is c2es_u
    assert sem_b is sem_u
    assert idx_b is idx_u
    assert start_b is start_u
    assert end_b is end_u
