"""OPDS 1.2 catalog endpoint — lets e-reader apps (KOReader, Moon+ Reader,
Marvin, Foliate, etc.) browse and download a user's Shelfsort library
without the React UI.

Auth: HTTP Basic. The user generates a dedicated "catalog password" from
/account so they never have to type their primary login password into a
third-party reader. The catalog password is stored as `catalog_password_hash`
(bcrypt) on the user document with a feature flag `opds_enabled`. Cookie
sessions are *not* honoured by these endpoints — readers don't do cookies.

Catalog layout
--------------
GET /api/opds                          — root navigation feed
GET /api/opds/all?page=N               — all books (50/page acquisition feed)
GET /api/opds/fandoms                  — navigation feed listing every fandom
GET /api/opds/fandom/{name}?page=N     — books in a fandom (acquisition feed)
GET /api/opds/authors                  — navigation feed listing every author
GET /api/opds/author/{name}?page=N     — books by an author (acquisition feed)
GET /api/opds/recent?page=N            — newest first
GET /api/opds/cover/{book_id}          — raw cover bytes
GET /api/opds/download/{book_id}       — raw EPUB bytes (the e-reader downloads this)

The XML is rendered by hand (no extra dep) and validated against the
OPDS 1.2 acquisition / navigation profiles.

Catalog-password management lives at /api/user/catalog-credentials and is
exempt from Basic auth (uses the regular session_token / Bearer flow).
"""
import base64
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from xml.sax.saxutils import escape as xml_escape

import bcrypt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, Response as FastResponse
from pydantic import BaseModel

from deps import db, api_router, logger, STORAGE_DIR
from models import User
from auth_dep import get_current_user


OPDS_ACQUISITION_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition"
OPDS_NAVIGATION_TYPE  = "application/atom+xml;profile=opds-catalog;kind=navigation"
PAGE_SIZE = 50


# ---------------------------------------------------------------------
# Catalog-credentials endpoints (cookie-authed)
# ---------------------------------------------------------------------

class EnableOpdsBody(BaseModel):
    enabled: bool


def _hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def _gen_password() -> str:
    """20-char URL-safe token; safe for HTTP Basic + easy to type."""
    return secrets.token_urlsafe(15)[:20]


@api_router.get("/user/catalog-credentials")
async def get_catalog_credentials(user: User = Depends(get_current_user)):
    """Returns the metadata without leaking the password hash."""
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "opds_enabled": 1, "catalog_password_hash": 1, "catalog_password_set_at": 1},
    ) or {}
    return {
        "opds_enabled": bool(doc.get("opds_enabled", False)),
        "has_password": bool(doc.get("catalog_password_hash")),
        "set_at": doc.get("catalog_password_set_at"),
    }


@api_router.post("/user/catalog-credentials/regenerate")
async def regenerate_catalog_password(user: User = Depends(get_current_user)):
    """Generate a fresh catalog password. Returns the plaintext ONCE — the
    user must save it now; we only persist the hash. Also enables OPDS."""
    pw = _gen_password()
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "catalog_password_hash": _hash_pw(pw),
            "catalog_password_set_at": datetime.now(timezone.utc).isoformat(),
            "opds_enabled": True,
        }},
    )
    return {
        "password": pw,
        "username": user.email,
        "opds_enabled": True,
    }


@api_router.put("/user/catalog-credentials")
async def toggle_opds(body: EnableOpdsBody, user: User = Depends(get_current_user)):
    update = {"opds_enabled": bool(body.enabled)}
    await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    return await get_catalog_credentials(user)


# ---------------------------------------------------------------------
# Basic-auth dependency for catalog requests
# ---------------------------------------------------------------------

def _parse_basic(authorization: Optional[str]) -> Optional[Tuple[str, str]]:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(authorization[6:]).decode("utf-8")
        if ":" not in decoded:
            return None
        u, p = decoded.split(":", 1)
        return (u, p)
    except Exception:
        return None


