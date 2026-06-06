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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, f, r, t] = await Promise.all([
          api.get("/books/stats"),
          api.get("/fandoms"),
          api.get("/relationships"),
          api.get("/library/trends?days=7"),
        ]);
        if (cancelled) return;
        setStats(s.data);
        setFandomTotal((f.data?.fandoms || []).length);
        setPairingTotal((r.data?.relationships || []).length);
        setTrends(t.data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stats) return null;

  const delta = (n) => (n > 0 ? `+${n} this week` : "no change this week");
  const items = [
    { icon: BookOpen, label: "Books", value: stats.total, trend: trends?.books, testId: "lib-stat-books" },
    { icon: Tag, label: "Fandoms", value: fandomTotal ?? "—", trend: trends?.fandoms, testId: "lib-stat-fandoms" },
    { icon: Layers, label: "Crossovers", value: stats.crossover_count || 0, trend: trends?.crossovers, testId: "lib-stat-crossovers" },
    { icon: Heart, label: "Pairings", value: pairingTotal ?? "—", trend: trends?.pairings, testId: "lib-stat-pairings" },
  ];

  return (
    <section className="shelf-card p-6 mb-6" data-testid="library-stats-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#3A5A40]/10 text-[#3A5A40] flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">Library by the numbers</h2>
          <p className="text-sm text-[#6B705C] mt-1">
            What Shelfsort is currently sorting for you.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map(({ icon: Icon, label, value, trend, testId }) => (
          <div
            key={label}
            data-testid={testId}
            className="rounded-lg border border-[#E5DDC5] bg-white p-3 flex items-start gap-3"
          >
            <Icon className="w-5 h-5 text-[#6B705C] flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-2xl font-serif text-[#2C2C2C] leading-none">{value}</div>
              <div className="text-xs uppercase tracking-wide text-[#6B705C] mt-1">{label}</div>
              {trend != null && (
                <div
                  className={`text-[10px] mt-1 ${trend > 0 ? "text-[#3A5A40] font-semibold" : "text-[#6B705C]/70"}`}
                  data-testid={`${testId}-trend`}
                >
                  {delta(trend)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
