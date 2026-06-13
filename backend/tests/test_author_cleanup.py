"""Unit tests for the author cleanup helper."""
import sys
sys.path.insert(0, "/app/backend")
import pytest
from routes.books import _clean_author_string, _normalize_author_for_match


class TestAuthorCleanup:
    @pytest.mark.parametrize("raw,expected", [
        ("", "Unknown"),
        (None, "Unknown"),
        ("   ", "Unknown"),
        ("anonymous", "Unknown"),
        ("Anonymous", "Unknown"),
        ("Anon.", "Unknown"),
        ("UNKNOWN", "Unknown"),
        ("unknown author", "Unknown"),
        ("Various", "Various"),
        ("various authors", "Various"),
        ("John Smith", "John Smith"),
        ("  John Smith  ", "John Smith"),
        ("by John Smith", "John Smith"),
        ("By Jane Austen", "Jane Austen"),
        ("Written by Tolkien", "Tolkien"),
        ("Author: J.R.R. Tolkien", "J.R.R. Tolkien"),
        # Parenthetical / bracketed
        ("Real Name (Pen Name)", "Real Name"),
        ("Pseudonym [a.k.a. Real Name]", "Pseudonym"),
        ("Tolkien (Inkling Society)", "Tolkien"),
        # Multi-author separators preserved (just trimmed)
        ("Smith, John & Doe, Jane", "Smith, John & Doe, Jane"),
        ("Alice & Bob & Carol", "Alice & Bob & Carol"),
        # Internal whitespace collapsed
        ("J.   R.   R.   Tolkien", "J. R. R. Tolkien"),
        # Trailing separator stripped
        ("Author Name,", "Author Name"),
        ("& Jane Doe", "Jane Doe"),
    ])
    def test_clean_author(self, raw, expected):
        assert _clean_author_string(raw) == expected


class TestAuthorNormalization:
    @pytest.mark.parametrize("a,b,should_match", [
        # Same author, different formats
        ("J. K. Rowling", "JK Rowling", True),
        ("J.K. Rowling", "JK Rowling", True),
        ("J K Rowling", "JK Rowling", True),
        ("Alice  Wright", "Alice Wright", True),
        ("alice wright", "Alice Wright", True),
        # Different authors
        ("Alice Wright", "Bob Lee", False),
        ("J. K. Rowling", "J. R. R. Tolkien", False),
        ("Smith", "Smithson", False),
        # Empty stays empty (caller decides fallback)
        ("", "", True),  # both empty match
    ])
    def test_normalize_pairs(self, a, b, should_match):
        na = _normalize_author_for_match(a)
        nb = _normalize_author_for_match(b)
        assert (na == nb) is should_match, f"{a!r} ({na!r}) vs {b!r} ({nb!r})"
