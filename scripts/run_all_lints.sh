#!/usr/bin/env bash
# run_all_lints.sh — single entry point for every standing
# Shelfsort lint.  Run before any commit or deploy.
#
# Scoped to the three Shelfsort-specific guardrails that have
# been added during 2026-06-27 / 2026-06-28 firefighting:
#
#   1. Dark-mode coverage — light `bg-[#XXXXXX]` must have a
#      matching `:root[data-theme="dark"]` rule in index.css.
#   2. Tiny-font accessibility — `text-[Npx]` where N ≤ 9 is
#      flagged unless it's the uppercase-tracking-wider badge
#      pattern or has a `// fontsize-ok` opt-out.
#   3. Gitignore health — `.gitignore` / `.dockerignore` must
#      not block `.env` files; the `.env` files must exist.
#
# DOES NOT cover ruff (backend Python) or eslint (frontend JS) —
# those have a baseline of pre-existing issues across the
# codebase that would make this wrapper unusable.  Use the
# MCP lint tools (`mcp_lint_python`, `mcp_lint_javascript`) for
# those — they're path-scoped and noise-suppressed already.
#
# Exit codes:
#   0 — every Shelfsort-specific lint passed
#   1 — at least one failed (specific message above the summary)
#
# Usage:
#   ./scripts/run_all_lints.sh
#   ./scripts/run_all_lints.sh --strict     # also flag bg-white/N overlays
#   ./scripts/run_all_lints.sh --quiet      # only print failures + summary

set -uo pipefail   # no `-e` — we want to RUN every lint, not short-circuit.

cd "$(dirname "$0")/.."

STRICT=0
QUIET=0
for arg in "$@"; do
    case "$arg" in
        --strict) STRICT=1 ;;
        --quiet)  QUIET=1  ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac
done

step() {
    [[ $QUIET -eq 0 ]] && printf '\n──── %s ────\n' "$1"
}

# Track failures so we exit with the right code at the end.
FAILED=()

run() {
    local label="$1"; shift
    step "$label"
    if "$@"; then
        [[ $QUIET -eq 0 ]] && echo "✓ $label passed"
    else
        echo "✗ $label FAILED"
        FAILED+=("$label")
    fi
}

# ---------------------------------------------------------------- #
# 1. Dark-mode coverage (2026-06-28).
# ---------------------------------------------------------------- #
if [[ $STRICT -eq 1 ]]; then
    run "dark-mode coverage (strict)" \
        python3 scripts/check_dark_mode_coverage.py --include-white-opacity
else
    run "dark-mode coverage" \
        python3 scripts/check_dark_mode_coverage.py
fi

# ---------------------------------------------------------------- #
# 2. Tiny-font accessibility (2026-06-28).
# ---------------------------------------------------------------- #
run "tiny-font accessibility" \
    python3 scripts/check_tiny_fonts.py

# ---------------------------------------------------------------- #
# 3. Gitignore health (2026-06-28).
# ---------------------------------------------------------------- #
run "gitignore health" \
    python3 scripts/check_gitignore_health.py

# ---------------------------------------------------------------- #
# 4. bg-white/N inside card (2026-06-28).  Catches the FailedUploadsList
#    class of bug — `bg-white/N` inside a `shelf-card` / `rounded-xl`
#    panel renders as light-gray-on-dark-gray in dark mode.
# ---------------------------------------------------------------- #
run "bg-white/N in-card" \
    python3 scripts/check_white_overlay_in_card.py

# ---------------------------------------------------------------- #
# 5. Text-contrast (2026-06-29).  Catches new `text-[#XXXXXX]`
#    arbitrary values that drop below WCAG AA body contrast
#    (4.5:1 on the paper bg).  Recognises an approved palette and
#    a frozen grandfather list — see scripts/check_text_contrast.py.
# ---------------------------------------------------------------- #
run "text-contrast" \
    python3 scripts/check_text_contrast.py

# ---------------------------------------------------------------- #
# Summary
# ---------------------------------------------------------------- #
echo
if [[ ${#FAILED[@]} -eq 0 ]]; then
    echo "═══════════════════════════════════════════════════════"
    echo "  ✓ all Shelfsort lints green — safe to commit / deploy"
    echo "═══════════════════════════════════════════════════════"
    exit 0
else
    echo "═══════════════════════════════════════════════════════"
    echo "  ✗ ${#FAILED[@]} lint(s) failed:"
    for f in "${FAILED[@]}"; do
        echo "    • $f"
    done
    echo "═══════════════════════════════════════════════════════"
    exit 1
fi
