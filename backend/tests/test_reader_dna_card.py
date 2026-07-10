"""Tests for the Reader DNA share-card PNG renderer.

Endpoint: GET /api/insights/reader-dna/share-card.png
Returns a 1080×1080 PNG of the calling user's Reader DNA stats.
"""
from __future__ import annotations

import os
import uuid
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or os.environ.get("TEST_BASE_URL")
    or "http://localhost:8001"
).rstrip("/")


def _user_token() -> str:
    from pymongo import MongoClient
    import datetime as _dt
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017/test_database")
    db_name = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(mongo_url)
    u = c[db_name].users.find_one({"email": "shelfsort-tester@example.com"})
    assert u, "Tester user fixture missing"
    token = f"dna_card_test_{uuid.uuid4().hex}"
    c[db_name].user_sessions.insert_one({
        "user_id": u["user_id"],
        "session_token": token,
        "expires_at": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1),
        "created_at": _dt.datetime.now(_dt.timezone.utc),
    })
    c.close()
    return token


def test_share_card_requires_auth():
    r = requests.get(f"{BASE_URL}/api/insights/reader-dna/share-card.png", timeout=15)
    assert r.status_code in (401, 403)


def test_share_card_returns_png():
    tok = _user_token()
    r = requests.get(
        f"{BASE_URL}/api/insights/reader-dna/share-card.png",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    # PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    assert r.content.startswith(b"\x89PNG\r\n\x1a\n")
    # 1080×1080 is at least ~10 KB after PNG compression — anything
    # smaller would mean Pillow returned a blank canvas.
    assert len(r.content) > 10_000
    # Dimensions check via Pillow.
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (1080, 1080)


def test_share_card_is_cached_per_user():
    """Second call within 60s should be served from in-memory cache.

    We verify by sending two calls back-to-back and asserting both
    return the EXACT same bytes (cache key is user_id).
    """
    tok = _user_token()
    h = {"Authorization": f"Bearer {tok}"}
    r1 = requests.get(f"{BASE_URL}/api/insights/reader-dna/share-card.png", headers=h, timeout=30)
    r2 = requests.get(f"{BASE_URL}/api/insights/reader-dna/share-card.png", headers=h, timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.content == r2.content
