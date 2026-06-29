import React, { useEffect, useState } from "react";
import { BookOpen, Tag, Layers, Heart } from "lucide-react";
import { api } from "../lib/api";

// Compact "by the numbers" card. Pulls from /books/stats which already
// returns total books + per-category/fandom/relationship breakdowns and a
// crossover_count. Renders as a 4-up stat row.
export default function LibraryStatsCard() {
  const [stats, setStats] = useState(null);
  const [fandomTotal, setFandomTotal] = useState(null);
  const [pairingTotal, setPairingTotal] = useState(null);
  const [trends, setTrends] = useState(null);
  const [windowDays, setWindowDays] = useState(7);

  // Load slow-changing totals once. (Per-window trends refetch separately.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, f, r] = await Promise.all([
          api.get("/books/stats"),
          api.get("/fandoms"),
          api.get("/relationships"),
        ]);
        if (cancelled) return;
        setStats(s.data);
        setFandomTotal((f.data?.fandoms || []).length);
        setPairingTotal((r.data?.relationships || []).length);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Trends refetch on window-size change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/library/trends?days=${windowDays}`);
        if (!cancelled) setTrends(data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [windowDays]);

  if (!stats) return null;

  const WINDOWS = [
    { d: 1, label: "Day" },
    { d: 7, label: "Week" },
    { d: 30, label: "Month" },
    { d: 365, label: "Year" },
  ];
  const windowLabel = (WINDOWS.find((w) => w.d === windowDays) || WINDOWS[1]).label.toLowerCase();
  // Short on mobile (`+3 this wk` / `no change`) so the trend doesn't
  // wrap to 4 lines inside a 2-col grid tile on phones.  We render both
  // strings and let CSS show the right one via Tailwind's responsive
  // `hidden`/`sm:inline` classes.
  const delta = (n) => (n > 0 ? `+${n}` : `no change`);
  const deltaLong = (n) => (n > 0 ? `+${n} this ${windowLabel}` : `no change this ${windowLabel}`);
  const items = [
    { icon: BookOpen, label: "Books", value: stats.total, trend: trends?.books, testId: "lib-stat-books" },
    { icon: Tag, label: "Fandoms", value: fandomTotal ?? "—", trend: trends?.fandoms, testId: "lib-stat-fandoms" },
    { icon: Layers, label: "Crossovers", value: stats.crossover_count || 0, trend: trends?.crossovers, testId: "lib-stat-crossovers" },
    { icon: Heart, label: "Pairings", value: pairingTotal ?? "—", trend: trends?.pairings, testId: "lib-stat-pairings" },
  ];

  return (
    <section className="shelf-card p-6 mb-6" data-testid="library-stats-card">
      <div className="flex items-start gap-3 mb-4 flex-wrap sm:flex-nowrap">
        <div className="w-10 h-10 rounded-xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl sm:text-2xl text-[#2C2C2C]">Library by the numbers</h2>
          <p className="text-sm text-[#5B5F4D] mt-1">
            What Shelfsort is currently sorting for you.
          </p>
        </div>
        <div className="flex gap-1 flex-shrink-0 w-full sm:w-auto" role="radiogroup" aria-label="Trend window">
          {WINDOWS.map((w) => (
            <button
              key={w.d}
              onClick={() => setWindowDays(w.d)}
              data-testid={`trend-window-${w.label.toLowerCase()}`}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                windowDays === w.d
                  ? "bg-[#6B46C1] text-white"
                  : "bg-[#FDF3E1] text-[#5B5F4D] hover:bg-[#6B46C1]/10 hover:text-[#6B46C1]"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {items.map(({ icon: Icon, label, value, trend, testId }) => (
          <div
            key={label}
            data-testid={testId}
            className="rounded-lg border border-[#E5DDC5] bg-white p-2.5 sm:p-3 flex items-start gap-2 sm:gap-3"
          >
            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-[#5B5F4D] flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xl sm:text-2xl font-serif text-[#2C2C2C] leading-none">{value}</div>
              <div className="text-[10px] sm:text-xs uppercase tracking-wide text-[#5B5F4D] mt-1 leading-tight">{label}</div>
              {trend != null && (
                <div
                  className={`text-[10px] mt-1 ${trend > 0 ? "text-[#6B46C1] font-semibold" : "text-[#5B5F4D]/70"}`}
                  data-testid={`${testId}-trend`}
                >
                  <span className="sm:hidden">{delta(trend)}</span>
                  <span className="hidden sm:inline">{deltaLong(trend)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
