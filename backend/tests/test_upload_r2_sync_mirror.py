"""Static-analysis guard for the synchronous upload → R2 mirror
(2026-06-21).

Pre-fix bug (production data, 2026-06-21):
  ``/admin/storage-migration-progress`` reported 18% (12 of 65) of
  books actually existed in R2.  Cause: ``routes/books.py::upload_books``
  wrote new uploads to local disk only, relying on the every-10-min
  storage backfill cron to push them to R2.  Pod restarts within that
  window (idle scale-down, redeploys, OOM kill) destroyed the local
  bytes before the cron tick, **permanently losing the user's books.**

Fix (same date): upload_books now synchronously mirrors every freshly
written file (EPUB + original-format source + cover) to R2 via
``mirror_up`` before returning success.  This makes local disk a cache
and R2 the source of truth.

If anyone removes that synchronous mirror — restoring the pre-fix
"cron-only" model — this guard fails CI loudly.
"""
from pathlib import Path

BOOKS_PY = Path(__file__).resolve().parent.parent / "routes" / "books.py"


def test_upload_books_calls_mirror_up_synchronously():
    text = BOOKS_PY.read_text(encoding="utf-8")
    # The fix imports mirror_up under an alias inside upload_books.  The
    # exact alias is part of the contract — if someone rewrites without
    # it, the regression test should fail.
    assert "mirror_up as _r2_mirror_up" in text, (
        "routes/books.py::upload_books must synchronously mirror "
        "freshly-written files to R2 via utils.storage_cloud.mirror_up "
        "before returning success.  Reverting to a cron-only model "
        "exposes users to permanent data loss on pod restart — see "
        "2026-06-21 incident (18% R2 coverage / 53 lost books)."
    )


def test_upload_books_mirrors_epub_original_and_cover():
    """All three asset types must be mirrored: the EPUB itself, the
    original-format source (for PDF/MOBI conversions), and the cover
    image.  Missing any one of these means partial recovery on next
    restore.
    """
    text = BOOKS_PY.read_text(encoding="utf-8")
    # The mirror loop checks for three file extensions explicitly.
    for needle in ['f"{bid}.epub"', 'f"{bid}.cover"', "_r2_key(user.user_id, bid"]:
        assert needle in text, (
            f"upload_books mirror loop is missing expected target: {needle}. "
            "If this was intentional, update the test docstring with why."
        )
