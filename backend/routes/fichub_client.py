"""FicHub.net API client — fallback / alternative to FanFicFare.

FicHub (https://fichub.net) is a free public service that converts fanfic
URLs into EPUBs. They host the scraping themselves, so when our server's IP
is being rate-limited by AO3 / FFnet, FicHub usually still succeeds. We use
them as a fallback to FanFicFare, never as a parallel fetcher — FicHub is
shared infrastructure and the polite thing is to ask for one fic at a time
with a small gap between requests.

API details (reverse-engineered from the upstream fichub-cli source):

  * `GET https://fichub.net/api/v0/epub?q=<URL>` →
    `{ urls: { epub, mobi, pdf, html },
       hashes: { epub: <sha256> },
       meta: { ... fic metadata ... } }`
  * Then `GET https://fichub.net<urls.epub>` returns the EPUB bytes.
  * No auth required; optional `Authorization: Bearer <api_key>` if the user
    has one (FicHub doesn't currently sell keys but the slot exists).
  * HTTP 403 means the API key was rejected. Missing `urls.epub` in the
    response means the URL is unsupported.

This client is intentionally simple and synchronous-feeling (uses httpx
async). One in-flight request at a time is enforced by `_FETCH_LOCK`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional, Tuple

import httpx


logger = logging.getLogger(__name__)


FICHUB_BASE = "https://fichub.net"
FICHUB_API = f"{FICHUB_BASE}/api/v0/epub"
USER_AGENT = "Shelfsort/1.0 (+fichub-fallback)"
# Sleep between consecutive FicHub fetches. FicHub is shared infra — keep it
# polite. 2 seconds is well under their throttle limits and keeps the
# experience snappy for users who pasted 5-10 URLs.
_FETCH_GAP_SECONDS = 2.0
_FETCH_LOCK = asyncio.Lock()
_last_fetch_ts: float = 0.0


class FichubError(Exception):
    """Raised when a FicHub fetch fails for any reason."""


class FichubUnsupportedURL(FichubError):
    """The URL is recognized by us as a fanfic permalink but FicHub doesn't
    cover the source (or the work is unavailable)."""


async def _wait_for_slot() -> None:
    """Enforce a minimum gap between two consecutive FicHub requests across
    the whole process. Combined with the lock, this means even if a hundred
    user requests fire in parallel they'll be drained one-by-one with a 2s
    gap each — much friendlier than letting them all hit FicHub at once."""
    global _last_fetch_ts
    loop = asyncio.get_event_loop()
    now = loop.time()
    wait = _FETCH_GAP_SECONDS - (now - _last_fetch_ts)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_fetch_ts = loop.time()


async def fichub_fetch_epub(
    source_url: str,
    api_key: Optional[str] = None,
    timeout: float = 60.0,
) -> Tuple[bytes, Dict[str, Any]]:
    """Fetch a single EPUB from FicHub.

    Returns `(epub_bytes, meta)` on success. Raises `FichubUnsupportedURL`
    when FicHub doesn't recognise the URL, `FichubError` for everything
    else (timeout / connection / non-2xx response).

    Serialized: only one in-flight request to FicHub at a time across the
    whole worker, plus a 2-second floor between consecutive requests.
    """
    headers = {"User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with _FETCH_LOCK:
        await _wait_for_slot()
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                # Step 1: ask FicHub to prepare the EPUB and return the URLs.
                meta_resp = await client.get(
                    FICHUB_API,
                    params={"q": source_url},
                    headers=headers,
                )
                if meta_resp.status_code == 403:
                    raise FichubError("FicHub API key rejected (HTTP 403)")
                if meta_resp.status_code >= 400:
                    # 404 / 500 / 502 etc. → treat as transient / unsupported
                    raise FichubError(
                        f"FicHub returned HTTP {meta_resp.status_code} for {source_url}"
                    )
                try:
                    payload = meta_resp.json()
                except ValueError as e:  # pragma: no cover — malformed JSON
                    raise FichubError(f"FicHub returned non-JSON: {e}") from e

                urls = (payload or {}).get("urls") or {}
                epub_rel = urls.get("epub")
                if not epub_rel:
                    raise FichubUnsupportedURL(
                        f"FicHub does not support this URL: {source_url}"
                    )

                # Step 2: download the actual EPUB bytes.
                epub_resp = await client.get(
                    FICHUB_BASE + epub_rel,
                    headers=headers,
                )
                if epub_resp.status_code >= 400:
                    raise FichubError(
                        f"FicHub EPUB download HTTP {epub_resp.status_code}"
                    )
                return epub_resp.content, payload.get("meta") or {}
        except httpx.RequestError as e:
            raise FichubError(f"FicHub network error: {e}") from e
