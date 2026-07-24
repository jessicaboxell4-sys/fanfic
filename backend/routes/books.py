"""``routes/books.py`` — core book lifecycle, upload pipeline, metadata.

This file is the heart of Shelfsort. As the app grew, the more
specialised endpoint clusters got peeled off into their own modules. The
table below is the current map so future maintainers can find things
fast (line numbers are approximate; sections move as code is added).

================ STILL IN THIS FILE ================
Section / lines
  Upload & ingestion           : single-file + bulk POST /api/books/upload
  EPUB metadata extraction     : extract_epub_metadata, extract_chapters,
                                 diff_chapters, _normalize_title_for_match,
                                 _updated_shelf_name, OLD_STORIES_SHELF
  Fanfic detection             : detect_source_from_text, find_duplicate_candidates,
                                 normalize_fanfic_url, fanfic-URL canonicalisation
  Single-book CRUD             : GET/PATCH/DELETE /api/books/{book_id}
  Reader assets                : GET /api/books/{book_id}/download
                                 GET /api/books/{book_id}/cover/{filename}
                                 GET /api/books/{book_id}/download-original
                                 GET /api/books/{book_id}/diff (vs previous version)
  Library listings & filters   : GET /api/library/all and friends (by category,
                                 status, fandom, pairing, tag)
  Categories / shelves         : POST/DELETE /api/categories,
                                 POST /api/books/{book_id}/category
  Cover regeneration           : POST /api/books/{book_id}/cover/regenerate
  Manual status mutator        : PATCH /api/books/{book_id}/status
  Trash                        : (extracted to routes/trash.py — pre Phase 5)
  Relationships / pairings     : last block in the file, /api/relationships*

================ EXTRACTED MODULES ================
routes/refresh.py             : POST /api/books/{book_id}/refresh (Phase 4)
routes/duplicates.py          : auto-pending-duplicate badge helpers (Phase 4)
routes/duplicate_resolution.py: POST /api/books/{book_id}/resolve-duplicate
                                POST /api/books/resolve-group
                                GET  /api/library/duplicates(/count) (Phase 5D)
routes/library_views.py       : GET /api/library/trends, status-counts,
                                complete, ongoing, linkless, unreadable
                                + _status_query / _list_status_shelf (Phase 5E)
routes/reading_activity.py    : POST /api/books/{id}/mark, /heartbeat,
                                /progress, /touch + _log_activity (Phase 5F)
routes/url_lists.py           : POST /api/url-lists/scan + helpers (Phase 5A)
routes/fandoms.py             : GET /api/fandoms (community list) (Phase 5B)
routes/exports.py             : GET /api/library/download(?kind=xlsx)
                                + ZIP/XLSX builders (Phase 5C)
routes/conversions.py         : POST /api/library/originals/{id}/convert
                                + bulk convert (Phase 1)
routes/trash.py               : GET /api/library/trash, restore, empty (Phase 2)
routes/covers.py              : AI cover generation, variants,
                                community pool, voting, lineage,
                                public profile, cover styles,
                                cover-less books list (Phase 6A,
                                2026-06-25) — 17 endpoints, ~900 LOC.
                                Shares ``_write_local_and_mirror_to_r2``
                                from this file (one-way import).
routes/bulk_ops.py            : Destructive / mass-edit endpoints —
                                reclassify-all, bulk delete/move/
                                metadata, reset-state, wipe-library
                                (Phase 6B, 2026-06-25).  6 endpoints,
                                ~350 LOC.  Imports
                                ``_canonicalize_fandom``,
                                ``_normalize_tags``,
                                ``OLD_STORIES_SHELF`` from this file.
routes/library_reads.py       : High-frequency GET routes — main
                                ``/books`` list, ``/books/stats``,
                                ``/books/recent``,
                                ``/books/recent-updates``,
                                ``/books/quick-search``,
                                ``/books/export/unavailable``,
                                ``/fandoms``, ``/authors/{name}``,
                                plus the two ``mark-update-seen`` POSTs
                                (Phase 6D, 2026-06-27).  10 endpoints,
                                ~440 LOC.  Pure-read boundary, no
                                shared helpers needed from this file.

The shared helpers (extract_chapters, diff_chapters, OLD_STORIES_SHELF,
_normalize_title_for_match, etc.) live HERE because the upload + refresh
pipelines depend on them.  Extracted modules import them by name from
``routes.books``; that import is one-way (no cycles).
"""
from fastapi import (
    APIRouter, UploadFile, File, HTTPException, Request, Response,
    Depends, Form, Query,
)
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
import os
import io
import re
import json
import uuid
import base64
import zipfile
import asyncio
import tempfile
import secrets
import bcrypt
import resend
import requests as http_requests

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

from deps import (
    db, app, api_router, logger, ROOT_DIR, STORAGE_DIR,
    EMERGENT_LLM_KEY, RESET_TOKEN_TTL_HOURS, RESEND_API_KEY,
    SENDER_EMAIL, FRONTEND_URL,
)
from models import User, BookOut
from auth_dep import get_current_user, get_current_user_or_none, require_admin
from utils.admin_audit import record_admin_action


from emergentintegrations.llm.chat import LlmChat, UserMessage

from utils.cover_notifications import (
    notify_vote_milestone,
    notify_import_milestone,
    notify_friends_of_new_share,
)


