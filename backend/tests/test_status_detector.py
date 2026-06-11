"""Pure-unit tests for `utils.status_detector`.

I/O-free, run in milliseconds. End-to-end tests for the shelf endpoints
live in `test_new_features.py::TestStatusShelves`.
"""

import pytest

from utils.status_detector import (
    COMPLETE,
    ONGOING,
    detect_status,
    effective_status,
)


class TestStatusLineSignal:
    @pytest.mark.parametrize("text,expected", [
        ("Status: Complete", COMPLETE),
        ("Status: completed", COMPLETE),
        ("Status: Finished", COMPLETE),
        ("Status: In-Progress", ONGOING),
        ("Status: in progress", ONGOING),
        ("Status: WIP", ONGOING),
        ("Status: Ongoing", ONGOING),
        ("Status: Updating", ONGOING),
        # "Updated: 2024-01-15" — the colon-after-keyword case AO3 / FFnet use.
        ("Status: Updated: 2024-01-15", ONGOING),
        ("Status: Abandoned", ONGOING),
        ("Status: Discontinued", ONGOING),
        ("Status: Hiatus", ONGOING),
    ])
    def test_recognizes_status_line(self, text, expected):
        # Status-line signal trumps everything else.
        assert detect_status(description=text) == expected

    def test_status_line_inside_blob(self):
        # Most real descriptions are a paragraph with a "Status: …" line
        # buried somewhere — the regex shouldn't need it at the start.
        text = (
            "A fluffy character study.\n\n"
            "Words: 12,345 · Chapters: 7\n"
            "Rating: T · Language: English\n"
            "Status: In-Progress\n\n"
            "Read it now."
        )
        assert detect_status(description=text) == ONGOING


class TestTagSignal:
    @pytest.mark.parametrize("tags,expected", [
        (["complete"], COMPLETE),
        (["completed"], COMPLETE),
        (["wip"], ONGOING),
        (["work-in-progress"], ONGOING),
        (["abandoned", "harry-potter"], ONGOING),
        (["hiatus"], ONGOING),
        # Non-status tag → falls through to default
        (["fluff", "humor"], COMPLETE),
    ])
    def test_tag_signal(self, tags, expected):
        assert detect_status(tags=tags) == expected

    def test_status_line_beats_tag(self):
        # The status line is a stronger explicit signal than tags.
        assert detect_status(
            description="Status: Complete",
            tags=["wip"],
        ) == COMPLETE


class TestChapterCountHeuristic:
    @pytest.mark.parametrize("text,expected", [
        ("Chapter 5 of 12", ONGOING),
        ("Ch. 3/10", ONGOING),
        ("Part 2 of 7", ONGOING),
        ("5 of 12 chapters", ONGOING),
        # X >= Y reads as finished
        ("Chapter 12 of 12", COMPLETE),
        ("12 of 12 chapters", COMPLETE),
    ])
    def test_chapter_of(self, text, expected):
        assert detect_status(description=text) == expected

    def test_tag_beats_chapter_count(self):
        # An explicit "complete" tag should override a misleading
        # "Chapter 5 of 12" mention (sometimes part of a series blurb).
        assert detect_status(
            description="Chapter 5 of 12",
            tags=["complete"],
        ) == COMPLETE


class TestTBCHeuristic:
    @pytest.mark.parametrize("text", [
        "The story will continue. TBC.",
        "...to be continued",
        "(To Be Continued)",
    ])
    def test_tbc_marker(self, text):
        assert detect_status(description=text) == ONGOING

    def test_tbc_only_fires_after_other_signals_miss(self):
        # If the explicit status line says Complete, TBC shouldn't override.
        assert detect_status(
            description="Status: Complete\n\nEpilogue: to be continued in book 2",
        ) == COMPLETE


class TestDefault:
    @pytest.mark.parametrize("kwargs", [
        {},
        {"title": "A novel"},
        {"description": "A book about things."},
        {"tags": ["fluff"]},
        # Edge case: explicit "Status: Unknown" maps to nothing in our
        # bucket map → falls through to default.
        {"description": "Status: Unknown"},
    ])
    def test_defaults_to_complete(self, kwargs):
        assert detect_status(**kwargs) == COMPLETE


class TestEffectiveStatus:
    def test_no_status_defaults_to_complete(self):
        assert effective_status({}) == COMPLETE

    def test_auto_status_wins_when_no_manual(self):
        assert effective_status({"status": ONGOING}) == ONGOING
        assert effective_status({"status": COMPLETE}) == COMPLETE

    def test_manual_overrides_auto(self):
        assert effective_status({
            "status": ONGOING, "manual_status": COMPLETE,
        }) == COMPLETE
        assert effective_status({
            "status": COMPLETE, "manual_status": ONGOING,
        }) == ONGOING

    def test_invalid_manual_falls_back_to_auto(self):
        assert effective_status({
            "status": ONGOING, "manual_status": "garbage",
        }) == ONGOING

    def test_invalid_auto_falls_back_to_default(self):
        assert effective_status({"status": "garbage"}) == COMPLETE
