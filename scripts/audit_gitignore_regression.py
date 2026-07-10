#!/usr/bin/env python3
"""Forensic audit for the recurring .gitignore env-block regression.

Background
----------

The pattern ``.env`` / ``.env.*`` / ``*.env`` has now been
re-added to ``/app/.gitignore`` four times in three days, after
being explicitly removed each time (the lines re-appear right
under the comment block that says they MUST NOT exist).  This
silently breaks Emergent's MANAGE_SECRETS step and produces a
Cloudflare 520 outage on every shelfsort.com endpoint until the
gitignore is fixed and the app is redeployed.

We don't know yet which actor is doing the re-add:

* An IDE auto-complete / .gitignore template merge
* Emergent's auto-commit pipeline picking up a template
* An agent run reverting to a cached `.gitignore` snapshot
* Some yarn / docker / build tool generating a `.gitignore`
* A pre-commit / post-commit hook outside our visibility

What this script does
---------------------

When the pre-commit hook detects the regression (via
``check_gitignore_health.py``), this script runs FIRST and
appends a single forensic record to::

    /app/memory/gitignore_regression_audit.log

Each record captures everything we'd want to know "after the
fact" once it happens once more:

* Wall-clock UTC timestamp
* Git author identity for the in-flight commit
* ``git status -sb`` (what else is staged with it)
* ``git log -10 .gitignore`` (recent history of that file)
* ``git diff --cached .gitignore`` (exactly what THIS commit
  would add — should include the bad lines)
* Process tree from the hook's PID up to PID 1
* A curated subset of env vars (USER, EDITOR, CI, GITHUB_*,
  EMERGENT_*, npm_*, yarn_*, _, OLDPWD, SHELL, TERM)
* Whether ``.git/COMMIT_EDITMSG`` or ``.git/MERGE_MSG`` exist
  (hint: is this an interactive commit or a tool-driven one?)

Capture is best-effort.  Every subprocess call is wrapped in a
``try`` so a slow / missing tool can't break the hook.  Output
appends — never truncates — so the log grows linearly over
incidents.

Usage
-----

Called from ``.git/hooks/pre-commit`` BEFORE the lint gate.  Safe
to run manually too::

    python3 scripts/audit_gitignore_regression.py
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
GITIGNORE = ROOT / ".gitignore"
AUDIT_LOG = ROOT / "memory" / "gitignore_regression_audit.log"

# Same forbidden-pattern set as check_gitignore_health.py — kept
# in sync intentionally; not imported to keep this script
# zero-dependency from the rest of the lint module.
FORBIDDEN = {
    ".env", ".env.*", "*.env", "**/.env", "backend/.env",
    "frontend/.env", "/backend/.env", "/frontend/.env",
    "/.env", "**/*.env",
}

# Env-var keys we care about for forensics.  Hard-coded so we
# never leak `MONGO_URL`-style secrets into the audit log.
SAFE_ENV_KEYS = (
    "USER", "EDITOR", "VISUAL", "SHELL", "TERM",
    "CI", "GITHUB_ACTIONS", "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID", "GITHUB_WORKFLOW", "GITHUB_EVENT_NAME",
    "EMERGENT", "EMERGENT_RUN_ID", "EMERGENT_AGENT",
    "EMERGENT_AUTO_COMMIT", "EMERGENT_DEPLOY",
    "PRE_COMMIT", "PRE_COMMIT_HOME", "HUSKY",
    "npm_lifecycle_event", "npm_package_name",
    "yarn_lifecycle_event", "_", "OLDPWD", "PWD", "HOME",
)


def _scan_for_forbidden() -> list[tuple[int, str]]:
    """Return [(lineno, raw_line), ...] for any active forbidden
    pattern currently in ``.gitignore``.  Returns [] if clean."""
    if not GITIGNORE.exists():
        return []
    hits: list[tuple[int, str]] = []
    try:
        text = GITIGNORE.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("!"):
            continue
        if stripped.rstrip("/") in FORBIDDEN:
            hits.append((lineno, raw))
    return hits


def _safe_run(cmd: list[str], timeout: int = 5) -> str:
    """Run ``cmd`` and return stdout (decoded, stripped, truncated
    at 4 KB).  Returns ``"<failed: ...>"`` on any error so the
    audit record stays a single contiguous block."""
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(ROOT),
            check=False,
        )
        out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        return out.strip()[:4096]
    except Exception as e:  # noqa: BLE001
        return f"<failed: {type(e).__name__}: {e}>"


def _process_tree(pid: int) -> str:
    """Walk parents up to PID 1.  Each line is one ancestor.
    Uses ``ps`` because /proc/<pid>/status isn't always readable
    in restricted CI containers."""
    lines: list[str] = []
    seen: set[int] = set()
    current = pid
    while current and current not in seen and len(lines) < 30:
        seen.add(current)
        info = _safe_run(["ps", "-o", "pid=,ppid=,comm=,args=", "-p", str(current)], timeout=2)
        if not info or info.startswith("<failed"):
            lines.append(f"  pid={current} <unreadable>")
            break
        lines.append("  " + info.replace("\n", " | ").strip())
        # Pull ppid via a separate, robust query (the comm/args may
        # contain whitespace that breaks our naive split).
        ppid_raw = _safe_run(["ps", "-o", "ppid=", "-p", str(current)], timeout=2)
        try:
            current = int(ppid_raw.strip().splitlines()[0])
        except (ValueError, IndexError):
            break
        if current <= 1:
            if current == 1:
                lines.append("  pid=1 (init)")
            break
    return "\n".join(lines) if lines else "  <empty>"


def _safe_env(keys: Iterable[str]) -> str:
    """Render only the curated env keys.  Wildcards (``GITHUB_``,
    ``EMERGENT``, ``npm_``, ``yarn_``) match prefix."""
    parts: list[str] = []
    seen_keys: set[str] = set()
    for raw_key in keys:
        if raw_key.endswith("_") or raw_key in ("GITHUB_ACTIONS", "EMERGENT", "PRE_COMMIT", "HUSKY"):
            # Treat as prefix
            prefix = raw_key
            for k, v in sorted(os.environ.items()):
                if k.startswith(prefix) and k not in seen_keys:
                    seen_keys.add(k)
                    parts.append(f"  {k}={v!r}")
        else:
            if raw_key in os.environ and raw_key not in seen_keys:
                seen_keys.add(raw_key)
                parts.append(f"  {raw_key}={os.environ[raw_key]!r}")
    return "\n".join(parts) if parts else "  <none of the watched keys set>"


def main() -> int:
    hits = _scan_for_forbidden()
    if not hits:
        # Nothing to audit — silent success.  This is the common
        # case; we don't want pre-commit noise on clean commits.
        return 0

    AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    bar = "═" * 78

    # Strip any patterns that look secret-y from the recorded
    # diff (paranoia — `git diff --cached .gitignore` shouldn't
    # contain real values, but better safe).
    cached_diff = _safe_run(["git", "diff", "--cached", "--", str(GITIGNORE)])
    cached_diff = re.sub(r"=[^\s\n]+", "=<redacted>", cached_diff)

    record = f"""\
{bar}
GITIGNORE REGRESSION DETECTED — {now}
{bar}

