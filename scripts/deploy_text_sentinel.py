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
    ("admin-drift-status-card", "Copy sentinel",       "Companion pill added 2026-07-12"),

    # ---- Admin: Feedback inbox / lifecycle ----
    ("admin-feedback-inbox", "Feedback inbox", "Card title"),
    ("admin-feedback-inbox", "Help-page feedback", "Per-page friction reports card title"),

    # ---- Admin: Sign-up / users ----
    ("admin-signups",       "Pending sign-ups",         "Card title"),
    ("admin-signup-rules",  "Sign-up rules & questions", "Card title"),
    ("admin-view-consents", "View-as-user consents",    "Card title"),

    # ---- Admin: section groupers ----
    ("admin-sections", "System & health",  "Section grouper heading"),
    ("admin-sections", "Storage & files",  "Section grouper heading"),
    ("admin-sections", "Data & diagnostics", "Section grouper heading"),
    ("admin-sections", "Feedback & moderation", "Section grouper heading"),
    ("admin-sections", "Users & sign-ups", "Section grouper heading"),

    # ---- Admin: overview / activity ----
    ("admin-overview", "Today · 24h pulse", "Card title (day-summary pulse)"),

    # ---- Admin: community / oversight ----
    ("admin-community", "Rooms I'm watching", "Bookclub-oversight card title"),
    ("admin-community", "Direct-message rooms.", "Chat-rooms card subtitle"),
    ("admin-community", "Moderation log",     "All-time mod action log card title"),

    # ---- Admin: storage cluster ----
    ("admin-storage", "ClamAV scanner status", "Antivirus card subtitle (specific to Shelfsort's stack)"),
    ("admin-storage", "Top storage users",     "Card title"),
    ("admin-storage", "R2 migration progress", "Card title"),
    ("admin-storage", "Orphan audit & cleanup","Card title"),
    ("admin-storage", "Storage trend",         "Card title (30-day chart)"),

    # ---- Admin: email cluster ----
    ("admin-email", "Master ON/OFF for all outbound", "Email-system card subtitle (kill switch)"),
    ("admin-email", "Email volume forecast",     "Card title"),
    ("admin-email", "Admin alert email frequency","Card title"),
    ("admin-email", "Admin bell · pending alerts","Card title"),
    ("admin-email", "Resend deliveries",          "Weekly email stats card title"),
    ("admin-email", "Email diagnostic",           "Card title"),

    # ---- Admin: system / health cluster ----
    ("admin-system", "Maintenance banner",     "Card title"),
    ("admin-system", "External dependencies",  "System-health card subtitle"),
    ("admin-system", "Stuck uploads",          "Card title"),
    ("admin-system", "Classifier reliability", "Card title"),
    ("admin-system", "Crash pulse",            "Card title"),
    ("admin-system", "Where new visitors are finding Shelfsort", "Attribution card subtitle"),
    ("admin-system", "Scheduled jobs",         "Cron-health card title"),
    ("admin-system", "Route catalogue",        "Card title"),
    ("admin-system", "Runtime kill switches",  "Feature-flags card subtitle"),
    ("admin-system", "Hidden features",        "Card title"),
    ("admin-system", "Recent changelog",       "Card title"),
    ("admin-system", "Production canary",      "Card title"),
    ("admin-system", "LLM key health",         "Card title"),
    ("admin-system", "Unknown fandoms",        "Card title"),
    ("admin-system", "Crossover suggestions",  "Card title"),
    ("admin-system", "Global fandom aliases",  "Card title"),

    # ---- Admin: data & diagnostics cluster ----
    ("admin-data", "My library diagnostics",    "Card title (2000-book recovery workflow)"),
    ("admin-data", "Notification preferences",  "Card title (nudge toggles)"),
    ("admin-data", "Backfill EPUB links",       "Card title"),
    ("admin-data", "Tenant-wide rollup",        "Global-stats card subtitle"),
    ("admin-data", "Every admin write action",  "Audit-log card subtitle"),
    ("admin-data", "Mongo inspector",           "Card title"),
    ("admin-data", "Full-text index",           "Card title"),

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
    ("library",   "Continue reading", "Home / library resume block"),

    # ---- Primary CTAs — highest-friction if silently dropped ----
    # These are the buttons that DO the work. Losing one silently
    # breaks a real user workflow, not just visual polish.
    ("admin-signups",    "Approve all",             "Bulk approval primary CTA (Pending sign-ups)"),
    ("admin-email",      "Send diagnostic",         "Email diagnostic card primary CTA"),
    ("admin-storage",    "Migrate all remaining",   "R2 migration primary CTA"),
    ("admin-users-card", "Request access",          "View-as consent primary CTA"),
    ("admin-chat-rooms", "Create a new room",       "Chat rooms primary CTA"),
    ("admin-attribution","Top UTM campaigns",       "Attribution card section header"),
    ("admin-attribution","Top referrer domains",    "Attribution card section header"),
    ("admin-users-card", "Visit timeline",          "Timeline drill-down link"),
    ("admin-email",      "Resend plan usage",       "Email stats section"),
    ("admin-email",      "Recent failures",         "Email stats section"),

    # ---- Upload zone / dashboard / find-duplicates ----
    ("upload",           "Drop files or folders here", "UploadZone empty state (hero copy)"),
    ("upload",           "Stage before upload",        "UploadZone stage-mode toggle"),
    ("dashboard",        "Smart shelves",              "Dashboard section header"),
    ("find-duplicates",  "Find duplicates",            "Page title / primary CTA"),
    ("find-duplicates",  "No duplicates found",        "Empty state"),

    # ---- Book detail / conversion recovery ----
    ("book-detail",      "Edit book details",          "Book actions menu label"),
    ("book-detail",      "Save & retry",               "Convert-retry CTA (Unreadable shelf recovery)"),

    # ---- Community / bookclubs ----
    ("bookclubs",        "Start your first reading room", "Empty-state CTA"),

    # ---- Landing (unauthenticated marketing surface) ----
    # These are the hero-strip promises. Losing them silently would tank
    # sign-up conversion — worst-case for a marketing page regression.
    ("landing", "Book clubs, with chapters",   "Landing feature card title"),
    ("landing", "Fix messy metadata, in place","Landing feature card title"),
    ("landing", "Folders that feel right",     "Landing feature card title"),
    ("landing", "Friends who actually read",   "Landing feature card title"),
    ("landing", "Goals & streaks (gently)",    "Landing feature card title"),
    ("landing", "AI auto-sorts by fandom",     "Landing feature pill"),
    ("landing", "Every upload virus-scanned",  "Landing feature pill"),
    ("landing", "Sync across devices",         "Landing feature pill"),
    ("landing", "Free while we grow",          "Landing feature pill"),

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


