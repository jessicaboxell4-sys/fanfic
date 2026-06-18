"""Library backup + restore routes.

Extracted from ``routes.books`` on 2026-06-13 (Phase 3c). Contains:

* ``GET /api/library/backup`` — stream the full library as a ZIP
  (manifest + every EPUB still on disk).
* ``GET/POST /api/user/backup-reminder*`` — the gentle nudge that shows
  up after 30 days or 100+ new books since the last backup.
* ``GET /api/user/backup-history`` — last 50 backup runs.
* ``POST /api/library/restore/preview`` and ``POST /api/library/restore/apply``
  — preview + selective restore from a Shelfsort backup ZIP.

Self-contained: every helper used by these routes (``_parse_iso_to_aware``,
``_read_backup_manifest``) lives in this module. Only ``TRASH_SHELF`` is
imported from ``routes.trash`` to avoid duplicating the constant.
"""
from __future__ import annotations

import io as _io
import json as _json
import zipfile as _zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from stat import S_IFREG
from typing import Any, Dict, List, Optional

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from stream_zip import stream_zip, ZIP_64

from auth_dep import get_current_user
from deps import api_router, db, STORAGE_DIR
from models import User
from routes.trash import TRASH_SHELF


# ============================================================
# LIBRARY BACKUP — full export of EPUBs + metadata as a single ZIP
# ============================================================
@api_router.get("/library/backup")
async def export_library_backup(user: User = Depends(get_current_user)):
    """Stream a complete library backup as a single ZIP.

    Archive layout:
      backup-manifest.json   ← every book record + tags + smart shelves +
                               user prefs as JSON. ~2KB per book.
      epubs/<book_id>.epub   ← the actual file for every active book
                               that's still on disk.

    The streaming pattern matches /library/download-zip so first-byte
    latency stays low (~1s) even for 5000+ book libraries; nothing is
    buffered server-side. The output filename is namespaced with the
    current ISO date so multiple backups don't overwrite each other.

    Restore goes through the dedicated wizard endpoints below — they
    require conflict resolution (book_id collisions, missing categories,
    tag merges) which the user drives interactively. The manifest format
    is documented and stable so a future Shelfsort can read older ZIPs.
    """
    books = await db.books.find(
        {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
        {"_id": 0},
    ).to_list(50000)
    smart_shelves = await db.smart_shelves.find(
        {"user_id": user.user_id}, {"_id": 0},
    ).to_list(1000)
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "session_token": 0, "password_hash": 0},
    ) or {}

    iso_today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    manifest = {
        # schema_version 2 (2026-06-13): books now carry AO3 metadata
        # fields (``rating``, ``warnings``, ``categories``,
        # ``ao3_freeform_tags``). v1 restores still work — missing
        # fields default to None/[] on the restored doc.
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "user": user_doc,
        "books": books,
        "smart_shelves": smart_shelves,
        "stats": {
            "book_count": len(books),
            "smart_shelf_count": len(smart_shelves),
        },
    }
    # default=str so datetime / ObjectId etc. survive serialization.
    manifest_bytes = _json.dumps(manifest, default=str, indent=2).encode("utf-8")

    modified_at = datetime.now()
    mode = S_IFREG | 0o600
    user_dir = STORAGE_DIR / user.user_id

    def _file_chunks(path: Path):
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    return
                yield chunk

    def _bytes_chunks(data: bytes):
        yield data

    def _members():
        # 1) manifest first so a curl-aborted backup still has the index
        yield (
            "backup-manifest.json",
            modified_at,
            mode,
            ZIP_64,
            _bytes_chunks(manifest_bytes),
        )
        # 2) every EPUB still on disk. Skip missing files — better partial
        #    backup than a 500.
        for b in books:
            bid = b.get("book_id")
            if not bid:
                continue
            ext = (b.get("original_format") or "epub").lstrip(".")
            for candidate in (user_dir / f"{bid}.epub", user_dir / f"{bid}.{ext}"):
                if candidate.exists():
                    yield (
                        f"epubs/{candidate.name}",
                        modified_at,
                        mode,
                        ZIP_64,
                        _file_chunks(candidate),
                    )
                    break

    download_name = f"shelfsort-backup-{iso_today}.zip"

    # Record the successful start of the backup so the reminder banner
    # quiets down. We update BEFORE returning the StreamingResponse so
    # the "I just backed up" state persists even if the user closes the
    # tab before the stream finishes — they've at least started a backup.
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"last_backup_at": now_iso}},
    )
    # Append to the per-user backup history (capped at 50 most recent
    # entries by a trim-on-insert below) so the user can answer "did I
    # back up before <bad date>?" from the Account page. We only store
    # metadata — never the ZIP itself.
    await db.backup_history.insert_one({
        "user_id": user.user_id,
        "started_at": now_iso,
        "book_count": len(books),
        "smart_shelf_count": len(smart_shelves),
    })
    # Trim to the 50 most recent so this collection never grows unbounded.
    cutoff_doc = await db.backup_history.find(
        {"user_id": user.user_id}, {"_id": 1},
    ).sort("started_at", -1).skip(49).limit(1).to_list(1)
    if cutoff_doc:
        cutoff_id = cutoff_doc[0]["_id"]
        await db.backup_history.delete_many({
            "user_id": user.user_id,
            "_id": {"$lt": cutoff_id},
        })

    return StreamingResponse(
        stream_zip(_members()),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# ============================================================
# BACKUP REMINDER — gentle nudge so the backup feature actually gets used
# ============================================================
# Thresholds picked to be helpful without nagging — a power user who
# uploads daily sees the banner every ~3 months on the cadence trigger,
# or whenever they add 100+ new books between backups. The 14-day
# dismissal grace means clicking X buys two weeks of quiet.
_BACKUP_REMIND_AFTER_DAYS = 30
_BACKUP_REMIND_AFTER_NEW_BOOKS = 100
_BACKUP_DISMISS_GRACE_DAYS = 14

# Schema versions this Shelfsort understands when restoring. Bump this
# tuple whenever the manifest gains a non-additive change.
_RESTORE_SUPPORTED_SCHEMAS = (1, 2)


def _parse_iso_to_aware(s: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 string back to a tz-aware datetime; None if empty
    or malformed (so callers don't need a try/except around every read)."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


@api_router.get("/user/backup-reminder")
async def get_backup_reminder(user: User = Depends(get_current_user)):
    """Should we show the backup reminder banner right now?

    Returns ``{should_show, reason, book_count, books_since_backup,
    days_since_backup, last_backup_at, dismiss_active_until}``. Reasons:
      * ``never_backed_up`` — 100+ active books, no recorded backup.
      * ``cadence`` — 30+ days since the last backup.
      * ``new_books`` — 100+ books added since the last backup.

    Dismissal lasts 14 days regardless of trigger.
    """
    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "last_backup_at": 1, "last_backup_dismissed_at": 1},
    ) or {}

    now = datetime.now(timezone.utc)
    last_backup = _parse_iso_to_aware(user_doc.get("last_backup_at"))
    last_dismiss = _parse_iso_to_aware(user_doc.get("last_backup_dismissed_at"))

    book_count = await db.books.count_documents(
        {"user_id": user.user_id, "category": {"$ne": TRASH_SHELF}},
    )

    books_since_backup = book_count
    if last_backup:
        books_since_backup = await db.books.count_documents({
            "user_id": user.user_id,
            "category": {"$ne": TRASH_SHELF},
            "created_at": {"$gt": last_backup.isoformat()},
        })

    days_since_backup = None
    if last_backup:
        days_since_backup = (now - last_backup).days

    dismiss_active_until = None
    if last_dismiss:
        grace_end = last_dismiss + timedelta(days=_BACKUP_DISMISS_GRACE_DAYS)
        if grace_end > now:
            dismiss_active_until = grace_end.isoformat()

    should_show = False
    reason = None
    if dismiss_active_until is None:
        if last_backup is None and book_count >= _BACKUP_REMIND_AFTER_NEW_BOOKS:
            should_show, reason = True, "never_backed_up"
        elif days_since_backup is not None and days_since_backup >= _BACKUP_REMIND_AFTER_DAYS:
            should_show, reason = True, "cadence"
        elif books_since_backup >= _BACKUP_REMIND_AFTER_NEW_BOOKS:
            should_show, reason = True, "new_books"

    return {
        "should_show": should_show,
        "reason": reason,
        "book_count": book_count,
        "books_since_backup": books_since_backup,
        "days_since_backup": days_since_backup,
        "last_backup_at": (last_backup.isoformat() if last_backup else None),
        "dismiss_active_until": dismiss_active_until,
    }


@api_router.post("/user/backup-reminder/dismiss")
async def dismiss_backup_reminder(user: User = Depends(get_current_user)):
    """Quiet the banner for 14 days from now. Idempotent."""
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"last_backup_dismissed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@api_router.get("/user/backup-history")
async def get_backup_history(user: User = Depends(get_current_user)):
    """Return the user's last 50 backup runs (started_at + book/shelf
    counts), newest first."""
    cursor = db.backup_history.find(
        {"user_id": user.user_id},
        {"_id": 0, "user_id": 0},
    ).sort("started_at", -1).limit(50)
    rows = await cursor.to_list(50)
    return {"count": len(rows), "entries": rows}


# ============================================================
# RESTORE FROM BACKUP — preview + selective apply
# ============================================================
def _read_backup_manifest(file_bytes: bytes) -> Dict[str, Any]:
    """Parse a backup ZIP. Returns the manifest dict; raises HTTPException
    with a helpful message on every failure path."""
    try:
        zf = _zipfile.ZipFile(_io.BytesIO(file_bytes))
    except _zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="That file isn't a valid ZIP.")
    names = zf.namelist()
    if "backup-manifest.json" not in names:
        raise HTTPException(
            status_code=400,
            detail="This ZIP doesn't look like a Shelfsort backup — `backup-manifest.json` is missing.",
        )
    try:
        manifest = _json.loads(zf.read("backup-manifest.json").decode("utf-8"))
    except (UnicodeDecodeError, _json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Couldn't parse the manifest: {e}")
    if not isinstance(manifest, dict):
        raise HTTPException(status_code=400, detail="Manifest is malformed.")
    sv = manifest.get("schema_version")
    if sv not in _RESTORE_SUPPORTED_SCHEMAS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Backup schema version {sv} isn't supported by this Shelfsort. "
                f"Supported versions: {list(_RESTORE_SUPPORTED_SCHEMAS)}."
            ),
        )
    return manifest


