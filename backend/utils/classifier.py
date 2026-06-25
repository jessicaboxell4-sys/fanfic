"""Book classification — Phase-6 split #3.

Pulls the heuristic + AI-driven classifier out of ``routes/books.py``.

Two-stage pipeline:

1. ``classify_by_metadata`` — keyword scan over title/author/description/
   sample text against the ``FANDOM_KEYWORDS`` table.  Cheap, runs first.
2. ``classify_with_ai`` — Claude Sonnet fallback when the metadata
   confidence is low.  Respects the ``ai_classify_enabled`` feature
   flag so an admin can pause Claude calls (cost control).

``classify_book`` orchestrates the two and returns whichever yields
higher confidence.

Depends on:
  - ``deps.EMERGENT_LLM_KEY`` for the Anthropic API key
  - ``utils.tags._normalize_tags`` for tag canonicalization
  - ``utils.feature_flags.is_enabled`` for the admin kill switch
  - ``utils.epub_metadata.NONFICTION_SIGNALS``
  - ``routes/books.FANDOM_KEYWORDS`` + ``FANFIC_SIGNALS`` (late-bound to
    avoid an import cycle — these tables live with the route module
    because they're also referenced by the upload pipeline + admin
    fandom-merge tooling)
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from typing import Any, Dict

from emergentintegrations.llm.chat import LlmChat, UserMessage

from deps import EMERGENT_LLM_KEY
from utils.tags import _normalize_tags
from utils.epub_metadata import NONFICTION_SIGNALS

logger = logging.getLogger(__name__)


def _get_fandom_keywords() -> Dict[str, Any]:
    """Late-bound accessor for the fandom keyword bank that still lives
    in ``routes.books``.  Avoids the import cycle (books imports this
    module to expose the classifier; this module would otherwise need
    to import books to reach FANDOM_KEYWORDS)."""
    from routes.books import FANDOM_KEYWORDS   # noqa: WPS433
    return FANDOM_KEYWORDS


# ------------------------------------------------------------------ #
# Mongo-backed keyword overlay (Phase-6 character-hint editor)        #
#                                                                     #
# Lets admins extend the static FANDOM_KEYWORDS at runtime by writing #
# to the `fandom_keyword_overlay` collection (one doc per fandom).    #
# Cached for 60 s so the classifier doesn't issue a Mongo round-trip  #
# per upload.  Admins can force a flush via                           #
# ``invalidate_fandom_overlay_cache()`` after editing.                #
# ------------------------------------------------------------------ #
import time as _time

_OVERLAY_CACHE: Dict[str, Any] = {"data": None, "fetched_at": 0.0}
_OVERLAY_TTL_SECONDS = 60.0


def invalidate_fandom_overlay_cache() -> None:
    """Force the next classification to re-fetch the overlay from Mongo."""
    _OVERLAY_CACHE["data"] = None
    _OVERLAY_CACHE["fetched_at"] = 0.0


async def _get_fandom_overlay() -> Dict[str, list]:
    """Async: return ``{fandom: [extra_keywords]}`` from Mongo with a
    short TTL cache.  Returns ``{}`` on any error so the classifier
    always falls back to the static table."""
    now = _time.time()
    if _OVERLAY_CACHE["data"] is not None and (now - _OVERLAY_CACHE["fetched_at"]) < _OVERLAY_TTL_SECONDS:
        return _OVERLAY_CACHE["data"]
    try:
        from deps import db  # late-bound; deps imports happen elsewhere
        rows = await db.fandom_keyword_overlay.find(
            {}, {"_id": 0, "fandom": 1, "keywords": 1}
        ).to_list(500)
        merged: Dict[str, list] = {}
        for r in rows:
            f = (r.get("fandom") or "").strip()
            kws = [k.strip().lower() for k in (r.get("keywords") or []) if k]
            if f and kws:
                merged.setdefault(f, []).extend(kws)
        _OVERLAY_CACHE["data"] = merged
        _OVERLAY_CACHE["fetched_at"] = now
        return merged
    except Exception as e:  # noqa: BLE001
        logger.warning("fandom overlay fetch failed (using static only): %s", e)
        _OVERLAY_CACHE["data"] = {}
        _OVERLAY_CACHE["fetched_at"] = now
        return {}


def _merge_keywords_sync(overlay: Dict[str, list]) -> Dict[str, list]:
    """Combine the static FANDOM_KEYWORDS dict with the overlay.  Used
    by both sync and async classify entry points."""
    base = _get_fandom_keywords()
    out: Dict[str, list] = {f: list(kws) for f, kws in base.items()}
    for f, kws in overlay.items():
        if f in out:
            out[f].extend(kws)
        else:
            out[f] = list(kws)
    return out


def _get_fanfic_signals():
    from routes.books import FANFIC_SIGNALS   # noqa: WPS433
    return FANFIC_SIGNALS


def classify_by_metadata(meta: Dict[str, Any], overlay: Dict[str, list] = None) -> Dict[str, Any]:
    """Heuristic keyword classification. Returns dict with category, fandom, confidence.

    Crossover detection: when 2+ fandoms each have ≥2 distinct keyword
    matches in the blob, the result's ``fandom`` is the alphabetized
    crossover string (``"A / B / C"``).  Otherwise the single highest-
    scoring fandom wins (legacy behavior).

    ``overlay`` is the Mongo-backed extension table; pass ``None`` for
    the static-only behavior (used by sync callers / tests).  See
    ``classify_book`` for the async entry point that pulls the overlay.
    """
    blob = " ".join([
        meta.get("title", ""),
        meta.get("author", ""),
        meta.get("description", ""),
        meta.get("publisher", ""),
        meta.get("sample_text", "")[:2000],
    ]).lower()

    fandom_keywords = _merge_keywords_sync(overlay or {})
    # Count DISTINCT keyword hits per fandom (a fandom whose name string
    # accidentally contains another fandom's keyword shouldn't double-
    # dip; using a set keeps each keyword's contribution to 1).
    per_fandom_hits: Dict[str, set] = {}
    for fandom, keywords in fandom_keywords.items():
        hits = {kw for kw in keywords if kw and kw in blob}
        if hits:
            per_fandom_hits[fandom] = hits

    is_fanfic = any(s in blob for s in _get_fanfic_signals())
    is_nonfic = any(s in blob for s in NONFICTION_SIGNALS)

    # Crossover detection — pick every fandom with ≥2 distinct hits.
    # A 1-hit fandom is too weak to be a "second fandom in the work";
    # if all hits sit on one fandom that's still the single-winner case
    # below.
    strong = {f: hits for f, hits in per_fandom_hits.items() if len(hits) >= 2}
    if len(strong) >= 2:
        # Multi-fandom crossover.  Alphabetize so "A / B" == "B / A".
        crossover = " / ".join(sorted(strong.keys(), key=lambda x: x.lower()))
        total_hits = sum(len(h) for h in strong.values())
        return {
            "category":   "Fanfiction",
            "fandom":     crossover,
            "confidence": min(0.7 + 0.05 * total_hits, 0.95),
            "classifier": "metadata",
        }

    # Single-fandom path — unchanged from the original behavior.
    if per_fandom_hits:
        best = max(per_fandom_hits.items(), key=lambda kv: len(kv[1]))
        best_fandom, best_hits = best[0], best[1]
        best_count = len(best_hits)
        if best_count >= 1:
            return {
                "category":   "Fanfiction",
                "fandom":     best_fandom,
                "confidence": min(0.6 + 0.1 * best_count, 0.95),
                "classifier": "metadata",
            }
    if is_fanfic:
        return {"category": "Fanfiction", "fandom": "Other", "confidence": 0.7, "classifier": "metadata"}
    if is_nonfic:
        return {"category": "Non-fiction", "fandom": None, "confidence": 0.7, "classifier": "metadata"}

    return {"category": "Unclassified", "fandom": None, "confidence": 0.2, "classifier": "metadata"}


async def classify_with_ai(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Use Claude to classify when metadata heuristics are uncertain."""
    if not EMERGENT_LLM_KEY:
        return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}

    # Feature-flag kill switch — admin can pause Claude calls (e.g. cost control).
    from utils.feature_flags import is_enabled
    if not await is_enabled("ai_classify_enabled"):
        return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai_disabled"}

    # Test hook: when set, return this canned JSON instead of calling Claude.
    canned = os.environ.get("SHELFSORT_TEST_AI_RESPONSE")
    if canned:
        try:
            obj = json.loads(canned)
            return {
                "category":   obj.get("category", "Unclassified"),
                "fandom":     obj.get("fandom"),
                "confidence": float(obj.get("confidence", 0.8)),
                "classifier": "ai",
                "tags":       _normalize_tags(obj.get("tags") or []),
            }
        except Exception:
            pass

    system_msg = (
        "You are a librarian classifying ebooks. Given book metadata, respond with strict JSON only: "
        '{"category": "Fanfiction|Original Fiction|Non-fiction", "fandom": "<specific fandom name, or null if not fanfiction>", "confidence": 0.0-1.0, "tags": ["tag1","tag2","tag3"]}. '
        "Use Fanfiction only when it is clearly fan-derived from another work. "
        "For original fiction novels (even popular ones like the actual Harry Potter series by Rowling), use Original Fiction, not Fanfiction. "
        "Fandom names: use AO3's canonical tag form. For multi-property franchises with distinct sub-fandoms, bucket into the specific sub-fandom rather than the umbrella. "
        "Examples: Stargate SG-1 (NOT 'Stargate'), Stargate Atlantis, Stargate Universe, Stargate (Movies). "
        "Common fandoms: Harry Potter, Twilight, Marvel, DC Comics, Star Wars, Lord of the Rings, Sherlock Holmes, Percy Jackson and the Olympians, Heroes of Olympus, Trials of Apollo, Magnus Chase, The Kane Chronicles, Doctor Who, Supernatural, Game of Thrones, Hunger Games, Naruto, My Hero Academia, BTS, One Direction, Stargate SG-1, Stargate Atlantis, Stargate Universe, Stargate (Movies). "
        "If a work spans multiple sub-fandoms, return them joined with ' / ' (e.g. 'Stargate SG-1 / Stargate Atlantis') so it lands on the crossover shelf. "
        "Tags: 2-4 short lowercase descriptive labels (e.g. 'fluff', 'angst', 'au', 'wip', 'slow-burn', 'enemies-to-lovers', 'romance', 'mystery', 'historical', 'biography', 'self-help'). "
        "Return ONLY the JSON object, no markdown."
    )
    user_text = (
        f"Title: {meta.get('title','')}\n"
        f"Author: {meta.get('author','')}\n"
        f"Publisher: {meta.get('publisher','')}\n"
        f"Description: {meta.get('description','')[:600]}\n"
        f"Sample text: {meta.get('sample_text','')[:800]}"
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"classify-{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=user_text))
        text = resp.strip()
        # Instrument — log call to llm_usage for the admin key-health card.
        # Imported lazily so a Mongo blip can't break classification.
        try:
            from utils.llm_usage import log_llm_call
            await log_llm_call(
                "classify", "claude-sonnet-4-6",
                prompt_text=system_msg + "\n" + user_text,
                response_text=text,
                status="ok",
            )
        except Exception:
            pass
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            obj = json.loads(m.group(0))
            cat = obj.get('category', 'Unclassified')
            fandom = obj.get('fandom')
            if fandom in (None, "null", "None", ""):
                fandom = None
            conf = float(obj.get('confidence', 0.5))
            return {
                "category":   cat,
                "fandom":     fandom,
                "confidence": conf,
                "classifier": "ai",
                "tags":       _normalize_tags(obj.get("tags") or []),
            }
    except Exception as e:
        logger.error(f"AI classify failed: {e}")
        try:
            from utils.llm_usage import log_llm_call
            await log_llm_call(
                "classify", "claude-sonnet-4-6",
                prompt_text=system_msg + "\n" + user_text,
                status="error",
                error=str(e),
            )
        except Exception:
            pass
    return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}


