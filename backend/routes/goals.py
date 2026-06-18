"""Reading goals — multi-period, multi-metric.

Collection ``reading_goals``::

    {
      goal_id: str,
      user_id: str,
      metric: "books" | "words" | "pages",
      period_type: "year" | "month",
      period_value: str,        # "2026" or "2026-03"
      target: int,              # number of books, words, or pages
      created_at, updated_at,
      hit_at: iso str | null,            # the moment progress first crossed target
      hit_celebrated_at: iso str | null, # set once user has seen the celebration
    }

Progress is **derived live** from the books collection — a book counts toward
its period iff ``progress_fraction >= 0.99`` AND ``last_opened_at`` falls inside
the period.  This mirrors the heuristic already used by ``stats.py`` and
``year.py``, so a single source of truth.
"""
import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal

from fastapi import Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from deps import db, api_router, logger
from models import User
from auth_dep import get_current_user, _resolve_session_user
from routes.notifications import create_notification
from utils.goal_events import publish_goal_hit, subscribe as subscribe_goal_events


# Words per page — the canonical typesetting estimate used by Kindle and most
# print publishers.  We support a "pages" goal kind by dividing summed words by
# this constant rather than tracking a separate page_count field on books.
WORDS_PER_PAGE = 250

METRICS = ("books", "words", "pages")
PERIOD_TYPES = ("year", "month")


# ---------------------------------------------------------------------
# Pydantic bodies
# ---------------------------------------------------------------------

class GoalCreate(BaseModel):
    metric: Literal["books", "words", "pages"]
    period_type: Literal["year", "month"]
    period_value: str = Field(..., min_length=4, max_length=7)
    target: int = Field(..., ge=1, le=10_000_000)

    @field_validator("period_value")
    @classmethod
    def _check_period(cls, v: str, info):  # type: ignore[no-untyped-def]
        pt = info.data.get("period_type")
        if pt == "year":
            if not (len(v) == 4 and v.isdigit() and 1900 <= int(v) <= 2100):
                raise ValueError("period_value for a year goal must be YYYY between 1900 and 2100")
        elif pt == "month":
            if not (len(v) == 7 and v[4] == "-" and v[:4].isdigit() and v[5:].isdigit()):
                raise ValueError("period_value for a month goal must be YYYY-MM")
            yr = int(v[:4])
            mo = int(v[5:])
            if not (1 <= mo <= 12 and 1900 <= yr <= 2100):
                raise ValueError("period_value out of range")
        return v


class GoalUpdate(BaseModel):
    target: int = Field(..., ge=1, le=10_000_000)


# ---------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------

def _period_bounds(period_type: str, period_value: str) -> tuple[datetime, datetime]:
    """Return [start, end) UTC datetimes covering the goal's period."""
    if period_type == "year":
        yr = int(period_value)
        return (
            datetime(yr, 1, 1, tzinfo=timezone.utc),
            datetime(yr + 1, 1, 1, tzinfo=timezone.utc),
        )
    yr = int(period_value[:4])
    mo = int(period_value[5:])
    start = datetime(yr, mo, 1, tzinfo=timezone.utc)
    nyr, nmo = (yr + 1, 1) if mo == 12 else (yr, mo + 1)
    end = datetime(nyr, nmo, 1, tzinfo=timezone.utc)
    return start, end


def _period_label(period_type: str, period_value: str) -> str:
    if period_type == "year":
        return period_value
    yr = int(period_value[:4])
    mo = int(period_value[5:])
    return datetime(yr, mo, 1).strftime("%b %Y")


# ---------------------------------------------------------------------
# Progress computation
# ---------------------------------------------------------------------

async def _compute_progress(user_id: str, metric: str, period_type: str, period_value: str) -> int:
    """Sum the achievement metric across books finished in the period.

    A book counts if ``progress_fraction >= 0.99`` AND ``last_opened_at`` ISO
    string starts with the period prefix.  We compare prefixes because Mongo
    stores the timestamps as strings and Mongo's string comparison is well-
    defined for ISO-8601.
    """
    start, end = _period_bounds(period_type, period_value)
    # ISO-8601 lexicographic comparison works for UTC timestamps.
    start_iso = start.isoformat()
    end_iso = end.isoformat()

    cursor = db.books.find(
        {
            "user_id": user_id,
            "progress_fraction": {"$gte": 0.99},
            "last_opened_at": {"$gte": start_iso, "$lt": end_iso},
        },
        {"_id": 0, "book_id": 1, "word_count": 1},
    )
    if metric == "books":
        # Cheap path — server-side count, no docs returned.
        return await db.books.count_documents({
            "user_id": user_id,
            "progress_fraction": {"$gte": 0.99},
            "last_opened_at": {"$gte": start_iso, "$lt": end_iso},
        })
    total_words = 0
    async for b in cursor:
        total_words += int(b.get("word_count") or 0)
    if metric == "words":
        return total_words
    if metric == "pages":
        return total_words // WORDS_PER_PAGE
    return 0


