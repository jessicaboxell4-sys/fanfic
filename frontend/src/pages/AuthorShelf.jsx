import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { ArrowLeft, Search, UserCircle2 } from "lucide-react";

export default function AuthorShelf() {
  const params = useParams();
  const navigate = useNavigate();
  const author = decodeURIComponent(params.name || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/authors/${encodeURIComponent(author)}`);
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  }, [author]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? books.filter(
        b =>
          (b.title || "").toLowerCase().includes(search.toLowerCase()) ||
          (b.fandom || "").toLowerCase().includes(search.toLowerCase())
      )
    : books;

  // Group books by category for a clearer summary
  const grouped = filtered.reduce((acc, b) => {
    const key = b.category || "Unclassified";
    acc[key] = acc[key] || 0;
    acc[key] += 1;
    return acc;
  }, {});
  const groupSummary = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count})`)
    .join(" · ");

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
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#FDF3E1] text-[#E07A5F] flex items-center justify-center flex-shrink-0">
              <UserCircle2 className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
                Author shelf
              </p>
              <h1
                className="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#2C2C2C] leading-[1.05]"
                data-testid="author-title"
              >
                {author}
              </h1>
              <p className="text-[#6B705C] mt-3">
                {loading
                  ? "Loading shelf…"
                  : `${books.length} book${books.length === 1 ? "" : "s"} on this shelf`}
              </p>
              {!loading && groupSummary && (
                <p className="text-xs text-[#6B705C] mt-1">{groupSummary}</p>
              )}
            </div>
          </div>
        </div>

        <div className="relative mb-8 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C]" />
          <input
            data-testid="author-search"
            type="text"
            placeholder={`Search within ${author}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E8E6E1] rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] py-12 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 shelf-card">
            <UserCircle2 className="w-12 h-12 text-[#E07A5F] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              No books by {author} match
            </h2>
            <p className="text-[#6B705C] mb-6">
              {books.length === 0
                ? `We haven't catalogued anything by ${author} yet.`
                : "Try a different search term."}
            </p>
            <Link to="/library" className="btn-primary text-sm inline-block">
              Back to library
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6" data-testid="author-books-grid">
            {filtered.map((b) => (
              <BookCard key={b.book_id} book={b} onChanged={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
