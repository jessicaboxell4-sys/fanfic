"""Franchise groupings — collapses related sub-fandoms into a single parent
cell on the Account-page treemap (and anywhere else that wants the rolled-up
view).

Each key is a *display* franchise name (the parent cell label). The value is
the list of *exact* canonical fandom names — as they appear in
`FANDOM_KEYWORDS` (after the bundled `ao3_top_fandoms.py` merge) — that
should roll up under it.

A fandom that isn't in any list stays standalone (no parent cell). Order
within a list doesn't matter.

The frontend exposes a toggle on the Fandom Treemap so users can flip between
"Show every fandom" (raw `/api/fandoms` view) and "Group by franchise"
(nested treemap using this map).
"""

from typing import Dict, List


FRANCHISE_GROUPS: Dict[str, List[str]] = {
    "Stargate": [
        "Stargate SG-1",
        "Stargate Atlantis",
        "Stargate Universe",
        "Stargate (Movies)",
    ],
    "NCIS": [
        "NCIS",
        "NCIS: Hawai'i",
        "NCIS: Los Angeles",
        "NCIS: New Orleans",
        "NCIS: Origins",
        "NCIS: Sydney",
        "NCIS: Tony & Ziva",
    ],
    "Riordanverse": [
        "Percy Jackson and the Olympians",
        "Percy Jackson and the Olympians (TV)",
        "Heroes of Olympus",
        "Trials of Apollo",
        "The Sun and the Star",
        "Magnus Chase and the Gods of Asgard",
        "The Kane Chronicles",
        "Daughter of the Deep",
    ],
    "Shadowhunters (Cassandra Clare)": [
        "Shadowhunter Chronicles - Cassandra Clare",
        "The Mortal Instruments",
        "The Infernal Devices",
        "The Dark Artifices",
        "The Last Hours",
        "The Eldest Curses",
        "Tales from the Shadowhunter Academy",
        "Shadowhunters (TV)",
    ],
    "Cosmere (Brandon Sanderson)": [
        "Mistborn Series - Brandon Sanderson",
        "The Stormlight Archive - Brandon Sanderson",
        "Warbreaker",
        "Elantris",
        "Tress of the Emerald Sea",
        "Yumi and the Nightmare Painter",
        "The Sunlit Man",
    ],
    "Sarah J. Maas": [
        "A Court of Thorns and Roses - Sarah J. Maas",
        "Throne of Glass - Sarah J. Maas",
        "Crescent City",
    ],
    "Star Wars Universe": [
        "Star Wars",
        "Star Wars - All Media Types",
        "Star Wars Sequel Trilogy",
        "Star Wars: The Clone Wars (2008) - All Media Types",
        "The Mandalorian (TV)",
        "Andor (TV)",
        "Star Wars: The Bad Batch (Cartoon)",
        "Star Wars Rebels",
        "Star Wars: Knights of the Old Republic",
        "Star Wars Visions",
        "Rogue One: A Star Wars Story",
    ],
    "Critical Role / D&D": [
        "Critical Role (Web Series)",
        "The Legend of Vox Machina (Cartoon)",
        "Vox Machina (Critical Role)",
        "The Mighty Nein (Critical Role)",
        "Bell's Hells (Critical Role)",
        "Dungeons & Dragons (Role-Playing Game)",
    ],
    "My Hero Academia": [
        "My Hero Academia",
        "My Hero Academia: Vigilantes",
    ],
    "Marvel": [
        "Marvel",
        "Marvel Cinematic Universe",
        "The Avengers (Marvel Movies)",
        "Captain America (Movies)",
        "Iron Man (Movies)",
        "Thor (Movies)",
        "Spider-Man: Homecoming (2017)",
        "Daredevil (Comics)",
        "X-Men (Comicverse)",
    ],
    "DC": [
        "DC Comics",
        "DCU (Movies)",
        "DCU (Comics)",
        "Batman - All Media Types",
        "Young Justice (Comics)",
    ],
    "Star Wars": [
        # Empty — superseded by "Star Wars Universe" near the top of
        # this dict (which adds Mandalorian, Andor, Bad Batch, Rebels,
        # KOTOR, Visions, Rogue One). Kept here as a sentinel so
        # downstream code that imports this module can still introspect
        # the name; the reverse index picks the populated entry.
    ],
    "Middle-earth": [
        "Lord of the Rings",
        "Lord of the Rings (Movies)",
        "The Hobbit (Jackson Movies)",
    ],
    "Star Trek": [
        "Star Trek: Alternate Original Series (AOS) - Fandom",
        "Star Trek: The Original Series",
        "Star Trek: The Next Generation",
        "Star Trek: Deep Space Nine",
        "Star Trek: Voyager",
        "Star Trek: Strange New Worlds",
        "Star Trek: Lower Decks",
        "Star Trek: Picard",
        "Star Trek: Discovery",
        "Star Trek: Enterprise",
        "Star Trek: Prodigy",
    ],
    "Pokémon": [
        "Pokemon - All Media Types",
        "Pokémon Adventures / Pokémon Special (Manga)",
        "Detective Pikachu",
        "Pokémon GO",
    ],
    "Honkai / miHoYo Games": [
        "原神 | Genshin Impact (Video Game)",
        "崩坏：星穹铁道 | Honkai: Star Rail (Video Game)",
        "Honkai Impact 3rd",
    ],
    "Avatar (Bryke)": [
        "Avatar: The Last Airbender",
        "The Legend of Korra",
    ],
    "Final Fantasy": [
        "Final Fantasy VII",
        "Final Fantasy XIV Online",
        "Final Fantasy XV",
    ],
    "Persona": [
        "Persona 5",
        "Persona Series",
    ],
    "Fire Emblem": [
        "Fire Emblem: Three Houses",
        "Fire Emblem Series - All Media Types",
    ],
    "Dragon Age": [
        "Dragon Age - All Media Types",
        "Dragon Age: Inquisition",
    ],
    "The Witcher": [
        "The Witcher - Andrzej Sapkowski",
        "The Witcher (TV)",
    ],
    "The Legend of Zelda": [
        "The Legend of Zelda - All Media Types",
        "The Legend of Zelda: Breath of the Wild",
    ],
    "Sherlock Holmes": [
        "Sherlock Holmes",
        "Sherlock (TV)",
    ],
    "Mo Xiang Tong Xiu — The Untamed / MDZS": [
        "魔道祖师 - 墨香铜臭 | Módào Zǔshī - Mòxiāng Tóngxiù",
        "天官赐福 - 墨香铜臭 | Tiān Guān Cì Fú - Mòxiāng Tóngxiù",
        "陈情令 | The Untamed (TV)",
    ],
    # Sarah J. Maas + Sanderson Cosmere franchises now live in the
    # consolidated block near the top of this dict (lines ~57-72) which
    # bundles Crescent City and the rest of the Cosmere alongside the
    # original AO3-seed entries — removed from here 2026-06-13 to fix a
    # dict-key collision that was hiding the new sub-fandoms.
    # ``Honkai / miHoYo Games`` was likewise consolidated upstream (now
    # also includes ``Honkai Impact 3rd``); see definition near the top
    # of this dict. No stub is needed here — dict-key collisions silently
    # overwrite.
}


# Reverse index: fandom canonical → franchise name. Built lazily so the
# module is cheap to import.
_REVERSE_INDEX: Dict[str, str] = {}
for _franchise, _members in FRANCHISE_GROUPS.items():
    for _m in _members:
        _REVERSE_INDEX[_m] = _franchise
del _franchise, _members, _m


def franchise_for(fandom: str) -> str:
    """Return the franchise the given canonical fandom belongs to, or the
    fandom itself when it doesn't roll up under any franchise."""
    if not fandom:
        return ""
    return _REVERSE_INDEX.get(fandom, fandom)
