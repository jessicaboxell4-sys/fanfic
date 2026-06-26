"""Iteration 49 — public-library follow-on (a+b+c): OG share, directory chip, shelf overlap."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")

# Fixture users from iteration_48 (saved at /tmp/fe_users.json)
OPTED_EMAIL = "TEST_fe_opted_e24c9d@example.com"
OPTED_PW = "hunter2pw!"
OPTED_HANDLE = "febopta508d"
OPTED_USER_ID = "user_2d9235c5ffaf"

PRIVATE_HANDLE = "febpri4c63f"   # not opted in


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def opted_session():
    return _login(OPTED_EMAIL, OPTED_PW)


@pytest.fixture(scope="module")
def overlap_user():
    """Register a NEW user, ensure they have a book whose (title, author)
    matches one in the opted-in user's library. We seed via Mongo if needed."""
    email = f"TEST_overlap_{uuid.uuid4().hex[:8]}@example.com"
    pw = "hunter2pw!"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": pw, "name": "Overlap Tester"}, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
    user_id = me.get("user_id") or me.get("id")
    return {"session": s, "user_id": user_id, "email": email}


@pytest.fixture(scope="module")
def opted_book_sample(opted_session):
    """Fetch one book from opted user's public library to mirror for overlap."""
    r = opted_session.get(f"{BASE_URL}/api/users/{OPTED_HANDLE}/public-library", timeout=15)
    assert r.status_code == 200
    data = r.json()
    books = data.get("books") or []
    return books[0] if books else None


# ----------------------------------------------------------------
# (a) OG share HTML
# ----------------------------------------------------------------

class TestOGShare:
    def test_opted_user_returns_og_html(self):
        r = requests.get(f"{BASE_URL}/api/share/u/{OPTED_HANDLE}/library", timeout=15,
                         headers={"User-Agent": "facebookexternalhit/1.1"})
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        body = r.text
        assert f"@{OPTED_HANDLE}" in body and "library on Shelfsort" in body
        assert 'property="og:title"' in body
        assert 'property="og:description"' in body
        assert f"/api/og/user/{OPTED_HANDLE}.png" in body
        # canonical URL ends with /u/<handle>/library
        assert f"/u/{OPTED_HANDLE}/library" in body
        assert 'rel="canonical"' in body

    def test_private_user_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/share/u/{PRIVATE_HANDLE}/library", timeout=15)
        assert r.status_code == 404

    def test_nonexistent_user_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/share/u/nonexistent_handle_xyz123/library", timeout=15)
        assert r.status_code == 404

    def test_404_responses_indistinguishable(self):
        r1 = requests.get(f"{BASE_URL}/api/share/u/{PRIVATE_HANDLE}/library", timeout=15)
        r2 = requests.get(f"{BASE_URL}/api/share/u/totally_nonexistent_xyz/library", timeout=15)
        assert r1.status_code == 404 and r2.status_code == 404
        # bodies should be effectively identical (both standard 404 detail)
        assert r1.json() == r2.json()


# ----------------------------------------------------------------
# (b) Directory has_public_library
# ----------------------------------------------------------------

