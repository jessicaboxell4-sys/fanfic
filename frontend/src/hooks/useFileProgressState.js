import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// 2026-08-27 — Per-file upload progress state, extracted out of
// UploadZone.jsx (which had ballooned past 2,000 lines).  This hook
// owns:
//   • the `fileStates` array (one entry per file in the active batch,
//     transitioning through queued → uploading → processing →
//     done / skipped / failed)
//   • a coalesced setter (`patchFile`) that batches the frequent
//     axios.onUploadProgress ticks into ~150ms flushes so React
//     doesn't re-render on every byte
//   • a `File`-object registry (`fileRefsRef`) so per-row and bulk
//     retries can pass the original browser File back through the
//     `shelfsort:upload-files` CustomEvent bus
//   • localStorage persistence + rehydration on mount (with a 6h
//     TTL, and non-terminal rows snap to `failed` because the File
//     ref can't be JSON-serialized across a refresh)
//   • two retry helpers wired to the existing event bus.

const FILE_PROGRESS_STORAGE_KEY = "shelfsort_upload_progress_v1";
const REHYDRATE_TTL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const PATCH_FLUSH_MS = 150;

function rehydrateFromStorage() {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(FILE_PROGRESS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.files)) return [];
    if (Date.now() - (parsed.timestamp || 0) > REHYDRATE_TTL_MS) return [];
    // Any non-terminal row has lost its File ref during the reload —
    // snap it to `failed` with a clear next-step so the Retry button
    // + Dismiss link both become reachable immediately.
    return parsed.files.map((f) => (
      f.status === "queued" || f.status === "uploading" || f.status === "processing"
        ? { ...f, status: "failed", reason: "Session interrupted — re-select this file to retry", progress: 100 }
        : f
    ));
  } catch {
    return [];
  }
}

export function useFileProgressState() {
  const [fileStates, setFileStates] = useState(rehydrateFromStorage);

  const fileRefsRef = useRef(new Map());        // id -> File
  const pendingPatchesRef = useRef(new Map());  // id -> partial patch
  const patchFlushTimerRef = useRef(null);

  // Coalesced setter — invoked from tight loops (axios upload progress,
  // job-status polling) but flushed at most every PATCH_FLUSH_MS.
  const patchFile = useCallback((id, patch) => {
    if (!id) return;
    const merged = { ...(pendingPatchesRef.current.get(id) || {}), ...patch };
    pendingPatchesRef.current.set(id, merged);
    if (patchFlushTimerRef.current) return;
    patchFlushTimerRef.current = setTimeout(() => {
      const patches = pendingPatchesRef.current;
      pendingPatchesRef.current = new Map();
      patchFlushTimerRef.current = null;
      setFileStates((prev) => prev.map((f) => (patches.has(f.id) ? { ...f, ...patches.get(f.id) } : f)));
    }, PATCH_FLUSH_MS);
  }, []);

  // Persist to localStorage after every mutation — but drop the row
  // count above what's safe to serialize.  A 2,000-file batch works
  // out to ~120KB which is well under the typical 5MB quota.
  useEffect(() => {
    try {
      if (fileStates.length === 0) {
        window.localStorage.removeItem(FILE_PROGRESS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          FILE_PROGRESS_STORAGE_KEY,
          JSON.stringify({ timestamp: Date.now(), files: fileStates }),
        );
      }
    } catch {
      // Quota / disabled — safe to ignore, list still reactive in-memory.
    }
  }, [fileStates]);

  // Seed fileStates + fileRefsRef when a new batch starts.  Tags each
  // File with a `._shelfsortId` property so the send loop can find
  // its state row without threading the id through every callback.
  const initFiles = useCallback((filesToSend) => {
    fileRefsRef.current = new Map();
    const initial = filesToSend.map((f, idx) => {
      const id = `${f.name}::${f.size}::${idx}::${Date.now()}`;
      fileRefsRef.current.set(id, f);
      try { f._shelfsortId = id; } catch { /* readonly in strict impls */ }
      return {
        id,
        name: f.name,
        size: f.size,
        status: "queued",
        progress: 0,
      };
    });
    setFileStates(initial);
    return initial;
  }, []);

  // Called from the end-of-batch cleanup.  Waits FILE_PROGRESS_LINGER_MS
  // then wipes fileStates iff no rows are still non-terminal (a fresh
  // batch may have started during the linger window).
  const scheduleClearIfComplete = useCallback((lingerMs = 30_000) => {
    setTimeout(() => {
      setFileStates((prev) => {
        const stillActive = prev.some(
          (f) => f.status === "queued" || f.status === "uploading" || f.status === "processing",
        );
        return stillActive ? prev : [];
      });
      fileRefsRef.current = new Map();
    }, lingerMs);
  }, []);

  // Immediate wipe, used by the "Dismiss last batch results" button.
  const clearAll = useCallback(() => {
    setFileStates([]);
    fileRefsRef.current = new Map();
  }, []);

  // Retry a single failed row through the existing `shelfsort:upload-files`
  // event bus so all wake-lock, transient-retry, telemetry, and
  // duplicate-detection wiring works automatically.
  const retryFileById = useCallback((fileId) => {
    const file = fileRefsRef.current.get(fileId);
    if (!file) {
      toast.error("Can't retry — the original file reference is no longer available (page was reloaded).");
      return;
    }
    setFileStates((prev) => prev.map((f) => (
      f.id === fileId ? { ...f, status: "queued", progress: 0, reason: undefined } : f
    )));
    window.dispatchEvent(new CustomEvent("shelfsort:upload-files", { detail: [file] }));
  }, []);

  const retryAllFailed = useCallback(() => {
    setFileStates((current) => {
      const failedRows = current.filter((f) => f.status === "failed");
      if (failedRows.length === 0) return current;
      const filesToRetry = [];
      const missing = [];
      for (const row of failedRows) {
        const f = fileRefsRef.current.get(row.id);
        if (f) filesToRetry.push(f);
        else missing.push(row.name);
      }
      if (filesToRetry.length === 0) {
        toast.error("Can't retry — the original file references are no longer available (page was reloaded).");
        return current;
      }
      if (missing.length > 0) {
        toast.info(`${missing.length} file${missing.length === 1 ? "" : "s"} can't be retried — page was reloaded.`);
      }
      // Dispatch outside the setter so React doesn't re-invoke it if the
      // event handler happens to trigger another setState synchronously.
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("shelfsort:upload-files", { detail: filesToRetry }));
      });
      return current.map((f) => (
        f.status === "failed" && fileRefsRef.current.has(f.id)
          ? { ...f, status: "queued", progress: 0, reason: undefined }
          : f
      ));
    });
  }, []);

  return {
    fileStates,
    patchFile,
    initFiles,
    scheduleClearIfComplete,
    clearAll,
    retryFileById,
    retryAllFailed,
    fileRefsRef,
  };
}

export default useFileProgressState;
