#!/usr/bin/env bash
# scripts/fix_gitignore.sh — idempotent one-shot fixer for the recurring
# .gitignore env-block regression that breaks Emergent's deploy.
#
# Background: Emergent's auto-commit step periodically re-adds
# `.env`, `.env.*`, `*.env` to `.gitignore`.  When present at deploy
# time, MANAGE_SECRETS can't propagate runtime env vars and the prod
# pod boots without MONGO_URL — Cloudflare returns 520 on every
# endpoint until someone notices.  Recurrence count: 7+ in 4 days.
#
# Usage:   bash scripts/fix_gitignore.sh
# Exit:    0 always when finished cleanly; 1 only if the verifying
#          lint still fails after stripping.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITIGNORE="$ROOT/.gitignore"

if [ ! -f "$GITIGNORE" ]; then
    echo "✗ $GITIGNORE missing — nothing to fix."
    exit 1
fi

before_hits=$(grep -cE '^[[:space:]]*(\.env|\.env\.\*|\*\.env)[[:space:]]*$' "$GITIGNORE" || true)

if [ "$before_hits" -eq 0 ]; then
    echo "✓ .gitignore already clean — no env-blocking lines present."
else
    TMP="$(mktemp)"
    awk '
        {
            s = $0
            sub(/[[:space:]]+$/, "", s)
            if (s == ".env" || s == ".env.*" || s == "*.env") next
            print
        }
    ' "$GITIGNORE" > "$TMP"
    mv "$TMP" "$GITIGNORE"
    echo "✓ Removed $before_hits env-blocking line(s) from .gitignore."
fi

echo ""
echo "Verifying via scripts/check_gitignore_health.py ..."
if python3 "$ROOT/scripts/check_gitignore_health.py"; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  ✓ .gitignore is deploy-safe.  Ready to redeploy."
    echo "═══════════════════════════════════════════════════════════"
    exit 0
else
    echo "  ✗ Lint STILL fails — investigate manually."
    exit 1
fi
