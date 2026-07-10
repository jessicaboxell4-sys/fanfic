"""Unknown-source detector + recorder.

When a URL looks story-shaped (eFiction-style path, forum thread,
`/works/N`, `/s/N`, etc.) but doesn't match any of the 10 currently
accepted fanfic sources, we want to capture it so the user (and
Shelfsort's dev) can decide whether to add the host to the accepted
list. This module owns:

* `looks_like_fanfic_url(url)` — fast path-pattern heuristic that
  rejects google.com / twitter.com / generic footnote URLs while
  catching almost every fic archive layout we've seen.
* `record_unknown_sources(...)` — async upsert into the
  `unknown_sources` Mongo collection, idempotent, keeps the top-5
  sample URLs per host plus per-context hit counts.

Pure helpers below `looks_like_fanfic_url`; the recorder takes the
Mongo handle so this module stays import-time DB-free.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import re

from utils.url_canonical import normalize_fanfic_url, classify_ao3_non_work


# Path tokens that signal "this URL points at a story / thread / chapter
# on some fic archive" — used to ignore non-story links (homepages,
# social profiles, footnote references to wikipedia, etc.).
_STORY_PATH_PATTERNS = [
    re.compile(r"/works/\d+", re.IGNORECASE),               # AO3 / eFiction sites
    re.compile(r"/work/\d+", re.IGNORECASE),                 # singular variant
    re.compile(r"/s/\d+", re.IGNORECASE),                    # FFnet/FP
    re.compile(r"/story/\d+", re.IGNORECASE),                # generic
    re.compile(r"/story\.php\?[^#]*\b(?:no|id|sid)=\d+", re.IGNORECASE),
    re.compile(r"/viewstory\.php\?[^#]*\b(?:sid|id)=\d+", re.IGNORECASE),
    re.compile(r"/fiction/\d+", re.IGNORECASE),              # RoyalRoad-style
    re.compile(r"/threads?/[\w-]+\.\d+", re.IGNORECASE),     # Xenforo forums
    re.compile(r"/chapter/\d+", re.IGNORECASE),
    re.compile(r"/read/\d+", re.IGNORECASE),
    re.compile(r"/fic/\d+", re.IGNORECASE),
    re.compile(r"/novel/\d+", re.IGNORECASE),
    re.compile(r"/series/\d+", re.IGNORECASE),               # eFiction series page
]


# Hosts we never want to flag as "potential fanfic source" — public
# tooling, social, search, news, generic CDNs. Cheap denylist; the
# story-path heuristic is the primary filter, this just trims obvious
# noise that happens to slip past it (e.g. archive.org snapshots).
_NEVER_FANFIC_HOSTS = {
    "youtube.com", "youtu.be", "twitter.com", "x.com", "facebook.com",
    "instagram.com", "tiktok.com", "reddit.com", "github.com",
    "google.com", "google.co.uk", "duckduckgo.com", "bing.com",
    "wikipedia.org", "en.wikipedia.org", "tvtropes.org",
    "amazon.com", "goodreads.com", "ebay.com",
    "imgur.com", "tumblr.com", "discord.com", "discord.gg",
    "patreon.com", "ko-fi.com", "paypal.com", "stripe.com",
    "archive.org",
}


def _host_of(url: str) -> Optional[str]:
    try:
        h = (urlparse(url).hostname or "").lower()
    except Exception:
        return None
    if not h:
        return None
    # Drop common subdomain noise so `m.fanfiction.net` and
    # `www.fanfiction.net` group under the same root host record.
    for prefix in ("www.", "m.", "mobile.", "insecure."):
        if h.startswith(prefix):
            return h[len(prefix):]
    return h


def looks_like_fanfic_url(url: str) -> bool:
    """True when `url`'s path looks like a story permalink on some archive.

    Used to suppress noise — we only log URLs we'd consider candidates
    for the accepted-list. Catches every site already in the list (so
    `normalize_fanfic_url` returning None + this returning True is a
    strong signal the host is a new fic archive worth surfacing).
    """
    if not url:
        return False
    host = _host_of(url)
    if not host or host in _NEVER_FANFIC_HOSTS:
        return False
    # Anchor to URL path/query, not the host.
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    target = (parsed.path or "") + ("?" + parsed.query if parsed.query else "")
    return any(p.search(target) for p in _STORY_PATH_PATTERNS)


async def record_unknown_sources(
    db,
    urls: Iterable[str],
    *,
    context: str,
    user_id: Optional[str] = None,
    book_id: Optional[str] = None,
    book_title: Optional[str] = None,
    book_author: Optional[str] = None,
    skip_heuristic: bool = False,
    note: Optional[str] = None,
) -> List[str]:
    """Upsert story-shaped URLs whose host isn't on the accepted list.

    Returns the de-duplicated list of HOSTS that were just recorded (for
    the API response → toast). Each host record keeps the 5 most recent
    sample URLs, first_seen, last_seen, per-context hit counts, the most
    recent user_id, and the most recent book_id/title/author when the
    capture context was an EPUB upload.

    Already-accepted hosts (those for which `normalize_fanfic_url`
    returns non-None) are skipped. AO3 non-work links (series, user,
    collection pages) are also skipped — those have their own bucket on
    the dedupe screen.

    `skip_heuristic=True` — bypass the `looks_like_fanfic_url` path-
    pattern check. Used by the manual-add endpoint where the user is
    explicitly vouching for a URL that might not look story-shaped
    (e.g. they pasted just a homepage of a new archive they want added).
    The accepted-list check is still enforced; we never log a host the
    canonicalizer already knows about.

    `note` — optional user-supplied comment ("friend mentioned this") that
    persists on the host record as `last_note` for context next session.
    """
    if context not in {"upload", "paste", "claim", "manual"}:
        context = "paste"
    now = datetime.now(timezone.utc)
    hosts_recorded: List[str] = []
    seen_hosts: set = set()
    for raw in urls:
        if not raw:
            continue
        if normalize_fanfic_url(raw) or classify_ao3_non_work(raw):
            continue
        if not skip_heuristic and not looks_like_fanfic_url(raw):
            continue
        host = _host_of(raw)
        if not host or host in seen_hosts:
            continue
        seen_hosts.add(host)

        update: Dict[str, Any] = {
            "$setOnInsert": {"host": host, "first_seen": now},
            "$set": {"last_seen": now},
            "$inc": {
                "hit_count": 1,
                f"contexts.{context}": 1,
            },
            "$push": {
                "samples": {
                    "$each": [raw[:500]],
                    "$slice": -5,  # keep the 5 most recent
                },
            },
        }
        if user_id:
            update["$set"]["last_user_id"] = user_id
        if context == "upload":
            if book_id:
                update["$set"]["last_book_id"] = book_id
            if book_title:
                update["$set"]["last_book_title"] = book_title[:200]
            if book_author:
                update["$set"]["last_book_author"] = book_author[:200]
        if note:
            update["$set"]["last_note"] = note[:500]

        await db.unknown_sources.update_one(
            {"host": host},
            update,
            upsert=True,
        )
        hosts_recorded.append(host)
    return hosts_recorded
