/**
 * VerdictBadges — clickable cluster of reading-state + verdict chips
 * on a book card.  Tap any chip to open a small popover that lets you
 * change the reading state (single-select) and toggle verdicts
 * (multi-select).  All edits round-trip to PATCH /api/books/:id/verdict
 * and the parent re-renders from the response.
 *
 * Designed to fit on both the grid card (compact mode) and the list
 * row (full mode).  In compact mode we show only the FIRST chip + a
 * "+N" overflow indicator; in full mode we show everything.
 *
 * Empty state: a single "+ Verdict" pill that opens the popover so a
 * user can mark a brand-new book without first hovering or right-
 * clicking.
 */
import React, { useState, useRef, useEffect } from "react";
import { Check } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { useVerdictTaxonomy, lookupVerdict, lookupReadingState } from "../lib/useVerdictTaxonomy";

export default function VerdictBadges({
  book,
  compact = true,
  onChange,
}) {
  const { taxonomy } = useVerdictTaxonomy();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const popRef = useRef(null);
  const btnRef = useRef(null);

  // Local optimistic state — mirror what the server thinks until a
  // PATCH lands.  The book prop is the source of truth on remount.
  const [state, setState] = useState(book.reading_state || null);
  const [verdicts, setVerdicts] = useState(book.verdicts || []);
  useEffect(() => {
    setState(book.reading_state || null);
    setVerdicts(book.verdicts || []);
  }, [book.book_id, book.reading_state, book.verdicts]);

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)
          && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!taxonomy) return null;  // wait for first taxonomy fetch

  const stateMeta = lookupReadingState(taxonomy, state);

  const applyPatch = async (patch) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/books/${book.book_id}/verdict`, patch);
      setState(data.reading_state || null);
      setVerdicts(data.verdicts || []);
      onChange && onChange(data);
    } catch (e) {
      toast.error("Couldn't update verdict");
    } finally {
      setBusy(false);
    }
  };

  const setReadingState = (key) => {
    // Toggle off if it's already the current value
    if (state === key) {
      applyPatch({ reading_state: "" });
    } else {
      applyPatch({ reading_state: key });
    }
  };

  const toggleVerdict = (key) => {
    if (verdicts.includes(key)) {
      applyPatch({ verdicts_remove: [key] });
    } else {
      applyPatch({ verdicts_add: [key] });
    }
  };

  // Compact summary: first chip wins (state > favorite > others), with a
  // "+N" pill when there's more.  Empty → "+ Mark" call-to-action.
  const chips = [];
  if (stateMeta) chips.push({ key: state, label: stateMeta.label, emoji: stateMeta.emoji, source: "state" });
  for (const vk of verdicts) {
    const meta = lookupVerdict(taxonomy, vk);
    if (meta) chips.push({ key: vk, label: meta.label, emoji: meta.emoji, source: "verdict" });
  }

  const visible = compact ? chips.slice(0, 1) : chips;
  const overflow = compact ? Math.max(0, chips.length - 1) : 0;

  return (
    <div className="relative inline-flex items-center gap-1" data-testid={`verdict-badges-${book.book_id}`}>
      {chips.length === 0 ? (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
          data-testid={`verdict-add-${book.book_id}`}
          className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4] font-semibold transition-colors"
          title="Mark this book (favorite, need to read, etc.)"
        >
          + Mark
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
          data-testid={`verdict-open-${book.book_id}`}
          className="inline-flex items-center gap-1 cursor-pointer"
        >
          {visible.map((c) => (
            <span
              key={c.key}
              title={c.label}
              className={
                "text-[10px] px-1.5 py-0.5 rounded-full font-semibold " +
                (c.source === "state"
                  ? "bg-[#EDE7FB] text-[#4B2D86]"
                  : "bg-[#FDF3E1] text-[#B87A00]")
              }
            >
              {c.emoji} <span className="hidden md:inline">{c.label}</span>
            </span>
          ))}
          {overflow > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F5F3EC] text-[#5B5F4D] font-semibold"
              data-testid={`verdict-overflow-${book.book_id}`}
              title={chips.slice(1).map((c) => `${c.emoji} ${c.label}`).join(", ")}
            >
              +{overflow}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          ref={popRef}
          data-testid={`verdict-popover-${book.book_id}`}
          className="absolute z-50 top-full left-0 mt-1.5 w-64 bg-white border border-[#E5DDC5] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] p-3 text-[#2C2C2C]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] uppercase tracking-wider font-bold text-[#5B5F4D] mb-1.5">
            Reading state
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {taxonomy.reading_states.map((s) => {
              const active = state === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setReadingState(s.key)}
                  disabled={busy}
                  data-testid={`verdict-state-${s.key}`}
                  aria-pressed={active}
                  className={
                    "text-xs px-2 py-1 rounded-full font-semibold transition-colors " +
                    (active
                      ? "bg-[#6B46C1] text-white"
                      : "bg-[#F5F3EC] text-[#2C2C2C] hover:bg-[#E8E2D4]")
                  }
                >
                  {s.emoji} {s.label}
                </button>
              );
            })}
          </div>

          <div className="text-[10px] uppercase tracking-wider font-bold text-[#5B5F4D] mb-1.5">
            Verdicts
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...taxonomy.builtin_verdicts, ...(taxonomy.custom_verdicts || [])].map((v) => {
              const active = verdicts.includes(v.key);
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => toggleVerdict(v.key)}
                  disabled={busy}
                  data-testid={`verdict-toggle-${v.key}`}
                  aria-pressed={active}
                  className={
                    "text-xs px-2 py-1 rounded-full font-semibold transition-colors inline-flex items-center gap-1 " +
                    (active
                      ? "bg-[#B87A00] text-white"
                      : "bg-[#F5F3EC] text-[#2C2C2C] hover:bg-[#E8E2D4]")
                  }
                >
                  {v.emoji} {v.label}
                  {active && <Check className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