@api_router.post("/library/restore/preview")
async def restore_preview(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Inspect a backup ZIP without writing anything. Returns the books +
    smart shelves the ZIP contains and flags any book_ids already in
    the user's library so the wizard can default them to OFF."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")
    # Antivirus pre-scan — backup ZIPs are user-supplied like any other
    # upload (2026-06-18).
    from utils.antivirus import scan_bytes, record_quarantine
    import asyncio as _asyncio
    _av = await _asyncio.to_thread(scan_bytes, content, hint_name=file.filename or "backup.zip")
    if _av.get("infected"):
        await record_quarantine(
            user_id=user.user_id,
            filename=file.filename or "",
            scan=_av,
            source="upload",
            extra={"endpoint": "restore/preview", "size_bytes": len(content)},
        )
        raise HTTPException(
            status_code=400,
            detail=f"That backup file appears unsafe ({_av.get('signature') or 'flagged by antivirus'}). Restore blocked.",
        )
    manifest = _read_backup_manifest(content)

    books = manifest.get("books") or []
    shelves = manifest.get("smart_shelves") or []
    existing_ids = {
        b["book_id"]
        async for b in db.books.find(
            {"user_id": user.user_id}, {"_id": 0, "book_id": 1},
        )
        if b.get("book_id")
    }
    existing_shelf_names = {
        s["name"]
        async for s in db.smart_shelves.find(
            {"user_id": user.user_id}, {"_id": 0, "name": 1},
        )
        if s.get("name")
    }

    preview_books = [
        {
            "book_id": b.get("book_id"),
            "title": b.get("title") or "Untitled",
            "author": b.get("author") or "Unknown",
            "category": b.get("category"),
            "fandom": b.get("fandom"),
            "collision": b.get("book_id") in existing_ids,
        }
        for b in books if b.get("book_id")
    ]
    preview_shelves = [
        {
            "name": s.get("name"),
            "filter": s.get("filter"),
            "collision": (s.get("name") in existing_shelf_names),
        }
        for s in shelves if s.get("name")
    ]

    return {
        "schema_version": manifest.get("schema_version"),
        "generated_at": manifest.get("generated_at"),
        "books": preview_books,
        "smart_shelves": preview_shelves,
        "stats": {
            "book_count": len(preview_books),
            "collision_count": sum(1 for b in preview_books if b["collision"]),
            "smart_shelf_count": len(preview_shelves),
        },
    }


class RestoreApplyBody(BaseModel):
    """Body for POST /library/restore/apply. The wizard sends the
    book_ids and shelf names the user explicitly chose to restore;
    everything else stays untouched."""
    book_ids: Optional[List[str]] = None
    shelf_names: Optional[List[str]] = None
    overwrite_collisions: bool = False


@api_router.post("/library/restore/apply")
async def restore_apply(
    file: UploadFile = File(...),
    selection: str = Form("{}"),
    user: User = Depends(get_current_user),
):
    """Restore selected books + shelves from a backup ZIP into the
    current library. Files inside ``epubs/`` are copied to the user's
    storage dir; existing files are NOT overwritten unless
    ``overwrite_collisions`` is true on the selection."""
    try:
        sel = RestoreApplyBody(**_json.loads(selection))
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Bad selection payload: {e}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty.")
    # Antivirus pre-scan — same policy as the preview endpoint (2026-06-18).
    from utils.antivirus import scan_bytes, record_quarantine
    import asyncio as _asyncio
    _av = await _asyncio.to_thread(scan_bytes, content, hint_name=file.filename or "backup.zip")
    if _av.get("infected"):
        await record_quarantine(
            user_id=user.user_id,
            filename=file.filename or "",
            scan=_av,
            source="upload",
            extra={"endpoint": "restore/apply", "size_bytes": len(content)},
        )
        raise HTTPException(
            status_code=400,
            detail=f"That backup file appears unsafe ({_av.get('signature') or 'flagged by antivirus'}). Restore blocked.",
        )
    manifest = _read_backup_manifest(content)
    zf = _zipfile.ZipFile(_io.BytesIO(content))
    names = set(zf.namelist())

    chosen_books = set(sel.book_ids or [])
    chosen_shelves = set(sel.shelf_names or [])

    existing_book_ids: set[str] = set()
    async for b in db.books.find({"user_id": user.user_id}, {"_id": 0, "book_id": 1}):
        if b.get("book_id"):
            existing_book_ids.add(b["book_id"])
    existing_shelf_names: set[str] = set()
    async for s in db.smart_shelves.find({"user_id": user.user_id}, {"_id": 0, "name": 1}):
        if s.get("name"):
            existing_shelf_names.add(s["name"])

    user_dir = STORAGE_DIR / user.user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    restored_books = 0
    skipped_books = 0
    overwritten_books = 0
    restored_files = 0
    for b in (manifest.get("books") or []):
        bid = b.get("book_id")
        if not bid or bid not in chosen_books:
            continue
        collision = bid in existing_book_ids
        if collision and not sel.overwrite_collisions:
            skipped_books += 1
            continue
        doc = {k: v for k, v in b.items() if not k.startswith("_")}
        doc["user_id"] = user.user_id  # always re-anchor to the importing user
        if collision:
            await db.books.replace_one(
                {"user_id": user.user_id, "book_id": bid}, doc,
            )
            overwritten_books += 1
        else:
            await db.books.insert_one(doc)
            restored_books += 1
        for candidate in (
            f"epubs/{bid}.epub",
            f"epubs/{bid}.{(b.get('original_format') or 'epub').lstrip('.')}",
        ):
            if candidate in names:
                target = user_dir / candidate.split("/", 1)[1]
                if not target.exists() or sel.overwrite_collisions:
                    with open(target, "wb") as out:
                        out.write(zf.read(candidate))
                    restored_files += 1
                break

    restored_shelves = 0
    skipped_shelves = 0
    for s in (manifest.get("smart_shelves") or []):
        name = s.get("name")
        if not name or name not in chosen_shelves:
            continue
        collision = name in existing_shelf_names
        if collision and not sel.overwrite_collisions:
            skipped_shelves += 1
            continue
        doc = {k: v for k, v in s.items() if not k.startswith("_")}
        doc["user_id"] = user.user_id
        if collision:
            await db.smart_shelves.replace_one(
                {"user_id": user.user_id, "name": name}, doc,
            )
        else:
            await db.smart_shelves.insert_one(doc)
        restored_shelves += 1

    return {
        "ok": True,
        "restored_books": restored_books,
        "overwritten_books": overwritten_books,
        "skipped_books": skipped_books,
        "restored_files": restored_files,
        "restored_shelves": restored_shelves,
        "skipped_shelves": skipped_shelves,
    }
