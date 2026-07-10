"""Notification + achievement helpers for the cover ecosystem.

Centralises the messaging logic so the vote / import / share / scheduler
hooks in `routes/books.py` and `routes/digest.py` stay short and don't
each reinvent the same string templates.

Three classes of side-effect:

1. Per-event milestones (votes, imports)  — fired inline from the
   relevant endpoint after the counter has been updated.

2. Daily "Cover of the week" winner change — fired by an
   APScheduler cron tick (`_cover_leaderboard_tick`) that records the
   current winner in `system_state` and pings the sharer whenever the
   winner *changes*.  No fanfare for the same cover holding #1 for
   multiple days in a row.

3. Sunday weekly recap — `_cover_weekly_recap_tick` aggregates the
   hearts + imports each sharer earned in the past 7 days and pushes
   a single in-app notification per active sharer.

All notifications go through `create_notification`, which already
short-circuits if the user has muted that kind.  Failures are logged
but never raised, so a misbehaving notification never breaks the
vote/import endpoint that triggered it.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from deps import db, logger
from routes.notifications import create_notification


# ---------------------------------------------------------------------
# Milestone thresholds
# ---------------------------------------------------------------------

VOTE_MILESTONES: List[int] = [1, 5, 10, 25, 50, 100]
IMPORT_MILESTONES: List[int] = [1, 5, 10, 25]


# ---------------------------------------------------------------------
# Inline hooks called from vote / import / share endpoints
# ---------------------------------------------------------------------

async def notify_vote_milestone(
    cover_id: str,
    new_vote_count: int,
    voter_user_id: Optional[str] = None,
) -> None:
    """Called from POST /community-covers/{id}/vote AFTER the counter
    is persisted.  No-ops unless ``new_vote_count`` is exactly one of
    the milestone thresholds (so we don't re-fire on toggle).  Self-
    votes do still count — voting on your own cover is allowed and the
    milestone fires anyway, but only once."""
    if new_vote_count not in VOTE_MILESTONES:
        return
    cover = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "shared_by_user_id": 1, "title": 1, "author": 1},
    )
    if not cover:
        return
    sharer = cover.get("shared_by_user_id")
    if not sharer:
        return
    title = cover.get("title") or "your cover"
    # Don't ping the user for voting on themselves at milestone 1 if
    # they're the sole voter.  Lets us still fire at 5/10/etc when
    # others join in.
    if voter_user_id and voter_user_id == sharer and new_vote_count == 1:
        return
    body = (
        f"\u201c{title}\u201d just crossed {new_vote_count} "
        f"{'heart' if new_vote_count == 1 else 'hearts'} on the community covers pool."
    )
    try:
        await create_notification(
            sharer,
            kind="cover_milestone_votes",
            title=f"\U0001F49C  {new_vote_count} {'heart' if new_vote_count == 1 else 'hearts'} on your cover",
            body=body,
            link="/library",
        )
    except Exception as e:
        logger.exception("notify_vote_milestone failed for %s: %s", cover_id, e)


async def notify_import_milestone(cover_id: str, new_import_count: int) -> None:
    """Called from POST /books/{id}/import-community-cover/{cover_id}
    AFTER the import_count is bumped."""
    if new_import_count not in IMPORT_MILESTONES:
        return
    cover = await db.community_covers.find_one(
        {"cover_id": cover_id},
        {"_id": 0, "shared_by_user_id": 1, "title": 1},
    )
    if not cover:
        return
    sharer = cover.get("shared_by_user_id")
    if not sharer:
        return
    title = cover.get("title") or "your cover"
    libs_word = "reader\u2019s library" if new_import_count == 1 else "readers\u2019 libraries"
    body = (
        f"\u201c{title}\u201d has been imported into "
        f"{new_import_count} {libs_word}."
    )
    try:
        await create_notification(
            sharer,
            kind="cover_milestone_imports",
            title=f"\U0001F4E5  {new_import_count} "
                  f"{'import' if new_import_count == 1 else 'imports'} on your cover",
            body=body,
            link="/library",
        )
    except Exception as e:
        logger.exception("notify_import_milestone failed for %s: %s", cover_id, e)


async def notify_friends_of_new_share(
    cover_id: str, sharer_user_id: str, title: str,
) -> None:
    """Called from POST /books/{id}/cover-variants/{vid}/share.  Pings
    every accepted friend of the sharer.  Quiet failure — friends are
    a best-effort surface, not load-bearing."""
    if not sharer_user_id:
        return
    # Sharer's accepted friend ids (both directions on the friends doc).
    cursor = db.friendships.find(
        {
            "status": "accepted",
            "$or": [
                {"user_a": sharer_user_id},
                {"user_b": sharer_user_id},
            ],
        },
        {"_id": 0, "user_a": 1, "user_b": 1},
    )
    friend_ids: List[str] = []
    async for f in cursor:
        a, b = f.get("user_a"), f.get("user_b")
        friend_ids.append(b if a == sharer_user_id else a)
    if not friend_ids:
        return
    sharer_doc = await db.users.find_one(
        {"user_id": sharer_user_id},
        {"_id": 0, "username": 1, "email": 1},
    ) or {}
    handle = (
        sharer_doc.get("username")
        or (sharer_doc.get("email") or "").split("@", 1)[0]
        or "A friend"
    )
    body = f"@{handle} shared a new cover for \u201c{title}\u201d."
    for fid in friend_ids:
        try:
            await create_notification(
                fid,
                kind="friend_shared_cover",
                title=f"\u2728  New cover from @{handle}",
                body=body,
                link="/library",
            )
        except Exception as e:
            logger.exception("notify_friends_of_new_share fan-out failed for %s: %s", fid, e)


# ---------------------------------------------------------------------
# Achievements — persistent trophies surfaced on the public profile
# ---------------------------------------------------------------------

async def grant_achievement(user_id: str, kind: str, cover_id: str = "") -> None:
    """Idempotently record an achievement on the user doc.  Same (kind,
    cover_id) pair is only added once."""
    if not user_id or not kind:
        return
    entry = {
        "kind": kind,
        "cover_id": cover_id,
        "earned_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.users.update_one(
            {
                "user_id": user_id,
                # Filter dedupes when the same cover wins #1 for two
                # weeks running — we only stamp the trophy once.
                "cover_achievements": {
                    "$not": {"$elemMatch": {"kind": kind, "cover_id": cover_id}},
                },
            },
            {"$push": {"cover_achievements": entry}},
        )
    except Exception as e:
        logger.exception("grant_achievement failed for %s/%s: %s", user_id, kind, e)


# ---------------------------------------------------------------------
# Scheduler ticks
# ---------------------------------------------------------------------

SYSTEM_STATE_DOC_ID = "cover_ecosystem_state"


async def cover_leaderboard_tick() -> Dict[str, Any]:
    """Daily tick.  Finds the current #1 cover in the last 7 days and,
    if it differs from the previously-recorded winner, fires a
    cover_top_of_week notification to the new sharer + grants the
    achievement.  Returns a small status dict for cron-health logs."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    top = await db.community_covers.find_one(
        {"shared_at": {"$gte": cutoff}, "votes": {"$gt": 0}},
        sort=[("votes", -1), ("import_count", -1), ("shared_at", -1)],
        projection={"_id": 0, "cover_id": 1, "title": 1, "votes": 1, "shared_by_user_id": 1},
    )
    if not top:
        return {"top": None, "changed": False}

    state = await db.system_state.find_one(
        {"_id": SYSTEM_STATE_DOC_ID},
    ) or {}
    prev_top_id = state.get("top_of_week_cover_id")
    if prev_top_id == top["cover_id"]:
        return {"top": top["cover_id"], "changed": False}

    await db.system_state.update_one(
        {"_id": SYSTEM_STATE_DOC_ID},
        {"$set": {
            "top_of_week_cover_id": top["cover_id"],
            "top_of_week_user_id": top.get("shared_by_user_id", ""),
            "top_of_week_votes": int(top.get("votes", 0)),
            "top_of_week_updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )

    sharer = top.get("shared_by_user_id")
    title = top.get("title") or "your cover"
    if sharer:
        try:
            await create_notification(
                sharer,
                kind="cover_top_of_week",
                title="\U0001F3C6  Your cover is #1 this week",
                body=(
                    f"\u201c{title}\u201d is leading the community covers leaderboard "
                    f"with {int(top.get('votes', 0))} hearts."
                ),
                link="/library",
            )
            await grant_achievement(sharer, "top_of_week", cover_id=top["cover_id"])
        except Exception as e:
            logger.exception("cover_leaderboard_tick notify failed: %s", e)

    # Persistent archive — one row per ISO-week so a public archive
    # page can show the leaderboard going backwards in time even after
    # the original cover scrolls out of the 7-day window.
    now = datetime.now(timezone.utc)
    iso_year, iso_week, _ = now.isocalendar()
    try:
        await db.cover_archive.update_one(
            {"iso_year": iso_year, "iso_week": iso_week},
            {"$set": {
                "iso_year":     iso_year,
                "iso_week":     iso_week,
                "cover_id":     top["cover_id"],
                "title":        top.get("title", ""),
                "votes":        int(top.get("votes", 0)),
                "shared_by_user_id": sharer or "",
                "archived_at":  now.isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.exception("cover archive write failed: %s", e)

    return {"top": top["cover_id"], "changed": True, "sharer": sharer}


async def cover_weekly_recap_tick() -> Dict[str, Any]:
    """Sunday tick.  Aggregates hearts + imports earned per sharer in
    the past 7 days and pushes one in-app recap per active sharer.
    Sharers with zero activity get no ping (quiet weeks stay quiet)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    cursor = db.community_covers.find(
        {"shared_at": {"$gte": cutoff}},
        {"_id": 0, "shared_by_user_id": 1, "votes": 1, "import_count": 1, "title": 1},
    )
    per_user: Dict[str, Dict[str, int]] = {}
    async for c in cursor:
        uid = c.get("shared_by_user_id")
        if not uid:
            continue
        bucket = per_user.setdefault(uid, {"votes": 0, "imports": 0, "covers": 0})
        bucket["votes"] += int(c.get("votes") or 0)
        bucket["imports"] += int(c.get("import_count") or 0)
        bucket["covers"] += 1
    sent = 0
    for uid, b in per_user.items():
        if b["votes"] == 0 and b["imports"] == 0:
            continue
        body = (
            f"Your {b['covers']} shared "
            f"{'cover' if b['covers'] == 1 else 'covers'} earned "
            f"{b['votes']} \u2764\ufe0f and {b['imports']} "
            f"{'import' if b['imports'] == 1 else 'imports'} this week."
        )
        try:
            await create_notification(
                uid,
                kind="cover_weekly_recap",
                title="\U0001F4D6  Your weekly cover recap",
                body=body,
                link="/library",
            )
            sent += 1
        except Exception as e:
            logger.exception("cover_weekly_recap notify failed for %s: %s", uid, e)
    return {"recipients": sent}
