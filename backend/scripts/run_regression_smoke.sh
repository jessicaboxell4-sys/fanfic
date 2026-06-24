#!/usr/bin/env bash
# Run the regression-smoke test band only (no LLM calls, no slow
# integration suites).  Use this after refactors to confirm the
# critical cross-cutting endpoints still respond.
#
# Usage:  ./scripts/run_regression_smoke.sh
# Exits non-zero if any smoke test fails.
set -euo pipefail
cd "$(dirname "$0")/.."

# Suppress urllib3/charset_normalizer version-mismatch noise in output.
exec python -m pytest -m regression_smoke -q --tb=short --no-header "$@"
