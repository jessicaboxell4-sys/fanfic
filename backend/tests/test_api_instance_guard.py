"""Regression test: every backend API call must go through the
shared ``api`` axios instance (``import { api } from "@/lib/api"``)
so cookies (``withCredentials: true``) and the base-URL config stay
consistent.

Direct violations we want to catch in NEW code:

* ``import axios from "axios"`` followed by ``axios.get`` /
  ``axios.post`` / etc.  → use ``api.get`` / ``api.post`` instead.
* ``fetch("/api/...")`` or ``fetch(\`${REACT_APP_BACKEND_URL}/api/...`)``
  → use ``api.get`` etc. instead, which carries the session cookie.

We deliberately do NOT flag plain template-literal URLs like
``\`${REACT_APP_BACKEND_URL}/api/books/${id}/cover\``` because those
are overwhelmingly legitimate ``<img src=>``, ``<a href=>``,
``EventSource(...)``, ``window.open(...)``, or shareable-URL string
builders — the browser fetches those resources directly and they do
not need (and would actively break with) an axios interceptor.

Scope: ``frontend/src/**/*.{js,jsx}`` except ``lib/api.js`` itself.
Baseline allowlist captures known-legacy files.  New files that
introduce direct ``axios.X`` or ``fetch("/api/...")`` calls will
fail this test.
"""
import re
from pathlib import Path

FRONTEND_ROOT = Path("/app/frontend/src")
EXCLUDED_FILES = {
    "lib/api.js",  # The one place axios is allowed
}

# ``axios.<method>(`` — direct method call on the imported axios.
# Includes axios.get/post/put/delete/patch/request/head/options.
_AXIOS_DIRECT_RE = re.compile(
    r"\baxios\s*\.\s*(?:get|post|put|delete|patch|request|head|options)\s*\("
)
# ``fetch("/api/..."`` or ``fetch(`...${REACT_APP_BACKEND_URL}.../api/..."``)
_FETCH_API_RE = re.compile(
    r"""\bfetch\s*\(\s*       # fetch(
        (?:                   # one of:
            ["']/api/         #   "/api/..."
          |
            [`"']             #   string-start of a template/literal
            [^`"')]*          #   any non-quote, non-close-paren
            /api/             #   ... /api/
        )
    """,
    re.VERBOSE,
)


def _scan_all() -> dict[str, list[tuple[int, str]]]:
    """Return ``{relpath: [(line_no, line, kind), ...]}`` for every
    file with at least one violation.

    ``kind`` is the regex name so the error message can be precise."""
    out: dict[str, list[tuple[int, str]]] = {}
    for path in FRONTEND_ROOT.rglob("*.js"):
        rel = str(path.relative_to(FRONTEND_ROOT))
        if rel in EXCLUDED_FILES:
            continue
        _scan_file(path, rel, out)
    for path in FRONTEND_ROOT.rglob("*.jsx"):
        rel = str(path.relative_to(FRONTEND_ROOT))
        if rel in EXCLUDED_FILES:
            continue
        _scan_file(path, rel, out)
    return out


def _scan_file(path: Path, rel: str, out: dict) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    hits: list[tuple[int, str]] = []
    for i, line in enumerate(lines, start=1):
        if _AXIOS_DIRECT_RE.search(line):
            hits.append((i, line.strip()[:140]))
        elif _FETCH_API_RE.search(line):
            hits.append((i, line.strip()[:140]))
    if hits:
        out[rel] = hits


# Baseline as of 2026-06-20.  Populated by running ``_scan_all()``
# once on a clean tree.  See the snapshot comment in
# test_data_testid_guard.py for the workflow.
BASELINE_ALLOWLIST: set[str] = {
    # Snapshot taken 2026-06-20.  Both files use `axios.get` against
    # the API directly:
    #   pages/Help.jsx        — announcements/latest + fandoms/known
    #   pages/PublicYearInBooks.jsx — public/year/{token} (unauth, no cookie needed)
    # New files must NOT add to this list — use `api.get(...)` instead.
    "pages/Help.jsx",
    "pages/PublicYearInBooks.jsx",
}


def test_no_new_direct_axios_or_fetch_api_call():
    misses = _scan_all()
    new_offenders = {f: hits for f, hits in misses.items() if f not in BASELINE_ALLOWLIST}
    if new_offenders:
        lines = [
            "Found NEW files calling axios.* or fetch('/api/...') directly:",
            "",
        ]
        for f, hits in sorted(new_offenders.items()):
            lines.append(f"  {f}")
            for ln, src in hits:
                lines.append(f"    L{ln}: {src}")
        lines += [
            "",
            'Use the shared `api` instance instead:',
            '    import { api } from "@/lib/api";',
            '    const { data } = await api.get("/books");  // baseURL + cookies handled',
            "",
            "If a brand-new file legitimately needs a raw fetch (e.g. streaming",
            "EventSource setup that axios can't model), add it to",
            "BASELINE_ALLOWLIST in this test with a short comment.",
        ]
        raise AssertionError("\n".join(lines))


def test_api_guard_baseline_still_has_violations():
    misses = _scan_all()
    stale = BASELINE_ALLOWLIST - set(misses.keys())
    assert not stale, (
        f"BASELINE_ALLOWLIST contains files that no longer call axios/fetch "
        f"directly: {sorted(stale)}.  Remove them from the allowlist."
    )
