"""Pytest wrapper for the frontend route sentinel."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SCRIPT = Path("/app/scripts/route_sentinel.py")


def test_frontend_route_sentinel_passes():
    """Every /link, to=, navigate() and window.location.href in the
    frontend source must match a route declared in App.js."""
    assert SCRIPT.exists(), f"route sentinel script missing at {SCRIPT}"
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"Route sentinel FAILED (exit={result.returncode}).\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
