import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import Navbar from "../components/Navbar";
import BookCard from "../components/BookCard";
import { api } from "../lib/api";

// `/library/recently-added` — persistent shelf view of the user's most
// recently created books.  This is the cross-device, refresh-resistant
// counterpart to the BackgroundJobsBell's "?just_added=…" deep link,
// which only survives the upload session.
//
// Implementation: hit /api/books (already sorted by created_at desc)
// and slice the top N — no new endpoint needed.  Honors `?days=` query
// param if the user wants a tighter window (defaults to 14 days).
const DEFAULT_LIMIT = 60;
const DEFAULT_DAYS = 14;

export default function RecentlyAddedPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(DEFAULT_DAYS);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = parseInt(params.get("days") || "", 10);
    if (Number.isFinite(d) && d > 0 && d <= 365) setDays(d);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/books", { params: { include_originals: false } });
        const all = data?.books || [];
        // Filter by created_at window then take top N.
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const recent = all.filter((b) => {
          const ts = b.created_at ? Date.parse(b.created_at) : NaN;
          return Number.isFinite(ts) && ts >= cutoff;
        });
        if (!cancelled) setBooks(recent.slice(0, DEFAULT_LIMIT));
      } catch {
        if (!cancelled) setBooks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-12 fade-in" data-testid="recently-added-page">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6">
          <ArrowLeft className="w-4 h-4" /> Library
        </Link>

        <header className="mb-8 flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Recently added
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05] tracking-tight">
              Books that just landed.
            </h1>
            <p className="text-[#5B5F4D] mt-3 text-base sm:text-lg">
              Added in the last {days} {days === 1 ? "day" : "days"}, newest first.
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" role="radiogroup" aria-label="Time window">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                data-testid={`recently-added-window-${d}`}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  days === d
                    ? "bg-[#6B46C1] text-white"
                    : "border border-[#E5DDC5] text-[#5B5F4D] hover:bg-white"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="text-center py-16 text-[#5B5F4D]" data-testid="recently-added-loading">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            Pulling your latest arrivals…
          </div>
        ) : books.length === 0 ? (
          <div className="shelf-card p-10 text-center text-[#5B5F4D]" data-testid="recently-added-empty">
            <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-60" />
            Nothing new in this window. Try a longer one above, or{" "}
            <Link to="/library" className="text-[#6B46C1] underline font-semibold">
              go upload some books
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5" data-testid="recently-added-grid">
            {books.map((b) => (
              <BookCard
                key={b.book_id}
                book={b}
                onClick={() => navigate(`/book/${b.book_id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
