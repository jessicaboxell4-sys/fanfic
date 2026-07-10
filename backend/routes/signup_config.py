"""Sign-up configuration: approval-gate toggle, onboarding questions
toggle, community rules markdown, and onboarding-answer aggregation.

State lives in a single ``app_config`` document with ``_id='signup'``.
Defaults match the pre-existing behavior so an empty config doc still
behaves like the old "everyone-pending" gate.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from deps import api_router, db
from models import User
from auth_dep import require_admin


DEFAULT_RULES_MD = """\
# Shelfsort Community Rules

Shelfsort is a quiet corner of the internet for people who love books.
To keep it that way, every account holder agrees to the following.

## 1. No spam
Don't post, share, or upload content for the purpose of promoting
unrelated products, services, schemes, or off-platform self-promotion.

## 2. No politics
This is a reading space — keep partisan politics, election content,
and ideological campaigning off the platform.

## 3. No hate speech or bullying
Targeting another user, an author, or a community based on race,
ethnicity, nationality, religion, gender identity, sexual orientation,
disability, or any other protected characteristic is not tolerated.
Personal attacks, harassment, and pile-ons will end the account.

## 4. No piracy promotion
Don't share download links to unauthorized copies of copyrighted books,
or instructions to obtain them. Shelfsort is for organizing books you
already own (or works freely shared by their authors, like fanfiction).

## 5. Respect intellectual property
Authors retain rights to their work. Don't repost full chapters, plot
summaries that substitute for the work, or AI-generated derivatives
that misrepresent the original.

## 6. Be kind
The default tone here is "what one reader would say to another." Curiosity,
recommendations, gentle disagreement, and shared favorites — yes. Snark
at someone's taste — no.

Breaking these rules can lead to a warning, a temporary suspension, or a
permanent ban depending on severity. The admin team reviews reports;
appeals can be sent via the Help-page feedback form.
"""


# Defaults preserve current behavior: approval gate ON, no questions yet,
# default rules visible.
DEFAULT_CONFIG: Dict[str, Any] = {
    "approval_gate_enabled":  True,
    "questions_enabled":      False,
    "rules_md":               DEFAULT_RULES_MD,
    "updated_at":             None,
    "updated_by":             None,
}


async def _get_config() -> Dict[str, Any]:
    """Read the signup config doc, fall back to defaults for missing keys."""
    doc = await db.app_config.find_one({"_id": "signup"}) or {}
    out = dict(DEFAULT_CONFIG)
    for k in ("approval_gate_enabled", "questions_enabled", "rules_md", "updated_at", "updated_by"):
        if k in doc:
            out[k] = doc[k]
    return out


# ---------------------------------------------------------------------------
# Public endpoints — needed by the register form + a public /rules page.
# ---------------------------------------------------------------------------
@api_router.get("/signup/config")
async def public_signup_config():
    """Tells the Login/Register screen which fields to show.  Does NOT
    leak the rules markdown by default (separate /rules endpoint)."""
    cfg = await _get_config()
    return {
        "approval_gate_enabled": bool(cfg["approval_gate_enabled"]),
        "questions_enabled":     bool(cfg["questions_enabled"]),
    }


@api_router.get("/rules")
async def public_rules():
    """Public community-rules markdown.  Linked from the register form
    and from the standalone ``/rules`` page."""
    cfg = await _get_config()
    return {"rules_md": cfg["rules_md"]}


# ---------------------------------------------------------------------------
# Admin endpoints — read full config, update fields, view onboarding stats.
# ---------------------------------------------------------------------------
class SignupConfigPatch(BaseModel):
    approval_gate_enabled: Optional[bool] = None
    questions_enabled:     Optional[bool] = None
    rules_md:              Optional[str]  = None


@api_router.get("/admin/signup-config")
async def admin_get_signup_config(_admin: User = Depends(require_admin)):
    return await _get_config()


@api_router.put("/admin/signup-config")
async def admin_update_signup_config(
    body: SignupConfigPatch,
    admin: User = Depends(require_admin),
):
    patch: Dict[str, Any] = {}
    if body.approval_gate_enabled is not None:
        patch["approval_gate_enabled"] = bool(body.approval_gate_enabled)
    if body.questions_enabled is not None:
        patch["questions_enabled"] = bool(body.questions_enabled)
    if body.rules_md is not None:
        # Light validation — empty rules would render an empty page.
        rules = body.rules_md.strip()
        if len(rules) < 20:
            raise HTTPException(status_code=400, detail="rules_md is too short")
        if len(rules) > 50_000:
            raise HTTPException(status_code=413, detail="rules_md is too long")
        patch["rules_md"] = rules
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    patch["updated_by"] = admin.user_id
    await db.app_config.update_one(
        {"_id": "signup"}, {"$set": patch}, upsert=True,
    )
    return await _get_config()


@api_router.get("/admin/onboarding-stats")
async def admin_onboarding_stats(_admin: User = Depends(require_admin)):
    """Aggregate the user.onboarding answers so admins can see the
    referral + reader-type mix at a glance."""
    pipeline_referral = [
        {"$match": {"onboarding.referral": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$onboarding.referral", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    pipeline_reader = [
        {"$match": {"onboarding.reader_type": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$onboarding.reader_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    pipeline_age = [
        {"$match": {"onboarding.is_13_plus": {"$exists": True}}},
        {"$group": {"_id": "$onboarding.is_13_plus", "count": {"$sum": 1}}},
    ]

    referral: List[Dict[str, Any]] = []
    async for r in db.users.aggregate(pipeline_referral):
        referral.append({"label": r["_id"] or "(blank)", "count": r["count"]})

    reader_type: List[Dict[str, Any]] = []
    async for r in db.users.aggregate(pipeline_reader):
        reader_type.append({"label": r["_id"] or "(blank)", "count": r["count"]})

    age_under_13 = 0
    age_13_plus  = 0
    async for r in db.users.aggregate(pipeline_age):
        if r["_id"] is True:
            age_13_plus = r["count"]
        elif r["_id"] is False:
            age_under_13 = r["count"]

    # Most-popular favorite fandoms (free-text — top 15 after light cleanup).
    pipeline_fandom = [
        {"$match": {"onboarding.favorite_fandom": {"$exists": True, "$ne": ""}}},
        {"$group": {"_id": {"$toLower": "$onboarding.favorite_fandom"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 15},
    ]
    favorite_fandoms: List[Dict[str, Any]] = []
    async for r in db.users.aggregate(pipeline_fandom):
        favorite_fandoms.append({"label": r["_id"] or "(blank)", "count": r["count"]})

    total_with_onboarding = await db.users.count_documents({"onboarding": {"$exists": True}})

    return {
        "total_with_onboarding": total_with_onboarding,
        "referral":              referral,
        "reader_type":           reader_type,
        "favorite_fandoms":      favorite_fandoms,
        "age_13_plus":           age_13_plus,
        "age_under_13":          age_under_13,
    }


__all__ = ["_get_config"]
