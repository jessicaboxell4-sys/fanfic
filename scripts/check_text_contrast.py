#!/usr/bin/env python3
"""Text-contrast lint for Shelfsort.

Scans ``frontend/src`` for Tailwind arbitrary text colors
(``text-[#XXXXXX]``) and fails the lint when ANY new occurrence
sits below WCAG AA body-text contrast (4.5:1) on the paper
background ``#FDFBF7`` — *unless* the color is one of:

* Listed in ``APPROVED_PALETTE``  (recommended for all new code)
* Listed in ``GRANDFATHERED``      (existing low-contrast colors
  frozen in place — never expand this set; ideally shrink over
  time as each one is migrated to an approved hue)

Background
----------

On 2026-06-28 the user reported the green / brown / grey text on
the site was hard to read.  A site-wide audit found 5 widely-used
arbitrary text colors below WCAG AA (the worst at 2.69:1).  The
fix migrated ~1500 occurrences to a higher-contrast palette
(see CHANGELOG: "Site-wide text-contrast bump").

This lint exists to prevent the regression from happening
silently again — the next time an agent or contributor reaches
for a "pretty but unreadable" color, the pre-commit hook catches
it before it lands.

Rationale for two lists
-----------------------

A single approved list would force retroactive cleanup of 28
existing low-contrast colors before the lint could land
(`#E07A5F` brand coral, `#B87A00` amber for non-fiction, etc.).
That's a separate, larger project.  The grandfather list lets
the lint protect the future without blocking the present.  Each
grandfathered entry has a one-line note so we know why it's
there and whether it can eventually be replaced.

Usage
-----

::

    python3 scripts/check_text_contrast.py

Exits 1 with a list of offending occurrences (file:line + color
+ contrast ratio) when any new sub-AA text color is detected.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Tuple

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = ROOT / "frontend" / "src"
PAPER_BG = "#FDFBF7"  # the canonical light-mode body bg
WCAG_AA_BODY = 4.5

# ─────────────────────────────────────────────────────────────
# Approved palette — use these for NEW code.
# Each hex has been verified at ≥ 4.5:1 contrast vs #FDFBF7.
# Keep this set small enough to memorize.
# ─────────────────────────────────────────────────────────────
APPROVED_PALETTE: set[str] = {
    # Primary / secondary / tertiary neutrals
    "#2C2C2C", "#5B5F4D", "#6E6E6E", "#4A4A4A", "#3A3A3A",
    # Brand purple family
    "#6B46C1", "#553397", "#553B96", "#5B3FBE",
    "#5A3AA3", "#5A38A8", "#4C2A99", "#4B2D86", "#6B4A8C",
    # Error / destructive reds
    "#7C2D2A", "#7A2417", "#9D2A2A", "#B91C1C", "#5C1F1D",
    "#A03D33", "#9B3531", "#B53C39", "#A83A36",
    # Success greens
    "#3D6B3D", "#1F4D2A", "#1F4A1F", "#3A4A2E", "#3B5B3F",
    "#1E6B3F", "#2C7A3E", "#2E7D45",
    # Teal / sage accents
    "#2F6E60",
    # Warning amber / bronze
    "#7C5F1F", "#8B4F00", "#8C5C00", "#7A5C00", "#7C5400",
    "#8A6800", "#5C3300", "#6B5436",
    # Earth tones (high-contrast browns)
    "#9E5A2E", "#A8532F", "#9C4521", "#B43F26", "#B0411E",
    # Other ratified
    "#3A5A8C", "#3F4034",
}

# ─────────────────────────────────────────────────────────────
# Grandfathered — existing sub-AA colors currently in use.
# DO NOT expand this set.  Each entry has a one-line note so we
# can track which can be replaced and which are intentional.
# Add a "TODO migrate" comment in the source instead of growing
# this list.
# ─────────────────────────────────────────────────────────────
GRANDFATHERED: dict[str, str] = {
    "#E07A5F": "brand coral; mostly button bg with white text — text uses are accents",
    "#B87A00": "amber accent for the 'non-fiction' category badge",
    "#D9534F": "bootstrap red, in legacy admin views",
    "#1F8F4E": "bright success green for inline 'live' indicators",
    "#9B9B8C": "secondary grey on warm cards",
    "#A99878": "tan accent on community cards",
    "#9A9580": "secondary grey on warm cards",
    "#C04A3F": "deeper red accent",
    "#C5564B": "destructive button text in some flows",
    "#C75450": "polish-failed sentinel red",
    "#B7791F": "amber category accent",
    "#A76900": "amber category accent",
    "#B85C7C": "rose accent on community shelves",
    "#22A06B": "fresh-green stat callout",
    "#0085FF": "informational blue link variant",
    "#1DA1F2": "twitter brand blue",
    "#FF9900": "warning amber dot",
    "#D49A33": "polish-pending dot text",
    "#81B29A": "sage accent on calm cards",
    "#B7A7FF": "lavender accent on quiet states",
    "#C7B7A8": "warm grey accent",
    "#C8C2B0": "warm grey accent",
    "#FFB1AD": "rose tint accent",
    "#E6CFA1": "amber-cream accent",
    "#E5DDC5": "very-pale ivory accent — likely on a darker bg in context",
    "#E8E6E1": "very-pale grey accent — likely on a darker bg in context",
    "#EEE9FB": "very-pale lavender — almost certainly on a darker bg",
    "#FDF3E1": "very-pale amber — almost certainly on a darker bg",
}

# Files to scan
SCAN_EXTS = (".jsx", ".tsx", ".css")
TEXT_COLOR_RE = re.compile(r"text-\[#([0-9A-Fa-f]{6})\]")


def _srgb_to_linear(c_byte: int) -> float:
    c = c_byte / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(hex6: str) -> float:
    h = hex6.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (
        0.2126 * _srgb_to_linear(r)
        + 0.7152 * _srgb_to_linear(g)
        + 0.0722 * _srgb_to_linear(b)
    )


def _contrast(fg: str, bg: str = PAPER_BG) -> float:
    L1, L2 = _luminance(fg), _luminance(bg)
    return (max(L1, L2) + 0.05) / (min(L1, L2) + 0.05)


def _scan() -> list[Tuple[str, int, str, float]]:
    """Return list of (relpath, lineno, color, contrast) hits that
    are neither approved nor grandfathered AND sit below 4.5:1."""
    hits: list[Tuple[str, int, str, float]] = []
    if not FRONTEND_SRC.exists():
        return hits
    for path in FRONTEND_SRC.rglob("*"):
        if not path.is_file() or path.suffix not in SCAN_EXTS:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for m in TEXT_COLOR_RE.finditer(line):
                color = "#" + m.group(1).upper()
                if color in APPROVED_PALETTE or color in GRANDFATHERED:
                    continue
                c = _contrast(color)
                if c < WCAG_AA_BODY:
                    rel = path.relative_to(ROOT).as_posix()
                    hits.append((rel, lineno, color, c))
    return hits


def main() -> int:
    hits = _scan()
    if not hits:
        print(
            f"✓ text-contrast lint: every text-[#…] arbitrary value "
            f"is either ≥ {WCAG_AA_BODY}:1 contrast or grandfathered"
        )
        return 0

    print(f"\n✗ text-contrast lint: {len(hits)} new sub-AA text color(s) found\n")
    print(f"  All occurrences below {WCAG_AA_BODY}:1 contrast on the paper bg {PAPER_BG}:\n")
    for rel, ln, color, c in hits:
        print(f"  {rel}:{ln}  {color}  contrast={c:.2f}:1")
    print(
        "\n  Fix options:\n"
        "    (a) Swap to a color in APPROVED_PALETTE in scripts/check_text_contrast.py.\n"
        "    (b) If the color sits on a dark or saturated background, keep it BUT\n"
        "        confirm the actual perceived contrast manually; consider extracting\n"
        "        a per-surface override into index.css instead of an arbitrary value.\n"
        "    (c) If the color is genuinely necessary and used in many places,\n"
        "        propose adding it to APPROVED_PALETTE (with a contrast ≥ 4.5:1)\n"
        "        OR — only if absolutely justified — to GRANDFATHERED with a note.\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
