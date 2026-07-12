import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import {
  ArrowLeft, ArrowRight, Layers, Loader2, RotateCcw, ChevronDown, ChevronUp,
  Copy, ChevronsUp, Clock, Trash2, ExternalLink, Book, Bookmark, ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

const REASON_STYLES = {
  "title+author": { label: "Same title + author", tone: "bg-[#FDF3E1] text-[#8C5C00] border-[#F5D48A]" },
  "source_url":   { label: "Same source", tone: "bg-[#FDF3E1] text-[#8C5C00] border-[#F5D48A]" },
  "url":          { label: "Same fanfic link", tone: "bg-[#DCEBFA] text-[#1E4E8C] border-[#A9C7ED]" },
  "title":        { label: "Same title only", tone: "bg-[#EAEAEA] text-[#4A4A4A] border-[#D6D6D6]" },
  "historical_version": { label: "Older version", tone: "bg-[#F4EFE3] text-[#5B5F4D] border-[#D9CFB1]" },
};

function ReasonBadge({ reason }) {
  const style = REASON_STYLES[reason] || { label: reason, tone: "bg-[#EAEAEA] text-[#4A4A4A] border-[#D6D6D6]" };
  return (
    <span
      data-testid={`quarantine-reason-${reason}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${style.tone}`}
    >
      {style.label}
    </span>
  );
}

function CoverThumb({ bookId, hasCover }) {
  if (hasCover) {
    return (
      <img
        src={`${process.env.REACT_APP_BACKEND_URL}/api/books/${bookId}/cover`}
        alt=""
        loading="lazy"
        className="w-10 h-14 rounded object-cover flex-shrink-0 bg-[#EDE7FB]"
      />
    );
  }
  return (
    <div className="w-10 h-14 rounded bg-[#EDE7FB] flex items-center justify-center flex-shrink-0">
      <Book className="w-4 h-4 text-[#6B46C1]" />
    </div>
  );
}

function WhyPanel({ dup, keeper, onNotDuplicate, notDupBusyId }) {
  const [open, setOpen] = useState(false);
  const reasons = new Set(dup.match_reasons || []);
  const titleMatch = reasons.has("title+author") || reasons.has("title");
  const authorMatch = reasons.has("title+author");
  const urlMatch = reasons.has("source_url");
  const linkMatch = reasons.has("url");
  const isHistorical = reasons.has("historical_version");
  const busy = notDupBusyId === dup.book_id;

  return (
    <div className="mt-2 border-t border-dashed border-[#E5DDC5] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`why-toggle-${dup.book_id}`}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-[#5B5F4D] hover:text-[#2C2C2C]"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Why we caught this
      </button>
      {open && (
        <div
          data-testid={`why-panel-${dup.book_id}`}
          className="mt-2 rounded border border-[#E5DDC5] bg-[#FBFAF6] p-2 text-[11px]"
        >
          <div className="grid grid-cols-[auto,1fr,1fr] gap-x-3 gap-y-1 items-start">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5B5F4D]"></p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5B5F4D]">This upload</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5B5F4D]">Existing keeper</p>

            <p className="text-[#5B5F4D]">Title</p>
            <p className={`font-mono break-all ${titleMatch ? "bg-[#FDF3E1] text-[#8C5C00] px-1 rounded" : "text-[#5B5F4D]"}`}>
              {dup.title || <span className="italic">—</span>}
            </p>
            <p className={`font-mono break-all ${titleMatch ? "bg-[#FDF3E1] text-[#8C5C00] px-1 rounded" : "text-[#5B5F4D]"}`}>
              {keeper.title || <span className="italic">—</span>}
            </p>

            <p className="text-[#5B5F4D]">Author</p>
            <p className={`font-mono break-all ${authorMatch ? "bg-[#FDF3E1] text-[#8C5C00] px-1 rounded" : "text-[#5B5F4D]"}`}>
              {dup.author || <span className="italic">—</span>}
            </p>
            <p className={`font-mono break-all ${authorMatch ? "bg-[#FDF3E1] text-[#8C5C00] px-1 rounded" : "text-[#5B5F4D]"}`}>
              {keeper.author || <span className="italic">—</span>}
            </p>

            {(dup.source_url || keeper.source_url) && (
              <>
                <p className="text-[#5B5F4D]">Source URL</p>
                <p className={`font-mono break-all ${urlMatch ? "bg-[#EEE9FB] text-[#6B46C1] px-1 rounded" : "text-[#5B5F4D]"}`}>
                  {dup.source_url || <span className="italic">—</span>}
                </p>
                <p className={`font-mono break-all ${urlMatch ? "bg-[#EEE9FB] text-[#6B46C1] px-1 rounded" : "text-[#5B5F4D]"}`}>
                  {keeper.source_url || <span className="italic">—</span>}
                </p>
              </>
            )}

            {linkMatch && (dup.shared_fanfic_urls || []).length > 0 && (
              <>
                <p className="text-[#5B5F4D]">Shared fanfic&nbsp;URLs</p>
                <p className="col-span-2 font-mono break-all bg-[#DCEBFA] text-[#1E4E8C] px-1 rounded">
                  {dup.shared_fanfic_urls.join(", ")}
                </p>
              </>
            )}

            {isHistorical && (
              <p className="col-span-3 mt-1 text-[10px] text-[#5B5F4D] italic">
                The keeper has an archived earlier version this upload matched against — you can promote this upload as a newer version.
              </p>
            )}
          </div>

          <div className="mt-3 pt-2 border-t border-dashed border-[#E5DDC5]">
            <button
              type="button"
              data-testid={`not-duplicate-${dup.book_id}`}
              disabled={busy}
              onClick={() => onNotDuplicate(dup.book_id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-white border border-[#5B5F4D]/30 text-[#5B5F4D] hover:bg-[#F5F1E4] hover:text-[#2C2C2C] disabled:opacity-50"
              title="Not a duplicate — un-quarantine and stop flagging this pair on future uploads"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
              This isn&apos;t a duplicate
            </button>
            <p className="mt-1 text-[10px] text-[#5B5F4D] italic">
              Adds the book to your library AND stops future uploads of the same title / author / URL from being flagged as a duplicate of this keeper.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function QuarantineRow({ dup, keeper, onResolve, onNotDuplicate, busyId, notDupBusyId }) {
  const busy = busyId === dup.book_id;
  return (
    <div
      data-testid={`quarantine-row-${dup.book_id}`}
      className="flex items-start gap-3 p-3 border-t border-[#E5DDC5] first:border-t-0"
    >
      <CoverThumb bookId={dup.book_id} hasCover={dup.has_cover} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-[#2C2C2C] truncate">{dup.title || "Untitled"}</p>
        <p className="text-xs text-[#5B5F4D] truncate">by {dup.author || "Unknown"}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {dup.match_reasons.map((r) => <ReasonBadge reason={r} key={r} />)}
        </div>
        <WhyPanel dup={dup} keeper={keeper} onNotDuplicate={onNotDuplicate} notDupBusyId={notDupBusyId} />
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          type="button"
          data-testid={`quarantine-keep-${dup.book_id}`}
          disabled={busy}
          onClick={() => onResolve(dup.book_id, "keep_both", keeper.book_id)}
          className="px-2 py-1 rounded text-[11px] font-medium bg-white border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#EDE7FB] disabled:opacity-50 inline-flex items-center gap-1"
          title="Keep both copies in the library"
        >
          <Copy className="w-3 h-3" /> Keep both
        </button>
        <button
          type="button"
          data-testid={`quarantine-promote-${dup.book_id}`}
          disabled={busy}
          onClick={() => onResolve(dup.book_id, "new_version", keeper.book_id)}
          className="px-2 py-1 rounded text-[11px] font-medium bg-[#6B46C1] text-white hover:bg-[#5C3AAD] disabled:opacity-50 inline-flex items-center gap-1"
          title="This becomes primary; existing copy moves to Old stories"
        >
          <ChevronsUp className="w-3 h-3" /> Promote
        </button>
        <button
          type="button"
          data-testid={`quarantine-historical-${dup.book_id}`}
          disabled={busy}
          onClick={() => onResolve(dup.book_id, "historical", keeper.book_id)}
          className="px-2 py-1 rounded text-[11px] font-medium bg-[#F5F1E4] text-[#5B5F4D] hover:bg-[#EDE7CE] disabled:opacity-50 inline-flex items-center gap-1"
          title="Archive as an old version of the keeper"
        >
          <Clock className="w-3 h-3" /> Historical
        </button>
        <button
          type="button"
          data-testid={`quarantine-discard-${dup.book_id}`}
          disabled={busy}
          onClick={() => onResolve(dup.book_id, "discard", keeper.book_id)}
          className="px-2 py-1 rounded text-[11px] font-medium bg-[#FBE2E0] text-[#7C2D2A] hover:bg-[#F5CBC7] disabled:opacity-50 inline-flex items-center gap-1"
          title="Soft-delete to Trash (30-day grace)"
        >
          <Trash2 className="w-3 h-3" /> Discard
        </button>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-[#5B5F4D] self-center" />}
      </div>
    </div>
  );
}

function QuarantineGroup({ group, onResolve, onNotDuplicate, onKeepLatest, busyId, notDupBusyId, groupBusy }) {
  const busy = groupBusy === group.keeper.book_id;
  // Compute which book would be the "latest" so we can show a hint.
  const rows = [
    { book_id: group.keeper.book_id, created_at: group.keeper.created_at || "", is_keeper: true, title: group.keeper.title || "" },
    ...group.duplicates.map((d) => ({ book_id: d.book_id, created_at: d.created_at || "", is_keeper: false, title: d.title || "" })),
  ];
  rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const winner = rows[0];
  const winnerLabel = winner.is_keeper
    ? "keeper stays, duplicates → Trash"
    : "newer copy promoted, keeper → Old stories, extras → Trash";

  return (
    <section
      data-testid={`quarantine-group-${group.keeper.book_id}`}
      className="shelf-card overflow-hidden"
    >
      <div className="bg-[#F5F1E4] px-4 py-2 flex flex-wrap items-center gap-2 border-b border-[#E5DDC5]">
        <Bookmark className="w-4 h-4 text-[#5B5F4D]" />
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#5B5F4D]">Keeper</span>
        <span className="text-[#5B5F4D]">·</span>
        <Link
          to={`/book/${group.keeper.book_id}`}
          data-testid={`quarantine-keeper-link-${group.keeper.book_id}`}
          className="text-sm font-medium text-[#2C2C2C] truncate hover:text-[#6B46C1] inline-flex items-center gap-1"
        >
          {group.keeper.title || "Untitled"} <ExternalLink className="w-3 h-3" />
        </Link>
        <span className="ml-auto text-[11px] text-[#5B5F4D]">
          {group.duplicates.length} duplicate{group.duplicates.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          data-testid={`quarantine-keep-latest-${group.keeper.book_id}`}
          disabled={busy}
          onClick={() => onKeepLatest(group.keeper.book_id, winnerLabel)}
          title={`Keep only the newest copy — ${winnerLabel}`}
          className="ml-2 px-2 py-1 rounded text-[11px] font-medium bg-[#EDE7FB] border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#DFD3F4] disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Keep only the latest
        </button>
      </div>
      <div>
        {group.duplicates.map((dup) => (
          <QuarantineRow
            key={dup.book_id}
            dup={dup}
            keeper={group.keeper}
            onResolve={onResolve}
            onNotDuplicate={onNotDuplicate}
            busyId={busyId}
            notDupBusyId={notDupBusyId}
          />
        ))}
      </div>
    </section>
  );
}

export default function Quarantine() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ count: 0, groups: [] });
  const [busyId, setBusyId] = useState(null);
  const [notDupBusyId, setNotDupBusyId] = useState(null);
  const [groupBusy, setGroupBusy] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/library/quarantine");
      setData(data);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load duplicates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = async (bookId, action, targetBookId) => {
    setBusyId(bookId);
    try {
      const { data: r } = await api.post(`/library/quarantine/${bookId}/resolve`, {
        action,
        target_book_id: targetBookId,
      });
      const msg = {
        keep_both: "Kept both",
        new_version: "Promoted — old copy archived",
        historical: "Archived as historical version",
        discard: "Moved to Trash",
      };
      toast.success(msg[r.action] || "Resolved");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't resolve");
    } finally {
      setBusyId(null);
    }
  };

  const notDuplicate = async (bookId) => {
    setNotDupBusyId(bookId);
    try {
      const { data: r } = await api.post(`/library/quarantine/${bookId}/not-duplicate`);
      const n = r?.dismissals_written || 0;
      toast.success(n > 0 ? "Added to library. Future re-uploads of this book won't be flagged." : "Added to library.");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't dismiss");
    } finally {
      setNotDupBusyId(null);
    }
  };

  const keepLatest = async (keeperBookId, winnerLabel) => {
    if (!window.confirm(`Keep only the newest copy — ${winnerLabel}?\n\nDiscarded copies land in Trash (30-day grace) so you can restore any of them.`)) {
      return;
    }
    setGroupBusy(keeperBookId);
    try {
      const { data: r } = await api.post(`/library/quarantine/group/${keeperBookId}/keep-latest`);
      const trashed = r?.trashed_count || 0;
      if (r?.promoted) {
        toast.success(`Newer copy promoted. Old keeper archived. ${trashed} extra copy${trashed === 1 ? "" : "ies"} → Trash.`);
      } else {
        toast.success(`Kept keeper. ${trashed} duplicate${trashed === 1 ? "" : "s"} → Trash.`);
      }
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't resolve group");
    } finally {
      setGroupBusy(null);
    }
  };

  const keepLatestAll = async () => {
    const groupCount = data.groups.length;
    const dupCount = data.count;
    if (groupCount === 0) return;
    const msg =
      `Resolve ALL ${groupCount} quarantine group${groupCount === 1 ? "" : "s"} by keeping only the newest copy in each?\n\n` +
      `~${dupCount} duplicate row${dupCount === 1 ? "" : "s"} will be reviewed. Everything except the newest copy per group lands in Trash (30-day grace, restorable).\n\n` +
      `This runs in batches of 100 so it stays under the 120-second edge timeout — you'll see live progress. Safe to leave the tab focused; do not close it.`;
    if (!window.confirm(msg)) return;

    setBulkBusy(true);
    // Snapshot the total we expect to process so the progress bar has a
    // stable denominator.  Race-lost groups from concurrent tabs still
    // count as "done" via has_more/remaining feedback.
    const totalTarget = groupCount;
    setBulkProgress({
      processed: 0,
      total: totalTarget,
      resolved: 0,
      promoted: 0,
      trashed: 0,
    });

    let cumResolved = 0;
    let cumPromoted = 0;
    let cumTrashed = 0;
    let cumProcessed = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 50; // safety cap: 50 * 100 = 5,000 groups max

    try {
      while (iterations < MAX_ITERATIONS) {
        iterations += 1;
        const { data: r } = await api.post(`/library/quarantine/keep-latest-all?limit=100`);
        cumResolved += r?.groups_resolved || 0;
        cumPromoted += r?.promoted_count || 0;
        cumTrashed += r?.trashed_count || 0;
        cumProcessed += r?.groups_processed || 0;
        setBulkProgress({
          processed: cumProcessed,
          total: Math.max(totalTarget, cumProcessed + (r?.remaining || 0)),
          resolved: cumResolved,
          promoted: cumPromoted,
          trashed: cumTrashed,
        });
        if (!r?.has_more) break;
      }

      toast.success(
        `Resolved ${cumResolved} group${cumResolved === 1 ? "" : "s"} · ${cumPromoted} promoted · ${cumTrashed} copy${cumTrashed === 1 ? "" : "ies"} → Trash.`,
        { duration: 6000 },
      );
      load();
    } catch (e) {
      toast.error(
        `Bulk paused after resolving ${cumResolved} group${cumResolved === 1 ? "" : "s"}. Click again to continue where it stopped.`,
      );
      load();
    } finally {
      setBulkBusy(false);
      // Keep the progress card visible for 8 s so the operator can read it.
      setTimeout(() => setBulkProgress(null), 8000);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-start gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#6B46C1]/15 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Duplicates</h1>
            <p className="text-[#5B5F4D] mt-1">
              Books whose upload matched something already on your shelf.  Auto-quarantined so bulk drops don&apos;t get interrupted — review at your own pace.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="w-8 h-8 text-[#6B46C1] animate-spin mx-auto" />
          </div>
        ) : data.count === 0 ? (
          <div data-testid="quarantine-empty" className="shelf-card p-10 text-center">
            <Layers className="w-10 h-10 text-[#5B5F4D]/40 mx-auto mb-4" />
            <p className="font-serif text-2xl text-[#2C2C2C]">No duplicates to review</p>
            <p className="text-sm text-[#5B5F4D] mt-2">When an upload matches a book already in your library, it lands here instead of the main grid.</p>
            <Link
              to="/library"
              data-testid="quarantine-empty-back-link"
              className="mt-4 inline-flex items-center gap-1 text-sm text-[#6B46C1] hover:underline"
            >
              Back to library <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="quarantine-toolbar">
              <p className="text-sm text-[#5B5F4D]" data-testid="quarantine-summary">
                <span className="font-semibold text-[#2C2C2C]">{data.count}</span> duplicate{data.count === 1 ? "" : "s"} across{" "}
                <span className="font-semibold text-[#2C2C2C]">{data.groups.length}</span> group{data.groups.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                data-testid="quarantine-keep-latest-all"
                disabled={bulkBusy || data.groups.length === 0}
                onClick={keepLatestAll}
                title="Resolve every group by keeping the newest copy in each. Runs in batches of 100 to stay under the 120s edge timeout."
                className="ml-auto px-3 py-1.5 rounded text-xs font-medium bg-[#6B46C1] text-white hover:bg-[#5834A8] disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
              >
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Keep the latest in all {data.groups.length} group{data.groups.length === 1 ? "" : "s"}
              </button>
            </div>

            {bulkProgress && (
              <div
                data-testid="quarantine-bulk-progress"
                className="mb-4 p-3 rounded border border-[#6B46C1]/30 bg-[#EDE7FB] text-sm"
              >
                <div className="flex items-center gap-2 mb-2 text-[#4A2E9B]">
                  {bulkBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span className="font-semibold">
                    {bulkBusy ? "Resolving groups…" : "Done."}
                  </span>
                  <span className="ml-auto text-xs tabular-nums" data-testid="quarantine-bulk-progress-count">
                    {bulkProgress.processed.toLocaleString()} / {bulkProgress.total.toLocaleString()} groups
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-white overflow-hidden border border-[#6B46C1]/20">
                  <div
                    className="h-full bg-[#6B46C1] transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((bulkProgress.processed / Math.max(1, bulkProgress.total)) * 100))}%`,
                    }}
                    data-testid="quarantine-bulk-progress-bar"
                  />
                </div>
                <p className="mt-2 text-[11px] text-[#4A2E9B] tabular-nums">
                  {bulkProgress.resolved.toLocaleString()} resolved · {bulkProgress.promoted.toLocaleString()} promoted · {bulkProgress.trashed.toLocaleString()} → Trash
                </p>
              </div>
            )}
            <div className="space-y-4">
              {data.groups.map((g) => (
                <QuarantineGroup
                  key={g.keeper.book_id}
                  group={g}
                  onResolve={resolve}
                  onNotDuplicate={notDuplicate}
                  onKeepLatest={keepLatest}
                  busyId={busyId}
                  notDupBusyId={notDupBusyId}
                  groupBusy={groupBusy}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
