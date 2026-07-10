"""Concurrency-cap regression test for the Calibre conversion path.

The production pod has only ~400 MB of memory headroom after clamd's
persistent footprint (per Emergent Support 2026-06-21).  Each
``ebook-convert`` invocation transiently uses 200-400 MB, so without a
semaphore cap a single user dragging in a folder of MOBI files could
OOM-kill the entire pod.  Capping concurrency to 2 (in ``books.py::
convert_to_epub``) keeps peak memory inside the budget while still
letting two users convert in parallel.
"""
import asyncio
import os
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from routes import books as books_mod  # noqa: E402
from utils.feature_flags import set_flag, _invalidate_cache  # noqa: E402


def test_calibre_concurrency_cap_is_2(shared_event_loop):
    """Fire 10 simulated conversions in parallel and assert the
    semaphore caps in-flight to 2 at any moment.
    """
    shared_event_loop.run_until_complete(set_flag("calibre_convert_enabled", True))
    _invalidate_cache()

    in_flight = 0
    peak = 0

    def _fake_sync(src, dst):
        # Stand in for ebook-convert.  Sleeps long enough to actually
        # contend on the semaphore.  Tracks peak concurrency by reading
        # the module-level counter under the executor's GIL-bound thread.
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        import time as _t
        _t.sleep(0.05)
        in_flight -= 1
        return None

    async def _main():
        # Fresh semaphore bound to *this* event loop.
        books_mod._calibre_sem = None
        with patch.object(books_mod, "_convert_to_epub_sync", side_effect=_fake_sync):
            results = await asyncio.gather(*[
                books_mod.convert_to_epub(
                    Path(f"/tmp/fake_in_{i}.mobi"),
                    Path(f"/tmp/fake_out_{i}.epub"),
                ) for i in range(10)
            ])
        return results

    results = shared_event_loop.run_until_complete(_main())
    assert all(r is None for r in results), "All fake conversions should succeed"
    assert peak <= 2, f"Concurrency cap violated: peak in-flight={peak}, expected ≤ 2"
    assert peak >= 2, (
        f"Test was too fast to contend on the semaphore (peak={peak}). "
        "Bump the sleep or fire more in parallel."
    )
