"""Iter98: Preset marketplace + orphan age filter backend tests."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://drift-check-live.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "rownum-test@example.com"
ADMIN_PW = "hunter2pw!"
USER2_EMAIL = "preset-tester@example.com"
USER2_PW = "hunter2pw!"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        # try register
        r2 = s.post(f"{BASE}/api/auth/register", json={"email": email, "password": pw, "name": email.split("@")[0]}, timeout=30)
        assert r2.status_code in (200, 201), f"register failed: {r2.status_code} {r2.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def user2():
    return _login(USER2_EMAIL, USER2_PW)


# ------------- Orphan age filter -------------

def test_orphan_scan_age_buckets(admin):
    r = admin.post(f"{BASE}/api/admin/storage/orphans/scan", timeout=180)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "age_buckets" in j, f"missing age_buckets: {list(j.keys())}"
    ab = j["age_buckets"]
    for k in ["0", "7", "30", "90", "365"]:
        assert k in ab, f"missing bucket {k}"
        assert isinstance(ab[k]["count"], int)
        assert isinstance(ab[k]["bytes"], int)
    # bucket 0 == totals
    assert ab["0"]["count"] == j.get("orphans_found"), (ab["0"], j.get("orphans_found"))
    assert ab["0"]["bytes"] == j.get("bytes_recoverable")
    # monotonic descending
    prev = ab["0"]["count"]
    for k in ["7", "30", "90", "365"]:
        assert ab[k]["count"] <= prev, f"bucket {k} not monotonic: {ab[k]['count']} > {prev}"
        prev = ab[k]["count"]


def test_orphan_purge_no_scan(admin):
    # clear scans
    import subprocess
    subprocess.run(["mongosh", "mongodb://localhost:27017/test_database", "--quiet", "--eval", "db.storage_orphan_scans.deleteMany({});"], check=False)
    r = admin.post(f"{BASE}/api/admin/storage/orphans/purge?min_age_days=30", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("purged") == 0
    assert j.get("bytes_freed") == 0
    assert "note" in j
    assert "scan" in j["note"].lower()


def test_orphan_purge_high_age(admin):
    # rescan
    r0 = admin.post(f"{BASE}/api/admin/storage/orphans/scan", timeout=180)
    assert r0.status_code == 200
    # API caps min_age_days at 3650 (validated below via 422); use the max instead of 999999.
    r_bad = admin.post(f"{BASE}/api/admin/storage/orphans/purge?min_age_days=999999", timeout=30)
    assert r_bad.status_code == 422, f"expected 422 cap-violation, got {r_bad.status_code}"
    r = admin.post(f"{BASE}/api/admin/storage/orphans/purge?min_age_days=3650", timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("purged") == 0
    assert j.get("bytes_freed") == 0
    assert "note" in j and "age" in j["note"].lower()


# ------------- Preset marketplace -------------

VALID_PRESET = {
    "name": "Reader queue clone",
    "description": "my daily view",
    "preset": {
        "label": "Reading queue",
        "visible": {"fandom": False, "pairings": False, "wordcount": True, "size": False, "status": True, "added": True},
        "order": ["wordcount", "status", "added", "fandom", "pairings", "size"],
    },
}


def test_publish_preset(admin):
    r = admin.post(f"{BASE}/api/presets/marketplace", json=VALID_PRESET, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "id" in j
    assert j["upvote_count"] == 0
    assert j["viewer_upvoted"] is False
    assert j["author_name"]
    assert j["preset"]["label"] == "Reading queue"
    assert j["preset"]["order"] == VALID_PRESET["preset"]["order"]
    pytest.preset_id = j["id"]


def test_list_marketplace(admin):
    r = admin.get(f"{BASE}/api/presets/marketplace", timeout=30)
    assert r.status_code == 200
    j = r.json()
    items = j["items"]
    ids = [x["id"] for x in items]
    assert pytest.preset_id in ids
    # sorted by upvote_count desc
    counts = [x["upvote_count"] for x in items]
    assert counts == sorted(counts, reverse=True)


def test_upvote_toggle(user2):
    pid = pytest.preset_id
    r1 = user2.post(f"{BASE}/api/presets/marketplace/{pid}/upvote", timeout=30)
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    assert j1["upvote_count"] == 1
    assert j1["viewer_upvoted"] is True
    r2 = user2.post(f"{BASE}/api/presets/marketplace/{pid}/upvote", timeout=30)
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2["upvote_count"] == 0
    assert j2["viewer_upvoted"] is False


def test_delete_permissions(admin, user2):
    pid = pytest.preset_id
    # user2 (non-author, non-admin) should get 403
    r = user2.delete(f"{BASE}/api/presets/marketplace/{pid}", timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
    # author (admin) deletes → 200
    r2 = admin.delete(f"{BASE}/api/presets/marketplace/{pid}", timeout=30)
    assert r2.status_code == 200
    j = r2.json()
    assert j["deleted"] is True
    assert j["id"] == pid
    # second delete → 404
    r3 = admin.delete(f"{BASE}/api/presets/marketplace/{pid}", timeout=30)
    assert r3.status_code == 404


def test_invalid_preset_shape(admin):
    # missing 'order'
    bad = {"name": "Bad", "description": "", "preset": {"label": "L", "visible": {}}}
    r = admin.post(f"{BASE}/api/presets/marketplace", json=bad, timeout=30)
    assert r.status_code in (400, 422), r.text

    # order with only unknown keys
    bad2 = {
        "name": "Bad2",
        "description": "",
        "preset": {"label": "L", "visible": {}, "order": ["nope", "wat"]},
    }
    r2 = admin.post(f"{BASE}/api/presets/marketplace", json=bad2, timeout=30)
    assert r2.status_code in (400, 422), r2.text
