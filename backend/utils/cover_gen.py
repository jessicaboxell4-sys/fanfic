"""AI cover generation for cover-less / ugly EPUBs.

Wraps the Emergent Universal LLM key + nano-banana
(`gemini-3.1-flash-image-preview`) into a single
``generate_cover(book_doc, nudge=None)`` coroutine that returns raw PNG
bytes plus a redacted prompt string for the audit log.

Design choices (locked-in 2026-06-17 after user sign-off):
- 2:3 vertical book-cover aspect, ~600x900.
- Sage / cream / warm palette matching the Shelfsort aesthetic.
- Symbolic / atmospheric — *not* fan-art photorealism.  Avoids
  character-likeness copyright / real-person uncanny-valley issues.
- No human faces.
- Title + author embedded in the generated image (we ask the model to
  render serif typography directly so the cover is still readable as a
  book, not just art).
- Single image, single call, no chat history retained.
"""
from __future__ import annotations

import base64
import os
import uuid
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

from deps import logger

load_dotenv()


def _truncate(s: Optional[str], n: int = 180) -> str:
    """Trim model-fed description text so we don't blow the prompt
    budget on long fic synopses."""
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + "…"


def _build_prompt(book: Dict[str, Any], nudge: Optional[str] = None) -> str:
    """Compose a single text prompt for nano-banana.

    Pulls title, author, fandom, top tags, and a short description
    excerpt.  ``nudge`` is the optional one-liner the user can type
    (e.g. "more moody" / "include a lantern motif") — appended verbatim
    near the end so the model treats it as the most recent instruction.
    """
    title    = (book.get("title") or "Untitled").strip()
    author   = (book.get("author") or "Unknown").strip()
    fandom   = (book.get("fandom") or "").strip()
    tags     = book.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    tags_str = ", ".join(t for t in tags[:6] if t)
    desc     = _truncate(book.get("description") or book.get("summary") or "")

    # Build the structured prompt.  Order matters: rules first so the
    # model treats them as hard constraints, then the book-specific
    # context.
    rules = (
        "Design a vertical 2:3 aspect-ratio book cover (≈600×900). "
        "Style: symbolic, atmospheric, and tasteful — think small-press "
        "literary fiction. "
        "Palette: sage green, warm cream, soft slate, muted gold accents. "
        "Render the title and author directly on the cover in an elegant "
        "serif typeface, centred or top-aligned with comfortable margins. "
        "STRICT RULES: "
        "1. No human faces, no recognisable real people, no celebrity "
        "likenesses. "
        "2. No copyrighted character designs — evoke fandoms through "
        "props, symbols, and atmosphere only (lanterns, moths, forests, "
        "rain, runes, stars, etc.), never through known character art. "
        "3. No watermarks, no logos, no fictional publisher marks. "
        "4. The typography must be legible and spelled exactly as given."
    )
    context_lines = [
        f"Title: {title}",
        f"Author: {author}",
    ]
    if fandom:
        context_lines.append(f"Fandom mood: {fandom}")
    if tags_str:
        context_lines.append(f"Tags / themes: {tags_str}")
    if desc:
        context_lines.append(f"Short synopsis: {desc}")
    context = "\n".join(context_lines)

    prompt = f"{rules}\n\nBook details:\n{context}"
    if nudge and nudge.strip():
        prompt += f"\n\nExtra direction from the reader: {nudge.strip()}"
    return prompt


async def generate_cover(
    book: Dict[str, Any],
    nudge: Optional[str] = None,
) -> Tuple[bytes, str]:
    """Generate a single PNG cover for ``book``.

    Returns:
        (png_bytes, prompt_for_audit)

    Raises:
        RuntimeError if the model returned no image.

    Each call instantiates a fresh ``LlmChat`` with a unique
    ``session_id`` because the playbook requires it (no chat history
    is needed for one-shot generation).
    """
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")

    prompt = _build_prompt(book, nudge=nudge)
    # Tiny audit-friendly prompt summary — full prompt would bloat logs.
    logger.info(
        "cover_gen: title=%r author=%r nudge=%r prompt_len=%d",
        (book.get("title") or "")[:60],
        (book.get("author") or "")[:40],
        (nudge or "")[:40],
        len(prompt),
    )

    chat = LlmChat(
        api_key=api_key,
        session_id=f"cover-{uuid.uuid4().hex}",
        system_message=(
            "You are a literary book cover designer. You return exactly "
            "one image per request, never multiple variants."
        ),
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview")
    chat.with_params(modalities=["image", "text"])

    msg = UserMessage(text=prompt)
    _text, images = await chat.send_message_multimodal_response(msg)

    if not images:
        raise RuntimeError("nano-banana returned no image")
    # Take the first image only — system message instructs the model
    # to return exactly one.
    img = images[0]
    png_bytes = base64.b64decode(img["data"])
    return png_bytes, prompt
