import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import {
  ArrowLeft,
  Trash2,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Clock,
  Info,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { getNudgePref } from "../lib/nudgePrefs";

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Absolute date — always shown as "Aug 22, 2026 · 3:14 pm" so users
// have a permanent reference even if the "3 days ago" chip fades.
function formatAbsolute(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Relative age of a past date — "today", "yesterday", "3 days ago",
// "2 weeks ago", "1 month ago".  Kept coarse on purpose so the row
// stays scannable at a glance.
function formatRelativePast(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const deltaMs = Date.now() - d.getTime();
    if (deltaMs < 0) return "just now";
    const mins = Math.floor(deltaMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 14) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 8) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  } catch {
    return "";
  }
}

// "X days left" / "expires today" / "expired" for the auto-delete
// countdown — shows the same information the sweep_expired_trash job
// will act on so users can plan a restore before it's too late.
function formatExpiry(iso) {
  if (!iso) return { text: "no expiry", urgent: false };
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { text: "no expiry", urgent: false };
    const deltaMs = d.getTime() - Date.now();
    if (deltaMs < 0) return { text: "expired — sweeps at next daily run", urgent: true };
    const days = Math.ceil(deltaMs / 86400000);
    if (days === 0) return { text: "expires today", urgent: true };
    if (days === 1) return { text: "1 day left", urgent: true };
    if (days <= 3) return { text: `${days} days left`, urgent: true };
    return { text: `${days} days left`, urgent: false };
  } catch {
    return { text: "", urgent: false };
  }
}

export default function Trash() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ books: [], count: 0, grace_days: 30 });
  const [emptying, setEmptying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/trash");
      setData(data);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load Trash");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (bookId) => {
    try {
      await api.post(`/trash/restore/${bookId}`);
      toast.success("Restored");
      load();
    } catch {
      toast.error("Couldn't restore");
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm(`Permanently delete all ${data.count} book${data.count === 1 ? "" : "s"} in Trash? This can't be undone.`)) return;
    setEmptying(true);
    try {
      const { data: r } = await api.post("/trash/empty");
      const deleted = r?.deleted || 0;
      const freed = r?.bytes_freed || 0;
      if (deleted > 0 && getNudgePref("trash_emptied_cheer")) {
        const freedText = freed > 0 ? `, ${formatBytes(freed)} reclaimed` : "";
        toast.success(
          `✨ Trash emptied — ${deleted} book${deleted === 1 ? "" : "s"} gone${freedText}.`,
          { duration: 6000 },
        );
      } else {
        toast.success(`Permanently deleted ${deleted}`);
      }
      load();
    } catch {
      toast.error("Couldn't empty Trash");
    } finally {
      setEmptying(false);
    }
  };

  const restoreAll = async () => {
    try {
      const { data: r } = await api.post("/trash/restore-all");
      toast.success(`Restored ${r.restored} book${r.restored === 1 ? "" : "s"}`);
      load();
    } catch {
      toast.error("Couldn't restore all");
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link
          to="/library"
          className="inline-flex items-center gap-1 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-4"
          data-testid="trash-back-link"
        >
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-start gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#6B705C]/15 text-[#5B5F4D] flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Trash</h1>
            <p className="text-[#5B5F4D] mt-1">
              Discarded books wait here for <strong>{data.grace_days} days</strong> before they&apos;re permanently deleted. Every row shows <em>when</em> and <em>why</em> a book was trashed so you can undo it with confidence.
            </p>
          </div>
          {data.count > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                data-testid="restore-all-btn"
                onClick={restoreAll}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#EDE7FB] inline-flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" /> Restore all
              </button>
              <button
                data-testid="empty-trash-btn"
                onClick={emptyTrash}
                disabled={emptying}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {emptying && <Loader2 className="w-4 h-4 animate-spin" />}
                Empty trash
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mx-auto" />
          </div>
        ) : data.count === 0 ? (
          <div data-testid="trash-empty" className="shelf-card p-10 text-center">
            <Trash2 className="w-10 h-10 text-[#5B5F4D]/40 mx-auto mb-4" />
            <p className="font-serif text-2xl text-[#2C2C2C]">Trash is empty</p>
            <p className="text-sm text-[#5B5F4D] mt-2">
              When you discard duplicates or delete books, they&apos;ll wait here for {data.grace_days} days so you can change your mind.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="shelf-card p-4 flex items-center gap-3 bg-amber-50/60 border-amber-200"
              data-testid="trash-summary-banner"
            >
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-sm text-[#2C2C2C]">
                <strong>{data.count} book{data.count === 1 ? "" : "s"}</strong> in trash. Books are permanently deleted <strong>{data.grace_days} days</strong> after they&apos;re moved here.
              </p>
            </div>
            {data.books.map((b) => {
              const expiry = formatExpiry(b.trash_expires_at);
              const trashedAbs = formatAbsolute(b.trashed_at);
              const trashedRel = formatRelativePast(b.trashed_at);
              const reason = b.trash_reason || "Removed from library";
              const prevCat = b.trash_prev_category;
              return (
                <div
                  key={b.book_id}
                  data-testid={`trash-row-${b.book_id}`}
                  className="shelf-card p-4 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#F1EEE5] text-[#5B5F4D] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Title (primary, biggest) + author on the same row. */}
                      <p className="font-serif text-base text-[#2C2C2C] leading-tight truncate">
                        {b.title || "Untitled"}
                      </p>
                      <p className="text-xs text-[#5B5F4D] mt-0.5 truncate">
                        by {b.author || "Unknown"}
                      </p>

                      {/* Audit strip — WHEN + WHY.  Stack cleanly on mobile. */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
                        {/* Trashed date */}
                        {trashedAbs ? (
                          <span
                            className="inline-flex items-center gap-1 text-[#5B5F4D]"
                            data-testid={`trash-date-${b.book_id}`}
                            title={`Moved to Trash on ${trashedAbs}`}
                          >
                            <Clock className="w-3 h-3" />
                            Trashed <span className="text-[#2C2C2C]">{trashedRel}</span>
                            <span className="text-[#7A7457]">· {trashedAbs}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[#7A7457] italic"
                            data-testid={`trash-date-${b.book_id}`}
                            title="This book was trashed before Shelfsort started recording dates on 2026-08-24."
                          >
                            <Clock className="w-3 h-3" />
                            Trashed before 2026-08-24
                          </span>
                        )}
                        {/* Reason chip */}
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EDE7FB] text-[#6B46C1] font-medium"
                          data-testid={`trash-reason-${b.book_id}`}
                          title={prevCat ? `Was previously in shelf "${prevCat}"` : "Reason this book was moved to Trash"}
                        >
                          <Info className="w-3 h-3" />
                          {reason}
                        </span>
                        {/* Previous shelf hint — helps users decide whether to restore */}
                        {prevCat && (
                          <span
                            className="text-[#7A7457]"
                            data-testid={`trash-prev-shelf-${b.book_id}`}
                          >
                            was on&nbsp;<span className="italic text-[#2C2C2C]">{prevCat}</span>
                          </span>
                        )}
                        {/* Expiry countdown — colour-coded for urgency */}
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            expiry.urgent ? "text-[#B04A2A]" : "text-amber-700"
                          }`}
                          data-testid={`trash-expiry-${b.book_id}`}
                          title="Once this counts down to zero the book is permanently deleted."
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {expiry.text}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    data-testid={`trash-restore-${b.book_id}`}
                    onClick={() => restore(b.book_id)}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-white border border-[#6B46C1]/30 text-[#6B46C1] hover:bg-[#EDE7FB] inline-flex items-center gap-1 flex-shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
