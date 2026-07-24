// Reading-status helpers — 2026-07-20.
//
// A book's reading status is derived from its `progress_fraction`:
//   • no progress or 0            → "unread"
//   • 0 < p < 0.99                → "reading"
//   • p >= 0.99                   → "finished"
//
// The tri-state badge on every card (grid, list, compact) reads from
// `getReadingStatus(book)` and pulls display metadata from
// `READING_STATUS_META`.  The single source of truth so we don't
// re-derive with slightly different thresholds across files.
//
// `nextReadingStatus(current)` walks the cycle Unread → Reading →
// Finished → Unread, used by the hover cycle button on BookCard.
export function getReadingStatus(book) {
  const p = book?.progress_fraction;
  if (typeof p !== "number" || p <= 0.001) return "unread";
  if (p >= 0.99) return "finished";
  return "reading";
}

export function nextReadingStatus(status) {
  if (status === "unread") return "reading";
  if (status === "reading") return "finished";
  return "unread";
}

export const READING_STATUS_META = {
  unread: {
    label: "Unread",
    // Cream badge — subtle, doesn't compete with the cover art
    className: "bg-[#F5F0E5] text-[#5B5F4D] border border-[#E4D9C8]",
    listClassName: "text-[10px] font-bold uppercase tracking-wider text-[#7A7457]",
  },
  reading: {
    label: "Reading",
    // Amber — the "in progress" tone matches the progress bar
    className: "bg-[#FDF3E1] text-[#8C5C00] border border-[#F5E0A8]",
    listClassName: "text-[10px] font-bold uppercase tracking-wider text-[#B7791F]",
  },
  finished: {
    label: "Finished",
    // Purple — matches the existing Read badge tone
    className: "bg-[#6B46C1] text-white border border-[#6B46C1]",
    listClassName: "text-[10px] font-bold uppercase tracking-wider text-[#81B29A]",
  },
};
