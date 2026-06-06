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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // /books/stats only returns the TOP fandoms/relationships; the all-
        // distinct counts come from /fandoms and /relationships.
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

  if (!stats) return null;

  const items = [
    { icon: BookOpen, label: "Books", value: stats.total, testId: "lib-stat-books" },
    { icon: Tag, label: "Fandoms", value: fandomTotal ?? "—", testId: "lib-stat-fandoms" },
    { icon: Layers, label: "Crossovers", value: stats.crossover_count || 0, testId: "lib-stat-crossovers" },
    { icon: Heart, label: "Pairings", value: pairingTotal ?? "—", testId: "lib-stat-pairings" },
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
        {items.map(({ icon: Icon, label, value, testId }) => (
          <div
            key={label}
            data-testid={testId}
            className="rounded-lg border border-[#E5DDC5] bg-white p-3 flex items-center gap-3"
          >
            <Icon className="w-5 h-5 text-[#6B705C] flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-2xl font-serif text-[#2C2C2C] leading-none">{value}</div>
              <div className="text-xs uppercase tracking-wide text-[#6B705C] mt-1">{label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
