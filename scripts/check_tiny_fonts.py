#!/usr/bin/env python3
"""Tiny-font accessibility lint for Shelfsort.

Sibling of ``check_dark_mode_coverage.py``.  Flags font-size
utility classes that fall below the WCAG-comfort threshold for
body text.  Specifically:

* ``text-[8px]`` and ``text-[9px]`` — always too small for any
  text on any surface.  These are the worst readability offenders
  and the easiest to spot statically.
* ``text-[7px]`` and below — same reasoning, future-proofed.

Why not flag ``text-xs`` (12px) too?  Because the codebase uses
``text-xs`` extensively (1000+ usages) for legitimate badges,
chips, meta info, footers, and helper hints where 12px is fine
and ``text-sm`` would look outsized.  Flagging it would generate
unactionable noise.  The standing rule (documented in
``/app/memory/CONVENTIONS.md``) is: use ``text-sm`` minimum for
genuine body / paragraph text, ``text-xs`` only for chips and
meta.  When you spot a ``text-xs`` paragraph in review, refactor
it manually — the lint can't reliably distinguish a 50-char chip
from a 50-char body line without a real DOM parse.

Usage
-----
::

    python3 scripts/check_tiny_fonts.py

Exits 1 if any sub-10px font class is uncovered.

Escape hatch
------------
Append ``// fontsize-ok`` to the same JSX line if you genuinely
need the tiny font (timestamp footers, copyright lines on a
print stylesheet, etc.).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

# Match any explicit pixel font size 1-9 (single digit).  ``text-[10px]``
# and up are 10px+ which is the line we draw for this lint.
_TINY_FONT = re.compile(r"text-\[([1-9])px\]")
_OK_MARKER = re.compile(r"fontsize-ok\b")
# Auto-exempt the "uppercase + letter-spacing" badge pattern.  9px
# text with ``uppercase tracking-wider`` (or ``tracking-wide``) reads
# as well as un-tracked 11px — it's the standard convention for
# tiny status pills, role badges, notification count bubbles, etc.
# Flagging them would generate noise without catching real bugs.
_BADGE_PATTERN = re.compile(r"uppercase.*tracking-w(?:ider|ide)|tracking-w(?:ider|ide).*uppercase")


def main() -> int:
    findings: list[tuple[Path, int, str, str]] = []  # (file, line, class, snippet)

    for path in SRC.rglob("*"):
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        for lineno, line in enumerate(text.splitlines(), start=1):
            if _OK_MARKER.search(line):
                continue
            # Auto-exempt the uppercase+tracking-wider badge pattern.
            if _BADGE_PATTERN.search(line):
                continue
            for m in _TINY_FONT.finditer(line):
                px = m.group(1)
                cls = f"text-[{px}px]"
                snippet = line.strip()
                if len(snippet) > 120:
                    snippet = snippet[:117] + "…"
                findings.append((path, lineno, cls, snippet))

    if not findings:
        print("✓ tiny-font lint: no sub-10px text classes found")
        return 0

    by_class: dict[str, list[tuple[Path, int, str]]] = {}
    for path, lineno, cls, snippet in findings:
        by_class.setdefault(cls, []).append((path, lineno, snippet))

    print(
        f"\n✗ tiny-font lint: {len(findings)} sub-10px text class(es) "
        f"found ({len(by_class)} distinct size)\n"
        f"  WCAG comfort threshold is 12px (text-xs) for chips and "
        f"14px (text-sm) for body text.\n"
        f"  Fix by bumping to text-[10px] minimum (or text-xs / "
        f"text-sm), OR append `// fontsize-ok` if the tiny size is\n"
        f"  genuinely needed (print stylesheets, sub-script footers, "
        f"etc.).\n"
    )
    for cls in sorted(by_class.keys()):
        rows = by_class[cls]
        print(f"  • {cls}  ({len(rows)} usage{'s' if len(rows) != 1 else ''})")
        for path, lineno, snippet in rows:
            print(f"      {path.relative_to(ROOT)}:{lineno}")
            print(f"          {snippet}")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
