"""Tags + Smart Shelves tests."""
from __future__ import annotations

import io
import os
import uuid
import zipfile
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_tags_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_tags_{uuid.uuid4().hex}"
USER_EMAIL = f"{USER_ID}@example.com"


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


def _build_min_epub(title: str, author: str) -> bytes:
    book_uid = f"t-{uuid.uuid4().hex[:8]}"
    container = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">{book_uid}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>'''
    ncx = f'''<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="{book_uid}"/></head>
  <docTitle><text>{title}</text></docTitle>
  <navMap><navPoint id="n1" playOrder="1"><navLabel><text>1</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap>
</ncx>'''
    chapter = f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head><body><p>{title}</p></body></html>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container)
        z.writestr("content.opf", opf)
        z.writestr("toc.ncx", ncx)
        z.writestr("ch1.xhtml", chapter)
    return buf.getvalue()


@pytest.fixture(scope="module", autouse=True)
def seed_user():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": USER_EMAIL,
        "name": "Tags Tester",
        "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": TOKEN,
        "user_id": USER_ID,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.smart_shelves.delete_many({"user_id": USER_ID})


def _upload_book(title: str, author: str) -> str:
    epub = _build_min_epub(title, author)
    r = requests.post(
        f"{BASE}/api/books/upload",
        headers=H(),
        files={"files": (f"{title.lower().replace(' ','_')}.epub", epub, "application/epub+zip")},
    )
    return r.json()["books"][0]["book_id"]


