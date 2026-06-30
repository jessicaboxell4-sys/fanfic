// StagedUploadTray — the "Ready to upload" queue that appears
// inside UploadZone when the user has flipped on "Stage before
// upload".  Lets them accumulate files across multiple drops /
// folder picks (and review the list) before hitting Start.
//
// Kept deliberately presentational — all state and the actual
// upload kick-off live in UploadZone so the existing
// handleFiles() pipeline (concurrency, throttling, retries,
// non-EPUB confirms, big-library chunking) stays the single
// source of truth.

import React, { useMemo } from "react";
import { Play, X, Trash2, Layers } from "lucide-react";

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

export default function StagedUploadTray({
  files,
  onRemove,
  onClear,
  onStart,
  busy,
  capacity,
}) {
  const totalBytes = useMemo(
    () => files.reduce((acc, f) => acc + (f.size || 0), 0),
    [files],
  );

  if (!files.length) return null;

  const nearCap = capacity && files.length >= Math.floor(capacity * 0.9);

  return (
    <div
      className="mt-4 w-full rounded-xl bg-[#FDFBF7] border border-[#E4D9C8] overflow-hidden"
      data-testid="staged-upload-tray"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#EDE6D5] bg-[#FAF3E5]">
        <div className="flex items-center gap-2 text-[#2C2C2C]">
          <Layers className="w-4 h-4 text-[#6B46C1]" />
          <span className="font-serif text-base" data-testid="staged-tray-summary">
            {files.length} file{files.length === 1 ? "" : "s"} ready
          </span>
          <span className="text-xs text-[#5B5F4D]">· {formatBytes(totalBytes)}</span>
          {nearCap && (
            <span
              className="text-[11px] text-[#7C5F1F] bg-[#FBF1D6] border border-[#E8D89A] px-1.5 py-0.5 rounded-full font-semibold"
              data-testid="staged-tray-near-cap"
            >
              near limit
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[#5B5F4D] bg-white border border-[#E4D9C8] hover:bg-[#FDFBF7] disabled:opacity-50"
            data-testid="staged-tray-clear-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear all
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={busy || files.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold text-white bg-[#6B46C1] hover:bg-[#553397] disabled:opacity-50"
            data-testid="staged-tray-start"
          >
            <Play className="w-3.5 h-3.5" />
            Start uploading {files.length}
          </button>
        </div>
      </div>

      <ul
        className="max-h-56 overflow-y-auto divide-y divide-[#F0E8D6]"
        data-testid="staged-tray-list"
      >
        {files.map((f) => (
          <li
            key={f.__stageKey}
            className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
            data-testid="staged-tray-row"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[#2C2C2C]" title={f.name}>
                {f.name}
              </p>
              <p className="text-[11px] text-[#5B5F4D]">{formatBytes(f.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(f.__stageKey)}
              disabled={busy}
              aria-label={`Remove ${f.name} from queue`}
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-[#5B5F4D] hover:bg-[#FBE7E4] hover:text-[#A03D33] disabled:opacity-30 transition-colors"
              data-testid="staged-tray-remove"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
