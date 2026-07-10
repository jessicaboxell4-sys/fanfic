"""Regression test: every NEW interactive JSX element must carry a
``data-testid`` so the testing-agent can drive the UI reliably.

Scans ``frontend/src/{components,pages}/*.jsx`` for opening tags of
``<button``, ``<Button``, ``<input``, ``<Input``, ``<select``,
``<Select``, ``<textarea``, ``<Textarea``.  For each opener it walks
forward to the matching ``>`` (or self-closing ``/>``) and checks
whether ``data-testid="..."`` appears inside.

Fails if a NEW file (not in ``BASELINE_ALLOWLIST``) lands with at
least one interactive element missing a ``data-testid``.

The baseline allowlist captures the existing tech debt — files that
already have untestid'd interactive elements at the time this test
was added (2026-06-20).  Editing any of those files is fine; the
goal of the guard is purely "new component authors notice the
convention" not "boil the ocean of every legacy button".

Tradeoffs of the baseline approach (documented for the next agent):

* Adding a *new* untestid'd button inside an *already-baselined* file
  is NOT caught.  Acceptable: the testing-agent already covers those
  files end-to-end; the goal here is to keep brand-new pages/components
  from regressing.
* Removing all untestid'd buttons from a baselined file means it
  should be removed from the allowlist — the companion test enforces
  that the allowlist stays honest.
"""
import re
from pathlib import Path

FRONTEND_ROOT = Path("/app/frontend/src")
SCAN_DIRS = ["components", "pages"]

# Opening-tag start of an interactive element.  We deliberately list
# both the lowercase native HTML form and the capitalized shadcn/UI
# wrapper, since the codebase uses both interchangeably.
_INTERACTIVE = (
    r"<(?:button|Button|input|Input|select|Select|textarea|Textarea)\b"
)
_OPENER_RE = re.compile(_INTERACTIVE)
_TESTID_RE = re.compile(r'data-testid\s*=\s*["{`]')


def _scan_one(path: Path) -> int:
    """Count interactive openings in ``path`` that have no
    ``data-testid`` attribute on the same element.

    The walker handles JSX expression braces (``{...}``), so a
    ``data-testid={var}`` on a multi-line element is still detected.
    """
    try:
        src = path.read_text(encoding="utf-8")
    except OSError:
        return 0
    misses = 0
    for m in _OPENER_RE.finditer(src):
        # Walk forward until the matching ``>`` that closes THIS
        # opening tag, tracking JSX expression braces so nested
        # objects/expressions don't trick us into stopping early.
        i = m.end()
        depth = 0
        end = len(src)
        while i < end:
            ch = src[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                if depth > 0:
                    depth -= 1
            elif ch == ">" and depth == 0:
                break
            i += 1
        body = src[m.start() : i + 1]
        if not _TESTID_RE.search(body):
            misses += 1
    return misses


def _scan_all() -> dict[str, int]:
    """Return ``{relpath: untestid_count}`` for every scanned file
    that has at least one miss."""
    out: dict[str, int] = {}
    for d in SCAN_DIRS:
        for path in (FRONTEND_ROOT / d).rglob("*.jsx"):
            n = _scan_one(path)
            if n > 0:
                out[str(path.relative_to(FRONTEND_ROOT))] = n
    return out


# Baseline allowlist as of 2026-06-20.  This snapshot was generated
# by running the scanner on a clean checkout — every file listed
# below had at least one untestid'd interactive element at that
# moment.  New files (additions to ``components/`` or ``pages/``)
# must NOT introduce new untestid'd interactive elements.
BASELINE_ALLOWLIST: set[str] = {
    # Snapshot taken 2026-06-20 via:
    #   python3 -c "from tests.test_data_testid_guard import _scan_all;
    #               print(sorted(_scan_all().keys()))"
    # 42 files, 74 total untestid'd interactive elements at snapshot time.
    "components/AccountDropdown.jsx",
    "components/Ao3FilterChips.jsx",
    "components/CatalogSyncCard.jsx",
    "components/ConsentBanner.jsx",
    "components/DmDrawer.jsx",
    "components/LibraryActivityWidgets.jsx",
    "components/NotificationsBell.jsx",
    "components/PrimaryCTAButton.jsx",
    "components/SecondaryCTAButton.jsx",
    "components/SelectionBar.jsx",
    "components/SuggestionBox.jsx",
    "components/TourOverlay.jsx",
    "components/YearInBooksWrapped.jsx",
    "components/ui/carousel.jsx",
    "components/ui/input.jsx",
    "components/ui/textarea.jsx",
    "pages/Account.jsx",
    "pages/AdminConsole.jsx",
    "pages/AllBooksPage.jsx",
    "pages/AuthorsPage.jsx",
    "pages/BookDetail.jsx",
    "pages/BookmarksPage.jsx",
    "pages/CantFindOnline.jsx",
    "pages/DownloadPage.jsx",
    "pages/EmailPreferences.jsx",
    "pages/FriendsPage.jsx",
    "pages/GoalsPage.jsx",
    "pages/LinklessShelf.jsx",
    "pages/Login.jsx",
    "pages/MessagesPage.jsx",
    "pages/ModInbox.jsx",
    "pages/PairingsPage.jsx",
    "pages/PolishCoversPage.jsx",
    "pages/Reader.jsx",
    "pages/ReadingQueuePage.jsx",
    "pages/SmartShelfPage.jsx",
    "pages/SmartShelves.jsx",
    "pages/StatusShelves.jsx",
    "pages/SuggestionsPage.jsx",
    "pages/UnreadableShelf.jsx",
    "pages/YearInBooksPage.jsx",
    "pages/bookclubs/RoomDialogs.jsx",
}


def test_no_new_untestid_interactive_element():
    misses = _scan_all()
    new_offenders = {f: n for f, n in misses.items() if f not in BASELINE_ALLOWLIST}
    if new_offenders:
        lines = [
            "Found NEW files with interactive elements missing data-testid:",
            "",
        ]
        for f, n in sorted(new_offenders.items()):
            lines.append(f"  {f}: {n} interactive element(s) missing data-testid")
        lines += [
            "",
            "Add `data-testid=\"...\"` to every <button>, <input>, <select>,",
            "<textarea> (and their shadcn capitalized variants) in NEW files.",
            "Use kebab-case describing what the element does, e.g.",
            '  <Button data-testid="submit-feedback-btn">Submit</Button>',
            "",
            "If a brand-new file legitimately wraps an already-tested",
            "interactive primitive and adding data-testid would be noise,",
            "add the file to BASELINE_ALLOWLIST in this test with a brief",
            "comment explaining why.",
        ]
        raise AssertionError("\n".join(lines))


def test_baseline_still_has_violations():
    """If a baselined file no longer has any untestid'd interactive
    elements, it should be removed from the allowlist so a future
    regression is caught.  Keeps the allowlist honest."""
    misses = _scan_all()
    stale = BASELINE_ALLOWLIST - set(misses.keys())
    assert not stale, (
        f"BASELINE_ALLOWLIST contains files that no longer have "
        f"untestid'd interactive elements: {sorted(stale)}.  "
        f"Remove them from the allowlist to lock in the fix."
    )