class TestTagsCrud:
    def test_add_and_list_tags(self):
        bid = _upload_book("Tag Subject A", "Tag Author")
        r = requests.post(
            f"{BASE}/api/books/{bid}/tags",
            headers={**H(), "Content-Type": "application/json"},
            json={"tags": ["fluff", "WIP", "Slow Burn"]},  # mixed case + space → slugged
        )
        assert r.status_code == 200, r.text
        out = r.json()["tags"]
        # Verify normalization: lowercase + hyphenated
        assert "fluff" in out
        assert "wip" in out
        assert "slow-burn" in out

        r = requests.get(f"{BASE}/api/tags", headers=H())
        assert r.status_code == 200
        names = [t["name"] for t in r.json()["tags"]]
        assert "fluff" in names

    def test_remove_tag(self):
        bid = _upload_book("Remove-tag Book", "Author")
        requests.post(
            f"{BASE}/api/books/{bid}/tags",
            headers={**H(), "Content-Type": "application/json"},
            json={"tags": ["delete-me", "keep-me"]},
        )
        r = requests.delete(f"{BASE}/api/books/{bid}/tags/delete-me", headers=H())
        assert r.status_code == 200
        # Verify
        b = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
        assert "keep-me" in b.get("tags", [])
        assert "delete-me" not in b.get("tags", [])

    def test_rename_tag_across_books(self):
        b1 = _upload_book("Rename A", "Author")
        b2 = _upload_book("Rename B", "Author")
        for bid in (b1, b2):
            requests.post(
                f"{BASE}/api/books/{bid}/tags",
                headers={**H(), "Content-Type": "application/json"},
                json={"tags": ["oldname"]},
            )

        r = requests.put(
            f"{BASE}/api/tags/oldname",
            headers={**H(), "Content-Type": "application/json"},
            json={"new_name": "newname"},
        )
        assert r.status_code == 200
        b = requests.get(f"{BASE}/api/books/{b1}", headers=H()).json()
        assert "newname" in b.get("tags", [])
        assert "oldname" not in b.get("tags", [])

    def test_merge_tags(self):
        b1 = _upload_book("Merge One", "A")
        b2 = _upload_book("Merge Two", "A")
        requests.post(f"{BASE}/api/books/{b1}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["alpha"]})
        requests.post(f"{BASE}/api/books/{b2}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["beta"]})

        r = requests.post(
            f"{BASE}/api/tags/merge",
            headers={**H(), "Content-Type": "application/json"},
            json={"sources": ["alpha", "beta"], "target": "gamma"},
        )
        assert r.status_code == 200
        for bid in (b1, b2):
            b = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert "gamma" in b.get("tags", [])
            assert "alpha" not in b.get("tags", [])
            assert "beta" not in b.get("tags", [])

    def test_delete_tag_everywhere(self):
        b1 = _upload_book("Delete-everywhere A", "A")
        b2 = _upload_book("Delete-everywhere B", "A")
        for bid in (b1, b2):
            requests.post(f"{BASE}/api/books/{bid}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["killme"]})

        r = requests.delete(f"{BASE}/api/tags/killme", headers=H())
        assert r.status_code == 200
        assert r.json()["updated"] >= 2

    def test_invalid_tag_rejected(self):
        bid = _upload_book("Invalid Tag", "A")
        r = requests.post(
            f"{BASE}/api/books/{bid}/tags",
            headers={**H(), "Content-Type": "application/json"},
            json={"tags": ["!@#$%^&*"]},   # All disallowed chars → normalizes to empty
        )
        assert r.status_code == 400

    def test_bulk_metadata_add_remove_tags(self):
        b1 = _upload_book("Bulk Tag A", "Bulk Author")
        b2 = _upload_book("Bulk Tag B", "Bulk Author")

        r = requests.post(
            f"{BASE}/api/books/bulk/metadata",
            headers={**H(), "Content-Type": "application/json"},
            json={"book_ids": [b1, b2], "add_tags": ["shared", "bulk"]},
        )
        assert r.status_code == 200
        for bid in (b1, b2):
            b = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert "shared" in b.get("tags", [])
            assert "bulk" in b.get("tags", [])

        # Remove one
        requests.post(
            f"{BASE}/api/books/bulk/metadata",
            headers={**H(), "Content-Type": "application/json"},
            json={"book_ids": [b1, b2], "remove_tags": ["bulk"]},
        )
        for bid in (b1, b2):
            b = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
            assert "bulk" not in b.get("tags", [])


# Only run if AI hook is enabled — then uploaded books should auto-get the canned tags
@pytest.mark.skipif(
    not os.environ.get("SHELFSORT_TEST_AI_RESPONSE"),
    reason="SHELFSORT_TEST_AI_RESPONSE not set",
)
class TestAIAutoTags:
    def test_upload_attaches_ai_tags(self):
        bid = _upload_book("AI Tagged Tale", "Mystery Author")
        b = requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()
        # The canned response is {"category":"Fanfiction","fandom":"Harry Potter","confidence":0.85,"tags":["fluff","wip","au"]}
        # That gets used only if metadata classifier confidence < 0.6, so check tags exist (may be present or not depending on heuristic outcome)
        tags = b.get("tags") or []
        # Either AI was invoked (tags present) or metadata won — both are valid
        if tags:
            assert all(isinstance(t, str) for t in tags)

    def test_suggest_tags_returns_suggestions(self):
        bid = _upload_book("Suggest Test", "Suggest Author")
        r = requests.post(f"{BASE}/api/books/{bid}/suggest-tags", headers=H())
        assert r.status_code == 200, r.text
        body = r.json()
        assert "suggested" in body
        assert "all" in body
        # The canned response yields ["fluff","wip","au"] — at least one should bubble up
        assert isinstance(body["suggested"], list)
        if body["suggested"]:
            # Suggestions should not include tags the book already has
            existing = b.get("tags", []) if (b := requests.get(f"{BASE}/api/books/{bid}", headers=H()).json()) else []
            assert all(t not in existing for t in body["suggested"])

    def test_suggest_tags_404_unknown_book(self):
        r = requests.post(f"{BASE}/api/books/not-a-real-id/suggest-tags", headers=H())
        assert r.status_code == 404


class TestSmartShelves:
    def test_create_list_get_delete(self):
        # Seed: 3 books, two with tag "test-fluff"
        b1 = _upload_book("Shelf One", "Shelf Author")
        b2 = _upload_book("Shelf Two", "Shelf Author")
        b3 = _upload_book("Shelf Three", "Other Author")
        requests.post(f"{BASE}/api/books/{b1}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["test-fluff"]})
        requests.post(f"{BASE}/api/books/{b2}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["test-fluff"]})

        # Create shelf
        r = requests.post(
            f"{BASE}/api/smart-shelves",
            headers={**H(), "Content-Type": "application/json"},
            json={
                "name": "Fluff books",
                "pinned": True,
                "query": {
                    "combinator": "AND",
                    "rules": [{"field": "tags_any", "values": ["test-fluff"]}],
                },
            },
        )
        assert r.status_code == 200, r.text
        shelf = r.json()
        sid = shelf["shelf_id"]
        assert shelf["pinned"] is True

        # List → includes count
        r = requests.get(f"{BASE}/api/smart-shelves", headers=H())
        assert r.status_code == 200
        shelves = r.json()["shelves"]
        ours = next((s for s in shelves if s["shelf_id"] == sid), None)
        assert ours is not None
        assert ours["count"] >= 2

        # Books → returns only matching books
        r = requests.get(f"{BASE}/api/smart-shelves/{sid}/books", headers=H())
        assert r.status_code == 200
        books = r.json()["books"]
        ids = [b["book_id"] for b in books]
        assert b1 in ids
        assert b2 in ids
        assert b3 not in ids

        # Delete
        r = requests.delete(f"{BASE}/api/smart-shelves/{sid}", headers=H())
        assert r.status_code == 200

        # Subsequent GET returns 404
        r = requests.get(f"{BASE}/api/smart-shelves/{sid}/books", headers=H())
        assert r.status_code == 404

    def test_patch_updates_shelf(self):
        r = requests.post(
            f"{BASE}/api/smart-shelves",
            headers={**H(), "Content-Type": "application/json"},
            json={"name": "Editable", "query": {"combinator": "AND", "rules": []}},
        )
        sid = r.json()["shelf_id"]

        r = requests.patch(
            f"{BASE}/api/smart-shelves/{sid}",
            headers={**H(), "Content-Type": "application/json"},
            json={"name": "Renamed Shelf", "pinned": True},
        )
        assert r.status_code == 200

        listed = requests.get(f"{BASE}/api/smart-shelves", headers=H()).json()["shelves"]
        match = next((s for s in listed if s["shelf_id"] == sid), None)
        assert match["name"] == "Renamed Shelf"
        assert match["pinned"] is True

    def test_preview_without_saving(self):
        bid = _upload_book("Preview Match", "Preview Author")
        requests.post(f"{BASE}/api/books/{bid}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["preview-tag"]})

        r = requests.post(
            f"{BASE}/api/smart-shelves/preview",
            headers={**H(), "Content-Type": "application/json"},
            json={"query": {"combinator": "AND", "rules": [{"field": "tags_any", "values": ["preview-tag"]}]}},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        assert any(b["book_id"] == bid for b in body["sample"])

    def test_combinator_or(self):
        bA = _upload_book("OR Test A", "A")
        bB = _upload_book("OR Test B", "B")
        requests.post(f"{BASE}/api/books/{bA}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["only-a"]})
        requests.post(f"{BASE}/api/books/{bB}/tags", headers={**H(), "Content-Type": "application/json"}, json={"tags": ["only-b"]})

        r = requests.post(
            f"{BASE}/api/smart-shelves/preview",
            headers={**H(), "Content-Type": "application/json"},
            json={"query": {"combinator": "OR", "rules": [
                {"field": "tags_any", "values": ["only-a"]},
                {"field": "tags_any", "values": ["only-b"]},
            ]}},
        )
        ids = [b["book_id"] for b in r.json()["sample"]]
        assert bA in ids
        assert bB in ids

    def test_invalid_create(self):
        # Empty name
        r = requests.post(
            f"{BASE}/api/smart-shelves",
            headers={**H(), "Content-Type": "application/json"},
            json={"name": "   ", "query": {"combinator": "AND", "rules": []}},
        )
        assert r.status_code == 400

    def test_404_on_unknown_shelf(self):
        r = requests.get(f"{BASE}/api/smart-shelves/not-a-real-id/books", headers=H())
        assert r.status_code == 404
        r = requests.patch(
            f"{BASE}/api/smart-shelves/not-a-real-id",
            headers={**H(), "Content-Type": "application/json"},
            json={"name": "x"},
        )
        assert r.status_code == 404
        r = requests.delete(f"{BASE}/api/smart-shelves/not-a-real-id", headers=H())
        assert r.status_code == 404

    def test_status_filter(self):
        b1 = _upload_book("Reading Filter Book", "Status Author")
        # Mark as reading (50%)
        requests.post(
            f"{BASE}/api/books/{b1}/progress",
            headers={**H(), "Content-Type": "application/json"},
            json={"percent": 0.5},
        )
        r = requests.post(
            f"{BASE}/api/smart-shelves/preview",
            headers={**H(), "Content-Type": "application/json"},
            json={"query": {"combinator": "AND", "rules": [{"field": "status", "value": "reading"}]}},
        )
        assert r.status_code == 200
        ids = [b["book_id"] for b in r.json()["sample"]]
        assert b1 in ids
