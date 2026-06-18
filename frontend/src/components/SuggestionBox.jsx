import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Lightbulb, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * Tiny "💡 Suggest" pill in the Navbar.  Click → popover with a
 * textarea + Send button.  Saves to the ``suggestions`` collection
 * along with the current path so the admin triage view can spot
 * page-specific patterns.
 *
 * Pages can opt-out by adding their path to ``EXCLUDE_PATHS`` —
 * e.g., the dedicated `/feedback` page (if we ever ship one) or
 * the in-Reader fullscreen view where a popover would clash with
 * the immersive UI.
 */
const EXCLUDE_PATHS = [
  /^\/read\//,                  // immersive Reader view
  /^\/read-original\//,         // ditto for non-EPUB viewer
  /^\/welcome$/,                // first-time tour overlay owns its own UI
  /^\/share\//,                 // public share pages — visitors only
];

export default function SuggestionBox() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  const shouldShow = !EXCLUDE_PATHS.some((re) => re.test(loc.pathname || ""));

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const submit = async () => {
    const t = text.trim();
    if (t.length < 4) {
      toast.error("Add a few more words so we can act on it.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/feedback", { text: t, page: loc.pathname });
      toast.success("Thank you — we read every one.");
      setText("");
      setOpen(false);
    } catch {
      toast.error("Couldn't send right now — try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  if (!shouldShow) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="navbar-suggestion-btn"
        onClick={() => setOpen((v) => !v)}
        title="Suggest a feature or report something"
        aria-expanded={open}
        className="hidden md:inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[#6B705C] hover:text-[#6B46C1] px-2 py-1 rounded-md hover:bg-[#F5F3EC]"
      >
        <Lightbulb className="w-3.5 h-3.5" /> Suggest
      </button>
      {/* Mobile: icon-only button */}
      <button
        type="button"
        data-testid="navbar-suggestion-btn-mobile"
        onClick={() => setOpen((v) => !v)}
        title="Suggest a feature"
        aria-expanded={open}
        className="md:hidden inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-[#F5F3EC] text-[#6B705C]"
      >
        <Lightbulb className="w-4 h-4" />
      </button>

      {open && (
        <div
          data-testid="navbar-suggestion-popover"
          className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-[#E8E6E1] p-4 z-50"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-[#2C2C2C] flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-[#E07A5F]" /> Suggest something
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 hover:bg-[#F5F3EC] rounded"
            >
              <X className="w-3.5 h-3.5 text-[#6B705C]" />
            </button>
          </div>
          <p className="text-[11px] text-[#6B705C] mb-2">
            A bug, a feature wish, a worded-better — anything goes. We read every one.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What would you change?"
            maxLength={2000}
            rows={4}
            data-testid="navbar-suggestion-textarea"
            className="w-full text-sm bg-[#FDFBF7] border border-[#E8E6E1] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#E07A5F] focus:ring-1 focus:ring-[#E07A5F]/30 resize-none"
            autoFocus
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-[#6B705C]">{text.length}/2000</span>
            <button
              type="button"
              onClick={submit}
              disabled={busy || text.trim().length < 4}
              data-testid="navbar-suggestion-send"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#E07A5F] text-white hover:bg-[#c66a52] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
