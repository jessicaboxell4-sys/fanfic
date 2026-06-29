import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BookOpen, Zap, Users, Repeat, Hourglass } from "lucide-react";
import HelpAnchor from "./HelpAnchor";

/**
 * Three-pill strip on BookDetail surfacing the new heatmap signals:
 *   • Re-read badge  (cursor_history backward-jump count)
 *   • Pace pill      (user's %pts/hour vs their own median)
 *   • Cohort pill    (your % vs community avg %, cohort-gated)
 *
 * Each pill is independently rendered — if its endpoint can't return
 * useful data (no cohort, no baseline books, etc.) it just doesn't
 * show.  No layout flash, no error UI.
 */
export default function BookReadingInsights({ bookId }) {
  const [reread, setReread] = useState(null);
  const [pace, setPace] = useState(null);
  const [cohort, setCohort] = useState(null);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      const safe = async (path) => {
        try { return (await api.get(path)).data; } catch { return null; }
      };
      const [r, p, c] = await Promise.all([
        safe(`/books/${bookId}/reread-signal`),
        safe(`/books/${bookId}/pace-percentile`),
        safe(`/books/${bookId}/aggregate-cursor`),
      ]);
      if (cancelled) return;
      setReread(r); setPace(p); setCohort(c);
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const showAny = (reread?.is_reread) ||
                  (pace?.have_data && pace.median_rate) ||
                  (pace?.projected_hours_to_finish) ||
                  (cohort?.have_data);
  if (!showAny) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 mt-3 mb-2"
      data-testid="book-reading-insights"
    >
      <HelpAnchor section="reading-insights" label="About reading insights" className="mr-0.5" />
      {reread?.is_reread && (
        <span
          data-testid="reread-pill"
          title={`${reread.backward_jumps} backward jumps in the last ${reread.window_days} days`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#F3EBE0] text-[#8C5C00] border border-[#E8D8B8]"
        >
          <Repeat className="w-3 h-3" /> Re-read
        </span>
      )}
      {/* Projected finish time — most engaging for first-time opens.
          Shown when we have a usable median pace but the user hasn't
          made enough recent progress for a current-vs-median compare. */}
      {pace?.projected_hours_to_finish && !pace?.relative && (
        <span
          data-testid="projected-finish-pill"
          title={`Based on your median pace of ${pace.median_rate}% per hour`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#EDE7FB] text-[#5A38A8] border border-[#D5C9F0]"
        >
          <Hourglass className="w-3 h-3" />
          ~{pace.projected_hours_to_finish}h to finish
        </span>
      )}
      {pace?.have_data && pace.median_rate && pace.relative && (
        <span
          data-testid="pace-pill"
          title={`${pace.current_rate}% / hr vs your usual ${pace.median_rate}% / hr`}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border ${
            pace.relative >= 1.15 ? "bg-[#E6F2E8] text-[#2E7D45] border-[#C7E0CB]" :
            pace.relative <= 0.85 ? "bg-[#FBEAE7] text-[#B0411E] border-[#F0C8C0]" :
            "bg-[#F5F2EE] text-[#5B5F4D] border-[#E8E6E1]"
          }`}
        >
          <Zap className="w-3 h-3" />
          {pace.relative >= 1.15 ? `${Math.round((pace.relative - 1) * 100)}% faster than usual`
            : pace.relative <= 0.85 ? `${Math.round((1 - pace.relative) * 100)}% slower than usual`
            : "Your usual pace"}
        </span>
      )}
      {cohort?.have_data && (
        <span
          data-testid="cohort-pill"
          title={`${cohort.cohort} readers • ${Math.round((cohort.completion_rate || 0) * 100)}% finished`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-[#EEF3EC] text-[#3B5B3F] border border-[#D6E4D9]"
        >
          <Users className="w-3 h-3" />
          You: {Math.round(cohort.your_percent * 100)}% · Community: {Math.round(cohort.avg_percent * 100)}%
        </span>
      )}
    </div>
  );
}