# Heuristic fandom detection. Keys are the canonical shelf name (AO3-style
# canonicals where reasonable — see https://archiveofourown.org/wrangling for
# AO3's fandom-tag convention. When adding NEW fandoms, prefer AO3's exact
# canonical form, e.g. `Stargate SG-1`, `Stargate Atlantis`, `Stargate
# (Movies)` rather than colloquial short names. The umbrella term
# `Stargate - All Media Types` is intentionally NOT used as a default — we
# bucket into the specific sub-fandom so the user can find SG-1 vs Atlantis
# works at a glance, with a cross-listing shelf already auto-built when a
# work spans multiple sub-fandoms.
FANDOM_KEYWORDS = {
    "Harry Potter": [
        "harry potter", "hogwarts", "hermione", "voldemort", "dumbledore",
        "weasley", "snape", "draco malfoy", "ron weasley",
        # Expanded 2026-06-26: more characters for crossover detection.
        # Common AO3/FFN tag forms — first names + last names + initials.
        "harry p.", "ron w.", "hermione g.", "draco m.", "sirius black",
        "remus lupin", "lily evans", "lily potter", "james potter",
        "ginny weasley", "ginny w.", "neville longbottom", "luna lovegood",
        "severus snape", "minerva mcgonagall", "albus dumbledore",
        "tom riddle", "fred weasley", "george weasley", "molly weasley",
        "bellatrix lestrange", "narcissa malfoy", "lucius malfoy",
        "diagon alley", "gryffindor", "slytherin", "ravenclaw", "hufflepuff",
        "muggle", "death eater", "horcrux", "the boy who lived",
        "the burrow", "ministry of magic",
    ],
    "Twilight": [
        "twilight saga", "bella swan", "edward cullen", "stephenie meyer",
        "forks washington", "jacob black", "cullen family",
        # Expanded 2026-06-26: full Cullen family + Quileute pack.
        "jasper hale", "jasper whitlock", "alice cullen", "carlisle cullen",
        "esme cullen", "emmett cullen", "rosalie hale", "renesmee cullen",
        "renesmee", "edward", "bella", "jasper", "alice", "carlisle",
        "rosalie", "emmett", "esme",
        "sam uley", "embry call", "quil ateara", "paul lahote",
        "jared cameron", "leah clearwater", "seth clearwater",
        "the volturi", "aro volturi", "caius", "marcus", "jane volturi",
        "alec volturi", "victoria", "james", "laurent",
        "charlie swan", "renee dwyer",
        "la push", "forks", "olympic peninsula", "quileute",
        "vegetarian vampire", "cold ones", "imprint",
    ],
    "Marvel": [
        "avengers", "iron man", "tony stark", "spider-man", "spider man",
        "captain america", "marvel comics", "x-men", "wolverine",
        # Expanded 2026-06-26: MCU + 616 characters across Avengers, X-Men,
        # Spider-Man, Guardians, Fantastic Four, Defenders.
        "steve rogers", "bucky barnes", "winter soldier", "natasha romanoff",
        "black widow", "clint barton", "hawkeye", "bruce banner", "the hulk",
        "thor odinson", "loki laufeyson", "loki",
        "peter parker", "miles morales", "gwen stacy", "mary jane watson",
        "wanda maximoff", "scarlet witch", "vision", "pietro maximoff",
        "stephen strange", "doctor strange", "scott lang", "ant-man",
        "hope van dyne", "wasp", "carol danvers", "captain marvel",
        "sam wilson", "the falcon", "rhodey", "war machine",
        "shuri", "t'challa", "black panther", "okoye", "wakanda",
        "peter quill", "star-lord", "gamora", "rocket raccoon", "groot",
        "drax", "mantis", "nebula",
        "wade wilson", "deadpool", "logan howlett", "charles xavier",
        "professor x", "magneto", "erik lehnsherr", "jean grey",
        "scott summers", "cyclops", "storm", "rogue", "gambit",
        "matt murdock", "daredevil", "jessica jones", "luke cage",
        "danny rand", "iron fist", "frank castle", "the punisher",
        "reed richards", "sue storm", "johnny storm", "ben grimm",
        "fantastic four",
        "nick fury", "phil coulson", "s.h.i.e.l.d.", "shield",
        "thanos", "infinity stones", "asgard", "midgard",
        "mcu", "kamar-taj", "stark tower", "stark industries",
    ],
    "DC Comics": [
        "batman", "superman", "wonder woman", "gotham", "bruce wayne",
        "clark kent", "dc comics",
        # Expanded 2026-06-26: trinity + Bat family + Justice League.
        "diana prince", "themyscira", "amazons", "lasso of truth",
        "alfred pennyworth", "dick grayson", "nightwing", "jason todd",
        "red hood", "tim drake", "robin", "damian wayne", "barbara gordon",
        "batgirl", "oracle", "stephanie brown", "cassandra cain",
        "lois lane", "lana lang", "kara zor-el", "supergirl",
        "kara danvers", "kal-el", "krypton", "metropolis", "smallville",
        "barry allen", "the flash", "iris west", "wally west", "cisco ramon",
        "central city", "speed force",
        "oliver queen", "green arrow", "felicity smoak", "starling city",
        "star city", "team arrow",
        "hal jordan", "green lantern", "john stewart", "guy gardner",
        "arthur curry", "aquaman", "mera", "atlantis",
        "victor stone", "cyborg", "raven", "starfire", "beast boy",
        "j'onn j'onzz", "martian manhunter",
        "the joker", "harley quinn", "two-face", "the riddler", "penguin",
        "ra's al ghul", "talia al ghul", "league of shadows",
        "lex luthor", "darkseid", "apokolips", "justice league",
        "teen titans", "young justice",
    ],
    "Star Wars": [
        "star wars", "jedi", "sith", "skywalker", "darth vader", "obi-wan",
        "the force",
        # Expanded 2026-06-26.
        "anakin skywalker", "luke skywalker", "leia organa", "han solo",
        "chewbacca", "wookiee", "yoda", "qui-gon jinn", "obi-wan kenobi",
        "padme amidala", "ahsoka tano", "rex", "captain rex", "501st",
        "boba fett", "din djarin", "the mandalorian", "grogu", "baby yoda",
        "rey", "kylo ren", "ben solo", "poe dameron", "finn", "fn-2187",
        "lando calrissian", "mace windu", "count dooku", "darth maul",
        "darth sidious", "emperor palpatine",
        "ezra bridger", "kanan jarrus", "hera syndulla", "sabine wren",
        "tatooine", "naboo", "coruscant", "endor", "hoth",
        "millennium falcon", "death star", "star destroyer",
        "lightsaber", "padawan", "midi-chlorian", "galactic empire",
        "rebel alliance", "first order", "clone wars",
    ],
    "Lord of the Rings": [
        "lord of the rings", "frodo", "gandalf", "middle-earth",
        "middle earth", "hobbit", "tolkien",
        # Expanded 2026-06-26.
        "frodo baggins", "samwise gamgee", "sam gamgee", "merry brandybuck",
        "pippin took", "bilbo baggins", "aragorn", "strider",
        "legolas", "gimli", "boromir", "faramir", "denethor",
        "gandalf the grey", "gandalf the white", "saruman",
        "elrond", "arwen", "galadriel", "celeborn", "thranduil",
        "the one ring", "the shire", "rivendell", "lothlorien",
        "rohan", "gondor", "isengard", "mordor", "mount doom",
        "minas tirith", "helm's deep", "moria", "rohirrim",
        "fellowship of the ring", "sauron", "smaug", "uruk-hai",
        "nazgul", "ringwraith", "balrog", "ents",
        "thorin oakenshield", "kili", "fili",
    ],
    "Sherlock Holmes": [
        "sherlock holmes", "221b baker", "john watson", "moriarty",
        # Expanded 2026-06-26: BBC Sherlock + ACD canon + Elementary.
        "sherlock", "john h. watson", "mycroft holmes", "mrs hudson",
        "irene adler", "molly hooper", "greg lestrade", "g. lestrade",
        "mary morstan", "mary watson", "jim moriarty", "sebastian moran",
        "scotland yard", "baker street", "consulting detective",
        "the woman", "redbeard", "eurus holmes",
        "joan watson",
    ],
    # ----- Other crossover-prone fandoms expanded 2026-06-26 -----
    "Naruto": [
        "naruto uzumaki", "sasuke uchiha", "sakura haruno",
        "kakashi hatake", "iruka umino", "hokage", "hidden leaf",
        "konohagakure", "akatsuki", "itachi uchiha", "shisui uchiha",
        "minato namikaze", "kushina uzumaki", "jiraiya", "tsunade",
        "orochimaru", "rinnegan", "sharingan", "byakugan",
        "hinata hyuga", "neji hyuga", "rock lee", "tenten",
        "shikamaru nara", "ino yamanaka", "choji akimichi",
        "kiba inuzuka", "shino aburame", "gaara", "kankuro", "temari",
        "kurama", "nine-tails", "tailed beast", "chunin exam",
    ],
    "Supernatural": [
        "supernatural", "sam winchester", "dean winchester",
        "castiel", "crowley", "bobby singer", "john winchester",
        "mary winchester", "lucifer", "michael", "gabriel",
        "rowena macleod", "jack kline", "demon", "angel",
        "the impala", "1967 chevrolet impala", "men of letters",
        "the empty", "purgatory", "the bunker",
    ],
    "Star Trek": [
        "star trek", "starfleet", "captain kirk", "james t. kirk",
        "spock", "leonard mccoy", "bones mccoy", "uhura", "nyota uhura",
        "hikaru sulu", "pavel chekov", "montgomery scott",
        "jean-luc picard", "william riker", "data", "geordi la forge",
        "worf", "deanna troi", "beverly crusher", "wesley crusher",
        "benjamin sisko", "kira nerys", "jadzia dax", "ezri dax",
        "kathryn janeway", "chakotay", "tuvok", "tom paris", "harry kim",
        "b'elanna torres", "seven of nine", "the doctor",
        "the enterprise", "uss enterprise", "klingon", "vulcan",
        "romulan", "borg", "federation", "warp drive", "deep space nine",
    ],
    "Doctor Who": [
        "doctor who", "the doctor", "tardis", "time lord", "gallifrey",
        "dalek", "cybermen", "the master", "missy",
        "rose tyler", "martha jones", "donna noble", "amy pond",
        "rory williams", "clara oswald", "bill potts", "yasmin khan",
        "river song", "captain jack harkness", "torchwood",
        "ninth doctor", "tenth doctor", "eleventh doctor",
        "twelfth doctor", "thirteenth doctor", "fourteenth doctor",
        "fifteenth doctor", "regenerate", "sonic screwdriver",
    ],
    "Percy Jackson and the Olympians": [
        "percy jackson", "camp half-blood", "rick riordan",
        "annabeth chase", "olympians", "lightning thief", "pjo",
        "percy jackson and the olympians", "son of poseidon",
        "grover underwood", "luke castellan",
        # Direct-sequel novels — they file under PJO on AO3, so we use
        # title keywords rather than spawning new fandoms.
        "chalice of the gods", "wrath of the triple goddess",
        # Mythology compendium books (Greek Gods/Heroes/etc.) and
        # companion guides also file under PJO.
        "percy jackson's greek gods", "percy jackson's greek heroes",
        "camp half-blood confidential", "the demigod files",
        "demigods and magicians",
    ],
    "Percy Jackson and the Olympians (TV)": [
        "percy jackson and the olympians tv", "pjo tv", "disney+ percy jackson",
        "walker scobell",
    ],
    "Heroes of Olympus": [
        "heroes of olympus", "lost hero", "son of neptune",
        "mark of athena", "house of hades", "blood of olympus",
        "jason grace", "piper mclean", "leo valdez", "frank zhang",
        "hazel levesque", "nico di angelo",
    ],
    "Trials of Apollo": [
        "trials of apollo", "lester papadopoulos", "the hidden oracle",
        "dark prophecy", "the burning maze", "tyrant's tomb",
        "tower of nero",
    ],
    "The Sun and the Star": [
        "the sun and the star", "nico di angelo and will solace",
        # Riordan + Mark Oshiro co-authored Nico/Will spinoff novel
        "from the world of percy jackson the sun and the star",
    ],
    "Magnus Chase and the Gods of Asgard": [
        "magnus chase", "gods of asgard", "sword of summer",
        "hammer of thor", "ship of the dead",
    ],
    "The Kane Chronicles": [
        "kane chronicles", "carter kane", "sadie kane",
        "red pyramid", "throne of fire", "serpent's shadow",
    ],
    "Daughter of the Deep": [
        "daughter of the deep", "ana dakkar", "house of nemo",
        "harding-pencroft academy",
    ],
    # ----- Cassandra Clare's Shadowhunters universe sub-series.
    # The umbrella "Shadowhunter Chronicles - Cassandra Clare" already
    # exists in the AO3 seed; we add the canonical sub-series so books
    # from each get filed under the correct shelf instead of falling
    # back to the umbrella.
    "The Mortal Instruments": [
        "mortal instruments", "city of bones", "city of ashes",
        "city of glass", "city of fallen angels", "city of lost souls",
        "city of heavenly fire", "clary fray", "jace wayland",
        "jace herondale", "alec lightwood", "magnus bane",
    ],
    "The Infernal Devices": [
        "infernal devices", "clockwork angel", "clockwork prince",
        "clockwork princess", "tessa gray", "will herondale",
        "jem carstairs",
    ],
    "The Dark Artifices": [
        "dark artifices", "lady midnight", "lord of shadows",
        "queen of air and darkness", "emma carstairs", "julian blackthorn",
    ],
    "The Last Hours": [
        "the last hours", "chain of gold", "chain of iron",
        "chain of thorns", "james herondale", "cordelia carstairs",
    ],
    "The Eldest Curses": [
        "eldest curses", "red scrolls of magic", "lost book of the white",
    ],
    "Tales from the Shadowhunter Academy": [
        "tales from the shadowhunter academy", "shadowhunter academy",
        "simon lewis", "ghosts of the shadow market",
    ],
    "Shadowhunters (TV)": [
        "shadowhunters the mortal instruments", "shadowhunters tv",
        "freeform shadowhunters",
    ],
    # ----- Brandon Sanderson Cosmere additions. Mistborn + Stormlight
    # already exist in the AO3 seed; we add the rest.
    "Warbreaker": [
        "warbreaker", "vasher", "vivenna", "siri", "lightsong", "nightblood",
    ],
    "Elantris": [
        "elantris", "raoden", "sarene", "hrathen",
    ],
    "Tress of the Emerald Sea": [
        "tress of the emerald sea", "secret projects sanderson",
        "tress and the emerald sea",
    ],
    "Yumi and the Nightmare Painter": [
        "yumi and the nightmare painter", "nightmare painter",
    ],
    "The Sunlit Man": [
        "the sunlit man", "nomad sanderson",
    ],
    # ----- Sarah J. Maas — ACOTAR + Throne of Glass are already in the
    # AO3 seed; add Crescent City to round out the franchise.
    "Crescent City": [
        "crescent city", "house of earth and blood",
        "house of sky and breath", "house of flame and shadow",
        "bryce quinlan", "hunt athalar", "danika fendyr",
    ],
    # ----- Star Wars sub-fandoms. The umbrella + All Media Types +
    # Sequel Trilogy + Clone Wars (2008) already live in the AO3 seed;
    # we add the live-action TV / KOTOR / Rebels lines so each gets
    # its own shelf instead of all crashing into "Star Wars".
    "The Mandalorian (TV)": [
        "the mandalorian", "din djarin", "grogu", "baby yoda",
        "mandalorian disney+", "mando din djarin",
    ],
    "Andor (TV)": [
        "andor disney+", "cassian andor andor series", "mon mothma andor",
        "andor (tv)",
    ],
    "Star Wars: The Bad Batch (Cartoon)": [
        "the bad batch", "clone force 99", "hunter wrecker tech",
        "omega bad batch",
    ],
    "Star Wars Rebels": [
        "star wars rebels", "ezra bridger", "kanan jarrus",
        "hera syndulla", "ghost crew",
    ],
    "Star Wars: Knights of the Old Republic": [
        "knights of the old republic", "kotor", "revan",
        "darth malak", "swtor",
    ],
    "Star Wars Visions": [
        "star wars visions",
    ],
    "Rogue One: A Star Wars Story": [
        "rogue one", "jyn erso", "cassian andor rogue one",
        "k-2so", "bodhi rook",
    ],
    # ----- Other standalone large fandoms.
    "Fairy Tail": [
        "fairy tail", "fairy tail manga", "natsu dragneel",
        "lucy heartfilia", "erza scarlet", "gray fullbuster",
        "hiro mashima",
    ],
    "Dungeons & Dragons (Role-Playing Game)": [
        "dungeons & dragons", "dungeons and dragons", "d&d 5e",
        "5e d&d", "ttrpg", "tabletop roleplaying game",
    ],
    "The Legend of Vox Machina (Cartoon)": [
        "legend of vox machina", "vox machina cartoon",
        "vox machina animated",
    ],
    "Vox Machina (Critical Role)": [
        "vox machina", "vex'ahlia", "vax'ildan", "percy de rolo",
        "grog strongjaw", "scanlan shorthalt",
    ],
    "The Mighty Nein (Critical Role)": [
        "mighty nein", "caleb widogast", "fjord stone",
        "jester lavorre", "yasha", "beauregard lionett",
        "molly molymauk", "veth brenatto", "kingsley tealeaf",
    ],
    "Bell's Hells (Critical Role)": [
        "bell's hells", "campaign 3 critical role", "imogen temult",
        "laudna critical role", "fearne calloway", "fcg ashton",
    ],
    "My Hero Academia: Vigilantes": [
        "my hero academia vigilantes", "vigilantes mha",
        "knuckleduster", "koichi haimawari", "pop step",
    ],
    # ----- Spy x Family (anime/manga).
    "Spy x Family": [
        "spy x family", "spy×family", "loid forger", "yor forger",
        "anya forger", "bond forger", "tatsuya endo",
    ],
    # ----- Star Trek spin-offs not in the AO3 seed. The 5 original
    # series + AOS already exist; we add the modern Paramount+ era.
    "Star Trek: Strange New Worlds": [
        "strange new worlds", "snw star trek", "captain pike",
        "la'an noonien-singh", "una chin-riley",
    ],
    "Star Trek: Lower Decks": [
        "lower decks star trek", "uss cerritos",
        "beckett mariner", "brad boimler", "tendi", "rutherford",
    ],
    "Star Trek: Picard": [
        "star trek picard", "jean-luc picard series", "raffi musiker",
        "soji asha", "rios picard",
    ],
    "Star Trek: Discovery": [
        "star trek discovery", "uss discovery", "michael burnham",
        "sylvia tilly", "saru discovery",
    ],
    "Star Trek: Enterprise": [
        "star trek enterprise", "jonathan archer", "uss nx-01",
        "trip tucker", "t'pol",
    ],
    "Star Trek: Prodigy": [
        "star trek prodigy", "uss protostar", "dal r'el", "gwyn",
        "kid star trek",
    ],
    # ----- Pokemon spin-offs beyond the umbrella "All Media Types".
    "Pokémon Adventures / Pokémon Special (Manga)": [
        "pokemon adventures", "pokemon special manga",
        "pokespe", "pokémon adventures", "red green blue manga",
    ],
    "Detective Pikachu": [
        "detective pikachu", "pikachu detective", "tim goodman",
    ],
    "Pokémon GO": [
        "pokemon go", "pokémon go", "niantic pokemon",
    ],
    "Honkai Impact 3rd": [
        "honkai impact 3rd", "honkai impact", "houkai impact",
    ],
    # ----- Vivziepop animated shows.
    "Hazbin Hotel": [
        "hazbin hotel", "charlie morningstar", "alastor radio demon",
        "angel dust", "lucifer morningstar", "vivziepop",
    ],
    "Helluva Boss": [
        "helluva boss", "blitzo", "stolas goetia", "moxxie",
        "millie helluva", "imp city",
    ],
    # ----- The Owl House (Dana Terrace, Disney).
    "The Owl House": [
        "the owl house", "luz noceda", "amity blight", "eda clawthorne",
        "king owl house", "lumity", "boiling isles",
    ],
    # ----- The Boys (Amazon TV series + Garth Ennis comics).
    "The Boys (TV)": [
        "the boys amazon", "the boys (tv)", "homelander", "billy butcher",
        "starlight the boys", "hughie campbell", "soldier boy",
    ],
    "The Boys (Comics)": [
        "the boys comics", "garth ennis the boys", "dynamite the boys",
    ],
    "Gen V (TV)": [
        "gen v", "godolkin university", "marie moreau",
    ],
    # ----- Steven Universe: Future spinoff (the original SU is in the seed).
    "Steven Universe: Future": [
        "steven universe future", "su future",
    ],
    # ----- Studio Ghibli filmography.
    "Spirited Away": [
        "spirited away", "sen to chihiro", "no-face", "haku spirited",
    ],
    "Howl's Moving Castle": [
        "howl's moving castle", "howls moving castle", "sophie hatter",
        "calcifer", "diana wynne jones howl",
    ],
    "Princess Mononoke": [
        "princess mononoke", "mononoke hime", "san mononoke", "ashitaka",
    ],
    "My Neighbor Totoro": [
        "my neighbor totoro", "tonari no totoro", "totoro studio ghibli",
    ],
    "Castle in the Sky": [
        "castle in the sky", "laputa castle in the sky", "tenku no shiro laputa",
    ],
    "Kiki's Delivery Service": [
        "kiki's delivery service", "kikis delivery service", "majo no takkyubin",
    ],
    "Ponyo": [
        "ponyo on the cliff", "gake no ue no ponyo",
    ],
    "The Tale of the Princess Kaguya": [
        "tale of the princess kaguya", "kaguya hime no monogatari",
    ],
    "The Wind Rises": [
        "the wind rises", "kaze tachinu", "jiro horikoshi",
    ],
    "Nausicaä of the Valley of the Wind": [
        "nausicaa of the valley of the wind", "nausicaä", "kaze no tani no nausicaa",
    ],
    # ----- Bridgerton companion / Buffyverse / Angel.
    "Queen Charlotte: A Bridgerton Story": [
        "queen charlotte bridgerton", "queen charlotte (tv)",
        "young queen charlotte", "king george iii bridgerton",
    ],
    "Angel: the Series": [
        "angel the series", "angel buffy spinoff", "angel investigations",
        "wolfram and hart", "fred burkle", "wesley wyndam-pryce",
    ],
    # ----- Procedurals & long-runners not in the seed.
    "House M.D.": [
        "house md", "house m.d.", "gregory house", "james wilson",
        "hugh laurie house", "princeton-plainsboro",
    ],
    # ----- Arrowverse (CW DC shows). They share crossovers so they're
    # almost always tagged together — group them so the Help page
    # shelves them as a single franchise.
    "Arrow (TV)": [
        "arrow tv", "oliver queen arrow", "felicity smoak", "green arrow tv",
    ],
    "The Flash (TV 2014)": [
        "the flash (tv)", "barry allen tv", "cw flash", "iris west tv",
    ],
    "Supergirl (TV 2015)": [
        "supergirl cw", "kara danvers", "supergirl tv", "alex danvers",
    ],
    "Legends of Tomorrow (TV)": [
        "legends of tomorrow", "sara lance", "ava sharpe", "waverider",
    ],
    "Batwoman (TV)": [
        "batwoman cw", "kate kane tv", "ryan wilder",
    ],
    "Black Lightning (TV)": [
        "black lightning", "jefferson pierce", "thunder lightning",
    ],
    "Stargirl (TV)": [
        "stargirl cw", "courtney whitmore", "jsa stargirl",
    ],
    "Titans (TV)": [
        "titans tv", "dc titans", "raven dick grayson titans",
    ],
    # ----- League of Legends + Arcane.
    "League of Legends": [
        "league of legends", "lol video game", "summoner's rift",
        "riot games lol",
    ],
    "Arcane: League of Legends (Cartoon)": [
        "arcane league of legends", "arcane netflix", "vi arcane",
        "jinx arcane", "caitlyn arcane", "piltover", "zaun arcane",
    ],
    # ----- Castlevania (Netflix).
    "Castlevania (Cartoon)": [
        "castlevania netflix", "trevor belmont", "alucard castlevania",
        "sypha belnades", "dracula castlevania",
    ],
    "Castlevania: Nocturne (Cartoon)": [
        "castlevania nocturne", "richter belmont nocturne",
        "annette nocturne", "maria renard",
    ],
    # ----- Wheel of Time.
    "The Wheel of Time - Robert Jordan": [
        "wheel of time", "robert jordan wot", "rand al'thor",
        "mat cauthon", "perrin aybara", "egwene al'vere", "nynaeve al'meara",
    ],
    "The Wheel of Time (TV)": [
        "wheel of time amazon", "wheel of time tv", "wot prime video",
    ],
    # ----- Good Omens novel.
    "Good Omens - Pratchett & Gaiman": [
        "good omens novel", "terry pratchett neil gaiman good omens",
        "aziraphale crowley book",
    ],
    # ----- Dragon Ball spin-offs (umbrella is in the seed).
    "Dragon Ball Z": [
        "dragon ball z", "dbz", "saiyan saga", "namek saga",
        "android saga", "buu saga",
    ],
    "Dragon Ball Super": [
        "dragon ball super", "dbs", "tournament of power", "moro arc",
        "granolah arc",
    ],
    "Dragon Ball GT": [
        "dragon ball gt", "dbgt",
    ],
    # ----- Newer K-pop groups (the older ones — BTS, ENHYPEN, TWICE,
    # SEVENTEEN, Stray Kids, ATEEZ, BLACKPINK — are in the seed).
    "TXT (Band)": [
        "tomorrow x together", "txt band", "moa fandom",
        "yeonjun soobin beomgyu taehyun huening kai",
    ],
    "aespa (Band)": [
        "aespa", "karina aespa", "winter aespa", "ningning aespa",
        "giselle aespa", "my ae",
    ],
    "NewJeans (Band)": [
        "newjeans", "njz", "minji hanni danielle haerin hyein",
    ],
    "LE SSERAFIM (Band)": [
        "le sserafim", "lesserafim", "sakura chaewon yunjin kazuha eunchae",
    ],
    "ITZY (Band)": [
        "itzy", "midzy fandom", "yeji lia ryujin chaeryeong yuna",
    ],
    "IVE (Band)": [
        "ive band", "dive fandom", "yujin gaeul rei wonyoung liz leeseo",
    ],
    # ----- Sci-fi novels / horror.
    "The Locked Tomb - Tamsyn Muir": [
        "the locked tomb", "tamsyn muir", "ninth house tamsyn",
    ],
    "Gideon the Ninth": [
        "gideon the ninth", "gideon nav", "harrowhark nonagesimus first book",
    ],
    "Harrow the Ninth": [
        "harrow the ninth", "harrowhark second book",
    ],
    "Nona the Ninth": [
        "nona the ninth", "nona's life",
    ],
    "The Murderbot Diaries - Martha Wells": [
        "murderbot", "martha wells secunit",
        "all systems red", "artificial condition",
        "rogue protocol", "exit strategy", "network effect",
        "fugitive telemetry", "system collapse murderbot",
    ],
    "Wings of Fire - Tui T. Sutherland": [
        "wings of fire", "tui sutherland", "dragonet prophecy",
        "clay wof", "tsunami wof", "glory rainwing", "starflight wof",
        "sunny sandwing", "moon wof",
    ],
    "The Inheritance Cycle - Christopher Paolini": [
        "inheritance cycle", "eragon paolini", "saphira eragon",
        "alagaesia", "eldest paolini", "brisingr", "inheritance paolini",
    ],
    "Mortal Engines - Philip Reeve": [
        "mortal engines", "philip reeve", "hester shaw",
        "tom natsworthy", "predator cities quartet",
    ],
    "King of Scars Duology - Leigh Bardugo": [
        "king of scars", "rule of wolves", "nikolai lantsov king",
        "zoya nazyalensky",
    ],
    "The Lunar Chronicles - Marissa Meyer": [
        "lunar chronicles", "marissa meyer cinder", "scarlet meyer",
        "cress meyer", "winter meyer", "linh cinder",
    ],
    "Red Rising - Pierce Brown": [
        "red rising", "pierce brown", "darrow of lykos",
        "golden son brown", "morning star brown", "iron gold",
        "dark age brown", "light bringer brown",
    ],
    "The Expanse - James S. A. Corey": [
        "the expanse novels", "james s.a. corey", "leviathan wakes",
        "rocinante expanse", "naomi nagata book", "amos burton book",
    ],
    "The Expanse (TV)": [
        "the expanse tv", "syfy expanse", "amazon expanse",
        "thomas jane miller", "steven strait holden",
    ],
    "Foundation - Isaac Asimov": [
        "foundation asimov", "hari seldon", "psychohistory",
        "second foundation", "foundation and empire",
    ],
    "Foundation (TV)": [
        "foundation apple tv", "lee pace foundation", "jared harris seldon",
    ],
    # ----- Dune (novels + Villeneuve film duology).
    "Dune - Frank Herbert": [
        "dune novels", "frank herbert dune", "paul atreides book",
        "leto atreides ii", "god emperor dune", "children of dune",
        "dune messiah", "heretics of dune", "chapterhouse dune",
    ],
    "Dune (2021)": [
        "dune 2021", "denis villeneuve dune", "timothee chalamet paul",
        "rebecca ferguson jessica dune",
    ],
    "Dune: Part Two (2024)": [
        "dune part two", "dune part 2", "feyd-rautha villeneuve",
        "zendaya chani dune",
    ],
    # ----- A Song of Ice and Fire universe.
    "A Song of Ice and Fire - George R. R. Martin": [
        "a song of ice and fire", "asoiaf", "george r.r. martin",
        "westeros novels", "dance with dragons", "storm of swords",
        "feast for crows", "winds of winter",
    ],
    "House of the Dragon (TV)": [
        "house of the dragon", "hotd", "rhaenyra targaryen tv",
        "alicent hightower tv", "daemon targaryen tv", "dance of dragons tv",
    ],
    # ----- Sandman (Neil Gaiman) — comics + Netflix.
    "The Sandman - Neil Gaiman": [
        "the sandman comics", "neil gaiman sandman", "dream of the endless",
        "morpheus sandman", "death endless", "delirium endless",
    ],
    "The Sandman (TV)": [
        "the sandman netflix", "tom sturridge dream",
    ],
    # ----- Avatar (James Cameron movies/Pandora).
    "Avatar (Pandora - James Cameron)": [
        "avatar james cameron", "pandora avatar", "na'vi", "jake sully",
        "neytiri", "avatar the way of water", "avatar 2", "avatar 3",
    ],
    # ----- More anime/manga.
    "Frieren: Beyond Journey's End": [
        "frieren beyond journey's end", "sousou no frieren",
        "frieren elf", "fern frieren", "stark frieren",
    ],
    "Vinland Saga": [
        "vinland saga", "thorfinn karlsefni", "askeladd vinland",
        "canute vinland", "makoto yukimura",
    ],
    "Spy Classroom": [
        "spy classroom", "spy kyoushitsu", "lily spy classroom", "klaus spy classroom",
    ],
    # ----- Stephen King multiverse.
    "It - Stephen King": [
        "it stephen king", "pennywise", "losers' club",
        "derry maine king", "it 2017", "it chapter two",
    ],
    "The Dark Tower - Stephen King": [
        "the dark tower", "roland deschain", "ka-tet",
        "gunslinger stephen king",
    ],
    "The Shining - Stephen King": [
        "the shining", "jack torrance", "danny torrance",
        "overlook hotel", "doctor sleep",
    ],
    "Carrie - Stephen King": [
        "carrie white", "carrie stephen king",
    ],
    "Misery - Stephen King": [
        "misery stephen king", "annie wilkes",
    ],
    "Salem's Lot - Stephen King": [
        "salem's lot", "salems lot", "ben mears king",
    ],
    # ----- Horror video-game franchises.
    "Silent Hill": [
        "silent hill", "konami silent hill", "pyramid head",
        "silent hill 2", "silent hill 3", "james sunderland",
    ],
    "Resident Evil (Video Games)": [
        "resident evil games", "biohazard", "leon kennedy",
        "chris redfield", "jill valentine", "claire redfield",
        "ada wong", "umbrella corporation",
    ],
    "Resident Evil (Movies)": [
        "resident evil movies", "milla jovovich alice",
        "resident evil welcome to raccoon city",
    ],
    # ----- More YA dystopia / continuations.
    "Divergent Trilogy - Veronica Roth": [
        "divergent", "veronica roth", "tris prior", "tobias eaton",
        "insurgent", "allegiant",
    ],
    "The Maze Runner - James Dashner": [
        "the maze runner", "james dashner", "thomas maze runner",
        "newt maze runner", "minho maze runner", "wckd",
        "the scorch trials", "death cure",
    ],
    "The Ballad of Songbirds and Snakes": [
        "ballad of songbirds and snakes", "coriolanus snow prequel",
        "lucy gray baird",
    ],
    # ----- Holly Black Spiderwick + Stolen Heir.
    "The Spiderwick Chronicles": [
        "spiderwick chronicles", "tony diterlizzi holly black",
        "jared grace", "simon grace", "mallory grace",
    ],
    "The Stolen Heir Duology - Holly Black": [
        "stolen heir", "black heart holly black", "wren stolen heir",
        "oak greenbriar",
    ],
    # ----- Discworld sub-series. The umbrella is in the seed; readers
    # often want to file books by sub-thread (Watch, Witches, Death,
    # Rincewind, Tiffany Aching) so each lands on its own shelf.
    "Discworld: City Watch": [
        "city watch", "sam vimes", "carrot ironfoundersson", "ankh-morpork city watch",
        "fred colon", "nobby nobbs",
    ],
    "Discworld: Witches": [
        "discworld witches", "granny weatherwax", "nanny ogg",
        "magrat garlick", "agnes nitt",
    ],
    "Discworld: Death": [
        "discworld death", "mort discworld", "susan sto helit",
        "death and bills", "soul music pratchett",
    ],
    "Discworld: Rincewind": [
        "rincewind", "the colour of magic", "light fantastic",
        "interesting times", "the last continent",
    ],
    "Discworld: Tiffany Aching": [
        "tiffany aching", "wee free men", "nac mac feegle",
        "hat full of sky", "wintersmith pratchett", "i shall wear midnight",
    ],
    # ----- Mistborn Era 2 (Wax & Wayne).
    "Mistborn: Wax & Wayne (Era 2)": [
        "wax and wayne", "alloy of law", "shadows of self",
        "bands of mourning", "lost metal", "waxillium ladrian",
    ],
    # ----- Elden Ring.
    "Elden Ring (Video Game)": [
        "elden ring", "tarnished", "the lands between",
        "marika", "radagon", "ranni the witch", "malenia blade of miquella",
    ],
    # ── Doctor Who, Supernatural, Naruto — full character rosters are at
    # the top of this dict (expanded 2026-06-26).  Old short-form entries
    # removed to avoid `F601 Dictionary key literal repeated` lint errors.
    "Game of Thrones": ["game of thrones", "westeros", "jon snow", "daenerys", "targaryen", "stark family"],
    "Hunger Games": ["hunger games", "katniss everdeen", "panem", "district 12"],
    "My Hero Academia": ["my hero academia", "izuku midoriya", "u.a. high", "all might", "bakugou"],
    "BTS": ["bts fanfic", "jeon jungkook", "kim taehyung", "park jimin", "min yoongi"],
    "One Direction": ["one direction", "harry styles", "louis tomlinson", "larry stylinson"],
    # ── Stargate franchise ────────────────────────────────────────────
    # AO3 canonical names. SG-1 keywords are intentionally narrow (cast
    # of SG-1, Goa'uld, Cheyenne Mountain) so they don't fire on Atlantis
    # works, and vice-versa. The bare word "stargate" alone is NOT in any
    # list — it would trip every sub-fandom — so the AI classifier
    # decides ambiguous works.
    "Stargate SG-1": [
        "stargate sg-1", "stargate sg1", "sg-1 team",
        "jack o'neill", "jack oneill", "daniel jackson",
        "samantha carter", "sam carter", "teal'c", "teal c",
        "general hammond", "cheyenne mountain", "goa'uld", "goauld",
        "asgard", "tok'ra", "tokra", "stargate program", "stargate command",
        "sgc",
    ],
    "Stargate Atlantis": [
        "stargate atlantis", "sga ",  # trailing space to avoid SGU matches
        "atlantis expedition", "john sheppard", "rodney mckay",
        "mckay/sheppard", "mcshep", "teyla emmagan", "ronon dex",
        "elizabeth weir", "carson beckett", "pegasus galaxy", "wraith",
        "puddle jumper", "ancients", "lantean",
    ],
    "Stargate Universe": [
        "stargate universe", "sgu ", "stargate sgu",
        "everett young", "nicholas rush", "eli wallace", "chloe armstrong",
        "matthew scott", "ronald greer", "icarus base", "destiny ship",
        "the destiny",
    ],
    "Stargate (Movies)": [
        "stargate movie", "stargate (movies)", "stargate 1994",
        "stargate film", "ra abydos", "abydonian",
    ],
}


