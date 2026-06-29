// FailedUploadsList — shared component used by both the banner on
// /library/all (compact = true, 7-day window) and the full
// section on /account (compact = false, 30-day window).
//
// Source of truth: GET /api/uploads/failures.  Failures are
// persisted by the backend whenever a job-level pipeline error
// occurs and by the frontend (via reportFailure below) when
// sendOne returns ok:false for any per-file reason.
//
// Retry model (2026-06-28):
//   • bytes_available === false  → bytes never reached the server,
//                                  or the staging dir was swept.
//                                  We CAN'T re-run the pipeline
//                                  from the backend.  The UI offers
//                                  a "Re-drop these files" button
//                                  that opens the native file
//                                  picker — the user re-selects the
//                                  same files from disk and the
//                                  normal upload flow handles them.
//                                  When matching filenames upload
//                                  successfully, the corresponding
//                                  failure rows auto-dismiss.
//   • bytes_available === true   → reserved for Phase 2.  We would
//                                  call POST /uploads/failures/:id/retry
//                                  to re-run the pipeline server-side
//                                  without re-uploading.  Not wired
//                                  in this MVP.
//
// Bulk re-drop UX: the picker hint shows the user a list of
// filenames they need to look for — useful when the failures came
// from a 200-file Airdrop and the user can't remember which 23 to
// re-select.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, X, ChevronDown, ChevronUp, Loader2, FileX2, Download } from "lucide-react";

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function relativeTime(iso) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return RELATIVE_FORMATTER.format(-mins, "minute");
    const hours = Math.round(mins / 60);
    if (hours < 24) return RELATIVE_FORMATTER.format(-hours, "hour");
    const days = Math.round(hours / 24);
    return RELATIVE_FORMATTER.format(-days, "day");
  } catch {
    return "";
  }
}

const STAGE_LABELS = {
  network: "Network glitch",
  submit: "Couldn't upload",
  process: "Processing failed",
  convert: "Conversion failed",
  av: "Flagged by virus scan",
  classify: "Classifier failed",
  extract: "Metadata extraction failed",
};

