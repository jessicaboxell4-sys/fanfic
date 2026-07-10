"""
Static-analysis guard against three classes of dark-mode bugs:

1. **Invisible-text-on-cream** — light `bg-[#hex]` Tailwind classes whose
   surface stays cream in dark mode while the remapped `text-[#2C2C2C]` flips
   to near-white, leaving an unreadable wash. (e.g. the original #EEF3EC bug)
2. **Invisible-dark-text** — dark `text-[#hex]` Tailwind classes that render
   directly on the dark surface in dark mode. Without a brightened override,
   they vanish into the background.
3. **Glaring borders** — very light `border-[#hex]` classes that draw a stark
   bright line on the dark surface in dark mode. The existing
   `border-[#E5DDC5]` family is already overridden; this guard catches any
   new addition that misses the same treatment.

How it works
------------
Each test scans every `.jsx/.js/.tsx/.ts` file under `frontend/src/` for the
relevant Tailwind arbitrary-value class, computes WCAG relative luminance,
filters to the danger zone (light bgs / dark text / light borders), and
fails if `frontend/src/index.css` doesn't already remap that hex under
`:root[data-theme="dark"]`. The failure message lists every file:line so
the dev fixes the right component on the first try.

The thresholds and explicit whitelists live at the top so they can be tuned
without touching the scanning logic.
"""
import re
from pathlib import Path

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
CSS_FILE = FRONTEND_SRC / "index.css"

# WCAG-ish relative luminance. The thresholds below were tuned empirically
# against the codebase's existing overrides:
#   • Light bg threshold 0.80 catches the original #EEF3EC bug (L≈0.88).
#   • Dark text threshold 0.30 covers every #2C2C2C / #6B705C / coloured
#     "deep" accent we've shipped without firing on already-light text.
#   • Light border threshold 0.80 matches the cream `border-[#E5DDC5]` family.
LIGHT_BG_THRESHOLD = 0.80
DARK_TEXT_THRESHOLD = 0.30
LIGHT_BORDER_THRESHOLD = 0.80

# Hexes intentionally exempt. Keep small and document the reason. Use these
# only for colours that genuinely don't need a dark-mode override (e.g. used
# exclusively inside an already-themed container).
BG_WHITELIST: set[str] = set()
TEXT_WHITELIST: set[str] = set()
BORDER_WHITELIST: set[str] = set()


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


def _collect_arbitrary_uses(prop: str) -> dict[str, list[tuple[str, int]]]:
    """Returns: { hex_lowercase: [(file, line_num, exact_case_hex), ...] } for `{prop}-[#hex]`."""
    pattern = re.compile(rf"{prop}-\[#([0-9A-Fa-f]{{3,6}})\]")
    out: dict[str, list[tuple[str, int, str]]] = {}
    for ext in ("*.jsx", "*.js", "*.tsx", "*.ts"):
        for path in FRONTEND_SRC.rglob(ext):
            if "node_modules" in path.parts:
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                for m in pattern.finditer(line):
                    exact = m.group(1)
                    out.setdefault(exact.lower(), []).append(
                        (str(path.relative_to(FRONTEND_SRC)), i, exact)
                    )
    return out


def _collect_dark_overrides(prop: str) -> set[str]:
    """Returns the set of hex strings (lowercased) already overridden for `:root[data-theme="dark"] .{prop}-[#hex]`."""
    text = CSS_FILE.read_text(encoding="utf-8")
    pattern = re.compile(
        rf':root\[data-theme="dark"\][^{{}}]*?\.{prop}-\\?\[\\?#([0-9A-Fa-f]{{3,6}})\\?\]',
        re.IGNORECASE,
    )
    return {m.group(1).lower() for m in pattern.finditer(text)}


def _collect_dark_override_exact_cases(prop: str) -> dict[str, set[str]]:
    """Like _collect_dark_overrides but preserves the exact case spelling
    seen in the CSS. Returns { lowercased_hex: {exact_case_1, exact_case_2, …} }
    so we can verify the JSX-side spelling has a matching override (CSS
    class selectors are case-sensitive)."""
    text = CSS_FILE.read_text(encoding="utf-8")
    pattern = re.compile(
        rf':root\[data-theme="dark"\][^{{}}]*?\.{prop}-\\?\[\\?#([0-9A-Fa-f]{{3,6}})\\?\]'
    )
    out: dict[str, set[str]] = {}
    for m in pattern.finditer(text):
        exact = m.group(1)
        out.setdefault(exact.lower(), set()).add(exact)
    return out


def _build_failure_message(prop: str, danger_zone: str, offenders: list, example_fix: str) -> str:
    msg = [
        f"Found {len(offenders)} `{prop}-[#hex]` Tailwind class(es) in the "
        f"{danger_zone} danger zone without a matching "
        f"`:root[data-theme=\"dark\"] .{prop}-\\[\\#hex\\]` override in "
        f"frontend/src/index.css.",
        "",
        "Offenders (sorted worst-first):",
    ]
    for hex_str, lum, locations in offenders:
        msg.append(f"  #{hex_str}  (luminance={lum:.3f}, {len(locations)} usage(s))")
        for loc in locations[:5]:
            f, ln = loc[0], loc[1]
            msg.append(f"      {f}:{ln}")
        if len(locations) > 5:
            msg.append(f"      … and {len(locations) - 5} more")
    msg.append("")
    msg.append(f"Fix example:\n    {example_fix}")
    return "\n".join(msg)


