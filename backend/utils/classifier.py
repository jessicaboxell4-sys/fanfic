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


def _get_fanfic_signals():
    from routes.books import FANFIC_SIGNALS   # noqa: WPS433
    return FANFIC_SIGNALS


def classify_by_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Heuristic keyword classification. Returns dict with category, fandom, confidence."""
    blob = " ".join([
        meta.get("title", ""),
        meta.get("author", ""),
        meta.get("description", ""),
        meta.get("publisher", ""),
        meta.get("sample_text", "")[:2000],
    ]).lower()

    fandom_keywords = _get_fandom_keywords()
    matched_fandom = None
    best_count = 0
    for fandom, keywords in fandom_keywords.items():
        count = sum(1 for kw in keywords if kw in blob)
        if count > best_count:
            best_count = count
            matched_fandom = fandom

    is_fanfic = any(s in blob for s in _get_fanfic_signals())
    is_nonfic = any(s in blob for s in NONFICTION_SIGNALS)

    if matched_fandom and best_count >= 1:
        return {
            "category":   "Fanfiction",
            "fandom":     matched_fandom,
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
    return {"category": "Unclassified", "fandom": None, "confidence": 0.0, "classifier": "ai"}


async def classify_book(meta: Dict[str, Any], force_ai: bool = False) -> Dict[str, Any]:
    """Two-stage classifier — heuristic first, AI fallback when confidence is low."""
    if not force_ai:
        meta_result = classify_by_metadata(meta)
        if meta_result['confidence'] >= 0.6:
            return meta_result
    ai_result = await classify_with_ai(meta)
    if ai_result['confidence'] > 0:
        return ai_result
    return classify_by_metadata(meta)


__all__ = ["classify_by_metadata", "classify_with_ai", "classify_book"]
