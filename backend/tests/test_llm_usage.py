"""Tests for utils/llm_usage — LLM key-health rollup (2026-06-22).

Follows the existing project pattern (sync `MongoClient` + `loop`
fixture used by ``test_email_volume_forecast``) rather than pulling
in pytest-asyncio, since the rest of the suite doesn't use it.
"""
from __future__ import annotations

import os
import sys
import pathlib
import uuid
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402


@pytest.fixture(scope="module")
def sync_db():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url, maxPoolSize=4)
    yield c[name]
    c.close()


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


def _run(loop, coro):
    return loop.run_until_complete(coro)


@pytest.fixture()
def clean_balance(sync_db):
    """Each test starts and ends with the balance singleton wiped."""
    sync_db.app_config.delete_one({"_id": "llm_key_balance"})
    yield
    sync_db.app_config.delete_one({"_id": "llm_key_balance"})


# ---------------------------------------------------------------------------
# Pure synchronous helpers — no event loop needed.
# ---------------------------------------------------------------------------
def test_estimate_cost_claude_pricing():
    """1k input + 500 output should match the list-price math."""
    from utils.llm_usage import estimate_cost_usd
    # 1000 * 3e-6 + 500 * 15e-6 = 0.003 + 0.0075 = 0.0105
    assert estimate_cost_usd("claude-sonnet-4-6", tokens_in=1000, tokens_out=500) == pytest.approx(0.0105)


def test_estimate_cost_nano_banana_per_image():
    from utils.llm_usage import estimate_cost_usd
    assert estimate_cost_usd("gemini-3.1-flash-image-preview", images=3) == pytest.approx(0.039 * 3)


def test_estimate_cost_unknown_model_returns_zero():
    """Unknown models cost $0 — better to under-estimate than guess."""
    from utils.llm_usage import estimate_cost_usd
    assert estimate_cost_usd("gpt-something-new", tokens_in=1000, tokens_out=500) == 0.0


# ---------------------------------------------------------------------------
# Async coroutines — driven through the shared loop fixture.
# ---------------------------------------------------------------------------
def test_log_llm_call_writes_row(loop, sync_db):
    from utils.llm_usage import log_llm_call
    marker = f"pytest_log_{uuid.uuid4().hex[:6]}"
    try:
        _run(loop, log_llm_call(marker, "claude-sonnet-4-6", tokens_in=1000, tokens_out=200, status="ok"))
        rows = list(sync_db.llm_usage.find({"kind": marker}))
        assert len(rows) == 1
        r = rows[0]
        assert r["model"] == "claude-sonnet-4-6"
        assert r["tokens_in"] == 1000
        assert r["tokens_out"] == 200
        assert r["cost_usd"] == pytest.approx(0.006)  # 1000*3e-6 + 200*15e-6
        assert r["status"] == "ok"
    finally:
        sync_db.llm_usage.delete_many({"kind": marker})


def test_log_llm_call_estimates_tokens_from_text(loop, sync_db):
    """When tokens_in/out aren't provided, estimate from string length."""
    from utils.llm_usage import log_llm_call
    marker = f"pytest_est_{uuid.uuid4().hex[:6]}"
    try:
        _run(loop, log_llm_call(
            marker, "claude-sonnet-4-6",
            prompt_text="a" * 400, response_text="b" * 200, status="ok",
        ))
        r = sync_db.llm_usage.find_one({"kind": marker})
        assert r is not None
        assert r["tokens_in"] == 100   # 400 / 4
        assert r["tokens_out"] == 50   # 200 / 4
        assert r["cost_usd"] > 0
    finally:
        sync_db.llm_usage.delete_many({"kind": marker})


def test_log_llm_call_never_raises_on_db_error(loop, monkeypatch):
    """Instrumentation must not break the calling feature on a Mongo blip."""
    from utils import llm_usage as mod

    class Boom:
        async def insert_one(self, *a, **kw):
            raise RuntimeError("simulated mongo blip")

    monkeypatch.setattr(mod.db, "llm_usage", Boom())
    # No assertion — the test passes iff this doesn't raise.
    _run(loop, mod.log_llm_call("classify", "claude-sonnet-4-6", tokens_in=10, tokens_out=10))


def test_set_balance_rejects_negative(loop, clean_balance):
    from utils.llm_usage import set_known_balance
    with pytest.raises(ValueError):
        _run(loop, set_known_balance(-1.0, who="tester@example.com"))


