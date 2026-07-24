"""Tests for preset marketplace: search/sort + comments (iteration 100)."""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "rownum-test@example.com"
ADMIN_PASSWORD = "hunter2pw!"


def _login(session: requests.Session, email: str, password: str) -> None:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"


def _register_or_login(session: requests.Session, email: str, password: str, name: str) -> None:
    r = session.post(f"{API}/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
    if r.status_code in (200, 201):
        return
    # Already exists — login instead
    _login(session, email, password)


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="module")
def second_session():
    s = requests.Session()
    # Use unique email per test run to avoid lockout / conflicts across iterations
    email = "commenter-test@example.com"
    password = "hunter2pw!"
    _register_or_login(s, email, password, "Commenter Test")
    return s


@pytest.fixture(scope="module")
def preset_ids(admin_session):
    """Publish 3 presets by admin for search/sort testing."""
    ids = []
    for i, (name, desc) in enumerate([
        ("Alpha Preset", "First tester preset"),
        ("Beta Wide View", "A wider view showing wordcount"),
        ("Zeta Compact", "Compact tester Alpha crossover"),
    ]):
        r = admin_session.post(f"{API}/presets/marketplace", json={
            "name": name,
            "description": desc,
            "preset": {
                "label": name,
                "visible": {"fandom": True, "wordcount": True, "size": False, "status": True, "added": True, "pairings": False},
                "order": ["fandom", "wordcount", "status", "added"],
            },
        }, timeout=30)
        assert r.status_code == 200, f"publish {name} failed: {r.status_code} {r.text[:200]}"
        ids.append(r.json()["id"])
        time.sleep(0.05)  # ensure created_at ordering is deterministic
    return ids


class TestMarketplaceSearchSort:
    def test_list_all_no_query(self, admin_session, preset_ids):
        r = admin_session.get(f"{API}/presets/marketplace", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "applied" in data and data["applied"] == {"q": "", "sort": "upvotes"}
        assert len(data["items"]) >= 3
        for item in data["items"]:
            assert "comment_count" in item and isinstance(item["comment_count"], int)
            assert item["comment_count"] >= 0

    def test_search_q_filters_by_name(self, admin_session, preset_ids):
        r = admin_session.get(f"{API}/presets/marketplace", params={"q": "alpha"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        names = [i["name"] for i in data["items"]]
        # Alpha Preset (name match) + Zeta Compact (desc contains "Alpha")
        assert any("Alpha" in n for n in names)
        assert all(("alpha" in i["name"].lower() or "alpha" in i["description"].lower() or "alpha" in i["author_name"].lower()) for i in data["items"])
        assert data["applied"]["q"] == "alpha"

    def test_sort_newest(self, admin_session, preset_ids):
        r = admin_session.get(f"{API}/presets/marketplace", params={"sort": "newest"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["applied"]["sort"] == "newest"
        created = [i["created_at"] for i in data["items"] if i["id"] in preset_ids]
        assert created == sorted(created, reverse=True)

    def test_sort_mine(self, admin_session, preset_ids):
        r = admin_session.get(f"{API}/presets/marketplace", params={"sort": "mine"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["applied"]["sort"] == "mine"
        for item in data["items"]:
            assert item["author_user_id"] == "user_010ca8941571"

    def test_sort_mine_other_user_empty(self, second_session, preset_ids):
        r = second_session.get(f"{API}/presets/marketplace", params={"sort": "mine"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        # Second user hasn't published any presets in this run
        for item in data["items"]:
            assert item["author_user_id"] != "user_010ca8941571"


class TestMarketplaceComments:
    def test_post_comment(self, admin_session, preset_ids):
        pid = preset_ids[0]
        r = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "nice preset"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        c = r.json()
        assert c["preset_id"] == pid
        assert c["body"] == "nice preset"
        assert c["can_delete"] is True
        assert "id" in c and "author_user_id" in c and "author_name" in c and "created_at" in c

    def test_post_empty_body_422(self, admin_session, preset_ids):
        r = admin_session.post(f"{API}/presets/marketplace/{preset_ids[0]}/comments", json={"body": ""}, timeout=30)
        assert r.status_code == 422

    def test_list_comments_sorted_newest_first_and_can_delete_flag(self, admin_session, second_session, preset_ids):
        pid = preset_ids[1]
        # admin posts
        r1 = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "admin note 1"}, timeout=30)
        assert r1.status_code == 200
        time.sleep(0.05)
        # second user posts
        r2 = second_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "second user note"}, timeout=30)
        assert r2.status_code == 200
        time.sleep(0.05)
        r3 = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "admin note 2"}, timeout=30)
        assert r3.status_code == 200

        # admin lists
        rl = admin_session.get(f"{API}/presets/marketplace/{pid}/comments", timeout=30)
        assert rl.status_code == 200
        items = rl.json()["items"]
        assert len(items) >= 3
        created = [i["created_at"] for i in items]
        assert created == sorted(created, reverse=True), "must be newest-first"
        # can_delete true only on admin-authored
        admin_uid = "user_010ca8941571"
        for i in items:
            if i["author_user_id"] == admin_uid:
                assert i["can_delete"] is True
            else:
                assert i["can_delete"] is False

    def test_comment_count_updates_in_list(self, admin_session, preset_ids):
        # preset_ids[1] should now have >=3 comments
        r = admin_session.get(f"{API}/presets/marketplace", timeout=30)
        assert r.status_code == 200
        items = {i["id"]: i for i in r.json()["items"]}
        assert items[preset_ids[1]]["comment_count"] >= 3

    def test_delete_by_author(self, admin_session, preset_ids):
        pid = preset_ids[2]
        r = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "to delete"}, timeout=30)
        cid = r.json()["id"]
        rd = admin_session.delete(f"{API}/presets/marketplace/{pid}/comments/{cid}", timeout=30)
        assert rd.status_code == 200
        assert rd.json()["deleted"] is True

    def test_delete_by_non_author_403(self, admin_session, second_session, preset_ids):
        pid = preset_ids[2]
        # admin posts a comment
        r = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "admin only"}, timeout=30)
        cid = r.json()["id"]
        # second user tries to delete
        rd = second_session.delete(f"{API}/presets/marketplace/{pid}/comments/{cid}", timeout=30)
        assert rd.status_code == 403

    def test_delete_nonexistent_comment_404(self, admin_session, preset_ids):
        rd = admin_session.delete(f"{API}/presets/marketplace/{preset_ids[0]}/comments/comment_deadbeef00", timeout=30)
        assert rd.status_code == 404


class TestPresetDeleteCascadesComments:
    def test_delete_preset_removes_its_comments(self, admin_session):
        # Fresh preset with a comment
        r = admin_session.post(f"{API}/presets/marketplace", json={
            "name": f"Cascade Test {uuid.uuid4().hex[:6]}",
            "description": "cascade check",
            "preset": {
                "label": "Cascade",
                "visible": {"fandom": True, "wordcount": True, "size": False, "status": True, "added": True, "pairings": False},
                "order": ["fandom", "wordcount", "status", "added"],
            },
        }, timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        rc = admin_session.post(f"{API}/presets/marketplace/{pid}/comments", json={"body": "will be cascaded"}, timeout=30)
        assert rc.status_code == 200
        # Delete preset
        rd = admin_session.delete(f"{API}/presets/marketplace/{pid}", timeout=30)
        assert rd.status_code == 200
        # List comments returns empty
        rl = admin_session.get(f"{API}/presets/marketplace/{pid}/comments", timeout=30)
        assert rl.status_code == 200
        assert rl.json()["items"] == []
