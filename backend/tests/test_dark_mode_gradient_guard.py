"""Regression test: light-cream `bg-gradient-to-*` stops are invisible
in dark mode.

The codebase's dark-mode strategy retargets *solid* hex utility classes
(``bg-[#FBFAF6]``, ``bg-white``) via attribute selectors in
``index.css``.  Tailwind gradient color-stops (``from-[#FBFAF6]``,
``to-white``) bypass those overrides because they set
``--tw-gradient-from`` / ``--tw-gradient-to`` instead of
``background-color`` — so the container stays light-cream while the
text flips to light-cream, producing invisible-on-invisible.

This test scans ``frontend/src/components/*.jsx`` and
``frontend/src/pages/*.jsx`` for ``bg-gradient-to-`` lines that
reference any of the known light-cream hex stops, and fails if a NEW
violation appears that is not on the baseline allowlist.

Workflow when adding a new component:
  1. Use solid ``bg-[#FBFAF6]`` / ``bg-white`` for surfaces that need
     dark-mode parity (these classes ARE remapped in index.css).
  2. If you really need a gradient, add an explicit
     ``:root[data-theme="dark"] .from-\\[#FBFAF6\\]`` override block
     in ``index.css`` and add the file to the baseline below with a
     short comment.

To "approve" an existing gradient as visually-acceptable in dark mode
(eyeballed in both themes), add it to ``BASELINE_ALLOWLIST`` below.
"""
import re
from pathlib import Path

FRONTEND_ROOT = Path("/app/frontend/src")
SCAN_DIRS = ["components", "pages"]
# Light-cream / off-white hex tokens the dark-mode CSS retargets when
# they appear as SOLID bg classes but NOT when they appear as gradient
# color-stops. Keep this list aligned with the entries in index.css
# around the ":root[data-theme='dark'] .bg-[#...]" overrides.
LIGHT_STOPS = [
    "#FBFAF6",
    "#FDFBF7",
    "#FAF6EE",
    "#FAF7F0",
    "#FBF7EE",
    "#F2EDDF",
    "#F5F3EC",
    "#FDF3E1",
    "#FDF4E5",
    "#FCEFE6",
    "#F8E3D3",
    "#EDE7FB",
    "#EEE9FB",
    "#FBE9E7",
    "#EEF3EC",
    "white",  # to-white / from-white
]
# Pattern: ``bg-gradient-to-<dir>`` somewhere on the line, AND any of
# ``from-[hex]``, ``via-[hex]``, ``to-[hex]``, ``to-white`` matching a
# light stop on the same line.
GRADIENT_RE = re.compile(r"bg-gradient-to-[a-z]+")


def _line_has_light_stop(line: str) -> list[str]:
    """Return list of offending stops found in line, or []."""
    if not GRADIENT_RE.search(line):
        return []
    offenders: list[str] = []
    for stop in LIGHT_STOPS:
        if stop == "white":
            # match "to-white", "from-white", "via-white", optionally
            # followed by /<num> opacity, but NOT as a substring of
            # another class (e.g. "to-white/0" still counts).
            if re.search(r"(?:from|via|to)-white(?:/\d+)?\b", line):
                offenders.append("to-white")
        else:
            # match bracketed hex variants: from-[#FBFAF6], to-[#FBFAF6]/60, etc.
            pat = r"(?:from|via|to)-\[" + re.escape(stop) + r"\](?:/\d+)?"
            if re.search(pat, line, flags=re.IGNORECASE):
                offenders.append(stop)
    return offenders


def _scan() -> list[tuple[str, int, str, list[str]]]:
    """Return list of (relpath, line_no, line, offenders)."""
    out: list[tuple[str, int, str, list[str]]] = []
    for d in SCAN_DIRS:
        for path in (FRONTEND_ROOT / d).rglob("*.jsx"):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for i, line in enumerate(lines, start=1):
                stops = _line_has_light_stop(line)
                if stops:
                    rel = str(path.relative_to(FRONTEND_ROOT))
                    out.append((rel, i, line.strip(), stops))
    return out


# Baseline: known offenders verified by hand on 2026-06-20.  Any NEW
# violation that lands in the codebase will fail this test until either
# it's fixed (preferred) or explicitly added to this allowlist with a
# short justification.
#
# Format: (relpath, line_no).  Line numbers are approximate — the test
# accepts any line in the file with the same offending pattern.  This
# means adding/removing unrelated lines above the gradient won't break
# the test, but adding a NEW gradient elsewhere in the same file will.
BASELINE_ALLOWLIST: set[str] = {
    # UrlPasteCard hero — 3-stop accent gradient with explicit purple border
    "components/UrlPasteCard.jsx",
    # StatsPage "Year in Books" entry banner — peach + amber
    "pages/StatsPage.jsx",
    # Help page top banner — peach intro
    "pages/Help.jsx",
    # AllBooksPage three callout banners (3 gradients, 1 file)
    "pages/AllBooksPage.jsx",
}


def test_no_new_light_gradient_in_dark_mode():
    offenders = _scan()
    new_offenders = [o for o in offenders if o[0] not in BASELINE_ALLOWLIST]
    if new_offenders:
        msg = ["Found NEW light-cream gradients that will be invisible in dark mode:"]
        for relpath, ln, line, stops in new_offenders:
            msg.append(f"  {relpath}:{ln}  stops={stops}")
            msg.append(f"    > {line[:140]}")
        msg.append("")
        msg.append("Fix: replace `bg-gradient-to-* from-[#XXX] to-white` with a")
        msg.append("     solid `bg-[#FBFAF6]` (already dark-mode-mapped in index.css).")
        msg.append("     If a gradient is genuinely required, add an explicit")
        msg.append('     `:root[data-theme="dark"] .from-\\[#XXX\\]` override in')
        msg.append("     index.css AND add the file to BASELINE_ALLOWLIST in this test.")
        raise AssertionError("\n".join(msg))


def test_baseline_files_still_have_gradients():
    """If a baselined file no longer has a light gradient, it should be
    removed from the allowlist so the next regression is caught.
    This keeps the allowlist honest as the codebase evolves."""
    offenders_by_file = {o[0] for o in _scan()}
    stale = BASELINE_ALLOWLIST - offenders_by_file
    assert not stale, (
        f"BASELINE_ALLOWLIST contains files that no longer have light gradients: "
        f"{sorted(stale)}.  Remove them from the allowlist."
    )
