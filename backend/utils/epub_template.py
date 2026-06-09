"""FicHub-style EPUB intro page + stylesheet applier.

Post-processes a freshly-downloaded fanfic EPUB so the structure matches
the template the user provided:
  * Intro page (BEFORE the TOC) with a clean info block + source URL
  * Verdana sans-serif stylesheet, centred <h1>, left-aligned bold <h2>

Idempotent: detects already-templated EPUBs (via the marker meta) and
skips re-applying. Pure helpers — no DB, no router, no FastAPI.
"""

from typing import Any, Dict, List
import html as _html_stdlib
import logging
import re as _re
import zipfile
from io import BytesIO


logger = logging.getLogger(__name__)


SHELFSORT_TEMPLATE_CSS = """@namespace epub "http://www.idpf.org/2007/ops";

body {
    font-family: Verdana, Helvetica, Arial, sans-serif;
}

h1 {
    text-align: center;
}

h2 {
    text-align: left;
    font-weight: bold;
}

ol {
    list-style-type: none;
    margin: 0;
}

ol > li {
    margin-top: 0.3em;
}

ol > li > span {
    font-weight: bold;
}

ol > li > ol {
    margin-left: 0.5em;
}

.spoiler {
    padding-left: 0.4em;
    border-left: 0.2em solid #c7ccd1;
}
"""

SHELFSORT_TEMPLATE_MARKER = "shelfsort:templated"


def _html_escape(s: Any) -> str:
    if s is None:
        return ""
    return _html_stdlib.escape(str(s), quote=False)


def _build_intro_xhtml(meta: Dict[str, Any], source_url: str) -> str:
    """Build the FicHub-style intro page (matches the user's reference EPUB)."""
    raw = meta.get("rawExtendedMeta") or {}
    title = _html_escape(meta.get("title") or "Untitled")
    author = _html_escape(meta.get("author") or "Unknown")
    description = meta.get("description") or ""
    if description and "<" not in description:
        description = f"<p>{_html_escape(description)}</p>"

    status = _html_escape(raw.get("status") or "")
    published = _html_escape(raw.get("datePublished") or "")
    updated = _html_escape(raw.get("dateUpdated") or "")
    words_val = raw.get("words")
    words = f"{int(words_val):,}" if isinstance(words_val, (int, float)) and words_val else ""
    chapters = meta.get("chapters") or 0
    rating = _html_escape(raw.get("rating") or "")
    language = _html_escape(raw.get("language") or "English")
    reviews = _html_escape(raw.get("reviews") or "")
    favs = _html_escape(raw.get("favs") or "")
    follows = _html_escape(raw.get("follows") or "")

    # "Rated:" line — only show the parts we actually have, comma-separated
    rated_parts: List[str] = []
    if rating:
        rated_parts.append(f"Fiction {rating}")
    if language:
        rated_parts.append(f"Language: {language}")
    if reviews:
        rated_parts.append(f"Reviews: {reviews}")
    if favs:
        rated_parts.append(f"Favs: {favs}")
    if follows:
        rated_parts.append(f"Follows: {follows}")
    rated_line = " - ".join(rated_parts)

    src_url = _html_escape(source_url)

    body_chunks: List[str] = [
        f"<h1>{title}</h1>",
        f"<p><b>By: {author}</b></p>",
        "<p/>",
        description,
    ]
    if status:
        body_chunks.append(f"<p>Status: {status}</p>")
    if published:
        body_chunks.append(f"<p>Published: {published}</p>")
    if updated:
        body_chunks.append(f"<p>Updated: {updated}</p>")
    if words:
        body_chunks.append(f"<p>Words: {words}</p>")
    if chapters:
        body_chunks.append(f"<p>Chapters: {chapters}</p>")
    if rated_line:
        body_chunks.append(f"<p>Rated: {rated_line}</p>")
    body_chunks.append(
        f'<p>Original source:\n\t\t<a rel="noopener noreferrer" href="{src_url}">{src_url}</a></p>'
    )
    body_chunks.append(
        '<p>Exported with the assistance of\n\t\t<a href="https://github.com/JimmXinu/FanFicFare">FanFicFare</a> via Shelfsort</p>'
    )
    body = "\n\t".join(body_chunks)

    return (
        "<?xml version='1.0' encoding='utf-8'?>\n"
        "<!DOCTYPE html>\n"
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:epub="http://www.idpf.org/2007/ops" '
        f'epub:prefix="z3998: http://www.daisy.org/z3998/2012/vocab/structure/#" '
        f'lang="en" xml:lang="en" data-shelfsort="{SHELFSORT_TEMPLATE_MARKER}">\n'
        "  <head>\n"
        "    <title>Introduction</title>\n"
        "  </head>\n"
        f"  <body>{body}\n</body>\n"
        "</html>\n"
    )


