"""AV gate on the friend-library surface (2026-06-25, P1).

When a book is marked ``av_status: "infected"`` it must:
  1. Never appear in another user's GET /friends/{id}/library results.
  2. Be impossible to "book-request" via DM (POST /friends/{id}/book-request
     returns 409 even if the caller has a cached book_id).

Unscanned + clean books remain visible — friends see the same library
state the owner sees in their Polish flow.
"""
import asyncio
import os
import re
import tempfile
import uuid as _uuid
from pathlib import Path

import pytest
import requests
from ebooklib import epub
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


def _register(email_suffix: str) -> tuple[str, requests.Session]:
    email = f"av-gate-{_uuid.uuid4().hex[:8]}-{email_suffix}@example.com"
    pw = "hunter2pw!"
    r = requests.post(f"{BASE}/api/auth/register",
                      json={"email": email, "password": pw, "name": email_suffix},
                      timeout=20)
    assert r.status_code in (200, 201), r.text[:200]
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=20)
    cookies = r.headers.get("set-cookie", "") + " " + r.headers.get("Set-Cookie", "")
    m = re.search(r"session_token=([A-Za-z0-9_\-\.]+)", cookies)
    assert m, cookies
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {m.group(1)}"})
    me = s.get(f"{BASE}/api/auth/me", timeout=10).json()
    return me["user_id"], s


def _build_epub(path: Path, title: str) -> None:
    b = epub.EpubBook()
    b.set_identifier(f"av-{path.stem}")
    b.set_title(title)
    b.set_language("en")
    b.add_author("AV Test")
    c = epub.EpubHtml(title="Ch1", file_name="ch1.xhtml", lang="en")
    c.content = "<h1>Ch1</h1><p>AV gate test.</p>"
    b.add_item(c); b.toc = (c,); b.add_item(epub.EpubNcx()); b.add_item(epub.EpubNav()); b.spine = ["nav", c]
    epub.write_epub(str(path), b)


def _upload(session: requests.Session, title: str) -> str:
    tmp = Path(tempfile.mkdtemp()) / f"{title.replace(' ', '_')}.epub"
    _build_epub(tmp, title)
    with open(tmp, "rb") as fh:
        r = session.post(
            f"{BASE}/api/books/upload",
            files=[("files", (tmp.name, fh, "application/epub+zip"))],
            timeout=30,
        )
    assert r.status_code == 200, r.text[:200]
    books = r.json().get("books") or []
    assert books, r.text[:200]
    return books[0]["book_id"]


async def _set_av_status(book_id: str, status: str) -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    try:
        await client[DB_NAME].books.update_one(
            {"book_id": book_id},
            {"$set": {"av_status": status}},
        )
    finally:
        client.close()


@pytest.mark.skipif(not MONGO_URL or not DB_NAME, reason="Needs MONGO_URL+DB_NAME to set av_status directly")
def test_av_gate_hides_infected_book_from_friend_library():
    """Two friends; one uploads two books (one will be marked infected).
    The friend's library API must return ONLY the clean book."""
    uid_a, sa = _register("a")
    uid_b, sb = _register("b")

    # Make them friends + b shares their library.
    r1 = sa.post(f"{BASE}/api/friends/request", json={"target_user_id": uid_b}, timeout=10)
    assert r1.status_code in (200, 201), f"friend-request failed: {r1.status_code} {r1.text[:200]}"
    r2 = sb.post(f"{BASE}/api/friends/{uid_a}/accept", timeout=10)
    assert r2.status_code == 200, f"friend-accept failed: {r2.status_code} {r2.text[:200]}"
    r3 = sb.put(f"{BASE}/api/account/library-visibility",
                json={"library_visible_to_friends": True}, timeout=10)
    assert r3.status_code in (200, 201), f"visibility toggle failed: {r3.status_code} {r3.text[:200]}"

    # B uploads two books; we flag one as infected directly in Mongo.
    clean_id = _upload(sb, "AV Clean Book")
    infected_id = _upload(sb, "AV Infected Book")
    asyncio.run(_set_av_status(infected_id, "infected"))

    # A asks for B's library.  Must include the clean book, exclude
    # the infected one.
    r = sa.get(f"{BASE}/api/friends/{uid_b}/library", timeout=10)
    assert r.status_code == 200, r.text[:200]
    titles = [b["title"] for b in (r.json().get("books") or [])]
    assert "AV Clean Book" in titles
    assert "AV Infected Book" not in titles, (
        f"Infected book leaked to friend library: {titles}"
    )

    # Book-request on the infected book must 409 even with the cached ID.
    r2 = sa.post(
        f"{BASE}/api/friends/{uid_b}/book-request",
        json={"book_id": infected_id},
        timeout=10,
    )
    assert r2.status_code == 409, (
        f"Expected 409 for infected book request, got {r2.status_code}: {r2.text[:200]}"
    )

    # Book-request on the clean book should succeed (200).
    r3 = sa.post(
        f"{BASE}/api/friends/{uid_b}/book-request",
        json={"book_id": clean_id},
        timeout=10,
    )
    assert r3.status_code in (200, 201), r3.text[:200]
