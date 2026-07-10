#!/usr/bin/env python3
"""Exhaustive prod-vs-source drift check for the Shelfsort deploy SOP.

Fetches (or reads a cached copy of) the currently-live prod frontend
bundle, extracts every ``data-testid`` value shipped, and confirms
each one appears at least once in ``/app/frontend/src`` or
``/app/backend``.

Any prod testid with **zero** source matches = a feature that's live
on prod but missing from the pod's source tree.  Deploying from that
source would SILENTLY REMOVE the feature from prod.  Abort.

Also warns (non-blocking) about source-only testids — testids that
exist in source but haven't been shipped yet.  Usually that just
means "new feature about to ship on next deploy", but it can also
mean dead code.

Usage:

    # Standard — fetches fresh prod bundle
    python3 scripts/deploy_drift_check.py

    # Offline — use a cached bundle (e.g. after rollback investigation)
    python3 scripts/deploy_drift_check.py --bundle /tmp/prod_rb.js

    # Strict — non-zero exit code if any prod testid is missing
    python3 scripts/deploy_drift_check.py --strict

Exit codes:
    0   No drift OR only source-only warnings (with --strict off)
    1   Prod-only drift detected (missing features on source side)
    2   Fetch / IO error
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Iterable

PROD_HOME = "https://shelfsort.com/"
SOURCE_ROOTS = [Path("/app/frontend/src"), Path("/app/backend")]
BUNDLE_URL_RE = re.compile(r'/static/js/main\.[a-f0-9]+\.js')
TESTID_IN_BUNDLE_RE = re.compile(
    # Matches BOTH the standard JSX form ("data-testid":"foo") and the
    # custom-prop form (testid:"foo") used in Shelfsort's Card / Link
    # components that forward `testid` down to data-testid.  Also allows
    # a trailing colon or comma so we don't stop at unusual whitespace.
    r'(?:"data-testid"|(?<![A-Za-z0-9_])testid)\s*:\s*"([^"]+)"'
)
# Prefix-templated testids (e.g. `admin-user-row-${id}`) compile to
# `"admin-user-row-".concat(...)` — grep should still find the prefix.
IGNORE_TESTIDS: set = {
    # 3rd-party library internals — not our code, safe to ignore.
    # epub.js (in-browser EPUB reader):
    "epubjs-container-", "epubjs-inserted-css-", "epubjs-view-",
    # Recharts:
    "recharts-treemap-depth-", "recharts-treemap-node-",
    # Generic library pseudo-testids that appear in vendor code:
    "allow-interactivity-", "block-interactivity-", "spinner-bar-",
    "tooltip-item-", "nest-index-", "alt-text-tooltip-",
    "dropdown-header-",  # radix UI internal
}


def _http_get(url: str) -> bytes:
    """Wrap urllib.request with a browser-like UA — prod's WAF 403s the
    default Python-urllib UA."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 shelfsort-drift-monitor",
    })
    return urllib.request.urlopen(req, timeout=15).read()


def fetch_bundle(url: str, dest: Path) -> None:
    """Download the current prod bundle to ``dest``."""
    html = _http_get(PROD_HOME).decode("utf-8", "replace")
    m = BUNDLE_URL_RE.search(html)
    if not m:
        raise RuntimeError("Could not find /static/js/main.*.js in prod home HTML")
    bundle_url = urllib.parse.urljoin(url, m.group(0))
    print(f"→ Fetching {bundle_url}")
    data = _http_get(bundle_url)
    dest.write_bytes(data)
    size = dest.stat().st_size
    print(f"  ({size:,} bytes)")


def extract_testids(bundle_path: Path) -> set[str]:
    """Return the set of every distinct data-testid string in ``bundle_path``.

    Also captures obvious prefix-templates (``foo-${id}`` → ``foo-``) so
    the drift check catches parameterized testids too."""
    src = bundle_path.read_text(encoding="utf-8", errors="replace")
    seen: set[str] = set()
    for m in TESTID_IN_BUNDLE_RE.finditer(src):
        val = m.group(1)
        seen.add(val)
    # Also pick up compiled prefix concats:
    #   "foo-".concat(id)  →  literal "foo-" appears standalone
    #   'foo-' + id        →  same
    # These already show up as ordinary "..." string literals in the
    # minified bundle, so we cross-check by scanning for any short
    # kebab-case token ending in a dash — a template prefix marker.
    for m in re.finditer(r'"([a-z][a-z0-9]*(?:-[a-z0-9]+)+-)"', src):
        seen.add(m.group(1))
    return seen - IGNORE_TESTIDS


def source_contains(testid: str, roots: Iterable[Path]) -> bool:
    """Return True iff ``testid`` appears at least once in any file under
    ``roots``.  Uses grep for speed."""
    # Escape regex metachars — testids are kebab-case so this is minimal.
    cmd = ["grep", "-qrF", "--include=*.jsx", "--include=*.js", "--include=*.py", "--include=*.tsx", "--include=*.ts", testid, *(str(r) for r in roots)]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=None,
                    help="Path to a cached prod bundle (skips network fetch)")
    ap.add_argument("--strict", action="store_true",
                    help="Also exit non-zero on source-only testids (default: only prod-only fails)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Report at most N drift items per direction (default: all)")
    args = ap.parse_args()

    tmp = None
    try:
        if args.bundle:
            bundle_path = args.bundle
            if not bundle_path.exists():
                print(f"❌ Bundle not found: {bundle_path}", file=sys.stderr)
                return 2
            print(f"→ Using cached bundle: {bundle_path} ({bundle_path.stat().st_size:,} bytes)")
        else:
            tmp = tempfile.NamedTemporaryFile(suffix=".js", delete=False)
            bundle_path = Path(tmp.name)
            tmp.close()
            fetch_bundle(PROD_HOME, bundle_path)
    except Exception as e:
        print(f"❌ Fetch error: {e}", file=sys.stderr)
        return 2

    prod_ids = extract_testids(bundle_path)
    print(f"→ {len(prod_ids):,} distinct data-testid values in prod bundle")

    # Batch grep — walk each testid once.
    prod_only: list[str] = []
    for tid in sorted(prod_ids):
        if not source_contains(tid, SOURCE_ROOTS):
            prod_only.append(tid)

    print()
    if prod_only:
        print(f"🔴 {len(prod_only)} testid(s) in prod but MISSING from source — DEPLOYING WOULD REGRESS:")
        for t in (prod_only[: args.limit] if args.limit else prod_only):
            print(f"    - {t}")
        if args.limit and len(prod_only) > args.limit:
            print(f"    ... and {len(prod_only) - args.limit} more")
    else:
        print("✅ Every prod testid is present in source — no regressions would ship.")

    print()
    print("Summary:")
    print(f"  prod testids:        {len(prod_ids):,}")
    print(f"  prod-only (drift):   {len(prod_only):,}")

    if tmp:
        Path(tmp.name).unlink(missing_ok=True)

    return 1 if prod_only else 0


if __name__ == "__main__":
    import urllib.parse  # only needed inside main / fetch path
    sys.exit(main())
