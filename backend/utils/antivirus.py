"""Antivirus scanning for user-supplied files (uploads, restores, shares).

Uses ClamAV's ``clamscan`` CLI in a subprocess.  The daemon (``clamd``)
would be faster — it preloads the ~200 MB signature DB once instead of
on every invocation — but in our container we don't have systemd, and
the CLI is a saner default for a low/medium-volume EPUB sorter.  If
we outgrow that, swap ``_run_clamscan`` for a clamd socket call without
touching the public API.

Public surface (all sync-safe — callers are expected to wrap in
``asyncio.to_thread`` where blocking matters):

  - ``is_available() -> bool``
  - ``scan_bytes(data) -> ScanResult``
  - ``scan_path(path) -> ScanResult``
  - ``record_quarantine(...)``  — persists a `av_quarantine` doc

``ScanResult`` is a small dict ``{ok, infected, signature, scanner,
elapsed_ms, error}``.  ``ok=True`` means "scanner ran AND the file is
clean".  ``ok=False`` + ``error`` means the scanner couldn't run (we
log + allow the file through — failing closed on a tooling problem
would break uploads for every user).
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from deps import db


logger = logging.getLogger(__name__)

# Hard caps so an adversarial 4 GB file can't pin a worker for minutes.
# Real EPUBs are <30 MB; PDF/MOBI rarely exceeds 200 MB.
MAX_SCAN_BYTES = 500 * 1024 * 1024   # 500 MB
SCAN_TIMEOUT_S = 60


def _clamscan_path() -> Optional[str]:
    """Prefer ``clamdscan`` (talks to the running daemon — ~50ms per
    scan) and fall back to standalone ``clamscan`` (~6-8s cold-load
    per scan) if clamd isn't running."""
    cd = shutil.which("clamdscan")
    if cd and Path("/var/run/clamav/clamd.ctl").exists():
        return cd
    return shutil.which("clamscan")


def _is_daemon() -> bool:
    bin_path = _clamscan_path() or ""
    return bin_path.endswith("clamdscan")


def is_available() -> bool:
    """True iff the ClamAV binary is on PATH AND the signature DB exists."""
    if not _clamscan_path():
        return False
    db_dir = Path("/var/lib/clamav")
    # ``main.cvd``/``daily.cvd`` (or .cld) are the signature bundles.  A
    # freshly-installed ClamAV without ``freshclam`` won't have them yet.
    return any(db_dir.glob("*.c?d"))


def _make_result(
    ok: bool,
    *,
    infected: bool = False,
    signature: str = "",
    scanner: str = "clamav",
    elapsed_ms: int = 0,
    error: str = "",
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "infected": infected,
        "signature": signature,
        "scanner": scanner,
        "elapsed_ms": elapsed_ms,
        "error": error,
    }


def _run_clamscan(path: Path) -> Dict[str, Any]:
    """Invoke ClamAV on a single path and parse the result.

    Exit codes (per clamscan(1) / clamdscan(1)):
      0 = no infection found
      1 = virus(es) found
      2 = error during scan
    """
    started = time.time()
    binary = _clamscan_path()
    if not binary:
        return _make_result(False, error="clamscan binary not on PATH")
    cmd = [binary]
    if _is_daemon():
        # clamdscan flags — quieter, only print infected lines.
        cmd += ["--no-summary", "--infected", "--fdpass"]
    else:
        cmd += ["--no-summary", "--infected", "--stdout"]
    cmd.append(str(path))
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=SCAN_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return _make_result(False, error=f"clamscan timed out after {SCAN_TIMEOUT_S}s")
    except Exception as e:
        return _make_result(False, error=f"clamscan exec failed: {e}")
    elapsed_ms = int((time.time() - started) * 1000)

    if proc.returncode == 0:
        return _make_result(True, scanner=("clamd" if _is_daemon() else "clamav"), elapsed_ms=elapsed_ms)
    if proc.returncode == 1:
        # ``<path>: <Signature> FOUND`` — pluck the signature name out
        # of the first matching line so admins know what hit.
        sig = ""
        for line in (proc.stdout or "").splitlines():
            if line.endswith(" FOUND"):
                parts = line.rsplit(":", 1)
                if len(parts) == 2:
                    sig = parts[1].strip().removesuffix(" FOUND").strip()
                    break
        return _make_result(True, infected=True, signature=sig or "unknown", scanner=("clamd" if _is_daemon() else "clamav"), elapsed_ms=elapsed_ms)
    return _make_result(
        False,
        elapsed_ms=elapsed_ms,
        error=f"clamscan rc={proc.returncode}: {(proc.stderr or proc.stdout or '').strip()[:300]}",
    )


def scan_bytes(data: bytes, *, hint_name: str = "upload.bin") -> Dict[str, Any]:
    """Scan an in-memory blob by writing it to a temp file first."""
    if not data:
        return _make_result(True)
    if len(data) > MAX_SCAN_BYTES:
        return _make_result(False, error=f"file exceeds {MAX_SCAN_BYTES} bytes")
    if not is_available():
        # AV not installed/seeded yet — fail-open so the app still works.
        return _make_result(False, error="antivirus unavailable")
    with tempfile.NamedTemporaryFile(prefix="avscan_", suffix=_safe_suffix(hint_name), delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        return _run_clamscan(tmp_path)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def scan_path(path: Path) -> Dict[str, Any]:
    """Scan a file already on disk (used by async restore/share flows)."""
    if not path.exists():
        return _make_result(False, error=f"path not found: {path}")
    if path.stat().st_size > MAX_SCAN_BYTES:
        return _make_result(False, error="file exceeds scan size cap")
    if not is_available():
        return _make_result(False, error="antivirus unavailable")
    return _run_clamscan(path)


def _safe_suffix(hint_name: str) -> str:
    if "." not in hint_name:
        return ".bin"
    suffix = "." + hint_name.rsplit(".", 1)[-1]
    # Strip anything weird so the temp file stays predictable.
    return "".join(c for c in suffix if c.isalnum() or c == ".")[:10] or ".bin"


# ---------------------------------------------------------------------------
# Quarantine recording — admin-visible audit trail of every flagged scan.
# ---------------------------------------------------------------------------
async def record_quarantine(
    *,
    user_id: str,
    filename: str,
    scan: Dict[str, Any],
    source: str,                 # "upload" | "restore" | "share" | "backfill"
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist an ``av_quarantine`` doc so admins can review flagged hits."""
    doc: Dict[str, Any] = {
        "ts":         datetime.now(timezone.utc).isoformat(),
        "user_id":    user_id,
        "filename":   (filename or "")[:200],
        "source":     source,
        "scanner":    scan.get("scanner", "clamav"),
        "signature":  scan.get("signature", ""),
        "infected":   bool(scan.get("infected")),
        "ok":         bool(scan.get("ok")),
        "error":      scan.get("error", ""),
        "elapsed_ms": int(scan.get("elapsed_ms", 0)),
    }
    if extra:
        doc.update({k: v for k, v in extra.items() if k not in doc})
    try:
        await db.av_quarantine.insert_one(doc)
    except Exception as e:
        logger.warning("av_quarantine insert failed: %s", e)


__all__ = [
    "is_available",
    "scan_bytes",
    "scan_path",
    "record_quarantine",
    "MAX_SCAN_BYTES",
]
