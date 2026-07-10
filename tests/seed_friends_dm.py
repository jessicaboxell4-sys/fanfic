"""Seed two users + accepted friendship + sessions for DM drawer testing."""
import asyncio, os, time
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timedelta, timezone

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    ts = int(time.time())
    u1 = {"user_id": f"TEST_dm_user_a_{ts}", "email": f"test.dm.a.{ts}@example.com", "name": "DM Alice", "picture": "", "password_hash": "", "created_at": datetime.now(timezone.utc).isoformat()}
    u2 = {"user_id": f"TEST_dm_user_b_{ts}", "email": f"test.dm.b.{ts}@example.com", "name": "DM Bob", "picture": "", "password_hash": "", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_many([u1, u2])
    tok1 = f"test_session_a_{ts}"
    tok2 = f"test_session_b_{ts}"
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_many([
        {"user_id": u1["user_id"], "session_token": tok1, "expires_at": exp, "created_at": datetime.now(timezone.utc)},
        {"user_id": u2["user_id"], "session_token": tok2, "expires_at": exp, "created_at": datetime.now(timezone.utc)},
    ])
    # accepted friendship (try common collection name 'friendships')
    fs = {
        "friendship_id": f"TEST_friend_{ts}",
        "user_a": u1["user_id"], "user_b": u2["user_id"],
        "status": "accepted",
        "requested_by": u1["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "accepted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.friendships.insert_one(fs)
    print(f"USER_A={u1['user_id']}\nTOKEN_A={tok1}\nUSER_B={u2['user_id']}\nTOKEN_B={tok2}\nEMAIL_B={u2['email']}\nNAME_B={u2['name']}")

asyncio.run(main())