async def classify_book(meta: Dict[str, Any], force_ai: bool = False) -> Dict[str, Any]:
    """Two-stage classifier — heuristic first, AI fallback when confidence is low.

    Pulls the Mongo-backed keyword overlay once per call and feeds it
    into ``classify_by_metadata`` so admin-curated character hints
    contribute to the heuristic detection (including crossover
    detection from character names — see Phase-6 character-hint editor).

    Crossover-gap logging (Session 2): when the AI classifier returns a
    multi-fandom crossover (``"A / B"``) but the heuristic only caught a
    subset (or nothing), log a row to ``crossover_suggestions`` so an
    admin can review and curate new character keywords into the overlay.
    """
    overlay = await _get_fandom_overlay()
    heuristic_result = classify_by_metadata(meta, overlay=overlay)
    if not force_ai and heuristic_result['confidence'] >= 0.6:
        return heuristic_result
    ai_result = await classify_with_ai(meta)
    if ai_result['confidence'] > 0:
        # Fire-and-forget gap detection. Never blocks classification.
        try:
            await _maybe_log_crossover_gap(meta, ai_result, heuristic_result)
        except Exception as e:  # noqa: BLE001
            logger.warning("crossover gap logging failed (non-fatal): %s", e)
        return ai_result
    return heuristic_result


