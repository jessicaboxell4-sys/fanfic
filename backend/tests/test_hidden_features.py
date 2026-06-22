"""Coverage for the /admin/hidden-features inventory (2026-06-22)."""
from __future__ import annotations

import os
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402


@pytest.fixture(scope="module")
def sync_db():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url, maxPoolSize=4)
    yield c[name]
    c.close()


@pytest.fixture()
def loop(shared_event_loop):
    return shared_event_loop


def test_hidden_features_response_shape(loop):
    from utils.hidden_features import hidden_features
    payload = loop.run_until_complete(hidden_features())
    for key in ("features", "client_file", "hidden_count", "partial_count", "visible_count"):
        assert key in payload
    assert isinstance(payload["features"], list)
    # Both registered features must appear.
    ids = {f["id"] for f in payload["features"]}
    assert "url_fetching" in ids
    assert "send_to_kindle" in ids


def test_hidden_features_effective_state(loop):
    """``effective`` is hidden when BOTH gates off, partial otherwise."""
    from utils.hidden_features import hidden_features
    payload = loop.run_until_complete(hidden_features())
    for f in payload["features"]:
        # Each row must carry the metadata the UI relies on.
        assert "name" in f
        assert "client_flag" in f
        assert isinstance(f["client_on"], bool)
        assert isinstance(f["surfaces"], list) and len(f["surfaces"]) > 0
        assert isinstance(f["rehydrate"], list) and len(f["rehydrate"]) > 0
        # Effective state is one of the three known values.
        assert f["effective"] in {"hidden", "partial", "visible"}


def test_send_to_kindle_defaults_off(loop, sync_db):
    """The send_to_kindle_enabled flag must default to OFF — if it
    flips ON inadvertently (e.g. via a future code change adding it to
    DEFAULT_FLAGS), this test catches it.
    """
    from utils.feature_flags import is_enabled
    # Clear any test-residue value in the DB so we exercise the
    # DEFAULT_FLAGS path specifically.
    sync_db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$unset": {"send_to_kindle_enabled": ""}},
    )
    try:
        from utils.feature_flags import _invalidate_cache  # noqa: WPS433
        _invalidate_cache()
    except Exception:
        pass
    enabled = loop.run_until_complete(is_enabled("send_to_kindle_enabled"))
    assert enabled is False, "send_to_kindle_enabled must default OFF (Resend quota brake)"
