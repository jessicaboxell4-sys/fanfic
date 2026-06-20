import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ShieldCheck, X } from "lucide-react";

/**
 * AvRescanNudgeBanner — gentle nudge to rerun ClamAV across the
 * user's library when:
 *   • the last rescan is older than 90 days, OR
 *   • there are unscanned books AND no rescan has ever run
 *
 * Hidden when AV is unavailable, when the library is empty, when
 * everything's been recently scanned, and when the user has
 * dismissed it (per-day cool-down via localStorage).
 *
 * Mounted at the App level (above MaintenanceBanner) so the nudge
 * shows on every page until acted on or dismissed.
 */

const STALE_DAYS = 90;
const DISMISS_KEY = "shelfsort_av_nudge_dismissed_at";

function daysAgo(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86400000;
}

export default function AvRescanNudgeBanner() {
  const { user, loading } = useAuth();
  const [report, setReport] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    // Honour a 1-day per-user dismissal so the banner doesn't nag.
    try {
      const d = window.localStorage.getItem(DISMISS_KEY);
      if (d && daysAgo(d) < 1) { setHidden(true); return; }
    } catch { /* ignore */ }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/account/safety");
        if (!cancelled) setReport(data);
      } catch {
        // 401 / network — silently hide
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  if (hidden || !report) return null;
  if (!report.av_available) return null;
  if ((report.total || 0) === 0) return null;

  const lastDays = daysAgo(report.last_rescan_at);
  const isStale = lastDays >= STALE_DAYS;
  const neverRanWithUnscanned = !report.last_rescan_at && (report.unscanned || 0) > 0;
  if (!isStale && !neverRanWithUnscanned) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setHidden(true);
  };

  const headline = neverRanWithUnscanned
    ? `${report.unscanned} book${report.unscanned === 1 ? "" : "s"} haven't been scanned yet`
    : `Your last virus scan was ${Math.floor(lastDays)} days ago`;

  return (
    <div
      className="bg-[#FBFAF6] border-b border-[#E5DDC5] dark:bg-zinc-900 dark:border-zinc-800"
      data-testid="av-rescan-nudge-banner"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
        <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs text-[#2C2C2C] dark:text-zinc-200 flex-1 min-w-0">
          <span className="font-medium">{headline}.</span>{" "}
          <span className="text-[#6B705C] dark:text-zinc-400">A fresh scan keeps your library reports honest.</span>
        </p>
        <Link
          to="/account/safety"
          data-testid="av-rescan-nudge-action"
          className="px-2.5 py-1 rounded-full bg-emerald-700 text-white text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-emerald-800 transition-colors whitespace-nowrap"
        >
          Run scan
        </Link>
        <button
          type="button"
          onClick={dismiss}
          data-testid="av-rescan-nudge-dismiss"
          aria-label="Dismiss antivirus nudge"
          className="p-1 rounded text-[#6B705C] hover:text-[#2C2C2C] hover:bg-[#F0EBDE] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