def _split_crossover(fandom: Any) -> list[str]:
    """Parse ``"A / B / C"`` → ``["A","B","C"]``. Empty/None → []."""
    if not isinstance(fandom, str) or not fandom.strip():
        return []
    return [p.strip() for p in fandom.split(" / ") if p.strip()]


async def _maybe_log_crossover_gap(
    meta: Dict[str, Any],
    ai_result: Dict[str, Any],
    heuristic_result: Dict[str, Any],
) -> None:
    """Log a ``crossover_suggestions`` row when the AI sees a crossover
    the heuristic missed.  Idempotent per (title, author, gap_set) so a
    re-classify of the same book doesn't spam the admin inbox."""
    ai_fandoms = _split_crossover(ai_result.get("fandom"))
    if len(ai_fandoms) < 2:
        return  # not a crossover from AI's perspective
    heuristic_fandoms = _split_crossover(heuristic_result.get("fandom"))
    gap_fandoms = [f for f in ai_fandoms if f not in heuristic_fandoms]
    if not gap_fandoms:
        return  # heuristic already caught all of them
    # Dedup key — same title+author+gap set shouldn't write twice.
    title  = (meta.get("title")  or "").strip()
    author = (meta.get("author") or "").strip()
    gap_key = "|".join(sorted(gap_fandoms))
    dedup_key = f"{title.lower()}::{author.lower()}::{gap_key.lower()}"

    from deps import db
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    desc = (meta.get("description") or "")[:400]
    sample = (meta.get("sample_text") or "")[:600]
    await db.crossover_suggestions.update_one(
        {"dedup_key": dedup_key},
        {
            "$setOnInsert": {
                "dedup_key":         dedup_key,
                "status":            "pending",
                "created_at":        now,
                "title":             title,
                "author":            author,
                "ai_fandoms":        ai_fandoms,
                "heuristic_fandoms": heuristic_fandoms,
                "gap_fandoms":       gap_fandoms,
                "meta_snapshot": {
                    "title":       title,
                    "author":      author,
                    "description": desc,
                    "sample_text": sample,
                    "publisher":   (meta.get("publisher") or "")[:120],
                },
            },
            "$inc": {"sightings": 1},
            "$set": {"last_seen_at": now},
        },
        upsert=True,
    )


__all__ = ["classify_by_metadata", "classify_with_ai", "classify_book", "invalidate_fandom_overlay_cache"]
