"""Storage adapter tests.

Verifies the round-trip behaviour of ``utils.storage_cloud`` against
the real Emergent Object Storage endpoint.  These are integration
tests in spirit — they hit the live API — but they're fast (each
test uploads ~50 bytes and downloads the same back).

Skipped when ``EMERGENT_LLM_KEY`` is unset so the suite still runs
in offline / sandboxed environments.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import pytest

# Bring the dotenv values into the process before importing the
# module-under-test — its late-bound key reader needs the env set.
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from utils import storage_cloud   # noqa: E402


pytestmark = pytest.mark.skipif(
    not os.environ.get("EMERGENT_LLM_KEY"),
    reason="EMERGENT_LLM_KEY not set — object storage tests skipped",
)


def test_is_enabled_returns_true_when_key_present():
    assert storage_cloud.is_enabled() is True


def test_init_storage_returns_key():
    key = storage_cloud._init_storage()
    assert key, "storage init should return a non-empty key"


def test_storage_key_for_path_shape():
    key = storage_cloud.storage_key_for("user_abc", "book_xyz", ".epub")
    assert key == "shelfsort/users/user_abc/book_xyz.epub"
    # Tolerant of missing leading dot
    key = storage_cloud.storage_key_for("user_abc", "book_xyz", "cover")
    assert key.endswith("book_xyz.cover")


def test_upload_and_restore_round_trip(tmp_path: Path):
    """End-to-end: upload a tiny EPUB payload then read it back into
    a different local path.  Asserts bytes survive intact."""
    src = tmp_path / "src.epub"
    payload = f"PK\x03\x04shelfsort-roundtrip-{uuid.uuid4().hex}".encode()
    src.write_bytes(payload)
    key = f"shelfsort/test/roundtrip_{uuid.uuid4().hex}.epub"

    assert storage_cloud.mirror_up(src, key) is True

    dst = tmp_path / "restored.epub"
    assert storage_cloud.restore_to_disk(dst, key) is True
    assert dst.read_bytes() == payload


def test_restore_returns_false_for_missing_key(tmp_path: Path):
    dst = tmp_path / "404.epub"
    ok = storage_cloud.restore_to_disk(
        dst, f"shelfsort/test/does-not-exist-{uuid.uuid4().hex}.epub",
    )
    assert ok is False
    assert not dst.exists()


def test_ensure_local_cached_round_trip(tmp_path: Path):
    """The cache-aware helper: when the local copy is missing it
    should hit the cloud and write the file back to disk."""
    # 1) Upload a file under the canonical book-asset key.
    user_id = f"test_storage_{uuid.uuid4().hex[:8]}"
    book_id = f"book_test_{uuid.uuid4().hex[:8]}"
    src = tmp_path / "seed.epub"
    payload = b"PK\x03\x04ensure-cached"
    src.write_bytes(payload)
    key = storage_cloud.storage_key_for(user_id, book_id, ".epub")
    assert storage_cloud.mirror_up(src, key) is True

    # 2) Confirm the local cache path doesn't exist, then invoke the
    #    cache helper — it should pull the file down.
    local = tmp_path / "users" / user_id / f"{book_id}.epub"
    assert not local.exists()
    assert storage_cloud.ensure_local_cached(local, user_id, book_id, ".epub") is True
    assert local.exists()
    assert local.read_bytes() == payload


def test_backfill_idempotent(tmp_path: Path):
    """Running the backfill twice on the same directory should treat
    the second pass as already-uploaded (409 short-circuit)."""
    user_dir = tmp_path / f"test_user_{uuid.uuid4().hex[:6]}"
    user_dir.mkdir()
    payload = b"PK\x03\x04backfill-idempotent"
    (user_dir / f"book_{uuid.uuid4().hex[:8]}.epub").write_bytes(payload)

    first = storage_cloud.backfill_storage_dir(tmp_path)
    assert first["scanned"] == 1
    assert first["uploaded"] == 1

    second = storage_cloud.backfill_storage_dir(tmp_path)
    # Second pass: still uploaded=1 (Emergent returns 409 which we
    # treat as success because the existing bytes are what we wanted).
    assert second["scanned"] == 1
    assert second["uploaded"] == 1