# Merge in the bundled AO3 top-fandoms seed (~100 popular fandoms across
# all media types) without overriding any hand-tuned entries above. The
# bundled file uses AO3-canonical names — the existing 16 short-name
# fandoms above stay because they're the canonical form for THIS user's
# library and renaming them would migrate every existing book's shelf.
try:
    from data.ao3_top_fandoms import AO3_TOP_FANDOMS  # noqa: WPS433
    for _canon, _kws in AO3_TOP_FANDOMS.items():
        FANDOM_KEYWORDS.setdefault(_canon, _kws)
    del _canon, _kws  # housekeeping
except Exception as _e:  # pragma: no cover — bundled file is always present
    logger.warning("Could not load AO3 top-fandoms seed: %s", _e)

FANFIC_SIGNALS = [
    "fanfiction", "fan fiction", "fanfic", "ao3", "archive of our own",
    "fanfiction.net", "wattpad", "x reader", "x-reader", "reader insert",
    "y/n", "self-insert", "slash fic", "shipping", "alternate universe",
    "canon divergence", "what if", "one-shot", "drabble"
]

NONFICTION_SIGNALS = [
    "memoir", "biography", "autobiography", "history of", "essay", "essays",
    "guide to", "how to", "handbook", "textbook", "self-help", "nonfiction",
    "non-fiction", "cookbook", "manual", "reference"
]