def test_set_and_get_balance_roundtrips(loop, clean_balance):
    from utils.llm_usage import set_known_balance, get_known_balance
    res = _run(loop, set_known_balance(4.85, who="tester@example.com"))
    assert res["usd"] == pytest.approx(4.85)
    assert res["set"] is True
    again = _run(loop, get_known_balance())
    assert again["usd"] == pytest.approx(4.85)
    assert again["updated_by"] == "tester@example.com"


def test_get_health_rollup_with_seeded_data(loop, sync_db, clean_balance):
    """Seed 2 ok + 1 error in the 7d window, verify rollup counts +
    per-kind breakdown + days-of-runway math."""
    from utils.llm_usage import get_llm_key_health, set_known_balance
    suffix = uuid.uuid4().hex[:6]
    classify_kind = f"pytest_classify_{suffix}"
    cover_kind = f"pytest_cover_{suffix}"
    now = datetime.now(timezone.utc)
    sync_db.llm_usage.insert_many([
        {"kind": classify_kind, "model": "claude-sonnet-4-6",
         "tokens_in": 1000, "tokens_out": 200, "images": 0,
         "cost_usd": 0.006, "status": "ok", "error": None,
         "created_at": now - timedelta(days=1)},
        {"kind": cover_kind, "model": "gemini-3.1-flash-image-preview",
         "tokens_in": 0, "tokens_out": 0, "images": 1,
         "cost_usd": 0.039, "status": "ok", "error": None,
         "created_at": now - timedelta(days=2)},
        {"kind": cover_kind, "model": "gemini-3.1-flash-image-preview",
         "tokens_in": 0, "tokens_out": 0, "images": 0,
         "cost_usd": 0.0, "status": "error", "error": "no image",
         "created_at": now - timedelta(days=3)},
    ])
    try:
        _run(loop, set_known_balance(10.0, who="tester@example.com"))
        out = _run(loop, get_llm_key_health())

        kinds = {r["kind"]: r for r in out["instrumented"]["last_7_days"]["by_kind"]}
        assert kinds[classify_kind]["calls"] == 1
        assert kinds[cover_kind]["calls"] == 2
        assert kinds[cover_kind]["errors"] == 1

        # Pricing constants are pinned.
        assert out["pricing_constants"]["nano_banana_per_image"] == pytest.approx(0.039)
        # Runway is positive + the level is one of the expected values.
        assert out["runway"]["days_remaining"] is not None
        assert out["runway"]["warning_level"] in {"ok", "warning", "critical"}
    finally:
        sync_db.llm_usage.delete_many({"kind": classify_kind})
        sync_db.llm_usage.delete_many({"kind": cover_kind})


def test_runway_warning_levels(loop, sync_db, clean_balance):
    """Critical < 7d, warning < 14d, ok ≥ 14d — verified against
    a controlled $1/day burn over the past week."""
    from utils.llm_usage import get_llm_key_health, set_known_balance
    suffix = uuid.uuid4().hex[:6]
    kind = f"pytest_runway_{suffix}"
    now = datetime.now(timezone.utc)
    rows = [
        {"kind": kind, "model": "claude-sonnet-4-6",
         "tokens_in": 0, "tokens_out": 0, "images": 0,
         "cost_usd": 1.0, "status": "ok", "error": None,
         "created_at": now - timedelta(days=i)}
        for i in range(7)
    ]
    sync_db.llm_usage.insert_many(rows)
    try:
        # Balance 3 → ~3-day runway → critical
        _run(loop, set_known_balance(3.0, who="t@example.com"))
        out = _run(loop, get_llm_key_health())
        assert out["runway"]["warning_level"] == "critical"
        assert out["runway"]["daily_avg_usd"] == pytest.approx(1.0)

        # Balance 10 → 10-day runway → warning
        _run(loop, set_known_balance(10.0, who="t@example.com"))
        out = _run(loop, get_llm_key_health())
        assert out["runway"]["warning_level"] == "warning"

        # Balance 20 → 20-day runway → ok
        _run(loop, set_known_balance(20.0, who="t@example.com"))
        out = _run(loop, get_llm_key_health())
        assert out["runway"]["warning_level"] == "ok"
    finally:
        sync_db.llm_usage.delete_many({"kind": kind})


def test_runway_unknown_when_balance_not_set(loop, clean_balance):
    """Without a balance, we can't compute runway."""
    from utils.llm_usage import get_llm_key_health
    out = _run(loop, get_llm_key_health())
    assert out["balance"]["set"] is False
    assert out["runway"]["days_remaining"] is None
    assert out["runway"]["warning_level"] == "unknown"
