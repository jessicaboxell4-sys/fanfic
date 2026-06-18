"""Style packs for AI cover generation (2026-06-17, Tier 2).

A "style" is a named prompt fragment that gets merged into the
``cover_gen._build_prompt`` rule block.  Built-in styles ship with the
app; users can also create their own ("custom" styles) which live in
the ``user_cover_styles`` Mongo collection.

Why hardcoded?
  10 curated built-ins are easier to maintain + iterate on than a
  separate admin UI, and the rendered prompts have been hand-tuned to
  play nicely with the Shelfsort guardrails (no faces, no copyrighted
  characters, serif typography).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


# ``id`` is the URL-safe slug used by the API.  ``name`` is what we
# show in dropdowns.  ``prompt`` is appended near the end of the user
# prompt so it's the most recent instruction the model sees.
BUILT_IN_STYLES: List[Dict[str, str]] = [
    {
        "id": "house",
        "name": "Shelfsort house",
        "description": "Sage / cream / warm palette, symbolic, serif typography. The default.",
        "prompt": "",  # empty — built-in default already lives in cover_gen.py
    },
    {
        "id": "minimalist-line",
        "name": "Minimalist line-art",
        "description": "Single-weight black or dark-sage line drawing on cream. Extremely sparse.",
        "prompt": (
            "STYLE OVERRIDE: Minimalist line-art. Use a single ink weight, "
            "dark sage or black, on a flat cream background. ONE central "
            "symbol only — no background flourishes. Title in a small serif "
            "below the line drawing."
        ),
    },
    {
        "id": "gothic-candlelight",
        "name": "Gothic candlelight",
        "description": "Deep navy + ember orange. Candles, moths, ivy, midnight rooms.",
        "prompt": (
            "STYLE OVERRIDE: Gothic candlelight. Deep navy and oxblood "
            "background, single ember-orange candle highlight, drifting "
            "moths, twisted ivy. Mood: hushed midnight library. Title in "
            "a tall serif at the top, embers glowing through the letters."
        ),
    },
    {
        "id": "watercolour-botanical",
        "name": "Watercolour botanical",
        "description": "Soft washes, pressed flowers, herbarium plates, pastel palette.",
        "prompt": (
            "STYLE OVERRIDE: Watercolour botanical. Soft pastel washes "
            "(blush, sage, butter yellow), one or two pressed-flower "
            "motifs floating against pale paper, faint pencil annotations. "
            "Title in an italic copperplate-inspired serif at the bottom."
        ),
    },
    {
        "id": "pulp-paperback",
        "name": "Pulp paperback",
        "description": "Bold flat colour blocks, retro stamped serif title, 1950s dime-novel energy.",
        "prompt": (
            "STYLE OVERRIDE: Pulp paperback, 1950s dime-novel. Bold flat "
            "colour blocks (mustard, brick red, teal), high-contrast "
            "silhouette of a single prop, faux-stamped serif title in "
            "all-caps across the top, fake price-corner. No real faces."
        ),
    },
    {
        "id": "cyberpunk-neon",
        "name": "Cyberpunk neon",
        "description": "Magenta + cyan glow on black, rain-slick streets, hard-edged sans? No — keep serif but tinted.",
        "prompt": (
            "STYLE OVERRIDE: Cyberpunk neon. Black background, magenta + "
            "cyan glow, rain-slick reflective ground, single neon kanji "
            "or silhouette icon. Title in a sharp serif tinted "
            "magenta-cyan gradient. No faces, no recognisable IP."
        ),
    },
    {
        "id": "vintage-scifi",
        "name": "Vintage 70s sci-fi",
        "description": "Cosmic gradients, geometric planets, retro-future grid horizons.",
        "prompt": (
            "STYLE OVERRIDE: Vintage 1970s sci-fi paperback. Cosmic "
            "gradient sky (deep purple → orange), geometric planet rings, "
            "retro-future grid horizon, single distant silhouette. Title "
            "in a chunky retro serif at the top, slight halo glow."
        ),
    },
    {
        "id": "dark-academia",
        "name": "Dark academia",
        "description": "Leather-bound brown + cream, marble busts, ink stains, candles.",
        "prompt": (
            "STYLE OVERRIDE: Dark academia. Aged leather-brown + cream + "
            "ink-black palette, single ornate motif (quill, marble pillar, "
            "ink-stained ledger), warm candle highlight. Title in a "
            "classical serif with engraving-style hairlines."
        ),
    },
    {
        "id": "cottagecore",
        "name": "Cottagecore",
        "description": "Hand-drawn cottages, wildflowers, embroidered textures, gentle palette.",
        "prompt": (
            "STYLE OVERRIDE: Cottagecore embroidery. Hand-drawn "
            "wildflowers, a small cottage silhouette, embroidered cross-"
            "stitch borders, gentle palette of meadow green, sky blue, "
            "and pale cream. Title in a friendly handwritten-style serif "
            "at the top centre."
        ),
    },
    {
        "id": "noir-blackwhite",
        "name": "Noir black & white",
        "description": "High-contrast monochrome, rain, venetian-blind shadows.",
        "prompt": (
            "STYLE OVERRIDE: Film-noir black & white. High-contrast "
            "monochrome, single venetian-blind shadow across the cover, "
            "rain streaks, a lone object (cigarette, gun-silhouette, "
            "letter). Title in a chiselled serif at the bottom."
        ),
    },
]

_BUILT_IN_BY_ID: Dict[str, Dict[str, str]] = {s["id"]: s for s in BUILT_IN_STYLES}


def get_style_prompt(style_id: Optional[str]) -> str:
    """Return the prompt fragment for the given built-in style id.

    Unknown / falsy ids → empty string (= the default Shelfsort house
    style baked into ``cover_gen``).  Custom (user-defined) styles are
    resolved at the route layer because they hit Mongo.
    """
    if not style_id:
        return ""
    style = _BUILT_IN_BY_ID.get(style_id)
    return style["prompt"] if style else ""


def style_exists(style_id: str) -> bool:
    return style_id in _BUILT_IN_BY_ID


def built_in_list() -> List[Dict[str, Any]]:
    """Public list (omits the raw prompt — frontend doesn't need it)."""
    return [
        {"id": s["id"], "name": s["name"], "description": s["description"], "kind": "built_in"}
        for s in BUILT_IN_STYLES
    ]
