#!/usr/bin/env python3
"""env-in-gitignore sentinel — NEUTRALIZED 2026-08-27.

Background (corrected by Emergent Support 2026-08-27)
-----------------------------------------------------
For months this sentinel was hard-failing deploys whenever
``.env`` / ``.env.*`` / ``backend/.env`` etc. appeared in
``/app/.gitignore``.  We believed the platform-side tool was
"corrupting" the file.

Emergent Support (Akhil) has now clarified — with a direct email
from the platform team — that the ``.env`` entries in ``.gitignore``
are **intentional and safe**:

    "Save to Github intentionally writes .env patterns to .gitignore
     to prevent secrets from leaking into your public repository.
     Backend deploys read secrets from the runtime env, not the
     tracked file, so the ignore rules do not break anything."

In other words, the original sentinel was solving a non-problem
and, in the process, hard-failing every deploy the moment the
platform did the correct thing.  The **actual** cause of the
"Save to Github" failures was a completely separate stack of
local pre-commit lints (dark-mode coverage, text-contrast) that
were flagging real UI accessibility bugs.

This file is preserved (rather than deleted) because:

* ``deploy_drift_check.py`` imports and invokes it.
* ``backend/tests/test_env_gitignore_sentinel.py`` runs it as a
  smoke test.
* Removing the file would ripple into both callers with no upside.

Instead, the sentinel now always returns 0 with an informational
message.  It no longer inspects ``.gitignore``.

If you ever need to legitimately guard against a NEW bad pattern
in ``.gitignore`` (e.g. someone accidentally ignores ``/backend``
wholesale), write a new, specifically-scoped check rather than
reviving the ``.env`` false-positive.
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "✅ env-in-gitignore sentinel: neutralized "
        "(see docstring — .env in .gitignore is intentional per Emergent Support)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
