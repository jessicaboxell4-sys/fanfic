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
        "Star Wars",
        "Star Wars - All Media Types",
        "Star Wars: The Clone Wars (2008) - All Media Types",
        "Star Wars Sequel Trilogy",
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
    "Sarah J. Maas": [
        "A Court of Thorns and Roses - Sarah J. Maas",
        "Throne of Glass - Sarah J. Maas",
    ],
    "Sanderson Cosmere": [
        "Mistborn Series - Brandon Sanderson",
        "The Stormlight Archive - Brandon Sanderson",
    ],
    "Honkai / miHoYo Games": [
        "原神 | Genshin Impact (Video Game)",
        "崩坏：星穹铁道 | Honkai: Star Rail (Video Game)",
    ],
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
