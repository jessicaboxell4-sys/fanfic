#!/usr/bin/env python3
"""Prod text-sentinel — companion to ``deploy_drift_check.py``.

The drift check only tracks ``data-testid`` values.  It cannot detect
regressions where a testid is preserved but its surrounding *visible*
copy, layout header, or label has been silently stripped — which is
exactly how the "Users & admins presence pill" regression slipped past
the pre-deploy check on 2026-07-09.

This sentinel takes the opposite angle: for a curated set of critical
UI surfaces we assert that a handful of load-bearing UTF-8 strings
appear at least once in the shipped prod bundle.  If any go missing,
we've regressed something a human would notice.

Design rules for adding a sentinel:

* Pick strings that are **unique** on the page (avoid "OK", "Save").
* Pick strings that would **catastrophically** hurt UX if lost — e.g.
  the header of a card, an empty-state title, a primary action button.
* Encode the string the way it renders in the built bundle (JSX
  entities like ``&apos;`` have already been decoded — use ``'``).
* Group by surface so the failure message is actionable.

Usage:

    python3 scripts/deploy_text_sentinel.py               # fetch prod bundle
    python3 scripts/deploy_text_sentinel.py --bundle F    # use cached file
    python3 scripts/deploy_text_sentinel.py --built       # scan /app/frontend/build

Exit codes:
    0   All sentinels present
    1   One or more sentinels missing
    2   Fetch / IO error
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

PROD_HOME = "https://shelfsort.com/"
BUNDLE_URL_RE = re.compile(r'/static/js/main\.[a-f0-9]+\.js')

# ---------------------------------------------------------------------------
# Sentinel table.  Each entry: (surface, string, note).
# `surface` is a short human tag used only in the failure report.
# ---------------------------------------------------------------------------
SENTINELS: list[tuple[str, str, str]] = [
    # ---- Admin: Users & admins card (the 2026-07-09 pill regression) ----
    ("admin-users-card", "Online:",              "Real-users online count chip"),
    ("admin-users-card", "Offline:",             "Real-users offline count chip"),
    ("admin-users-card", "Users & admins",       "Card title"),
    ("admin-users-card", "Real users",           "Section header (rendered uppercase via CSS)"),
    ("admin-users-card", "Test / QA accounts",   "Collapsed test-user section"),

    # ---- Admin: Drift status card ----
    ("admin-drift-status-card", "Prod ↔ source drift", "Card title (↔ arrow is meaningful)"),
    ("admin-drift-status-card", "Safe to deploy",      "Green-status label"),

    # ---- Admin: Feedback inbox / lifecycle ----
    ("admin-feedback-inbox", "Feedback inbox", "Card title"),

    # ---- Admin: Sign-up / users ----
    ("admin-signups",       "Pending sign-ups",         "Card title"),
    ("admin-signup-rules",  "Sign-up rules & questions", "Card title"),

    # ---- Admin: system + storage sections ----
    ("admin-sections", "System & health",  "Section grouper heading"),
    ("admin-sections", "Storage & files",  "Section grouper heading"),

    # ---- Library: Quarantine page (2026-07-09 P0 reconstruction) ----
    ("quarantine",     "No duplicates to review",  "Empty-state title"),
    ("quarantine",     "Why we caught this",       "Per-row diagnostic toggle"),
    ("quarantine",     "This isn't a duplicate",   "Dismiss button (JSX entity decoded)"),
    ("quarantine",     "Keep both",                "Row action"),
    ("quarantine",     "Historical",               "Row action / version tag"),

    # ---- Account: Duplicate dismissals card ----
    ("dup-dismissals", "Duplicate dismissals", "Card title"),
    ("dup-dismissals", "Not a duplicate of",   "Row descriptor"),

    # ---- Navbar ----
    ("navbar", "back to library", "Common back-link copy in sub-pages"),

    # ---- Upload / library core ----
    ("library",   "Send to Trash",   "Duplicate policy option (part of 638-book recovery flow)"),

    # ---- Reader ----
    ("library",   "Continue reading", "Home / library resume block"),

    # ---- Attribution / admin timeline (fragile — reconstructed heavily) ----
    ("admin-users-card", "utm_campaign",  "Attribution timeline field label"),
    ("admin-users-card", "full timeline", "Timeline drill-down link"),
]


def _to_unicode_escape(s: str) -> str:
    """Return the JS ``\\uXXXX``-escaped form of any non-ASCII chars in ``s``.

    Webpack/Terser typically encodes non-ASCII string literals this way in
    the minified bundle (e.g. ``"↔"`` → ``"\\u2194"``), so a naive UTF-8
    substring search against the bundle would false-negative.  We check
    both the raw UTF-8 form and this escape form and accept either."""
    out = []
    for ch in s:
        if ord(ch) < 128:
            out.append(ch)
        else:
            out.append("\\u{:04x}".format(ord(ch)))
    return "".join(out)


def sentinel_in_bundle(needle: str, bundle_text: str) -> bool:
    """A sentinel is present if either its raw form OR its unicode-escape
    form appears in the bundle text."""
    if needle in bundle_text:
        return True
    escaped = _to_unicode_escape(needle)
    if escaped != needle and escaped in bundle_text:
        return True
    return False


def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 shelfsort-text-sentinel",
    })
    return urllib.request.urlopen(req, timeout=15).read()


def fetch_bundle(dest: Path) -> str:
    html = _http_get(PROD_HOME).decode("utf-8", "replace")
    m = BUNDLE_URL_RE.search(html)
    if not m:
        raise RuntimeError("Could not find /static/js/main.*.js in prod home HTML")
    bundle_url = urllib.parse.urljoin(PROD_HOME, m.group(0))
    print(f"→ Fetching {bundle_url}")
    data = _http_get(bundle_url)
    dest.write_bytes(data)
    print(f"  ({dest.stat().st_size:,} bytes)")
    return m.group(0).rsplit("/", 1)[-1]  # e.g. main.ac1fb135.js


def load_built_locally() -> bytes | None:
    """Pick the newest main.*.js from ``/app/frontend/build/static/js`` if a
    local build exists (CI/dev workflow).  Returns ``None`` otherwise."""
    build_dir = Path("/app/frontend/build/static/js")
    if not build_dir.exists():
        return None
    candidates = sorted(build_dir.glob("main.*.js"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        return None
    return candidates[0].read_bytes()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=None,
                    help="Path to a cached prod bundle (skips network fetch)")
    ap.add_argument("--built", action="store_true",
                    help="Scan the local /app/frontend/build/static/js/main.*.js instead of prod")
    args = ap.parse_args()

    tmp = None
    label = "prod"
    try:
        if args.built:
            body = load_built_locally()
            if body is None:
                print("❌ No local build at /app/frontend/build/static/js/main.*.js — run `yarn build` first.",
                      file=sys.stderr)
                return 2
            label = "local build"
            print(f"→ Scanning local build ({len(body):,} bytes)")
        elif args.bundle:
            if not args.bundle.exists():
                print(f"❌ Bundle not found: {args.bundle}", file=sys.stderr)
                return 2
            body = args.bundle.read_bytes()
            label = f"cached {args.bundle.name}"
            print(f"→ Using cached bundle: {args.bundle} ({len(body):,} bytes)")
        else:
            tmp = tempfile.NamedTemporaryFile(suffix=".js", delete=False)
            tmp_path = Path(tmp.name)
            tmp.close()
            hash_name = fetch_bundle(tmp_path)
            body = tmp_path.read_bytes()
            label = f"prod {hash_name}"
    except Exception as e:
        print(f"❌ Fetch error: {e}", file=sys.stderr)
        return 2

    text = body.decode("utf-8", "replace")

    missing: list[tuple[str, str, str]] = []
    for surface, needle, note in SENTINELS:
        if not sentinel_in_bundle(needle, text):
            missing.append((surface, needle, note))

    print()
    print(f"→ Text sentinel scan of {label} — {len(SENTINELS)} checks, {len(missing)} missing.")
    if missing:
        print()
        print(f"🔴 {len(missing)} sentinel string(s) NOT FOUND in the bundle:")
        # Group by surface for readable output.
        by_surface: dict[str, list[tuple[str, str]]] = {}
        for surface, needle, note in missing:
            by_surface.setdefault(surface, []).append((needle, note))
        for surface, items in sorted(by_surface.items()):
            print(f"  ▸ {surface}")
            for needle, note in items:
                print(f"      ✗  {needle!r:40s}  # {note}")
        print()
        print("Investigate: was this string intentionally removed, reworded, or is a whole surface missing?")
    else:
        print("✅ All sentinel strings present — critical UI copy intact.")

    if tmp:
        Path(tmp.name).unlink(missing_ok=True)

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
