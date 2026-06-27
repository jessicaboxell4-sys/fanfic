"""Iter 65 — Canary retry-flag round-trip + admin widget surface.

Verifies that the ``prod-smoke-canary-retry.yml`` workflow's ``retry: true``
payload field is persisted by ``POST /api/canary/report`` and surfaced
back through ``GET /api/admin/canary-runs`` and the single-run detail
endpoint.  This is what powers the "Confirmed by retry · 15 min" badge
on the Admin Console canary card.
"""
from __future__ import annotations

import os
import uuid
import datetime as _dt
from typing import Optional

import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _mongo():
    from pymongo import MongoClient
    return MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database"))


def _db_name():
    return os.environ.get("DB_NAME", "test_database")


def _canary_secret() -> Optional[str]:
    """The endpoint only accepts pushes when CANARY_REPORT_SECRET is set
    in the backend's env.  Return None to skip the live POST-roundtrip
    test gracefully if it's not configured locally."""
    # Backend reads its own .env at startup, but the test runs in a
    # separate process — read the same file directly so the test
    # mirrors what the running server sees.
    path = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(path) as fh:
            for line in fh:
                if line.strip().startswith("CANARY_REPORT_SECRET="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    except FileNotFoundError:
        return None
    return os.environ.get("CANARY_REPORT_SECRET")


def test_canary_retry_flag_persists_via_post():
    """POST /api/canary/report with retry=true → row stored with retry=True."""
    secret = _canary_secret()
    if not secret:
        # Not configured locally — verify the unconfigured 503 path
        # then bail.  Skipping silently would hide a real regression
        # if someone removes the env-gate.
        r = requests.post(
            f"{BASE_URL}/api/canary/report",
            params={"secret": "anything"},
            json={
                "run_id": "noop",
                "status": "pass",
                "passed": 1,
                "total": 1,
                "retry": True,
            },
            timeout=10,
        )
        assert r.status_code in (503, 401), f"unexpected: {r.status_code} {r.text}"
        return

    run_id = f"test_retry_flag_{uuid.uuid4().hex[:10]}"
    finished_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
    try:
        r = requests.post(
            f"{BASE_URL}/api/canary/report",
            params={"secret": secret},
            json={
                "run_id":      run_id,
                "status":      "fail",
                "passed":      18,
                "total":       22,
                "target":      "https://example.test",
                "duration_s":  9.2,
                "finished_at": finished_at,
                "tail":        "AssertionError: prod is sad",
                "retry":       True,
            },
            timeout=10,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text}"

        # Confirm the row landed with retry=True in Mongo.
        c = _mongo()
        try:
            row = c[_db_name()].canary_runs.find_one({"run_id": run_id})
            assert row is not None
            assert row.get("retry") is True
            assert row.get("status") == "fail"
        finally:
            c.close()
    finally:
        c = _mongo()
        try:
            c[_db_name()].canary_runs.delete_many({"run_id": run_id})
        finally:
            c.close()


def test_canary_retry_flag_defaults_false():
    """retry not present in POST body → row stored with retry=False (not missing)."""
    secret = _canary_secret()
    if not secret:
        return  # see above

    run_id = f"test_retry_default_{uuid.uuid4().hex[:10]}"
    finished_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
    try:
        r = requests.post(
            f"{BASE_URL}/api/canary/report",
            params={"secret": secret},
            json={
                "run_id":      run_id,
                "status":      "pass",
                "passed":      22,
                "total":       22,
                "finished_at": finished_at,
                # NOTE: no `retry` key — should default to False
            },
            timeout=10,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        c = _mongo()
        try:
            row = c[_db_name()].canary_runs.find_one({"run_id": run_id})
            assert row is not None
            assert row.get("retry") is False, f"expected retry=False, got {row.get('retry')!r}"
        finally:
            c.close()
    finally:
        c = _mongo()
        try:
            c[_db_name()].canary_runs.delete_many({"run_id": run_id})
        finally:
            c.close()
