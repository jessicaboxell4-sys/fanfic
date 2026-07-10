"""Regression test for /api/account/reader-prefs."""
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
EMAIL = "shelfsort-tester@example.com"
PASSWORD = "tester123!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    # Ensure clean slate
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.users.update_one({"email": EMAIL}, {"$unset": {"reader_prefs": ""}})
    yield s
    db.users.update_one({"email": EMAIL}, {"$unset": {"reader_prefs": ""}})


def test_get_empty_returns_empty_dict(session):
    r = session.get(f"{BASE_URL}/api/account/reader-prefs", timeout=20)
    assert r.status_code == 200, r.text[:200]
    assert r.json() == {}


def test_patch_creates_then_get_round_trips(session):
    r = session.patch(
        f"{BASE_URL}/api/account/reader-prefs",
        json={"theme": "midnight", "font": "lora"},
        timeout=20,
    )
    assert r.status_code == 200, r.text[:200]
    assert r.json()["reader_prefs"]["theme"] == "midnight"

    get = session.get(f"{BASE_URL}/api/account/reader-prefs", timeout=20).json()
    assert get["theme"] == "midnight"
    assert get["font"] == "lora"


def test_partial_patch_preserves_untouched_field(session):
    session.patch(
        f"{BASE_URL}/api/account/reader-prefs",
        json={"theme": "midnight", "font": "lora"},
        timeout=20,
    )
    r = session.patch(
        f"{BASE_URL}/api/account/reader-prefs",
        json={"theme": "sepia-night"},
        timeout=20,
    )
    assert r.status_code == 200
    after = session.get(f"{BASE_URL}/api/account/reader-prefs", timeout=20).json()
    assert after["theme"] == "sepia-night"
    assert after["font"] == "lora"  # unchanged


def test_patch_rejects_unknown_value(session):
    r = session.patch(
        f"{BASE_URL}/api/account/reader-prefs",
        json={"theme": "wrong-theme"},
        timeout=20,
    )
    assert r.status_code == 400
    assert "Unknown theme" in r.text


def test_patch_empty_body_is_noop(session):
    r = session.patch(f"{BASE_URL}/api/account/reader-prefs", json={}, timeout=20)
    assert r.status_code == 200
    assert r.json().get("noop") is True
