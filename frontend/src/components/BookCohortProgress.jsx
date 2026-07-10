import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Slim progress bar showing the user's percent + a faint tick mark
 * for the community average (cohort-gated, opted-in only).  Falls
 * back to a plain percent label if no cohort data is available.
 *
 * Designed to live inside the <Meta label="Progress"> slot on
 * BookDetail so it replaces the previous text-only "45 %" cell.
 */
export default function BookCohortProgress({ bookId, yourPercent }) {
  const [agg, setAgg] = useState(null);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/books/${bookId}/aggregate-cursor`);
        if (!cancelled) setAgg(data);
      } catch { /* not fatal */ }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const youPct = Math.round((yourPercent || 0) * 100);
  const cohort = agg?.have_data ? Math.round((agg.avg_percent || 0) * 100) : null;

  return (
    <div className="w-full" data-testid={`cohort-progress-${bookId}`}>
      <div className="flex items-center justify-between text-xs text-[#5B5F4D] mb-1">
        <span>You: <span className="font-semibold text-[#2C2C2C]">{youPct}%</span></span>
        {cohort !== null && (
          <span
            data-testid="cohort-progress-cohort-label"
            title={`${agg.cohort} opted-in readers · ${Math.round(agg.completion_rate * 100)}% finished`}
          >
            Community: <span className="font-semibold text-[#6B46C1]">{cohort}%</span>
          </span>
        )}
      </div>
      <div className="relative h-2 w-full rounded-full bg-[#EFEDE7] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-[#E07A5F]"
          style={{ width: `${Math.min(100, youPct)}%` }}
          data-testid="cohort-progress-your-bar"
        />
        {cohort !== null && (
          <div
            className="absolute inset-y-0 w-[2px] bg-[#6B46C1]"
            style={{ left: `${Math.min(100, cohort)}%` }}
            title={`Community average: ${cohort}%`}
            data-testid="cohort-progress-tick"
          />
        )}
      </div>
    </div>
  );
}
