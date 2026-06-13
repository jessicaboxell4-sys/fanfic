"""Regression test for the ``GET /api/fandoms/known`` endpoint surfaced on
the Help page. Catches the previous bug where the endpoint was sourced
from ``data/ao3_top_fandoms.AO3_TOP_FANDOMS`` (131 entries) and silently
dropped the hand-tuned shelf fandoms (Harry Potter, Twilight, Marvel,
Stargate sub-fandoms, …) that the classifier actually routes books into.
"""
from __future__ import annotations

import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://genre-sort.preview.emergentagent.com").rstrip("/")


def _fetch():
    r = requests.get(f"{BASE}/api/fandoms/known", timeout=15)
    r.raise_for_status()
    return r.json()


def test_endpoint_returns_count_and_list():
    body = _fetch()
    assert isinstance(body.get("fandoms"), list)
    assert body["count"] == len(body["fandoms"])
    assert body["count"] > 0
    # New (2026-06-13): grouped/sorted shape for the Help page renderer.
    assert isinstance(body.get("groups"), list)
    assert body["groups"], "groups must be non-empty when fandoms exist"
    g0 = body["groups"][0]
    assert {"name", "total", "fandoms"} <= set(g0.keys())
    # Every member of every group must be one of the canonical fandoms.
    flat = set(body["fandoms"])
    for g in body["groups"]:
        for m in g["fandoms"]:
            assert {"name", "count"} <= set(m.keys())
            assert m["name"] in flat


def test_groups_are_sorted_most_used_first():
    body = _fetch()
    totals = [g["total"] for g in body["groups"]]
    # Non-increasing on the primary key (total). Ties may reorder by
    # secondary keys (member-count, alphabetical), so we don't enforce
    # strict equality beyond the monotonic-decreasing total.
    assert totals == sorted(totals, reverse=True), \
        f"Group totals not sorted descending: first 8 = {totals[:8]}"


def test_franchise_grouping_keeps_related_fandoms_together():
    body = _fetch()
    by_name = {g["name"]: g for g in body["groups"]}
    # Stargate franchise collapsed into one card with all 4 sub-fandoms.
    sg = by_name.get("Stargate")
    assert sg is not None, "Stargate franchise must be its own group"
    sg_members = {m["name"] for m in sg["fandoms"]}
    assert sg_members == {
        "Stargate SG-1", "Stargate Atlantis",
        "Stargate Universe", "Stargate (Movies)",
    }
    # NCIS franchise (added 2026-06-13) groups all NCIS spin-offs.
    nc = by_name.get("NCIS")
    assert nc is not None, "NCIS franchise must be its own group"
    nc_members = {m["name"] for m in nc["fandoms"]}
    assert "NCIS" in nc_members
    assert "NCIS: Hawai'i" in nc_members
    assert "NCIS: Los Angeles" in nc_members


def test_within_group_members_sorted_by_count_then_alpha():
    body = _fetch()
    for g in body["groups"]:
        if len(g["fandoms"]) < 2:
            continue
        sorted_expected = sorted(
            g["fandoms"], key=lambda m: (-m["count"], m["name"].lower()),
        )
        assert g["fandoms"] == sorted_expected, \
            f"Group '{g['name']}' members not sorted by count desc + alpha"


def test_endpoint_returns_hand_tuned_shelf_fandoms():
    # These 20 fandoms live in ``routes.books.FANDOM_KEYWORDS`` and are
    # what the keyword classifier actually routes shelf names from. They
    # were missing from the AO3-only seed before 2026-06-13.
    fandoms = set(_fetch()["fandoms"])
    must_have = {
        "Harry Potter", "Twilight", "Marvel", "DC Comics", "Star Wars",
        "Lord of the Rings", "Sherlock Holmes", "Percy Jackson",
        "Doctor Who", "Supernatural", "Game of Thrones", "Hunger Games",
        "Naruto", "My Hero Academia", "BTS", "One Direction",
        "Stargate SG-1", "Stargate Atlantis", "Stargate Universe",
        "Stargate (Movies)",
    }
    missing = must_have - fandoms
    assert not missing, f"Hand-tuned shelf fandoms missing from /api/fandoms/known: {sorted(missing)}"


def test_endpoint_includes_ao3_seed_too():
    # And the AO3 seed (~130 popular fandoms) must still be present so we
    # don't accidentally regress the other direction.
    fandoms = set(_fetch()["fandoms"])
    # A couple of distinctive AO3-canonical names that are NOT in the
    # hand-tuned list:
    seed_samples = {
        "A Song of Ice and Fire - George R. R. Martin",
        "Avatar: The Last Airbender",
        "Good Omens (TV)",
    }
    missing = seed_samples - fandoms
    assert not missing, f"AO3 seed fandoms missing: {sorted(missing)}"


def test_list_is_alphabetical_case_insensitive():
    fandoms = _fetch()["fandoms"]
    assert fandoms == sorted(fandoms, key=lambda s: s.lower())


def test_endpoint_is_public_no_auth_required():
    # No Authorization header — must still return 200 with the same body.
    r = requests.get(f"{BASE}/api/fandoms/known", timeout=15)
    assert r.status_code == 200
    assert "fandoms" in r.json()
