"""End-to-end tests for the AO3 metadata filters added to ``GET /api/books``.

We seed a small library directly via Mongo (no upload necessary), then hit
the public endpoint with ``rating`` / ``ao3_category`` / ``warning`` /
``exclude_warning`` query params to confirm each filter narrows the result
set correctly. The aim is regression coverage for the wiring between
``routes/books.py::list_books`` and the new ``Ao3FilterChips.jsx`` UI.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mc = MongoClient(MONGO_URL)
db = mc[DB_NAME]

USER_ID = f"user_ao3filter_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_ao3filter_{uuid.uuid4().hex}"


def H():
    return {"Authorization": f"Bearer {TOKEN}"}


def _seed_book(book_id: str, *, title: str, rating: str | None = None,
               categories: list[str] | None = None,
               warnings: list[str] | None = None) -> None:
    db.books.insert_one({
        "book_id": book_id,
        "user_id": USER_ID,
        "title": title,
        "author": "Test Author",
        "category": "Fanfiction",
        "fandom": "Test Fandom",
        "rating": rating,
        "categories": categories or [],
        "warnings": warnings or [],
        "characters": [],
        "relationships": [],
        "created_at": datetime.now(timezone.utc),
        "uploaded_at": datetime.now(timezone.utc),
    })


@pytest.fixture(scope="module", autouse=True)
def seed_library():
    db.users.insert_one({
        "user_id": USER_ID,
        "email": f"{USER_ID}@example.com",
        "name": "AO3 Filter Tester",
        "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": TOKEN,
        "user_id": USER_ID,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })

    _seed_book("book_ao3f_g", title="A Gentle Tale", rating="General Audiences",
               categories=["Gen"], warnings=["No Archive Warnings Apply"])
    _seed_book("book_ao3f_e", title="The Spicy One", rating="Explicit",
               categories=["M/M"], warnings=["Graphic Depictions Of Violence"])
    _seed_book("book_ao3f_m", title="Mature Drama", rating="Mature",
               categories=["F/M"], warnings=["Major Character Death"])
    _seed_book("book_ao3f_t", title="Teen Fluff", rating="Teen And Up Audiences",
               categories=["F/F"], warnings=["No Archive Warnings Apply"])
    _seed_book("book_ao3f_unrated", title="Mystery", rating=None,
               categories=[], warnings=[])

    yield

    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})


def _titles(params):
    r = requests.get(f"{BASE}/api/books", params=params, headers=H(), timeout=20)
    r.raise_for_status()
    return sorted(b["title"] for b in r.json().get("books", []))


def test_filter_by_rating_explicit_returns_only_explicit():
    assert _titles({"rating": "Explicit"}) == ["The Spicy One"]


def test_filter_by_rating_general_returns_only_general():
    assert _titles({"rating": "General Audiences"}) == ["A Gentle Tale"]


def test_filter_by_ao3_category_mm_returns_only_mm():
    assert _titles({"ao3_category": "M/M"}) == ["The Spicy One"]


def test_filter_by_warning_major_character_death():
    assert _titles({"warning": "Major Character Death"}) == ["Mature Drama"]


def test_exclude_warning_hides_books_with_that_warning():
    # Hide books warned for "Graphic Depictions Of Violence". The Spicy One
    # carries that warning, so it should be filtered out; everything else
    # (including books with no warnings) must remain.
    titles = _titles({"exclude_warning": "Graphic Depictions Of Violence"})
    assert "The Spicy One" not in titles
    assert "A Gentle Tale" in titles
    assert "Mature Drama" in titles
    assert "Teen Fluff" in titles
    assert "Mystery" in titles


def test_combined_rating_and_category():
    # Mature rating AND F/M category should match only "Mature Drama"
    assert _titles({"rating": "Mature", "ao3_category": "F/M"}) == ["Mature Drama"]


def test_combined_warning_and_exclude_warning():
    # Show books with "No Archive Warnings Apply", and within those exclude
    # any that ALSO carry "Major Character Death" (none do here, so both
    # gentle/teen books remain).
    titles = _titles({
        "warning": "No Archive Warnings Apply",
        "exclude_warning": "Major Character Death",
    })
    assert titles == ["A Gentle Tale", "Teen Fluff"]


def test_unknown_rating_returns_empty():
    assert _titles({"rating": "Not A Real Rating"}) == []