def apply_template_to_epub(
    epub_bytes: bytes,
    meta: Dict[str, Any],
    source_url: str,
) -> bytes:
    """Inject a FicHub-style intro page + apply our stylesheet to a fanfic EPUB.

    Idempotent: if the EPUB already carries the Shelfsort marker (a `<meta>`
    in content.opf), returns the bytes unchanged. Errors are caught and the
    original bytes returned, so a malformed EPUB never blocks a refresh.
    """
    try:
        src = BytesIO(epub_bytes)
        with zipfile.ZipFile(src, "r") as zin:
            names = zin.namelist()
            if not any(n.endswith(".opf") for n in names):
                return epub_bytes  # not an EPUB we can safely rewrite

            opf_path = next(n for n in names if n.endswith(".opf"))
            opf_xml = zin.read(opf_path).decode("utf-8", errors="ignore")
            if SHELFSORT_TEMPLATE_MARKER in opf_xml:
                return epub_bytes  # already templated — skip

            opf_dir = opf_path.rsplit("/", 1)[0] if "/" in opf_path else ""

            # Build the new intro page
            intro_xhtml = _build_intro_xhtml(meta, source_url)
            intro_filename = "shelfsort_intro.xhtml"
            intro_path = f"{opf_dir}/{intro_filename}" if opf_dir else intro_filename

            # Find or pick a stylesheet path inside the OPF dir
            css_path = next(
                (n for n in names if n.endswith(".css") and (opf_dir + "/") in (n + "/")),
                None,
            ) or (f"{opf_dir}/style/shelfsort.css" if opf_dir else "shelfsort.css")
            css_href = css_path[len(opf_dir) + 1:] if opf_dir and css_path.startswith(opf_dir + "/") else css_path

            # Mutate the OPF: inject the intro item + spine ref + a marker meta
            # 1) Add marker meta inside <metadata>
            new_opf = _re.sub(
                r"(</metadata>)",
                f'    <meta name="generator" content="{SHELFSORT_TEMPLATE_MARKER}"/>\n  \\1',
                opf_xml,
                count=1,
            )

            # 2) Add intro manifest item (if not already there)
            if 'id="shelfsort-intro"' not in new_opf:
                new_opf = _re.sub(
                    r"(</manifest>)",
                    f'    <item href="{intro_filename}" id="shelfsort-intro" media-type="application/xhtml+xml"/>\n  \\1',
                    new_opf,
                    count=1,
                )
                # Ensure css is in the manifest too
                if css_href not in new_opf:
                    new_opf = _re.sub(
                        r"(</manifest>)",
                        f'    <item href="{css_href}" id="shelfsort-css" media-type="text/css"/>\n  \\1',
                        new_opf,
                        count=1,
                    )

            # 3) Prepend intro to the spine
            new_opf = _re.sub(
                r"(<spine[^>]*>)",
                '\\1\n    <itemref idref="shelfsort-intro"/>',
                new_opf,
                count=1,
            )

            # 4) Repack the EPUB
            out = BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
                # mimetype MUST be first + uncompressed
                if "mimetype" in names:
                    info = zipfile.ZipInfo("mimetype")
                    info.compress_type = zipfile.ZIP_STORED
                    zout.writestr(info, zin.read("mimetype"))
                for name in names:
                    if name == "mimetype":
                        continue
                    if name == opf_path:
                        zout.writestr(name, new_opf)
                    elif name == css_path:
                        zout.writestr(name, SHELFSORT_TEMPLATE_CSS)
                    else:
                        zout.writestr(name, zin.read(name))
                # New files
                zout.writestr(intro_path, intro_xhtml)
                if css_path not in names:
                    zout.writestr(css_path, SHELFSORT_TEMPLATE_CSS)
            return out.getvalue()
    except Exception as e:
        logger.warning("apply_template_to_epub failed for %s: %s", source_url, e)
        return epub_bytes
