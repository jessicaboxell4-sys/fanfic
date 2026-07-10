// StagedDraftRestoreBanner — friendly nudge that appears below the
// dropzone when the user has a saved-but-unstarted batch from a
// previous session.  We can't restore the actual file BYTES (browser
// security forbids reading files without a fresh user gesture), so
// the banner's job is purely informational + a shortcut:
//
//   "You had 47 files staged 12 minutes ago from `Books/Kindle/Fantasy`.
//    Re-pick that folder to restore them."
//
// One click on the "Re-pick that folder" button fires the same file
// picker the user used before, and the staging tray's dedupe-by-
// name+size means the experience is idempotent if they accidentally
// pick the wrong folder first.

import React from "react";
import { FolderOpen, X, History } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "earlier";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "earlier";
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)} minute${secs < 120 ? "" : "s"} ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hour${secs < 7200 ? "" : "s"} ago`;
  return `${Math.floor(secs / 86400)} day${secs < 172800 ? "" : "s"} ago`;
}

function formatBytes(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function StagedDraftRestoreBanner({ draft, onRestore, onDismiss }) {
  if (!draft || !Array.isArray(draft.files) || draft.files.length === 0) return null;

  const count = draft.files.length;
  const hints = draft.source_hints || [];
  const sizeLabel = formatBytes(draft.total_bytes);
  const ago = timeAgo(draft.updated_at);

  return (
    <div
      className="mt-4 w-full rounded-xl bg-[#FBF1D6] border border-[#E8D89A] p-4 flex flex-wrap items-start gap-3"
      data-testid="staged-draft-restore-banner"
    >
      <History className="w-5 h-5 text-[#7C5F1F] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-sm text-[#3A2F0D]">
        <p className="font-semibold" data-testid="staged-draft-restore-headline">
          You had {count} file{count === 1 ? "" : "s"} staged {ago}
          {sizeLabel ? <span className="font-normal text-[#5A4A1A]"> · {sizeLabel}</span> : null}
        </p>
        {hints.length > 0 ? (
          <p className="mt-1 text-[#5A4A1A]" data-testid="staged-draft-restore-folders">
            From {hints.length === 1 ? "folder" : "folders"}:{" "}
            {hints.map((h, idx) => (
              <span key={h}>
                <code className="px-1.5 py-0.5 rounded bg-white border border-[#E8D89A] text-[#3A2F0D] font-mono text-[12px]">
                  {h}
                </code>
                {idx < hints.length - 1 ? <span className="mx-1">·</span> : null}
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-1 text-[#5A4A1A]">
            Re-pick those files to restore your queue — Shelfsort will dedupe automatically.
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#6B46C1] hover:bg-[#553397] text-white text-xs font-semibold transition-colors"
          data-testid="staged-draft-restore-action"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Re-pick that folder
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss restore reminder"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[#5A4A1A] hover:bg-white border border-transparent hover:border-[#E8D89A] transition-colors"
          data-testid="staged-draft-restore-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
