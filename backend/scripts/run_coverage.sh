#!/usr/bin/env bash
# Run the integration test suite with TRUE coverage by starting uvicorn
# under `coverage run` so it actually records executed lines while pytest
# hits it over HTTP.
#
# Usage:  ./scripts/run_coverage.sh [--fail-under=70]
#
# Requires: MongoDB reachable at $MONGO_URL (default: mongodb://localhost:27017).

set -euo pipefail
cd "$(dirname "$0")/.."

FAIL_UNDER=${1:-70}
FAIL_UNDER=${FAIL_UNDER#--fail-under=}

PORT=${BACKEND_TEST_PORT:-8765}
HOST=127.0.0.1

# Make REACT_APP_BACKEND_URL point at our coverage-instrumented server.
export MONGO_URL=${MONGO_URL:-mongodb://localhost:27017}
export DB_NAME=${DB_NAME:-shelfsort_cov}
export EMERGENT_LLM_KEY=${EMERGENT_LLM_KEY:-}
export RESEND_API_KEY=${RESEND_API_KEY:-}
export SENDER_EMAIL=${SENDER_EMAIL:-onboarding@resend.dev}
export FRONTEND_URL=${FRONTEND_URL:-http://${HOST}:${PORT}}
export REACT_APP_BACKEND_URL="http://${HOST}:${PORT}"
export CORS_ORIGINS=${CORS_ORIGINS:-*}
export COOKIE_SECURE=${COOKIE_SECURE:-false}
export COOKIE_SAMESITE=${COOKIE_SAMESITE:-lax}
# Point the server's FicHub client at a local mock that the test process spins up.
export FICHUB_BASE_URL=${FICHUB_BASE_URL:-http://127.0.0.1:8766}
# Bypass Claude with canned response so classify_with_ai exercises full path
export EMERGENT_LLM_KEY=${EMERGENT_LLM_KEY:-test-classifier-key}
export SHELFSORT_TEST_AI_RESPONSE=${SHELFSORT_TEST_AI_RESPONSE:-'{"category":"Fanfiction","fandom":"Harry Potter","confidence":0.85,"tags":["fluff","wip","au"]}'}
export COVERAGE_PROCESS_START="$PWD/.coveragerc"

# Clean previous coverage data
coverage erase || true
rm -rf .coverage .coverage.* test_reports/pytest/coverage.xml 2>/dev/null || true
mkdir -p test_reports/pytest

# Start uvicorn under coverage in the background
echo ">> Starting instrumented uvicorn on ${HOST}:${PORT}..."
coverage run --rcfile=.coveragerc -m uvicorn server:app \
    --host "${HOST}" --port "${PORT}" --workers 1 \
    > test_reports/pytest/server.log 2>&1 &
SERVER_PID=$!
trap "kill -INT ${SERVER_PID} 2>/dev/null || true; wait ${SERVER_PID} 2>/dev/null || true" EXIT

# Wait for server to be ready
for i in {1..30}; do
    if curl -sf "http://${HOST}:${PORT}/api/" >/dev/null 2>&1; then
        echo ">> Server ready after ${i}s"
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo "!! Server did not start in 30s"
        cat test_reports/pytest/server.log
        exit 1
    fi
done

# Run tests — they hit the running server, which is recording coverage
echo ">> Running pytest..."
set +e
python -m pytest tests/ -v --tb=short
PYTEST_RC=$?
set -e

# Gracefully stop server so coverage finalizes
echo ">> Stopping server..."
kill -INT "${SERVER_PID}" 2>/dev/null || true
wait "${SERVER_PID}" 2>/dev/null || true
trap - EXIT

# Combine and report
coverage combine || true
coverage report --rcfile=.coveragerc --skip-covered --fail-under="${FAIL_UNDER}"
COV_RC=$?

coverage xml --rcfile=.coveragerc -o test_reports/pytest/coverage.xml || true

if [ "${PYTEST_RC}" -ne 0 ]; then
    echo "!! Pytest exited ${PYTEST_RC}"
    exit "${PYTEST_RC}"
fi
exit "${COV_RC}"
