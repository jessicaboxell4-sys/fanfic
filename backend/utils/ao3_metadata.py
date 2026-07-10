"""AO3 / FF.net canonical metadata enums + classifier.

AO3 export EPUBs (and most FanFicFare downloads) pile every metadata
tag into ``<dc:subject>`` elements with no differentiation between
ratings, warnings, categories, fandoms, relationships, characters, and
freeform tags. This module owns the canonical taxonomies + a single
:func:`classify_subject` function that decides which bucket a subject
string belongs in.

References
----------
* https://archiveofourown.org/help/symbols-key
* https://archiveofourown.org/wrangling_guidelines/
"""
from __future__ import annotations

from typing import List, Optional, Tuple

# ---------------------------------------------------------------------------
# Ratings — AO3 has 5; FF.net uses K/K+/T/M.
# We normalize to AO3's labels but accept FF.net forms as aliases.
# ---------------------------------------------------------------------------
RATING_GENERAL = "General Audiences"
RATING_TEEN = "Teen And Up Audiences"
RATING_MATURE = "Mature"
RATING_EXPLICIT = "Explicit"
RATING_NOT_RATED = "Not Rated"

CANONICAL_RATINGS = [
    RATING_GENERAL, RATING_TEEN, RATING_MATURE, RATING_EXPLICIT, RATING_NOT_RATED,
]

RATING_ALIASES = {
    # AO3 canonical (lowercased keys)
    "general audiences": RATING_GENERAL,
    "general": RATING_GENERAL,
    "g": RATING_GENERAL,
    "k": RATING_GENERAL,
    "k+": RATING_TEEN,
    "teen and up audiences": RATING_TEEN,
    "teen": RATING_TEEN,
    "t": RATING_TEEN,
    "mature": RATING_MATURE,
    "m": RATING_MATURE,
    "explicit": RATING_EXPLICIT,
    "e": RATING_EXPLICIT,
    "ma": RATING_EXPLICIT,   # FF.net's "MA" lives outside their site but appears in metadata
    "not rated": RATING_NOT_RATED,
    "nr": RATING_NOT_RATED,
    "unrated": RATING_NOT_RATED,
}


# ---------------------------------------------------------------------------
# Archive Warnings — AO3 has 6 canonical values; we accept some FF.net hybrids.
# ---------------------------------------------------------------------------
WARNING_GRAPHIC_VIOLENCE = "Graphic Depictions Of Violence"
WARNING_MAJOR_DEATH = "Major Character Death"
WARNING_NONCON = "Rape/Non-Con"
WARNING_UNDERAGE = "Underage"
WARNING_NO_WARNINGS = "No Archive Warnings Apply"
WARNING_CHOSE_NOT = "Choose Not To Use Archive Warnings"

CANONICAL_WARNINGS = [
    WARNING_GRAPHIC_VIOLENCE, WARNING_MAJOR_DEATH, WARNING_NONCON,
    WARNING_UNDERAGE, WARNING_NO_WARNINGS, WARNING_CHOSE_NOT,
]

WARNING_ALIASES = {
    "graphic depictions of violence": WARNING_GRAPHIC_VIOLENCE,
    "graphic violence": WARNING_GRAPHIC_VIOLENCE,
    "major character death": WARNING_MAJOR_DEATH,
    "character death": WARNING_MAJOR_DEATH,
    "rape/non-con": WARNING_NONCON,
    "non-con": WARNING_NONCON,
    "rape": WARNING_NONCON,
    "underage": WARNING_UNDERAGE,
    "underage sex": WARNING_UNDERAGE,
    "no archive warnings apply": WARNING_NO_WARNINGS,
    "no warnings": WARNING_NO_WARNINGS,
    "choose not to use archive warnings": WARNING_CHOSE_NOT,
    "creator chose not to use archive warnings": WARNING_CHOSE_NOT,
    "author chose not to use archive warnings": WARNING_CHOSE_NOT,
}


# ---------------------------------------------------------------------------
# Categories — AO3 has 6 fixed values.
# ---------------------------------------------------------------------------
CATEGORY_FF = "F/F"
CATEGORY_FM = "F/M"
CATEGORY_GEN = "Gen"
CATEGORY_MM = "M/M"
CATEGORY_MULTI = "Multi"
CATEGORY_OTHER = "Other"

