"""One-shot DB migration: rename `progress_percent` → `progress_fraction`.

Run once after deploying the renamed backend.  Idempotent: if a doc already
has `progress_fraction` set (from a fresh write) the old key is just
removed.  Run with:

    cd /app/backend && python -m scripts.migrate_progress_field

The script reports how many documents were rewritten, plus how many had
neither key and were left alone.  Reading-event audit rows in
``reading_events`` use the same key inside ``meta`` and are migrated too.
"""

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Match how the rest of the backend bootstraps env vars so the script is
# runnable with a single command from anywhere on the container.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def migrate() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # 1) books.progress_percent → books.progress_fraction
    books_total = await db.books.count_documents({"progress_percent": {"$exists": True}})
    if books_total:
        result = await db.books.update_many(
            {"progress_percent": {"$exists": True}},
            [
                {
                    "$set": {
                        # If progress_fraction doesn't exist yet, copy from
                        # progress_percent. Otherwise keep the existing
                        # (newer) value untouched.
                        "progress_fraction": {
                            "$ifNull": ["$progress_fraction", "$progress_percent"],
                        },
                    }
                },
                {"$unset": "progress_percent"},
            ],
        )
        print(f"books: matched={result.matched_count} modified={result.modified_count}")
    else:
        print("books: no documents had `progress_percent` — nothing to do.")

    # 2) reading_events.meta.progress_percent → reading_events.meta.progress_fraction
    events_total = await db.reading_events.count_documents({"meta.progress_percent": {"$exists": True}})
    if events_total:
        # Old-style update with $rename is fine here because we don't need
        # any conditional copy — the meta dict is opaque per-event.
        result = await db.reading_events.update_many(
            {"meta.progress_percent": {"$exists": True}},
            {"$rename": {"meta.progress_percent": "meta.progress_fraction"}},
        )
        print(f"reading_events: matched={result.matched_count} modified={result.modified_count}")
    else:
        print("reading_events: no documents had `meta.progress_percent` — nothing to do.")

    client.close()
    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
