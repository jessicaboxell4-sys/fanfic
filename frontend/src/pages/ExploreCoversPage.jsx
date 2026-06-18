import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Flame, Trophy, Sparkles, BookOpen, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import ConsentBanner from "../components/ConsentBanner";

// Hoisted outside the page so React doesn't re-create the type on each
// render (which would otherwise blow away the entire subtree's DOM).
function ExploreRail({ rows, eyebrow, icon: Icon, accent, testid }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="mb-12" data-testid={testid}>
      <div className="flex items-baseline gap-3 mb-4">
        <p
          className="text-xs font-bold uppercase tracking-[0.2em] inline-flex items-center gap-2"
          style={{ color: accent }}
        >
          <Icon className="w-3 h-3" /> {eyebrow}
        </p>
        <span className="text-xs text-[#6B705C]">{rows.length}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {rows.map((c) => {
          const hasImg = !!(c.image_base64 && c.image_base64.length > 64);
          return (
            <Link
              key={c.cover_id}
              to={`/cover/${c.cover_id}`}
              className="group relative bg-white rounded-lg border border-[#E8E6E1] overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              data-testid={`explore-card-${c.cover_id}`}
            >
              <div className="aspect-[2/3] bg-[#F5F2EA] overflow-hidden relative">
                {hasImg ? (
                  <img
                    src={`data:${c.mime_type};base64,${c.image_base64}`}
                    alt={c.title}
                    loading="lazy"
                    onError={(e) => {
                      // Bad / corrupt base64 — swap to the placeholder
                      // sibling so the card never looks blank.
                      e.currentTarget.style.display = "none";
                      const ph = e.currentTarget.parentNode.querySelector(
                        "[data-cover-fallback]",
                      );
                      if (ph) ph.style.display = "flex";
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : null}
                <div
                  data-cover-fallback
                  className="w-full h-full flex-col items-center justify-center text-[#C7B7A8]"
                  data-testid={`explore-card-placeholder-${c.cover_id}`}
                  style={{ display: hasImg ? "none" : "flex" }}
                  aria-label="Cover image unavailable"
                >
                  <BookOpen className="w-10 h-10 mb-1.5" strokeWidth={1.25} />
                  <span className="text-[10px] uppercase tracking-wider font-semibold">no image yet</span>
                </div>
                {/* Affordance pill — visible at all viewport widths so mobile
                    users see the card is tappable. */}
                <span
                  className="absolute bottom-2 right-2 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/55 text-white backdrop-blur-sm opacity-90 group-hover:opacity-100"
                  data-testid={`explore-card-view-hint-${c.cover_id}`}
                >
                  View <ChevronRight className="w-2.5 h-2.5" />
                </span>
              </div>
              <div className="p-2.5">
                <p className="font-serif text-sm text-[#2C2C2C] leading-tight line-clamp-2 break-words">
                  {c.title || "Untitled"}
                </p>
                <div className="flex items-center justify-between mt-2 text-[11px] text-[#6B705C]">
                  <span className="inline-flex items-center gap-1">
                    <Heart className="w-3 h-3" /> {c.votes || 0}
                  </span>
                  <span className="truncate">@{c.shared_by}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Unauthenticated `/explore/covers` page — three rails (top of week,
 * trending, recent) showing the community pool to anyone who lands
 * here from a tweet, search-engine result, or RSS link.  Designed
 * to be the "shop window" that converts visitors into accounts.
 */
export default function ExploreCoversPage() {
  const [data, setData] = useState({ top_of_week: [], trending: [], recent: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Explore community covers — Shelfsort";
    import("../lib/analytics").then((m) => m.stampView("explore"));
    (async () => {
      try {
        const r = await api.get("/community-covers/explore");
        setData(r.data || { top_of_week: [], trending: [], recent: [] });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <main
        className="max-w-6xl mx-auto px-6 md:px-8 py-8 md:py-14 fade-in"
        data-testid="explore-covers-page"
      >
        <header className="mb-10 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-2">
              Community covers
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight tracking-tight">
              AI-made book covers, voted by readers.
            </h1>
            <p className="text-lg text-[#6B705C] mt-3 max-w-2xl">
              Browse the latest covers people have generated for their
              fanfiction and book libraries on Shelfsort — heart your
              favourites and remix them into your own shelves.
            </p>
          </div>
          <Link
            to="/login"
            data-testid="explore-cta-signup"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] shadow-sm"
          >
            Sign up &amp; share yours →
          </Link>
        </header>

        {loading ? (
          <p className="text-[#6B705C]" data-testid="explore-loading">Loading…</p>
        ) : (
          <>
            <ExploreRail
              rows={data.top_of_week}
              eyebrow="Top of the week"
              icon={Trophy}
              accent="#B87A00"
              testid="explore-rail-top"
            />
            <ExploreRail
              rows={data.trending}
              eyebrow="Trending now"
              icon={Flame}
              accent="#D14545"
              testid="explore-rail-trending"
            />
            <ExploreRail
              rows={data.recent}
              eyebrow="Just shared"
              icon={Sparkles}
              accent="#6B46C1"
              testid="explore-rail-recent"
            />
          </>
        )}

        <footer className="text-xs text-[#6B705C] pt-6 border-t border-[#E8E6E1] mt-10">
          <Link to="/cover-archive" className="hover:text-[#6B46C1]">
            Cover-of-the-week archive →
          </Link>
          <span className="mx-2">·</span>
          <a
            href={`${process.env.REACT_APP_BACKEND_URL}/api/feeds/covers/trending.rss`}
            className="hover:text-[#6B46C1]"
            data-testid="explore-rss-link"
          >
            Trending RSS
          </a>
        </footer>
      </main>
      <ConsentBanner />
    </div>
  );
}
