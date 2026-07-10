"""Reader DNA share-card renderer (1080×1080 PNG).

Used by ``GET /api/insights/reader-dna/share-card.png`` to deliver an
Instagram-story-ready image of the calling user's Reader DNA panel.

Why deterministic Pillow render (not nano-banana)?
- Free, fast (< 200ms), no rate limits.
- Reproducible — the same DNA always produces the same PNG.
- Brand-consistent — uses Shelfsort's actual palette + DejaVu Serif
  (close enough to the in-app serif) so the card looks like an
  extension of the site, not a third-party meme generator.
"""
from __future__ import annotations

import io
from typing import Dict, Any, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


# Brand palette — pulled from the in-app CSS vars.
_PARCHMENT     = (251, 250, 246)   # #FBFAF6
_INK           = (44, 44, 44)      # #2C2C2C
_INK_SOFT      = (107, 112, 92)    # #6B705C
_PURPLE        = (107, 70, 193)    # #6B46C1  (Original)
_CORAL         = (224, 122, 95)    # #E07A5F  (Fanfic)
_RULE          = (229, 221, 197)   # #E5DDC5

_SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
_SERIF      = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
_SANS       = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_SANS_BOLD  = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_MONO       = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def render_reader_dna_card(
    dna: Dict[str, Any],
    user_display_name: Optional[str] = None,
) -> bytes:
    """Render the DNA payload to a 1080×1080 PNG and return the bytes.

    ``dna`` is the response shape from ``/api/insights/reader-dna``.
    """
    W, H = 1080, 1080
    img = Image.new("RGB", (W, H), _PARCHMENT)
    d = ImageDraw.Draw(img)

    # --- Frame ----------------------------------------------------
    margin = 56
    d.rectangle([margin, margin, W - margin, H - margin], outline=_RULE, width=3)

    # --- Header ---------------------------------------------------
    tag = "READER DNA"
    f_tag = _font(_SANS_BOLD, 28)
    d.text((margin + 32, margin + 36), tag, fill=_PURPLE, font=f_tag, spacing=8)

    if user_display_name:
        f_byname = _font(_SANS, 22)
        d.text((margin + 32, margin + 78), f"by {user_display_name}",
               fill=_INK_SOFT, font=f_byname)

    f_h1 = _font(_SERIF_BOLD, 64)
    d.text((margin + 32, margin + 122), "What kind of reader",
           fill=_INK, font=f_h1)
    d.text((margin + 32, margin + 200), "are you?",
           fill=_INK, font=f_h1)

    # --- Top fandoms ----------------------------------------------
    y = margin + 320
    f_section = _font(_SANS_BOLD, 22)
    d.text((margin + 32, y), "TOP FANDOMS", fill=_INK_SOFT, font=f_section)
    y += 44

    f_rank = _font(_MONO, 36)
    f_name = _font(_SERIF, 38)
    f_count = _font(_MONO, 28)
    for i, fandom in enumerate((dna.get("top_fandoms") or [])[:3]):
        d.text((margin + 32, y), f"{i + 1}.", fill=_INK_SOFT, font=f_rank)
        name = (fandom.get("fandom") or "")[:32]
        d.text((margin + 96, y + 2), name, fill=_INK, font=f_name)
        count_str = f"{fandom.get('count', 0)}"
        cw = d.textlength(count_str, font=f_count)
        d.text((W - margin - 32 - cw, y + 10), count_str,
               fill=_INK_SOFT, font=f_count)
        y += 60
    if not dna.get("top_fandoms"):
        d.text((margin + 96, y + 2), "(no fandom data yet)",
               fill=_INK_SOFT, font=_font(_SERIF, 28))
        y += 60

    # --- Fanfic vs Original split bar -----------------------------
    y += 28
    d.text((margin + 32, y), "FANFIC vs ORIGINAL", fill=_INK_SOFT, font=f_section)
    y += 38
    fanfic_pct = int(dna.get("fanfic_pct") or 0)
    original_pct = max(0, 100 - fanfic_pct)
    bar_x0, bar_x1 = margin + 32, W - margin - 32
    bar_h = 28
    bar_w = bar_x1 - bar_x0
    fanfic_w = int(bar_w * fanfic_pct / 100)
    # Draw fanfic (coral) + original (purple).  Min-2px nubs so a
    # 0% slice still hints at the color.
    if fanfic_pct > 0:
        d.rectangle([bar_x0, y, bar_x0 + max(2, fanfic_w), y + bar_h],
                    fill=_CORAL)
    if original_pct > 0:
        d.rectangle([bar_x0 + fanfic_w, y, bar_x1, y + bar_h],
                    fill=_PURPLE)
    # Rounded look — overlay a thin rule border for definition.
    d.rectangle([bar_x0, y, bar_x1, y + bar_h], outline=_RULE, width=1)
    y += bar_h + 16
    f_legend = _font(_SANS_BOLD, 22)
    d.text((bar_x0, y), f"{fanfic_pct}% Fanfic", fill=_CORAL, font=f_legend)
    orig_label = f"{original_pct}% Original"
    ow = d.textlength(orig_label, font=f_legend)
    d.text((bar_x1 - ow, y), orig_label, fill=_PURPLE, font=f_legend)
    y += 56

    # --- Stat row: total books · avg length -----------------------
    y += 12
    f_big_num = _font(_SERIF_BOLD, 56)
    f_unit = _font(_SANS, 20)
    col_w = (W - 2 * margin - 64) // 2
    # Total books
    cx = margin + 32
    d.text((cx, y), f"{dna.get('total_books', 0):,}",
           fill=_INK, font=f_big_num)
    d.text((cx, y + 70), "BOOKS IN LIBRARY",
           fill=_INK_SOFT, font=f_unit)
    # Avg word count
    cx = margin + 32 + col_w + 32
    avg_words = dna.get("avg_words") or 0
    if avg_words >= 1000:
        avg_str = f"{avg_words // 1000}K"
    else:
        avg_str = f"{avg_words:,}"
    d.text((cx, y), avg_str, fill=_INK, font=f_big_num)
    d.text((cx, y + 70), "AVG WORDS PER BOOK",
           fill=_INK_SOFT, font=f_unit)

    # --- Footer ---------------------------------------------------
    f_footer = _font(_SANS_BOLD, 22)
    footer = "GET YOURS AT SHELFSORT.COM"
    fw = d.textlength(footer, font=f_footer)
    d.text(((W - fw) / 2, H - margin - 50), footer,
           fill=_PURPLE, font=f_footer)

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