def test_every_light_arbitrary_bg_has_a_dark_mode_override():
    """Light `bg-[#hex]` classes must have a dark-mode override — else the
    remapped near-white text turns invisible on the un-remapped cream."""
    uses = _collect_arbitrary_uses("bg")
    overrides = _collect_dark_overrides("bg")
    offenders = []
    for hex_str, locations in uses.items():
        if hex_str in BG_WHITELIST or hex_str in overrides:
            continue
        lum = hex_to_luminance(hex_str)
        if lum is None or lum <= LIGHT_BG_THRESHOLD:
            continue
        offenders.append((hex_str, lum, locations))
    if not offenders:
        return
    offenders.sort(key=lambda x: -x[1])
    raise AssertionError(
        _build_failure_message(
            "bg",
            "light-background",
            offenders,
            ':root[data-theme="dark"] .bg-\\[\\#EEF3EC\\] '
            "{ background-color: rgba(167, 139, 250, 0.14); }",
        )
    )


def test_every_dark_arbitrary_text_has_a_dark_mode_override():
    """Dark `text-[#hex]` classes must have a dark-mode override — else they
    render as near-black on the dark surface and become invisible."""
    uses = _collect_arbitrary_uses("text")
    overrides = _collect_dark_overrides("text")
    offenders = []
    for hex_str, locations in uses.items():
        if hex_str in TEXT_WHITELIST or hex_str in overrides:
            continue
        lum = hex_to_luminance(hex_str)
        if lum is None or lum >= DARK_TEXT_THRESHOLD:
            continue
        offenders.append((hex_str, lum, locations))
    if not offenders:
        return
    offenders.sort(key=lambda x: x[1])
    raise AssertionError(
        _build_failure_message(
            "text",
            "dark-text",
            offenders,
            ':root[data-theme="dark"] .text-\\[\\#333\\] '
            "{ color: var(--text-primary); }",
        )
    )


def test_every_light_arbitrary_border_has_a_dark_mode_override():
    """Light `border-[#hex]` classes must have a dark-mode override — else
    they draw a too-bright line on the dark surface, clashing with the
    softened `--border` used elsewhere."""
    uses = _collect_arbitrary_uses("border")
    overrides = _collect_dark_overrides("border")
    offenders = []
    for hex_str, locations in uses.items():
        if hex_str in BORDER_WHITELIST or hex_str in overrides:
            continue
        lum = hex_to_luminance(hex_str)
        if lum is None or lum <= LIGHT_BORDER_THRESHOLD:
            continue
        offenders.append((hex_str, lum, locations))
    if not offenders:
        return
    offenders.sort(key=lambda x: -x[1])
    raise AssertionError(
        _build_failure_message(
            "border",
            "light-border",
            offenders,
            ':root[data-theme="dark"] .border-\\[\\#EEE\\] '
            "{ border-color: var(--border); }",
        )
    )


def test_arbitrary_class_case_matches_between_jsx_and_css():
    """CSS class selectors are case-sensitive. A JSX `bg-[#eee]` generates
    the class `.bg-[#eee]` while an override `:root[data-theme="dark"] .bg-\\[\\#EEE\\]`
    targets a different class and won't apply. This guard catches any
    `{bg,text,border}-[#hex]` whose lowercased hex has SOME dark override but
    not one with the exact case the JSX uses. Caught the DownloadPage Cancel
    button bug (JSX `bg-[#eee]` vs CSS `.bg-[#EEE]`) in retro."""
    mismatches: list[tuple[str, str, str, list[tuple[str, int]]]] = []
    for prop in ("bg", "text", "border"):
        uses = _collect_arbitrary_uses(prop)
        css_cases = _collect_dark_override_exact_cases(prop)
        for lower_hex, locations in uses.items():
            css_spellings = css_cases.get(lower_hex)
            if not css_spellings:
                # No override at all — that's the OTHER three tests' job
                # to surface, so skip here to avoid duplicate failure noise.
                continue
            # Group JSX usages by their exact-case spelling.
            by_case: dict[str, list[tuple[str, int]]] = {}
            for loc in locations:
                f, ln, jsx_exact = loc[0], loc[1], loc[2]
                by_case.setdefault(jsx_exact, []).append((f, ln))
            for jsx_exact, locs in by_case.items():
                if jsx_exact not in css_spellings:
                    mismatches.append((prop, jsx_exact, ", ".join(sorted(css_spellings)), locs))
    if not mismatches:
        return
    msg = [
        f"Found {len(mismatches)} JSX arbitrary-value class(es) whose hex CASE "
        f"doesn't match any dark-mode override in frontend/src/index.css.",
        "",
        "CSS class selectors are case-sensitive — a JSX `bg-[#eee]` only "
        "matches an override targeting `.bg-\\[\\#eee\\]`, NOT `.bg-\\[\\#EEE\\]`.",
        "",
        "Mismatches:",
    ]
    for prop, jsx_exact, css_seen, locs in mismatches:
        msg.append(f"  {prop}-[#{jsx_exact}] — CSS only has cases {{{css_seen}}}")
        for f, ln in locs[:5]:
            msg.append(f"      {f}:{ln}")
        if len(locs) > 5:
            msg.append(f"      … and {len(locs) - 5} more")
    msg.append("")
    msg.append(
        "Fix: add the exact-case selector alongside the existing one, e.g.\n"
        '    :root[data-theme="dark"] .bg-\\[\\#EEE\\],\n'
        '    :root[data-theme="dark"] .bg-\\[\\#eee\\] { background-color: var(--surface); }'
    )
    raise AssertionError("\n".join(msg))
