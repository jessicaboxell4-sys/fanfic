#!/usr/bin/env python3
"""Dark-mode coverage lint for Shelfsort.

Shelfsort flips to dark mode by retargeting the *exact* compiled
Tailwind utility classes the codebase already uses (``bg-[#FBFAF6]``
etc.) via attribute selectors in ``frontend/src/index.css``.  When
someone adds a new light-cream background hex without also adding a
``:root[data-theme="dark"] .bg-\[\#XXXXXX\] { ... }`` rule, the page
shows a giant white slab in dark mode — exactly the kind of bug
the user spotted with the admin "Jump to section" dropdown
(``bg-white/90``) and the upload resume banner (``bg-[#FFF6E5]``).

This script is the standing prevention: every time we touch the
frontend (and during the "any bugs?" deep-dive), run this to flush
out any light backgrounds without a dark-mode rule.

Rules
-----
* Light = relative luminance > 0.70 (cream / paper / pastel / white).
* A class is "covered" if any line in ``index.css`` under
  ``:root[data-theme="dark"]`` mentions that exact escaped class
  selector.
* Dark-themed hexes (luminance ≤ 0.70) are skipped — they read fine
  in both modes.
* ``bg-white/N`` (semi-transparent white) is skipped by default — it
  is almost always an intentional overlay on top of an already-dark
  gradient (share banners, hover states on dark buttons, etc.) and
  flipping it to a dark surface would actually break the design.
  Opaque ``bg-white`` (no opacity suffix) IS checked because that's
  a genuine panel background.
* A line-level escape hatch is honoured: append
  ``// dark-ok`` (or ``{/* dark-ok */}``) on the same line as a
  light background to silence the warning, e.g. for a tinted chip
  that is intentionally bright in both modes.

Usage
-----
::

    python3 scripts/check_dark_mode_coverage.py
    python3 scripts/check_dark_mode_coverage.py --include-white-opacity  # strict mode

Exits 1 if any light background is uncovered.  Print is grouped by
file so you can fix-and-rerun fast.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
INDEX_CSS = SRC / "index.css"

# Hex utilities and the small set of Tailwind keyword backgrounds we
# care about.  Matches: bg-[#FBFAF6], bg-[#fff], bg-white, bg-white/90.
_BG_HEX = re.compile(r"bg-\[#([0-9A-Fa-f]{3,8})\](?:/(\d+))?")
_BG_WHITE = re.compile(r"\bbg-white(?:/(\d+))?\b")
_OK_MARKER = re.compile(r"dark-ok\b")

# Exempt list — these are CSS-internal utility classes that are not
# expected to live in JSX or are handled by other means.
EXEMPT_CLASSES: set[str] = set()


def luminance(hex_str: str) -> float:
    """Relative luminance per WCAG 2.x for a 3 / 6 / 8-digit hex."""
    h = hex_str.lower()
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return 0.0
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def _ch(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * _ch(r) + 0.7152 * _ch(g) + 0.0722 * _ch(b)


def find_jsx_bg_classes() -> dict[str, list[tuple[Path, int]]]:
    """Map ``bg-...`` class → list of ``(file, line)`` it appears on.

    Lines containing a ``dark-ok`` marker are skipped — that's the
    inline opt-out for intentional bright-in-both-modes designs.
    """
    usages: dict[str, list[tuple[Path, int]]] = {}
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
            for m in _BG_HEX.finditer(line):
                hex_part = m.group(1)
                opacity = m.group(2)
                cls = f"bg-[#{hex_part}]" + (f"/{opacity}" if opacity else "")
                usages.setdefault(cls, []).append((path, lineno))
            for m in _BG_WHITE.finditer(line):
                opacity = m.group(1)
                cls = "bg-white" + (f"/{opacity}" if opacity else "")
                usages.setdefault(cls, []).append((path, lineno))
    return usages


def _escape_class_for_css(cls: str) -> str:
    """Tailwind compiles ``bg-[#FBFAF6]`` into the CSS selector
    ``.bg-\[\#FBFAF6\]`` — every special char gets a backslash."""
    out = []
    for ch in cls:
        if ch in r"[]#./\\":
            out.append("\\" + ch)
        elif ch == "/":
            out.append("\\/")
        else:
            out.append(ch)
    return "." + "".join(out)


def load_dark_rules() -> str:
    """Return only the CSS lines under ``:root[data-theme="dark"]``."""
    if not INDEX_CSS.exists():
        return ""
    text = INDEX_CSS.read_text(encoding="utf-8")
    # Cheap approach: every dark rule lives on a line that contains
    # ``data-theme="dark"``.  Selectors can span multi-line lists
    # (comma-separated), so we also accept any line whose nearest
    # preceding ``data-theme`` block hasn't yet hit a ``}``.
    dark_lines: list[str] = []
    in_dark = False
    for line in text.splitlines():
        if 'data-theme="dark"' in line:
            in_dark = True
        if in_dark:
            dark_lines.append(line)
            # End of multi-selector list closes on the first ``{`` ...
            # rules with bodies span multiple lines; keep capturing
            # until we've passed the rule's ``}``.
            if line.rstrip().endswith("}"):
                in_dark = False
    return "\n".join(dark_lines)


def is_covered(cls: str, dark_css: str) -> bool:
    selector = _escape_class_for_css(cls)
    return selector in dark_css


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--include-white-opacity",
        action="store_true",
        help=(
            "Also flag bg-white/N (semi-transparent white) classes. "
            "Off by default — they're almost always intentional "
            "overlays on dark gradients."
        ),
    )
    args = parser.parse_args()

    usages = find_jsx_bg_classes()
    dark_css = load_dark_rules()

    light_uncovered: list[tuple[str, float, list[tuple[Path, int]]]] = []

    for cls, locations in sorted(usages.items()):
        if cls in EXEMPT_CLASSES:
            continue

        # ``bg-white/N`` is an opacity overlay — almost always
        # intentional in a dark-on-dark context (banners, buttons,
        # share modals).  Skip unless --include-white-opacity.
        if not args.include_white_opacity and cls.startswith("bg-white/"):
            continue

        # Determine the underlying hex for luminance.  bg-white = #fff.
        if cls.startswith("bg-white"):
            lum = 1.0
        else:
            m = _BG_HEX.search(cls)
            if not m:
                continue
            lum = luminance(m.group(1))

        if lum <= 0.70:
            continue  # Dark / mid-tone — fine in both modes.

        if is_covered(cls, dark_css):
            continue

        light_uncovered.append((cls, lum, sorted(set(locations))))

    if not light_uncovered:
        print("✓ dark-mode coverage: all light backgrounds are remapped")
        return 0

    print(
        f"\n✗ dark-mode coverage: {len(light_uncovered)} light "
        f"background class(es) used without a dark-mode rule\n"
        f"  Add a `:root[data-theme=\"dark\"] .<escaped-class>` rule "
        f"to frontend/src/index.css, OR append `// dark-ok` to the\n"
        f"  JSX line if the bright background is intentional in both modes.\n"
    )
    for cls, lum, locations in light_uncovered:
        # First two distinct files only — keeps output scannable.
        rel = []
        seen_files: set[Path] = set()
        for f, ln in locations:
            if f in seen_files:
                continue
            seen_files.add(f)
            rel.append(f"{f.relative_to(ROOT)}:{ln}")
            if len(rel) >= 3:
                break
        more = len(seen_files) - len(rel) if len(seen_files) > len(rel) else 0
        used_in = ", ".join(rel)
        if more > 0:
            used_in += f" (+{more} more)"
        print(f"  • {cls:24s}  L={lum:.2f}   used in: {used_in}")
    print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
