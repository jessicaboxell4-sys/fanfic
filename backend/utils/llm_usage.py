"""LLM call instrumentation + key-health rollup (2026-06-22).

The user has no programmatic way to read the Universal LLM Key
balance from Emergent — Profile UI only.  So we self-instrument
every Claude (`classifier.py`) and Nano-Banana (`cover_gen.py`)
call into a tiny ``llm_usage`` collection, then surface a
``/api/admin/llm-key-health`` rollup that the operator can read
at a glance.

Cost estimates are *approximations*; Emergent doesn't disclose
their per-token markup, so we use the underlying provider list
prices.  The point isn't to match the Emergent invoice — it's to
give the operator a directional days-of-runway number so they
top up *before* a silent failure cliff.

Two data sources feed the card:

1. **Instrumented**: the new ``llm_usage`` collection — every call
   logged from this point forward.  100% accurate-shape data,
   but historical depth = zero on day one.
2. **Proxy**: pre-existing fields on ``books`` (``classifier='ai'``,
   ``cover_source='ai_generated'``) — gives instant historical
   estimates even before the instrumentation has accrued any
   rows.  Wider error bars but available immediately.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from deps import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pricing constants (USD).  Updated 2026-06-22 from each provider's public
# pricing page.  These are list prices — Emergent's actual markup may differ,
# so treat all dollar figures on the card as *estimates*, not invoices.
# ---------------------------------------------------------------------------
_CLAUDE_IN_PER_TOKEN  = 3.0  / 1_000_000   # $3 per 1M input tokens
_CLAUDE_OUT_PER_TOKEN = 15.0 / 1_000_000   # $15 per 1M output tokens
_NANO_BANANA_PER_IMAGE = 0.039             # ~$0.039 per image

# Per-call fallback used by the proxy estimator when we have no token-level
# data (i.e. all historical rows from before instrumentation existed).
_AVG_CLASSIFY_COST = 0.005    # ~1.5k in + 200 out tokens
_AVG_COVER_COST    = _NANO_BANANA_PER_IMAGE

# Cap the collection so we never grow unbounded — at ~150 calls/week
# that's ~5 years of history.
_LLM_USAGE_HARD_CAP = 50_000


def _est_tokens_from_text(text: Optional[str]) -> int:
    """Quick approximation — 4 chars per token is the rule of thumb
    for English in both Claude and Gemini.  Off by ~20% for non-Latin
    scripts; fine for a runway estimate."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def estimate_cost_usd(
    model: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    images: int = 0,
) -> float:
    """Convert token + image counts into an estimated USD cost.

    Model name is matched loosely so future revisions (e.g.
    ``claude-sonnet-4-7``) still fall through to the Claude
    pricing curve."""
    m = (model or "").lower()
    if "claude" in m:
        return tokens_in * _CLAUDE_IN_PER_TOKEN + tokens_out * _CLAUDE_OUT_PER_TOKEN
    if "gemini" in m or "banana" in m or "nano" in m:
        return images * _NANO_BANANA_PER_IMAGE
    # Unknown model — return zero rather than guessing.  The card's
    # ``by_kind`` table will still surface the call count.
    return 0.0


async def log_llm_call(
    kind: str,
    model: str,
    *,
    tokens_in: int = 0,
    tokens_out: int = 0,
    images: int = 0,
    status: str = "ok",
    error: Optional[str] = None,
    prompt_text: Optional[str] = None,
    response_text: Optional[str] = None,
) -> None:
    """Write one row to ``llm_usage``.

    Never raises — instrumentation must not break the calling
    feature if Mongo blips.  ``kind`` is a short slug
    (``classify`` / ``cover``); ``model`` is the wire-level model
    name (``claude-sonnet-4-6`` / ``gemini-3.1-flash-image-preview``).
    If token counts are zero but ``prompt_text`` / ``response_text``
    are passed, we estimate from string length so the cost rollup
    is still meaningful.
    """
    try:
        if tokens_in == 0 and prompt_text:
            tokens_in = _est_tokens_from_text(prompt_text)
        if tokens_out == 0 and response_text:
            tokens_out = _est_tokens_from_text(response_text)
        cost = estimate_cost_usd(model, tokens_in=tokens_in, tokens_out=tokens_out, images=images)
        await db.llm_usage.insert_one({
            "kind":       kind,
            "model":      model,
            "tokens_in":  int(tokens_in),
            "tokens_out": int(tokens_out),
            "images":     int(images),
            "cost_usd":   float(cost),
            "status":     status,
            "error":      (error or "")[:300] if error else None,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:  # noqa: BLE001 — instrumentation must not throw
        logger.warning("log_llm_call failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Rollup for the admin card
# ---------------------------------------------------------------------------
async def _instrumented_rollup(window_days: int) -> Dict[str, Any]:
    """Aggregate the ``llm_usage`` collection over the last N days."""
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    pipe = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id":        {"kind": "$kind", "status": "$status"},
            "calls":      {"$sum": 1},
            "tokens_in":  {"$sum": "$tokens_in"},
            "tokens_out": {"$sum": "$tokens_out"},
            "images":     {"$sum": "$images"},
            "cost_usd":   {"$sum": "$cost_usd"},
        }},
    ]
    rows = await db.llm_usage.aggregate(pipe).to_list(length=200)
    by_kind: Dict[str, Dict[str, Any]] = {}
    totals = {"calls": 0, "cost_usd": 0.0, "tokens_in": 0, "tokens_out": 0, "images": 0, "errors": 0}
    for r in rows:
        kind   = r["_id"]["kind"]
        status = r["_id"]["status"]
        slot = by_kind.setdefault(kind, {"calls": 0, "cost_usd": 0.0, "tokens_in": 0, "tokens_out": 0, "images": 0, "errors": 0})
        slot["calls"]      += r["calls"]
        slot["cost_usd"]   += r["cost_usd"] or 0.0
        slot["tokens_in"]  += r["tokens_in"] or 0
        slot["tokens_out"] += r["tokens_out"] or 0
        slot["images"]     += r["images"] or 0
        if status != "ok":
            slot["errors"] += r["calls"]
        totals["calls"]      += r["calls"]
        totals["cost_usd"]   += r["cost_usd"] or 0.0
        totals["tokens_in"]  += r["tokens_in"] or 0
        totals["tokens_out"] += r["tokens_out"] or 0
        totals["images"]     += r["images"] or 0
        if status != "ok":
            totals["errors"] += r["calls"]
    return {
        "window_days": window_days,
        "totals":      totals,
        "by_kind":     [{"kind": k, **v} for k, v in sorted(by_kind.items())],
    }


