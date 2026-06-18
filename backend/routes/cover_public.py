"""Public surfaces for the cover ecosystem.

All endpoints in this module are **unauthenticated** so the cover
gallery is discoverable by search-engine crawlers and social-media
preview scrapers (Twitter / Bluesky / Discord / Slack / Facebook).

Surfaces:

* ``GET /api/community-covers/{cover_id}``           — single cover JSON
* ``GET /api/community-covers/explore``              — discovery feed
* ``GET /api/og/cover/{cover_id}.png``               — raw cover PNG
* ``GET /api/og/user/{username}.png``                — generated profile card
* ``GET /api/share/cover/{cover_id}``                — HTML page with OG/Twitter
                                                       meta + JS redirect into the SPA
* ``GET /api/share/u/{username}``                    — HTML page with OG/Twitter
                                                       meta + JS redirect into the SPA
* ``GET /api/cover-archive/{year}/{week}``           — historic #1 winner
* ``GET /api/sitemap.xml``                           — sitemap of public URLs
* ``GET /api/feeds/covers/trending.rss``             — trending feed
* ``GET /api/feeds/covers/user/{username}.rss``      — per-user feed
* ``POST /api/community-covers/{cover_id}/vote-anon``— anon vote-then-convert

Anonymous votes are pinned to a server-set ``sscv`` cookie (Shelfsort
Community Voter) so the same browser can't fluff up a single cover.
"""
from __future__ import annotations

import base64
import html
import io
import secrets
import uuid
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, Response as FastResponse, JSONResponse

from PIL import Image, ImageDraw, ImageFont

from deps import db, api_router, logger, FRONTEND_URL
from models import User
from auth_dep import get_current_user_or_none


# Filesystem location of the shared community-cover PNGs.
# Single source of truth — books.py uses the same path.
_COMMUNITY_COVERS_DIR = Path("/app/community_covers")


def _public_base() -> str:
    """Best-effort guess at the user-facing origin so share URLs in
    sitemap / RSS / meta-tags point at the SPA, not at ``api/...``."""
    return (FRONTEND_URL or "https://shelfsort.app").rstrip("/")


def _cover_thumb_b64(cover_id: str) -> str:
    """Returns the cover PNG as base64.  Empty string if the file
    has vanished (e.g. the sharer unshared it)."""
    p = _COMMUNITY_COVERS_DIR / cover_id
    if not p.exists():
        return ""
    return base64.b64encode(p.read_bytes()).decode("ascii")


# ---------------------------------------------------------------------
# Single cover JSON  (used by the public /cover/:id SPA page)
# ---------------------------------------------------------------------

