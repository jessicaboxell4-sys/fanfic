"""Tests for the new AO3-metadata rule types added to Smart Shelves.

Verifies that ``rating`` / ``ao3_category`` / ``warning`` / ``exclude_warning``
rules:
1. Round-trip through POST /smart-shelves (allow-listed).
2. Compile to the right Mongo filter so GET /smart-shelves returns the
   correct ``count`` and GET /smart-shelves/{id}/books returns the right
   subset of the library.
3. Combine correctly (AND/OR) with each other and with the existing
   ``fandom`` rule.
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

USER_ID = f"user_ao3sh_{uuid.uuid4().hex[:8]}"
TOKEN = f"sess_ao3sh_{uuid.uuid4().hex}"


def H():
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def _book(book_id: str, *, title: str, fandom: str = "Test Fandom",
          rating: str | None = None,
          categories: list[str] | None = None,
          warnings: list[str] | None = None):
    db.books.insert_one({
        "book_id": book_id, "user_id": USER_ID, "title": title,
        "author": "Tester", "category": "Fanfiction", "fandom": fandom,
        "rating": rating, "categories": categories or [],
        "warnings": warnings or [], "characters": [], "relationships": [],
        "created_at": datetime.now(timezone.utc),
        "uploaded_at": datetime.now(timezone.utc),
    })


@pytest.fixture(scope="module", autouse=True)
def seed():
    db.users.insert_one({
        "user_id": USER_ID, "email": f"{USER_ID}@e.com",
        "name": "Shelf Tester", "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": TOKEN, "user_id": USER_ID,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    _book("b_e_mm", title="Explicit MM", rating="Explicit",
          categories=["M/M"], warnings=["Graphic Depictions Of Violence"])
    _book("b_m_fm", title="Mature FM", rating="Mature",
          categories=["F/M"], warnings=["Major Character Death"])
    _book("b_g_gen_safe", title="Gentle Gen", rating="General Audiences",
          categories=["Gen"], warnings=["No Archive Warnings Apply"])
    _book("b_t_ff_xover", title="Teen FF (HP)", fandom="Harry Potter",
          rating="Teen And Up Audiences",
          categories=["F/F"], warnings=["No Archive Warnings Apply"])
    yield
    db.users.delete_many({"user_id": USER_ID})
    db.user_sessions.delete_many({"user_id": USER_ID})
    db.books.delete_many({"user_id": USER_ID})
    db.smart_shelves.delete_many({"user_id": USER_ID})


def _create_shelf(name: str, rules: list[dict], combinator: str = "AND"):
    r = requests.post(f"{BASE}/api/smart-shelves", headers=H(), json={
        "name": name, "query": {"combinator": combinator, "rules": rules},
        "pinned": False,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _books_in_shelf(shelf_id: str):
    r = requests.get(f"{BASE}/api/smart-shelves/{shelf_id}/books", headers=H(), timeout=15)
    assert r.status_code == 200, r.text
    return sorted(b["title"] for b in r.json().get("books", []))


def test_rating_rule_filters_correctly():
    shelf = _create_shelf("Only Explicit", [{"field": "rating", "value": "Explicit"}])
    assert _books_in_shelf(shelf["shelf_id"]) == ["Explicit MM"]


def test_ao3_category_rule_maps_to_categories_field():
    shelf = _create_shelf("Just M/M", [{"field": "ao3_category", "value": "M/M"}])
    assert _books_in_shelf(shelf["shelf_id"]) == ["Explicit MM"]


def test_warning_rule_filters_to_books_with_warning():
    shelf = _create_shelf("MCD only", [{"field": "warning", "value": "Major Character Death"}])
    assert _books_in_shelf(shelf["shelf_id"]) == ["Mature FM"]


def test_exclude_warning_rule_hides_matching_books():
    shelf = _create_shelf("No graphic violence", [
        {"field": "exclude_warning", "value": "Graphic Depictions Of Violence"},
    ])
    titles = _books_in_shelf(shelf["shelf_id"])
    assert "Explicit MM" not in titles
    assert set(titles) == {"Mature FM", "Gentle Gen", "Teen FF (HP)"}


def test_combined_rating_plus_ao3_category_plus_exclude_warning():
    # Mature OR Explicit (rating) ∧ M/M ∧ no MCD — single match: Explicit MM
    shelf = _create_shelf("Spicy slash, no MCD", [
        {"field": "rating", "value": "Explicit"},
        {"field": "ao3_category", "value": "M/M"},
        {"field": "exclude_warning", "value": "Major Character Death"},
    ])
    assert _books_in_shelf(shelf["shelf_id"]) == ["Explicit MM"]


def test_combined_with_fandom_rule():
    shelf = _create_shelf("Teen HP fluff", [
        {"field": "fandom", "value": "Harry Potter"},
        {"field": "rating", "value": "Teen And Up Audiences"},
    ])
    assert _books_in_shelf(shelf["shelf_id"]) == ["Teen FF (HP)"]


def test_list_smart_shelves_returns_count_for_ao3_filtered_shelf():
    shelf = _create_shelf("Counts test", [{"field": "rating", "value": "Mature"}])
    r = requests.get(f"{BASE}/api/smart-shelves", headers=H(), timeout=15)
    assert r.status_code == 200
    rows = {s["shelf_id"]: s for s in r.json().get("shelves", [])}
    assert rows[shelf["shelf_id"]]["count"] == 1


def test_preview_endpoint_works_for_ao3_rule():
    r = requests.post(f"{BASE}/api/smart-shelves/preview", headers=H(), json={
        "query": {"combinator": "AND", "rules": [
            {"field": "rating", "value": "General Audiences"},
        ]},
    }, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["sample"][0]["title"] == "Gentle Gen"


def test_empty_value_rule_is_skipped():
    # Empty value → rule is dropped → shelf shows all 4 books.
    shelf = _create_shelf("Empty rule", [{"field": "rating", "value": ""}])
    titles = _books_in_shelf(shelf["shelf_id"])
    assert len(titles) == 4
