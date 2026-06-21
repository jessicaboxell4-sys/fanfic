"""Static-analysis guard for the R2-aware ZIP export (2026-06-21).

Pre-fix bug (user screenshot, Jun 21 2026):
  After the Phase-4 R2 migration, every user's books live in R2 and
  ``STORAGE_DIR`` is empty on disk.  The ZIP export's bucketing loop
  used a bare ``if not fp.exists(): continue`` which silently skipped
  every single book, and the resulting ZIP contained ONLY
  ``library_index.xlsx`` and ``README.txt``.

This guard fails CI loudly if anyone reverts the fix.
"""
from pathlib import Path

EXPORTS = (
    Path(__file__).resolve().parent.parent / "routes" / "exports.py"
)


def test_zip_export_uses_r2_restore_helper():
    text = EXPORTS.read_text(encoding="utf-8")
    assert "ensure_local_cached" in text, (
        "routes/exports.py must call utils.storage_cloud.ensure_local_cached "
        "to pull EPUBs from R2 on local-disk miss.  Without it, every user "
        "whose books were migrated off local disk will receive a ZIP "
        "containing only library_index.xlsx + README.txt — the exact bug "
        "the user reported on Jun 21 2026."
    )


def test_zip_export_does_not_silently_skip_missing_files():
    """The pre-fix code had a bare ``if not fp.exists(): continue`` that
    skipped books without trying R2.  Make sure that pattern doesn't
    creep back in.
    """
    text = EXPORTS.read_text(encoding="utf-8")
    # The fix wraps the missing-file branch with an ``ensure_local_cached``
    # call and tracks ``skipped_books``.  If both markers are gone, we've
    # almost certainly regressed.
    assert "skipped_books" in text, (
        "routes/exports.py must track ``skipped_books`` so unrestorable "
        "books surface in logs instead of disappearing silently."
    )
