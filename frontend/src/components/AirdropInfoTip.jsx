import React, { useState, useEffect } from "react";
import { Info, X } from "lucide-react";

/**
 * AirdropInfoTip
 * --------------
 * One-time educational banner introducing the tab-close-safe upload
 * pipeline.  Surfaced near the upload zone so users see it in
 * context the first time they go to upload, then dismiss it forever.
 *
 * Two variants:
 *   • `compact` — small one-liner, used inside the dashboard's
 *     compact upload zone.
 *   • full (default) — the wider, two-line variant used on the main
 *     /upload page.
 *
 * Dismissal is persisted in localStorage (`shelfsort.tip.airdrop-
 * tab-close-dismissed = "1"`) so it never reappears for that user
 * on that browser.  Each user / new browser / cleared storage sees
 * it once.
 */
const DISMISS_KEY = "shelfsort.tip.airdrop-tab-close-dismissed";

export default function AirdropInfoTip({ compact = false }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; }
    catch { return false; }
  });

  // Re-check on mount in case another tab dismissed it.
  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); }
    catch (e) { void e; }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); }
    catch (e) { void e; }
  };

  if (dismissed) return null;

  return (
    <div
      data-testid="airdrop-info-tip"
      className={`${compact ? "mb-2 px-3 py-2 text-xs" : "mb-4 px-4 py-3 text-sm"} flex items-start justify-between gap-3 rounded-lg bg-[#EEE9FB] dark:bg-[#2A1F4F] border border-[#6B46C1]/30 dark:border-[#B7A7FF]/30 text-[#2C2C2C] dark:text-[#E6CFA1]`}
    >
      <div className="flex items-start gap-2.5">
        <Info className={`${compact ? "w-3.5 h-3.5 mt-0.5" : "w-4 h-4 mt-0.5"} shrink-0 text-[#6B46C1] dark:text-[#B7A7FF]`} aria-hidden="true" />
        <span>
          <span className="font-semibold">Heads-up:</span>{" "}
          once the upload bar finishes, you can close this tab.{" "}
          <span className="text-[#6B705C] dark:text-[#A99878]">
            Shelfsort keeps sorting on the server — books appear in your library as each one finishes processing. Big drops use airdrop mode automatically (20+ files).
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        data-testid="airdrop-info-tip-dismiss"
        aria-label="Dismiss tip"
        className={`${compact ? "p-0.5" : "p-1"} rounded hover:bg-[#6B46C1]/10 dark:hover:bg-[#B7A7FF]/15 text-[#6B46C1] dark:text-[#B7A7FF] shrink-0`}
      >
        <X className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} aria-hidden="true" />
      </button>
    </div>
  );
}
