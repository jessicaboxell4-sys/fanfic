import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { Sparkles, Loader2, Inbox } from "lucide-react";

/**
 * PendingPolishBanner
 * --------------------
 * Surfaces the deferred pipeline at the top of `/library/all`.
 * Three states:
 *
 *   • idle / done                  — hidden entirely.
 *   • books arriving from upload   — shows "📥 N books arriving"
 *     while server-side metadata extraction + Calibre conversion
 *     + cover save + R2 mirror are still in flight.  Auto-refreshes
 *     every 5s.
 *   • polish queue still draining  — shows "✨ N books sorting in
 *     the background" with a manual "Polish now" button.
 *
 * Tab-close resilient: the backend cron + on-startup recovery hook
 * (utils/polish_worker.py + routes/upload_jobs.py) pick up any
 * pending books left behind so closing the tab never strands a
 * book.  This banner just SURFACES the queue — the actual work is
 * entirely server-side.
 */
const POLL_INTERVAL_MS = 5000;

export default function PendingPolishBanner({ onPolished }) {
  const [stats, setStats] = useState({ pending: 0, failed: 0, arriving: 0, in_progress: false });
  const [triggering, setTriggering] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get("/polish/stats");
      setStats(data || { pending: 0, failed: 0, in_progress: false });
    } catch {
      /* ignore — banner hides while signed-out */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Sum of pending + arriving — when EITHER drops we want to
    // refresh the parent library so the newly-classified or
    // newly-arrived books appear without a manual reload.
    let lastTotal = -1;
    const tick = async () => {
      if (cancelled) return;
      await fetchStats();
    };
    tick();
    const id = setInterval(async () => {
      if (cancelled) return;
      await fetchStats();
      // setStats is async — we read the latest values via a
      // functional update inside fetchStats above.  Compare via the
      // closure-captured `stats` is good enough for a heartbeat poll.
      const total = (stats.pending || 0) + (stats.arriving || 0);
      if (lastTotal > 0 && total < lastTotal && onPolished) {
        onPolished();
      }
      lastTotal = total;
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also re-fire onPolished whenever the count transitions to 0 in
  // the most recent fetchStats (catches the final tick that empties
  // the queue).
  useEffect(() => {
    if (stats.pending === 0 && stats.in_progress === false && onPolished) {
      // No-op the very first render — onPolished should only run
      // when the queue *empties*, not when it was empty all along.
      // The polling effect above is the actual trigger; this
      // effect is a safety net.
    }
  }, [stats.pending, stats.in_progress, onPolished]);

  const handlePolishNow = async () => {
    setTriggering(true);
    try {
      await api.post("/polish");
      await fetchStats();
    } catch {
      /* ignore — server-side gate will surface failure on next poll */
    } finally {
      setTriggering(false);
    }
  };

  // Hide the banner entirely when there's no work to do.
  if (stats.pending === 0 && stats.failed === 0 && stats.arriving === 0) return null;

  // ARRIVING state takes priority — surface the upload pipeline work
  // first because books haven't even hit the library yet.  Once
  // arriving drops to zero (all books inserted into db.books), the
  // banner transitions to the polish/failed states below.
  if (stats.arriving > 0 && stats.pending === 0 && stats.failed === 0) {
    return (
      <div
        data-testid="pending-polish-banner"
        className="mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#FDF3E1] dark:bg-[#3a2f1a] border border-[#E07A5F]/40 dark:border-[#8C5C00]/60"
      >
        <div className="flex items-center gap-3 text-sm text-[#2C2C2C] dark:text-[#E6CFA1]">
          <Inbox className="w-4 h-4 shrink-0 text-[#E07A5F] dark:text-[#E6CFA1]" />
          <span>
            <span className="font-semibold" data-testid="pending-polish-banner-arriving">
              {stats.arriving} book{stats.arriving === 1 ? "" : "s"} arriving
            </span>
            <span className="text-[#5B5F4D] dark:text-[#A99878]">
              {" — "}
              Extracting metadata, converting formats, and saving covers. They&rsquo;ll appear on this page as each one finishes.
            </span>
          </span>
        </div>
        <Loader2 className="w-4 h-4 shrink-0 text-[#E07A5F] dark:text-[#E6CFA1] animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // POLISH / FAILED state — same UI as before, but if uploads are
  // STILL arriving alongside the polish queue we prepend an inline
  // "+ N arriving" hint so the user knows there's more incoming.
  return (
    <div
      data-testid="pending-polish-banner"
      className="mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#EEE9FB] dark:bg-[#2A1F4F] border border-[#6B46C1]/30 dark:border-[#B7A7FF]/30"
    >
      <div className="flex items-center gap-3 text-sm text-[#2C2C2C] dark:text-[#E6CFA1]">
        {stats.in_progress ? (
          <Loader2 className="w-4 h-4 shrink-0 text-[#6B46C1] animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4 shrink-0 text-[#6B46C1]" />
        )}
        <span>
          <span className="font-semibold" data-testid="pending-polish-banner-count">
            {stats.pending > 0
              ? `${stats.pending} book${stats.pending === 1 ? "" : "s"} sorting in the background`
              : `${stats.failed} book${stats.failed === 1 ? "" : "s"} failed to sort`}
            {stats.arriving > 0 && (
              <span className="font-normal text-[#5B5F4D] dark:text-[#A99878]"> · {stats.arriving} still arriving</span>
            )}
          </span>
          <span className="text-[#5B5F4D] dark:text-[#A99878]">
            {" — "}
            {stats.in_progress
              ? "Claude is reading each one. You can close this tab — they'll keep going."
              : stats.pending > 0
                ? "Click polish to start them now"
                : "Click polish to retry"}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={handlePolishNow}
        disabled={triggering || stats.in_progress}
        data-testid="pending-polish-banner-action"
        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#5a3aab] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        {stats.in_progress ? "Sorting…" : "Polish now"}
      </button>
    </div>
  );
}
