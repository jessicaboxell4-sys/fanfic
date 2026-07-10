import React, { useState } from "react";
import { Lightbulb, X, Loader2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * SuggestionChip — a small pill button that opens a modal so the user
 * can suggest a feature without leaving wherever they are.
 *
 * Submits to the existing POST /api/suggestions endpoint (multipart
 * form, no attachment).  Category defaults to "feature"; device is
 * autodetected from window.navigator.userAgent so the user doesn't
 * have to think about it.
 *
 * Used in two places:
 *   * Library empty-state (when the user has 0 books)
 *   * Account dropdown / user menu (persistent, low-noise)
 *
 * Variants:
 *   * variant="pill"  — default; standalone pill button
 *   * variant="menu"  — single line that fits inside a dropdown
 */
export default function SuggestionChip({ variant = "pill", testid = "suggest-chip" }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setBody("");
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!title.trim() || title.trim().length < 3) {
      toast.error("Add at least 3 characters to the title.");
      return;
    }
    setBusy(true);
    try {
      // Detect device — coarse bucket, the backend will canonicalize.
      const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
      const device = /iPhone|iPad/.test(ua)
        ? "iPhone"
        : /Android/.test(ua) ? "Android"
        : /Macintosh/.test(ua) ? "Mac (Chrome/Safari)"
        : /Windows/.test(ua) ? "Windows (Chrome/Edge)"
        : "Other";
      const form = new FormData();
      form.append("title", title.trim());
      form.append("body", body.trim());
      form.append("category", "feature");
      form.append("device", device);
      await api.post("/suggestions", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Thanks — your idea is on the board!");
      setOpen(false);
      reset();
    } catch (err) {
      toast.error("Couldn't submit. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const trigger = variant === "menu" ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-testid={`${testid}-trigger`}
      className="w-full text-left px-3 py-1.5 rounded text-sm text-[#2C2C2C] hover:bg-[#FAF6EE] flex items-center gap-2"
    >
      <Lightbulb className="w-4 h-4 text-[#E07A5F]" aria-hidden="true" />
      Suggest a feature
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-testid={`${testid}-trigger`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FAF6EE] hover:bg-[#F2EEE5] border border-[#E07A5F]/30 text-sm text-[#5B5F4D] font-semibold transition-colors"
      title="Have an idea for Shelfsort? Drop it in the suggestion box."
    >
      <Lightbulb className="w-4 h-4 text-[#E07A5F]" aria-hidden="true" />
      Suggest a feature
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          data-testid={`${testid}-modal`}
          onClick={close}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white border border-[#EDE6D5] shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-[#EDE6D5] flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif text-xl text-[#2C2C2C]">Suggest a feature</h3>
                <p className="text-xs text-[#5B5F4D] mt-1">
                  Quick way to send the operator an idea. Replies happen on the public board.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#5B5F4D]">
                  In a sentence
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                  data-testid={`${testid}-title`}
                  placeholder="e.g. Let me drag a book between shelves"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[#EDE6D5] bg-[#FBFAF6] text-sm text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/40"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#5B5F4D]">
                  Anything else? <span className="font-normal normal-case text-[#6E6E6E]">(optional)</span>
                </span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  data-testid={`${testid}-body`}
                  placeholder="Context, examples, links — anything that helps."
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[#EDE6D5] bg-[#FBFAF6] text-sm text-[#2C2C2C] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/40 resize-none"
                />
              </label>
            </div>

            <div className="px-6 py-4 border-t border-[#EDE6D5] flex items-center justify-between gap-3">
              <Link
                to="/suggestions"
                onClick={close}
                data-testid={`${testid}-see-all`}
                className="text-xs text-[#5B5F4D] hover:text-[#6B46C1] inline-flex items-center gap-1"
              >
                See all suggestions <ExternalLink className="w-3 h-3" />
              </Link>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  data-testid={`${testid}-cancel`}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-[#EDE6D5] text-[#5B5F4D] hover:bg-[#FBFAF6] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || title.trim().length < 3}
                  data-testid={`${testid}-submit`}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#6B46C1] hover:bg-[#553397] disabled:opacity-50 text-white inline-flex items-center gap-1.5"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Send it
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