async def _basic_auth_user(request: Request) -> User:
    creds = _parse_basic(request.headers.get("Authorization", ""))
    if not creds:
        raise HTTPException(
            status_code=401,
            detail="Catalog requires HTTP Basic auth",
            headers={"WWW-Authenticate": 'Basic realm="Shelfsort OPDS"'},
        )
    email, pw = creds
    doc = await db.users.find_one(
        {"email": email},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "is_admin": 1,
         "opds_enabled": 1, "catalog_password_hash": 1},
    )
    if not doc or not doc.get("opds_enabled") or not doc.get("catalog_password_hash"):
        raise HTTPException(
            status_code=401,
            detail="Catalog not enabled for this user",
            headers={"WWW-Authenticate": 'Basic realm="Shelfsort OPDS"'},
        )
    if not _verify_pw(pw, doc["catalog_password_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Bad catalog credentials",
            headers={"WWW-Authenticate": 'Basic realm="Shelfsort OPDS"'},
        )
    return User(
        user_id=doc["user_id"], email=doc["email"], name=doc.get("name", ""),
        is_admin=bool(doc.get("is_admin", False)),
    )


# ---------------------------------------------------------------------
# XML builders
# ---------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _xe(s: Any) -> str:
    return xml_escape(str(s or ""))


def _base_url(request: Request) -> str:
    """Always returns the public base — uses the incoming Host header.
    Allows operators to override with PUBLIC_BASE_URL env if behind a
    misconfigured proxy."""
    override = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if override:
        return override
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}"


def _feed_header(
    request: Request, feed_id: str, title: str, self_path: str,
    is_acquisition: bool = False,
) -> List[str]:
    base = _base_url(request)
    self_url = f"{base}/api/opds{self_path}"
    root_url = f"{base}/api/opds"
    feed_type = OPDS_ACQUISITION_TYPE if is_acquisition else OPDS_NAVIGATION_TYPE
    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" '
        'xmlns:opds="http://opds-spec.org/2010/catalog" '
        'xmlns:dc="http://purl.org/dc/terms/">',
        f"<id>{_xe(feed_id)}</id>",
        f"<title>{_xe(title)}</title>",
        f"<updated>{_now_iso()}</updated>",
        '<author><name>Shelfsort</name></author>',
        f'<link rel="self"  href="{_xe(self_url)}" type="{feed_type}"/>',
        f'<link rel="start" href="{_xe(root_url)}" type="{OPDS_NAVIGATION_TYPE}"/>',
        f'<link rel="up"    href="{_xe(root_url)}" type="{OPDS_NAVIGATION_TYPE}"/>',
    ]


def _nav_entry(
    request: Request, entry_id: str, title: str, content: str,
    href: str, is_acquisition: bool = False,
) -> List[str]:
    base = _base_url(request)
    full = f"{base}/api/opds{href}"
    type_ = OPDS_ACQUISITION_TYPE if is_acquisition else OPDS_NAVIGATION_TYPE
    return [
        "<entry>",
        f"<id>{_xe(entry_id)}</id>",
        f"<title>{_xe(title)}</title>",
        f"<updated>{_now_iso()}</updated>",
        f"<content type=\"text\">{_xe(content)}</content>",
        f'<link rel="subsection" href="{_xe(full)}" type="{type_}"/>',
        "</entry>",
    ]


def _book_entry(request: Request, book: Dict[str, Any]) -> List[str]:
    base = _base_url(request)
    bid = book["book_id"]
    title = book.get("title") or "(untitled)"
    author = book.get("author") or "Unknown"
    desc = (book.get("description") or "")[:1500]
    fandom = book.get("fandom") or ""
    category = book.get("category") or ""
    updated = book.get("created_at")
    if isinstance(updated, datetime):
        updated_iso = updated.isoformat()
    else:
        updated_iso = updated or _now_iso()
    download_href = f"{base}/api/opds/download/{bid}"
    cover_href = f"{base}/api/opds/cover/{bid}" if book.get("has_cover") else ""

    parts = [
        "<entry>",
        f"<id>urn:shelfsort:book:{_xe(bid)}</id>",
        f"<title>{_xe(title)}</title>",
        f"<author><name>{_xe(author)}</name></author>",
        f"<updated>{_xe(updated_iso)}</updated>",
        f"<dc:language>{_xe(book.get('language') or 'en')}</dc:language>",
    ]
    if category:
        parts.append(f'<category term="{_xe(category)}"/>')
    if fandom:
        parts.append(f'<category term="{_xe(fandom)}" label="Fandom: {_xe(fandom)}"/>')
    if desc:
        parts.append(f'<summary type="text">{_xe(desc)}</summary>')
    if cover_href:
        parts.append(f'<link rel="http://opds-spec.org/image" href="{_xe(cover_href)}" type="image/jpeg"/>')
        parts.append(f'<link rel="http://opds-spec.org/image/thumbnail" href="{_xe(cover_href)}" type="image/jpeg"/>')
    parts.append(
        f'<link rel="http://opds-spec.org/acquisition" '
        f'href="{_xe(download_href)}" type="application/epub+zip" title="Download EPUB"/>'
    )
    parts.append("</entry>")
    return parts


