"""Iter 66 — Canary effective_state derivation.

Verifies the public ``/api/canary/status`` correctly collapses the
(primary, retry) GitHub-Actions workflow runs into a single
``effective_state`` ∈ {healthy, retrying, recovered, failing, unknown}.

This is what powers the trust-signal caption under the shields.io
badge on ``/changelog``: visitors see "🟢 healthy", "🟡 retrying
after blip", "🟢 recovered after blip", or "🔴 needs attention"
without having to read the badge SVG.
"""
from __future__ import annotations

import os
import sys

# Make the backend importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.changelog import _compute_effective_state  # noqa: E402


def _run(conclusion=None, status="completed", updated_at="2026-06-27T12:00:00Z"):
    return {
        "conclusion": conclusion,
        "status":     status,
        "updated_at": updated_at,
        "html_url":   "https://example.test/run",
        "run_number": 42,
    }


def test_healthy_when_primary_succeeded():
    primary = _run(conclusion="success")
    assert _compute_effective_state(primary, None) == "healthy"


def test_healthy_ignores_retry_when_primary_succeeded():
    # A stale retry from a previous incident shouldn't override a
    # current-success primary.
    primary = _run(conclusion="success", updated_at="2026-06-27T12:00:00Z")
    retry = _run(conclusion="failure", updated_at="2026-06-26T03:00:00Z")
    assert _compute_effective_state(primary, retry) == "healthy"


def test_retrying_when_retry_in_progress():
    primary = _run(conclusion="failure", updated_at="2026-06-27T12:00:00Z")
    retry = _run(conclusion=None, status="in_progress", updated_at="2026-06-27T12:15:00Z")
    assert _compute_effective_state(primary, retry) == "retrying"


def test_retrying_when_retry_queued():
    primary = _run(conclusion="failure")
    retry = _run(conclusion=None, status="queued", updated_at="2026-06-27T12:01:00Z")
    assert _compute_effective_state(primary, retry) == "retrying"


def test_recovered_when_newer_retry_succeeded():
    primary = _run(conclusion="failure", updated_at="2026-06-27T12:00:00Z")
    retry = _run(conclusion="success", updated_at="2026-06-27T12:16:00Z")
    assert _compute_effective_state(primary, retry) == "recovered"


def test_failing_when_newer_retry_also_failed():
    primary = _run(conclusion="failure", updated_at="2026-06-27T12:00:00Z")
    retry = _run(conclusion="failure", updated_at="2026-06-27T12:16:00Z")
    assert _compute_effective_state(primary, retry) == "failing"


def test_failing_when_no_retry_yet():
    # Primary just failed, retry hasn't kicked in yet (within the
    # 15-min cool-down).  We should NOT pretend it's recovering.
    primary = _run(conclusion="failure")
    assert _compute_effective_state(primary, None) == "failing"


def test_failing_when_retry_is_older_than_primary():
    # A stale retry from a previous incident — primary's latest
    # failure is newer, so we treat this as a fresh failure.
    primary = _run(conclusion="failure", updated_at="2026-06-27T12:00:00Z")
    retry = _run(conclusion="success", updated_at="2026-06-26T03:00:00Z")
    assert _compute_effective_state(primary, retry) == "failing"


def test_unknown_when_primary_is_none():
    # GitHub API unreachable / rate-limited — return unknown so the
    # FE renders a neutral dot instead of pretending it's healthy.
    assert _compute_effective_state(None, None) == "unknown"
    assert _compute_effective_state(None, _run(conclusion="success")) == "unknown"
