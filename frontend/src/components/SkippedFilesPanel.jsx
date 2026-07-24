import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, ChevronDown, X, AlertTriangle, FileX, RotateCcw, Download } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * SkippedFilesPanel (iter 89 rebuild from screenshot).
 *
 * Renders below the UploadZone when the last upload batch had files
 * that failed or were skipped by the server-side pipeline.  Rows are
 * grouped by dismissal state; the top-level "Hide" toggle collapses
 * the panel; "Re-drop N files" replays the batch through the picker;
 * "Download list (.csv)" exports the reasons; "Dismiss all" clears
 * everything.  Individual "×" buttons dismiss a single row.
 */
export default function SkippedFilesPanel({ items = [], onDismiss, onDismissAll, onReadd, onDownloadCsv }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items || items.length === 0) return null;

  const visibleItems = items.slice(0, 3);
  const overflow = Math.max(0, items.length - visibleItems.length);
  const total = items.length;

  return (
    <section
      className="mt-6 rounded-2xl border border-[#3E3323] bg-[#1F1810] px-6 py-5 text-[#EDE3D0]"
      data-testid="skipped-files-panel"
      aria-labelledby="skipped-files-panel-heading"
    >
      <header className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#B78AE0] mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <h3 id="skipped-files-panel-heading" className="font-serif text-lg text-white">
              <span data-testid="skipped-files-group-count">{total}</span> uploads didn&apos;t go through
            </h3>
            <p className="text-sm text-[#D6C6AE]">Re-drop them when you have a moment — we kept the list so you don&apos;t lose track.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="skipped-files-toggle"
          className="inline-flex items-center gap-1 text-xs text-[#D6C6AE] hover:text-white"
        >
          {collapsed ? <><ChevronDown className="w-3.5 h-3.5" /> Show</> : <><ChevronUp className="w-3.5 h-3.5" /> Hide</>}
        </button>
      </header>
      {!collapsed && (
        <>
          <ul className="space-y-2 mb-4" data-testid="skipped-files-list">
            {visibleItems.map((it) => (
              <li
                key={it.id || it.filename}
                data-testid="skipped-files-row"
                className="flex items-start gap-3 rounded-lg border border-[#3E3323] bg-[#2A1F14] px-4 py-3"
              >
                <FileX className="w-4 h-4 text-[#B78AE0] mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate font-mono">{it.filename}</p>
                  <p className="text-xs text-[#D6C6AE]">
                    <span className="font-semibold text-white">{it.status || "Processing failed"}</span>
                    {it.age_label ? <> · {it.age_label}</> : null}
                  </p>
                  {it.reason && (
                    <p className="text-xs italic text-[#B8A88A] mt-0.5" data-testid={`skipped-files-reason-${(it.reason_code || "unknown")}`}>
                      {it.reason}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss && onDismiss(it)}
                  aria-label="Dismiss this file"
                  className="p-1 rounded text-[#D6C6AE] hover:bg-white/10 hover:text-white shrink-0"
                  data-testid="skipped-files-dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="text-xs italic text-[#D6C6AE] mb-3">
              …and {overflow} more — see the full list on <Link to="/account" className="underline">/account</Link>.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onReadd && onReadd(items)}
              data-testid="skipped-files-readd"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#B78AE0] text-[#1F1810] text-xs font-semibold hover:bg-[#A277CE] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Re-drop {total} file{total === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              onClick={() => onDownloadCsv && onDownloadCsv(items)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#3E3323] bg-transparent text-[#EDE3D0] text-xs hover:bg-white/5"
            >
              <Download className="w-3.5 h-3.5" /> Download list (.csv)
            </button>
            <button
              type="button"
              onClick={() => onDismissAll && onDismissAll(items)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#3E3323] bg-transparent text-[#EDE3D0] text-xs hover:bg-white/5"
            >
              <X className="w-3.5 h-3.5" /> Dismiss all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