def _paginate_links(
    request: Request, self_path: str, page: int, total: int,
) -> List[str]:
    """Add prev/next/first/last paging links if applicable."""
    base = _base_url(request)
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(1, min(page, total_pages))

    def _u(p: int) -> str:
        sep = "&" if ("?" in self_path) else "?"
        if f"page={page}" in self_path:
            # Strip our own page= and re-add.
            cleaned = re.sub(r"[?&]page=\d+", "", self_path)
            sep = "&" if ("?" in cleaned) else "?"
            return f"{base}/api/opds{cleaned}{sep}page={p}"
        return f"{base}/api/opds{self_path}{sep}page={p}"

    out = []
    if total_pages > 1:
        out.append(f'<link rel="first" href="{_xe(_u(1))}" type="{OPDS_ACQUISITION_TYPE}"/>')
        if page > 1:
            out.append(f'<link rel="previous" href="{_xe(_u(page - 1))}" type="{OPDS_ACQUISITION_TYPE}"/>')
        if page < total_pages:
            out.append(f'<link rel="next" href="{_xe(_u(page + 1))}" type="{OPDS_ACQUISITION_TYPE}"/>')
        out.append(f'<link rel="last" href="{_xe(_u(total_pages))}" type="{OPDS_ACQUISITION_TYPE}"/>')
    return out


# ---------------------------------------------------------------------
# Catalog endpoints
# ---------------------------------------------------------------------

@api_router.get("/opds")
async def opds_root(request: Request):
    user = await _basic_auth_user(request)
    parts = _feed_header(
        request, f"urn:shelfsort:catalog:{user.user_id}",
        f"{user.name or user.email}'s Shelfsort library",
        "", is_acquisition=False,
    )
    parts += _nav_entry(request, "urn:shelfsort:all", "All books", "Every book in your library", "/all", is_acquisition=True)
    parts += _nav_entry(request, "urn:shelfsort:recent", "Recently added", "Newest uploads first", "/recent", is_acquisition=True)
    parts += _nav_entry(request, "urn:shelfsort:fandoms", "By fandom", "Browse by fandom", "/fandoms")
    parts += _nav_entry(request, "urn:shelfsort:authors", "By author", "Browse by author", "/authors")
    parts.append("</feed>")
    return FastResponse(content="\n".join(parts), media_type=OPDS_NAVIGATION_TYPE)


def _q_excluding_archived() -> Dict[str, Any]:
    return {
        "category": {"$nin": ["Old stories", "Trash"]},
        "replaced_by": {"$exists": False},
    }


async def _book_feed(
    request: Request, user_id: str, feed_id: str, title: str, self_path: str,
    extra_filter: Optional[Dict[str, Any]] = None,
    sort: List[Tuple[str, int]] = None,
    page: int = 1,
) -> str:
    q = {"user_id": user_id, **_q_excluding_archived()}
    if extra_filter:
        q.update(extra_filter)
    total = await db.books.count_documents(q)
    cursor = db.books.find(
        q,
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1,
            "category": 1, "language": 1, "description": 1, "has_cover": 1,
            "created_at": 1, "last_refreshed_at": 1,
        },
    )
    if sort:
        cursor = cursor.sort(sort)
    cursor = cursor.skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    books = await cursor.to_list(length=PAGE_SIZE)

    parts = _feed_header(request, feed_id, title, self_path, is_acquisition=True)
    parts += _paginate_links(request, self_path, page, total)
    for b in books:
        parts += _book_entry(request, b)
    parts.append("</feed>")
    return "\n".join(parts)


@api_router.get("/opds/all")
async def opds_all(request: Request, page: int = 1):
    user = await _basic_auth_user(request)
    feed = await _book_feed(
        request, user.user_id, f"urn:shelfsort:all:{user.user_id}",
        "All books", "/all",
        sort=[("title", 1)], page=max(1, int(page or 1)),
    )
    return FastResponse(content=feed, media_type=OPDS_ACQUISITION_TYPE)


