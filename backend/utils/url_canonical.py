"""URL normalization and canonicalization for known fanfic sources.

Pure helpers — no I/O, no DB, no FastAPI. Extracted from
`routes/books.py` to keep that file under control. The original
module re-exports these symbols so existing imports
(`from routes.books import normalize_fanfic_url`, etc.) keep working.
"""

import re
from typing import Optional


# Generic URL match used to pull URLs out of prose / EPUB body text.
URL_REGEX = re.compile(
    r'(?i)\b((?:https?://|www\.)[^\s<>"\')\]]+)'
)

# Plain-line URL detector used by the "is this a URL list?" heuristic.
_URL_RE = re.compile(r"https?://[^\s,;<>\"']+", re.IGNORECASE)


def _clean_url(u: str) -> str:
    """Strip trailing punctuation that commonly leaks in from prose."""
    return u.rstrip('.,;:)>]"\'')


# AO3 hostname alternation — every official mirror plus mobile / www /
# insecure subdomains. Used by both the source-pattern matcher and the
# canonicalizer below.
_AO3_HOST_RE = (
    r"(?:"
        r"(?:www\.|m\.|insecure\.)?archiveofourown\.(?:org|com|net|gay)"
        r"|ao3\.org"
        r"|archive\.transformativeworks\.org"
    r")"
)


# Surface-level matchers — used when scanning a paste to decide whether
# any line could be a fanfic story URL.
FANFIC_SOURCE_PATTERNS = [
    r'https?://' + _AO3_HOST_RE + r'/(?:collections/[^/?#]+/)?works/\d+',
    r'https?://(?:www\.)?fanfiction\.net/s/\d+',
    r'https?://(?:www\.)?fictionpress\.com/s/\d+',
    r'https?://(?:www\.)?royalroad\.com/fiction/\d+',
    r'https?://(?:forums?\.|www\.)?spacebattles\.com/threads/[\w-]+\.\d+',
    r'https?://(?:forums?\.|www\.)?sufficientvelocity\.com/threads/[\w-]+\.\d+',
    r'https?://(?:forums?\.|www\.)?questionablequesting\.com/threads/[\w-]+\.\d+',
    r'https?://(?:[\w-]+\.)?adult-fanfiction\.org/story\.php\?no=\d+',
    r'https?://(?:www\.)?potionsandsnitches\.(?:org|net)/fanfiction/viewstory\.php\?sid=\d+',
    r'https?://(?:www\.)?twilighted\.net/viewstory\.php\?sid=\d+',
]


# Per-host canonicalization regexes (one capture group → canonical id).
_AO3_WORK_CANON_RE = re.compile(
    r"https?://" + _AO3_HOST_RE + r"/(?:collections/[^/?#]+/)?works/(\d+)",
    re.IGNORECASE,
)
_FFNET_CANON_RE = re.compile(r"https?://(?:www\.)?fanfiction\.net/s/(\d+)", re.IGNORECASE)
_FP_CANON_RE = re.compile(r"https?://(?:www\.)?fictionpress\.com/s/(\d+)", re.IGNORECASE)
_RR_CANON_RE = re.compile(r"https?://(?:www\.)?royalroad\.com/fiction/(\d+)", re.IGNORECASE)
_SB_CANON_RE = re.compile(r"https?://(?:forums?\.|www\.)?spacebattles\.com/threads/([\w-]+\.\d+)", re.IGNORECASE)
_SV_CANON_RE = re.compile(r"https?://(?:forums?\.|www\.)?sufficientvelocity\.com/threads/([\w-]+\.\d+)", re.IGNORECASE)
_QQ_CANON_RE = re.compile(r"https?://(?:forums?\.|www\.)?questionablequesting\.com/threads/([\w-]+\.\d+)", re.IGNORECASE)
_AFF_CANON_RE = re.compile(r"https?://(?:[\w-]+\.)?adult-fanfiction\.org/story\.php\?no=(\d+)", re.IGNORECASE)
_PS_CANON_RE = re.compile(r"https?://(?:www\.)?potionsandsnitches\.(?:org|net)/fanfiction/viewstory\.php\?sid=(\d+)", re.IGNORECASE)
_TWILIGHTED_CANON_RE = re.compile(r"https?://(?:www\.)?twilighted\.net/viewstory\.php\?sid=(\d+)", re.IGNORECASE)


