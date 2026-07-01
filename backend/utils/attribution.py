"""User attribution — capture and surface where visitors come from.

Records one row in ``db.user_attribution`` per public first-visit (unique
per session cookie).  When that session later signs up, ``promote_visit_to_user``
attaches the ``user_id`` and copies the earliest attribution into the
``users`` row itself (``first_referrer_domain``, ``first_utm_source``,
``first_utm_campaign``, ``first_landing_at``) so lookups on the users
list are cheap.

Privacy:
  - No raw IPs stored; we hash+salt so repeated visits from the same
    address dedupe but the row can't identify a specific person.
  - Anonymous rows expire after 90 days via a TTL index — enough for
    quarterly campaign attribution, short enough to not be a
    surveillance liability.
  - Rows tied to a signed-up ``user_id`` are permanent (they're part of
    the user's own account trail).

Aggregate surfaces:
  - ``attribution_summary(days)`` — grouped by ``referrer_domain`` and
    ``utm_campaign`` for the Admin Console card.
  - ``user_attribution_timeline(user_id)`` — per-user visit history for
    the user-detail flyout.
"""
from __future__ import annotations

import hashlib
import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from deps import db


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# 90-day retention on anon rows; user-tied rows are permanent (partial TTL).
_ANON_TTL_SECONDS = 90 * 24 * 60 * 60

# Salt for the ip-hash so a leaked db row can't be reverse-attacked against
# a known /8 subnet.  Read once at import so restarts don't invalidate old
# rows — if you rotate this env var, existing dedupe stops working (fine —
# no data loss, just no dedupe carry-over).
_IP_HASH_SALT = os.environ.get("ATTRIBUTION_IP_SALT", "shelfsort-attribution")

# Domain normalisation — click-tracker/redirect domains that should be
# collapsed into their true source so "twitter.com" doesn't fragment into
# t.co, x.com, twitter.com, etc.
_DOMAIN_ALIASES: Dict[str, str] = {
    "t.co":              "twitter.com",
    "x.com":             "twitter.com",
    "www.twitter.com":   "twitter.com",
    "mobile.twitter.com":"twitter.com",
    "l.facebook.com":    "facebook.com",
    "lm.facebook.com":   "facebook.com",
    "m.facebook.com":    "facebook.com",
    "www.facebook.com":  "facebook.com",
    "out.reddit.com":    "reddit.com",
    "old.reddit.com":    "reddit.com",
    "www.reddit.com":    "reddit.com",
    "www.google.com":    "google.com",
    "www.google.co.uk":  "google.com",
    "www.bing.com":      "bing.com",
    "duckduckgo.com":    "duckduckgo.com",
    "www.duckduckgo.com":"duckduckgo.com",
    "l.instagram.com":   "instagram.com",
    "www.instagram.com": "instagram.com",
    "lnkd.in":           "linkedin.com",
    "www.linkedin.com":  "linkedin.com",
    "bsky.app":          "bluesky.app",
    "www.bsky.app":      "bluesky.app",
}


def _normalize_domain(url: Optional[str], own_hosts: Optional[List[str]] = None) -> str:
    """Return a clean referrer bucket: 'twitter.com', 'google.com',
    'internal' (came from another page on OUR site), or 'direct' when
    no referrer was sent."""
    if not url:
        return "direct"
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return "direct"
    if not host:
        return "direct"
    own_hosts = own_hosts or []
    if any(host == h or host.endswith("." + h) for h in own_hosts):
        return "internal"
    return _DOMAIN_ALIASES.get(host, host)