@api_router.get("/opds/recent")
async def opds_recent(request: Request, page: int = 1):
    user = await _basic_auth_user(request)
    feed = await _book_feed(
        request, user.user_id, f"urn:shelfsort:recent:{user.user_id}",
        "Recently added", "/recent",
        sort=[("created_at", -1)], page=max(1, int(page or 1)),
    )
    return FastResponse(content=feed, media_type=OPDS_ACQUISITION_TYPE)


@api_router.get("/opds/fandoms")
async def opds_fandoms(request: Request):
    user = await _basic_auth_user(request)
    pipeline = [
        {"$match": {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}, **_q_excluding_archived()}},
        {"$group": {"_id": "$fandom", "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(length=2000)
    parts = _feed_header(
        request, f"urn:shelfsort:fandoms:{user.user_id}",
        "Browse by fandom", "/fandoms",
    )
    for r in rows:
        name = r["_id"] or ""
        if not name:
            continue
        from urllib.parse import quote
        parts += _nav_entry(
            request, f"urn:shelfsort:fandom:{name}", name,
            f"{r['n']} book{'s' if r['n'] != 1 else ''}",
            f"/fandom/{quote(name, safe='')}",
            is_acquisition=True,
        )
    parts.append("</feed>")
    return FastResponse(content="\n".join(parts), media_type=OPDS_NAVIGATION_TYPE)


@api_router.get("/opds/fandom/{name}")
async def opds_fandom(request: Request, name: str, page: int = 1):
    user = await _basic_auth_user(request)
    from urllib.parse import unquote, quote
    decoded = unquote(name)
    feed = await _book_feed(
        request, user.user_id,
        f"urn:shelfsort:fandom:{decoded}",
        f"Fandom: {decoded}",
        f"/fandom/{quote(decoded, safe='')}",
        extra_filter={"fandom": decoded},
        sort=[("title", 1)], page=max(1, int(page or 1)),
    )
    return FastResponse(content=feed, media_type=OPDS_ACQUISITION_TYPE)


@api_router.get("/opds/authors")
async def opds_authors(request: Request):
    user = await _basic_auth_user(request)
    pipeline = [
        {"$match": {"user_id": user.user_id, "author": {"$nin": [None, ""]}, **_q_excluding_archived()}},
        {"$group": {"_id": "$author", "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.books.aggregate(pipeline).to_list(length=2000)
    parts = _feed_header(
        request, f"urn:shelfsort:authors:{user.user_id}",
        "Browse by author", "/authors",
    )
    from urllib.parse import quote
    for r in rows:
        name = r["_id"] or ""
        if not name or name.lower() == "unknown":
            continue
        parts += _nav_entry(
            request, f"urn:shelfsort:author:{name}", name,
            f"{r['n']} book{'s' if r['n'] != 1 else ''}",
            f"/author/{quote(name, safe='')}",
            is_acquisition=True,
        )
    parts.append("</feed>")
    return FastResponse(content="\n".join(parts), media_type=OPDS_NAVIGATION_TYPE)


@api_router.get("/opds/author/{name}")
async def opds_author(request: Request, name: str, page: int = 1):
    user = await _basic_auth_user(request)
    from urllib.parse import unquote, quote
    decoded = unquote(name)
    feed = await _book_feed(
        request, user.user_id,
        f"urn:shelfsort:author:{decoded}",
        f"Author: {decoded}",
        f"/author/{quote(decoded, safe='')}",
        extra_filter={"author": decoded},
        sort=[("created_at", -1)], page=max(1, int(page or 1)),
    )
    return FastResponse(content=feed, media_type=OPDS_ACQUISITION_TYPE)


# ---------------------------------------------------------------------
# Raw file delivery (cover + EPUB)
# ---------------------------------------------------------------------

@api_router.get("/opds/cover/{book_id}")
async def opds_cover(request: Request, book_id: str):
    user = await _basic_auth_user(request)
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "has_cover": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    cover_path = STORAGE_DIR / user.user_id / f"{book_id}.cover"
    if not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover not available")
    return FileResponse(str(cover_path), media_type="image/jpeg")


@api_router.get("/opds/download/{book_id}")
async def opds_download(request: Request, book_id: str):
    user = await _basic_auth_user(request)
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "title": 1, "filename": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    epub_path = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not epub_path.exists():
        raise HTTPException(status_code=404, detail="EPUB file missing on server")
    filename = book.get("filename") or f"{book.get('title','book')}.epub"
    return FileResponse(
        str(epub_path),
        media_type="application/epub+zip",
        filename=filename,
    )
