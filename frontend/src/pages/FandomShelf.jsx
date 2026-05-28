import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { ArrowLeft, Download, Link as LinkIcon, Search, BookOpen } from "lucide-react";

export default function FandomShelf() {
  const params = useParams();
  const navigate = useNavigate();
  const fandom = decodeURIComponent(params.fandom || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/books", {
        params: { category: "Fanfiction", fandom, ...(search ? { q: search } : {}) },
      });
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  }, [fandom, search]);

  useEffect(() => { load(); }, [load]);

  const exportZip = () => {
    const url = new URL(`${API}/books/export/zip`);
    url.searchParams.set("category", "Fanfiction");
    url.searchParams.set("fandom", fandom);
    window.open(url.toString(), "_blank");
  };

  const exportLinks = () => {
    const url = new URL(`${API}/books/export/links`);
    url.searchParams.set("category", "Fanfiction");
    url.searchParams.set("fandom", fandom);
    window.open(url.toString(), "_blank");
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          data-testid="back-to-library"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2">
              Fanfiction · Fandom shelf
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05]" data-testid="fandom-title">
              {fandom}
            </h1>
            <p className="text-[#6B705C] mt-3">
              {loading
                ? "Loading shelf…"
                : `${books.length} book${books.length === 1 ? "" : "s"} on this shelf`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="fandom-export-links"
              onClick={exportLinks}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <LinkIcon className="w-4 h-4" />
              {fandom} links (.txt)
            </button>
            <button
              data-testid="fandom-export-zip"
              onClick={exportZip}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download {fandom} ZIP
            </button>
          </div>
        </div>

        <div className="relative mb-8 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
          <input
            data-testid="fandom-search"
            type="text"
            placeholder={`Search within ${fandom}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <BookOpen className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              No {fandom} books yet
            </h2>
            <p className="text-[#6B705C] mb-6">
              Upload an EPUB and we'll route any {fandom} fanfic onto this shelf automatically.
            </p>
            <Link to="/library" className="btn-primary text-sm inline-block">
              Go upload
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="fandom-books-grid">
            {books.map((b) => (
              <BookCard key={b.book_id} book={b} onChanged={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
