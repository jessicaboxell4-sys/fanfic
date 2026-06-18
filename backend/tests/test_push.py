"""Tests for the Web Push subscribe / handoff endpoints."""
from __future__ import annotations

import asyncio
import os
import uuid

import requests
from passlib.hash import bcrypt as bcrypt_hash

from deps import db


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com",
).rstrip("/")


def _seed():
    uid = f"pushtest_{uuid.uuid4().hex[:10]}"
    email = f"{uid}@example.com"
    pw = "pp-" + uuid.uuid4().hex[:8]

    async def insert():
        await db.users.insert_one({
            "user_id": uid, "email": email, "name": "Push Tester",
            "password_hash": bcrypt_hash.hash(pw),
            "is_admin": False, "is_moderator": False,
            "approval_status": "approved",
        })
    asyncio.get_event_loop().run_until_complete(insert())
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return uid, s


def _cleanup(uid):
    async def go():
        await db.users.delete_many({"user_id": uid})
        await db.push_subscriptions.delete_many({"user_id": uid})
        await db.books.delete_many({"user_id": uid})
    asyncio.get_event_loop().run_until_complete(go())


def test_vapid_public_key_endpoint_unauth():
    """The VAPID public key endpoint must be unauthenticated — the
    browser fetches it during `PushManager.subscribe()` before the
    user has even granted permission."""
    anon = requests.Session()
    r = anon.get(f"{BASE}/api/push/vapid-public-key")
    assert r.status_code == 200
    assert "public_key" in r.json()


def test_subscribe_unsubscribe_round_trip():
    """`/push/subscribe` is upsert (no duplicate rows on second call);
    `/push/unsubscribe` removes the row."""
    uid, s = _seed()
    endpoint = f"https://fcm.example.com/{uuid.uuid4().hex}"
    try:
        body = {
            "endpoint": endpoint,
            "keys": {"p256dh": "k" * 80, "auth": "a" * 22},
            "device_id": "dev_laptop_x",
            "device_label": "Mac",
        }
        r1 = s.post(f"{BASE}/api/push/subscribe", json=body)
        assert r1.status_code == 200
        r2 = s.post(f"{BASE}/api/push/subscribe", json=body)   # idempotent
        assert r2.status_code == 200
        n = asyncio.get_event_loop().run_until_complete(
            db.push_subscriptions.count_documents({"user_id": uid})
        )
        assert n == 1

        u = s.post(f"{BASE}/api/push/unsubscribe", json={"endpoint": endpoint})
        assert u.status_code == 200
        assert u.json()["deleted"] == 1
    finally:
        _cleanup(uid)


def test_handoff_404_for_unknown_book():
    """Handoff endpoint guards against cross-user / typo'd book IDs."""
    uid, s = _seed()
    try:
        r = s.post(f"{BASE}/api/push/handoff", json={
            "book_id": "not_my_book",
            "closing_device_id": "x",
            "closing_device_label": "Mac",
            "percent": 0.5,
        })
        assert r.status_code == 404
    finally:
        _cleanup(uid)