# Phase-6 split #2: EPUB metadata + relationship/fandom canonicalization
# helpers live in ``utils/epub_metadata``.  Re-exported here so existing
# call sites (tags route imports extract_epub_metadata; fandoms route
# imports _canonicalize_fandom; exports/refresh/url_lists/upload_books in
# this file all reach for these symbols via ``routes.books``) keep
# working unchanged.
from utils.epub_metadata import (  # noqa: E402, F401
    SERIES_TITLE_PATTERNS,
    _FANDOM_SPLIT_RE,
    _canonicalize_fandom,
    _canonicalize_relationship,
    _suggest_fandom_merges,
    detect_series_from_title,
    extract_epub_metadata,
    extract_urls_from_epub,
    format_links_txt,
    update_epub_metadata,
)


_CHAPTER_NORMALIZE_RE = re.compile(r'\s+')
_CHAPTER_PREFIX_RE = re.compile(r'^\s*(?:chapter|ch\.?|part|prologue|epilogue)\s*[:\-\.]?\s*\d*[:\-\.]?\s*', re.IGNORECASE)


# Phase-6 split: the chapter helpers now live in ``utils/epub_chapters``.
# They're re-exported here so existing imports keep working unchanged
# (tests + diff route + refresh helper all do ``from routes.books import
# extract_chapters`` etc).
from utils.epub_chapters import (  # noqa: E402, F401
    _normalize_chapter_title,
    extract_chapters,
    diff_chapters,
)


# ============================================================
# FANFIC REFRESH — pull latest version of a fanfic from its source URL
# ============================================================
# URL canonicalization, source detection, and the per-host regex bank
# all live in `utils/url_canonical` — this module just re-exports them
# so existing call sites (and tests) keep working unchanged.
from utils.url_canonical import (  # noqa: E402
    _AO3_HOST_RE,
    _AO3_HOST_SUBSTRINGS,
    _AO3_NON_WORK_PATTERNS,
    _AO3_WORK_CANON_RE,
    _AFF_CANON_RE,
    _FFNET_CANON_RE,
    _FP_CANON_RE,
    _PS_CANON_RE,
    _QQ_CANON_RE,
    _RR_CANON_RE,
    _SB_CANON_RE,
    _SV_CANON_RE,
    _TWILIGHTED_CANON_RE,
    FANFIC_SOURCE_PATTERNS,
    _is_ao3_host,
    classify_ao3_non_work,
    normalize_fanfic_url,
)

# NOTE: ``FANFICFARE_USER_AGENT``, the fanfic fetch/refresh helpers
# (fanfic_fetch_epub, fetch_fanfic_with_fallback, apply_refresh,
# find_source_url, extract_fanfic_urls, FanficNotFoundError), the
# duplicate helpers (_clean_author_string, _normalize_*_for_match,
# find_duplicate_candidates, _apply_duplicate_policy) and the shared
# ``_updated_shelf_name`` / ``OLD_STORIES_SHELF`` constants were
# extracted to ``utils/fanfic.py`` + ``utils/duplicates.py`` +
# ``utils/constants.py`` in the Phase 6C refactor (2026-08-22).
# All those names are re-imported at the top of this module and stay
# available as ``routes.books`` attributes for backwards compat.


# Phase-5 follow-up: url_lists.py owns the dedupe / pull / export-xlsx routes
# but `upload_books` and `claim_source_url` here still need these helpers, so
# re-import them at the books.py top-level (the dedicated import block that
# used to live ~line 1426 was moved out with the routes).
from utils.url_canonical import (  # noqa: E402
    _URL_RE,
    _canonical_fanfic_url,
    _looks_like_url_list,
    _source_for,  # test_new_features imports this via ``routes.books``
)

# Phase 5 cleanup: helpers that were extracted to other modules but are still
# referenced from this file (upload_books, list_library_xlsx, etc.).

# 2026-08-22 — Filesystem + filename helpers moved to
# ``utils/book_files.py`` (Phase 6C slice 4). Re-exported below so
# every historical caller (books_links, books_versions, covers,
# user_prefs, utils.fanfic.apply_refresh, and the pytest suite) keeps
# resolving through ``routes.books`` unchanged.
from utils.book_files import (  # noqa: E402
    _write_local_and_mirror_to_r2,
    _safe_folder,
    _safe_filename,
    _templated_filename,
)


async def _dedupe_url_list(text: str, user_id: str):
    """Lazy-import bridge so `upload_books` keeps working after url_lists.py
    moved out of this file. Imported on demand to dodge the circular."""
    from routes.url_lists import _dedupe_url_list as _impl  # noqa: WPS433
    return await _impl(text, user_id)


# ----------------------------------------------------------------------
# EPUB TEMPLATE APPLIER
# Implementation lives in `utils/epub_template`. Re-exported here so the
# call sites in this module (and the test suite) keep working unchanged.
# ----------------------------------------------------------------------
from utils.epub_template import (  # noqa: E402
    SHELFSORT_TEMPLATE_CSS,
    SHELFSORT_TEMPLATE_MARKER,
    _html_escape,
    _build_intro_xhtml,
    apply_template_to_epub,
)

from utils.status_detector import (  # noqa: E402
    detect_status,
    effective_status,
    COMPLETE as STATUS_COMPLETE,
    ONGOING as STATUS_ONGOING,
)
from utils.constants import TRASH_SHELF, TRASH_GRACE_DAYS, PENDING_SORT_SHELF, OLD_STORIES_SHELF  # noqa: E402


# ---- Tag helpers (moved to utils.tags as part of books.py refactor Phase 2)
# We still re-export the underscore-prefixed names here so any pending
# callers in this file (the upload + bulk-edit pipelines) keep working.
from utils.tags import (  # noqa: E402
    TAG_MAX_LENGTH,  # noqa: F401
    TAG_MAX_PER_BOOK,  # noqa: F401
    _normalize_tag,  # noqa: F401
    _normalize_tags,
)


# 2026-08-22 — Duplicate detection helpers and the fanfic fetch/refresh
# pipeline live in utils/duplicates.py and utils/fanfic.py (Phase 6C
# slices 2 + 3). Re-exported here so existing importers (upload_books,
# routes.duplicate_resolution, routes.refresh, routes.books_versions,
# tests/test_*) keep resolving through routes.books unchanged.
from utils.duplicates import (  # noqa: E402, F401
    _clean_author_string,
    _normalize_title_for_match,
    _normalize_author_for_match,
    _updated_shelf_name,
    find_duplicate_candidates,
    _apply_duplicate_policy,
)
from utils.fanfic import (  # noqa: E402, F401
    FANFICFARE_USER_AGENT,
    FanficNotFoundError,
    find_source_url,
    extract_fanfic_urls,
    fanfic_fetch_epub,
    fetch_fanfic_with_fallback,
    apply_refresh,
)



# Phase-6 split #3: classifier helpers (heuristic + Claude) now live in
# ``utils/classifier``.  Re-exported so existing imports (admin route
# imports classify_by_metadata; tags route imports classify_with_ai;
# tests reach for both via routes.books) keep working unchanged.
from utils.classifier import (  # noqa: E402, F401
    classify_book,
    classify_by_metadata,
    classify_with_ai,
)


# ============================================================
# BOOK ROUTES

# 2026-08-22 — Calibre conversion pipeline extracted to
# ``utils/calibre_convert.py`` (Phase 6C slice 1).  These names are
# re-exported below so existing importers (upload_books, the
# ``conversions`` router, and the friendly-error test suite) don't
# have to change.
from utils.calibre_convert import (  # noqa: E402, F401
    NEEDS_CONVERSION_EXTS,
    NEEDS_CONVERSION_SHELF,
    CONVERSION_VISIBILITY_HOURS,
    _CALIBRE_FRIENDLY_ERRORS,
    _friendly_calibre_error,
    _convert_to_epub_sync,
    _get_calibre_semaphore,
    convert_to_epub,
    _ensure_conversion_index,
    _conversion_start,
    _conversion_end,
)


# /conversions/* and /library/originals/* endpoints live in
# ``routes/conversions.py`` (extracted 2026-06-13). The helpers above
# (``convert_to_epub``, ``_conversion_start``, ``_conversion_end``,
# ``_ensure_conversion_index``, and the visibility-window constant) stay
# available here as re-exports because ``upload_books`` below also
# uses them.


