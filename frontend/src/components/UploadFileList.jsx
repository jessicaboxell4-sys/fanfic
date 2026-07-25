import React, { useMemo, useState, useCallback } from "react";
import { List } from "react-window";
import { Search, RotateCcw, ChevronDown, ChevronRight, ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { UploadFileRow } from "./UploadFileRow";

// 2026-08-27 — Grouped, virtualized, filterable list of per-file
// upload progress rows.  Sits directly beneath the "Sorting your
// books…" header inside UploadZone when the user is uploading > 0
// files.  Uses react-window `<List>` for perf on 2,000+ file drops.

const GROUP_ORDER = ["uploading", "processing", "failed", "queued", "done", "skipped"];
const GROUP_LABELS = {
  uploading: "Uploading",
  processing: "Processing",
  failed: "Failed",
  queued: "Queued",
  done: "Done",
  skipped: "Skipped",
};
const GROUP_COLORS = {
  uploading: "text-[#E07A5F] bg-[#FDF3E1] border-[#E8CB7A]",
  processing: "text-[#553397] bg-[#E8E0F4] border-[#D4C5EE]",
  failed: "text-[#7C2D2A] bg-[#FBE2E0] border-[#E8B5B0]",
  queued: "text-[#5B5F4D] bg-[#F0EBE2] border-[#E4D9C8]",
  done: "text-[#3D6B3D] bg-[#E6F2E6] border-[#C8E1C8]",
  skipped: "text-[#7C5F1F] bg-[#FBF1D6] border-[#E8D89A]",
};

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 60;
const LIST_HEIGHT = 420;

// Which groups auto-expand when the panel first opens.  The rest
// stay collapsed so a 2,000-book drop doesn't drown the user in
// green Done rows the moment the first files finish.
const DEFAULT_EXPANDED = new Set(["uploading", "processing", "failed"]);

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "uploading", label: "Uploading" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
];