def _to_hex_escape(s: str) -> str:
    """Return the JS ``\\xXX``-escaped form for chars 128–255.

    Terser prefers the shorter ``\\xXX`` form over ``\\uXXXX`` when the
    code point fits in one byte, so ``"·"`` (U+00B7) becomes ``"\\xb7"``
    in the minified bundle.  Chars ≥ 256 are left in ``\\uXXXX`` form
    (Terser will use whichever is shorter; we produce ``\\xXX`` when
    possible)."""
    out = []
    for ch in s:
        cp = ord(ch)
        if cp < 128:
            out.append(ch)
        elif cp < 256:
            out.append("\\x{:02x}".format(cp))
        else:
            out.append("\\u{:04x}".format(cp))
    return "".join(out)


def sentinel_in_bundle(needle: str, bundle_text: str) -> bool:
    """A sentinel is present if the raw form OR any Terser-escaped form
    appears in the bundle text.

    Terser encodes non-ASCII chars in three ways depending on width:
      * Byte-range (128–255)     → ``\\xXX``  e.g. ``·`` → ``\\xb7``
      * Above 255                → ``\\uXXXX`` e.g. ``↔`` → ``\\u2194``
      * Occasionally kept raw    → matches the plain UTF-8 form
    We check all three so no false negatives.
    """
    if needle in bundle_text:
        return True
    u_escaped = _to_unicode_escape(needle)
    if u_escaped != needle and u_escaped in bundle_text:
        return True
    h_escaped = _to_hex_escape(needle)
    if h_escaped != needle and h_escaped != u_escaped and h_escaped in bundle_text:
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
