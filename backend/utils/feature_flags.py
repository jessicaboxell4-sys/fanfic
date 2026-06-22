"""Feature flags — runtime kill switches.

Stored in Mongo collection `feature_flags` as a SINGLE document with
`_id="singleton"`. Each known flag has a default of `True` (= enabled).
Reads are cached in-process for FLAG_TTL_SEC seconds so per-request
overhead is negligible. Admin writes invalidate the cache.

Adding a new flag: append to `KNOWN_FLAGS` below, then check it at the
relevant call site with `await is_enabled("my_flag")`.
"""
import time
from typing import Dict

from deps import db, logger

# Every flag known to the codebase. Frontend renders one toggle per entry.
# Add new flags here when you want a new kill switch.
KNOWN_FLAGS: Dict[str, str] = {
    "uploads_enabled":      "Allow new book uploads (drag-drop + paste)",
    "ai_classify_enabled":  "Use Claude to classify books when metadata is ambiguous",
    "fichub_enabled":       "Fetch fic metadata + chapters via FicHub / FanFicFare",
    "calibre_convert_enabled": "Auto-convert PDF / MOBI / DOCX uploads via Calibre",
    "send_to_kindle_enabled": "Allow users to email an EPUB to their Amazon Kindle inbox. Each send burns 1 Resend daily-quota slot — keep OFF on the free tier unless the operator has budgeted for it.",
    "cron_failure_alerts":  "Email all admins when a scheduled job fails (debounced, 60 min/job)",
    "cron_alerts_weekly_batch": "Roll cron-failure alerts into a single weekly digest email (Sundays 09:00 UTC) instead of paging immediately — Resend quota brake",
    "outbound_emails_enabled": "Send real emails via Resend (turn OFF to suppress all outbound and queue in-app notifications instead — Resend quota brake)",
}

DEFAULT_FLAGS: Dict[str, bool] = {k: True for k in KNOWN_FLAGS}
# 2026-06-22 — keep Send-to-Kindle OFF on first boot.  Every send burns
# a Resend daily-quota slot, so we don't want a fresh install to expose
# the orange "Send to Kindle" button until the operator deliberately
# turns it on from /admin → Feature flags.
DEFAULT_FLAGS["send_to_kindle_enabled"] = False

_cache: Dict[str, bool] = {}
_cache_ts: float = 0.0
FLAG_TTL_SEC = 5.0


async def get_flags() -> Dict[str, bool]:
    """Return the effective flag map (defaults overlaid with stored values).

    Cached for FLAG_TTL_SEC to keep request overhead negligible. Unknown
    keys in the stored doc are ignored.
    """
    global _cache, _cache_ts
    now = time.monotonic()
    if _cache and now - _cache_ts < FLAG_TTL_SEC:
        return dict(_cache)
    try:
        doc = await db.feature_flags.find_one({"_id": "singleton"}) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning("feature_flags read failed: %s", e)
        doc = {}
    effective = dict(DEFAULT_FLAGS)
    for k in KNOWN_FLAGS:
        if k in doc and isinstance(doc[k], bool):
            effective[k] = doc[k]
    _cache = effective
    _cache_ts = now
    return dict(effective)


async def is_enabled(flag: str) -> bool:
    """True if `flag` is on. Unknown flags default to True (fail-open)."""
    if flag not in KNOWN_FLAGS:
        return True
    flags = await get_flags()
    return flags.get(flag, True)


async def set_flag(flag: str, value: bool) -> Dict[str, bool]:
    """Persist a single flag and return the new effective map. Unknown
    flags raise KeyError so we don't accumulate typos in the DB."""
    if flag not in KNOWN_FLAGS:
        raise KeyError(f"Unknown feature flag: {flag}")
    await db.feature_flags.update_one(
        {"_id": "singleton"},
        {"$set": {flag: bool(value)}},
        upsert=True,
    )
    _invalidate_cache()
    return await get_flags()


def _invalidate_cache() -> None:
    global _cache, _cache_ts
    _cache = {}
    _cache_ts = 0.0
