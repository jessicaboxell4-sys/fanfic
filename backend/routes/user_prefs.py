"""User preference routes — FanFicFare options, duplicate-handling policy,
per-format upload prefs, dashboard layout, onboarding banner, and manual
fandom aliases.

Extracted from ``routes.books`` on 2026-06-13 (Phase 3b). All routes here
operate on a single document in ``db.users`` — they don't touch books on
disk except for the two onboarding sweeps (``/user/apply-template-to-all``
and ``/user/tidy-filenames``) which call helpers that still live in
``routes.books`` (``apply_template_to_epub``, ``_templated_filename``).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from auth_dep import get_current_user
from deps import api_router, db, STORAGE_DIR
from models import User


# ============================================================
# FANFICFARE USER OPTIONS
# ============================================================
class FFFOptionsBody(BaseModel):
    include_author_notes: Optional[bool] = None
    include_images: Optional[bool] = None
    keep_chapter_links: Optional[bool] = None
    apply_template: Optional[bool] = None
    # When True, falls back to fichub.net if FanFicFare fails for any
    # reason on a given URL. FicHub is a hosted scraping service so it
    # often works when our server's IP gets rate-limited by AO3/FFnet.
    # Off by default — opt-in per user. (Added 2026-06-07.)
    try_fichub_fallback: Optional[bool] = None


FFF_OPTION_DEFAULTS = {
    "include_author_notes": True,
    "include_images": True,
    "keep_chapter_links": False,
    "apply_template": True,
    "try_fichub_fallback": False,
}


@api_router.get("/user/fff-options")
async def get_fff_options(user: User = Depends(get_current_user)):
    """Return the user's FanFicFare options for fanfiction downloads."""
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1})
    stored = (user_doc or {}).get("fff_options") or {}
    return {**FFF_OPTION_DEFAULTS, **stored}


@api_router.put("/user/fff-options")
async def update_fff_options(body: FFFOptionsBody, user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "fff_options": 1})
    stored = (user_doc or {}).get("fff_options") or {}
    patch = body.dict(exclude_none=True)
    stored.update(patch)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"fff_options": stored}},
    )
    return {**FFF_OPTION_DEFAULTS, **stored}


# Dashboard "At a glance" folder — user-orderable section list.
DASHBOARD_SECTIONS = ("continue", "stats", "shelves")
DASHBOARD_DEFAULT_ORDER = list(DASHBOARD_SECTIONS)


# Default duplicate-handling policy. "ask" = show the modal (current behavior);
# the rest run silently after upload, matching the resolve-duplicate actions.
DUPE_POLICIES = ("ask", "keep_both", "discard", "new_version", "historical")
DUPE_POLICY_DEFAULT = "ask"


class DuplicatePolicyBody(BaseModel):
    policy: str


@api_router.get("/user/duplicate-policy")
async def get_duplicate_policy(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "duplicate_policy": 1})
    return {"policy": (user_doc or {}).get("duplicate_policy") or DUPE_POLICY_DEFAULT}


@api_router.put("/user/duplicate-policy")
async def update_duplicate_policy(body: DuplicatePolicyBody, user: User = Depends(get_current_user)):
    if body.policy not in DUPE_POLICIES:
        raise HTTPException(status_code=400, detail=f"policy must be one of {list(DUPE_POLICIES)}")
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"duplicate_policy": body.policy}},
    )
    return {"policy": body.policy}


# Per-format upload preferences for non-EPUB files. Each format group can be
# "ask" (default — show the per-upload Convert/Keep/Skip prompt) or "skip"
# (silently drop without uploading). We intentionally do NOT expose a
# silent auto-convert option: the user should always decide whether to run
# a Calibre conversion. Silent conversion was removed 2026-06-06.
FORMAT_GROUPS = ("pdf", "kindle", "word", "other_ebook", "txt", "html")
FORMAT_ACTIONS = ("ask", "skip")
FORMAT_PREFS_DEFAULT = {g: "ask" for g in FORMAT_GROUPS}


def _coerce_format_prefs(stored: Dict[str, Any]) -> Dict[str, str]:
    """Read-side migration. Any legacy ``"convert"`` (auto-add) value is
    coerced back to ``"ask"`` so the user is never silently auto-converted
    even if their stored prefs still have the old value."""
    out: Dict[str, str] = {}
    for k, v in (stored or {}).items():
        if k not in FORMAT_GROUPS:
            continue
        if v == "convert":
            out[k] = "ask"
        elif v in FORMAT_ACTIONS:
            out[k] = v
    return out


