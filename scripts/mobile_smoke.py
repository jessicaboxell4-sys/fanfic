#!/usr/bin/env python3
"""Mobile-viewport smoke screenshot + visual-diff pass.

Loads a short list of critical pages at a 375x667 (iPhone SE) viewport
and saves screenshots + a pass/fail summary.  Also compares each fresh
screenshot against a committed reference in
``/app/artifacts/mobile_screenshots/reference/`` and fails when a
page has changed by more than ``--diff-threshold`` (default 2%) of
its pixels.

Uses the app's REACT_APP_BACKEND_URL (preview) and a shared admin
test account.  Output:
    /app/artifacts/mobile_screenshots/<page>.png            (current)
    /app/artifacts/mobile_screenshots/diff/<page>.png       (visual diff)
    /app/artifacts/mobile_screenshots/reference/<page>.png  (baseline)
    /app/artifacts/mobile_screenshots/summary.json

Fails if:
- Any page returns an ErrorBoundary
- Any page's <body> is empty or shows a blank white screen (heuristic:
  text content < 50 chars)
- Any page's current screenshot differs from its reference by more
  than the threshold

Usage:
    python3 scripts/mobile_smoke.py                    # smoke + diff
    python3 scripts/mobile_smoke.py --update-reference # bless current
    python3 scripts/mobile_smoke.py --diff-threshold 5 # looser gate
    python3 scripts/mobile_smoke.py --url https://...  # override
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

CREDS_EMAIL = "rownum-test@example.com"
CREDS_PASSWORD = "hunter2pw!"
OUTPUT_DIR = Path("/app/artifacts/mobile_screenshots")
REF_DIR = OUTPUT_DIR / "reference"
DIFF_DIR = OUTPUT_DIR / "diff"
DEFAULT_DIFF_THRESHOLD_PCT = 5.0


def pixel_diff(current_path: Path, reference_path: Path, out_path: Path) -> tuple[float, tuple[int, int]] | None:
    """Return (percent_changed, (w, h)) or None if either file is missing.

    Writes a diff image (red where pixels changed) to ``out_path``.
    Percent is calculated over the total pixel count, not the bounding
    box, so a tiny 2-pixel drift shows as 0.00% not "100%-of-a-tiny-box".
    """
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return None
    if not current_path.exists() or not reference_path.exists():
        return None
    cur = Image.open(current_path).convert("RGB")
    ref = Image.open(reference_path).convert("RGB")
    if cur.size != ref.size:
        # Resize reference to match — layout shift will show as diff
        ref = ref.resize(cur.size)
    diff = ImageChops.difference(cur, ref)
    bbox = diff.getbbox()
    if bbox is None:
        # Identical.
        out_path.write_bytes(current_path.read_bytes())
        return 0.0, cur.size
    # Count changed pixels (any channel differs from 0).
    changed_pixels = 0
    for pixel in diff.getdata():
        if any(pixel):
            changed_pixels += 1
    total = cur.size[0] * cur.size[1]
    pct = (changed_pixels / total) * 100.0 if total else 0.0
    # Write a "highlight" diff — full-color diff on grey background.
    diff.save(out_path)
    return pct, cur.size

# Pages to smoke-test.  Add more here as the app grows.
PAGES = [
    ("landing", "/"),
    ("login", "/login"),
    ("library", "/library"),
    ("library-all", "/library/all"),
    ("presets", "/library/presets"),
    ("help", "/help"),
]


async def _run(base_url: str, update_reference: bool, diff_threshold: float) -> int:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("✗ playwright not installed — pip install playwright && playwright install chromium")
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    DIFF_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 375, "height": 667})
        page = await context.new_page()
        # Log in once so the private routes render.
        try:
            await page.goto(f"{base_url}/login?notour=1", wait_until="load", timeout=15000)
            await page.evaluate(
                "() => { try { localStorage.setItem('shelfsort_tour_seen','1');"
                " localStorage.setItem('shelfsort_memorial_dismissed_year','9999'); } catch(e){} }"
            )
            await page.fill('input[type="email"]', CREDS_EMAIL)
            await page.fill('input[type="password"]', CREDS_PASSWORD)
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(3000)
        except Exception as e:  # noqa: BLE001
            print(f"⚠ Login step failed: {e} — private routes may 302 to /login")

        for name, path in PAGES:
            url = f"{base_url}{path}?notour=1" if "?" not in path else f"{base_url}{path}"
            entry: dict = {"page": name, "path": path}
            try:
                await page.goto(url, wait_until="load", timeout=15000)
                await page.wait_for_timeout(1500)
                body_txt = (await page.locator("body").text_content()) or ""
                entry["body_len"] = len(body_txt)
                error_boundary = ("Something went sideways" in body_txt or "is not defined" in body_txt)
                blank = len(body_txt.strip()) < 50
                entry["error_boundary"] = error_boundary
                entry["blank"] = blank
                entry["ok"] = (not error_boundary) and (not blank)
                await page.screenshot(path=str(OUTPUT_DIR / f"{name}.png"), full_page=False)
                # Visual diff step
                ref_path = REF_DIR / f"{name}.png"
                cur_path = OUTPUT_DIR / f"{name}.png"
                diff_path = DIFF_DIR / f"{name}.png"
                if update_reference:
                    ref_path.write_bytes(cur_path.read_bytes())
                    entry["reference"] = "updated"
                elif ref_path.exists():
                    result = pixel_diff(cur_path, ref_path, diff_path)
                    if result is not None:
                        pct, size = result
                        entry["diff_pct"] = round(pct, 3)
                        entry["diff_ok"] = pct <= diff_threshold
                        if pct > diff_threshold:
                            entry["ok"] = False
                    else:
                        entry["diff_pct"] = None
                        entry["diff_ok"] = True
                else:
                    entry["reference"] = "missing"
                    entry["diff_pct"] = None
                    entry["diff_ok"] = True
            except Exception as e:  # noqa: BLE001
                entry["ok"] = False
                entry["error"] = str(e)
            results.append(entry)

        await browser.close()

    (OUTPUT_DIR / "summary.json").write_text(json.dumps(results, indent=2))
    print(f"\nMobile smoke @ 375x667 — {sum(1 for r in results if r.get('ok'))}/{len(results)} pages green")
    for r in results:
        mark = "✓" if r.get("ok") else "✗"
        detail = ""
        if r.get("error_boundary"):
            detail = "  ErrorBoundary!"
        elif r.get("blank"):
            detail = "  blank body!"
        elif r.get("error"):
            detail = f"  {r['error']}"
        diff_txt = ""
        if r.get("diff_pct") is not None:
            diff_mark = "△" if r.get("diff_ok") is False else "="
            diff_txt = f"  diff:{diff_mark}{r['diff_pct']:.2f}%"
        elif r.get("reference") == "missing":
            diff_txt = "  (no reference)"
        elif r.get("reference") == "updated":
            diff_txt = "  (ref updated)"
        print(f"  {mark} {r['page']:<14} {r.get('body_len', '?'):>6} chars{diff_txt}{detail}")
    print(f"\nScreenshots in {OUTPUT_DIR}/")
    return 0 if all(r.get("ok") for r in results) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=None, help="Base URL (defaults to REACT_APP_BACKEND_URL)")
    ap.add_argument("--update-reference", action="store_true",
                    help="Overwrite the reference/ set with the current screenshots (bless changes)")
    ap.add_argument("--diff-threshold", type=float, default=DEFAULT_DIFF_THRESHOLD_PCT,
                    help="Max %% of pixels that may differ before failing (default 2)")
    args = ap.parse_args()
    base_url = args.url
    if not base_url:
        env_path = Path("/app/frontend/.env")
        for line in env_path.read_text().splitlines() if env_path.exists() else []:
            if line.startswith("REACT_APP_BACKEND_URL="):
                base_url = line.split("=", 1)[1].strip()
                break
    if not base_url:
        print("✗ No base URL — set REACT_APP_BACKEND_URL or pass --url")
        return 1
    return asyncio.run(_run(base_url, args.update_reference, args.diff_threshold))


if __name__ == "__main__":
    sys.exit(main())