Hit lines (active rules matching forbidden set):
{chr(10).join(f"  line {ln}: {raw!r}" for ln, raw in hits)}

git author/committer identity:
  AUTHOR    = {_safe_run(["git", "var", "GIT_AUTHOR_IDENT"])}
  COMMITTER = {_safe_run(["git", "var", "GIT_COMMITTER_IDENT"])}

git status -sb:
{_safe_run(["git", "status", "-sb"])}

git log -10 -- .gitignore:
{_safe_run(["git", "log", "-10", "--pretty=%h %ai %an %s", "--", str(GITIGNORE)])}

git diff --cached -- .gitignore (what THIS commit would add):
{cached_diff or "  <empty — file may have been edited outside the index>"}

Process tree from this hook ({os.getpid()}) up to init:
{_process_tree(os.getpid())}

Interactive-commit hints:
  .git/COMMIT_EDITMSG exists: {(ROOT / '.git' / 'COMMIT_EDITMSG').exists()}
  .git/MERGE_MSG exists:      {(ROOT / '.git' / 'MERGE_MSG').exists()}
  stdin is a TTY:             {sys.stdin.isatty()}

Curated env vars:
{_safe_env(SAFE_ENV_KEYS)}

{bar}

"""
    try:
        with AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(record)
    except OSError as e:
        # Audit failure must never block — print to stderr and move on.
        print(f"[gitignore-audit] could not write audit log: {e}", file=sys.stderr)

    # Visible signal to the operator running the commit interactively.
    # The lint that follows in the same hook will produce the actual
    # "commit aborted" error, so we just leave breadcrumbs here.
    print(
        f"[gitignore-audit] detected regression — forensic record appended to "
        f"{AUDIT_LOG.relative_to(ROOT)}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