class FormatPrefsBody(BaseModel):
    # Partial patch — only keys actually present are updated.
    pdf: Optional[str] = None
    kindle: Optional[str] = None
    word: Optional[str] = None
    other_ebook: Optional[str] = None
    txt: Optional[str] = None
    html: Optional[str] = None


@api_router.get("/user/format-prefs")
async def get_format_prefs(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "format_prefs": 1})
    stored = (user_doc or {}).get("format_prefs") or {}
    return {**FORMAT_PREFS_DEFAULT, **_coerce_format_prefs(stored)}


@api_router.put("/user/format-prefs")
async def update_format_prefs(body: FormatPrefsBody, user: User = Depends(get_current_user)):
    patch = body.dict(exclude_none=True)
    for k, v in patch.items():
        if v not in FORMAT_ACTIONS:
            raise HTTPException(status_code=400, detail=f"{k} must be one of {list(FORMAT_ACTIONS)}")
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "format_prefs": 1})
    stored = _coerce_format_prefs((user_doc or {}).get("format_prefs") or {})
    stored.update(patch)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"format_prefs": stored}},
    )
    return {**FORMAT_PREFS_DEFAULT, **stored}


class DashboardLayoutBody(BaseModel):
    order: List[str]
    hidden: Optional[List[str]] = None


@api_router.get("/user/dashboard-layout")
async def get_dashboard_layout(user: User = Depends(get_current_user)):
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "dashboard_layout": 1})
    stored = (user_doc or {}).get("dashboard_layout") or {}
    order = stored.get("order") or DASHBOARD_DEFAULT_ORDER
    hidden = stored.get("hidden") or []
    # Drop unknown keys, pad with any missing defaults so the UI is never empty
    seen: set = set()
    cleaned: List[str] = []
    for k in order:
        if k in DASHBOARD_SECTIONS and k not in seen:
            seen.add(k)
            cleaned.append(k)
    for k in DASHBOARD_DEFAULT_ORDER:
        if k not in seen:
            cleaned.append(k)
            seen.add(k)
    cleaned_hidden = [k for k in hidden if k in DASHBOARD_SECTIONS]
    return {"order": cleaned, "hidden": cleaned_hidden}


@api_router.put("/user/dashboard-layout")
async def update_dashboard_layout(body: DashboardLayoutBody, user: User = Depends(get_current_user)):
    # Validate: every item must be a known section, no duplicates
    seen: set = set()
    cleaned: List[str] = []
    for k in body.order:
        if k not in DASHBOARD_SECTIONS:
            raise HTTPException(status_code=400, detail=f"Unknown section '{k}'")
        if k in seen:
            raise HTTPException(status_code=400, detail=f"Section '{k}' appears more than once")
        seen.add(k)
        cleaned.append(k)
    # Pad missing sections at the end so the order is always complete
    for k in DASHBOARD_DEFAULT_ORDER:
        if k not in seen:
            cleaned.append(k)
            seen.add(k)
    cleaned_hidden: List[str] = []
    if body.hidden is not None:
        for k in body.hidden:
            if k not in DASHBOARD_SECTIONS:
                raise HTTPException(status_code=400, detail=f"Unknown hidden section '{k}'")
            if k not in cleaned_hidden:
                cleaned_hidden.append(k)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"dashboard_layout": {"order": cleaned, "hidden": cleaned_hidden}}},
    )
    return {"order": cleaned, "hidden": cleaned_hidden}


# ============================================================
# Template + tidy-filenames sweeps (used by onboarding banner)
# ============================================================
async def _run_template_sweep(user_id: str) -> Dict[str, int]:
    """Re-apply the Shelfsort EPUB template to every book on disk.
    Returns a per-outcome summary. Idempotent — already-templated files
    are detected via a marker in ``content.opf`` and skipped."""
    from routes.books import apply_template_to_epub  # late import — avoids cycle

    summary = {"processed": 0, "templated": 0, "already_templated": 0, "errors": 0, "skipped": 0}
    user_dir = STORAGE_DIR / user_id
    if not user_dir.exists():
        return {**summary, "total_in_library": 0}

    books = await db.books.find(
        {"user_id": user_id},
        {
            "_id": 0, "book_id": 1, "title": 1, "author": 1, "description": 1,
            "source_url": 1, "source_meta": 1, "chapters": 1, "words": 1,
        },
    ).limit(1000).to_list(1000)

    loop = asyncio.get_event_loop()

    def _process_one(book: Dict[str, Any]) -> str:
        epub_path = user_dir / f"{book['book_id']}.epub"
        if not epub_path.exists():
            return "skipped"
        try:
            raw = epub_path.read_bytes()
        except Exception:
            return "error"
        meta: Dict[str, Any] = {
            "title": book.get("title") or "",
            "author": book.get("author") or "",
            "description": book.get("description") or "",
            "chapters": book.get("chapters") or 0,
            "rawExtendedMeta": (book.get("source_meta") or {}).get("rawExtendedMeta") or {},
        }
        new_bytes = apply_template_to_epub(raw, meta, book.get("source_url") or "")
        if new_bytes == raw:
            return "already_templated"
        try:
            epub_path.write_bytes(new_bytes)
            return "templated"
        except Exception:
            return "error"

    for book in books:
        outcome = await loop.run_in_executor(None, _process_one, book)
        summary["processed"] += 1
        if outcome in summary:
            summary[outcome] += 1
    summary["total_in_library"] = len(books)
    return summary