@api_router.get("/community-covers/{cover_id}")
async def get_single_community_cover(
    cover_id: str,
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Returns a single shared cover.  Public so the /cover/:id SPA
    page can render without forcing a login.  Includes ``voted_by_me``
    when the caller is signed in."""
    rec = await db.community_covers.find_one({"cover_id": cover_id}, {"_id": 0})
    if rec is None or not (_COMMUNITY_COVERS_DIR / rec["file"]).exists():
        raise HTTPException(status_code=404, detail="Community cover not found")
    return {
        "cover_id":          rec["cover_id"],
        "title":             rec.get("title", ""),
        "author":            rec.get("author", ""),
        "fandom":            rec.get("fandom", ""),
        "shared_by":         rec.get("shared_by_username", "anon"),
        "shared_by_user_id": rec.get("shared_by_user_id", ""),
        "votes":             int(rec.get("votes", 0)),
        "import_count":      int(rec.get("import_count", 0)),
        "voted_by_me":       bool(user) and user.user_id in (rec.get("voters") or []),
        "parent_cover_id":   rec.get("parent_cover_id", ""),
        "shared_at":         rec.get("shared_at"),
        "image_base64":      _cover_thumb_b64(rec["file"]),
        "mime_type":         "image/png",
    }


# ---------------------------------------------------------------------
# Discovery feed  (powers /explore/covers)
# ---------------------------------------------------------------------

@api_router.get("/community-covers/explore")
async def explore_community_covers(
    user: Optional[User] = Depends(get_current_user_or_none),
):
    """Aggregate feed for the unauth Explore page.  Three rails:
    `top_of_week`, `trending`, `recent`.  Returns lean thumbnails so
    a first-paint loads fast without the user being signed in."""

    week_cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    trend_cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()

    async def _render_rail(query: Dict[str, Any], sort, limit: int):
        cursor = db.community_covers.find(query, {"_id": 0}).sort(sort).limit(limit)
        rail: List[Dict[str, Any]] = []
        async for r in cursor:
            path = _COMMUNITY_COVERS_DIR / r["file"]
            if not path.exists():
                continue
            rail.append({
                "cover_id":     r["cover_id"],
                "title":        r.get("title", ""),
                "author":       r.get("author", ""),
                "fandom":       r.get("fandom", ""),
                "shared_by":    r.get("shared_by_username", "anon"),
                "votes":        int(r.get("votes", 0)),
                "import_count": int(r.get("import_count", 0)),
                "voted_by_me":  bool(user) and user.user_id in (r.get("voters") or []),
                "image_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
                "mime_type":    "image/png",
            })
        return rail

    top_of_week = await _render_rail(
        {"shared_at": {"$gte": week_cutoff}, "votes": {"$gt": 0}},
        [("votes", -1), ("import_count", -1), ("shared_at", -1)], 6,
    )
    trending = await _render_rail(
        {"shared_at": {"$gte": trend_cutoff}, "votes": {"$gte": 3}},
        [("votes", -1), ("shared_at", -1)], 12,
    )
    recent = await _render_rail(
        {},
        [("shared_at", -1)], 18,
    )
    return {
        "top_of_week": top_of_week,
        "trending":    trending,
        "recent":      recent,
    }


# ---------------------------------------------------------------------
# Anonymous vote — cookie-pinned identity, one heart per browser
# ---------------------------------------------------------------------

ANON_VOTE_COOKIE = "sscv"   # Shelfsort Community Voter


def _get_or_set_anon_id(request: Request, response: Response) -> str:
    """Returns the caller's anon-voter id from the ``sscv`` cookie, or
    mints + stamps a fresh one.  Long-lived so the visitor can come
    back later and toggle their vote off."""
    aid = request.cookies.get(ANON_VOTE_COOKIE)
    if aid and len(aid) <= 64:
        return aid
    aid = f"anon_{uuid.uuid4().hex[:18]}"
    response.set_cookie(
        ANON_VOTE_COOKIE,
        aid,
        max_age=60 * 60 * 24 * 365,   # 1 year
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return aid


@api_router.post("/community-covers/{cover_id}/vote-anon")
async def vote_community_cover_anon(
    cover_id: str,
    request: Request,
    response: Response,
):
    """One-tap heart for unauth visitors.  Stores the anon id in the
    cover's ``voters`` array prefixed with ``anon_`` so authenticated
    aggregations can still filter to "real" votes if they want.

    Returns the post-vote count and a ``signup_prompt`` flag so the
    SPA can pop a "save your vote by signing up" CTA at the high-
    intent moment immediately after the heart fills in."""
    record = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "voters": 1, "votes": 1, "shared_by_user_id": 1, "title": 1},
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Community cover not found")
    aid = _get_or_set_anon_id(request, response)
    voters = set(record.get("voters") or [])
    first_time = aid not in voters
    if first_time:
        voters.add(aid)
        action = "voted"
    else:
        voters.discard(aid)
        action = "unvoted"
    new_count = len(voters)
    await db.community_covers.update_one(
        {"cover_id": cover_id},
        {"$set": {"voters": list(voters), "votes": new_count}},
    )
    if action == "voted":
        # Fire the same milestone notification path the auth flow uses.
        try:
            from utils.cover_notifications import notify_vote_milestone
            await notify_vote_milestone(
                cover_id=cover_id,
                new_vote_count=new_count,
                voter_user_id=None,
            )
        except Exception as e:
            logger.exception("anon vote milestone fan-out failed: %s", e)
    return {
        "ok": True,
        "votes": new_count,
        "voted_by_me": action == "voted",
        "signup_prompt": action == "voted",
    }


# ---------------------------------------------------------------------
# OG images — used by Twitter/Discord/Bluesky/etc.
# ---------------------------------------------------------------------

@api_router.get("/og/cover/{cover_id}.png")
async def og_cover_image(cover_id: str):
    """Cover image with the cover-id encoded in the URL so social media
    can hot-link it.  Detects PNG vs JPEG from the magic bytes (the
    model returns whichever) so the ``Content-Type`` header matches
    what's actually in the file."""
    p = _COMMUNITY_COVERS_DIR / cover_id
    if not p.exists():
        raise HTTPException(status_code=404, detail="Not found")
    data = p.read_bytes()
    media = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    return FastResponse(
        content=data,
        media_type=media,
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _draw_profile_og_png(handle: str, totals: Dict[str, int], thumb_path: Optional[Path]) -> bytes:
    """Renders a 1200×630 social-card PNG with the user's handle, three
    stat columns, and (optionally) their #1 cover thumbnail on the
    left.  Pure-PIL — no headless browser dep.

    Falls back to a clean text-only card if PIL can't find the system
    font (which is the case on slim containers); the layout still
    looks intentional thanks to the asymmetric crop + paper tone."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), color=(245, 242, 234))  # paper
    draw = ImageDraw.Draw(img)

    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 72)
        font_h2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        font_eyebrow = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        font_stat = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 88)
        font_label = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
    except OSError:
        font_title = font_h2 = font_eyebrow = font_stat = font_label = ImageFont.load_default()

    # Thumbnail strip on the left.
    if thumb_path and thumb_path.exists():
        try:
            thumb = Image.open(thumb_path).convert("RGB")
            target_h = 470
            target_w = int(thumb.width * (target_h / thumb.height))
            thumb = thumb.resize((target_w, target_h))
            img.paste(thumb, (60, 80))
            text_x = 60 + target_w + 60
        except Exception:
            text_x = 80
    else:
        text_x = 80

    draw.text((text_x, 80), "SHELFSORT  ·  COVER PROFILE", font=font_eyebrow, fill=(107, 70, 193))
    draw.text((text_x, 120), f"@{handle}", font=font_title, fill=(44, 44, 44))

    stat_y = 280
    columns = [
        (totals.get("shared", 0),  "Covers shared"),
        (totals.get("votes", 0),   "Hearts earned"),
        (totals.get("imports", 0), "Imports"),
    ]
    for i, (n, label) in enumerate(columns):
        col_x = text_x + i * 220
        draw.text((col_x, stat_y), str(n), font=font_stat, fill=(44, 44, 44))
        draw.text((col_x, stat_y + 110), label, font=font_label, fill=(107, 112, 92))

    draw.text((text_x, 540), "shelfsort.app", font=font_h2, fill=(107, 70, 193))

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


@api_router.get("/og/user/{username}.png")
async def og_user_image(username: str):
    """Renders a per-user OG card on-the-fly.  Hits the DB once for the
    profile + once for the top cover; everything else is pure PIL."""
    user_doc = await db.users.find_one(
        {"username": username},
        {"_id": 0, "user_id": 1, "username": 1},
    )
    if user_doc is None:
        raise HTTPException(status_code=404, detail="No such user")
    cursor = (
        db.community_covers.find(
            {"shared_by_user_id": user_doc["user_id"]},
            {"_id": 0, "votes": 1, "import_count": 1, "file": 1},
        )
        .sort([("votes", -1), ("import_count", -1)])
        .limit(1)
    )
    top = None
    async for r in cursor:
        top = r
        break
    cnt = await db.community_covers.count_documents({"shared_by_user_id": user_doc["user_id"]})
    agg_cursor = db.community_covers.find(
        {"shared_by_user_id": user_doc["user_id"]},
        {"_id": 0, "votes": 1, "import_count": 1},
    )
    votes = 0
    imports = 0
    async for r in agg_cursor:
        votes += int(r.get("votes") or 0)
        imports += int(r.get("import_count") or 0)
    thumb = (_COMMUNITY_COVERS_DIR / top["file"]) if top else None
    png = _draw_profile_og_png(
        handle=username,
        totals={"shared": cnt, "votes": votes, "imports": imports},
        thumb_path=thumb,
    )
    return FastResponse(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ---------------------------------------------------------------------
# /api/share/...  — HTML pages with full OG/Twitter meta tags.
#   Crawlers stop here and read the tags; humans get a meta-refresh +
#   <script> redirect into the React SPA so the URL is shareable AND
#   the in-app experience still works.
# ---------------------------------------------------------------------

def _share_html(
    *, title: str, description: str, og_image: str, spa_path: str, og_type: str = "article",
) -> str:
    """Build a minimal HTML page with the right OG / Twitter tags +
    redirect into the SPA.  All inputs are HTML-escaped to be safe."""
    t = html.escape(title)
    d = html.escape(description)
    img = html.escape(og_image)
    canonical = f"{_public_base()}{spa_path}"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{t}</title>
<link rel="canonical" href="{canonical}" />
<meta name="description" content="{d}" />
<meta property="og:type" content="{og_type}" />
<meta property="og:title" content="{t}" />
<meta property="og:description" content="{d}" />
<meta property="og:image" content="{img}" />
<meta property="og:url" content="{canonical}" />
<meta property="og:site_name" content="Shelfsort" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{t}" />
<meta name="twitter:description" content="{d}" />
<meta name="twitter:image" content="{img}" />
<meta http-equiv="refresh" content="0; url={canonical}" />
<style>
body {{
  margin: 0; padding: 4rem 1.5rem; font-family: -apple-system, BlinkMacSystemFont,
  'Segoe UI', Roboto, sans-serif; background: #F5F2EA; color: #2C2C2C; text-align: center;
}}
a {{ color: #6B46C1; font-weight: 600; }}
img {{ max-width: 480px; width: 100%; border-radius: 6px; margin-top: 1.5rem; }}
</style>
</head>
<body>
  <h1 style="font-family: Georgia, serif; font-size: 2rem;">{t}</h1>
  <p>{d}</p>
  <img src="{img}" alt="" />
  <p style="margin-top: 2rem;"><a href="{canonical}">Open on Shelfsort &rarr;</a></p>
  <script>window.location.replace({canonical!r});</script>
</body>
</html>"""


@api_router.get("/share/cover/{cover_id}")
async def share_cover_html(cover_id: str):
    rec = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "title": 1, "author": 1, "shared_by_username": 1, "votes": 1, "file": 1},
    )
    if rec is None or not (_COMMUNITY_COVERS_DIR / rec["file"]).exists():
        raise HTTPException(status_code=404, detail="Not found")
    title = f"\u201c{rec.get('title', 'Untitled')}\u201d — cover by @{rec.get('shared_by_username', 'anon')}"
    desc = (
        f"AI-generated cover for {rec.get('title', '')}"
        + (f" by {rec['author']}" if rec.get("author") else "")
        + f". {int(rec.get('votes', 0))} hearts on Shelfsort."
    )
    base = _public_base()
    return HTMLResponse(_share_html(
        title=title,
        description=desc,
        og_image=f"{base}/api/og/cover/{cover_id}.png",
        spa_path=f"/cover/{cover_id}",
        og_type="article",
    ))


