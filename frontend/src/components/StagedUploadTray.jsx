// StagedUploadTray — the "Ready to upload" queue that appears
// inside UploadZone when the user has flipped on "Stage before
// upload".  Lets them accumulate files across multiple drops /
// folder picks (and review the list) before hitting Start.
//
// 2026-08-27 — Extended so the tray STAYS VISIBLE during upload
// and shows per-file progress inline.  Users prefer watching the
// tray they were reviewing morph into upload progress rather
// than have it disappear and be replaced by a separate list.
//
// Kept deliberately presentational — all state and the actual
// upload kick-off live in UploadZone so the existing
// handleFiles() pipeline (concurrency, throttling, retries,
// non-EPUB confirms, big-library chunking) stays the single
// source of truth.

import React, { useMemo, useState } from "react";
import {
  Play,
  X,
  Trash2,
  Layers,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Filter,
} from "lucide-react";

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const STATE_META = {
  queued: {
    label: "Waiting…",
    barClass: "bg-[#D4CFC1]",
    labelClass: "text-[#5B5F4D]",
    Icon: null,
  },
  uploading: {
    label: "Uploading",
    barClass: "bg-[#E07A5F]",
    labelClass: "text-[#7C2D2A]",
    Icon: null,
  },
  processing: {
    label: "Processing",
    barClass: "bg-[#8B5FBF]",
    labelClass: "text-[#553397]",
    Icon: Loader2,
    iconClass: "text-[#8B5FBF] animate-spin",
  },
  done: {
    label: "Done",
    barClass: "bg-[#3D6B3D]",
    labelClass: "text-[#3D6B3D]",
    Icon: CheckCircle2,
    iconClass: "text-[#3D6B3D]",
  },
  skipped: {
    label: "Skipped",
    barClass: "bg-[#D49A33]",
    labelClass: "text-[#7C5F1F]",
    Icon: AlertTriangle,
    iconClass: "text-[#D49A33]",
  },
  failed: {
    label: "Failed",
    barClass: "bg-[#C75450]",
    labelClass: "text-[#7C2D2A]",
    Icon: XCircle,
    iconClass: "text-[#C75450]",
  },
};

