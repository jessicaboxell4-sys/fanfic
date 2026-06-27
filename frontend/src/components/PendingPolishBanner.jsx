import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { Sparkles, Loader2 } from "lucide-react";

/**
 * PendingPolishBanner
 * --------------------
 * Surfaces the deferred-classifier polish queue at the top of
 * `/library/all`.  Two states:
 *
 *   • idle / done   — hidden entirely.
 *   • pending books — shows "✨ N books are sorting in the background"
 *     with a manual "Polish now" button.  Polls /polish/stats every
 *     5s while there's work in flight so the user sees the count
 *     drain in real time.
 *
 * Tab-close resilient: the backend cron (utils/polish_worker.py)
 * picks up any pending books left behind so closing the tab never
 * strands a book in "Pending sort" forever.  This banner just
 * SURFACES the queue — the actual classification work is entirely
 * server-side.
 */
const POLL_INTERVAL_MS = 5000;

export default function PendingPolishBanner({ onPolished }) {
  const [stats, setStats] = useState({ pending: 0, failed: 0, in_progress: false });
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
    let lastPending = -1;
    const tick = async () => {
      if (cancelled) return;
      await fetchStats();
      // No work and not in flight → stop polling (next mount will
      // pick it back up).  Banner self-hides via the `pending === 0`
      // guard below.
    };
    tick();
    const id = setInterval(async () => {
      if (cancelled) return;
      const before = stats.pending;
      await fetchStats();
      // Fire `onPolished` whenever the count drops so the parent
      // library page can refresh its book list and pick up the
      // newly-classified rows.
      if (lastPending > 0 && stats.pending < lastPending && onPolished) {
        onPolished();
      }
      lastPending = stats.pending;
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
  if (stats.pending === 0 && stats.failed === 0) return null;

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
          </span>
          <span className="text-[#6B705C] dark:text-[#A99878]">
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
