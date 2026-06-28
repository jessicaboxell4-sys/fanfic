#!/usr/bin/env python3
"""Gitignore-health lint for Shelfsort.

Background
----------

Emergent's deploy pipeline reads ``/app/backend/.env`` and
``/app/frontend/.env`` as committed git files to propagate env
vars into the production pod.  If those files are gitignored,
they're not in the deploy commit; the secrets-management step
silently falls back to "fetch from source pod", the source pod
is ephemeral and has already been cleaned up, and the deploy
dies with::

    failed to get pod: pods "agent-env-..." not found

This exact regression bit us twice in 24 hours (2026-06-27 and
2026-06-28).  Each time, an IDE auto-complete / .gitignore
template merge silently re-added ``.env`` / ``.env.*`` / ``*.env``
to the bottom of ``.gitignore`` — right under the explicit
comment block that says those lines MUST NOT exist.

This lint kills that regression permanently.  Run it as part of
the standing "any bugs?" deep-dive and before every deploy.

Rules
-----

Fails if **any** of these patterns appears in ``.gitignore`` as
an active rule (not a comment):

* ``.env``
* ``.env.*``
* ``*.env``
* ``**/.env``
* ``backend/.env``
* ``frontend/.env``

Also checks the same patterns aren't present in ``.dockerignore``
— same failure mode would apply at the Docker build step
(``.env`` files excluded from the image context).

Optionally checks the files themselves exist and are non-empty
(an empty ``.env`` is functionally equivalent to a missing one
on most platforms).

Usage
-----

::

    python3 scripts/check_gitignore_health.py

Exits 1 if any check fails.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GITIGNORE = ROOT / ".gitignore"
DOCKERIGNORE = ROOT / ".dockerignore"
BACKEND_ENV = ROOT / "backend" / ".env"
FRONTEND_ENV = ROOT / "frontend" / ".env"

# Exact patterns that MUST NOT appear as active rules.  These are
# the same patterns Emergent's deployment_agent flags as a blocker.
FORBIDDEN_ENV_PATTERNS = {
    ".env",
    ".env.*",
    "*.env",
    "**/.env",
    "backend/.env",
    "frontend/.env",
    "/backend/.env",
    "/frontend/.env",
    "/.env",
    "**/*.env",
}


def _scan_ignorefile(path: Path) -> list[tuple[int, str]]:
    """Return a list of (line_number, pattern) for every forbidden
    pattern that appears as an active rule.  Comments and blank
    lines are skipped.

    Quoting / escaping rarely matters in .gitignore (it's not
    shell-quoted), but we strip whitespace and tolerate trailing
    ``/`` for directory patterns.
    """
    if not path.exists():
        return []
    hits: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # Tolerate "!negation" patterns — those EXEMPT files, the
        # opposite of what we're catching.  ``!.env`` would be fine.
        if stripped.startswith("!"):
            continue
        # Normalize trailing slash for directory patterns.
        candidate = stripped.rstrip("/")
        if candidate in FORBIDDEN_ENV_PATTERNS:
            hits.append((lineno, stripped))
    return hits


def main() -> int:
    failures: list[str] = []

    # 1. .gitignore must not block .env files.
    gi_hits = _scan_ignorefile(GITIGNORE)
    if gi_hits:
        failures.append(
            ".gitignore blocks Emergent-required env files:\n"
            + "\n".join(f"    line {ln}: {pat!r}" for ln, pat in gi_hits)
            + "\n  Remove these lines.  Emergent's deploy pipeline reads the\n"
            + "  committed backend/.env and frontend/.env files at deploy time;\n"
            + "  gitignoring them causes the MANAGE_SECRETS step to fall back to\n"
            + "  fetching from an ephemeral source pod, which is no longer alive,\n"
            + "  resulting in 'failed to get pod: pods \"agent-env-...\" not found'."
        )

    # 2. .dockerignore must not block them either (same root cause).
    di_hits = _scan_ignorefile(DOCKERIGNORE)
    if di_hits:
        failures.append(
            ".dockerignore blocks Emergent-required env files:\n"
            + "\n".join(f"    line {ln}: {pat!r}" for ln, pat in di_hits)
            + "\n  Remove these lines.  The Docker build context needs the\n"
            + "  .env files to bake env vars into the image."
        )

    # 3. The .env files themselves must exist and be non-empty.
    for env_file, label in [(BACKEND_ENV, "backend/.env"), (FRONTEND_ENV, "frontend/.env")]:
        if not env_file.exists():
            failures.append(
                f"{label} is missing.  Emergent's deploy pipeline expects this file\n"
                f"  to be committed (with real values for protected vars and\n"
                f"  placeholders for everything else)."
            )
        elif env_file.stat().st_size == 0:
            failures.append(
                f"{label} exists but is empty.  Add at minimum the protected env\n"
                f"  vars (MONGO_URL, DB_NAME for backend; REACT_APP_BACKEND_URL for\n"
                f"  frontend)."
            )

    if not failures:
        print("✓ gitignore health: env files are tracked and ignorable patterns are clean")
        return 0

    print(f"\n✗ gitignore health: {len(failures)} issue(s) found\n")
    for f in failures:
        print(f"  • {f}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
