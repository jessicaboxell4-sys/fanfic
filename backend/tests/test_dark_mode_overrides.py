"""
Static-analysis guard against the "invisible text on cream background" class
of dark-mode bugs.

Background
----------
Shelfsort supports a global dark theme via `:root[data-theme="dark"]` CSS
overrides on Tailwind arbitrary-value classes. The pattern (see
`frontend/src/index.css`) is:

    :root[data-theme="dark"] .bg-\[\#EEE9FB\] { background-color: …; }

Every light arbitrary `bg-[#hex]` class needs a matching dark-mode override —
otherwise the page renders a cream box on the dark surface while the text
colors (already remapped to near-white via the `text-[#2C2C2C]` override) turn
invisible.

What this test does
-------------------
1. Scans every `.jsx/.js/.tsx/.ts` file under `frontend/src/` for
   `bg-[#hex]` Tailwind classes.
2. Computes WCAG relative luminance for each unique hex.
3. Skips dark colors (luminance ≤ LIGHT_THRESHOLD) — they don't need overrides.
4. Parses `frontend/src/index.css` for `:root[data-theme="dark"] .bg-\[\#hex\]`
   override rules.
5. Fails if any light hex is used without a matching override, with file:line
   locations so the dev can fix the right component.

The test is intentionally a single assertion with a structured failure message
so the dev sees every offender at once instead of an iterative whack-a-mole.
"""
import re
from pathlib import Path

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
CSS_FILE = FRONTEND_SRC / "index.css"

# WCAG-ish luminance threshold. 0.80 catches every cream / pale-peach
# background we've shipped (the #EEF3EC bug measured 0.88). Lower the
# threshold here only if you find a genuinely dark color triggering a
# false positive.
LIGHT_THRESHOLD = 0.80

# Hexes that are intentionally exempt. Keep this list small and document
# the reason — most arbitrary bgs that need an exemption are colors used
# only inside an already-dark surface where no override is needed.
WHITELIST: set[str] = set()


def hex_to_luminance(hex_str: str) -> float | None:
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        rgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    except ValueError:
        return None

    def channel(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _collect_arbitrary_bgs() -> dict[str, list[tuple[str, int]]]:
    pattern = re.compile(r"bg-\[#([0-9A-Fa-f]{3,6})\]")
    out: dict[str, list[tuple[str, int]]] = {}
    for ext in ("*.jsx", "*.js", "*.tsx", "*.ts"):
        for path in FRONTEND_SRC.rglob(ext):
            # Skip node_modules / build output (shouldn't be reachable via
            # src/, but defensive).
            if "node_modules" in path.parts:
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                for m in pattern.finditer(line):
                    key = m.group(1).lower()
                    out.setdefault(key, []).append(
                        (str(path.relative_to(FRONTEND_SRC)), i)
                    )
    return out


def _collect_dark_overrides() -> set[str]:
    """Returns the set of hex strings (lowercase) that already have a dark-mode
    `bg-[#hex]` override in index.css. Handles both 3- and 6-digit hexes and
    both escape styles seen in the file."""
    text = CSS_FILE.read_text(encoding="utf-8")
    # Pattern catches both `\[\#…\]` and `\[#…\]` to be permissive.
    pattern = re.compile(
        r':root\[data-theme="dark"\][^{}]*?\.bg-\\?\[\\?#([0-9A-Fa-f]{3,6})\\?\]',
        re.IGNORECASE,
    )
    return {m.group(1).lower() for m in pattern.finditer(text)}


def test_every_light_arbitrary_bg_has_a_dark_mode_override():
    """Light `bg-[#hex]` Tailwind classes must have a matching dark-mode
    override in index.css. See module docstring for the why."""
    bgs = _collect_arbitrary_bgs()
    overrides = _collect_dark_overrides()

    offenders = []
    for hex_str, locations in bgs.items():
        if hex_str in WHITELIST:
            continue
        lum = hex_to_luminance(hex_str)
        if lum is None or lum <= LIGHT_THRESHOLD:
            continue
        if hex_str in overrides:
            continue
        offenders.append((hex_str, lum, locations))

    if not offenders:
        return  # pass

    offenders.sort(key=lambda x: -x[1])  # darkest "light" last
    msg_lines = [
        f"Found {len(offenders)} light `bg-[#hex]` Tailwind class(es) without a "
        f"matching `:root[data-theme=\"dark\"] .bg-\\[\\#hex\\]` override in "
        f"frontend/src/index.css.",
        "",
        "Each one risks the same bug as #EEF3EC: cream box in dark mode + "
        "remapped near-white text == invisible.",
        "",
        "Offenders (sorted brightest first):",
    ]
    for hex_str, lum, locations in offenders:
        msg_lines.append(f"  #{hex_str}  (luminance={lum:.3f}, {len(locations)} usage(s))")
        for f, ln in locations[:5]:
            msg_lines.append(f"      {f}:{ln}")
        if len(locations) > 5:
            msg_lines.append(f"      … and {len(locations) - 5} more")
    msg_lines.append("")
    msg_lines.append(
        "Fix: append a one-liner to index.css, e.g.\n"
        '    :root[data-theme="dark"] .bg-\\[\\#EEF3EC\\] '
        "{ background-color: rgba(167, 139, 250, 0.14); }"
    )
    raise AssertionError("\n".join(msg_lines))