@api_router.post("/books/upload")
async def upload_books(
    files: List[UploadFile] = File(...),
    keep_originals: List[str] = Form([]),
    user: User = Depends(get_current_user),
):
    # Feature-flag kill switch — admin can pause uploads in maintenance.
    from utils.feature_flags import is_enabled
    if not await is_enabled("uploads_enabled"):
        raise HTTPException(status_code=503, detail="Uploads are temporarily disabled by an administrator.")
    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    # Load fandom aliases once for the whole batch so per-book canonicalization
    # picks up user-defined merges (e.g. "HP" -> "Harry Potter"). Global
    # admin-managed aliases are merged in; per-user overrides on conflict.
    _udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    user_aliases = _udoc.get("fandom_aliases") or {}
    from routes.admin import get_global_fandom_aliases_dict
    global_aliases = await get_global_fandom_aliases_dict()
    fandom_aliases = {**global_aliases, **user_aliases}
    # Filenames the user explicitly asked to keep as the original format
    # (no Calibre conversion). They land on /library/originals separately
    # from the main EPUB library.
    keep_original_set = {n for n in keep_originals if n}
    results = []
    url_list_reports: List[Dict[str, Any]] = []
    upload_suggestions: List[Dict[str, Any]] = []
    cross_format_dupes: List[Dict[str, Any]] = []
    # Story-shaped URLs we found inside uploaded EPUBs whose host isn't on
    # the accepted-sources list. Collected across every file in the batch
    # and flushed to the `unknown_sources` collection just before the
    # response so the toast can echo back the new hosts.
    upload_unknown_urls: List[Dict[str, Any]] = []  # {url, book_id, title, author}

    for f in files:
        # 2026-07-04 — Per-file isolation. Previously, a single bad
        # EPUB (corrupt zip, Calibre crash, classifier exception,
        # transient R2 failure, etc.) bubbled up and 500'd the
        # entire 3-file multipart batch, killing the 2 healthy
        # siblings AND causing the frontend to abort the remaining
        # ~80 files of a 100-book drop.  Now each file's processing
        # is wrapped in try/except: on any unhandled exception we
        # record `{filename, failed: True, error: ...}` in the
        # response and continue with the next file.  The pre-loop
        # 503 for `uploads_enabled` still short-circuits — only
        # per-file exceptions are softened here.
        try:
            lower = (f.filename or "").lower()
            ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""

            # ---- Antivirus pre-scan (2026-06-18) --------------------------
            # Synchronous ClamAV scan before ANY other processing — anything
            # the scanner flags is rejected with a hard 400 and recorded in
            # the ``av_quarantine`` collection for admin review.  Read once,
            # rewind, then proceed; downstream branches all re-read ``f`` or
            # use the buffered bytes.  Failing to run the scanner (daemon
            # not up, sig DB missing) returns ok=False and we fail-open so
            # uploads keep working — the missing-AV state surfaces in the
            # admin Health card instead of breaking user uploads.
            #
            # 2026-07-04 EVENING — `AV_SCAN_ON_UPLOAD=false` opt-out.
            # 2026-06-27 — Background AV scan.
            # AV used to be inline (~6-8s per file cold-load, ~50-200ms
            # warm).  On a 100-file bulk drop that's 10+ minutes of
            # spinner time.  Now the file moves through the pipeline
            # IMMEDIATELY and the AV scan runs as a fire-and-forget
            # background task via ``utils.av_background``.  The book
            # is marked ``av_status: "pending"`` until the scan
            # completes (transitions to ``clean`` / ``infected`` /
            # ``unscanned`` from the background task).
            #
            # Safety still holds:
            #   • Send-to-Kindle / friend-share / public-library
            #     already refuse non-"clean" rows
            #   • /account/safety surfaces "Pending" + "Infected"
            #     counts so the user always sees a real-time signal
            #   • The ``av_pending_recovery_tick`` cron rescans any
            #     row stuck pending for >5 minutes (covers backend
            #     restart mid-scan)
            #   • Operators can force the OLD inline behaviour by
            #     setting ``AV_SCAN_ON_UPLOAD=true`` if they need
            #     the synchronous block for compliance reasons.
            import asyncio as _asyncio
            from utils.antivirus import scan_bytes, record_quarantine
            _av_force_inline = (os.environ.get("AV_SCAN_ON_UPLOAD", "false").lower() in ("1", "true", "yes", "on"))
            _av_bytes = await f.read()
            await f.seek(0)
            if _av_force_inline:
                _av_result = await _asyncio.to_thread(scan_bytes, _av_bytes, hint_name=(f.filename or "upload.bin"))
                if _av_result.get("infected"):
                    await record_quarantine(
                        user_id=user.user_id,
                        filename=f.filename or "",
                        scan=_av_result,
                        source="upload",
                        extra={"size_bytes": len(_av_bytes)},
                    )
                    # 2026-07-04 — Previously raised HTTPException 400, which
                    # killed the whole multipart batch (typically 3 files) and
                    # then the frontend aborted the remaining ~80 books from
                    # a 100-book drop.  Now we record the rejection in the
                    # response and continue with the next file so one bad
                    # apple doesn't take down its siblings.
                    results.append({
                        "filename": f.filename,
                        "av_infected": True,
                        "av_signature": _av_result.get("signature"),
                        "error": (
                            f"\"{f.filename or 'this file'}\" appears unsafe "
                            f"({_av_result.get('signature') or 'flagged by antivirus'}). Upload blocked."
                        ),
                        "failed": True,
                    })
                    continue
                # Inline path: the scan already ran cleanly.  Stash
                # the result so the post-write book doc inserts with
                # ``av_status: "clean"`` instead of "pending".
                _av_bg_pending = False
            else:
                # Background path (the new default).  We DON'T scan here;
                # we just hold the bytes for the post-insert task to pick
                # up.  Book doc is inserted with ``av_status: "pending"``
                # below and the background task flips it when done.
                _av_result = None
                _av_bg_pending = True
            # -------------------------------------------------------------

            # `.txt` is a special case — it could be a plain-text manuscript
            # (Calibre-convertible) OR a wishlist of fanfic URLs. If it's
            # dominantly URLs we route it through the dedupe pipeline instead of
            # converting it as a book.
            if ext == ".txt":
                try:
                    raw_bytes = await f.read()
                    text = raw_bytes.decode("utf-8", errors="ignore")
                except Exception:
                    text, raw_bytes = "", b""
                looks_like_url_list = _looks_like_url_list(text)
                if looks_like_url_list:
                    report = await _dedupe_url_list(text, user.user_id)
                    report["filename"] = f.filename
                    url_list_reports.append(report)
                    continue
                # Not a URL list — restore the read pointer so the standard
                # Calibre-convert branch below picks it up. We re-write the file
                # to disk and skip ahead.
                await f.seek(0)

            # Non-EPUB but a known ebook format → auto-convert to EPUB via
            # Calibre's `ebook-convert`, then fall through to the normal EPUB
            # pipeline below (metadata / classification / fanfic / template).
            # On conversion failure we keep the original file under the
            # "Needs conversion" shelf with a friendly error message.
            original_format: Optional[str] = None
            if ext != ".epub" and ext in NEEDS_CONVERSION_EXTS:
                book_id = f"book_{uuid.uuid4().hex[:12]}"
                src_target = user_dir / f"{book_id}{ext}"
                content = await f.read()
                src_target.write_bytes(content)

                # Path 1 — "Keep original": user wants this file on the Originals
                # shelf without Calibre conversion. We do a quick title/author
                # guess from the filename (and cross-format dup check against
                # existing EPUBs) and store an original-only doc.
                if (f.filename or "") in keep_original_set:
                    base_name = (f.filename or "Untitled").rsplit(".", 1)[0]
                    # Title - Author pattern, common from manual exports
                    guess_title = base_name
                    guess_author = "Unknown"
                    if " - " in base_name:
                        left, right = base_name.rsplit(" - ", 1)
                        if len(left) > 1 and len(right) > 1:
                            guess_title, guess_author = left.strip(), right.strip()
                    # Cross-format duplicate detection — match title+author
                    # case-insensitively against existing EPUB books.
                    dup_match = await db.books.find_one(
                        {
                            "user_id": user.user_id,
                            "original_only": {"$ne": True},
                            "title": {"$regex": f"^{re.escape(guess_title)}$", "$options": "i"},
                            "author": {"$regex": f"^{re.escape(guess_author)}$", "$options": "i"},
                        },
                        {"_id": 0, "book_id": 1, "title": 1, "author": 1},
                    )
                    dup_ids = [dup_match["book_id"]] if dup_match else []
                    if dup_match:
                        cross_format_dupes.append({
                            "new_filename": f.filename,
                            "new_book_id": book_id,
                            "matched_book_id": dup_match["book_id"],
                            "matched_title": dup_match.get("title"),
                            "matched_author": dup_match.get("author"),
                        })
                    now_iso = datetime.now(timezone.utc).isoformat()
                    doc = {
                        "book_id": book_id,
                        "user_id": user.user_id,
                        "filename": f.filename,
                        "title": guess_title,
                        "author": guess_author,
                        "description": f"Original {ext.lstrip('.').upper()} kept as-is (no Calibre conversion).",
                        "language": "",
                        "publisher": "",
                        "has_cover": False,
                        # Use a distinct shelf so these don't pollute the main library.
                        "category": "Originals",
                        "fandom": None,
                        "confidence": 1.0,
                        "classifier": "kept-original",
                        "tags": [],
                        "size_bytes": len(content),
                        "links_count": 0,
                        "source_url": None,
                        "fanfic_urls": [],
                        "last_refreshed_at": None,
                        "series_name": None,
                        "series_index": None,
                        "original_only": True,
                        "original_format": ext.lstrip("."),
                        "cross_format_duplicate_of": dup_ids,
                        "created_at": now_iso,
                    }
                    await db.books.insert_one(doc)
                    results.append({k: v for k, v in doc.items() if k != "_id"})
                    continue

                # Path 2 — normal "Convert" flow (existing behavior).
                epub_target = user_dir / f"{book_id}.epub"
                job_id = uuid.uuid4().hex
                await _conversion_start(user.user_id, {
                    "id": job_id,
                    "book_id": book_id,
                    "title": (f.filename or "Untitled").rsplit(".", 1)[0],
                    "original_format": ext.lstrip("."),
                    "started_at": datetime.now(timezone.utc).isoformat(),
                })
                err = None
                try:
                    err = await convert_to_epub(src_target, epub_target)
                finally:
                    await _conversion_end(user.user_id, job_id, error=err)
                if err:
                    base_name = (f.filename or "Untitled").rsplit(".", 1)[0]
                    now_iso = datetime.now(timezone.utc).isoformat()
                    doc = {
                        "book_id": book_id,
                        "user_id": user.user_id,
                        "filename": f.filename,
                        "title": base_name,
                        "author": "Unknown",
                        "description": (
                            f"Auto-conversion failed. {err} "
                            f"Tip: convert it to EPUB on your own device first (Calibre desktop, "
                            f"online converter, etc.) and re-upload the .epub."
                        ),
                        "language": "",
                        "publisher": "",
                        "has_cover": False,
                        "category": NEEDS_CONVERSION_SHELF,
                        "fandom": None,
                        "confidence": 1.0,
                        "classifier": "needs-conversion",
                        "size_bytes": len(content),
                        "links_count": 0,
                        "source_url": None,
                        "last_refreshed_at": None,
                        "series_name": None,
                        "series_index": None,
                        "needs_conversion": True,
                        "original_format": ext.lstrip("."),
                        "conversion_error": err,
                        "created_at": now_iso,
                    }
                    await db.books.insert_one(doc)
                    results.append({k: v for k, v in doc.items() if k != "_id"})
                    continue
                # Conversion succeeded — keep the original file too (so the user
                # has the source) but route the rest of the pipeline at the EPUB.
                original_format = ext.lstrip(".")
                content = epub_target.read_bytes()
                target = epub_target
                # Fall through to the standard EPUB processing below using the
                # already-written EPUB. We jump straight to metadata extraction by
                # reusing the local `book_id` we generated above.
            elif ext != ".epub":
                results.append({"filename": f.filename, "error": "Not an EPUB"})
                continue
            else:
                book_id = f"book_{uuid.uuid4().hex[:12]}"
                target = user_dir / f"{book_id}.epub"
                content = await f.read()
                target.write_bytes(content)

            meta = extract_epub_metadata(target)

            # Short-circuit: if the EPUB can't be opened at all, file it under
            # "Can't Open" and skip classification / AI / links / series detection.
            if meta.get("parse_failed"):
                doc = {
                    "book_id": book_id,
                    "user_id": user.user_id,
                    "filename": f.filename,
                    "title": meta.get("title") or f.filename,
                    "author": "Unknown",
                    "description": "",
                    "language": "",
                    "publisher": "",
                    "has_cover": False,
                    "category": "Can't Open",
                    "fandom": None,
                    "confidence": 1.0,
                    "classifier": "broken-epub",
                    "size_bytes": len(content),
                    "links_count": 0,
                    "source_url": None,
                    "last_refreshed_at": None,
                    "series_name": None,
                    "series_index": None,
                    "epub_unreadable": True,
                    "epub_parse_error": meta.get("parse_error"),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.books.insert_one(doc)
                results.append({k: v for k, v in doc.items() if k != "_id"})
                continue

            # 2026-06-27 — Classifier is now DEFERRED to the polish
            # worker.  We used to call ``classify_book(meta)`` inline
            # here, which dominated per-file wall-clock (~1-8s).
            # Instead we stamp the book as ``classifier: "pending"``
            # and ``category: "Pending sort"``, then fire a fire-and-
            # forget polish drain at the end of the batch (see
            # ``utils.polish_worker.schedule_polish_for_user``).
            #
            # Net effect: upload returns in ~1-2s/file, books appear
            # in the library immediately with title/author/cover/AO3
            # tags, and the Claude classification fills in
            # fandom/category within 5-30s in the background.
            #
            # Tab-close resilient: the polish task lives on the
            # backend event loop, NOT on the browser HTTP connection.
            # A 5-min recovery cron sweeps any pending book that's
            # been stuck (backend restart, missed schedule call) so
            # closing the tab can never strand a book in "Pending sort"
            # forever.
            classification = {
                "category": PENDING_SORT_SHELF,
                "fandom": None,
                "confidence": None,
                "classifier": "pending",
            }

            # Save cover separately if exists
            cover_path = user_dir / f"{book_id}.cover"
            if meta.get('cover_bytes'):
                cover_path.write_bytes(meta['cover_bytes'])

            # Extract URLs and save to a notepad-friendly .txt file
            links = extract_urls_from_epub(target)
            links_path = user_dir / f"{book_id}.links.txt"
            links_path.write_text(
                format_links_txt(meta['title'], meta['author'], links),
                encoding='utf-8',
            )
            source_url = find_source_url(links)
            fanfic_urls = extract_fanfic_urls(links)

            # Stash URLs that look story-shaped but didn't canonicalize so we
            # can record their hosts as "potential new sources" after the
            # batch finishes (one Mongo write per host, not per URL).
            for _link in links or []:
                _u = (_link.get("url") or "").strip()
                if _u and not normalize_fanfic_url(_u):
                    upload_unknown_urls.append({
                        "url": _u, "book_id": book_id,
                        "title": meta.get("title"), "author": meta.get("author"),
                    })

            # Series detection: prefer EPUB Calibre meta, fall back to title regex
            series_name = meta.get('series_name')
            series_index = meta.get('series_index')
            if not series_name:
                sn, si = detect_series_from_title(meta['title'])
                if sn:
                    series_name = sn
                    series_index = si if si is not None else series_index

            doc = {
                "book_id": book_id,
                "user_id": user.user_id,
                "filename": f.filename,
                "title": meta['title'],
                "author": meta['author'],
                "description": meta['description'],
                "language": meta['language'],
                "publisher": meta['publisher'],
                "has_cover": bool(meta.get('cover_bytes')),
                "category": classification['category'],
                "fandom": _canonicalize_fandom(classification.get('fandom'), fandom_aliases),
                "confidence": classification.get('confidence'),
                "classifier": classification.get('classifier'),
                "classifier_reason": classification.get('reasoning'),
                "size_bytes": len(content),
                "links_count": len(links),
                "source_url": source_url,
                "fanfic_urls": fanfic_urls,
                "last_refreshed_at": None,
                "series_name": series_name,
                "series_index": series_index,
                "relationships": meta.get("relationships") or [],
                "rating": meta.get("rating"),
                "warnings": meta.get("warnings") or [],
                "categories": meta.get("categories") or [],
                "ao3_freeform_tags": meta.get("ao3_freeform_tags") or [],
                # Auto-detected completion status (complete | ongoing). User
                # override lives at `manual_status`; effective_status() picks
                # the override when set. Detection runs only at upload time —
                # users said they don't want re-detection on refresh (5a).
                "status": detect_status(
                    title=meta.get("title"),
                    description=meta.get("description"),
                    raw_meta_text=meta.get("rawExtendedMeta_text"),
                    tags=meta.get("tags") or [],
                ),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            if original_format:
                # Surface the source format so the UI can show e.g. "Converted from PDF"
                doc["original_format"] = original_format
                doc["converted_from"] = original_format

            # Duplicate detection — flag, don't block. The UI pops a modal letting
            # the user choose: keep both / discard this upload / promote as new
            # version of the existing book.
            dupes = await find_duplicate_candidates(
                user.user_id,
                title=meta['title'],
                author=meta.get('author'),
                source_url=source_url,
                fanfic_urls=fanfic_urls,
            )
            if dupes:
                doc["duplicate_pending"] = True
                doc["duplicate_of"] = dupes

            # 2026-07-04 — When `AV_SCAN_ON_UPLOAD=false`, mark the book
            # 2026-06-27 — Three-state av_status at insert time:
            #   • _av_bg_pending=True  → stamp "pending", task will flip it
            #   • inline scan ran      → stamp "clean" (cleared above)
            #   • forced inline + skip → "unscanned" (legacy path)
            if _av_bg_pending:
                doc["av_status"] = "pending"
            else:
                doc["av_status"] = "clean"
                doc["av_scanned_at"] = datetime.now(timezone.utc).isoformat()

            await db.books.insert_one(doc)
            # 2026-06-27 — Kick off the background AV scan AFTER the
            # book doc is persisted.  Scheduling before the insert
            # would race the update_one in the task against a missing
            # doc.  Skipped on the inline path (av is already done).
            if _av_bg_pending:
                try:
                    from utils.av_background import schedule_background_scan
                    schedule_background_scan(
                        user.user_id, doc["book_id"], _av_bytes,
                        f.filename or f"{doc['book_id']}.epub",
                    )
                except Exception as _bg_exc:
                    logger.warning("Failed to schedule background AV for %s: %s",
                                   doc.get("book_id"), _bg_exc)
            # Hook in full-text index — extract the EPUB body so the new book
            # is searchable from `/library/search/fulltext` immediately. Any
            # failure here is logged inside the helper; we never want a
            # fulltext glitch to break the upload itself, so we swallow.
            #
            # 2026-06-27 — Fire-and-forget the indexing.  EPUB body
            # extraction is the slowest part of a successful upload
            # (2-5s on a 5-10MB EPUB) and the user doesn't need
            # fulltext to be ready for the upload to "succeed" — they
            # just need the book in the library.  Backgrounding it
            # cuts the visible upload time by several seconds per
            # file, which compounds dramatically on a 100-file drop.
            #
            # The task captures the local variables it needs (book_id,
            # user_id) so it's still correct even if `doc` is reassigned
            # later in the loop.  Failure still only logs — fulltext is
            # a search-quality nicety, not a correctness invariant.
            async def _index_fulltext(book_id: str, user_id: str):
                try:
                    from utils.epub_fulltext import extract_epub_text, upsert_fulltext, count_words  # noqa: WPS433
                    _epub_path = STORAGE_DIR / user_id / f"{book_id}.epub"
                    _ft_text = extract_epub_text(_epub_path)
                    await upsert_fulltext(db, book_id, user_id, _ft_text)
                    _wc = count_words(_ft_text)
                    if _wc > 0:
                        await db.books.update_one(
                            {"book_id": book_id},
                            {"$set": {"word_count": _wc}},
                        )
                except Exception as _ft_exc:  # noqa: BLE001
                    logger.warning("fulltext index on upload failed for %s: %s", book_id, _ft_exc)
            _asyncio.create_task(_index_fulltext(doc["book_id"], user.user_id))
            results.append({k: v for k, v in doc.items() if k != '_id'})
        except Exception as _file_err:  # noqa: BLE001 — per-file isolation
            logger.exception(
                "upload_books: per-file failure for %s — recording in response and continuing",
                getattr(f, "filename", "<unknown>"),
            )
            results.append({
                "filename": getattr(f, "filename", None),
                "failed": True,
                "error": f"Couldn't process this file ({type(_file_err).__name__}). Try again, or re-upload it on its own to see the detailed error.",
            })
            continue

    # Auto-resolve based on the user's default duplicate policy. When the
    # policy is "ask" we leave duplicate_pending on every flagged book so the
    # UI pops the modal. For other policies we apply the action immediately.
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "duplicate_policy": 1})
    from routes.user_prefs import DUPE_POLICY_DEFAULT  # extracted module
    policy = (user_doc or {}).get("duplicate_policy") or DUPE_POLICY_DEFAULT
    auto_resolved = 0
    actions: List[Dict[str, Any]] = []
    if policy != "ask":
        for i, doc in enumerate(results):
            if not doc.get("duplicate_pending"):
                continue
            target_id = (doc.get("duplicate_of") or [{}])[0].get("book_id")
            applied = await _apply_duplicate_policy(
                user.user_id, doc["book_id"], target_id, policy,
            )
            if applied:
                auto_resolved += 1
                actions.append({
                    "book_id": doc["book_id"],
                    "title": doc.get("title") or "",
                    "action": applied.get("action"),
                    "target_book_id": applied.get("target_book_id"),
                    "undoable": applied.get("undoable", False),
                })
                # Reflect the auto-resolve in the response so the UI knows
                if applied.get("deleted"):
                    results[i] = {**doc, "duplicate_pending": False, "duplicate_resolved": "discard", "removed": True}
                else:
                    fresh = await db.books.find_one({"book_id": doc["book_id"], "user_id": user.user_id})
                    if fresh:
                        fresh.pop("_id", None)
                        fresh["duplicate_resolved"] = applied.get("action")
                        results[i] = fresh

    # Fuzzy match suggestions — look at every fandom that landed in this
    # batch; if it's a brand-new fandom and close (≤2 edits) to an existing
    # one, surface a suggestion the UI can pop as a toast.
    batch_fandoms = {b.get("fandom") for b in results if isinstance(b, dict) and b.get("fandom")}
    if batch_fandoms:
        existing_rows = await db.books.aggregate([
            {"$match": {"user_id": user.user_id, "fandom": {"$ne": None, "$exists": True}}},
            {"$group": {"_id": "$fandom"}},
        ]).to_list(length=None)
        existing_fandoms = [r["_id"] for r in existing_rows if r.get("_id")]
        # Only suggest when the just-uploaded fandom is rare in the library
        # (otherwise it's clearly already an "established" shelf).
        counts: Dict[str, int] = {}
        for r in existing_rows:
            counts[r["_id"]] = counts.get(r["_id"], 0) + 1
        for nf in batch_fandoms:
            sug = _suggest_fandom_merges(nf, [e for e in existing_fandoms if e != nf])
            if sug:
                upload_suggestions.append({"new_fandom": nf, "suggestions": sug})

    # Unknown-source detector: flush all story-shaped URLs that didn't
    # canonicalize as a single Mongo upsert per distinct host. We record
    # the most recently-seen sample per host along with the book title/
    # author/id so the admin endpoint can show context.
    from utils.unknown_sources import record_unknown_sources
    unknown_hosts_recorded: List[str] = []
    if upload_unknown_urls:
        # Group by host so we attach the latest book context to each host.
        from utils.unknown_sources import _host_of, looks_like_fanfic_url
        seen_hosts: set = set()
        for item in upload_unknown_urls:
            u = item["url"]
            if not looks_like_fanfic_url(u):
                continue
            h = _host_of(u)
            if not h or h in seen_hosts:
                continue
            seen_hosts.add(h)
            rec = await record_unknown_sources(
                db, [u], context="upload",
                user_id=user.user_id,
                book_id=item.get("book_id"),
                book_title=item.get("title"),
                book_author=item.get("author"),
            )
            unknown_hosts_recorded.extend(rec)

    # Best-effort: notify friends who already collect any of the same
    # fandoms in this batch. Never raises — see helper for rules.
    await _notify_friends_of_shared_fandom_uploads(
        user.user_id,
        (user.name or user.email or "A friend"),
        results,
    )

    # 2026-06-21 — Synchronously mirror every freshly-created file to
    # R2 before returning success.  Pre-fix, ``upload_books`` wrote to
    # local disk only and relied on the every-10-min storage backfill
    # cron to push to R2.  If the pod restarted in that window (idle
    # scale-down, deploy, OOM kill), the bytes were lost FOREVER —
    # which is exactly the regression the user hit on 2026-06-21
    # when their /admin/storage-migration-progress showed only 18% of
    # books actually in R2.  This loop closes the gap by mirroring
    # every book + cover synchronously before we tell the user "upload
    # succeeded".  Each mirror is best-effort — if R2 is briefly
    # unreachable we log a warning and continue (the cron will retry
    # within 10 min), but we DON'T silently swallow it.
    from utils.storage_cloud import (
        is_enabled as _cloud_on,
        mirror_up as _r2_mirror_up,
        storage_key_for as _r2_key,
    )
    if _cloud_on() and results:
        import asyncio as _asyncio
        for r in results:
            bid = r.get("book_id")
            if not bid:
                continue
            # Mirror the EPUB (always), the original-format source if
            # this was a converted upload, and the cover (if any).
            mirror_targets: List[tuple[Path, str]] = []
            epub_local = user_dir / f"{bid}.epub"
            if epub_local.exists():
                mirror_targets.append((epub_local, _r2_key(user.user_id, bid, ".epub")))
            orig_fmt = (r.get("original_format") or "").strip()
            if orig_fmt:
                src_ext = f".{orig_fmt}"
                src_local = user_dir / f"{bid}{src_ext}"
                if src_local.exists():
                    mirror_targets.append((src_local, _r2_key(user.user_id, bid, src_ext)))
            cover_local = user_dir / f"{bid}.cover"
            if cover_local.exists():
                mirror_targets.append((cover_local, _r2_key(user.user_id, bid, ".cover")))
            # 2026-06-27 — R2 mirror parallelism.  Each mirror_targets
            # call is an independent network PUT to Cloudflare R2
            # (~500ms-2s each).  Running them serially per book meant
            # a typical "EPUB + cover + original-format" upload waited
            # ~3-6s on R2.  asyncio.gather + asyncio.to_thread fans the
            # PUTs out so all three complete in ~1 round-trip — saves
            # ~2-4s per book on R2-backed deployments.
            async def _mirror_one(local_path: Path, key: str) -> None:
                try:
                    ok = await _asyncio.to_thread(_r2_mirror_up, local_path, key)
                    if not ok:
                        logger.warning(
                            "upload_books: R2 mirror returned False for %s (key=%s) — "
                            "file safe on local disk, cron will retry.",
                            local_path.name, key,
                        )
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "upload_books: R2 mirror raised for %s (key=%s): %s — "
                        "file safe on local disk, cron will retry.",
                        local_path.name, key, e,
                    )

            if mirror_targets:
                await _asyncio.gather(
                    *[_mirror_one(p, k) for p, k in mirror_targets],
                    return_exceptions=False,
                )

    # 2026-06-27 — Kick off the deferred-classifier polish drain for
    # this user.  Internally gated by ``_inflight_users`` so concurrent
    # uploads from the same user don't spawn duplicate workers, and
    # the drain naturally re-queries between rounds so books inserted
    # during the run are picked up too.  Tab-close resilient: the
    # task runs on the backend event loop, not the HTTP connection.
    try:
        from utils.polish_worker import schedule_polish_for_user
        schedule_polish_for_user(user.user_id)
    except Exception as _polish_exc:  # noqa: BLE001
        logger.warning("upload_books: failed to schedule polish for %s: %s",
                       user.user_id, _polish_exc)

    return {
        "uploaded": len(results),
        "books": results,
        "auto_resolved": auto_resolved,
        "policy": policy,
        "actions": actions,
        "url_lists": url_list_reports,
        "fandom_suggestions": upload_suggestions,
        "cross_format_duplicates": cross_format_dupes,
        "unknown_sources_found": unknown_hosts_recorded,
    }


