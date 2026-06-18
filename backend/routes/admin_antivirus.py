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
    }


@api_router.get("/admin/antivirus/quarantine")
async def admin_av_quarantine(
    limit: int = 50,
    source: Optional[str] = None,
    _admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 50), 500))
    query: Dict[str, Any] = {}
    if source:
        query["source"] = source
    rows: List[Dict[str, Any]] = []
    async for r in db.av_quarantine.find(query).sort("ts", -1).limit(limit):
        r.pop("_id", None)
        rows.append(r)
    return {"rows": rows}


def _iso_24h_ago() -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
