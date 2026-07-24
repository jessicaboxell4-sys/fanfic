import React from "react";
import { FileText, CheckCircle2, XCircle, AlertTriangle, Loader2, RotateCcw } from "lucide-react";

// 2026-08-27 — Per-file row for the expanded upload progress list.
// Renders one epub/pdf/etc. with a state-aware progress bar so users
// can see individual file progress instead of only aggregate counters.

const STATE_META = {
  queued: {
    label: "Waiting…",
    barClass: "bg-[#D4CFC1]",
    textClass: "text-[#5B5F4D]",
    icon: FileText,
    iconClass: "text-[#5B5F4D]",
    indeterminate: false,
  },
  uploading: {
    label: "Uploading",
    barClass: "bg-[#E07A5F]",
    textClass: "text-[#5B5F4D]",
    icon: FileText,
    iconClass: "text-[#E07A5F]",
    indeterminate: false,
  },
  processing: {
    label: "Processing",
    barClass: "bg-[#8B5FBF]",
    textClass: "text-[#553397]",
    icon: Loader2,
    iconClass: "text-[#8B5FBF] animate-spin",
    indeterminate: true,
  },
  done: {
    label: "Done",
    barClass: "bg-[#5C8A5C]",
    textClass: "text-[#3D6B3D]",
    icon: CheckCircle2,
    iconClass: "text-[#3D6B3D]",
    indeterminate: false,
  },
  skipped: {
    label: "Skipped",
    barClass: "bg-[#D49A33]",
    textClass: "text-[#7C5F1F]",
    icon: AlertTriangle,
    iconClass: "text-[#D49A33]",
    indeterminate: false,
  },
  failed: {
    label: "Failed",
    barClass: "bg-[#C75450]",
    textClass: "text-[#7C2D2A]",
    icon: XCircle,
    iconClass: "text-[#C75450]",
    indeterminate: false,
  },
};

export function UploadFileRow({ file, style, onRetry }) {
  const meta = STATE_META[file.status] || STATE_META.queued;
  const Icon = meta.icon;
  const fillPct =
    file.status === "done" ? 100
    : file.status === "queued" ? 0
    : file.status === "uploading" ? Math.max(2, Math.min(100, file.progress || 0))
    : file.status === "processing" ? 100
    : file.status === "skipped" ? 100
    : file.status === "failed" ? 100
    : 0;

  return (
    <div
      style={style}
      className="flex items-center gap-3 px-3 py-2 border-b border-[#F0EBE2] last:border-b-0"
      data-testid={`upload-progress-row-${file.id}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <p className="text-xs font-medium text-[#2C2C2C] truncate flex-1" title={file.name}>
            {file.name}
          </p>
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${meta.textClass}`}
            data-testid={`upload-progress-row-status-${file.id}`}
          >
            {file.status === "uploading" && typeof file.progress === "number"
              ? `${Math.round(file.progress)}%`
              : meta.label}
          </span>
        </div>
        {/* Progress bar rail */}
        <div className="relative h-1.5 rounded-full bg-[#F0EBE2] overflow-hidden">
          {meta.indeterminate ? (
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
        {(file.status === "skipped" || file.status === "failed") && file.reason && (
          <p
            className={`text-[10px] mt-1 italic truncate ${meta.textClass}`}
            title={file.reason}
            data-testid={`upload-progress-row-reason-${file.id}`}
          >
            {file.reason}
          </p>
        )}
      </div>
      {file.status === "failed" && typeof onRetry === "function" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry(file.id);
          }}
          className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md bg-[#FBE2E0] text-[#7C2D2A] border border-[#E8B5B0] hover:bg-[#F8D2CE] focus:outline-none focus:ring-2 focus:ring-[#7C2D2A]/40 transition-colors"
          data-testid={`upload-progress-row-retry-${file.id}`}
        >
          <RotateCcw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

export default UploadFileRow;
