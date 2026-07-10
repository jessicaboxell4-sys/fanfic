import React, { useState, useEffect } from "react";
import { Info, X } from "lucide-react";

/**
 * OneTimeTip
 * ----------
 * Reusable in-context educational banner — the standard Shelfsort
 * pattern for introducing any new feature to existing users.  Drop
 * one next to whatever surface the new feature affects; users see
 * it the first time they visit that surface, dismiss with the X,
 * and it never re-appears for them on that browser.
 *
 * **CONVENTION (2026-06-27 onwards)** — every new user-facing
 * feature gets a `OneTimeTip` mounted near the surface it affects.
 * See `/app/memory/CONVENTIONS.md` for the full rule + template.
 *
 * Props:
 *   • tipKey        — unique slug used to build the localStorage
 *                     dismissal key.  Format: `<feature-slug>`.
 *                     Example: `"airdrop-tab-close"`,
 *                     `"characters-browser"`, `"wrapped-share"`.
 *   • title         — bold lead-in.  Defaults to `"Heads-up:"`.
 *                     Common alternatives: `"New:"`, `"Tip:"`,
 *                     `"Did you know?"`.
 *   • children      — the body of the tip (anything renderable).
 *   • compact       — tighter padding + smaller text for in-card use.
 *   • accent        — `"purple"` (default) or `"amber"` to match the
 *                     surface's existing visual tone.
 *
 * The dismissal key follows the convention
 *   `shelfsort.tip.<tipKey>-dismissed = "1"`
 * so admin tooling / QA can reset any individual tip without
 * clobbering unrelated localStorage state.
 */
const ACCENTS = {
  purple: {
    bg: "bg-[#EEE9FB] dark:bg-[#2A1F4F]",
    border: "border-[#6B46C1]/30 dark:border-[#B7A7FF]/30",
    icon: "text-[#6B46C1] dark:text-[#B7A7FF]",
    hover: "hover:bg-[#6B46C1]/10 dark:hover:bg-[#B7A7FF]/15",
  },
  amber: {
    bg: "bg-[#FDF3E1] dark:bg-[#3a2f1a]",
    border: "border-[#E07A5F]/40 dark:border-[#8C5C00]/60",
    icon: "text-[#E07A5F] dark:text-[#E6CFA1]",
    hover: "hover:bg-[#E07A5F]/15 dark:hover:bg-[#8C5C00]/30",
  },
};

export default function OneTimeTip({
  tipKey,
  title = "Heads-up:",
  children,
  compact = false,
  accent = "purple",
}) {
  const storageKey = `shelfsort.tip.${tipKey}-dismissed`;
  const palette = ACCENTS[accent] || ACCENTS.purple;

  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; }
    catch { return false; }
  });

  // Re-check on mount in case another tab dismissed it.
  useEffect(() => {
    try { setDismissed(localStorage.getItem(storageKey) === "1"); }
    catch (e) { void e; }
  }, [storageKey]);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(storageKey, "1"); }
    catch (e) { void e; }
  };

  if (dismissed) return null;

  return (
    <div
      data-testid={`one-time-tip-${tipKey}`}
      className={`${compact ? "mb-2 px-3 py-2 text-xs" : "mb-4 px-4 py-3 text-sm"} flex items-start justify-between gap-3 rounded-lg ${palette.bg} border ${palette.border} text-[#2C2C2C] dark:text-[#E6CFA1]`}
    >
      <div className="flex items-start gap-2.5">
        <Info className={`${compact ? "w-3.5 h-3.5 mt-0.5" : "w-4 h-4 mt-0.5"} shrink-0 ${palette.icon}`} aria-hidden="true" />
        <span>
          <span className="font-semibold">{title}</span>{" "}
          {children}
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        data-testid={`one-time-tip-${tipKey}-dismiss`}
        aria-label="Dismiss tip"
        className={`${compact ? "p-0.5" : "p-1"} rounded ${palette.hover} ${palette.icon} shrink-0`}
      >
        <X className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} aria-hidden="true" />
      </button>
    </div>
  );
}
