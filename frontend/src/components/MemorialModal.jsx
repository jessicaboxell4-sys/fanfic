import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Heart, Flame } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * MemorialModal (iter 89 rebuild).
 *
 * A one-time modal that surfaces the "In loving memory of Tamy N Thomas"
 * message the first time a signed-in user visits the app.  Falls back
 * silently for logged-out visitors (the memorial band on the Landing
 * page already carries the message).
 *
 * The user can opt in to have the modal re-appear on the anniversary
 * of Tamy's passing each year — that preference is persisted server-
 * side (POST /api/user/mark-memorial-seen) so it survives across
 * devices.  A localStorage fallback prevents the modal from re-firing
 * during a single browser session if the API is offline.
 */
export default function MemorialModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [anniversaryOptIn, setAnniversaryOptIn] = useState(false);

  useEffect(() => {
    if (!user) return;
    // 2026-08-22 — Playwright / testing-agent QA bypass. Adding
    // `?test=1` (or `?nomemorial=1`) to any URL suppresses the
    // memorial modal for that visit so admin-console flows aren't
    // blocked by a click-intercepting overlay. Honored ONLY at mount
    // — real users never hit this path.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("test") === "1" || params.get("nomemorial") === "1") return;
    } catch { /* ignore — SSR / weird environments */ }
    const key = `shelfsort_memorial_seen_${user.user_id}`;
    if (window.localStorage.getItem(key)) return;
    if (user.memorial_shown_at) {
      try { window.localStorage.setItem(key, user.memorial_shown_at); } catch { /* ignore */ }
      return;
    }
    setOpen(true);
  }, [user]);

  const close = async () => {
    setOpen(false);
    if (!user) return;
    try {
      const key = `shelfsort_memorial_seen_${user.user_id}`;
      window.localStorage.setItem(key, new Date().toISOString());
    } catch { /* ignore */ }
    try {
      await api.post("/user/mark-memorial-seen", {
        anniversary_opt_in: anniversaryOptIn,
      });
    } catch { /* Non-fatal — the modal has served its purpose either way. */ }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memorial-modal-name"
      data-testid="memorial-modal"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-gradient-to-b from-[#1A2436] via-[#20304A] to-[#1A2436] border border-[#2C3F5C] shadow-2xl p-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="memorial-modal-card"
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 p-1.5 rounded-full text-[#A7BDD8] hover:bg-white/10 transition-colors"
          aria-label="Close memorial"
          data-testid="memorial-modal-close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#2C3F5C] flex items-center justify-center mb-4">
            <Heart className="w-6 h-6 text-[#7BA3D6]" fill="#7BA3D6" aria-hidden="true" />
          </div>
          <p className="text-sm uppercase tracking-[0.2em] text-[#A7BDD8] mb-2">
            In loving memory of
          </p>
          <h2
            id="memorial-modal-name"
            className="font-serif text-2xl text-white mb-1"
            data-testid="memorial-modal-name"
          >
            Tamy N Thomas
          </h2>
          <p className="text-sm text-[#DCE6F3] font-semibold mb-4 inline-flex items-center gap-1.5" data-testid="memorial-modal-years">
            <span>1978 – 2026</span>
            {(() => {
              // 2026-08-24 — Silent yearly anniversary marker.  On the
              // anniversary of Tamy's passing (June, day 30) a small
              // candle-flame glyph pulses next to the years.  The
              // specific date is intentionally NEVER surfaced as
              // text — per family's request, only the year range is
              // visible.
              const d = new Date();
              if (d.getMonth() === 5 && d.getDate() === 30) {
                return (
                  <Flame
                    className="w-4 h-4 text-[#7BA3D6] animate-pulse"
                    fill="#7BA3D6"
                    aria-label="Anniversary"
                  />
                );
              }
              return null;
            })()}
          </p>
          <p className="text-sm italic text-[#DCE6F3] leading-relaxed mb-6" data-testid="memorial-modal-body">
            A lover of fanfiction. This website was built with her, and those
            with many fanfiction EPUBs, in mind, and she never got to see it.
            <br />
            Always remembered. Never forgotten.
          </p>
          <label
            className="flex items-center gap-2 text-xs text-[#A7BDD8] cursor-pointer mb-6"
            data-testid="memorial-modal-anniversary-label"
          >
            <input
              type="checkbox"
              checked={anniversaryOptIn}
              onChange={(e) => setAnniversaryOptIn(e.target.checked)}
              className="accent-[#7BA3D6]"
              data-testid="memorial-modal-anniversary-checkbox"
            />
            <span>Show me this again on the anniversary each year.</span>
          </label>
          <button
            type="button"
            onClick={close}
            className="px-6 py-2 rounded-full bg-[#7BA3D6] text-white text-sm font-semibold hover:bg-[#5A8BC7] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