async def _notify_friends_of_shared_fandom_uploads(
    uploader_id: str,
    uploader_display: str,
    uploaded_results: List[Dict[str, Any]],
) -> None:
    """When a user uploads fanfic in fandoms their friends also collect,
    drop one in-app notification per (friend, fandom) so the friend can
    peek at the new arrival. Best-effort only — failures are logged and
    swallowed so an upload never 500s on a notification hiccup.

    Rules:
      • Only books with a `fandom` value count (skips non-fic / original fic).
      • Books that were removed by an auto-resolve "discard" policy are
        skipped (`removed: True`).
      • One notification per (friend, fandom) per batch — not per book.
      • Hard cap of 50 notifications per upload to prevent runaway spam.
    """
    from routes.notifications import create_notification
    try:
        # 1) Distinct fandoms in this batch that we'd want to ping about.
        batch_fandoms: set = set()
        for b in uploaded_results or []:
            if not isinstance(b, dict):
                continue
            if b.get("removed"):
                continue
            fd = b.get("fandom")
            if fd and isinstance(fd, str) and fd.strip():
                batch_fandoms.add(fd.strip())
        if not batch_fandoms:
            return

        # 2) Accepted friends only.
        friend_rows = await db.friendships.find(
            {
                "status": "accepted",
                "$or": [{"user_a": uploader_id}, {"user_b": uploader_id}],
            },
            {"_id": 0, "user_a": 1, "user_b": 1},
        ).to_list(length=2000)
        friend_ids = [
            (r["user_b"] if r["user_a"] == uploader_id else r["user_a"])
            for r in friend_rows
        ]
        if not friend_ids:
            return

        # 3) For each friend, find which of the batch fandoms they also have.
        emitted = 0
        cap = 50
        for fid in friend_ids:
            if emitted >= cap:
                break
            rows = await db.books.find(
                {"user_id": fid, "fandom": {"$in": list(batch_fandoms)}},
                {"_id": 0, "fandom": 1},
            ).to_list(length=500)
            shared = sorted({r["fandom"] for r in rows if r.get("fandom")})
            for fandom in shared:
                if emitted >= cap:
                    break
                await create_notification(
                    fid,
                    kind="friend_new_book",
                    title=f"{uploader_display} just added a new {fandom} fic",
                    body="Peek their shelf to see what's new.",
                    link="/friends",
                )
                emitted += 1
    except Exception as e:  # pragma: no cover — defensive
        logger.warning(f"friend-fandom notifications skipped: {e}")


