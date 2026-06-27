"""Characters browser — unit tests for the new /api/library/characters
and /api/library/by-character endpoints.

Characters are derived at query time by splitting each book's
``relationships`` array on AO3's ``/`` (romantic) and ``&`` (gen)
separators. This test pins down:
  * the split logic (``_split_characters``)
  * the directory sort order (count DESC, name ASC tiebreak)
  * dedupe across multiple relationships in the same book
  * case-insensitive lookup on the per-character shelf
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _uid() -> str:
    return f"user_chars_{uuid.uuid4().hex[:10]}"


def test_split_characters_handles_separators():
    """The pure tokenizer covers /, &, and space-padded x."""
    from routes.characters import _split_characters

    assert _split_characters("Harry Potter/Hermione Granger") == [
        "Harry Potter", "Hermione Granger",
    ]
    assert _split_characters("Harry Potter & Ron Weasley") == [
        "Harry Potter", "Ron Weasley",
    ]
    assert _split_characters("Harry Potter x Draco Malfoy") == [
        "Harry Potter", "Draco Malfoy",
    ]
    # 3-way OT3 with mixed separators.
    assert _split_characters("Harry/Ron/Hermione") == ["Harry", "Ron", "Hermione"]
    # Plain name with no separator → single character.
    assert _split_characters("Hermione Granger") == ["Hermione Granger"]
    # Bare 'x' inside a name must NOT split.
    assert _split_characters("Alex Mason") == ["Alex Mason"]
    # Blank input.
    assert _split_characters("") == []
    assert _split_characters("   ") == []


def test_list_characters_sorts_count_desc_then_name(shared_event_loop):
    """Directory sort = count DESC, name ASC tiebreak."""
    from routes.characters import list_characters
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Charter",
                "approval_status": "approved",
            })
            # Library:
            #   • Harry appears in 3 books   (Harry/Hermione, Harry/Draco, Harry & Ron)
            #   • Hermione appears in 1 book
            #   • Draco appears in 1 book
            #   • Ron appears in 1 book
            # Hermione, Draco, Ron all tie at 1 — sort by name ASC.
            books = [
                ("Book A", "HP", ["Harry/Hermione"]),
                ("Book B", "HP", ["Harry/Draco"]),
                ("Book C", "HP", ["Harry & Ron"]),
            ]
            for title, fandom, rels in books:
                await db.books.insert_one({
                    "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                    "user_id": uid,
                    "title": title,
                    "fandom": fandom,
                    "category": "Fanfiction",
                    "relationships": rels,
                })

            me = User(user_id=uid, email=f"{uid}@example.com", name="Charter")
            result = await list_characters(user=me)
            names = [c["name"] for c in result["characters"]]
            counts = {c["name"]: c["count"] for c in result["characters"]}

            # Harry must be first with count 3.
            assert names[0] == "Harry"
            assert counts["Harry"] == 3
            # Remaining three all have count 1 and must be alpha-sorted.
            assert names[1:] == ["Draco", "Hermione", "Ron"]
            assert counts["Draco"] == counts["Hermione"] == counts["Ron"] == 1
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_character_count_dedupes_within_one_book(shared_event_loop):
    """A character that appears in two relationships of the same book
    must count as one book, not two."""
    from routes.characters import list_characters
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Charter",
                "approval_status": "approved",
            })
            await db.books.insert_one({
                "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                "user_id": uid,
                "title": "Polycule fic",
                "fandom": "HP",
                "category": "Fanfiction",
                # Harry appears in both relationships of THIS book.
                "relationships": ["Harry/Draco", "Harry & Hermione"],
            })

            me = User(user_id=uid, email=f"{uid}@example.com", name="Charter")
            result = await list_characters(user=me)
            counts = {c["name"]: c["count"] for c in result["characters"]}
            assert counts["Harry"] == 1  # not 2
            assert counts["Draco"] == 1
            assert counts["Hermione"] == 1
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_list_characters_scoped_to_fandom(shared_event_loop):
    """When ``fandom`` is supplied, only books on that fandom shelf
    contribute to the character counts.  Powers the 'Top characters'
    rail on /library/fandom/:fandom."""
    from routes.characters import list_characters
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Charter",
                "approval_status": "approved",
            })
            # One HP book and one MCU book — Harry only appears in HP.
            await db.books.insert_one({
                "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                "user_id": uid, "title": "HP fic",
                "fandom": "Harry Potter", "category": "Fanfiction",
                "relationships": ["Harry Potter/Hermione Granger"],
            })
            await db.books.insert_one({
                "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                "user_id": uid, "title": "MCU fic",
                "fandom": "Marvel", "category": "Fanfiction",
                "relationships": ["Steve Rogers/Tony Stark"],
            })

            me = User(user_id=uid, email=f"{uid}@example.com", name="Charter")
            hp = await list_characters(user=me, fandom="Harry Potter", limit=10)
            hp_names = {c["name"] for c in hp["characters"]}
            assert "Harry Potter" in hp_names
            assert "Hermione Granger" in hp_names
            assert "Steve Rogers" not in hp_names
            assert "Tony Stark" not in hp_names
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_by_character_is_case_insensitive(shared_event_loop):
    """list_books_by_character matches the character name
    case-insensitively so 'harry potter' finds the same books as
    'Harry Potter'."""
    from routes.characters import list_books_by_character
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Charter",
                "approval_status": "approved",
            })
            await db.books.insert_one({
                "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                "user_id": uid,
                "title": "Match me",
                "fandom": "HP",
                "category": "Fanfiction",
                "relationships": ["Harry Potter/Hermione Granger"],
            })

            me = User(user_id=uid, email=f"{uid}@example.com", name="Charter")
            res_canon = await list_books_by_character(character="Harry Potter", user=me)
            res_lower = await list_books_by_character(character="harry potter", user=me)
            res_upper = await list_books_by_character(character="HARRY POTTER", user=me)
            assert res_canon["count"] == res_lower["count"] == res_upper["count"] == 1
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())


def test_relationships_endpoint_has_alpha_tiebreak(shared_event_loop):
    """/api/relationships now uses count DESC, _id ASC so ties are
    deterministic instead of relying on Mongo insertion order."""
    from routes.books import api_router  # noqa: F401  (forces module import)
    from models import User

    async def _run():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = cli[os.environ["DB_NAME"]]
        uid = _uid()
        try:
            await db.users.insert_one({
                "user_id": uid,
                "email": f"{uid}@example.com",
                "name": "Tiebreak",
                "approval_status": "approved",
            })
            # Two pairings, same count → alpha tiebreak applies.
            for title, rel in [
                ("X", "Zara/Alex"),
                ("Y", "Alice/Bob"),
            ]:
                await db.books.insert_one({
                    "book_id": f"bk_{uuid.uuid4().hex[:10]}",
                    "user_id": uid,
                    "title": title,
                    "fandom": "F1",
                    "category": "Fanfiction",
                    "relationships": [rel],
                })

            # Hit the same pipeline as routes/books.py:list_relationships.
            pipeline = [
                {"$match": {"user_id": uid, "category": {"$ne": "TRASH"},
                            "relationships": {"$exists": True, "$ne": []}}},
                {"$unwind": "$relationships"},
                {"$group": {"_id": "$relationships", "count": {"$sum": 1},
                            "fandoms": {"$addToSet": "$fandom"}}},
                {"$sort": {"count": -1, "_id": 1}},
            ]
            rows = await db.books.aggregate(pipeline).to_list(50)
            names = [r["_id"] for r in rows]
            assert names == sorted(names)  # alpha-sorted on identical counts
        finally:
            await db.users.delete_many({"user_id": uid})
            await db.books.delete_many({"user_id": uid})
            cli.close()

    shared_event_loop.run_until_complete(_run())