export default function FailedUploadsList({
  compact = false,
  days = 30,
  onReupload,           // called with `[File, ...]` after the user picks files
  initialCollapsed = false,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get(`/uploads/failures?days=${days}`);
      setRows(Array.isArray(data?.failures) ? data.failures : []);
    } catch {
      // Banner is non-essential — fail silently rather than spam toasts.
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Re-poll when the tab regains focus so the user sees the list
    // shrink as they re-drop files (the upload flow dismisses rows
    // matching the filenames it successfully ingests).
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const dismissOne = async (failure_id) => {
    setBusy(true);
    try {
      await api.post(`/uploads/failures/${failure_id}/dismiss`);
      setRows((rs) => rs.filter((r) => r.failure_id !== failure_id));
    } catch (e) {
      toast.error("Couldn't dismiss — try again");
    } finally {
      setBusy(false);
    }
  };

  const dismissAll = async () => {
    if (!window.confirm("Clear all failed-upload notices?")) return;
    setBusy(true);
    try {
      const { data } = await api.post("/uploads/failures/dismiss-all");
      toast.success(`Cleared ${data?.dismissed || 0} failed-upload notice${(data?.dismissed || 0) === 1 ? "" : "s"}.`);
      setRows([]);
    } catch (e) {
      toast.error("Couldn't clear — try again");
    } finally {
      setBusy(false);
    }
  };

  const triggerReupload = () => {
    if (!rows.length) return;
    // Open native picker.  Pre-populating filename hints is a browser
    // security limitation — we surface them in a tooltip + alert
    // before the picker opens.
    const fileList = rows.map((r) => r.filename).slice(0, 10).join("\n  • ");
    const more = rows.length > 10 ? `\n  • …and ${rows.length - 10} more` : "";
    const ok = window.confirm(
      `Re-drop these ${rows.length} files from your computer:\n\n  • ${fileList}${more}\n\nClick OK to open the file picker.`,
    );
    if (!ok) return;
    fileInputRef.current?.click();
  };

  const onFilesPicked = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";  // reset so picking the same file again re-fires.
    if (!files.length) return;
    // Hand off to the upload zone via the prop callback.  The parent
    // is responsible for invoking the existing handleFiles() flow,
    // which will (a) upload the files, (b) on success match the
    // filenames back to upload_failures rows and dismiss them.
    onReupload?.(files);
  };

  const visibleCount = rows.length;
  const previewRows = compact ? rows.slice(0, 3) : rows;
  const hidden = compact ? Math.max(0, rows.length - 3) : 0;

  // Reupload-aware filename matching: when an upload flow completes,
  // the parent should call `dismissMatching([...filenames])` so the
  // failure rows for those filenames disappear.  Exposed via the
  // parent's onReupload callback returning a promise that resolves
  // with the successful filenames.
  const dismissMatching = async (successfulFilenames) => {
    if (!successfulFilenames || !successfulFilenames.length) return;
    const set = new Set(successfulFilenames);
    const matched = rows.filter((r) => set.has(r.filename));
    if (!matched.length) return;
    await Promise.allSettled(
      matched.map((r) => api.post(`/uploads/failures/${r.failure_id}/dismiss`)),
    );
    setRows((rs) => rs.filter((r) => !set.has(r.filename)));
  };

  // Expose dismissMatching to parent via a ref-like pattern.
  useEffect(() => {
    if (typeof onReupload === "function") {
      onReupload._dismissMatching = dismissMatching;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (loading) return null;
  if (visibleCount === 0) return null;

  return (
    <section
      className={
        compact
          ? "shelf-card border border-[#E07A5F]/40 bg-[#FFF6E5] p-4 mb-4"
          : "shelf-card border border-[#E07A5F]/40 bg-[#FFF6E5] p-6 mb-6"
      }
      data-testid="failed-uploads-list"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFilesPicked}
        data-testid="failed-uploads-file-input"
      />

      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <AlertTriangle className="w-5 h-5 text-[#E07A5F] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h3 className={compact ? "font-serif text-lg text-[#2C2C2C]" : "font-serif text-2xl text-[#2C2C2C] mb-0.5"}>
              {visibleCount} upload{visibleCount === 1 ? "" : "s"} didn&rsquo;t go through
            </h3>
            <p className="text-sm text-[#5B5F4D]">
              Re-drop them when you have a moment — we kept the list so you don&rsquo;t lose track.
            </p>
          </div>
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-xs text-[#5B5F4D] hover:text-[#2C2C2C] inline-flex items-center gap-1"
            data-testid="failed-uploads-toggle"
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            {collapsed ? "Show" : "Hide"}
          </button>
        )}
      </div>

      {(!compact || !collapsed) && (
        <>
          <div className="space-y-2 mb-3" data-testid="failed-uploads-rows">
            {previewRows.map((r) => {
              const label = STAGE_LABELS[r.failure_stage] || "Failed";
              return (
                <div
                  key={r.failure_id}
                  className="flex items-start gap-3 p-3 bg-[#FBE7E4] rounded-lg border border-[#E07A5F]/20"
                  data-testid={`failed-upload-row-${r.failure_id}`}
                >
                  <FileX2 className="w-4 h-4 text-[#A03D33] shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#2C2C2C] truncate" title={r.filename}>
                      {r.filename}
                    </div>
                    <div className="text-xs text-[#5B5F4D] mt-0.5">
                      <span className="font-semibold text-[#A03D33]">{label}</span>
                      <span className="opacity-70"> · {relativeTime(r.created_at)}</span>
                      {r.error && (
                        <span className="block italic mt-1 opacity-90">{r.error}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissOne(r.failure_id)}
                    disabled={busy}
                    className="shrink-0 text-[#5B5F4D] hover:text-[#A03D33] disabled:opacity-50 p-1 -m-1"
                    title="Dismiss this notice"
                    data-testid={`failed-upload-dismiss-${r.failure_id}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            {hidden > 0 && (
              <p className="text-xs text-[#5B5F4D] italic pl-1">
                …and {hidden} more — see the full list on{" "}
                <a href="/account#failed-uploads" className="underline">/account</a>.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={triggerReupload}
              disabled={busy || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E07A5F] hover:bg-[#C5564B] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              data-testid="failed-uploads-redrop"
            >
              <RefreshCw className="w-4 h-4" />
              Re-drop {rows.length} file{rows.length === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={busy || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FAF6EE] hover:bg-[#F2EEE5] disabled:opacity-50 text-[#5B5F4D] text-sm border border-[#E07A5F]/30 transition-colors"
              data-testid="failed-uploads-download-csv"
              title={`Download all ${rows.length} failed-upload row${rows.length === 1 ? "" : "s"} as CSV (opens in Excel / Numbers / Sheets).`}
            >
              <Download className="w-4 h-4" />
              Download list (.csv)
            </button>
            <button
              type="button"
              onClick={dismissAll}
              disabled={busy || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FAF6EE] hover:bg-[#F2EEE5] disabled:opacity-50 text-[#5B5F4D] text-sm border border-[#E07A5F]/30 transition-colors"
              data-testid="failed-uploads-dismiss-all"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Dismiss all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
