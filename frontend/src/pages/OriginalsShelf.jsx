import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, AlertTriangle, ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Books the user chose to keep in their ORIGINAL format (PDF, MOBI, AZW,
// DOCX, etc.) without running Calibre conversion. They live here, away
// from the main EPUB library, so the reader / shelves / stats stay clean.
export default function OriginalsShelf() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

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
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-[#FDF3E1] text-[#900] border border-[#900]/30"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {dupCount} file{dupCount === 1 ? "" : "s"} duplicate{dupCount === 1 ? "s" : ""} an EPUB you already have
            </div>
          )}
        </div>

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
                className={`shelf-card p-4 flex items-center gap-4 ${isDup ? "border-[#900]/40" : ""}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDup ? "bg-[#900]/10 text-[#900]" : "bg-[#3A5A40]/10 text-[#3A5A40]"}`}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#2C2C2C] truncate">{b.title || "Untitled"}</div>
                  <div className="text-xs text-[#6B705C] truncate">
                    {b.author || "Unknown"} · .{(b.original_format || "").toUpperCase()} · {Math.round((b.size_bytes || 0) / 1024)} KB
                  </div>
                  {isDup && (
                    <div className="text-xs text-[#900] mt-1 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Also in your EPUB library
                    </div>
                  )}
                </div>
                <a
                  href={`${process.env.REACT_APP_BACKEND_URL}/api/books/${b.book_id}/download`}
                  download
                  data-testid={`original-download-${b.book_id}`}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f]"
                >
                  Download
                </a>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
