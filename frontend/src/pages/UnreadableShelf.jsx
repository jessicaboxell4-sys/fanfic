import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, FileWarning, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// "Unreadable files" shelf — books we filed at upload time but couldn't
// actually parse (corrupt EPUB zip) or convert (Calibre rejected a PDF /
// Kindle / DOCX). The original bytes are still on disk so the user can
// download them locally, inspect, and either fix-and-reupload or delete.
export default function UnreadableShelf() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [byReason, setByReason] = useState({ corrupt_epub: 0, failed_conversion: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/unreadable");
        if (!cancelled) {
          setBooks(data?.books || []);
          setByReason(data?.by_reason || { corrupt_epub: 0, failed_conversion: 0 });
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return books.filter((b) => {
      if (reasonFilter && b.reason !== reasonFilter) return false;
      if (!needle) return true;
      return (
        (b.title || "").toLowerCase().includes(needle) ||
        (b.author || "").toLowerCase().includes(needle) ||
        (b.filename || "").toLowerCase().includes(needle)
      );
    });
  }, [books, search, reasonFilter]);

  const handleDownload = async (b) => {
    try {
      const resp = await api.get(b.download_path, { responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = b.filename || `${b.book_id}.${b.original_format || "bin"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Couldn't download the original file.");
    }
  };

  const handleDelete = async (b) => {
    if (!window.confirm(`Delete "${b.title || b.filename}" permanently?\n\nThis removes the file from disk — there's no undo.`)) return;
    setDeletingId(b.book_id);
    try {
      await api.delete(`/books/${b.book_id}`);
      toast.success("Removed.");
      setBooks((prev) => prev.filter((x) => x.book_id !== b.book_id));
      setByReason((prev) => ({ ...prev, [b.reason]: Math.max(0, (prev[b.reason] || 0) - 1) }));
    } catch {
      toast.error("Couldn't delete that book.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatBytes = (n) => {
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const reasonLabel = (r) => r === "corrupt_epub" ? "Corrupt EPUB" : "Failed conversion";
  const reasonHint = (r) => r === "corrupt_epub"
    ? "The EPUB zip couldn't be opened — usually means the file is damaged."
    : "Calibre couldn't convert this file to EPUB. Try opening it locally and re-export.";

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="unreadable-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <FileWarning className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Unreadable files</h1>
            <p className="text-sm text-[#6B705C] mt-1 max-w-2xl">
              Books we couldn&apos;t parse at upload time. The original bytes are still on disk — download a copy to inspect it locally, or delete it if you don&apos;t want to keep it.
            </p>
          </div>
        </header>

        {/* Stats + reason filter */}
        <div className="shelf-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="unreadable-summary">
          <div className="flex-shrink-0">
            <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="unreadable-count">{books.length}</div>
            <div className="text-xs text-[#6B705C] uppercase tracking-wide">unreadable file{books.length === 1 ? "" : "s"}</div>
          </div>
          {books.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center" data-testid="unreadable-by-reason">
              <button
                onClick={() => setReasonFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${reasonFilter === "" ? "bg-[#E07A5F] text-white border-[#E07A5F]" : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"}`}
              >
                All · {books.length}
              </button>
              {byReason.corrupt_epub > 0 && (
                <button
                  onClick={() => setReasonFilter(reasonFilter === "corrupt_epub" ? "" : "corrupt_epub")}
                  data-testid="unreadable-reason-corrupt"
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${reasonFilter === "corrupt_epub" ? "bg-[#900] text-white border-[#900]" : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"}`}
                >
                  Corrupt EPUB · {byReason.corrupt_epub}
                </button>
              )}
              {byReason.failed_conversion > 0 && (
                <button
                  onClick={() => setReasonFilter(reasonFilter === "failed_conversion" ? "" : "failed_conversion")}
                  data-testid="unreadable-reason-conversion"
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${reasonFilter === "failed_conversion" ? "bg-[#3A5A40] text-white border-[#3A5A40]" : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"}`}
                >
                  Failed conversion · {byReason.failed_conversion}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B705C]" />
          <input
            type="search"
            data-testid="unreadable-search"
            placeholder="Search title, author, or filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#E07A5F]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            {books.length === 0 ? (
              <>
                <FileWarning className="w-10 h-10 mx-auto mb-3 text-[#3A5A40]" />
                <p className="font-medium text-[#2C2C2C] mb-1">No unreadable files.</p>
                <p className="text-sm">Every upload was parsed successfully — nice library hygiene.</p>
              </>
            ) : (
              <p className="text-sm italic">No files match your filter.</p>
            )}
          </div>
        ) : (
          <ul className="space-y-3" data-testid="unreadable-list">
            {filtered.map((b) => (
              <li
                key={b.book_id}
                className="shelf-card p-4"
                data-testid={`unreadable-book-${b.book_id}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-[#2C2C2C] truncate" title={b.title}>
                        {b.title || "Untitled"}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap ${
                          b.reason === "corrupt_epub"
                            ? "bg-[#900]/10 text-[#900]"
                            : "bg-[#3A5A40]/10 text-[#3A5A40]"
                        }`}
                        title={reasonHint(b.reason)}
                      >
                        {reasonLabel(b.reason)}
                      </span>
                      {b.original_format && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C] uppercase tracking-wide">
                          .{b.original_format}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6B705C] truncate">
                      {b.author || "Unknown"} · {b.filename}
                      {b.size_bytes ? <> · {formatBytes(b.size_bytes)}</> : null}
                    </div>
                    {b.error && (
                      <div className="text-xs text-[#900]/80 mt-2 font-mono whitespace-pre-wrap break-words" data-testid={`unreadable-error-${b.book_id}`}>
                        {b.error}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDownload(b)}
                      data-testid={`unreadable-download-${b.book_id}`}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[#E5DDC5] bg-white text-[#2C2C2C] hover:bg-[#F5F3EC] transition-colors"
                      title="Download the original file"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </button>
                    <button
                      onClick={() => handleDelete(b)}
                      disabled={deletingId === b.book_id}
                      data-testid={`unreadable-delete-${b.book_id}`}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[#900]/30 bg-white text-[#900] hover:bg-[#900] hover:text-white transition-colors disabled:opacity-50"
                      title="Delete this book and its file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingId === b.book_id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