def normalize_fanfic_url(url: Optional[str]) -> Optional[str]:
    """Reduce a fanfic URL to a single canonical form per source site.

    Returns None when the URL doesn't match any known fanfic permalink
    pattern. Different surface forms of the same work (mobile host,
    `www.` prefix, collection prefix, chapter id, fragment, query string,
    http vs https, trailing slash, alternate AO3 hosts like ao3.org or
    archiveofourown.gay) all collapse to the same string.
    """
    if not url:
        return None
    m = _AO3_WORK_CANON_RE.search(url)
    if m:
        return f"https://archiveofourown.org/works/{m.group(1)}"
    m = _FFNET_CANON_RE.search(url)
    if m:
        return f"https://www.fanfiction.net/s/{m.group(1)}"
    m = _FP_CANON_RE.search(url)
    if m:
        return f"https://www.fictionpress.com/s/{m.group(1)}"
    m = _RR_CANON_RE.search(url)
    if m:
        return f"https://www.royalroad.com/fiction/{m.group(1)}"
    m = _SB_CANON_RE.search(url)
    if m:
        return f"https://forums.spacebattles.com/threads/{m.group(1).lower()}"
    m = _SV_CANON_RE.search(url)
    if m:
        return f"https://forums.sufficientvelocity.com/threads/{m.group(1).lower()}"
    m = _QQ_CANON_RE.search(url)
    if m:
        return f"https://forum.questionablequesting.com/threads/{m.group(1).lower()}"
    m = _AFF_CANON_RE.search(url)
    if m:
        return f"https://www.adult-fanfiction.org/story.php?no={m.group(1)}"
    m = _PS_CANON_RE.search(url)
    if m:
        return f"https://www.potionsandsnitches.org/fanfiction/viewstory.php?sid={m.group(1)}"
    m = _TWILIGHTED_CANON_RE.search(url)
    if m:
        return f"https://www.twilighted.net/viewstory.php?sid={m.group(1)}"
    return None


def _canonical_fanfic_url(url: str) -> Optional[str]:
    """Thin alias kept for legacy call sites."""
    return normalize_fanfic_url(url)


# AO3 sub-pages that aren't story permalinks but show up in pasted lists.
_AO3_NON_WORK_PATTERNS = [
    (re.compile(r"https?://" + _AO3_HOST_RE + r"/series/(\d+)", re.IGNORECASE), "ao3_series"),
    (re.compile(r"https?://" + _AO3_HOST_RE + r"/collections/([^/?#]+)/?(?:[?#]|$)", re.IGNORECASE), "ao3_collection"),
    (re.compile(r"https?://" + _AO3_HOST_RE + r"/users/([^/?#]+)(?:/(?:pseuds|works|bookmarks)?/?)?(?:[?#]|$)", re.IGNORECASE), "ao3_user"),
]


# Substring-based "is this an AO3 link?" check — used for source labelling.
_AO3_HOST_SUBSTRINGS = (
    "archiveofourown.org",
    "archiveofourown.com",
    "archiveofourown.net",
    "archiveofourown.gay",
    "ao3.org",
    "archive.transformativeworks.org",
)


def _is_ao3_host(url: str) -> bool:
    u = (url or "").lower()
    return any(h in u for h in _AO3_HOST_SUBSTRINGS)


def classify_ao3_non_work(url: str) -> Optional[str]:
    """If `url` is an AO3 link that isn't a story permalink, return a label
    (`ao3_series`, `ao3_collection`, `ao3_user`); else None.
    """
    if not url or not _is_ao3_host(url):
        return None
    for pat, label in _AO3_NON_WORK_PATTERNS:
        if pat.search(url):
            return label
    return None


def _source_for(u: str) -> str:
    """Human-readable label for the source site of a fanfic URL."""
    u_lower = (u or "").lower()
    if _is_ao3_host(u_lower):
        return "AO3"
    if "fanfiction.net" in u_lower:
        return "FFnet"
    if "fictionpress.com" in u_lower:
        return "FictionPress"
    if "spacebattles.com" in u_lower:
        return "SpaceBattles"
    if "sufficientvelocity.com" in u_lower:
        return "SufficientVelocity"
    if "questionablequesting.com" in u_lower:
        return "QQ"
    if "royalroad" in u_lower:
        return "RoyalRoad"
    if "adult-fanfiction.org" in u_lower:
        return "AFF"
    if "potionsandsnitches" in u_lower:
        return "Potions & Snitches"
    if "twilighted.net" in u_lower:
        return "Twilighted"
    return ""


def _looks_like_url_list(text: str) -> bool:
    """Return True when the input is dominantly fanfic URLs.

    Heuristic: at least 3 lines are URLs (or >40% of non-empty lines), AND
    at least one URL matches a known fanfic source pattern. Stricter than
    "contains any URL" so a manuscript with one footnote URL still gets
    converted as a book.
    """
    if not text or len(text) < 10:
        return False
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return False
    url_lines = [ln for ln in lines if _URL_RE.search(ln)]
    if len(url_lines) < 3 and (len(url_lines) / max(1, len(lines))) < 0.4:
        return False
    return any(_canonical_fanfic_url(ln) for ln in url_lines)