# ---------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------

async def _serialize_goal(doc: Dict[str, Any]) -> Dict[str, Any]:
    metric = doc.get("metric", "books")
    period_type = doc.get("period_type", "year")
    period_value = doc.get("period_value", "")
    current = await _compute_progress(doc["user_id"], metric, period_type, period_value)
    target = int(doc.get("target") or 1)
    fraction = min(1.0, current / target) if target > 0 else 0.0
    return {
        "goal_id": doc["goal_id"],
        "metric": metric,
        "period_type": period_type,
        "period_value": period_value,
        "period_label": _period_label(period_type, period_value),
        "target": target,
        "current": current,
        "fraction": round(fraction, 4),
        "hit_at": doc.get("hit_at"),
        "hit_celebrated_at": doc.get("hit_celebrated_at"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _maybe_mark_hit(goal_doc: Dict[str, Any], current: int) -> Optional[Dict[str, Any]]:
    """If the goal just crossed its target for the first time, stamp `hit_at`
    and fire a one-time in-app notification.  Returns the {hit_at} update so
    the caller can patch its own copy.
    """
    if goal_doc.get("hit_at"):
        return None
    target = int(goal_doc.get("target") or 1)
    if current < target:
        return None
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.reading_goals.update_one(
        {"goal_id": goal_doc["goal_id"]},
        {"$set": {"hit_at": now_iso}},
    )
    metric = goal_doc.get("metric", "books")
    label = _period_label(goal_doc.get("period_type"), goal_doc.get("period_value"))
    unit = {"books": "books", "words": "words", "pages": "pages"}.get(metric, "books")
    await create_notification(
        goal_doc["user_id"],
        kind="reading_goal_hit",
        title=f"You hit your {label} reading goal",
        body=f"{target:,} {unit} — congrats! Confetti is waiting on the goals page.",
        link="/goals",
    )
    # Fan the hit out to every open SSE connection for this user so any
    # tabs currently mounted on the app get instant confetti without
    # waiting for the next /goals poll.  Best-effort — see goal_events.py.
    await publish_goal_hit(goal_doc["user_id"], {
        "goal_id": goal_doc["goal_id"],
        "metric": metric,
        "period_label": label,
        "period_type": goal_doc.get("period_type"),
        "period_value": goal_doc.get("period_value"),
        "target": target,
        "hit_at": now_iso,
    })
    return {"hit_at": now_iso}


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@api_router.get("/goals")
async def list_goals(user: User = Depends(get_current_user)):
    docs = await db.reading_goals.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort([("period_value", -1), ("created_at", -1)]).to_list(length=500)
    out = []
    for d in docs:
        # Compute progress first so a freshly-crossed goal can be stamped.
        current = await _compute_progress(d["user_id"], d.get("metric"), d.get("period_type"), d.get("period_value"))
        patch = await _maybe_mark_hit(d, current)
        if patch:
            d.update(patch)
        serialized = await _serialize_goal(d)
        out.append(serialized)
    return {"goals": out}


@api_router.post("/goals")
async def create_goal(body: GoalCreate, user: User = Depends(get_current_user)):
    # One goal per (metric, period_type, period_value) tuple per user.
    existing = await db.reading_goals.find_one({
        "user_id": user.user_id,
        "metric": body.metric,
        "period_type": body.period_type,
        "period_value": body.period_value,
    })
    if existing:
        raise HTTPException(status_code=409, detail="A goal for that metric+period already exists. Edit it instead.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "goal_id": f"goal_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "metric": body.metric,
        "period_type": body.period_type,
        "period_value": body.period_value,
        "target": int(body.target),
        "hit_at": None,
        "hit_celebrated_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.reading_goals.insert_one(dict(doc))
    return await _serialize_goal(doc)


@api_router.patch("/goals/{goal_id}")
async def update_goal(goal_id: str, body: GoalUpdate, user: User = Depends(get_current_user)):
    doc = await db.reading_goals.find_one({"goal_id": goal_id, "user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal not found")
    update = {
        "target": int(body.target),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # If target was lowered below the current progress this could trigger a
    # fresh "hit" — clear any prior celebrate flag so the user gets a refreshed
    # one-shot moment.  If target raised above current, leave history intact.
    current = await _compute_progress(doc["user_id"], doc.get("metric"), doc.get("period_type"), doc.get("period_value"))
    if int(doc.get("target") or 0) and current < int(body.target):
        # Now under target again — reset hit so it can fire later.
        update["hit_at"] = None
        update["hit_celebrated_at"] = None
    await db.reading_goals.update_one(
        {"goal_id": goal_id, "user_id": user.user_id},
        {"$set": update},
    )
    doc.update(update)
    return await _serialize_goal(doc)


@api_router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user: User = Depends(get_current_user)):
    res = await db.reading_goals.delete_one({"goal_id": goal_id, "user_id": user.user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"ok": True}


@api_router.post("/goals/{goal_id}/celebrate")
async def mark_goal_celebrated(goal_id: str, user: User = Depends(get_current_user)):
    """Called by the frontend once the confetti animation has played so the
    user doesn't see it every page-load."""
    doc = await db.reading_goals.find_one({"goal_id": goal_id, "user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Goal not found")
    if not doc.get("hit_at"):
        raise HTTPException(status_code=400, detail="Goal hasn't been hit yet")
    now = datetime.now(timezone.utc).isoformat()
    await db.reading_goals.update_one(
        {"goal_id": goal_id, "user_id": user.user_id},
        {"$set": {"hit_celebrated_at": now}},
    )
    doc["hit_celebrated_at"] = now
    return await _serialize_goal(doc)


# ---------------------------------------------------------------------
# SSE: live goal-hit stream
# ---------------------------------------------------------------------
# Why SSE and not WebSockets?
#   Goal-hit events are server → client only, very low volume, and we
#   want the connection to survive flaky networks and tunnels (Cloudflare
#   tolerates SSE happily; WS through ingress is fussier).  EventSource
#   also auto-reconnects with `Last-Event-ID` support so we don't need
#   client-side reconnect logic.
#
# Why ``_resolve_session_user`` and not ``get_current_user``?
#   ``get_current_user`` rejects pending/rejected users, but the SSE
#   endpoint should also reject them — same effect, but going through
#   the unwrapped resolver lets us return a 401 *before* opening the
#   stream so the EventSource doesn't sit there retrying forever.

@api_router.get("/goals/stream")
async def stream_goal_hits(request: Request):
    """Server-Sent Events stream that fires whenever the authenticated
    user's reading goals flip to "hit".  Replaces 90-second polling in
    ``GlobalConfettiHost``.

    Frame format::

        : keepalive\\n\\n            (every 25s — comment line, ignored by EventSource)
        event: goal-hit\\n
        data: {json}\\n\\n           (when a goal is hit)
    """
    user = await _resolve_session_user(request)
    user_id = user.user_id

    async def event_generator():
        # Yield an initial comment so the browser knows the connection is
        # open immediately (some proxies buffer until the first byte).
        yield ": connected\n\n"
        sub = subscribe_goal_events(user_id)
        try:
            while True:
                # Race the next event against a 25s heartbeat so an idle
                # tunnel doesn't get reaped by Cloudflare (it kills
                # connections after ~100s of silence).
                next_evt = asyncio.create_task(sub.__anext__())
                sleeper = asyncio.create_task(asyncio.sleep(25))
                try:
                    done, pending = await asyncio.wait(
                        {next_evt, sleeper},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for p in pending:
                        p.cancel()
                    if next_evt in done:
                        payload = next_evt.result()
                        yield f"event: goal-hit\ndata: {json.dumps(payload)}\n\n"
                    else:
                        # heartbeat
                        yield ": keepalive\n\n"
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 — defensive, never crash the stream
                    logger.exception("goal-hit SSE iteration failed")
                    break
                # Stop cleanly when the HTTP request goes away.
                if await request.is_disconnected():
                    break
        finally:
            try:
                await sub.aclose()  # type: ignore[attr-defined]
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",  # disable any proxy buffering
            "Connection": "keep-alive",
        },
    )




# ---------------------------------------------------------------------
# Unified events stream (Tier-X 2026-06-18)
# ---------------------------------------------------------------------

@api_router.get("/events/stream")
async def stream_events(request: Request):
    """Multiplexed SSE channel — fans out every transient per-user
    event (goal-hit, notification, future bookclub-msg / friend-finish)
    over a single persistent connection.

    Replaces the per-feature polling loops in ``NotificationsBell``,
    ``MessagesDropdown``, ``FriendsPage``, and ``ActiveRoomPanel``.

    Frame format::

        : connected\\n\\n              (open ack so proxies flush)
        : keepalive\\n\\n              (every 25s — Cloudflare keep-alive)
        event: notification\\n
        data: {json}\\n\\n             (when create_notification fires)
        event: goal-hit\\n
        data: {json}\\n\\n             (when publish_goal_hit fires)
    """
    user = await _resolve_session_user(request)
    user_id = user.user_id

    from utils.event_bus import subscribe as bus_subscribe

    async def event_generator():
        yield ": connected\n\n"
        sub = bus_subscribe(user_id)
        try:
            while True:
                next_evt = asyncio.create_task(sub.__anext__())
                sleeper = asyncio.create_task(asyncio.sleep(25))
                try:
                    done, pending = await asyncio.wait(
                        {next_evt, sleeper},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for p in pending:
                        p.cancel()
                    if next_evt in done:
                        envelope = next_evt.result()
                        kind = envelope.get("kind") or "event"
                        data = envelope.get("data") or {}
                        yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"
                    else:
                        yield ": keepalive\n\n"
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    logger.exception("events SSE iteration failed")
                    break
                if await request.is_disconnected():
                    break
        finally:
            try:
                await sub.aclose()  # type: ignore[attr-defined]
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
