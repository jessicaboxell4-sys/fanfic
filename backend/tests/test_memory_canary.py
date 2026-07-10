"""Pod memory canary — verifies the cgroup sampler + threshold logging.

Uses monkeypatched Path.read_text so the test doesn't depend on any
particular host cgroup layout.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_fake_cgroup(monkeypatch, used_bytes: int, limit_bytes):
    """Patch memory_canary._read_int to serve fake used/limit values."""
    from utils import memory_canary

    def _fake_read_int(p):
        if p == memory_canary._CGROUP_CURRENT:
            return used_bytes
        if p == memory_canary._CGROUP_MAX:
            return limit_bytes
        return None

    monkeypatch.setattr(memory_canary, "_read_int", _fake_read_int)
    memory_canary._state["tick"] = 0
    memory_canary._state["last_warn_tick"] = -999
    memory_canary._state["last_info_tick"] = -999


def test_sample_returns_none_when_cgroup_unreadable(monkeypatch):
    from utils import memory_canary
    monkeypatch.setattr(memory_canary, "_read_int", lambda _p: None)
    assert memory_canary.sample_pod_memory() is None


def test_sample_reports_percentage(monkeypatch):
    from utils import memory_canary
    # 1.6 GB used / 2 GB limit → 80%
    _install_fake_cgroup(monkeypatch, used_bytes=1_600_000_000, limit_bytes=2_000_000_000)
    snap = memory_canary.sample_pod_memory()
    assert snap is not None
    assert snap["pct"] == 80.0
    assert snap["over_warn"] is True
    assert snap["used_mb"] > 1500
    assert snap["limit_mb"] > 1900


def test_tick_logs_warning_over_threshold(shared_event_loop, monkeypatch, caplog):
    from utils import memory_canary
    _install_fake_cgroup(monkeypatch, used_bytes=1_800_000_000, limit_bytes=2_000_000_000)  # 90%
    with caplog.at_level(logging.WARNING, logger="utils.memory_canary"):
        snap = shared_event_loop.run_until_complete(memory_canary.pod_memory_canary_tick())
    assert snap["pct"] == 90.0
    assert any(
        "pod memory canary" in r.message.lower() and r.levelname == "WARNING"
        for r in caplog.records
    )


def test_tick_stays_quiet_when_under_info_threshold(shared_event_loop, monkeypatch, caplog):
    from utils import memory_canary
    _install_fake_cgroup(monkeypatch, used_bytes=800_000_000, limit_bytes=2_000_000_000)  # 40%
    with caplog.at_level(logging.INFO, logger="utils.memory_canary"):
        snap = shared_event_loop.run_until_complete(memory_canary.pod_memory_canary_tick())
    assert snap["pct"] == 40.0
    # No log records emitted by this module at 40%.
    assert not any(r.name == "utils.memory_canary" for r in caplog.records)


def test_tick_skips_gracefully_when_cgroup_unavailable(shared_event_loop, monkeypatch):
    from utils import memory_canary
    monkeypatch.setattr(memory_canary, "_read_int", lambda _p: None)
    memory_canary._state["tick"] = 0
    snap = shared_event_loop.run_until_complete(memory_canary.pod_memory_canary_tick())
    assert snap.get("skipped") is True