// Render a single row.  If a `progress` row is supplied, we show a
// progress bar + status label; otherwise we render the classic pre-
// upload row with just the filename and remove button.
function StagedRow({ file, progress, uploading, onRemove, onRetry }) {
  const meta = progress ? STATE_META[progress.status] : null;
  const isTerminal = progress && (progress.status === "done" || progress.status === "skipped" || progress.status === "failed");
  const isQueued = !progress || progress.status === "queued";
  const removeDisabled = uploading && !isQueued;
  const fillPct = !meta
    ? 0
    : progress.status === "done" ? 100
    : progress.status === "queued" ? 0
    : progress.status === "uploading" ? Math.max(2, Math.min(100, progress.progress || 0))
    : progress.status === "processing" ? 100
    : 100;
  const RightIcon = meta?.Icon;

  return (
    <li
      className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
      data-testid="staged-tray-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[#2C2C2C] flex-1" title={file.name}>
            {file.name}
          </p>
          {meta && (
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${meta.labelClass}`}
              data-testid="staged-tray-row-status"
            >
              {progress.status === "uploading" && typeof progress.progress === "number"
                ? `${Math.round(progress.progress)}%`
                : meta.label}
            </span>
          )}
          {RightIcon && (
            <RightIcon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} aria-hidden />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-[#5B5F4D] shrink-0">{formatBytes(file.size)}</p>
          {meta && (
            <div className="relative h-1 flex-1 rounded-full bg-[#F0EBE2] overflow-hidden">
              {progress.status === "processing" ? (
                <div
                  className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${meta.barClass} animate-[shelfsort-indeterminate_1.2s_ease-in-out_infinite]`}
                  aria-hidden
                />
              ) : (
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${meta.barClass} transition-[width] duration-200 ease-out`}
                  style={{ width: `${fillPct}%` }}
                  aria-hidden
                />
              )}
            </div>
          )}
        </div>
        {(progress?.status === "skipped" || progress?.status === "failed") && progress.reason && (
          <p
            className={`text-[10px] mt-1 italic truncate ${meta.labelClass}`}
            title={progress.reason}
          >
            {progress.reason}
          </p>
        )}
      </div>

      {progress?.status === "failed" && typeof onRetry === "function" && (
        <button
          type="button"
          onClick={() => onRetry(file.__stageKey)}
          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md bg-[#FBE2E0] text-[#7C2D2A] border border-[#E8B5B0] hover:bg-[#F8D2CE] focus:outline-none focus:ring-2 focus:ring-[#7C2D2A]/40 transition-colors"
          data-testid="staged-tray-row-retry"
        >
          <RotateCcw className="w-3 h-3" /> Retry
        </button>
      )}

      {!isTerminal && (
        <button
          type="button"
          onClick={() => onRemove(file.__stageKey)}
          disabled={removeDisabled}
          aria-label={`Remove ${file.name} from queue`}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-[#5B5F4D] hover:bg-[#FBE7E4] hover:text-[#A03D33] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          data-testid="staged-tray-remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

export default function StagedUploadTray({
  files,
  onRemove,
  onClear,
  onStart,
  busy,
  capacity,
  // 2026-08-27 — Progress-aware props.  When the parent is actively
  // uploading, it passes `uploading=true` and a Map/object keyed by
  // `__stageKey` with the per-file progress row.  When either is
  // absent, the tray falls back to its original pre-upload mode.
  uploading = false,
  progressByStageKey,
  onRetry,
  onRetryAll,
}) {
  // 2026-08-27 — "Show only failed" toggle for big batches.  Not
  // persisted — resets on unmount so the next batch starts fresh.
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);

  const totalBytes = useMemo(
    () => files.reduce((acc, f) => acc + (f.size || 0), 0),
    [files],
  );

  // Derive counts for the uploading-mode header.
  const counts = useMemo(() => {
    if (!progressByStageKey) return null;
    const c = { done: 0, failed: 0, skipped: 0, uploading: 0, processing: 0, queued: 0 };
    for (const f of files) {
      const row = progressByStageKey.get(f.__stageKey);
      const s = row?.status || "queued";
      if (c[s] !== undefined) c[s] += 1;
    }
    return c;
  }, [files, progressByStageKey]);

  // Derived visible list.  When the toggle is on, only failed rows
  // render — but the header counts + `counts.failed` still reflect the
  // full batch so the button label stays accurate.
  const visibleFiles = useMemo(() => {
    if (!showOnlyFailed || !progressByStageKey) return files;
    return files.filter((f) => progressByStageKey.get(f.__stageKey)?.status === "failed");
  }, [files, progressByStageKey, showOnlyFailed]);

  if (!files.length) return null;

  const nearCap = capacity && files.length >= Math.floor(capacity * 0.9);

  return (
    <div
      className="mt-4 w-full rounded-xl bg-[#FDFBF7] border border-[#E4D9C8] overflow-hidden"
      data-testid="staged-upload-tray"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#EDE6D5] bg-[#FAF3E5] flex-wrap">
        <div className="flex items-center gap-2 text-[#2C2C2C]">
          <Layers className="w-4 h-4 text-[#553397]" />
          {uploading && counts ? (
            <>
              <span className="font-serif text-base" data-testid="staged-tray-summary">
                Uploading {counts.done + counts.skipped + counts.failed} of {files.length}
              </span>
              <span className="text-xs text-[#5B5F4D]">
                · {counts.done} ok
                {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ""}
                {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="font-serif text-base" data-testid="staged-tray-summary">
                {files.length} file{files.length === 1 ? "" : "s"} ready
              </span>
              <span className="text-xs text-[#5B5F4D]">· {formatBytes(totalBytes)}</span>
            </>
          )}
          {nearCap && !uploading && (
            <span
              className="text-[11px] text-[#7C5F1F] bg-[#FBF1D6] border border-[#E8D89A] px-1.5 py-0.5 rounded-full font-semibold"
              data-testid="staged-tray-near-cap"
            >
              near limit
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {counts && counts.failed > 0 && (
            <button
              type="button"
              onClick={() => setShowOnlyFailed((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                showOnlyFailed
                  ? "bg-[#7C2D2A] text-white border-[#7C2D2A] hover:bg-[#5C1F1E]"
                  : "bg-white text-[#7C2D2A] border-[#E8B5B0] hover:bg-[#FBE2E0]"
              }`}
              data-testid="staged-tray-show-failed-only"
              aria-pressed={showOnlyFailed}
              title={showOnlyFailed ? "Show all rows again" : "Hide everything except failed rows"}
            >
              <Filter className="w-3.5 h-3.5" />
              {showOnlyFailed ? "Show all" : `Only failed (${counts.failed})`}
            </button>
          )}
          {uploading && counts && counts.failed > 0 && typeof onRetryAll === "function" && (
            <button
              type="button"
              onClick={onRetryAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-[#7C2D2A] bg-[#FBE2E0] border border-[#E8B5B0] hover:bg-[#F8D2CE]"
              data-testid="staged-tray-retry-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry all failed ({counts.failed})
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            disabled={busy || uploading}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[#5B5F4D] bg-white border border-[#E4D9C8] hover:bg-[#FDFBF7] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="staged-tray-clear-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear all
          </button>
          {!uploading && (
            <button
              type="button"
              onClick={onStart}
              disabled={busy || files.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold text-white bg-[#553397] hover:bg-[#421E82] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="staged-tray-start"
            >
              <Play className="w-3.5 h-3.5" />
              Start uploading {files.length}
            </button>
          )}
        </div>
      </div>

      <ul
        className="max-h-96 overflow-y-auto divide-y divide-[#F0E8D6]"
        data-testid="staged-tray-list"
      >
        {visibleFiles.length === 0 && showOnlyFailed && (
          <li
            className="px-4 py-6 text-center text-xs italic text-[#5B5F4D]"
            data-testid="staged-tray-empty-filter"
          >
            No failed rows in the current batch.
          </li>
        )}
        {visibleFiles.map((f) => (
          <StagedRow
            key={f.__stageKey}
            file={f}
            progress={progressByStageKey ? progressByStageKey.get(f.__stageKey) : null}
            uploading={uploading}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </div>
  );
}