@api_router.get("/share/u/{username}")
async def share_user_html(username: str):
    user_doc = await db.users.find_one(
        {"username": username},
        {"_id": 0, "username": 1, "name": 1},
    )
    if user_doc is None:
        raise HTTPException(status_code=404, detail="Not found")
    name = user_doc.get("name") or username
    title = f"@{username} — cover-sharer on Shelfsort"
    desc = (
        f"{name}'s AI-generated book covers, hearts, and trophies on the "
        "Shelfsort community pool."
    )
    base = _public_base()
    return HTMLResponse(_share_html(
        title=title,
        description=desc,
        og_image=f"{base}/api/og/user/{username}.png",
        spa_path=f"/u/{username}",
        og_type="profile",
    ))


# ---------------------------------------------------------------------
# Cover-of-the-week archive — historic winners
# ---------------------------------------------------------------------

@api_router.get("/cover-archive/{year}/{week}")
async def cover_archive_week(
    year: int,
    week: int,
    user: Optional[User] = Depends(get_current_user_or_none),  # noqa: ARG001
):
    """Returns the cover that held #1 for ISO-week ``year``-``week``.
    Built from the ``cover_archive`` collection which the daily
    leaderboard tick writes to whenever a new winner is crowned."""
    if not (1 <= week <= 53) or not (2024 <= year <= 2100):
        raise HTTPException(status_code=400, detail="Invalid year/week")
    doc = await db.cover_archive.find_one(
        {"iso_year": year, "iso_week": week},
        {"_id": 0},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="No archive entry for that week")
    return doc


