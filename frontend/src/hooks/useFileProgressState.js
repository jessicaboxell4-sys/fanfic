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
    // 2026-08-27 — Additionally tag with `sessionInterrupted: true`
    // so the auto-resume-on-redrop path (see initFiles below) can
    // find these rows by name+size and replace them with fresh
    // queued rows when the user drops the same files again.
    return parsed.files.map((f) => (
      f.status === "queued" || f.status === "uploading" || f.status === "processing"
        ? {
            ...f,
            status: "failed",
            reason: "Session interrupted — drop this file again to resume",
            progress: 100,
            sessionInterrupted: true,
          }
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
  // 2026-08-27 — Live mirror of fileStates.  Needed by `initFiles`
  // so it can compute the smart-merge without waiting for a setState
  // callback.  Kept in sync via a useEffect below.
  const fileStatesRef = useRef(fileStates);
  useEffect(() => { fileStatesRef.current = fileStates; }, [fileStates]);

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

  // Persist to localStorage after every mutation — but debounce so a
  // 2,000-file batch doesn't produce 2,000 JSON.stringify + writes
  // (the coalesced `patchFile` batches at ~150ms, so a 500ms persist
  // debounce still keeps the entry fresh enough for a mid-batch
  // refresh to recover).
  useEffect(() => {
    const t = setTimeout(() => {
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
    }, 500);
    return () => clearTimeout(t);
  }, [fileStates]);

  // Seed fileStates + fileRefsRef when a new batch starts.  Tags each
  // File with a `._shelfsortId` property so the send loop can find
  // its state row without threading the id through every callback.
  //
  // 2026-08-27 — Now performs a SMART MERGE instead of a wholesale
  // replace.  Two motivating cases:
  //   1. Auto-resume: a prior refresh left rows tagged
  //      `sessionInterrupted: true` (they were mid-upload when the
  //      page reloaded and the browser dropped their File contents).
  //      When the user re-drops the same files, those rows are
  //      removed by name+size and replaced with fresh queued rows
  //      so the retry is transparent.
  //   2. Preserving history: any prior Done / Skipped / Failed rows
  //      that DON'T match the new drop are kept in the visible list
  //      so users can still review the previous batch's outcome
  //      alongside the fresh one.
  //
  // Returns `{ initial, resumedCount }` so the caller can toast the
  // number of interrupted files that got auto-resumed.
  const initFiles = useCallback((filesToSend) => {
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

    // Which name+size keys are we picking up in this drop?
    const incomingKeys = new Set(filesToSend.map((f) => `${f.name}::${f.size}`));

    // Snapshot the current list and prune session-interrupted rows
    // whose keys are in the incoming drop.  Any other prior rows
    // (done / skipped / regular failed) are preserved untouched.
    const prev = fileStatesRef.current;
    const kept = prev.filter((row) => {
      const key = `${row.name}::${row.size}`;
      return !(row.sessionInterrupted && incomingKeys.has(key));
    });
    const resumedCount = prev.length - kept.length;

    setFileStates([...kept, ...initial]);
    return { initial, resumedCount };
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

  // 2026-08-27 (evening hotfix) — Guardrail invoked in the `finally`
  // block of the upload orchestrator.  If ANY exception fires mid-
  // batch, files that hadn't yet reached a terminal state (queued /
  // uploading / processing) are stranded forever in the visible list.
  // This helper snaps them to `failed` with a clear reason so the
  // user can Retry from the row.  Idempotent: called on every batch
  // end, and no-ops when everything is already terminal.
  const markStuckAsFailed = useCallback(
    (reason = "Batch ended before this file was picked up — retry to try again.") => {
      setFileStates((prev) => prev.map((f) => (
        f.status === "queued" || f.status === "uploading" || f.status === "processing"
          ? { ...f, status: "failed", reason: f.reason || reason, progress: 100 }
          : f
      )));
    },
    [],
  );

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
      toast.error("Can't retry — drop this file again to auto-resume.");
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
        toast.info(
          `${missing.length} file${missing.length === 1 ? "" : "s"} can't be retried — drop ${missing.length === 1 ? "it" : "them"} again to auto-resume.`,
        );
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
    markStuckAsFailed,
    clearAll,
    retryFileById,
    retryAllFailed,
    fileRefsRef,
  };
}

export default useFileProgressState;
