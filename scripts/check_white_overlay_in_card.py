#!/usr/bin/env python3
"""``bg-white/N`` inside a panel / card lint for Shelfsort.

Background
----------

The standing dark-mode coverage lint
(``check_dark_mode_coverage.py``) intentionally skips
``bg-white/N`` (semi-transparent white) by default — those are
almost always overlays on dark gradients (hero banners, share
modals, button hover states) where flipping to a dark surface
would actually break the design.

But 2026-06-28 showed a real bug class the default lint can't
catch: ``bg-white/70`` used INSIDE a ``shelf-card`` panel renders
as light-gray-on-dark-gray in dark mode (the FailedUploadsList
case).  Inside a card / section element, ``bg-white/N`` is almost
always wrong in dark mode.

This sibling lint flags exactly that pattern.  Heuristic:

* Find every ``bg-white/N`` (any opacity) in the codebase.
* If the same JSX element ALSO has any of:
  ``shelf-card`` / ``rounded-xl`` / ``rounded-2xl`` / ``rounded-3xl``,
  AND does NOT also have ``bg-gradient-`` / ``from-`` / ``to-``
  (which would signal an intentional gradient surface), flag it.
* Honour ``// dark-ok`` on the same line as the established
  per-line opt-out.

Usage
-----

::

    python3 scripts/check_white_overlay_in_card.py

Exits 1 if any flagged usage remains.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

# The shape we're looking for is a `className="..."` (or
# `className={...}` or `className={`...`}`) whose value contains
# BOTH (a) a `bg-white/N` overlay AND (b) a card-shaped wrapper
# token, with NO gradient marker that would mean it's actually a
# coloured hero surface.
_BG_WHITE_N = re.compile(r"\bbg-white/\d+\b")
_CARD_TOKENS = re.compile(r"\b(shelf-card|rounded-xl|rounded-2xl|rounded-3xl)\b")
_GRADIENT_TOKENS = re.compile(r"\b(bg-gradient-|from-\[|to-\[|via-\[|from-[a-z]+-\d|to-[a-z]+-\d)")
_DARK_OK = re.compile(r"dark-ok\b")


def main() -> int:
    findings: list[tuple[Path, int, str]] = []  # (file, line, snippet)

    for path in SRC.rglob("*"):
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        for lineno, line in enumerate(text.splitlines(), start=1):
            if _DARK_OK.search(line):
                continue
            if not _BG_WHITE_N.search(line):
                continue
            # The line has bg-white/N.  Is it ALSO in a card-shaped
            # context?  Card tokens may appear on the same line (most
            # common) or up to 2 lines above (rare wrapped-className
            # case) — we look back 2 lines to keep false positives
            # in check.  Don't look forward (the wrapping ancestor
            # would be ABOVE the inner element, not below).
            context_lines = []
            start = max(0, lineno - 3)
            try:
                all_lines = text.splitlines()
                context_lines = all_lines[start:lineno]
            except Exception:  # noqa: BLE001
                context_lines = [line]
            context = "\n".join(context_lines)

            if not _CARD_TOKENS.search(context):
                continue
            if _GRADIENT_TOKENS.search(context):
                continue  # Hero / saturated surface — overlay is intentional.

            snippet = line.strip()
            if len(snippet) > 140:
                snippet = snippet[:137] + "…"
            findings.append((path, lineno, snippet))

    if not findings:
        print("✓ bg-white/N in-card lint: no card-bound white overlays found")
        return 0

    print(
        f"\n✗ bg-white/N in-card lint: {len(findings)} usage(s) of "
        f"`bg-white/N` inside a card/panel surface\n"
        f"  These render as light-gray-on-dark-gray in dark mode.  Replace\n"
        f"  with a hex bg (e.g. `bg-[#FBE7E4]`) that's mapped in index.css,\n"
        f"  OR append `// dark-ok` to the line if the bright look is intentional.\n"
    )
    for path, lineno, snippet in findings:
        print(f"  • {path.relative_to(ROOT)}:{lineno}")
        print(f"      {snippet}")
    print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