async def _proxy_rollup(window_days: int) -> Dict[str, Any]:
    """Count AI-classified books + AI-generated covers in the window."""
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    classifies = await db.books.count_documents({
        "classifier": "ai",
        "created_at": {"$gte": since},
    })
    covers = await db.books.count_documents({
        "cover_source":       "ai_generated",
        "cover_generated_at": {"$gte": since.isoformat()},
    })
    cost = classifies * _AVG_CLASSIFY_COST + covers * _AVG_COVER_COST
    return {
        "window_days":         window_days,
        "classifies":          classifies,
        "covers":              covers,
        "cost_usd_estimate":   round(cost, 4),
    }


async def get_known_balance() -> Dict[str, Any]:
    """Read the operator-typed-in balance from ``app_config``."""
    doc = await db.app_config.find_one({"_id": "llm_key_balance"}) or {}
    return {
        "usd":        float(doc.get("usd", 0.0)),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
        "set":        bool(doc.get("usd", 0) and doc.get("updated_at")),
    }


async def set_known_balance(usd: float, who: str) -> Dict[str, Any]:
    """Persist the operator-supplied balance."""
    if usd < 0:
        raise ValueError("balance must be non-negative")
    now = datetime.now(timezone.utc).isoformat()
    await db.app_config.update_one(
        {"_id": "llm_key_balance"},
        {"$set": {"usd": float(usd), "updated_at": now, "updated_by": who}},
        upsert=True,
    )
    return await get_known_balance()


def _warning_level(days_runway: Optional[float]) -> str:
    """Map runway → traffic-light state used by the admin card."""
    if days_runway is None:
        return "unknown"
    if days_runway < 7:
        return "critical"
    if days_runway < 14:
        return "warning"
    return "ok"


async def get_llm_key_health() -> Dict[str, Any]:
    """Full payload for ``GET /api/admin/llm-key-health``."""
    instr_7,  instr_30 = await _instrumented_rollup(7),  await _instrumented_rollup(30)
    proxy_7,  proxy_30 = await _proxy_rollup(7),         await _proxy_rollup(30)
    balance = await get_known_balance()

    # Pick the higher of (instrumented 7d cost) and (proxy 7d cost estimate)
    # so the runway calculator is conservative — i.e. assumes the *more*
    # expensive of the two evidence sources is the real burn.
    daily_avg_7d = max(
        instr_7["totals"]["cost_usd"] / 7.0,
        proxy_7["cost_usd_estimate"] / 7.0,
    )
    days_runway = None
    if balance["set"] and daily_avg_7d > 0:
        days_runway = balance["usd"] / daily_avg_7d

    return {
        "instrumented": {
            "last_7_days":  instr_7,
            "last_30_days": instr_30,
        },
        "proxy": {
            "last_7_days":  proxy_7,
            "last_30_days": proxy_30,
        },
        "balance": balance,
        "runway": {
            "daily_avg_usd": round(daily_avg_7d, 4),
            "days_remaining": round(days_runway, 1) if days_runway is not None else None,
            "warning_level":  _warning_level(days_runway),
        },
        "pricing_constants": {
            "claude_in_per_million":   _CLAUDE_IN_PER_TOKEN * 1_000_000,
            "claude_out_per_million":  _CLAUDE_OUT_PER_TOKEN * 1_000_000,
            "nano_banana_per_image":   _NANO_BANANA_PER_IMAGE,
            "proxy_classify_per_call": _AVG_CLASSIFY_COST,
            "proxy_cover_per_call":    _AVG_COVER_COST,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Janitor — called from the existing cron framework if the collection ever
# exceeds the soft cap.  Not wired by default; surfaced for the operator.
# ---------------------------------------------------------------------------
async def trim_old_usage(keep_n: int = _LLM_USAGE_HARD_CAP) -> int:
    """Drop the oldest rows once we cross the cap."""
    total = await db.llm_usage.count_documents({})
    if total <= keep_n:
        return 0
    drop = total - keep_n
    cursor = db.llm_usage.find({}, {"_id": 1}).sort("created_at", 1).limit(drop)
    ids: List[Any] = [doc["_id"] async for doc in cursor]
    if not ids:
        return 0
    res = await db.llm_usage.delete_many({"_id": {"$in": ids}})
    return res.deleted_count