class TestDirectory:
    def test_directory_returns_has_public_library_field(self, opted_session):
        r = opted_session.get(f"{BASE_URL}/api/users/directory?limit=100", timeout=15)
        assert r.status_code == 200
        data = r.json()
        rows = data.get("users", [])
        assert len(rows) > 0
        # Every row must have the has_public_library field as a bool
        for row in rows:
            assert "has_public_library" in row
            assert isinstance(row["has_public_library"], bool)
            assert "username" in row

    def test_opted_user_in_directory_with_library_true(self, overlap_user):
        # Use a different user (overlap_user) since directory excludes self
        sess = overlap_user["session"]
        page = 1
        found = None
        while page <= 20:
            r = sess.get(f"{BASE_URL}/api/users/directory?limit=100&page={page}", timeout=15)
            assert r.status_code == 200
            data = r.json()
            for row in data.get("users", []):
                if row.get("username") == OPTED_HANDLE:
                    found = row
                    break
            if found or not data.get("has_more"):
                break
            page += 1
        assert found, f"Opted user @{OPTED_HANDLE} not found in directory"
        assert found["has_public_library"] is True

    def test_private_user_in_directory_with_library_false(self, opted_session):
        # Find a NON-opted user
        page = 1
        non_opted_found = False
        while page <= 5:
            r = opted_session.get(f"{BASE_URL}/api/users/directory?limit=100&page={page}", timeout=15)
            data = r.json()
            for row in data.get("users", []):
                if row.get("username") == PRIVATE_HANDLE:
                    assert row["has_public_library"] is False
                    non_opted_found = True
                    break
            if non_opted_found or not data.get("has_more"):
                break
            page += 1
        # If not found that's fine; the field-check on every row is more important
        # but assert at least some rows are false
        r = opted_session.get(f"{BASE_URL}/api/users/directory?limit=100", timeout=15)
        rows = r.json().get("users", [])
        false_count = sum(1 for x in rows if not x["has_public_library"])
        assert false_count >= 1, "Expected at least one non-opted user in directory"

    def test_empty_username_users_excluded(self, opted_session):
        """Regression: $nin [null, ''] excludes both nulls and empty strings."""
        r = opted_session.get(f"{BASE_URL}/api/users/directory?limit=100", timeout=15)
        for row in r.json().get("users", []):
            assert row.get("username"), f"Empty username leaked: {row}"


# ----------------------------------------------------------------
# (c) Shelf overlap
# ----------------------------------------------------------------

class TestOverlap:
    def test_unauthenticated_returns_401(self):
        """iteration_50: anon callers MUST be rejected with 401 — no overlap data leaks."""
        r = requests.get(f"{BASE_URL}/api/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 401

    def test_owner_viewing_self_no_overlap(self, opted_session):
        r = opted_session.get(f"{BASE_URL}/api/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("overlap_count") == 0
        assert data.get("viewer_is_signed_in") is False, "owner viewing self must NOT count as signed-in viewer"

    def test_signed_in_other_user_with_overlap(self, overlap_user, opted_book_sample):
        if not opted_book_sample:
            pytest.skip("No books in opted user's library to mirror")
        # Seed a matching book directly via Mongo into overlap_user's library
        import subprocess, json
        title = opted_book_sample.get("title", "")
        author = opted_book_sample.get("author", "")
        book = {
            "book_id": f"book_test_{uuid.uuid4().hex[:10]}",
            "user_id": overlap_user["user_id"],
            "title": title,
            "author": author,
            "fandom": opted_book_sample.get("fandom", ""),
            "category": opted_book_sample.get("category", "Uncategorized"),
            "av_status": "clean",
        }
        cmd = [
            "mongosh", "mongodb://localhost:27017/test_database", "--quiet", "--eval",
            f"db.books.insertOne({json.dumps(book)})"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, f"mongo seed failed: {result.stderr}"
        time.sleep(0.5)

        # Now query as overlap_user
        r = overlap_user["session"].get(f"{BASE_URL}/api/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("viewer_is_signed_in") is True
        assert data.get("overlap_count") >= 1, f"Expected overlap >= 1, got {data.get('overlap_count')}"
        # Find the matching book and assert flag
        matched = [b for b in data.get("books", [])
                   if b.get("title", "").lower() == title.lower()
                   and b.get("author", "").lower() == author.lower()]
        assert matched, "Matched book not found in response"
        assert any(b.get("you_also_have") is True for b in matched)
        # Non-matching books have flag False
        non_match = [b for b in data.get("books", [])
                     if not (b.get("title", "").lower() == title.lower()
                             and b.get("author", "").lower() == author.lower())]
        for b in non_match:
            assert b.get("you_also_have") is False

    def test_signed_in_other_user_no_overlap(self):
        """A fresh user with no books should see overlap_count==0 but viewer_is_signed_in==True."""
        email = f"TEST_no_overlap_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "hunter2pw!", "name": "NoOverlap"}, timeout=20)
        r = s.get(f"{BASE_URL}/api/users/{OPTED_HANDLE}/public-library", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("viewer_is_signed_in") is True
        assert data.get("overlap_count") == 0
        for b in data.get("books", []):
            assert b.get("you_also_have") is False
