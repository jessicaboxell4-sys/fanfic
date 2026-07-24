#!/usr/bin/env python3
"""Bundle-size regression check.

Fetches the current production JS bundle from ``shelfsort.com`` and
compares its size against a locally-stored baseline
(``/app/memory/bundle_size_baseline.txt``).  Warns loudly if the
current bundle has grown by more than ``THRESHOLD_PCT`` (10 %) so
we notice ballooning deps or accidental import-of-everything before
the users do.

Also updates the baseline on demand (``--update-baseline``) so a
legitimate feature jump can be blessed.

Usage:
    python3 scripts/check_bundle_size.py               # compare
    python3 scripts/check_bundle_size.py --update-baseline
    python3 scripts/check_bundle_size.py --url https://…    # override
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from pathlib import Path

BASELINE_PATH = Path("/app/memory/bundle_size_baseline.txt")
DEFAULT_URL = "https://shelfsort.com/"
THRESHOLD_PCT = 10.0


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "shelfsort-deploy-check/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def find_bundle_url(base_url: str) -> str:
    html = fetch(base_url).decode("utf-8", errors="replace")
    m = re.search(r"/static/js/(main\.[a-f0-9]+\.js)", html)
    if not m:
        raise SystemExit("Could not find main.<hash>.js in index.html — is the site up?")
    origin = base_url.rstrip("/")
    return f"{origin}/static/js/{m.group(1)}"


def bundle_size(url: str) -> tuple[str, int]:
    bundle_url = find_bundle_url(url)
    return bundle_url, len(fetch(bundle_url))


def read_baseline() -> tuple[str | None, int | None]:
    if not BASELINE_PATH.exists():
        return None, None
    for line in BASELINE_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            try:
                return parts[0], int(parts[1])
            except ValueError:
                continue
    return None, None


def write_baseline(bundle: str, size: int) -> None:
    BASELINE_PATH.write_text(
        "# Baseline bundle size for shelfsort.com production main.<hash>.js\n"
        "# <bundle_name>  <bytes>  <updated_by>\n"
        f"{bundle.split('/')[-1]}  {size}  scripts/check_bundle_size.py\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--threshold", type=float, default=THRESHOLD_PCT)
    args = ap.parse_args()

    bundle_url, size = bundle_size(args.url)
    print(f"Current bundle: {bundle_url.split('/')[-1]}  ({size:,} bytes)")

    if args.update_baseline:
        write_baseline(bundle_url, size)
        print(f"✓ Baseline updated to {size:,} bytes.")
        return 0

    baseline_name, baseline_size = read_baseline()
    if baseline_size is None:
        print("⚠ No baseline recorded — writing initial baseline.")
        write_baseline(bundle_url, size)
        return 0

    delta_bytes = size - baseline_size
    delta_pct = (delta_bytes / baseline_size) * 100.0 if baseline_size else 0
    print(f"Baseline:       {baseline_name}  ({baseline_size:,} bytes)")
    sign = "+" if delta_bytes >= 0 else ""
    print(f"Delta:          {sign}{delta_bytes:,} bytes ({sign}{delta_pct:.2f} %)")

    if delta_pct > args.threshold:
        print(f"\n✗ Bundle grew more than {args.threshold:.1f} % — investigate before deploy.")
        print("  If this growth is expected (new feature area), run:")
        print("    python3 scripts/check_bundle_size.py --update-baseline")
        return 1
    if delta_pct < -args.threshold:
        print(f"\n⚠ Bundle shrank {abs(delta_pct):.2f} % — nice! Consider re-baselining.")
        return 0
    print(f"\n✓ Bundle size within ±{args.threshold:.1f} % of baseline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
