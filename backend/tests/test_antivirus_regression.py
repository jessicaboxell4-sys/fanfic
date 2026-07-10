"""Regression: ScanResult shape + fail-open behavior for utils.antivirus.

Added 2026-07-01 alongside the concurrency-cap fix to guard against
accidental shape/behavior drift in _make_result / scan_bytes / scan_path.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

EXPECTED_KEYS = {"ok", "infected", "signature", "scanner", "elapsed_ms", "error"}


def _assert_shape(result):
    assert isinstance(result, dict), f"expected dict, got {type(result)}"
    assert set(result.keys()) == EXPECTED_KEYS, (
        f"ScanResult keys drifted: got {set(result.keys())}, expected {EXPECTED_KEYS}"
    )
    assert isinstance(result["ok"], bool)
    assert isinstance(result["infected"], bool)
    assert isinstance(result["signature"], str)
    assert isinstance(result["scanner"], str)
    assert isinstance(result["elapsed_ms"], int)
    assert isinstance(result["error"], str)


def test_scan_bytes_shape_and_fail_open(monkeypatch):
    from utils import antivirus

    # Force scanner-unavailable path to prove fail-open shape.
    monkeypatch.setattr(antivirus, "is_available", lambda: False)
    result = antivirus.scan_bytes(b"hello world", hint_name="test.epub")
    _assert_shape(result)
    # Fail-open: ok=False + error set, but caller should not crash.
    assert result["ok"] is False
    assert "unavailable" in result["error"].lower()
    assert result["infected"] is False


def test_scan_bytes_empty_returns_ok():
    from utils import antivirus

    result = antivirus.scan_bytes(b"")
    _assert_shape(result)
    assert result["ok"] is True
    assert result["infected"] is False
    assert result["error"] == ""


def test_scan_path_missing_file_returns_error_shape(tmp_path):
    from utils import antivirus

    missing = tmp_path / "does_not_exist.epub"
    result = antivirus.scan_path(missing)
    _assert_shape(result)
    assert result["ok"] is False
    assert "path not found" in result["error"]


def test_scan_path_fail_open_when_unavailable(monkeypatch, tmp_path):
    from utils import antivirus

    p = tmp_path / "a.epub"
    p.write_bytes(b"dummy content")
    monkeypatch.setattr(antivirus, "is_available", lambda: False)
    result = antivirus.scan_path(p)
    _assert_shape(result)
    assert result["ok"] is False
    assert "unavailable" in result["error"].lower()


def test_scan_bytes_oversize_rejected(monkeypatch):
    from utils import antivirus

    # Trick MAX_SCAN_BYTES to a low value so we don't allocate GBs.
    monkeypatch.setattr(antivirus, "MAX_SCAN_BYTES", 10)
    result = antivirus.scan_bytes(b"x" * 100)
    _assert_shape(result)
    assert result["ok"] is False
    assert "exceeds" in result["error"]
