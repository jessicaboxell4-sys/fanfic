import React, { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, Sparkles, GitCompare, CheckCheck } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000; // seconds
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function UpdatesBell() {
  const [updates, setUpdates] = useState([]);
  const [totalUnseen, setTotalUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/books/recent-updates", { params: { limit: 8 } });
      setUpdates(data.updates || []);
      setTotalUnseen(data.total_unseen || 0);
    } catch (e) {
      // Silent fail — bell just stays empty
    }
  }, []);

  // Initial + 60s poll
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllSeen = async () => {
    setLoading(true);
    try {
      const { data } = await api.post("/books/mark-updates-seen");
      toast.success(
        data.marked > 0 ? `Marked ${data.marked} updates as seen` : "All caught up"
      );
      setUpdates([]);
      setTotalUnseen(0);
      setOpen(false);
    } catch (e) {
      toast.error("Couldn't mark updates as seen");
    } finally {
      setLoading(false);
    }
  };

  if (totalUnseen === 0) {
    return null; // hide entirely when there's nothing to see
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative btn-secondary text-sm flex items-center gap-2"
        title={`${totalUnseen} ${totalUnseen === 1 ? "fic" : "fics"} updated`}
        data-testid="updates-bell-btn"
        aria-label="Recently updated fanfics"
      >
        <Bell className="w-4 h-4" />
        <span className="hidden md:inline">
          {totalUnseen} updated
        </span>
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E07A5F] text-white text-[10px] font-bold flex items-center justify-center"
          data-testid="updates-bell-badge"
        >
          {totalUnseen > 9 ? "9+" : totalUnseen}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white border border-[#E8E6E1] shadow-2xl overflow-hidden z-50"
          data-testid="updates-bell-popover"
        >
          <div className="px-4 py-3 bg-[#FDF3E1] border-b border-[#B87A00]/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#B87A00]" />
              <span className="font-serif text-base text-[#2C2C2C]">Recently updated</span>
            </div>
            <button
              onClick={markAllSeen}
              disabled={loading}
              className="text-xs text-[#3A5A40] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
              data-testid="updates-bell-mark-all"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all seen
            </button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-[#F1EFE8]">
            {updates.length === 0 && (
              <li className="px-4 py-6 text-sm text-[#6E6E6E] text-center">
                No updates pending.
              </li>
            )}
            {updates.map((u) => {
              const rs = u.refresh_summary || {};
              const added = rs.chapters_added || 0;
              const changed = rs.chapters_changed || 0;
              return (
                <li key={u.book_id}>
                  <Link
                    to={`/book/${u.book_id}/compare`}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-[#FBF7EE] transition-colors"
                    data-testid={`updates-bell-item-${u.book_id}`}
                  >
                    <p className="font-serif text-sm text-[#2C2C2C] line-clamp-1 mb-0.5">
                      {u.title}
                    </p>
                    <p className="text-xs text-[#6E6E6E] line-clamp-1 mb-2">
                      {u.author}
                      {u.fandom ? ` · ${u.fandom}` : ""}
                    </p>
                    <div className="flex items-center gap-3 text-xs">
                      {added > 0 && (
                        <span className="inline-flex items-center gap-1 text-[#3A5A40] font-semibold">
                          +{added} new chapter{added === 1 ? "" : "s"}
                        </span>
                      )}
                      {changed > 0 && (
                        <span className="inline-flex items-center gap-1 text-[#B87A00] font-semibold">
                          {changed} edited
                        </span>
                      )}
                      {added === 0 && changed === 0 && (
                        <span className="text-[#6E6E6E]">Refreshed</span>
                      )}
                      <span className="ml-auto text-[#6E6E6E]">
                        {formatRelative(u.last_refreshed_at)}
                      </span>
                    </div>
                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-[#3A5A40] hover:underline">
                      <GitCompare className="h-3 w-3" />
                      See what changed
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
