import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Dna, Repeat, BookOpen } from "lucide-react";

/**
 * ReaderDnaCard — one-glance "what kind of reader am I?" panel.
 *
 * Two complementary blocks rendered side-by-side on desktop, stacked
 * on mobile:
 *   1. Reader DNA — top 3 fandoms, fanfic-vs-original split, average
 *      book length in words.
 *   2. Trending re-reads — books the user finished AND opened a
 *      session for in the last 30 days. (Comfort reads.)
 *
 * Both fetched in a single round trip from /api/insights/reader-dna.
 * Card silently hides itself when the user's library is empty.
 */
export default function ReaderDnaCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/insights/reader-dna");
        if (!cancelled) setData(data);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;
  if ((data.total_books || 0) === 0) return null;

  const fanficPct = Number(data.fanfic_pct || 0);
  const originalPct = Math.max(0, 100 - fanficPct);

  return (
    <section
      className="shelf-card p-6 mb-6"
      data-testid="reader-dna-card"
    >
      <div className="flex items-center gap-2 mb-4">
        <Dna className="w-4 h-4 text-[#6B46C1]" aria-hidden="true" />
        <h2 className="font-serif text-2xl text-[#2C2C2C]">Reader DNA</h2>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {/* Reader DNA block */}
        <div data-testid="reader-dna-summary">
          <p className="text-xs uppercase tracking-[0.18em] text-[#6B705C] mb-2">
            Your reading make-up
          </p>
          <ul className="space-y-2 mb-4" data-testid="reader-dna-fandoms">
            {(data.top_fandoms || []).map((f, idx) => (
              <li key={f.fandom} className="flex items-center justify-between text-sm">
                <span className="text-[#2C2C2C] truncate pr-3">
                  <span className="inline-block w-5 text-[#6B705C] tabular-nums">{idx + 1}.</span>
                  {f.fandom}
                </span>
                <span className="text-[#6B705C] tabular-nums">{f.count}</span>
              </li>
            ))}
          </ul>

          <div className="mb-3">
            <p className="text-[11px] text-[#6B705C] mb-1.5 flex items-baseline justify-between">
              <span>Fanfic vs original</span>
              <span className="tabular-nums">
                {fanficPct}% / {originalPct}%
              </span>
            </p>
            <div
              className="h-2 rounded-full bg-[#F5F3EC] overflow-hidden flex"
              data-testid="reader-dna-split-bar"
            >
              <div
                className="h-full bg-[#E07A5F] transition-all"
                style={{ width: `${Math.max(2, fanficPct)}%` }}
                title="Fanfiction"
              />
              <div
                className="h-full bg-[#6B46C1] transition-all"
                style={{ width: `${Math.max(2, originalPct)}%` }}
                title="Original"
              />
            </div>
          </div>

          <p className="text-xs text-[#6B705C]" data-testid="reader-dna-avg-words">
            Average book length:{" "}
            <span className="font-mono text-[#2C2C2C]">
              {Number(data.avg_words || 0).toLocaleString()}
            </span>{" "}
            words
          </p>
        </div>

        {/* Trending re-reads block */}
        <div data-testid="trending-rereads">
          <p className="text-xs uppercase tracking-[0.18em] text-[#6B705C] mb-2 flex items-center gap-1.5">
            <Repeat className="w-3 h-3" aria-hidden="true" />
            Comfort reads · last 30 days
          </p>
          {(data.trending_rereads || []).length === 0 ? (
            <p className="text-sm text-[#6B705C] italic">
              You haven&apos;t revisited any finished books yet. They&apos;ll show up here when you do.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="trending-rereads-list">
              {data.trending_rereads.map((r) => (
                <li key={r.book_id}>
                  <Link
                    to={`/book/${r.book_id}`}
                    data-testid={`trending-reread-${r.book_id}`}
                    className="flex items-center gap-2 group hover:bg-[#FBFAF6] -mx-2 px-2 py-1.5 rounded transition-colors"
                  >
                    <BookOpen className="w-3 h-3 text-[#6B705C] flex-shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#2C2C2C] truncate group-hover:text-[#6B46C1]">
                        {r.title}
                      </span>
                      {r.fandom && (
                        <span className="block text-[10px] text-[#6B705C] truncate uppercase tracking-wider">
                          {r.fandom}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
