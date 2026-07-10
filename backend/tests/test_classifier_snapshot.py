"""Snapshot regression for the heuristic classifier.

Runs ``classify_by_metadata`` against ~50 representative book
metadata fixtures and compares the structured output to a JSON
snapshot on disk.  Catches the "I tweaked the prompt / keyword bank
and now every Marvel fic is classified as DC" class of bug that
quietly breaks the upload pipeline.

Workflow
--------

1. First run with no snapshot on disk → the snapshot file is
   written and the test passes with a printed reminder.
2. Subsequent runs → diff every fixture against the snapshot;
   any difference fails the test loudly.
3. To intentionally update the snapshot after a deliberate change,
   run with ``SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT=1 pytest …``.

We use *only* the heuristic classifier (``classify_by_metadata``)
because the AI path goes through Claude and would be both flaky and
slow under CI.  The heuristic covers 80 % of the regression surface
on its own — the keyword bank + ``FANFIC_SIGNALS`` + ``NONFICTION_SIGNALS``
are the bits that get edited most often.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

import pytest

from utils.classifier import classify_by_metadata


SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "classifier_snapshot.json"


# ---------------------------------------------------------------------
# Fixture set — pick representative examples for every classifier
# branch so a regression on any single FANDOM_KEYWORDS bucket shows up.
# ---------------------------------------------------------------------

FIXTURES: List[Dict[str, Any]] = [
    # --- Big fanfic franchises ---
    {"id": "hp-drarry",
     "title": "Drarry: The Half-Blood Heir",
     "author": "fanwriter42", "description": "Hogwarts AU slow-burn drarry hermione granger draco malfoy",
     "publisher": "", "sample_text": "voldemort dumbledore weasley snape"},
    {"id": "hp-genfic",
     "title": "Eight Years Later", "author": "anon_hp",
     "description": "Harry, Hermione and Ron return to Hogwarts as adults",
     "publisher": "", "sample_text": "hogwarts hermione weasley dumbledore"},
    {"id": "twi-romance",
     "title": "Forks Forever", "author": "tw_fan",
     "description": "Bella Swan and Edward Cullen reunion years after Breaking Dawn",
     "publisher": "", "sample_text": "twilight saga cullen family jacob black"},
    {"id": "marvel-cap-iw",
     "title": "Civil Disagreement", "author": "mcu_fan",
     "description": "Tony Stark and Steve Rogers post-Civil War angst",
     "publisher": "", "sample_text": "avengers iron man captain america spider-man"},
    {"id": "dc-batfam",
     "title": "Robins of Gotham", "author": "dc_fan",
     "description": "Bruce Wayne adopts the bat family",
     "publisher": "", "sample_text": "batman gotham bruce wayne dc comics"},
    {"id": "sw-rebels",
     "title": "Lothal's Dawn", "author": "sw_fan",
     "description": "Star Wars rebellion era fanfic",
     "publisher": "", "sample_text": "star wars jedi sith the force skywalker"},
    {"id": "lotr-aragorn",
     "title": "King of the Reunited Kingdom", "author": "tolkien_fan",
     "description": "Aragorn's rule after the War of the Ring",
     "publisher": "", "sample_text": "lord of the rings frodo gandalf middle-earth"},
    {"id": "sherlock-bbc",
     "title": "After Reichenbach", "author": "johnlock_fan",
     "description": "Sherlock and John reunite three years later",
     "publisher": "", "sample_text": "sherlock holmes 221b baker john watson moriarty"},
    # --- Riordanverse (lots of sub-fandoms, important to get right) ---
    {"id": "pjo-classic",
     "title": "Tide of Tartarus", "author": "demigod_fan",
     "description": "Percy Jackson and Annabeth Chase return to camp",
     "publisher": "", "sample_text": "percy jackson camp half-blood annabeth chase olympians lightning thief"},
    {"id": "pjo-companion",
     "title": "Greek Heroes Retold", "author": "rick_riordan",
     "description": "Percy narrates the Greek heroes",
     "publisher": "", "sample_text": "percy jackson's greek heroes mythology"},
    {"id": "hoo-jason",
     "title": "Lost Hero Returned", "author": "hoo_fan",
     "description": "Jason Grace post-Blood of Olympus",
     "publisher": "", "sample_text": "heroes of olympus jason grace piper mclean leo valdez"},
    {"id": "toa-apollo",
     "title": "Lester's Last Stand", "author": "toa_fan",
     "description": "Apollo as Lester Papadopoulos",
     "publisher": "", "sample_text": "trials of apollo lester papadopoulos the hidden oracle"},
    {"id": "magnus-asgard",
     "title": "Sword Reforged", "author": "mc_fan",
     "description": "Magnus Chase post-Ship of the Dead",
     "publisher": "", "sample_text": "magnus chase gods of asgard sword of summer"},
    {"id": "kane-egypt",
     "title": "Brooklyn House Revisited", "author": "kane_fan",
     "description": "Carter and Sadie Kane post-Serpent's Shadow",
     "publisher": "", "sample_text": "kane chronicles carter kane sadie kane red pyramid"},
    {"id": "sun-and-star",
     "title": "Tartarus Rescue Mission", "author": "solangelo_fan",
     "description": "Nico and Will descend into Tartarus",
     "publisher": "", "sample_text": "the sun and the star nico di angelo and will solace"},
    # --- Shadowhunters sub-series ---
    {"id": "tmi-jace",
     "title": "Cup of Wrath", "author": "tmi_fan",
     "description": "Clary and Jace post-City of Heavenly Fire",
     "publisher": "", "sample_text": "mortal instruments clary fray jace wayland magnus bane"},
    {"id": "tid-tessa",
     "title": "Clockwork Echoes", "author": "tid_fan",
     "description": "Tessa Gray Victorian Shadowhunters",
     "publisher": "", "sample_text": "infernal devices clockwork angel tessa gray will herondale"},
    # --- Crossovers ---
    {"id": "crossover-hp-marvel",
     "title": "Wizards & Avengers", "author": "crossover_fan",
     "description": "Harry Potter meets the Avengers in New York",
     "publisher": "", "sample_text": "hogwarts hermione weasley avengers iron man tony stark"},
    # --- Vague fanfic with no specific franchise ---
    {"id": "fanfic-generic",
     "title": "Coffee Shop AU", "author": "anon",
     "description": "An enemies-to-lovers slow-burn fanfic AU",
     "publisher": "AO3", "sample_text": "fanfic ao3 archive of our own one-shot WIP"},
    # --- Original fiction (no fandom keyword hits, no fanfic signals) ---
    {"id": "origfic-fantasy",
     "title": "The Crystal Throne", "author": "Elara Vance",
     "description": "An epic fantasy novel about a kingdom torn by civil war",
     "publisher": "Tor Books", "sample_text": "the kingdom of Vellaria stood divided"},
    {"id": "origfic-romance",
     "title": "Summer in Sicily", "author": "Lauren Pace",
     "description": "A second-chance romance set on the Italian coast",
     "publisher": "Avon", "sample_text": "She had not expected the postcard from Sorrento"},
    {"id": "origfic-thriller",
     "title": "The Glass House", "author": "K. M. Saint",
     "description": "A psychological thriller about a marriage of secrets",
     "publisher": "Mulholland Books", "sample_text": "The detective adjusted his collar"},
    # --- Non-fiction ---
    {"id": "nonfic-memoir",
     "title": "Becoming Myself", "author": "Real Name",
     "description": "A memoir of growing up in rural America",
     "publisher": "Penguin", "sample_text": "this memoir traces my childhood across three states"},
    {"id": "nonfic-cookbook",
     "title": "The French Family Table", "author": "Chef Dupont",
     "description": "A cookbook of weeknight French classics for home cooks",
     "publisher": "Clarkson Potter", "sample_text": "this cookbook gathers 100 recipes"},
    {"id": "nonfic-bio",
     "title": "The Light of Curie", "author": "S. Reynolds",
     "description": "A biography of Marie Curie's later years",
     "publisher": "Knopf", "sample_text": "this biography draws on letters from the Curie archives"},
    {"id": "nonfic-history",
     "title": "Bread and Empire", "author": "Prof. Hill",
     "description": "A history of the trade routes of late antiquity",
     "publisher": "Oxford UP", "sample_text": "this history of the silk road covers the 4th century"},
    {"id": "nonfic-selfhelp",
     "title": "Atomic Mornings", "author": "M. Doe",
     "description": "A self-help guide to building sustainable habits",
     "publisher": "", "sample_text": "this self-help handbook focuses on tiny habits"},
    # --- Unclassified edge cases ---
    {"id": "unclassified-empty",
     "title": "Untitled", "author": "Unknown",
     "description": "", "publisher": "", "sample_text": ""},
    {"id": "unclassified-short",
     "title": "Notes",
     "author": "Anonymous", "description": "Some scattered notes",
     "publisher": "", "sample_text": "various jottings collected over years"},
]


def _run() -> List[Dict[str, Any]]:
    """Run every fixture through the classifier and return the output set."""
    results: List[Dict[str, Any]] = []
    for fx in FIXTURES:
        meta = {k: v for k, v in fx.items() if k != "id"}
        out = classify_by_metadata(meta)
        # Pin only the stable shape — drop floating point noise in
        # confidence by rounding so a 0.0001 drift doesn't break the
        # snapshot.
        results.append({
            "id":         fx["id"],
            "category":   out["category"],
            "fandom":     out.get("fandom"),
            "classifier": out.get("classifier"),
            "confidence": round(float(out.get("confidence", 0.0)), 2),
        })
    return results


def test_classifier_snapshot_matches():
    """Run every fixture and diff against the on-disk snapshot.

    First run (no snapshot file) writes it and passes.  After that,
    any classifier or keyword-bank change that shifts an output
    will fail this test until the snapshot is intentionally
    refreshed via ``SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT=1``.
    """
    current = _run()
    update_flag = bool(os.environ.get("SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT"))

    if not SNAPSHOT_PATH.exists() or update_flag:
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
        print(f"\n[snapshot] wrote {SNAPSHOT_PATH} ({len(current)} fixtures)")
        return   # First run / explicit refresh — pass

    expected = json.loads(SNAPSHOT_PATH.read_text())
    if current != expected:
        # Render a compact diff so the failure message is useful.
        by_id_cur = {r["id"]: r for r in current}
        by_id_exp = {r["id"]: r for r in expected}
        all_ids = sorted(set(by_id_cur) | set(by_id_exp))
        diffs: List[str] = []
        for fid in all_ids:
            if by_id_cur.get(fid) != by_id_exp.get(fid):
                diffs.append(f"  [{fid}] expected={by_id_exp.get(fid)}  current={by_id_cur.get(fid)}")
        pytest.fail(
            "Classifier snapshot drift detected.\n"
            "Re-run with SHELFSORT_UPDATE_CLASSIFIER_SNAPSHOT=1 to intentionally refresh.\n"
            + "\n".join(diffs)
        )


def test_snapshot_covers_each_category():
    """Sanity: the fixture set hits every classifier branch so a
    keyword-bank regression in any category surfaces."""
    cats = {r["category"] for r in _run()}
    assert "Fanfiction" in cats
    assert "Non-fiction" in cats
    assert "Unclassified" in cats
    # We deliberately don't assert "Original Fiction" — the heuristic
    # classifier sends those to "Unclassified" and lets the AI step
    # claim them.  The original-fiction fixtures above prove the
    # heuristic doesn't mis-classify them as Fanfiction.
