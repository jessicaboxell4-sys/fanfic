"""
Server-side OG-image generator for `/share/yib/{token}` previews.

Goal: 1200×630 PNG that crawlers (Twitter, Facebook, Discord, Slack, iMessage)
embed when someone pastes a Shelfsort year-in-books share link. Reuses the
visual language of the in-app Wrapped card but at OG dimensions and rendered
with Pillow so we don't need a headless browser on the backend.
"""
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont

CARD_W, CARD_H = 1200, 630

# Fonts available in the standard Linux base image. DejaVu Serif is a clean
# stand-in for Cormorant Garamond at large sizes.
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SERIF_ITALIC = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def _diagonal_gradient(top: tuple, bottom: tuple) -> Image.Image:
    """Cheap-but-pleasant diagonal gradient via a 256-step row.

    We build a 256×1 strip then resize to canvas size — way faster than
    a per-pixel Python loop, no numpy required.
    """
    strip = Image.new("RGB", (256, 1))
    px = strip.load()
    for i in range(256):
        t = i / 255.0
        px[i, 0] = (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        )
    # Rotate the strip 45° by resizing into a square then cropping.
    big = strip.resize((CARD_W + CARD_H, 1), Image.BICUBIC)
    out = Image.new("RGB", (CARD_W, CARD_H))
    for y in range(CARD_H):
        # Each row samples from offset y of the long strip → diagonal effect.
        row = big.crop((y, 0, y + CARD_W, 1)).resize((CARD_W, 1))
        out.paste(row, (0, y))
    return out


def _truncate(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if not text:
        return text
    if draw.textlength(text, font=font) <= max_width:
        return text
    ell = "…"
    while text and draw.textlength(text + ell, font=font) > max_width:
        text = text[:-1]
    return text + ell


def render_og_card(
    *,
    year: int,
    display_name: str | None,
    books_opened: int,
    longest_streak: int,
    top_fandom: str | None,
    top_author: str | None,
) -> bytes:
    """Return PNG bytes (1200×630) for a year-in-books OG preview."""
    img = _diagonal_gradient((0x1B, 0x12, 0x40), (0x6B, 0x46, 0xC1))
    draw = ImageDraw.Draw(img, "RGBA")

    # Soft purple glow at top-right to add depth
    glow = Image.new("RGBA", (600, 600), (255, 255, 255, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((0, 0, 600, 600), fill=(180, 130, 255, 60))
    img.paste(glow, (CARD_W - 450, -200), glow)

    # Padding
    pad = 70

    # Brand row (top)
    f_brand = _font(SANS_BOLD, 24)
    draw.text((pad, pad), "SHELFSORT  WRAPPED", fill=(255, 255, 255, 230), font=f_brand)
    year_text = str(year)
    yw = draw.textlength(year_text, font=f_brand)
    draw.text((CARD_W - pad - yw, pad), year_text, fill=(255, 255, 255, 180), font=f_brand)

    # Hero year
    f_year = _font(SERIF_BOLD, 220)
    draw.text((pad - 6, pad + 50), str(year), fill="white", font=f_year)

    # Subtitle italic
    f_sub = _font(SERIF_ITALIC, 54)
    subject = f"{display_name}'s" if display_name else "A year of"
    sub = _truncate(draw, f"{subject} year in books.", f_sub, CARD_W - 2 * pad)
    draw.text((pad, pad + 290), sub, fill=(255, 255, 255, 240), font=f_sub)

    # Stats / highlight line
    f_stats = _font(SERIF, 34)
    bits = []
    if books_opened:
        bits.append(f"{books_opened} book{'' if books_opened == 1 else 's'}")
    if longest_streak:
        bits.append(f"{longest_streak}-day streak")
    if top_fandom:
        bits.append(f"top world: {top_fandom}")
    elif top_author:
        bits.append(f"top voice: {top_author}")
    if bits:
        line = _truncate(draw, "  ·  ".join(bits), f_stats, CARD_W - 2 * pad)
        draw.text((pad, pad + 380), line, fill=(255, 255, 255, 215), font=f_stats)

    # Footer divider + brandmark
    divider_y = CARD_H - 90
    draw.line(
        [(pad, divider_y), (CARD_W - pad, divider_y)],
        fill=(255, 255, 255, 50),
        width=1,
    )
    f_foot = _font(SANS_BOLD, 22)
    draw.text((pad, divider_y + 25), "SHELFSORT.APP", fill=(255, 255, 255, 200), font=f_foot)
    tag = "YEAR IN BOOKS"
    tw = draw.textlength(tag, font=f_foot)
    draw.text((CARD_W - pad - tw, divider_y + 25), tag, fill=(255, 255, 255, 200), font=f_foot)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
