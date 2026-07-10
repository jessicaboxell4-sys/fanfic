"""Tests for the new signup-config + rules + onboarding endpoints (iter 29)."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get('TEST_BASE_URL') or os.environ.get('REACT_APP_BACKEND_URL') or 'http://localhost:8001'
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "shelfsort-tester@example.com"
ADMIN_PW = "tester123!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    # Secure cookies aren't kept by requests over http; pull the token
    # out of Set-Cookie and use the Bearer fallback the API supports.
    tok = s.cookies.get("session_token")
    if not tok:
        # Parse from raw response headers
        raw = r.headers.get("set-cookie", "")
        import re as _re
        m = _re.search(r"session_token=([^;]+)", raw)
        if m:
            tok = m.group(1)
    assert tok, f"could not extract session_token from login response: {r.headers}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    yield s
    # reset to baseline
    s.put(f"{API}/admin/signup-config",
          json={"approval_gate_enabled": True, "questions_enabled": False}, timeout=20)


# ---------- public endpoints ----------
def test_public_signup_config_shape():
    r = requests.get(f"{API}/signup/config", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert set(d.keys()) >= {"approval_gate_enabled", "questions_enabled"}
    assert isinstance(d["approval_gate_enabled"], bool)
    assert isinstance(d["questions_enabled"], bool)


def test_public_rules_returns_markdown():
    r = requests.get(f"{API}/rules", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "rules_md" in d
    assert isinstance(d["rules_md"], str)
    assert len(d["rules_md"]) > 50


# ---------- admin auth required ----------
def test_admin_signup_config_requires_auth():
    r = requests.get(f"{API}/admin/signup-config", timeout=20)
    assert r.status_code in (401, 403)


# ---------- admin GET full config ----------
def test_admin_get_full_config(admin_session):
    r = admin_session.get(f"{API}/admin/signup-config", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("approval_gate_enabled", "questions_enabled", "rules_md", "updated_at", "updated_by"):
        assert k in d, f"missing {k}"


# ---------- admin PUT validation ----------
def test_put_rules_too_short(admin_session):
    r = admin_session.put(f"{API}/admin/signup-config", json={"rules_md": "tiny"}, timeout=20)
    assert r.status_code == 400


def test_put_rules_too_long(admin_session):
    r = admin_session.put(f"{API}/admin/signup-config",
                          json={"rules_md": "x" * 50_001}, timeout=20)
    assert r.status_code == 413


def test_put_patch_subset(admin_session):
    # flip flags both ways
    r = admin_session.put(f"{API}/admin/signup-config",
                          json={"approval_gate_enabled": False, "questions_enabled": True}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["approval_gate_enabled"] is False
    assert d["questions_enabled"] is True
    # public reflects it
    pub = requests.get(f"{API}/signup/config", timeout=20).json()
    assert pub["approval_gate_enabled"] is False
    assert pub["questions_enabled"] is True


# ---------- onboarding-stats ----------
def test_onboarding_stats_shape(admin_session):
    r = admin_session.get(f"{API}/admin/onboarding-stats", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("referral", "reader_type", "favorite_fandoms", "age_13_plus", "age_under_13"):
        assert k in d


# ---------- register flow with gate OFF ----------
def test_register_gate_off_auto_approves(admin_session):
    admin_session.put(f"{API}/admin/signup-config",
                      json={"approval_gate_enabled": False, "questions_enabled": False}, timeout=20)
    ts = int(time.time() * 1000)
    email = f"TEST_gateoff_{ts}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "hunter2pw"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("approval_status") == "approved"
    assert "pending" not in d or d.get("pending") is not True


# ---------- register with questions_enabled=true ----------
def test_register_missing_onboarding(admin_session):
    admin_session.put(f"{API}/admin/signup-config",
                      json={"approval_gate_enabled": True, "questions_enabled": True}, timeout=20)
    ts = int(time.time() * 1000)
    email = f"TEST_missingob_{ts}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "hunter2pw", "accepted_rules": True}, timeout=20)
    assert r.status_code == 400
    assert "onboarding" in (r.json().get("detail") or "").lower()


def test_register_missing_rules(admin_session):
    ts = int(time.time() * 1000)
    email = f"TEST_missrules_{ts}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "hunter2pw",
                            "onboarding": {"referral": "google", "is_13_plus": True}}, timeout=20)
    assert r.status_code == 400
    assert "rules" in (r.json().get("detail") or "").lower()


def test_register_under_13(admin_session):
    ts = int(time.time() * 1000)
    email = f"TEST_under13_{ts}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "hunter2pw", "accepted_rules": True,
                            "onboarding": {"referral": "google", "is_13_plus": False}}, timeout=20)
    assert r.status_code == 403
    assert "13" in (r.json().get("detail") or "")


def test_register_full_flow_persists_onboarding(admin_session):
    # snapshot referral count for "reddit" before
    stats_before = admin_session.get(f"{API}/admin/onboarding-stats", timeout=20).json()
    reddit_before = next((x["count"] for x in stats_before["referral"] if x["label"] == "reddit"), 0)

    ts = int(time.time() * 1000)
    email = f"TEST_full_{ts}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={
                          "email": email,
                          "password": "hunter2pw",
                          "accepted_rules": True,
                          "onboarding": {
                              "referral": "reddit",
                              "favorite_fandom": "Star Wars",
                              "reader_type": "fanfic",
                              "is_13_plus": True,
                          },
                      }, timeout=20)
    assert r.status_code == 200, r.text
    # When gate ON + questions ON, user goes pending so no session, but onboarding persisted
    stats_after = admin_session.get(f"{API}/admin/onboarding-stats", timeout=20).json()
    reddit_after = next((x["count"] for x in stats_after["referral"] if x["label"] == "reddit"), 0)
    assert reddit_after == reddit_before + 1, f"stats did not increment: {reddit_before} -> {reddit_after}"