async def _run_tidy_filenames(user_id: str) -> Dict[str, int]:
    """Rename every book's ``filename`` field to the templated pattern
    ``Title_by_Author-<short_id>.epub``. DB-only, no on-disk changes —
    on-disk filenames stay as ``{book_id}.epub`` (an internal id)."""
    from routes.books import _templated_filename  # late import

    books = await db.books.find(
        {"user_id": user_id},
        {"_id": 0, "book_id": 1, "title": 1, "author": 1, "filename": 1},
    ).limit(5000).to_list(5000)
    updated = 0
    already_correct = 0
    for b in books:
        target = _templated_filename(b.get("title"), b.get("author"), b["book_id"])
        if (b.get("filename") or "") == target:
            already_correct += 1
            continue
        await db.books.update_one(
            {"book_id": b["book_id"], "user_id": user_id},
            {"$set": {"filename": target}},
        )
        updated += 1
    return {"updated": updated, "already_correct": already_correct, "total": len(books)}


@api_router.post("/user/apply-template-to-all")
async def apply_template_to_all(user: User = Depends(get_current_user)):
    """Run apply_template_to_epub over every EPUB the user has on disk.

    Idempotent — already-templated EPUBs are detected via the marker in
    content.opf and skipped without rewriting bytes. Returns a summary.

    Implementation note: we run synchronously inside a worker thread so the
    request blocks until done. For typical libraries (≤500 books) this is
    well under a minute. We hard-cap at 1000 books so an outlier library
    doesn't hang the API; the user can re-run to pick up the rest.
    """
    return await _run_template_sweep(user.user_id)


@api_router.post("/user/tidy-filenames")
async def tidy_filenames(user: User = Depends(get_current_user)):
    """Rename every book's stored ``filename`` field to the templated pattern:
       ``Title_by_Author-<short_id>.epub`` (matches the user's reference EPUB).

    On-disk filenames stay as ``{book_id}.epub`` (an internal id) — only the
    user-facing field changes. The single-book download endpoint and the ZIP
    export already build the templated name from book.title/author, so this is
    purely a cosmetic backfill for the BookDetail page's "File" line.
    """
    return await _run_tidy_filenames(user.user_id)


# ============================================================
# Onboarding prompt — asks first-time users if they want their
# library polished with the Shelfsort template + tidy filenames.
# ============================================================
class OnboardingDecisionBody(BaseModel):
    accept: bool


@api_router.get("/user/onboarding-status")
async def onboarding_status(user: User = Depends(get_current_user)):
    """Return whether the template-onboarding banner should be shown."""
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "template_prompt_dismissed": 1, "created_at": 1},
    ) or {}
    book_count = await db.books.count_documents({"user_id": user.user_id})
    return {
        "template_prompt_pending": (
            book_count >= 1
            and not bool(user_doc.get("template_prompt_dismissed"))
        ),
        "book_count": book_count,
    }


@api_router.post("/user/dismiss-template-prompt")
async def dismiss_template_prompt(
    body: OnboardingDecisionBody,
    user: User = Depends(get_current_user),
):
    """Persist the user's onboarding choice. When ``accept=true``, run both
    the template + tidy sweeps inline so the user sees the polished result
    on their very next page load."""
    # Mark dismissed regardless — we never want to ask twice
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "template_prompt_dismissed": True,
            "template_prompt_dismissed_at": datetime.now(timezone.utc).isoformat(),
            "template_prompt_accepted": bool(body.accept),
        }},
    )
    if not body.accept:
        return {"ok": True, "accepted": False}

    # Run both sweeps inline. Shares logic with the standalone endpoints.
    template_summary = await _run_template_sweep(user.user_id)
    tidy_summary = await _run_tidy_filenames(user.user_id)
    return {
        "ok": True,
        "accepted": True,
        "template": {
            "templated": template_summary.get("templated", 0),
            "already_templated": template_summary.get("already_templated", 0),
            "errors": template_summary.get("errors", 0),
            "skipped": template_summary.get("skipped", 0),
        },
        "filenames": {
            "updated": tidy_summary.get("updated", 0),
            "already_correct": tidy_summary.get("already_correct", 0),
        },
    }


