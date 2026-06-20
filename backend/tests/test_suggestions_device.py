"""Tests for the device picker on /api/suggestions.

Covers:
  - GET /api/suggestions/devices returns built-ins (auth required)
  - POST /api/suggestions REQUIRES ``device``
  - Built-in device names round-trip via the picker (case-insensitive)
  - Brand-new ``device`` strings get persisted to ``custom_devices``
    and show up in the next GET /devices response
  - Case-mismatched custom devices reuse the canonical casing
  - device is serialized on list responses (so the chip can render)
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = mc[os.environ.get("DB_NAME", "test_database")]

UID = f"user_dev_{uuid.uuid4().hex[:6]}"
TOK = f"sess_dev_{uuid.uuid4().hex}"


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": UID, "email": f"{UID}@ft.local",
        "name": "Device tester", "is_admin": False,
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": UID, "session_token": TOK,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    yield
    db.users.delete_many({"user_id": UID})
    db.user_sessions.delete_many({"user_id": UID})
    db.suggestions.delete_many({"submitter_user_id": UID})
    db.custom_devices.delete_many({"name_lc": {"$in": ["steam deck dev test", "boox dev test"]}})


def H():
    return {"Authorization": f"Bearer {TOK}"}


def test_devices_list_requires_auth():
    r = requests.get(f"{BASE}/api/suggestions/devices")
    assert r.status_code == 401


def test_devices_list_contains_built_ins():
    r = requests.get(f"{BASE}/api/suggestions/devices", headers=H())
    assert r.status_code == 200, r.text
    devices = r.json()["devices"]
    # Spot-check a few user-specified built-ins
    for name in ("iPhone", "Amazon Fire (Kindle Fire, Fire HD, Fire Tablet)",
                 "Android phone", "Chromebook", "Kindle e-reader", "Mac",
                 "Windows PC", "Linux"):
        assert name in devices, f"missing built-in: {name}"
    # Alphabetical ordering (case-insensitive)
    lowered = [d.lower() for d in devices]
    assert lowered == sorted(lowered)


def test_submit_requires_device():
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "no device", "body": "", "category": "bug"},
        headers=H(),
    )
    assert r.status_code == 422


def test_submit_builtin_device_round_trip():
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "iPhone bug", "body": "Reader laggy",
              "category": "bug", "device": "iPhone"},
        headers=H(),
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["device"] == "iPhone"


def test_submit_builtin_device_case_insensitive():
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "Lowercase iphone", "body": "",
              "category": "bug", "device": "iphone"},
        headers=H(),
    )
    assert r.status_code == 200
    # Canonical casing returned
    assert r.json()["device"] == "iPhone"


def test_submit_custom_device_added_to_picker():
    # Use a distinctive name unlikely to collide with another test.
    name = "Steam Deck Dev Test"
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "Custom device test", "body": "",
              "category": "feature", "device": name},
        headers=H(),
    )
    assert r.status_code == 200
    assert r.json()["device"] == name
    # Should appear in the next /devices response
    r2 = requests.get(f"{BASE}/api/suggestions/devices", headers=H())
    assert name in r2.json()["devices"]


def test_submit_custom_device_case_dedup():
    # Insert a different-cased duplicate of the existing custom one.
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "Lowercase steam deck", "body": "",
              "category": "feature", "device": "steam deck dev test"},
        headers=H(),
    )
    assert r.status_code == 200
    # Server should return the original casing
    assert r.json()["device"] == "Steam Deck Dev Test"
    # And the picker list should not duplicate
    r2 = requests.get(f"{BASE}/api/suggestions/devices", headers=H())
    devices = r2.json()["devices"]
    matches = [d for d in devices if d.lower() == "steam deck dev test"]
    assert len(matches) == 1, f"duplicate custom device: {matches}"


def test_list_serializes_device_field():
    r = requests.get(f"{BASE}/api/suggestions", headers=H(), params={"mine_only": "true"})
    assert r.status_code == 200
    for s in r.json()["suggestions"]:
        assert "device" in s


def test_custom_device_too_long_gets_clamped():
    long_name = "a" * 200  # 200 chars
    r = requests.post(
        f"{BASE}/api/suggestions",
        data={"title": "long device", "body": "",
              "category": "feature", "device": long_name},
        headers=H(),
    )
    # FastAPI's Form length validator clamps at _MAX_DEVICE_LEN=40
    assert r.status_code == 422
