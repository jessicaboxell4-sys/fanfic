"""Startup-time validation of critical environment variables.

Catches the exact failure mode that took shelfsort.com down three
times: Emergent's MANAGE_SECRETS step silently failing (because
`.gitignore` re-added `.env` blocks) leaves the prod pod booting
without ``MONGO_URL`` / ``DB_NAME`` / ``REACT_APP_BACKEND_URL``.

Two surfaces:

  * ``validate_critical_env()`` — called from ``server.on_startup``.
    Emits a screaming-loud banner to the logs listing which vars are
    present / missing / malformed.  Sets ``CONFIG_OK`` so the
    ``/api/health`` probe can surface the same state to the canary
    monitor.

  * ``CONFIG_OK`` / ``CONFIG_FINDINGS`` — module-level state read
    by ``routes/health.py`` to flag the canary red the moment the
    pod boots with a broken config, instead of waiting for a user
    to report broken login.
"""
from __future__ import annotations

import logging
import os
from typing import Dict, List

logger = logging.getLogger("env_check")

# Snapshot of the most recent validation pass.  Read by /api/health.
CONFIG_OK: bool = True
CONFIG_FINDINGS: List[Dict[str, str]] = []


# Each tuple: (env_var_name, validator_callable, human_hint)
#
# validator_callable returns None on pass, or a short failure string.
def _v_non_empty(name: str):
    def _f(val: str | None):
        if not val or not val.strip():
            return f"{name} is empty"
        return None
    return _f


def _v_mongo_url(val: str | None):
    if not val or not val.strip():
        return "MONGO_URL is empty"
    if not (val.startswith("mongodb://") or val.startswith("mongodb+srv://")):
        return f"MONGO_URL does not start with mongodb:// or mongodb+srv:// (got {val[:30]}…)"
    return None


_CHECKS = [
    ("MONGO_URL", _v_mongo_url, "MongoDB connection string"),
    ("DB_NAME", _v_non_empty("DB_NAME"), "MongoDB database name"),
    ("CORS_ORIGINS", _v_non_empty("CORS_ORIGINS"), "CORS allowed origins"),
]


def validate_critical_env() -> bool:
    """Validate critical env vars at startup. Returns True if OK.

    Always logs a banner.  Never raises — the FastAPI app should still
    come up enough to serve /api/health so the canary can see the
    config-degraded signal.
    """
    global CONFIG_OK, CONFIG_FINDINGS
    findings: List[Dict[str, str]] = []

    for name, validator, hint in _CHECKS:
        val = os.environ.get(name)
        err = validator(val)
        if err:
            findings.append({"var": name, "error": err, "hint": hint})

    CONFIG_FINDINGS = findings
    CONFIG_OK = not findings

    if CONFIG_OK:
        logger.info("✓ env_check: all critical env vars present and well-formed")
        return True

    # Screaming-loud banner — operators tailing logs spot this instantly.
    bar = "=" * 72
    logger.error(bar)
    logger.error("🚨🚨🚨  CRITICAL ENV CONFIG MISSING / MALFORMED  🚨🚨🚨")
    logger.error("This usually means Emergent's MANAGE_SECRETS step failed.")
    logger.error("Most common cause: .gitignore re-added .env lines.")
    logger.error("See: scripts/check_gitignore_health.py")
    logger.error(bar)
    for f in findings:
        logger.error(f"  ✗ {f['var']}: {f['error']}  ({f['hint']})")
    logger.error(bar)
    return False