# ============================================================
# MANUAL FANDOM ALIASES
# ============================================================
@api_router.get("/user/fandom-aliases")
async def get_fandom_aliases(user: User = Depends(get_current_user)):
    """Manual fandom aliases (e.g. ``{'HP': 'Harry Potter'}``). These are
    applied during canonicalization so books tagged with the abbreviation
    file alongside the full name."""
    udoc = await db.users.find_one(
        {"user_id": user.user_id}, {"_id": 0, "fandom_aliases": 1}
    ) or {}
    return {"aliases": udoc.get("fandom_aliases") or {}}


class FandomAliasBody(BaseModel):
    aliases: Dict[str, str]


@api_router.put("/user/fandom-aliases")
async def update_fandom_aliases(body: FandomAliasBody, user: User = Depends(get_current_user)):
    """Replace the user's alias map. Empty keys/values are dropped silently."""
    cleaned: Dict[str, str] = {}
    for k, v in (body.aliases or {}).items():
        ks = (k or "").strip()
        vs = (v or "").strip()
        if not ks or not vs or ks.lower() == vs.lower():
            continue
        cleaned[ks] = vs
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"fandom_aliases": cleaned}},
        upsert=True,
    )
    return {"aliases": cleaned}


# ============================================================
# PER-KIND EMAIL OPT-OUTS  (added 2026-06-20 alongside the
# email_suppression layer in utils/email_suppression.py).
#
# The suppression layer reads ``users.email_prefs`` to decide
# whether to short-circuit a given outbound email and queue it as
# an in-app notification instead.  These two endpoints power the
# /account/emails toggles.  Missing keys default to True (opted-in).
# ============================================================

# Mirror of USER_OPTABLE_KINDS in utils/email_suppression.py — keep
# in sync.  Items not in this list are always sent (e.g. security
# alerts), so we don't expose toggles for them.
_OPTABLE_EMAIL_KINDS = (
    "approval_approved",
    "approval_rejected",
    "suggestion_status",
    "year_in_books",
    "bookclub_invite",
    "recommendation_weekly",
    "fandom_overlap",
)


class EmailPrefsBody(BaseModel):
    # Each field is optional so the client can patch one at a time.
    approval_approved:     Optional[bool] = None
    approval_rejected:     Optional[bool] = None
    suggestion_status:     Optional[bool] = None
    year_in_books:         Optional[bool] = None
    bookclub_invite:       Optional[bool] = None
    recommendation_weekly: Optional[bool] = None
    fandom_overlap:        Optional[bool] = None


@api_router.get("/account/email-prefs")
async def get_email_prefs(user: User = Depends(get_current_user)):
    """Return the user's per-kind email opt-outs.  Defaults all to
    ``True`` (opted-in) for any key the user hasn't touched."""
    doc = await db.users.find_one(
        {"user_id": user.user_id}, {"email_prefs": 1, "_id": 0}
    ) or {}
    prefs = doc.get("email_prefs") or {}
    return {
        "prefs": {k: bool(prefs.get(k, True)) for k in _OPTABLE_EMAIL_KINDS},
        "optable_kinds": list(_OPTABLE_EMAIL_KINDS),
    }


@api_router.put("/account/email-prefs")
async def update_email_prefs(
    body: EmailPrefsBody, user: User = Depends(get_current_user)
):
    """Patch one or more per-kind opt-outs.  Each field is optional
    so the toggle UI can fire one PUT per checkbox flip without
    sending the full doc each time."""
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        return {"prefs": {}, "updated": 0}
    # Build a $set with the email_prefs.<kind> dotted-path so we don't
    # clobber other keys in the same sub-doc.
    set_doc = {f"email_prefs.{k}": bool(v) for k, v in patch.items()}
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": set_doc},
    )
    # Return the fresh full prefs object for the client to update state
    fresh = await db.users.find_one(
        {"user_id": user.user_id}, {"email_prefs": 1, "_id": 0}
    ) or {}
    prefs = fresh.get("email_prefs") or {}
    return {
        "prefs": {k: bool(prefs.get(k, True)) for k in _OPTABLE_EMAIL_KINDS},
        "updated": len(patch),
    }