CANONICAL_CATEGORIES = [
    CATEGORY_FF, CATEGORY_FM, CATEGORY_GEN,
    CATEGORY_MM, CATEGORY_MULTI, CATEGORY_OTHER,
]

CATEGORY_ALIASES = {
    "f/f": CATEGORY_FF,
    "ff": CATEGORY_FF,
    "femslash": CATEGORY_FF,
    "f/m": CATEGORY_FM,
    "fm": CATEGORY_FM,
    "het": CATEGORY_FM,
    "gen": CATEGORY_GEN,
    "general": CATEGORY_GEN,  # only when paired with the "Gen" intent, not the rating
    "no romance": CATEGORY_GEN,
    "m/m": CATEGORY_MM,
    "mm": CATEGORY_MM,
    "slash": CATEGORY_MM,
    "multi": CATEGORY_MULTI,
    "multiple pairings": CATEGORY_MULTI,
    "other": CATEGORY_OTHER,
}


# ---------------------------------------------------------------------------
# Classifier — sort one ``<dc:subject>`` string into the right bucket.
# ---------------------------------------------------------------------------
SubjectKind = str  # "rating" | "warning" | "category" | "relationship" | "tag"


def classify_subject(raw: str) -> Tuple[SubjectKind, str]:
    """Bucket a single subject string into one of:
        ("rating", canonical)
        ("warning", canonical)
        ("category", canonical)
        ("relationship", original)  — caller normalizes further
        ("tag", original)            — freeform tag fallback

    Pure function; case-insensitive matching against the alias tables
    above. Relationships are detected by the AO3 separator pattern
    (``/`` or `` & ``) BEFORE the freeform-tag fallback so a tag like
    ``"Harry Potter/Hermione Granger"`` doesn't accidentally land in
    ``tags``.
    """
    s = (raw or "").strip()
    if not s:
        return ("tag", "")
    k = s.lower()

    if k in RATING_ALIASES:
        # ...but only count "general" as a rating when it's *the* whole tag.
        # An "alternate universe - general fiction" tag should not become a rating.
        return ("rating", RATING_ALIASES[k])
    if k in WARNING_ALIASES:
        return ("warning", WARNING_ALIASES[k])
    if k in CATEGORY_ALIASES:
        # Disambiguate "General": AO3 uses "Gen" for category and
        # "General Audiences" for rating. The alias table maps both,
        # so we only treat plain "general" as Category when it's NOT
        # already a rating match — but the rating check above already
        # caught it. So at this point, "general" → CATEGORY_GEN never
        # fires. Anything reaching here is a real category alias.
        return ("category", CATEGORY_ALIASES[k])

    # Relationship pattern.
    if "/" in s or " & " in s:
        return ("relationship", s)

    # Anything else is a freeform tag.
    return ("tag", s)


def classify_subjects(raws: List[str]) -> dict:
    """Bulk classifier. Returns a dict with deduped lists per bucket.

    Output shape::

        {
            "rating": str | None,        # at most one
            "warnings": List[str],
            "categories": List[str],
            "relationships": List[str],  # not canonicalized — caller does that
            "tags": List[str],
        }
    """
    out = {
        "rating": None,
        "warnings": [],
        "categories": [],
        "relationships": [],
        "tags": [],
    }
    seen_w: set = set()
    seen_c: set = set()
    seen_r: set = set()
    seen_t: set = set()
    for raw in raws or []:
        kind, val = classify_subject(raw)
        if not val:
            continue
        if kind == "rating":
            # Last-wins for ratings is fine; multiple ratings shouldn't appear.
            out["rating"] = val
        elif kind == "warning" and val not in seen_w:
            seen_w.add(val); out["warnings"].append(val)
        elif kind == "category" and val not in seen_c:
            seen_c.add(val); out["categories"].append(val)
        elif kind == "relationship" and val not in seen_r:
            seen_r.add(val); out["relationships"].append(val)
        elif kind == "tag" and val not in seen_t:
            seen_t.add(val); out["tags"].append(val)
    return out
