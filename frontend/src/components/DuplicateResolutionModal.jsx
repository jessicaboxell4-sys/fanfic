import React, { useState } from "react";
import { X, AlertTriangle, Loader2, Check, Trash2, Layers } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * Modal shown right after upload when the server flagged any book as a
 * possible duplicate. For each pending book the user picks one of:
 *   - "keep"            keep both copies
 *   - "discard"         delete the just-uploaded copy
 *   - "new_version_of"  archive a chosen existing book and promote the upload
 *                       to a dated "Updated stories" shelf
 *
 * Props:
 *   - pending: Array<{ book_id, title, author, duplicate_of: [{book_id, title, author, match_reasons}] }>
 *   - onClose: () => void  — called after the user resolves everything
 *   - onResolved: () => void  — called so the dashboard can refresh
 */
const REASON_LABEL = {
  title: "same title",
  source_url: "same source URL",
  url: "shares a fanfic link",
};

export default function DuplicateResolutionModal({ pending, onClose, onResolved }) {
  // choices[book_id] = { action: 'keep' | 'discard' | 'new_version_of', target?: book_id }
  const [choices, setChoices] = useState(() => {
    const seed = {};
    for (const b of pending) {
      // Default: keep both. Safest, no destructive side-effects.
      seed[b.book_id] = { action: "keep", target: (b.duplicate_of?.[0]?.book_id) || null };
    }
    return seed;
  });
  const [submitting, setSubmitting] = useState(false);
  const [doneIds, setDoneIds] = useState(new Set());

  if (!pending || pending.length === 0) return null;

  const updateChoice = (bookId, patch) => {
    setChoices((prev) => ({ ...prev, [bookId]: { ...prev[bookId], ...patch } }));
  };

  const resolveAll = async () => {
    setSubmitting(true);
    const newlyDone = new Set(doneIds);
    let failures = 0;
    for (const b of pending) {
      if (newlyDone.has(b.book_id)) continue;
      const choice = choices[b.book_id];
      if (!choice) continue;
      const body = { action: choice.action };
      if (choice.action === "new_version_of") {
        if (!choice.target) {
          toast.error(`Pick which existing book "${b.title}" should replace.`);
          failures += 1;
          continue;
        }
        body.target_book_id = choice.target;
      }
      try {
        await api.post(`/books/${b.book_id}/resolve-duplicate`, body);
        newlyDone.add(b.book_id);
      } catch (e) {
        console.error("resolve-duplicate failed", e);
        failures += 1;
      }
    }
    setDoneIds(newlyDone);
    setSubmitting(false);
    if (failures === 0) {
      toast.success(`Resolved ${pending.length} duplicate${pending.length === 1 ? "" : "s"}`);
      onResolved && onResolved();
      onClose && onClose();
    } else {
      toast.error(`${failures} couldn't be resolved. Try again or close to skip.`);
    }
  };

  return (
    <div
      data-testid="duplicate-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#FAF6EE] rounded-2xl shadow-2xl border border-[#E07A5F]/30 w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-start gap-3 p-6 border-b border-[#E07A5F]/20">
          <div className="w-10 h-10 rounded-lg bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-2xl text-[#2C2C2C] leading-tight">
              {pending.length === 1 ? "Looks like a duplicate" : `${pending.length} possible duplicates`}
            </h2>
            <p className="text-sm text-[#6B705C] mt-1">
              We spotted these uploads matching books already on your shelves. Pick what to do with each one.
            </p>
          </div>
          <button
            data-testid="duplicate-modal-close"
            onClick={onClose}
            className="text-[#6B705C] hover:text-[#2C2C2C] p-1 rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {pending.map((b) => {
            const choice = choices[b.book_id] || { action: "keep" };
            const isDone = doneIds.has(b.book_id);
            return (
              <div
                key={b.book_id}
                data-testid={`duplicate-row-${b.book_id}`}
                className={`bg-white rounded-xl border p-4 ${isDone ? "border-green-300 opacity-60" : "border-[#E5DDC5]"}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-serif text-lg text-[#2C2C2C]">{b.title || "Untitled"}</p>
                    <p className="text-xs text-[#6B705C]">by {b.author || "Unknown"}</p>
                  </div>
                  {isDone && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
                      <Check className="w-3 h-3" /> resolved
                    </span>
                  )}
                </div>

                <p className="text-xs uppercase tracking-wide text-[#6B705C] mb-2">Matches on your shelves</p>
                <ul className="space-y-1 mb-4">
                  {(b.duplicate_of || []).map((m) => (
                    <li key={m.book_id} className="text-sm text-[#2C2C2C]">
                      <span className="font-medium">{m.title || "Untitled"}</span>
                      <span className="text-[#6B705C]"> — {m.author || "Unknown"}</span>
                      <span className="ml-2 text-xs text-[#6B705C]">
                        ({(m.match_reasons || []).map((r) => REASON_LABEL[r] || r).join(", ")})
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Pick an action">
                  <button
                    data-testid={`duplicate-action-keep-${b.book_id}`}
                    onClick={() => updateChoice(b.book_id, { action: "keep" })}
                    disabled={isDone}
                    className={`text-left p-3 rounded-lg border transition ${
                      choice.action === "keep"
                        ? "border-[#E07A5F] bg-[#FDF3E1] text-[#2C2C2C]"
                        : "border-[#E5DDC5] hover:border-[#E07A5F]/50 text-[#2C2C2C]"
                    } ${isDone ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Layers className="w-4 h-4 text-[#6B705C]" />
                      <span className="font-medium text-sm">Keep both</span>
                    </div>
                    <p className="text-xs text-[#6B705C]">Leave the new upload alongside the existing one.</p>
                  </button>

                  <button
                    data-testid={`duplicate-action-discard-${b.book_id}`}
                    onClick={() => updateChoice(b.book_id, { action: "discard" })}
                    disabled={isDone}
                    className={`text-left p-3 rounded-lg border transition ${
                      choice.action === "discard"
                        ? "border-red-400 bg-red-50 text-[#2C2C2C]"
                        : "border-[#E5DDC5] hover:border-red-300 text-[#2C2C2C]"
                    } ${isDone ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Trash2 className="w-4 h-4 text-red-600" />
                      <span className="font-medium text-sm">Discard upload</span>
                    </div>
                    <p className="text-xs text-[#6B705C]">Delete the just-uploaded copy.</p>
                  </button>

                  <button
                    data-testid={`duplicate-action-newversion-${b.book_id}`}
                    onClick={() => updateChoice(b.book_id, { action: "new_version_of" })}
                    disabled={isDone}
                    className={`text-left p-3 rounded-lg border transition ${
                      choice.action === "new_version_of"
                        ? "border-amber-400 bg-amber-50 text-[#2C2C2C]"
                        : "border-[#E5DDC5] hover:border-amber-300 text-[#2C2C2C]"
                    } ${isDone ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">Replace as new version</span>
                    </div>
                    <p className="text-xs text-[#6B705C]">Archive existing → put upload on a dated shelf.</p>
                  </button>
                </div>

                {choice.action === "new_version_of" && (b.duplicate_of || []).length > 1 && (
                  <div className="mt-3">
                    <label className="text-xs text-[#6B705C] mb-1 block">Which existing book does this replace?</label>
                    <select
                      data-testid={`duplicate-target-${b.book_id}`}
                      value={choice.target || ""}
                      onChange={(e) => updateChoice(b.book_id, { target: e.target.value })}
                      disabled={isDone}
                      className="w-full text-sm border border-[#E5DDC5] rounded p-2 bg-white"
                    >
                      {(b.duplicate_of || []).map((m) => (
                        <option key={m.book_id} value={m.book_id}>
                          {m.title || "Untitled"} — {m.author || "Unknown"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-[#E07A5F]/20 bg-white/40">
          <button
            data-testid="duplicate-modal-cancel"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm text-[#6B705C] hover:text-[#2C2C2C]"
          >
            Decide later
          </button>
          <button
            data-testid="duplicate-modal-confirm"
            onClick={resolveAll}
            disabled={submitting}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] disabled:opacity-60 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Apply choices
          </button>
        </div>
      </div>
    </div>
  );
}
