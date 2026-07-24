"""Regression test — .env patterns must never appear in /app/.gitignore.

Recurrence history:
  1. 2026-06-27  agent auto-generated a .gitignore that ignored .env
  2. 2026-07-10  Emergent Support's history-reset re-added them
  3. 2026-08-22  agent (again) re-added `.env`, `.env.*`, `*.env`
  4. 2026-08-23  user found the same lines back at 178-180

Every recurrence breaks Emergent's MANAGE_SECRETS → pull_source step
with "read env file backend/.env: no such file or directory", killing
every subsequent deploy.  This test wraps the sentinel script so the
regression can never merge quietly.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_gitignore_has_no_env_patterns():
    script = Path("/app/scripts/env_gitignore_sentinel.py")
    assert script.exists(), f"Sentinel script missing: {script}"
    result = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, (
        f"env-in-gitignore sentinel FAILED (rc={result.returncode})\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )
