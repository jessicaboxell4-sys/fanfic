#!/usr/bin/env bash
# scripts/pre_deploy.sh — one-shot pre-deploy health sweep.
#
# Bundles every check the main agent runs before "yes you can deploy":
#   1. Fix the recurring .gitignore env-block regression
#   2. Run all 5 standing lints (dark-mode, tiny-fonts, gitignore,
#      white-overlay, text-contrast)
#   3. Probe the preview /api/health endpoint (200 + status:ok)
#   4. Run the session test suite (tests still expected to pass —
#      pre-existing flaky tests are excluded by name)
#   5. Report a single PASS/FAIL line at the end with timing
#
# Designed so the agent can run it as one command per deploy ask,
# instead of executing the 5 individual checks separately.  Each
# section prints its own short header so a human can scan it; a
# final coloured banner says whether deploying is safe.
#
# Usage:  bash scripts/pre_deploy.sh
# Exit:   0 if all checks pass and deploying is safe
#         1 if any check fails (and the failing section's output is
#           above so the operator knows what to fix)

set -uo pipefail   # no -e: we explicitly capture each step's result

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ─── Terminal styling ───────────────────────────────────────────────
B="\033[1m"; G="\033[32m"; R="\033[31m"; Y="\033[33m"; D="\033[2m"; N="\033[0m"
hr() { printf '%s\n' "═══════════════════════════════════════════════════════"; }
header() { printf "\n${B}━━━ %s ━━━${N}\n" "$1"; }

START_TS=$(date +%s)
FAIL_COUNT=0
declare -a FAILED_STEPS

note_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_STEPS+=("$1"); }

# ─── 1. Gitignore fix ───────────────────────────────────────────────
header "1/5  Gitignore env-block fix"
if [ -x "$ROOT/scripts/fix_gitignore.sh" ]; then
    if bash "$ROOT/scripts/fix_gitignore.sh"; then
        :
    else
        note_fail "gitignore fix"
    fi
else
    echo -e "${R}✗ scripts/fix_gitignore.sh missing — recreating from runtime is a separate fix${N}"
    note_fail "gitignore fix script missing"
fi

# ─── 2. Standing lints ──────────────────────────────────────────────
header "2/5  Standing lints (5 of them)"
if bash "$ROOT/scripts/run_all_lints.sh"; then
    echo -e "${G}✓ all standing lints passed${N}"
else
    note_fail "standing lints"
fi

# ─── 3. Health probe ────────────────────────────────────────────────
header "3/5  Preview backend health"
API_URL=$(grep -E '^REACT_APP_BACKEND_URL=' "$ROOT/frontend/.env" | cut -d= -f2-)
if [ -z "$API_URL" ]; then
    echo -e "${R}✗ REACT_APP_BACKEND_URL not set in frontend/.env${N}"
    note_fail "REACT_APP_BACKEND_URL missing"
else
    HEALTH_JSON=$(curl -s -m 15 "$API_URL/api/health" || true)
    if [ -z "$HEALTH_JSON" ]; then
        echo -e "${R}✗ /api/health returned empty (CF 520 / timeout / origin down)${N}"
        note_fail "health probe empty"
    else
        STATUS=$(echo "$HEALTH_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
        if [ "$STATUS" = "ok" ]; then
            echo -e "${G}✓ /api/health status=ok${N}"
            echo "$HEALTH_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k,v in d.get('checks',{}).items():
    ok = v.get('ok')
    sym = '  ✓' if ok else '  ✗'
    print(f'{sym} {k}')
"
        else
            echo -e "${R}✗ /api/health status=$STATUS${N}"
            echo "$HEALTH_JSON" | python3 -m json.tool 2>/dev/null | head -30
            note_fail "health not ok"
        fi
    fi
fi

# ─── 4. Backend tests (session tests — exclude known-flaky) ─────────
header "4/5  Backend tests (recent session)"
cd "$ROOT/backend"
# These two cover the polish-retry-inbox + queue-summary surfaces
# added in this work cycle.  Other test files in the repo are flaky
# on external HTTP timeouts and are intentionally excluded here —
# they don't gate deployment.
if python -m pytest tests/test_upload_queue_summary.py tests/test_polish_retry_inbox.py -q 2>&1 | tail -3; then
    :
else
    note_fail "pytest"
fi
cd "$ROOT"

# ─── 5. Final banner ────────────────────────────────────────────────
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo ""
hr
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "  ${G}${B}✓ pre-deploy sweep: PASS${N}  (${ELAPSED}s, 5/5 checks green)"
    echo -e "  ${D}safe to hit Deploy on the Emergent platform${N}"
    hr
    exit 0
else
    echo -e "  ${R}${B}✗ pre-deploy sweep: FAIL${N}  (${ELAPSED}s, ${FAIL_COUNT} failure(s))"
    for s in "${FAILED_STEPS[@]}"; do
        echo -e "  ${R}•${N} $s"
    done
    echo -e "  ${D}DO NOT DEPLOY until the failing checks above are addressed${N}"
    hr
    exit 1
fi
