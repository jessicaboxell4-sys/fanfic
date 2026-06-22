"""Tests for the user-friendly Calibre error mapper (2026-06-23).

Calibre's ebook-convert returns precise but intimidating Python
stack traces on failure.  We map those to a single calm sentence
for the end-user's library description.  These tests pin the
mapping so a future agent doesn't accidentally regress the friendly
copy on a refactor.
"""
from __future__ import annotations

import os
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


JESSICA_LIVE_ERROR = (
    "ebook-convert failed (rc=1): t(xml, self.opts, self.log) "
    "~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ "
    'File "/usr/lib/calibre/calibre/ebooks/pdf/reflow.py", line 1477, '
    "in __init__\n    self.find_header_footer()\n    "
    "~~~~~~~~~~~~~~~~~~~~~~~~^^\n  "
    'File "/usr/lib/calibre/calibre/ebooks/pdf/reflow.py", line 1878, '
    "in find_header_footer\n    if self.pages[head_page].texts \\\n       "
    "~~~~~~~~~~~~~~~~~~~~~^^^^^^^\nIndexError: list index out of range"
)


def test_index_error_in_reflow_mapped_to_layout_message():
    """The exact stderr the operator hit on launch day (an HP-fic PDF
    with a quirky layout) → friendly layout-parsing message."""
    from routes.books import _friendly_calibre_error
    msg = _friendly_calibre_error(JESSICA_LIVE_ERROR)
    assert "PDF's layout couldn't be auto-parsed" in msg
    # Make sure we don't leak any stack-trace artefacts.
    assert "IndexError" not in msg
    assert "reflow.py" not in msg
    assert "^^^" not in msg
    assert "self.pages" not in msg


@pytest.mark.parametrize("stderr_blob, expected_phrase", [
    ("MemoryError: out of memory",
     "too large for our server"),
    ("DRMError: this file is protected",
     "DRM-protected"),
    ("This PDF is encrypted with a user password",
     "password-protected"),
    ("File header: not a valid PDF document",
     "doesn't look like a valid PDF"),
    ("ERROR: Bad encrypt dict in PDF",
     "corrupted or non-standard"),
    ("Warning: no text found on any page; cannot reflow",
     "image-only"),
])
def test_known_error_patterns_map_to_friendly_lines(stderr_blob, expected_phrase):
    from routes.books import _friendly_calibre_error
    msg = _friendly_calibre_error(stderr_blob)
    assert expected_phrase in msg, f"expected '{expected_phrase}' in '{msg}'"


def test_unknown_pattern_falls_back_to_generic():
    """A stderr blob we've never seen → friendly generic line.
    Critically, the raw stderr text MUST NOT leak through."""
    from routes.books import _friendly_calibre_error
    weird = "SomeNewError: weird thing nobody has seen before\nFile foo.py:99"
    msg = _friendly_calibre_error(weird)
    assert "friendly explanation" in msg
    # No raw stderr leakage
    assert "SomeNewError" not in msg
    assert "foo.py" not in msg


def test_empty_stderr_falls_back_to_generic():
    from routes.books import _friendly_calibre_error
    assert "friendly explanation" in _friendly_calibre_error("")
    assert "friendly explanation" in _friendly_calibre_error(None)  # type: ignore[arg-type]


def test_messages_are_short_single_sentence():
    """Friendly messages should fit comfortably in a library card —
    no message longer than 200 chars, no embedded newlines."""
    from routes.books import _CALIBRE_FRIENDLY_ERRORS
    for needle1, needle2, friendly in _CALIBRE_FRIENDLY_ERRORS:
        assert len(friendly) < 200, f"too long: {friendly}"
        assert "\n" not in friendly
        assert friendly.strip() == friendly
