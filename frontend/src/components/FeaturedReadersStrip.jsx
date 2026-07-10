import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Sparkles, Loader2 } from "lucide-react";
import { api } from "../lib/api";

// Social-proof carousel for the landing page (and anywhere else we
// want to surface real opted-in libraries).  Pulls from
// /api/library/featured which returns 3-5 randomly-sampled libraries
// each call — anon-accessible, so SSR-friendly + crawlable.
//
// Renders nothing if the endpoint returns an empty list (e.g. no
// opted-in users yet) so the landing page doesn't show a sad empty
// shelf.  Defensive — never throws on network failures.
export default function FeaturedReadersStrip({ limit = 5 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/library/featured?limit=${limit}`);
        if (alive) setItems(data?.featured || []);
      } catch { /* silent — strip just doesn't render */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [limit]);

  if (loading) {
    return (
      <div className="py-6 text-center text-[#5B5F4D]" data-testid="featured-readers-loading">
        <Loader2 className="w-5 h-5 animate-spin mx-auto opacity-60" />
      </div>
    );
  }

  if (!items.length) return null;

  return (
    <section
      className="py-10"
      data-testid="featured-readers-strip"
      aria-label="Featured public libraries"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-1.5">
              Featured readers
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] leading-tight">
              See what other Shelfsort readers are reading.
            </h2>
          </div>
          <Link
            to="/users"
            className="text-xs font-semibold text-[#6B46C1] hover:underline"
            data-testid="featured-readers-browse-all"
          >
            Browse all readers →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((u) => (
            <Link
              key={u.username}
              to={`/u/${u.username}/library`}
              data-testid={`featured-reader-card-${u.username}`}
              className="block p-4 rounded-xl border border-[#E5DDC5] bg-[#FBF7EE] hover:bg-[#F5EFE0] hover:border-[#D4C9A8] transition-colors"
            >
              <div className="flex items-start gap-3">
                {u.picture ? (
                  <img
                    src={u.picture}
                    alt={`@${u.username}`}
                    className="w-12 h-12 rounded-full ring-2 ring-white flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center font-serif text-lg ring-2 ring-white flex-shrink-0">
                    {(u.username || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#2C2C2C] truncate">
                    @{u.username}
                  </p>
                  <p className="text-xs text-[#5B5F4D] mt-0.5">
                    <span className="font-semibold text-[#2C2C2C]">{u.total_books}</span> {u.total_books === 1 ? "book" : "books"}
                    {u.top_fandom ? <> · {u.top_fandom}</> : null}
                  </p>
                  {u.bio ? (
                    <p className="text-xs text-[#5B5F4D] italic mt-1.5 line-clamp-2">
                      &ldquo;{u.bio}&rdquo;
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-[11px] font-semibold text-[#6B46C1] inline-flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> Browse library →
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-[#5B5F4D] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#6B46C1]" />
          These readers opted in to sharing their library publicly.
          <Link to="/account#privacy" className="text-[#6B46C1] font-semibold hover:underline">
            Make yours public too →
          </Link>
        </p>
      </div>
    </section>
  );
}
