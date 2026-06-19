import React from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

/**
 * AntivirusBadge — visible trust signal that a book has been scanned
 * by Shelfsort's in-pod ClamAV daemon.
 *
 * Two visual modes:
 *   variant="corner" — tiny shield pip for book card overlays.
 *                     Hover reveals a tooltip with the scan date.
 *   variant="row"    — full-width info row for the BookDetail metadata
 *                     grid: "Scanned clean • Jun 19, 2026".
 *
 * Renders nothing when av_status is missing — books that haven't been
 * scanned yet (uploaded before AV rollout) simply show no badge until
 * the user runs the rescan on /account/safety.
 */
function formatScanDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

export default function AntivirusBadge({ av_status, av_scanned_at, av_signature, variant = "corner" }) {
  if (!av_status || (av_status !== "clean" && av_status !== "infected")) return null;

  const isInfected = av_status === "infected";
  const scanDate = formatScanDate(av_scanned_at);

  // Compact corner pip for card overlays.
  if (variant === "corner") {
    const tip = isInfected
      ? `Flagged by antivirus${av_signature ? ` • ${av_signature}` : ""}`
      : `Scanned clean${scanDate ? ` • ${scanDate}` : ""}`;
    return (
      <div
        data-testid={`av-badge-corner-${av_status}`}
        title={tip}
        className={`absolute bottom-2 left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md backdrop-blur-sm transition-opacity ${
          isInfected
            ? "bg-red-50/95 text-red-700 border border-red-300"
            : "bg-emerald-50/95 text-emerald-700 border border-emerald-300 opacity-70 group-hover:opacity-100"
        }`}
        aria-label={tip}
      >
        {isInfected ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
      </div>
    );
  }

  // Detail-page row: lives inside the Meta grid.
  return (
    <div data-testid={`av-badge-row-${av_status}`}>
      <p className="text-xs uppercase tracking-wider text-[#6B705C] font-semibold mb-1">
        Antivirus
      </p>
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        isInfected
          ? "bg-red-100 text-red-800 border border-red-300"
          : "bg-emerald-100 text-emerald-800 border border-emerald-300"
      }`}>
        {isInfected ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        <span>
          {isInfected
            ? (av_signature ? `Flagged: ${av_signature}` : "Flagged")
            : (scanDate ? `Scanned clean • ${scanDate}` : "Scanned clean")}
        </span>
      </div>
    </div>
  );
}
