"""Tests for the AO3/FF.net subject classifier in utils.ao3_metadata.

These pin the canonical-alias tables so future AO3 wrangling changes
or new alias additions can't quietly break existing classification.
"""
from __future__ import annotations

import sys
import pathlib

backend_dir = str(pathlib.Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from utils.ao3_metadata import (
    classify_subject,
    classify_subjects,
    RATING_GENERAL, RATING_TEEN, RATING_MATURE, RATING_EXPLICIT, RATING_NOT_RATED,
    WARNING_GRAPHIC_VIOLENCE, WARNING_MAJOR_DEATH, WARNING_NO_WARNINGS, WARNING_CHOSE_NOT,
    CATEGORY_FF, CATEGORY_FM, CATEGORY_GEN, CATEGORY_MM, CATEGORY_MULTI,
)


def test_classify_subject_ratings_all_canonical():
    assert classify_subject("General Audiences") == ("rating", RATING_GENERAL)
    assert classify_subject("Teen And Up Audiences") == ("rating", RATING_TEEN)
    assert classify_subject("Mature") == ("rating", RATING_MATURE)
    assert classify_subject("Explicit") == ("rating", RATING_EXPLICIT)
    assert classify_subject("Not Rated") == ("rating", RATING_NOT_RATED)


def test_classify_subject_rating_aliases_case_insensitive():
    assert classify_subject("explicit")[1] == RATING_EXPLICIT
    assert classify_subject("MATURE")[1] == RATING_MATURE
    assert classify_subject("E")[1] == RATING_EXPLICIT
    assert classify_subject("K+")[1] == RATING_TEEN  # FF.net K+ → Teen
    assert classify_subject("K")[1] == RATING_GENERAL  # FF.net K → General


def test_classify_subject_warnings():
    assert classify_subject("Major Character Death") == ("warning", WARNING_MAJOR_DEATH)
    assert classify_subject("Graphic Depictions Of Violence") == ("warning", WARNING_GRAPHIC_VIOLENCE)
    assert classify_subject("No Archive Warnings Apply") == ("warning", WARNING_NO_WARNINGS)
    assert classify_subject("Choose Not To Use Archive Warnings") == ("warning", WARNING_CHOSE_NOT)


def test_classify_subject_categories():
    assert classify_subject("F/F") == ("category", CATEGORY_FF)
    assert classify_subject("F/M") == ("category", CATEGORY_FM)
    assert classify_subject("Gen") == ("category", CATEGORY_GEN)
    assert classify_subject("M/M") == ("category", CATEGORY_MM)
    assert classify_subject("Multi") == ("category", CATEGORY_MULTI)
    assert classify_subject("Slash")[1] == CATEGORY_MM  # alias


def test_classify_subject_relationships_use_slash_and_amp():
    # AO3-style romantic pairing
    assert classify_subject("Harry Potter/Hermione Granger") == ("relationship", "Harry Potter/Hermione Granger")
    # Platonic pairing
    assert classify_subject("Sherlock Holmes & John Watson")[0] == "relationship"


def test_classify_subject_freeform_tag_fallback():
    assert classify_subject("Slow Burn") == ("tag", "Slow Burn")
    assert classify_subject("Alternate Universe - Coffee Shop")[0] == "tag"


def test_classify_subject_empty_safe():
    assert classify_subject("") == ("tag", "")
    assert classify_subject("   ")[1] == ""


def test_classify_subjects_full_ao3_export():
    """Reproduce the exact tag pile from a typical AO3 EPUB export."""
    subjects = [
        "Mature",
        "Choose Not To Use Archive Warnings",
        "M/M",
        "F/M",
        "Harry Potter - J. K. Rowling",       # fandom
        "Harry Potter/Draco Malfoy",           # rel
        "Hermione Granger & Ron Weasley",      # platonic rel
        "Slow Burn",                           # tag
        "Enemies to Lovers",                   # tag
        "Mature",                              # duplicate rating
    ]
    out = classify_subjects(subjects)
    assert out["rating"] == RATING_MATURE
    assert WARNING_CHOSE_NOT in out["warnings"]
    assert set(out["categories"]) == {CATEGORY_MM, CATEGORY_FM}
    assert "Harry Potter/Draco Malfoy" in out["relationships"]
    assert "Hermione Granger & Ron Weasley" in out["relationships"]
    assert "Slow Burn" in out["tags"]
    assert "Enemies to Lovers" in out["tags"]
    # The fandom isn't a relationship (no /) and isn't a known rating/warning/category
    # → falls into the freeform tags bucket. Caller is responsible for fandom routing.
    assert "Harry Potter - J. K. Rowling" in out["tags"]


def test_classify_subjects_dedup_within_each_bucket():
    out = classify_subjects(["Slow Burn", "Slow Burn", "slow burn"])
    # We don't lowercase tags — preserve original casing — so "Slow Burn" and
    # "slow burn" are distinct freeform tags. But the exact duplicate dedupes.
    assert out["tags"].count("Slow Burn") == 1
    assert "slow burn" in out["tags"]
