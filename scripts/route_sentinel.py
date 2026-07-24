"""Route Test Sentinel (iter 95 rebuild).

Walks every frontend source file, extracts every internal navigation
target (React Router ``<Link to>``, ``navigate()``, ``window.location.href``,
``<Navigate to=>`` etc.), and validates that each destination matches at
least one route declared in ``frontend/src/App.js``.

Motivation
==========
Iter 92/93 shipped with a plural/singular typo — ``window.location.href
= /books/${id}`` had one extra ``s``.  Since ``App.js`` only registers
``/book/:id`` (singular), React Router's catch-all ``path="*" → Navigate
to="/"`` silently bounced every book click on production back to the
landing page.  This sentinel catches that exact failure mode at build
time.

Usage
=====
    python3 /app/scripts/route_sentinel.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

FRONTEND_ROOT = Path("/app/frontend/src")
APP_FILE      = FRONTEND_ROOT / "App.js"

SKIP_DIRS = {"node_modules", "build", "dist", "__snapshots__"}
ROUTE_DECL_RE = re.compile(r'<Route\s+path="([^"]+)"')

EXTRACT_RULES = [
    ("<Link to=\"...\">",              re.compile(r'\bto="((?:/|#)[^"]*)"')),
    ("<Link to={`...`}>",              re.compile(r"\bto=\{`((?:/|#)[^`]*)`\}")),
    ("navigate(\"/...\")",             re.compile(r"\bnavigate\(\s*\"((?:/|#)[^\"]*)\"")),
    ("navigate(`/...`)",               re.compile(r"\bnavigate\(\s*`((?:/|#)[^`]*)`")),
    ("navigate('/...')",               re.compile(r"\bnavigate\(\s*'((?:/|#)[^']*)'")),
    ("window.location.href = \"/...\"", re.compile(r"window\.location\.href\s*=\s*\"((?:/|#)[^\"]*)\"")),
    ("window.location.href = `/...`",   re.compile(r"window\.location\.href\s*=\s*`((?:/|#)[^`]*)`")),
    ("window.location.href = '/...'",   re.compile(r"window\.location\.href\s*=\s*'((?:/|#)[^']*)'")),
    ("window.location = \"/...\"",     re.compile(r"window\.location\s*=\s*\"((?:/|#)[^\"]*)\"")),
    ("<Navigate to=\"/...\">",         re.compile(r'<Navigate\s+to="((?:/|#)[^"]+)"')),
    ("<Navigate to={`/...`}>",         re.compile(r"<Navigate\s+to=\{`((?:/|#)[^`]+)`\}")),
    ("Redirect to=\"/...\"",           re.compile(r'<Redirect\s+to="((?:/|#)[^"]+)"')),
]

IGNORE_PATH_RE = re.compile(r"^(#|/api/|/opds|/uploads/|/static/|/favicon|/assets/|/manifest)")


def collect_routes() -> list[str]:
    if not APP_FILE.exists():
        raise SystemExit(f"App.js not found at {APP_FILE}")
    text = APP_FILE.read_text(encoding="utf-8")
    return ROUTE_DECL_RE.findall(text)


def _normalise(path: str) -> str:
    p = path.split("?", 1)[0].split("#", 1)[0]
    p = re.sub(r"\$\{[^}]+\}", ":PARAM", p)
    p = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", ":PARAM", p)
    p = re.sub(r"/+", "/", p)
    return p.rstrip("/") or "/"


def route_matches(source_path: str, route_patterns: Iterable[str]) -> bool:
    norm_src = _normalise(source_path)
    for pattern in route_patterns:
        norm_pat = _normalise(pattern)
        if norm_pat == norm_src:
            return True
        if pattern.endswith("*"):
            base = _normalise(pattern[:-1])
            if norm_src == base or norm_src.startswith(base + "/"):
                return True
    return False


def scan_source_files() -> list[tuple[Path, int, str, str]]:
    hits: list[tuple[Path, int, str, str]] = []
    for jsx_file in FRONTEND_ROOT.rglob("*"):
        if not jsx_file.is_file():
            continue
        if jsx_file.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        if any(part in SKIP_DIRS for part in jsx_file.parts):
            continue
        rel = jsx_file.relative_to(FRONTEND_ROOT)
        try:
            text = jsx_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for idx, line in enumerate(text.splitlines(), start=1):
            for label, rx in EXTRACT_RULES:
                for m in rx.finditer(line):
                    path = m.group(1)
                    if not path or IGNORE_PATH_RE.match(path):
                        continue
                    hits.append((rel, idx, label, path))
    return hits


def main() -> int:
    routes = collect_routes()
    if not routes:
        print("no routes found in App.js", file=sys.stderr)
        return 2
    hits = scan_source_files()
    bad: list[tuple[Path, int, str, str]] = []
    for hit in hits:
        rel, line_no, label, path = hit
        if not route_matches(path, routes):
            bad.append(hit)

    print(f"Route sentinel — {len(routes)} routes, {len(hits)} internal refs scanned")
    if not bad:
        print("PASS — every internal href / to / navigate target maps to a registered route.")
        return 0
    print(f"FAIL — {len(bad)} internal reference(s) do NOT match any registered route:\n")
    for rel, line_no, label, path in bad:
        print(f"  {rel}:{line_no}  [{label}]  → {path!r}")
    print("\nHint: check App.js for the route you meant, or add the missing <Route path=… />.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
