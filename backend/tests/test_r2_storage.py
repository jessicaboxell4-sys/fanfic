"""Regression coverage for the storage_cloud dispatcher.

Verifies:
  - Backend selection responds to ``STORAGE_BACKEND`` env var
  - R2 PUT / GET / DELETE round-trip via the public dispatcher
  - is_enabled() correctly checks R2 credentials when in r2 mode
"""
import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Skip the whole module if we're not in r2 mode — running these
# against Emergent would burn the wrong storage.
pytestmark = pytest.mark.skipif(
    (os.environ.get("STORAGE_BACKEND") or "emergent").lower() != "r2",
    reason="storage backend is not r2"
)


def test_backend_selector_returns_r2():
    from utils import storage_cloud
    assert storage_cloud._backend() == "r2"


def test_is_enabled_true_when_r2_creds_present():
    from utils import storage_cloud
    assert storage_cloud.is_enabled() is True


def test_full_dispatcher_round_trip(tmp_path: Path):
    """Public mirror_up → restore_to_disk → delete_remote round-trip."""
    from utils import storage_cloud

    src = tmp_path / "r2_pytest.txt"
    src.write_text("r2 dispatcher round trip ok")
    key = "_pytest/r2_dispatcher_round_trip.txt"

    assert storage_cloud.mirror_up(src, key) is True

    dst = tmp_path / "r2_pytest_restored.txt"
    assert storage_cloud.restore_to_disk(dst, key) is True
    assert dst.read_text() == "r2 dispatcher round trip ok"

    assert storage_cloud.delete_remote(key) is True

    # After delete, restore should fail (R2 miss + Emergent miss/500)
    dst2 = tmp_path / "r2_pytest_after_delete.txt"
    assert storage_cloud.restore_to_disk(dst2, key) is False
