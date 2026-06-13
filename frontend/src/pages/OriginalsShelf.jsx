import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import Navbar from "../components/Navbar";

// Books the user chose to keep in their ORIGINAL format (PDF, MOBI, AZW,
// DOCX, etc.) without running Calibre conversion. They live here, away
// from the main EPUB library, so the reader / shelves / stats stay clean.
export default function OriginalsShelf() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [skipDups, setSkipDups] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/originals");
        if (!cancelled) setBooks(data?.books || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const convertOne = async (book) => {
    if (!window.confirm(
      `Convert "${book.title}" to EPUB? Calibre will run server-side — the file will move from Originals into your main library and become readable in the in-app reader.`,
    )) return;
    setConvertingId(book.book_id);
    try {
      const { data } = await api.post(`/library/originals/${book.book_id}/convert`);
      if (data?.ok) {
        setBooks((bs) => bs.filter((b) => b.book_id !== book.book_id));
        toast.success(`Converted "${data.book?.title || book.title}" — now in your main library`);
      } else {
        toast.error(`Conversion failed: ${data?.error || "unknown error"}`);
      }
    } catch (e) {
      toast.error("Conversion failed — try again");
    } finally {
      setConvertingId(null);
    }
  };

  const convertAll = async () => {
    const candidates = skipDups
      ? books.filter((b) => (b.cross_format_duplicate_of || []).length === 0)
      : books;
    if (candidates.length === 0) {
      toast("Nothing to convert with these settings");
      return;
    }
    if (!window.confirm(
      `Convert ${candidates.length} file${candidates.length === 1 ? "" : "s"} to EPUB? Calibre will run for each — this can take a while for large batches.`,
    )) return;
    setBulkRunning(true);
    try {
      const { data } = await api.post(
        `/library/originals/convert-all${skipDups ? "?skip_dups=true" : ""}`,
      );
      // Reload list to reflect the converted books (they no longer have original_only=true).
      const fresh = await api.get("/library/originals");
      setBooks(fresh.data?.books || []);
      if (data?.failed?.length > 0) {
        toast.error(`${data.converted}/${data.scanned} converted · ${data.failed.length} failed`);
      } else {
        toast.success(`Converted ${data.converted}/${data.scanned} file${data.scanned === 1 ? "" : "s"} to EPUB`);
      }
    } catch (e) {
      toast.error("Bulk conversion failed");
    } finally {
      setBulkRunning(false);
    }
  };

  const dupCount = books.filter((b) => (b.cross_format_duplicate_of || []).length > 0).length;

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link
          to="/library"
          data-testid="originals-back"
          className="inline-flex items-center gap-1.5 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>

        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B705C] mb-2">
            Originals · kept as-is
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05]" data-testid="originals-title">
            Original-format library
          </h1>
          <p className="text-[#6B705C] mt-2">
            {loading
              ? "Loading…"
              : `${books.length} file${books.length === 1 ? "" : "s"} kept in their original format. These aren't readable in the in-app reader — download to use them.`}
          </p>
          {dupCount > 0 && (
            <div
              data-testid="originals-dup-banner"
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-[#FDF3E1] text-[#6B46C1] border border-[#6B46C1]/30"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {dupCount} file{dupCount === 1 ? "" : "s"} duplicate{dupCount === 1 ? "s" : ""} an EPUB you already have
            </div>
          )}
        </div>

        {!loading && books.length > 0 && (
          <div
            data-testid="originals-bulk-panel"
            className="shelf-card p-4 mb-4 flex flex-wrap items-center gap-3"
          >
            <span className="text-xs font-bold uppercase tracking-wide text-[#6B46C1]">Bulk convert</span>
            <label className="flex items-center gap-2 text-sm text-[#6B705C]">
              <input
                type="checkbox"
                checked={skipDups}
                onChange={(e) => setSkipDups(e.target.checked)}
                data-testid="bulk-skip-dups"
                className="accent-[#E07A5F]"
              />
              Skip ones already in your EPUB library
            </label>
            <button
              onClick={convertAll}
              disabled={bulkRunning}
              data-testid="bulk-convert-all"
              className="ml-auto px-4 py-2 rounded-lg text-sm font-medium bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-60 inline-flex items-center gap-2"
            >
              {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Convert all{skipDups
                ? ` (${books.filter((b) => (b.cross_format_duplicate_of || []).length === 0).length})`
                : ` (${books.length})`}
            </button>
          </div>
        )}

        {!loading && books.length === 0 && (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            No originals yet. When uploading a PDF/MOBI/AZW/DOCX/etc., choose &quot;Keep originals&quot; at the prompt to land them here.
          </div>
        )}

        <div className="space-y-2">
          {books.map((b) => {
            const isDup = (b.cross_format_duplicate_of || []).length > 0;
            return (
              <div
                key={b.book_id}
                data-testid={`original-row-${b.book_id}`}
                className={`shelf-card p-4 flex items-center gap-4 ${isDup ? "border-[#6B46C1]/40" : ""}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDup ? "bg-[#6B46C1]/10 text-[#6B46C1]" : "bg-[#6B46C1]/10 text-[#6B46C1]"}`}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#2C2C2C] truncate">{b.title || "Untitled"}</div>
                  <div className="text-xs text-[#6B705C] truncate">
                    {b.author || "Unknown"} · .{(b.original_format || "").toUpperCase()} · {Math.round((b.size_bytes || 0) / 1024)} KB
                  </div>
                  {isDup && (
                    <div className="text-xs text-[#6B46C1] mt-1 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Also in your EPUB library
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => convertOne(b)}
                    disabled={convertingId === b.book_id}
                    data-testid={`original-convert-${b.book_id}`}
                    title="Run Calibre — move this file out of Originals and into the main library"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    {convertingId === b.book_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Convert to EPUB
                  </button>
                  <a
                    href={`${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/download`}
                    download
                    data-testid={`original-download-${b.book_id}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f]"
                  >
                    Download
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
