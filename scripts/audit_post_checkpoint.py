#!/usr/bin/env python3
"""Session-start audit — advisory drift report.

Runs the same source-vs-prod-bundle diff as ``deploy_drift_check.py``
but frames the output for a session-START context rather than a
deploy-BLOCKING context.  Emits ``session-start audit:`` prefixed
lines the human can grep for, and ALWAYS exits 0 (advisory-only —
the agent decides how to react).

Rationale (2026-08-03): a checkpoint mishap silently lost ~10 days of
prod features in the fork's source tree.  We caught it only after the
new agent ran the deploy drift check at handoff time — but the
regression sat undetected for hours.  This script is meant to run as
the FIRST thing at every fresh session start so the agent sees
"session-start audit: N testids missing" in the first three tool
calls of the session and can decide whether to trigger a rollback
instead of stacking edits on top of a broken tree.

Usage:

    # Normal — advisory-only, exit 0 always.
    python3 scripts/audit_post_checkpoint.py

    # Silent unless drift is present (for automation).
    python3 scripts/audit_post_checkpoint.py --quiet

Not intended to REPLACE ``deploy_drift_check.py`` — that script's
--strict mode is still what gates the deploy pipeline.  This wrapper
is purely for session-start visibility.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIFT_SCRIPT = REPO_ROOT / "scripts" / "deploy_drift_check.py"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print output when drift is detected (for cron / CI).",
    )
    args = parser.parse_args()

    if not DRIFT_SCRIPT.exists():
        print(
            "session-start audit: SKIPPED — deploy_drift_check.py not found. "
            "Advisory audit cannot run; deploy sentinel will still catch drift at deploy time.",
            file=sys.stderr,
        )
        return 0

    # Delegate the actual work to the deploy drift check — same script,
    # different framing.  --strict makes it return exit code 1 on drift
    # so we know when to print the "missing" summary; we swallow the
    # exit code and always return 0 (advisory).
    try:
        result = subprocess.run(
            ["python3", str(DRIFT_SCRIPT), "--strict"],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        print(
            "session-start audit: TIMEOUT — drift check took >60 s. "
            "Skipping. Re-run manually with `python3 scripts/deploy_drift_check.py`.",
            file=sys.stderr,
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        print(
            f"session-start audit: ERROR — {exc}. Advisory only, session may continue.",
            file=sys.stderr,
        )
        return 0

    # Parse the drift-check output for the summary line.
    summary_line = ""
    missing_count = 0
    for line in result.stdout.splitlines():
        if "prod-only (drift):" in line:
            summary_line = line.strip()
            # Extract the count — the format is "prod-only (drift):   NNN"
            try:
                missing_count = int(summary_line.split(":")[-1].strip())
            except ValueError:
                missing_count = 0
            break

    if missing_count == 0:
        if not args.quiet:
            print(
                "session-start audit: 0 testids missing. "
                "Source is in sync with the live prod bundle — safe to make edits."
            )
        return 0

    # Drift present — emit the loud, agent-visible summary.
    print("")
    print("=" * 72)
    print(
        f"session-start audit: {missing_count} testids missing from source (vs prod bundle)."
    )
    print("=" * 72)
    print("")
    print(
        "  The fork's source tree is BEHIND what production is currently serving. "
        "This usually means a checkpoint mishap or an accidental "
        "`git checkout HEAD -- <file>` that dropped in-session edits."
    )
    print("")
    print("  RECOMMENDED: try Emergent Rollback to a checkpoint AFTER the last")
    print("  successful production deploy before making any new edits — a")
    print("  successful rollback restores all missing features in one click.")
    print("")
    print("  If rollback isn't available, rebuild from /app/memory/CHANGELOG.md.")
    print("")
    print("  For the full list of missing testids, run:")
    print("      python3 /app/scripts/deploy_drift_check.py")
    print("")
    print("=" * 72)
    print("")

    # Advisory-only — always exit 0.
    return 0


if __name__ == "__main__":
    sys.exit(main())