@api_router.get("/cover-archive")
async def cover_archive_index(
    user: Optional[User] = Depends(get_current_user_or_none),  # noqa: ARG001
    limit: int = 26,
):
    """Most-recent N archived weeks (default 26 = half a year).  Used
    by the public archive page so visitors can scroll the leaderboard
    backwards in time."""
    limit = max(1, min(int(limit), 200))
    cursor = (
        db.cover_archive.find({}, {"_id": 0})
        .sort([("iso_year", -1), ("iso_week", -1)])
        .limit(limit)
    )
    return {"weeks": [d async for d in cursor]}


# ---------------------------------------------------------------------
# Sitemap.xml — list of public URLs for search engines
# ---------------------------------------------------------------------

@api_router.get("/sitemap.xml")
async def sitemap_xml():
    base = _public_base()
    urls: List[str] = [f"{base}/", f"{base}/explore/covers"]
    # Profiles
    async for u in db.users.find(
        {"username": {"$exists": True, "$ne": ""}},
        {"_id": 0, "username": 1},
    ).limit(5000):
        urls.append(f"{base}/u/{u['username']}")
    # Covers
    async for c in db.community_covers.find({}, {"_id": 0, "cover_id": 1}).limit(20000):
        urls.append(f"{base}/cover/{c['cover_id']}")
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(f"  <url><loc>{html.escape(u)}</loc></url>" for u in urls)
        + "\n</urlset>\n"
    )
    return FastResponse(content=body, media_type="application/xml")


