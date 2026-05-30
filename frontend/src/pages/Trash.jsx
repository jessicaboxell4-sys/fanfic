import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { ArrowLeft, Trash2, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

function formatExpiry(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
    if (days === 0) return "expires today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  } catch {
    return "";
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
    } catch (e) {
      toast.error("Couldn't restore");
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm(`Permanently delete all ${data.count} book${data.count === 1 ? "" : "s"} in Trash? This can't be undone.`)) return;
    setEmptying(true);
    try {
      const { data: r } = await api.post("/trash/empty");
      toast.success(`Permanently deleted ${r.deleted}`);
      load();
    } catch (e) {
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
    } catch (e) {
      toast.error("Couldn't restore all");
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-start gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#6B705C]/15 text-[#6B705C] flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h1 className="font-serif text-4xl text-[#2C2C2C] leading-tight">Trash</h1>
            <p className="text-[#6B705C] mt-1">
              Auto-discarded duplicates land here. Books are permanently deleted after {data.grace_days} days.
            </p>
          </div>
          {data.count > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                data-testid="restore-all-btn"
                onClick={restoreAll}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#3A5A40]/30 text-[#3A5A40] hover:bg-[#E5EBE6] inline-flex items-center gap-2"
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
            <Trash2 className="w-10 h-10 text-[#6B705C]/40 mx-auto mb-4" />
            <p className="font-serif text-2xl text-[#2C2C2C]">Trash is empty</p>
            <p className="text-sm text-[#6B705C] mt-2">When you discard duplicates, they'll wait here for {data.grace_days} days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="shelf-card p-4 flex items-center gap-3 bg-amber-50/60 border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-sm text-[#2C2C2C]">
                {data.count} book{data.count === 1 ? "" : "s"} in trash · auto-deleted after {data.grace_days} days
              </p>
            </div>
            {data.books.map((b) => (
              <div
                key={b.book_id}
                data-testid={`trash-row-${b.book_id}`}
                className="shelf-card p-4 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#2C2C2C] truncate">{b.title || "Untitled"}</p>
                  <p className="text-xs text-[#6B705C] truncate">
                    by {b.author || "Unknown"} · <span className="text-amber-700 font-medium">{formatExpiry(b.trash_expires_at)}</span>
                  </p>
                </div>
                <button
                  data-testid={`trash-restore-${b.book_id}`}
                  onClick={() => restore(b.book_id)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-white border border-[#3A5A40]/30 text-[#3A5A40] hover:bg-[#E5EBE6] inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