# NOTE: `GET /library/trends` was moved to routes/library_views.py
# in the Phase 5E refactor (2026-06-14).


# /library/originals* endpoints and the convert_original_to_epub helper
# live in ``routes/conversions.py`` (extracted 2026-06-13).


@api_router.get("/books/{book_id}")
async def get_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    # Cross-device awareness: attach the latest reading_cursor's device
    # info so the BookDetail page can render a "Last read on iPhone ·
    # 42% · 2h ago" hint next to the Read button.  Same payload shape
    # as /books/recent, kept consistent so the same FE helpers work.
    c = await db.reading_cursors.find_one(
        {"user_id": user.user_id, "book_id": book_id},
        {"_id": 0, "device_id": 1, "device_label": 1, "updated_at": 1, "percent": 1},
    )
    if c:
        book["last_device_id"]    = c.get("device_id")
        book["last_device_label"] = c.get("device_label") or ""
        ts = c.get("updated_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        book["last_cursor_updated_at"] = ts
        # If the cursor has a percent and the book doc doesn't track
        # one yet, fall back to cursor's percent for the UI.
        if c.get("percent") is not None and book.get("progress_fraction") is None:
            book["last_cursor_percent"] = c.get("percent")
    return book


@api_router.get("/books/{book_id}/reading-stats")
async def book_reading_stats(book_id: str, user: User = Depends(get_current_user)):
    """Per-book reading stats for the book-detail page.

    Returns:
      - reading_minutes: total time spent in this book (from heartbeats)
      - session_count: distinct days this book was opened/read
      - first_opened_at: ISO date of the first reading_activity row with this book
      - last_opened_at: from book document
      - sparkline: last 30 days, binary { date, active } per day
    """
    from datetime import date as _date, timedelta as _td

    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "reading_minutes": 1, "last_opened_at": 1, "created_at": 1, "progress_fraction": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Not found")

    activity = await db.reading_activity.find(
        {"user_id": user.user_id, "book_ids": book_id},
        {"_id": 0, "date": 1, "book_minutes": 1},
    ).sort("date", 1).to_list(2000)
    dates: List[str] = [a["date"] for a in activity if a.get("date")]
    # Map date -> minutes spent on THIS book that day. Older activity rows
    # (before per-book tracking landed) lack `book_minutes`; treat as 0.
    minutes_by_date: Dict[str, float] = {}
    for a in activity:
        bm = a.get("book_minutes") or {}
        minutes_by_date[a["date"]] = float(bm.get(book_id, 0))

    today = datetime.now(timezone.utc).date()
    cutoff = today - _td(days=29)
    date_set = set(dates)
    sparkline: List[Dict[str, Any]] = []
    # Find the day's max minutes (within the window) so the UI can normalize
    # bar heights without a second pass.
    window_minutes: List[float] = [
        minutes_by_date.get((cutoff + _td(days=i)).isoformat(), 0) for i in range(30)
    ]
    max_minutes = max(window_minutes) if window_minutes else 0
    for i in range(30):
        d = cutoff + _td(days=i)
        key = d.isoformat()
        mins = minutes_by_date.get(key, 0)
        sparkline.append({
            "date": key,
            "active": key in date_set,
            "minutes": int(mins),
        })

    # Reading-pace estimate: time-to-finish based on minutes-per-progress so far.
    # Only show when there's enough signal to avoid wild extrapolations:
    #   * at least 5 minutes of tracked reading (otherwise per-progress is noisy)
    #   * progress between 5% and 99% (else division explodes or book is done)
    reading_minutes = int(book.get("reading_minutes") or 0)
    progress = float(book.get("progress_fraction") or 0)
    estimated_minutes_left: Optional[int] = None
    if reading_minutes >= 5 and 0.05 <= progress < 0.99:
        try:
            estimated_minutes_left = max(0, int(round(
                (reading_minutes / progress) * (1 - progress)
            )))
            # Sanity cap at 1 week of reading (10080 min) — clamps wild outliers
            estimated_minutes_left = min(estimated_minutes_left, 10080)
        except (ZeroDivisionError, ValueError):
            estimated_minutes_left = None

    return {
        "book_id": book_id,
        "reading_minutes": reading_minutes,
        "session_count": len(dates),
        "first_opened_at": dates[0] if dates else None,
        "last_opened_at": book.get("last_opened_at"),
        "sparkline": sparkline,
        "sparkline_max_minutes": int(max_minutes),
        "progress_fraction": progress,
        "estimated_minutes_left": estimated_minutes_left,
    }


@api_router.get("/books/{book_id}/cover")
async def get_cover(book_id: str, request: Request):
    # Allow token in query for img src
    token = request.query_params.get('t')
    user_id = None
    if token:
        sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if sess:
            user_id = sess['user_id']
    if not user_id:
        try:
            user = await get_current_user(request)
            user_id = user.user_id
        except HTTPException:
            raise HTTPException(status_code=401, detail="Not authenticated")
    book = await db.books.find_one({"book_id": book_id, "user_id": user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    cover = STORAGE_DIR / user_id / f"{book_id}.cover"
    # Object-storage fallback: after a redeploy the local cache may be
    # empty even though the bytes are safely mirrored in the cloud.
    if not cover.exists():
        from utils.storage_cloud import ensure_local_cached
        if not await asyncio.to_thread(ensure_local_cached, cover, user_id, book_id, ".cover"):
            raise HTTPException(status_code=404, detail="No cover")
    return FileResponse(str(cover), media_type="image/jpeg")


@api_router.get("/books/{book_id}/download")
async def download_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        from utils.storage_cloud import ensure_local_cached
        if not await asyncio.to_thread(ensure_local_cached, fp, user.user_id, book_id, ".epub"):
            raise HTTPException(status_code=404, detail="File missing")
    # AV pre-flight on download — catches the "old file, new signature"
    # scenario where a book that was clean at upload time gets flagged
    # by an updated ClamAV signature DB.  Cheap when clamd is running
    # (~10-50 ms).  Cache the result on the book doc so we don't rescan
    # the same file on every subsequent download.
    if book.get("av_status") != "clean":
        from utils.antivirus import scan_path, record_quarantine
        _av = await asyncio.to_thread(scan_path, fp)
        if _av.get("infected"):
            await record_quarantine(
                user_id=user.user_id,
                filename=f"{book_id}.epub",
                scan=_av,
                source="restore",
                extra={"book_id": book_id},
            )
            await db.books.update_one(
                {"book_id": book_id, "user_id": user.user_id},
                {"$set": {
                    "av_status": "infected",
                    "av_signature": _av.get("signature", ""),
                    "av_scanned_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            raise HTTPException(
                status_code=403,
                detail=f"This file was flagged by antivirus ({_av.get('signature') or 'unknown signature'}) and can no longer be downloaded.",
            )
        if _av.get("ok"):
            await db.books.update_one(
                {"book_id": book_id, "user_id": user.user_id},
                {"$set": {
                    "av_status": "clean",
                    "av_scanned_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
    download_name = _templated_filename(book.get('title'), book.get('author'), book_id)
    return FileResponse(str(fp), media_type="application/epub+zip", filename=download_name)


# ---------------------------------------------------------------------
# Send to Kindle (2026-06-22) — emails the book's EPUB to the user's
# Amazon Kindle inbox.  Heavy lifting (file read, AV check, rate
# limit, Resend attachment send, email_logs write) lives in
# ``utils/send_to_kindle.py``; this route is a thin wrapper that
# enforces the auth context.
# ---------------------------------------------------------------------
@api_router.post("/books/{book_id}/send-to-kindle")
async def send_book_to_kindle_route(
    book_id: str,
    user: User = Depends(get_current_user),
):
    """Email the book's EPUB to the user's configured Kindle address.

    Gated on the ``send_to_kindle_enabled`` feature flag (default OFF,
    2026-06-22 — Resend quota brake).  When the flag is off, the
    endpoint returns 503 so the frontend can render a clear toast
    instead of users blaming the email service.

    Returns ``{"ok": true, "resend_id": "...", "to": "...", "size_bytes": int}``
    on success.  Common failure responses (caller surfaces toast text
    straight from the ``detail`` field):

    * 400 — no Kindle email configured / invalid format
    * 403 — book quarantined by antivirus
    * 404 — book or file missing
    * 413 — file > Kindle 25 MB gateway cap
    * 429 — same book already sent within the past 30 min
    * 502 — Resend rejected the send (quota, recipient bounce, etc.)
    * 503 — feature flag off or no Resend key configured
    """
    from utils.feature_flags import is_enabled  # noqa: WPS433
    if not await is_enabled("send_to_kindle_enabled"):
        from fastapi import HTTPException as _HE
        raise _HE(
            status_code=503,
            detail="Send-to-Kindle is currently disabled by the operator.",
        )
    from utils.send_to_kindle import send_book_to_kindle  # noqa: WPS433
    return await send_book_to_kindle(user_id=user.user_id, book_id=book_id)


@api_router.delete("/books/{book_id}")
async def delete_book(book_id: str, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    await db.books.delete_one({"book_id": book_id, "user_id": user.user_id})
    for ext in ['.epub', '.cover', '.links.txt']:
        p = STORAGE_DIR / user.user_id / f"{book_id}{ext}"
        if p.exists():
            p.unlink()
    return {"ok": True}


# NOTE: ``_safe_filename`` + ``_templated_filename`` were extracted to
# ``utils/book_files.py`` in Phase 6C slice 4 (2026-08-22) and are
# re-exported at the top of this module.


# NOTE: `GET /books/export/links` moved to routes/books_links.py
# in Phase 6C-A (2026-07-XX).


class ReclassifyBody(BaseModel):
    use_ai: bool = True


@api_router.post("/books/{book_id}/reclassify")
async def reclassify_book(book_id: str, body: ReclassifyBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File missing")
    meta = extract_epub_metadata(fp)
    classification = await classify_book(meta, force_ai=body.use_ai)
    await db.books.update_one(
        {"book_id": book_id},
        {"$set": {
            "category": classification['category'],
            "fandom": _canonicalize_fandom(classification.get('fandom')),
            "confidence": classification['confidence'],
            "classifier": classification['classifier'],
            "classifier_reason": classification.get('reasoning'),
        }},
    )
    return classification


class UpdateBookBody(BaseModel):
    category: Optional[str] = None
    fandom: Optional[str] = None
    title: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None


# NOTE: The block of fanfic-refresh endpoints + the health-probe / sweep
# helpers (`refresh-all`, `fanfic/status`, `retry-unavailable`, plus
# `_probe_fanfic_now`, `_sweep_user_unavailable`, `_fanfic_status_cache`)
# was moved to routes/refresh.py in the Phase 4 refactor (2026-06-14).


# NOTE: `POST /books/{book_id}/mark`, `/heartbeat`, `/progress`, `/touch`
# and the shared `_log_activity` helper moved to routes/reading_activity.py
# in the Phase 5F refactor (2026-06-14).


# NOTE: `GET /books/{book_id}/diff` and `POST /books/{book_id}/upload-new-version`
# were moved to routes/books_versions.py in the Phase 6C-A refactor (2026-07-XX).


# ============================================================
# TAGS ROUTES — extracted to routes/tags.py in books.py Phase 2 refactor.
# See ``backend/routes/tags.py`` for the 7 endpoints under /api/tags/* and
# /api/books/{book_id}/tags*. They still register on the same shared
# api_router so URLs are unchanged.
# ============================================================


# ============================================================
# AUTHOR ROUTES — extracted to routes/authors.py in Phase 2 refactor.
# See ``backend/routes/authors.py`` for /authors, /library/authors,
# and /library/by-author.
# ============================================================
class SetStatusBody(BaseModel):
    """Body for `PATCH /books/{book_id}/status`. `status=None` clears the
    manual override and falls back to the auto-detected value."""
    status: Optional[str] = None


@api_router.patch("/books/{book_id}/status")
async def set_book_status(
    book_id: str,
    body: SetStatusBody,
    user: User = Depends(get_current_user),
):
    """Override the auto-detected completion status for a single book.

    Persists to `manual_status` so a future re-detection (or refresh)
    can't blow the user's override away — choice 4b. Passing `status:
    null` clears the override and reverts to the auto-detected value.

    Accepts only `"complete"` / `"ongoing"` / `null`.
    """
    raw = (body.status or "").strip().lower()
    if raw and raw not in (STATUS_COMPLETE, STATUS_ONGOING):
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: {STATUS_COMPLETE}, {STATUS_ONGOING}, null",
        )
    update = (
        {"$set": {"manual_status": raw}}
        if raw else
        {"$unset": {"manual_status": ""}}
    )
    res = await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        update,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Book not found")
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "status": 1, "manual_status": 1},
    )
    return {
        "ok": True,
        "book_id": book_id,
        "status": book.get("status"),
        "manual_status": book.get("manual_status"),
        "effective_status": effective_status(book),
    }


# ============================================================
# AUTHOR SHELVES — extracted to routes/authors.py in Phase 2 refactor.
# See ``backend/routes/authors.py`` for /library/authors + /library/by-author.
# ============================================================


# ============================================================
# PAIRINGS / SHIP BROWSER — extracted to routes/pairings.py in Phase 2.
# See ``backend/routes/pairings.py`` for /library/pairings + /library/by-pairing.
# ============================================================


# Library backup, restore, backup-reminder and backup-history
# endpoints live in routes/library_backup.py (extracted 2026-06-13).


# NOTE: `GET /library/linkless` was moved to routes/library_views.py
# in the Phase 5E refactor (2026-06-14).


# NOTE: `/admin/unknown-sources` routes (list, dismiss, add, mark-accepted)
# moved to routes/books_unknown_sources.py in Phase 6C-A (2026-07-XX).


# NOTE: `GET /library/unreadable` was moved to routes/library_views.py
# in the Phase 5E refactor (2026-06-14).


# NOTE: `GET /books/{book_id}/download-original` moved to
# routes/books_links.py in Phase 6C-A (2026-07-XX).

class ClaimSourceUrlBody(BaseModel):
    """Body for `PATCH /books/{book_id}/source-url`.

    Accepts either field name — `url` (newer Linkless-shelf clients) or
    `source_url` (older "manual correction" clients / tests) — so we
    don't break either caller while we have just one endpoint.
    """
    url: Optional[str] = None
    source_url: Optional[str] = None


@api_router.patch("/books/{book_id}/source-url")
async def claim_source_url(
    book_id: str,
    body: ClaimSourceUrlBody,
    user: User = Depends(get_current_user),
):
    """Attach (or correct) the fanfic source URL on an existing book.

    Used by:
      * the Linkless library shelf — paste the URL the book "actually"
        came from to drop it out of `/library/linkless`;
      * the "Can't find online" flow — manually correct the URL after
        FanFicFare failed to identify it.

    The URL is normalized to canonical form (per source site) and
    written to BOTH `source_url` and `fanfic_urls` so future URL-list
    dedupe matches it. Also clears the `unavailable` / `last_fetch_error`
    flags so the next refresh tries the new URL.

    Rejects URLs that don't match any known fanfic source.
    """
    raw = (body.url or body.source_url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Source URL is empty")
    canon = _canonical_fanfic_url(raw)
    if not canon:
        # User pasted something they THOUGHT was a fanfic URL but the host
        # isn't on the accepted list. Log it for review before rejecting.
        try:
            from utils.unknown_sources import record_unknown_sources
            await record_unknown_sources(
                db, [raw], context="claim", user_id=user.user_id, book_id=book_id,
            )
        except Exception as _e:
            logger.warning("unknown_sources record failed for claim_source_url: %s", _e)
        raise HTTPException(
            status_code=400,
            detail="Not a recognized fanfic source URL. We support AO3, FFnet, FictionPress, RoyalRoad, SpaceBattles, SufficientVelocity, QQ, AFF, Potions & Snitches, and Twilighted.",
        )
    book = await db.books.find_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"_id": 0, "book_id": 1, "fanfic_urls": 1},
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    # Edge case: another book in the user's library already owns this URL.
    # If we silently overwrite we end up with two books bearing the same
    # source_url and future URL-list dedupe collapses into a coin-toss. Surface
    # the collision via 409 so the frontend can offer "open the other book
    # instead" rather than leaving the user with a hidden duplicate. The trash
    # shelf is excluded from the collision check — restoring a trashed book
    # via its source URL is a legitimate workflow.
    conflict = await db.books.find_one(
        {
            "user_id": user.user_id,
            "book_id": {"$ne": book_id},
            "category": {"$ne": TRASH_SHELF},
            "$or": [
                {"source_url": canon},
                {"fanfic_urls": canon},
            ],
        },
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "fandom": 1},
    )
    if conflict:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "url_already_claimed",
                "message": "Another book in your library already has this URL.",
                "conflict_book": {
                    "book_id": conflict.get("book_id"),
                    "title": conflict.get("title") or "Untitled",
                    "author": conflict.get("author") or "Unknown author",
                    "fandom": conflict.get("fandom"),
                },
            },
        )
    existing_urls = book.get("fanfic_urls") or []
    if canon not in existing_urls:
        existing_urls = [canon, *existing_urls]
    await db.books.update_one(
        {"book_id": book_id, "user_id": user.user_id},
        {"$set": {
            "source_url": canon,
            "fanfic_urls": existing_urls,
            "unavailable": False,
            "last_fetch_error": None,
        }},
    )
    return {
        "ok": True,
        "book_id": book_id,
        "source_url": canon,
        "fanfic_urls": existing_urls,
    }


# NOTE: /api/fandoms/* routes were moved to routes/fandoms.py in the
# Phase 5 refactor (2026-06-14).


@api_router.patch("/books/{book_id}")
async def update_book(book_id: str, body: UpdateBookBody, user: User = Depends(get_current_user)):
    book = await db.books.find_one({"book_id": book_id, "user_id": user.user_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Not found")
    update: Dict[str, Any] = {}
    classifier_touched = False
    if body.category is not None:
        update['category'] = body.category
        classifier_touched = True
    if body.fandom is not None:
        update['fandom'] = _canonicalize_fandom(body.fandom) if body.fandom else None
        classifier_touched = True
    # Length-limited so a paste-bomb description can't blow up our docs.
    if body.title is not None:
        update['title'] = body.title.strip()[:500]
    if body.author is not None:
        update['author'] = body.author.strip()[:500]
    if body.description is not None:
        update['description'] = body.description.strip()[:5000]
    if classifier_touched:
        update['classifier'] = 'manual'
        update['confidence'] = 1.0

    if not update:
        return {"ok": True, "noop": True}

    await db.books.update_one({"book_id": book_id, "user_id": user.user_id}, {"$set": update})

    # If any user-visible metadata field changed AND we still have the EPUB on
    # disk (i.e. not a link-only ingest), rewrite the EPUB so downloads stay
    # consistent. DB always wins — EPUB failures don't fail the request.
    epub_written = None
    file_only_fields = any(v is not None for v in (body.title, body.author, body.description))
    if file_only_fields:
        fp = STORAGE_DIR / user.user_id / f"{book_id}.epub"
        if fp.exists():
            result = update_epub_metadata(
                fp,
                title=body.title,
                author=body.author,
                description=body.description,
            )
            epub_written = bool(result.get("ok"))
            if not epub_written:
                logger.info(f"In-place EPUB metadata write skipped for {book_id}: {result.get('error')}")
    return {"ok": True, "epub_updated": epub_written}


# NOTE: /api/books/export/zip + _safe_folder helper were moved to
# routes/exports.py in the Phase 5 refactor (2026-06-14).


# NOTE: `POST /books/detect-series-all` and `PATCH /books/{book_id}/series`
# moved to routes/books_relationships.py in Phase 6C-A (2026-07-XX).
# The `SetSeriesBody` model lives in books_relationships.py; nothing
# else references it.


# NOTE: POST /books/{book_id}/upload-new-version moved to
# routes/books_versions.py in Phase 6C-A refactor (2026-07-XX).


# ----------------------------------------------------------------------
# DUPLICATE RESOLUTION
# `POST /books/{id}/resolve-duplicate`, `POST /books/resolve-group`,
# `GET /library/duplicates`, and `GET /library/duplicates/count` were
# moved to `routes/duplicate_resolution.py` in the Phase 5D refactor.
# `OLD_STORIES_SHELF`, `_updated_shelf_name`, `_normalize_title_for_match`,
# `extract_chapters`, `diff_chapters`, and `extract_epub_metadata` stay
# here because the upload + refresh paths still use them; the new module
# imports them from this file.
# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# TRASH SHELF — extracted to routes/trash.py in Phase 2 refactor.
# See ``backend/routes/trash.py`` for /trash, /trash/restore/*,
# /trash/restore-all, /trash/empty, and the ``sweep_expired_trash``
# background helper (now imported by digest.py from routes.trash).
# ----------------------------------------------------------------------


# ----------------------------------------------------------------------
# RELATIONSHIPS / PAIRINGS — moved to routes/books_relationships.py in
# Phase 6C-A (2026-07-XX). ``GET /relationships``, ``POST /relationships/
# backfill``, ``POST /books/detect-series-all``, and ``PATCH /books/
# {book_id}/series`` all live there.
# ----------------------------------------------------------------------


# ---------------------------------------------------------------------------
# NOTE: "Polish my library" routes (GET /books/polish/preview and POST
# /books/polish/apply) moved to routes/books_polish.py in the Phase 6C-A
# refactor (2026-07-XX). Core helpers live in ``utils/polish.py`` and
# ``utils/epub_metadata.update_epub_metadata``.
# ---------------------------------------------------------------------------