def _hash_ip(ip: Optional[str]) -> Optional[str]:
    if not ip:
        return None
    return hashlib.sha256((_IP_HASH_SALT + "|" + ip).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Index setup — called from server.py startup
# ---------------------------------------------------------------------------
async def ensure_indexes() -> None:
    try:
        # Partial TTL: only anon rows (user_id absent/null) expire.
        # Rows tied to a signed-up user are permanent.
        await db.user_attribution.create_index(
            "arrived_at",
            expireAfterSeconds=_ANON_TTL_SECONDS,
            partialFilterExpression={"user_id": None},
        )
        await db.user_attribution.create_index([("session_id", 1), ("arrived_at", 1)])
        await db.user_attribution.create_index([("user_id", 1), ("arrived_at", 1)])
        await db.user_attribution.create_index([("arrived_at", -1)])
        await db.user_attribution.create_index("referrer_domain")
    except Exception as e:  # noqa: BLE001
        logger.warning("user_attribution index setup: %s", e)


# ---------------------------------------------------------------------------
# Public API — capture + promote
# ---------------------------------------------------------------------------
async def capture_visit(
    *,
    session_id: str,
    referrer_url: Optional[str],
    landing_path: Optional[str],
    utm: Dict[str, Optional[str]],
    user_agent: Optional[str],
    ip: Optional[str],
    own_hosts: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Insert one attribution row.  Idempotent-ish per session_id: if
    we've already seen this session_id today, we log a *revisit* row
    only when the referrer/utm actually changed (so we don't fill Mongo
    with duplicate anon rows every navigation)."""
    now = datetime.now(timezone.utc)
    domain = _normalize_domain(referrer_url, own_hosts=own_hosts)

    # Cheap dedupe: skip if this session already logged a row with the
    # same referrer_domain in the last hour AND the same utm_source.
    try:
        existing = await db.user_attribution.find_one(
            {
                "session_id": session_id,
                "referrer_domain": domain,
                "utm_source": utm.get("utm_source") or None,
                "arrived_at": {"$gte": now - timedelta(hours=1)},
            },
            {"_id": 1},
        )
        if existing:
            return {"skipped": True, "reason": "recent duplicate"}
    except Exception:
        pass  # dedupe is best-effort

    doc: Dict[str, Any] = {
        "session_id":      session_id,
        "user_id":         None,           # populated on signup
        "arrived_at":      now,
        "referrer_url":    (referrer_url or "")[:500] or None,
        "referrer_domain": domain,
        "landing_path":    (landing_path or "")[:200] or None,
        "utm_source":      (utm.get("utm_source")   or "")[:120] or None,
        "utm_medium":      (utm.get("utm_medium")   or "")[:120] or None,
        "utm_campaign":    (utm.get("utm_campaign") or "")[:120] or None,
        "utm_content":     (utm.get("utm_content")  or "")[:120] or None,
        "utm_term":        (utm.get("utm_term")     or "")[:120] or None,
        "user_agent":      (user_agent or "")[:200] or None,
        "ip_hash":         _hash_ip(ip),
    }
    try:
        await db.user_attribution.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.warning("user_attribution insert failed: %s", e)
        return {"ok": False, "error": str(e)[:200]}
    return {"ok": True, "referrer_domain": domain}


async def promote_visit_to_user(*, session_id: str, user_id: str) -> None:
    """Called from auth register/login: attach ``user_id`` to any anon
    rows recorded under this session, then copy the FIRST visit's
    attribution into the user's own row so the users list can render
    ``came from X`` without a join.

    Safe to call multiple times per user — idempotent."""
    if not session_id or not user_id:
        return
    try:
        # Attach user_id to every anon row for this session.
        await db.user_attribution.update_many(
            {"session_id": session_id, "user_id": None},
            {"$set": {"user_id": user_id}},
        )
        # Copy earliest attribution into the user record — only when the
        # user doesn't already have first_referrer_domain set.
        earliest = await db.user_attribution.find_one(
            {"user_id": user_id},
            {"_id": 0, "arrived_at": 1, "referrer_domain": 1, "referrer_url": 1,
             "landing_path": 1, "utm_source": 1, "utm_medium": 1,
             "utm_campaign": 1, "utm_content": 1, "utm_term": 1},
            sort=[("arrived_at", 1)],
        )
        if not earliest:
            return
        await db.users.update_one(
            {"user_id": user_id, "first_referrer_domain": {"$exists": False}},
            {"$set": {
                "first_landing_at":       earliest.get("arrived_at"),
                "first_referrer_domain":  earliest.get("referrer_domain"),
                "first_referrer_url":     earliest.get("referrer_url"),
                "first_landing_path":     earliest.get("landing_path"),
                "first_utm_source":       earliest.get("utm_source"),
                "first_utm_medium":       earliest.get("utm_medium"),
                "first_utm_campaign":     earliest.get("utm_campaign"),
                "first_utm_content":      earliest.get("utm_content"),
                "first_utm_term":         earliest.get("utm_term"),
            }},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("promote_visit_to_user failed for %s: %s", user_id, e)


# ---------------------------------------------------------------------------
# Aggregate + per-user surfaces
# ---------------------------------------------------------------------------
async def attribution_summary(days: int = 30) -> Dict[str, Any]:
    """Return top referrer domains + top UTM campaigns for the window."""
    days = max(1, min(int(days), 365))
    since = datetime.now(timezone.utc) - timedelta(days=days)

    async def _agg(field: str, limit: int = 15) -> List[Dict[str, Any]]:
        try:
            cursor = db.user_attribution.aggregate([
                {"$match": {"arrived_at": {"$gte": since}}},
                {"$group": {
                    "_id":         f"${field}",
                    "visits":      {"$sum": 1},
                    "unique_sessions": {"$addToSet": "$session_id"},
                    "signups":     {"$sum": {"$cond": [{"$ne": ["$user_id", None]}, 1, 0]}},
                }},
                {"$project": {
                    "_id": 0,
                    "key":     "$_id",
                    "visits":  1,
                    "signups": 1,
                    "unique_sessions": {"$size": "$unique_sessions"},
                }},
                {"$sort": {"visits": -1}},
                {"$limit": limit},
            ])
            return [r async for r in cursor]
        except Exception as e:  # noqa: BLE001
            logger.warning("attribution_summary agg on %s failed: %s", field, e)
            return []

    by_domain = await _agg("referrer_domain")
    by_campaign = await _agg("utm_campaign")
    # Drop nulls from campaign list — most visits have no utm_campaign.
    by_campaign = [r for r in by_campaign if r.get("key")]

    total_visits = sum(r["visits"] for r in by_domain)
    total_signups = 0
    try:
        total_signups = await db.user_attribution.count_documents(
            {"arrived_at": {"$gte": since}, "user_id": {"$ne": None}},
        )
    except Exception:
        pass

    return {
        "window_days":   days,
        "total_visits":  total_visits,
        "total_signups": total_signups,
        "by_domain":     by_domain,
        "by_campaign":   by_campaign,
    }


async def user_attribution_timeline(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Return every attribution row for a user, newest first."""
    if not user_id:
        return []
    try:
        cursor = db.user_attribution.find(
            {"user_id": user_id},
            {"_id": 0, "arrived_at": 1, "referrer_domain": 1, "referrer_url": 1,
             "landing_path": 1, "utm_source": 1, "utm_medium": 1,
             "utm_campaign": 1, "utm_content": 1, "utm_term": 1},
        ).sort("arrived_at", -1).limit(limit)
        out = []
        async for r in cursor:
            ts = r.get("arrived_at")
            r["arrived_at"] = ts.isoformat() if hasattr(ts, "isoformat") else ts
            out.append(r)
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("user_attribution_timeline read failed: %s", e)
        return []


__all__ = [
    "ensure_indexes",
    "capture_visit",
    "promote_visit_to_user",
    "attribution_summary",
    "user_attribution_timeline",
]