// RowComponent for react-window.  Consumes the pre-flattened
// `items` array via rowProps (header rows + file rows interleaved).
function FlatRow({ index, style, items, expanded, toggleGroup, onRetry }) {
  const item = items[index];
  if (!item) return null;
  if (item.type === "header") {
    const isOpen = expanded.has(item.status);
    const Chevron = isOpen ? ChevronDown : ChevronRight;
    return (
      <button
        type="button"
        style={style}
        onClick={() => toggleGroup(item.status)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-[#E8E6E1] bg-[#FAF8F5] hover:bg-[#F5F0E5] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#E07A5F]/40 transition-colors"
        data-testid={`upload-progress-group-${item.status}`}
        aria-expanded={isOpen}
      >
        <Chevron className="w-4 h-4 text-[#5B5F4D] shrink-0" aria-hidden />
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${GROUP_COLORS[item.status]}`}
        >
          {GROUP_LABELS[item.status]}
          <span className="opacity-70 font-mono">{item.count.toLocaleString()}</span>
        </span>
      </button>
    );
  }
  return <UploadFileRow file={item.file} style={style} onRetry={onRetry} />;
}

export function UploadFileList({ files, onRetry, onRetryAll }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);

  const toggleGroup = useCallback((status) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  // Group + filter + flatten in one pass so react-window can render
  // a flat sequence of mixed header/row items.
  const { items, failedCount, groupCounts } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // When a search query is active we auto-expand every group so the
    // user sees all matching rows regardless of the group's default
    // expanded state — otherwise a match sitting inside a collapsed
    // Queued/Done bucket would look like "0 results" even though the
    // header still shows the count.
    const searchActive = q.length > 0;
    const buckets = { uploading: [], processing: [], failed: [], queued: [], done: [], skipped: [] };
    for (const f of files) {
      if (!buckets[f.status]) continue;  // unknown status — skip defensively
      if (q && !f.name.toLowerCase().includes(q)) continue;
      if (statusFilter !== "all" && f.status !== statusFilter) continue;
      buckets[f.status].push(f);
    }
    const flat = [];
    const counts = {};
    for (const status of GROUP_ORDER) {
      const bucket = buckets[status];
      counts[status] = bucket.length;
      if (bucket.length === 0) continue;
      flat.push({ type: "header", status, count: bucket.length });
      if (searchActive || expanded.has(status)) {
        for (const file of bucket) flat.push({ type: "row", file });
      }
    }
    return {
      items: flat,
      failedCount: buckets.failed.length,
      groupCounts: counts,
    };
  }, [files, searchQuery, statusFilter, expanded]);

  const rowHeight = useCallback(
    (index) => (items[index]?.type === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    [items],
  );

  const rowKey = useCallback((index) => {
    const it = items[index];
    if (!it) return `empty-${index}`;
    return it.type === "header" ? `h-${it.status}` : `r-${it.file.id}`;
  }, [items]);

  const failedFilesForCopy = useMemo(
    () => files.filter((f) => f.status === "failed"),
    [files],
  );

  // 2026-08-27 (evening) — Retry-all button honesty.  Rows tagged
  // `sessionInterrupted` can't be retried through this path (they
  // need a re-drop to auto-resume — see UploadFileRow's redrop hint),
  // so count them separately and reflect that in the button label.
  const retryableFailedCount = useMemo(
    () => failedFilesForCopy.filter((f) => !f.sessionInterrupted).length,
    [failedFilesForCopy],
  );

  const handleCopyFailed = useCallback(async () => {
    if (failedFilesForCopy.length === 0) return;
    const lines = failedFilesForCopy.map((f) => {
      const reason = (f.reason || "no reason recorded").replace(/\s+/g, " ").trim();
      return `- \`${f.name}\` — ${reason}`;
    });
    const md = `## Failed uploads (${failedFilesForCopy.length})\n${lines.join("\n")}\n`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
        toast.success(`Copied ${failedFilesForCopy.length} failed row${failedFilesForCopy.length === 1 ? "" : "s"} to clipboard.`);
      } else {
        // Fallback for very old browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = md;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success(`Copied ${failedFilesForCopy.length} failed row${failedFilesForCopy.length === 1 ? "" : "s"} to clipboard.`);
      }
    } catch (err) {
      toast.error("Couldn't copy to clipboard — your browser blocked the request.");
    }
  }, [failedFilesForCopy]);

  const totalUnfiltered = files.length;

  return (
    <div
      className="mt-4 w-full max-w-3xl mx-auto rounded-xl border border-[#E8E6E1] bg-white overflow-hidden shadow-sm text-left"
      data-testid="upload-progress-list"
    >
      {/* Sticky control bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E6E1] bg-[#FDFBF7] flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6E6E6E] pointer-events-none"
            aria-hidden
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter filename…"
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-[#E8E6E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/40 focus:border-[#E07A5F] text-[#2C2C2C] placeholder:text-[#5B5F4D]"
            data-testid="upload-progress-search"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-lg border border-[#E8E6E1] bg-white text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/40 focus:border-[#E07A5F]"
          data-testid="upload-progress-filter"
          aria-label="Filter by status"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
              {opt.value !== "all" && groupCounts[opt.value] !== undefined
                ? ` (${groupCounts[opt.value]})`
                : ""}
            </option>
          ))}
        </select>
        {retryableFailedCount > 0 && typeof onRetryAll === "function" && (
          <button
            type="button"
            onClick={onRetryAll}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#FBE2E0] text-[#7C2D2A] border border-[#E8B5B0] hover:bg-[#F8D2CE] focus:outline-none focus:ring-2 focus:ring-[#7C2D2A]/40 transition-colors"
            data-testid="upload-progress-retry-all"
            title={
              retryableFailedCount === failedCount
                ? undefined
                : `${failedCount - retryableFailedCount} more failed row${failedCount - retryableFailedCount === 1 ? "" : "s"} need${failedCount - retryableFailedCount === 1 ? "s" : ""} a re-drop (session interrupted).`
            }
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry all failed ({retryableFailedCount === failedCount ? failedCount : `${retryableFailedCount} of ${failedCount}`})
          </button>
        )}
        {failedFilesForCopy.length > 0 && (
          <button
            type="button"
            onClick={handleCopyFailed}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#F0EBE2] text-[#2C2C2C] border border-[#E4D9C8] hover:bg-[#EAE4D8] focus:outline-none focus:ring-2 focus:ring-[#5B5F4D]/40 transition-colors"
            data-testid="upload-progress-copy-failed"
            title="Copies the failed filenames + error reasons to your clipboard as Markdown — handy for pasting into bug reports or support emails."
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            Copy stuck rows ({failedFilesForCopy.length})
          </button>
        )}
      </div>

      {/* Virtualized list body */}
      {items.length === 0 ? (
        <div
          className="px-3 py-8 text-center text-xs text-[#5B5F4D] italic"
          data-testid="upload-progress-empty"
        >
          {totalUnfiltered === 0
            ? "No files yet."
            : "No files match your search or filter."}
        </div>
      ) : (
        <List
          style={{ height: LIST_HEIGHT }}
          rowCount={items.length}
          rowHeight={rowHeight}
          rowKey={rowKey}
          overscanCount={4}
          rowComponent={FlatRow}
          rowProps={{ items, expanded, toggleGroup, onRetry }}
          aria-label="Per-file upload progress"
          data-testid="upload-progress-list-scroller"
        />
      )}
    </div>
  );
}

export default UploadFileList;
