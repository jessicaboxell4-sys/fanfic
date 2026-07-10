"""Email-volume forecast (2026-06-22) — Resend quota heads-up.

Goal
----
Tell the operator BEFORE they hit the Resend daily cap.  Powers the
``/admin/email-volume-forecast`` card.

The forecast has two halves:

1. **Past** — straight count from ``email_logs`` grouped by kind +
   status over the last 7 and 30 days.  Anchors the projection in
   real data so any miscalibrated coefficient below can't drift too
   far.

2. **Projected next 7 / 30 days** — sum across the known weekly
   email crons, weighted by current opt-in counts in ``users``:

   * ``weekly_digest``         — ``digest.enabled`` × 1/week
   * ``update_digest``         — ``update_email.enabled`` × ~0.5/week
                                 (ad-hoc after fic refreshes)
   * ``friends_finished``      — ``friends_finished.email_enabled``
                                 × 1/week
   * ``bookclub_digest``       — ``bookclub_digest.email_enabled``
                                 × 1/week
   * ``weekly_summary``        — ``weekly_summary.enabled`` × 1/week
                                 BUT subtracts the other four for
                                 the same users (they're skipped
                                 server-side when this flag is on)
   * ``cover_weekly_recap``    — every cover sharer × 1/week
                                 (in-app fallback is already lazy)

   Test-fixture accounts are excluded from every count via
   ``utils.test_account_filter.mongo_test_account_filter``.

Cap detection — Resend free tier is 100 emails/day.  We surface
``daily_avg_7d`` (past 7d / 7) and warn when the 7-day projection
implies >100/day.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict

from deps import db
from utils.test_account_filter import mongo_test_account_filter


# Resend free-tier cap (per day).  Hard-coded — if the team moves
# to a paid plan, flip this constant + the card warning band updates
# automatically.
DAILY_CAP = 100


async def _past_counts(window_days: int) -> Dict[str, Any]:
    """Group ``email_logs`` by kind + status for the given window.

    2026-06-27 — ``total`` now reflects ONLY ``status="ok"`` rows
    (real sends that actually consumed Resend's daily quota).
    Suppressed rows (test recipients, outbound-pause flag, per-user
    opt-outs) and error rows are tracked per-kind for diagnostics
    but excluded from the cap-budget number — they never hit
    Resend.  This keeps the auto-pause watchdog from triggering on
    a high suppression rate (e.g. a noisy preview env full of
    fixture welcome emails) when zero real quota is being burned.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    pipeline = [
        {"$match": {"sent_at": {"$gte": cutoff}}},
        {"$group": {
            "_id":     {"kind": "$kind", "status": "$status"},
            "n":       {"$sum": 1},
        }},
    ]
    by_kind: Dict[str, Dict[str, int]] = {}
    total_ok = 0
    total_all = 0
    async for r in db.email_logs.aggregate(pipeline):
        kind = (r["_id"].get("kind") or "unknown")
        status = (r["_id"].get("status") or "unknown")
        n = int(r.get("n", 0))
        slot = by_kind.setdefault(kind, {"ok": 0, "error": 0, "suppressed": 0, "other": 0, "total": 0})
        bucket = status if status in slot else "other"
        slot[bucket] += n
        slot["total"] += n
        total_all += n
        if status == "ok":
            total_ok += n
    return {
        "window_days": window_days,
        # `total` drives the cap-budget math (auto-pause watchdog,
        # `warning_level`, cliff ETA).  Only real Resend sends count.
        "total":         total_ok,
        # Diagnostic-only — operators may want to see the full
        # mailroom volume (including what was suppressed).
        "total_all":     total_all,
        "total_ok":      total_ok,
        "by_kind":       by_kind,
    }


async def _real_user_filter() -> Dict[str, Any]:
    """Mongo filter that includes only real (non-fixture) users with a
    deliverable email."""
    return {
        "email": {"$exists": True, "$ne": ""},
        "$nor":  mongo_test_account_filter()["$or"],
    }


async def _opt_in_counts() -> Dict[str, int]:
    """Distinct opt-in counts per channel — used to weight the
    forecast."""
    base = await _real_user_filter()
    counts: Dict[str, int] = {}
    counts["weekly_digest"] = await db.users.count_documents({
        **base, "digest.enabled": True,
    })
    counts["update_email"] = await db.users.count_documents({
        **base, "update_email.enabled": True,
    })
    counts["friends_finished"] = await db.users.count_documents({
        **base, "friends_finished.email_enabled": True,
    })
    counts["bookclub_digest"] = await db.users.count_documents({
        **base, "bookclub_digest.email_enabled": True,
    })
    counts["weekly_summary"] = await db.users.count_documents({
        **base, "weekly_summary.enabled": True,
    })
    counts["cover_sharers"] = len(await db.community_covers.distinct(
        "shared_by_user_id",
    ))
    # Admin-digest recipient count (1/week worth of one email each).
    counts["admin_real"] = await db.users.count_documents({
        **base, "is_admin": True,
    })
    return counts


def _weekly_projection(opt_in: Dict[str, int]) -> Dict[str, int]:
    """Per-channel weekly send projection.  The orchestrator's
    weekly_summary opt-in REPLACES the four kind-specific channels
    (digest, update, friends, bookclub), so we subtract that count
    from each — it's the user's responsibility on the backend to
    skip the kind-specific sends, but we mirror the same logic here
    so the forecast lines up with reality.
    """
    ws = int(opt_in.get("weekly_summary", 0))
    proj = {
        "weekly_digest":    max(0, int(opt_in.get("weekly_digest", 0)) - ws),
        # Update digest is ad-hoc after fic refresh batches — pencil
        # in ~0.5 sends/wk per opted-in user.  ``//2 + (n%2)`` so we
        # don't round single-user buckets to zero.
        "update_digest":    (max(0, int(opt_in.get("update_email", 0)) - ws) + 1) // 2,
        "friends_finished": max(0, int(opt_in.get("friends_finished", 0)) - ws),
        "bookclub_digest":  max(0, int(opt_in.get("bookclub_digest", 0)) - ws),
        "weekly_summary":   ws,
        "cover_weekly_recap": int(opt_in.get("cover_sharers", 0)),
        # Admin digest: one email per real admin per week.
        "admin_digest":     int(opt_in.get("admin_real", 0)),
    }
    proj["total"] = sum(v for v in proj.values() if isinstance(v, int))
    return proj


async def email_volume_forecast() -> Dict[str, Any]:
    """Build the full forecast payload for ``/admin/email-volume-forecast``."""
    past_7 = await _past_counts(7)
    past_30 = await _past_counts(30)
    opt_in = await _opt_in_counts()
    weekly = _weekly_projection(opt_in)
    weekly_total = weekly["total"]

    daily_avg_7d = past_7["total"] / 7 if past_7["total"] else 0.0
    forecast_daily_avg = weekly_total / 7 if weekly_total else 0.0
    daily_pct = (forecast_daily_avg / DAILY_CAP * 100.0) if DAILY_CAP else 0.0

    # Cliff ETA — at current 7d run rate, how many days until we cross
    # the 100/day cap?  If we're already over, return 0.  If we're not
    # trending up, return None ("clear runway").
    if daily_avg_7d >= DAILY_CAP:
        cliff_eta_days = 0
    elif daily_avg_7d <= 0:
        cliff_eta_days = None
    else:
        # Crude linear projection: assume past 7d / past 30d slope
        # holds.  If 30d avg < 7d avg by >10%, treat as rising and
        # extrapolate.  Otherwise None.
        avg30 = past_30["total"] / 30 if past_30["total"] else 0.0
        if avg30 > 0 and daily_avg_7d > avg30 * 1.1:
            slope_per_day = (daily_avg_7d - avg30) / 7  # avg gained per day
            if slope_per_day > 0:
                remaining = DAILY_CAP - daily_avg_7d
                cliff_eta_days = int(remaining / slope_per_day) if remaining > 0 else 0
            else:
                cliff_eta_days = None
        else:
            cliff_eta_days = None

    return {
        "daily_cap":              DAILY_CAP,
        "past_7d":                past_7,
        "past_30d":               past_30,
        "opt_in_counts":          opt_in,
        "forecast_weekly":        weekly,
        "forecast_7d_total":      weekly_total,
        "forecast_30d_total":     int(round(weekly_total * 30.0 / 7.0)),
        "daily_avg_7d":           round(daily_avg_7d, 2),
        "forecast_daily_avg":     round(forecast_daily_avg, 2),
        "forecast_daily_pct":     round(daily_pct, 1),
        "cliff_eta_days":         cliff_eta_days,
        "warning_level": (
            "critical" if daily_avg_7d >= DAILY_CAP or forecast_daily_avg >= DAILY_CAP
            else "warning" if forecast_daily_avg >= 0.7 * DAILY_CAP
            else "ok"
        ),
        "generated_at":           datetime.now(timezone.utc).isoformat(),
    }
