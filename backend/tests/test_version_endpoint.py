"""Tests for /api/version — powers the NewVersionBanner auto-detect.

Contract:
  - Unauthenticated GET succeeds (it's polled from every page)
  - Returns ``boot_id`` (12 hex chars) and ``build_time`` (ISO ts)
  - ``boot_id`` stays stable across calls within the same process
    (so the frontend doesn't ping-pong)
"""
import os
import re

import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
_BOOT_RE = re.compile(r"^[0-9a-f]{12}$")


def test_version_unauthenticated():
    r = requests.get(f"{BASE}/api/version")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "boot_id" in data and "version" in data and "build_time" in data


def test_boot_id_format():
    r = requests.get(f"{BASE}/api/version")
    data = r.json()
    assert _BOOT_RE.match(data["boot_id"]), f"unexpected boot_id: {data['boot_id']!r}"


def test_boot_id_stable_within_process():
    """Two calls in quick succession should return the same boot_id —
    otherwise the frontend would flap the "refresh" banner."""
    r1 = requests.get(f"{BASE}/api/version").json()
    r2 = requests.get(f"{BASE}/api/version").json()
    assert r1["boot_id"] == r2["boot_id"]
    assert r1["build_time"] == r2["build_time"]


def test_build_time_is_iso():
    from datetime import datetime
    r = requests.get(f"{BASE}/api/version").json()
    # Must parse cleanly via fromisoformat
    datetime.fromisoformat(r["build_time"])
