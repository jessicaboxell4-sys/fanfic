#!/usr/bin/env python3
"""Gitignore-health lint for Shelfsort.

Background
----------

Emergent's deploy pipeline propagates env vars to the production
pod from a combination of: (a) the platform-managed secrets store
and (b) any ``backend/.env`` / ``frontend/.env`` files present in
the deploy commit.  If ``.gitignore`` blocks those files, the
secrets-management step silently falls back to "fetch from source
pod", the source pod is ephemeral and has already been cleaned up,
and the deploy dies with::

    failed to get pod: pods "agent-env-..." not found

This exact regression bit us three times in 48 hours (2026-06-27,
2026-06-28 AM, 2026-06-28 PM).  Each time, an IDE auto-complete /
.gitignore template merge silently re-added ``.env`` / ``.env.*``
/ ``*.env`` to the bottom of ``.gitignore`` — right under the
explicit comment block that says those lines MUST NOT exist.

This lint kills that regression permanently.  Run it as part of
the standing "any bugs?" deep-dive and before every deploy.

Rules
-----

Fails if **any** of these patterns appears as an active rule
(not a comment) in ``.gitignore`` or ``.dockerignore``:

* ``.env``
* ``.env.*``
* ``*.env``
* ``**/.env``
* ``backend/.env``
* ``frontend/.env``

We deliberately do NOT check whether the ``.env`` files exist on
disk.  Whether the files end up in the deploy commit is Emergent's
business (the auto-commit happens server-side after each session
and isn't visible during CI runs on a freshly-checked-out clone).
The "env vars actually missing at runtime" case is caught much
more loudly by ``backend/utils/env_check.py`` on app boot — that's
the right place for that signal, not a static repo lint.

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
            + "\n  Remove these lines.  Emergent's deploy pipeline needs the\n"
            + "  backend/.env and frontend/.env paths to be ignorable-free so\n"
            + "  the MANAGE_SECRETS step can include them in the deploy commit;\n"
            + "  gitignoring them causes the step to fall back to fetching from\n"
            + "  an ephemeral source pod, which is no longer alive, resulting\n"
            + "  in 'failed to get pod: pods \"agent-env-...\" not found'."
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

    if not failures:
        print("✓ gitignore health: no forbidden env-blocking patterns in .gitignore / .dockerignore")
        return 0

    print(f"\n✗ gitignore health: {len(failures)} issue(s) found\n")
    for f in failures:
        print(f"  • {f}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