# ---------------------------------------------------------------------
# RSS feeds — trending + per-user
# ---------------------------------------------------------------------

def _rss_envelope(title: str, link: str, description: str, items_xml: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        '<channel>\n'
        f"  <title>{html.escape(title)}</title>\n"
        f"  <link>{html.escape(link)}</link>\n"
        f"  <description>{html.escape(description)}</description>\n"
        f"{items_xml}"
        "</channel>\n</rss>\n"
    )


def _rss_item(title: str, link: str, description: str, pub_date: str) -> str:
    return (
        "  <item>\n"
        f"    <title>{html.escape(title)}</title>\n"
        f"    <link>{html.escape(link)}</link>\n"
        f"    <guid isPermaLink=\"true\">{html.escape(link)}</guid>\n"
        f"    <description>{html.escape(description)}</description>\n"
        f"    <pubDate>{html.escape(pub_date)}</pubDate>\n"
        "  </item>\n"
    )


@api_router.get("/feeds/covers/trending.rss")
async def feed_trending_rss():
    base = _public_base()
    week_cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    cursor = (
        db.community_covers.find(
            {"shared_at": {"$gte": week_cutoff}, "votes": {"$gt": 0}},
            {"_id": 0},
        )
        .sort([("votes", -1), ("shared_at", -1)])
        .limit(30)
    )
    items: List[str] = []
    async for r in cursor:
        items.append(_rss_item(
            title=f"\u201c{r.get('title', 'Untitled')}\u201d — {int(r.get('votes', 0))} hearts",
            link=f"{base}/cover/{r['cover_id']}",
            description=(
                f"Cover by @{r.get('shared_by_username', 'anon')} for "
                f"{r.get('title', 'Untitled')}"
                + (f" by {r['author']}" if r.get("author") else "")
            ),
            pub_date=r.get("shared_at", ""),
        ))
    return FastResponse(
        content=_rss_envelope(
            title="Shelfsort — Trending community covers",
            link=f"{base}/explore/covers",
            description="The hottest AI-generated covers on Shelfsort this week.",
            items_xml="".join(items),
        ),
        media_type="application/rss+xml",
    )


@api_router.get("/feeds/covers/user/{username}.rss")
async def feed_user_rss(username: str):
    user_doc = await db.users.find_one(
        {"username": username}, {"_id": 0, "user_id": 1, "username": 1},
    )
    if user_doc is None:
        raise HTTPException(status_code=404, detail="No such user")
    base = _public_base()
    cursor = (
        db.community_covers.find(
            {"shared_by_user_id": user_doc["user_id"]},
            {"_id": 0},
        )
        .sort("shared_at", -1)
        .limit(50)
    )
    items: List[str] = []
    async for r in cursor:
        items.append(_rss_item(
            title=f"@{username} shared \u201c{r.get('title', 'Untitled')}\u201d",
            link=f"{base}/cover/{r['cover_id']}",
            description=(
                f"AI cover for {r.get('title', 'Untitled')}"
                + (f" by {r['author']}" if r.get("author") else "")
                + f". {int(r.get('votes', 0))} hearts."
            ),
            pub_date=r.get("shared_at", ""),
        ))
    return FastResponse(
        content=_rss_envelope(
            title=f"Shelfsort — @{username}'s community covers",
            link=f"{base}/u/{username}",
            description=f"AI-generated covers shared by @{username} on Shelfsort.",
            items_xml="".join(items),
        ),
        media_type="application/rss+xml",
    )


__all__ = []
