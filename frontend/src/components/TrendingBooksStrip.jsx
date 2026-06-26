import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Heart, Sparkles, Loader2 } from "lucide-react";
import { api } from "../lib/api";

// Consumption-side counterpart to FeaturedReadersStrip — surfaces the
// most-hearted books across all opted-in public libraries in the last
// 7 days.  Pulls from /api/books/trending (anon-accessible).  Silent
// when there are no recent hearts so the landing page doesn't show
// an empty/sad state.
//
// Each card shows the book metadata + an example owner handle that
// has it (deep-link to that user's library so the reader can find a
// place to actually grab it).
export default function TrendingBooksStrip({ limit = 8, days = 7 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/books/trending?limit=${limit}&days=${days}`);
        if (alive) setItems(data?.trending || []);
      } catch { /* silent — strip simply doesn't render */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [limit, days]);

  if (loading) {
    return (
      <div className="py-6 text-center text-[#6B705C]" data-testid="trending-books-loading">
        <Loader2 className="w-5 h-5 animate-spin mx-auto opacity-60" />
      </div>
    );
  }

  if (!items.length) return null;

  return (
    <section
      className="py-10 bg-[#FBF7EE]"
      data-testid="trending-books-strip"
      aria-label="Trending books on Shelfsort"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1.5">
              Trending this week
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] leading-tight">
              What readers are loving on Shelfsort.
            </h2>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {items.map((b, idx) => (
            <Link
              key={`${b.title}|${b.author}|${idx}`}
              to={b.sample_owner_handle ? `/u/${b.sample_owner_handle}/library` : "/users"}
              data-testid={`trending-book-card-${idx}`}
              className="block p-3 rounded-xl border border-[#E5DDC5] bg-white hover:bg-[#FBFAF6] hover:border-[#D4C9A8] transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="w-8 h-11 rounded bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">
                    {b.title}
                  </p>
                  <p className="text-[11px] text-[#6B705C] truncate">
                    {b.author || "Unknown author"}
                  </p>
                  {b.fandom ? (
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] font-semibold">
                      {b.fandom}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[#C53030] inline-flex items-center gap-1 font-semibold">
                <Heart className="w-3 h-3" fill="currentColor" />
                <span data-testid={`trending-book-hearts-${idx}`}>{b.heart_count}</span>
                {b.heart_count === 1 ? " heart" : " hearts"}
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-5 text-xs text-[#6B705C] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#6B46C1]" />
          Aggregated from hearts across opted-in public libraries.
          <Link to="/users" className="text-[#6B46C1] font-semibold hover:underline">
            Browse readers →
          </Link>
        </p>
      </div>
    </section>
  );
}
