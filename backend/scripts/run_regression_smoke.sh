#!/usr/bin/env bash
# Run the regression-smoke test band only (no LLM calls, no slow
# integration suites).  Use this after refactors to confirm the
# critical cross-cutting endpoints still respond.
#
# Usage:  ./scripts/run_regression_smoke.sh
# Exits non-zero if any smoke test fails.
#
# CI-aware (added 2026-06-25):
# If no backend is reachable on $BACKEND_URL, this script starts a
# fresh uvicorn in the background, waits for /api/health, then runs
# pytest.  Lets the same script work locally (uses supervisor's
# uvicorn) and on GitHub Actions (spawns its own).
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_URL="${BACKEND_URL:-http://localhost:8001}"
SPAWNED_SERVER_PID=""

cleanup() {
    if [ -n "${SPAWNED_SERVER_PID:-}" ]; then
        kill -INT "${SPAWNED_SERVER_PID}" 2>/dev/null || true
        wait "${SPAWNED_SERVER_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Probe for an existing backend (the dev container has one via supervisor).
if curl -sf --max-time 3 "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
    echo ">> Reusing existing backend at ${BACKEND_URL}"
else
    # No backend running — start one for the duration of the smoke band.
    # Required envs (CI uses the workflow-provided values; locally they
    # come from backend/.env via load_dotenv inside server.py).
    export MONGO_URL="${MONGO_URL:-mongodb://localhost:27017}"
    export DB_NAME="${DB_NAME:-shelfsort_ci}"
    export CORS_ORIGINS="${CORS_ORIGINS:-*}"
    export COOKIE_SECURE="${COOKIE_SECURE:-false}"
    export COOKIE_SAMESITE="${COOKIE_SAMESITE:-lax}"
    export FRONTEND_URL="${FRONTEND_URL:-${BACKEND_URL}}"

    echo ">> No backend at ${BACKEND_URL}, starting one..."
    mkdir -p test_reports/pytest
    python -m uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1 \
        > test_reports/pytest/smoke_server.log 2>&1 &
    SPAWNED_SERVER_PID=$!

    for i in {1..30}; do
        if curl -sf --max-time 2 "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
            echo ">> Backend ready after ${i}s (pid=${SPAWNED_SERVER_PID})"
            break
        fi
        sleep 1
        if [ "$i" -eq 30 ]; then
            echo "!! Backend did not start in 30s — log tail:"
            tail -n 40 test_reports/pytest/smoke_server.log || true
            exit 1
        fi
    done
fi

# Suppress urllib3/charset_normalizer version-mismatch noise in output.
python -m pytest -m regression_smoke -q --tb=short --no-header "$@"
