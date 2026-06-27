"""Admin antivirus dashboard endpoints + scanner-status probe.

Two endpoints, both admin-only:

  - ``GET /api/admin/antivirus/status`` — daemon up? signatures
    loaded?  Used by the AdminConsole "Antivirus" card so admins can
    spot a broken scanner before it silently fails open.
  - ``GET /api/admin/antivirus/quarantine`` — paged list of flagged
    files with signature, source endpoint, user, and timestamp.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import Depends

from deps import api_router, db
from models import User
from auth_dep import require_admin
from utils import antivirus


@api_router.get("/admin/antivirus/status")
async def admin_av_status(_admin: User = Depends(require_admin)) -> Dict[str, Any]:
    available = antivirus.is_available()
    # 2026-06-21 — Detailed diagnostics so a DOWN status tells operators
    # *why* it's down (binary missing? sig DB missing? daemon not
    # listening?) without needing a shell on the production pod.  These
    # fields are best-effort and never raise — a busted clamd config
    # must still return JSON, not a 500.
    import shutil as _shutil
    import socket as _socket
    from pathlib import Path as _Path
    binary_path = antivirus._clamscan_path()
    binary_kind: Optional[str] = None
    if binary_path:
        binary_kind = "clamdscan" if binary_path.endswith("clamdscan") else "clamscan"
    sig_dir = _Path("/var/lib/clamav")
    sig_files: List[str] = []
    try:
        if sig_dir.is_dir():
            sig_files = sorted(p.name for p in sig_dir.glob("*.c?d"))
    except Exception:  # noqa: BLE001
        sig_files = []
    clamd_socket_exists = _Path("/var/run/clamav/clamd.ctl").exists()
    clamd_tcp_reachable = False
    try:
        with _socket.create_connection(("127.0.0.1", 3310), timeout=0.5):
            clamd_tcp_reachable = True
    except Exception:  # noqa: BLE001
        clamd_tcp_reachable = False
    diag_reason = ""
    if not available:
        if not binary_path:
            diag_reason = (
                "ClamAV binary (clamscan/clamdscan) not on PATH — apt "
                "install probably never ran during build."
            )
        elif not sig_files:
            diag_reason = (
                "Signature DB missing in /var/lib/clamav (no *.cvd / "
                "*.cld files).  freshclam didn't download successfully "
                "during startup — re-run `freshclam` on the pod."
            )
        else:
            diag_reason = "Unknown — see diagnostics block."
    diagnostics = {
        "binary_path":          binary_path,
        "binary_kind":          binary_kind,
        "signature_dir":        str(sig_dir),
        "signature_files":      sig_files,
        "clamd_socket_exists":  clamd_socket_exists,
        "clamd_tcp_reachable":  clamd_tcp_reachable,
        "reason":               diag_reason,
    }
    # Best-effort liveness probe: scan the well-known EICAR test string
    # to confirm both the daemon AND the signature DB are functioning.
    # ~10 ms when clamd is running; we skip this when AV reports
    # unavailable so a dead daemon doesn't 7-second-stall every poll.
    eicar = (
        b"X5O!P%@AP[4\\PZX54(P^)7CC)7}"
        b"$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    )
    test_ok = False
    test_signature = ""
    test_ms = 0
    if available:
        result = antivirus.scan_bytes(eicar, hint_name="liveness.txt")
        test_ok = bool(result.get("infected"))
        test_signature = result.get("signature", "")
        test_ms = int(result.get("elapsed_ms", 0))

    # Counters for the admin card's headline numbers.
    total = await db.av_quarantine.count_documents({})
    last_24h = await db.av_quarantine.count_documents({
        "ts": {"$gte": _iso_24h_ago()},
    })

    return {
        "available":     available,
        "eicar_test_ok": test_ok,
        "signature":     test_signature,
        "scan_ms":       test_ms,
        "quarantine_total":   total,
        "quarantine_last_24h": last_24h,
        "diagnostics":   diagnostics,
    }


@api_router.get("/admin/antivirus/quarantine")
async def admin_av_quarantine(
    limit: int = 50,
    source: Optional[str] = None,
    include_tests: bool = False,
    _admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 50), 500))
    query: Dict[str, Any] = {}
    if source:
        query["source"] = source
    if not include_tests:
        from utils.test_account_filter import mongo_exclude_test_user_ids_clause
        # av_quarantine stores user_id only — convert to a $nin clause
        # against the set of currently-known test-account user_ids.
        # Quarantine hits from fixture flows (uploads by @example.com)
        # are noise; admins almost never need them in the daily feed.
        query.update(await mongo_exclude_test_user_ids_clause(db, "user_id"))
    rows: List[Dict[str, Any]] = []
    async for r in db.av_quarantine.find(query).sort("ts", -1).limit(limit):
        r.pop("_id", None)
        rows.append(r)
    return {"rows": rows}


def _iso_24h_ago() -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
