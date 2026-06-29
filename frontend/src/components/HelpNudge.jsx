import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle, ArrowRight, X } from "lucide-react";

// One-time dashboard banner that points users at the new /help guide.
// Dismissal is local-only — flipping a key in localStorage hides the
// banner forever for this browser, which is plenty for a discovery nudge.
const STORAGE_KEY = "shelfsort:help-nudge-dismissed";

export default function HelpNudge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      // localStorage blocked (private mode, embedded contexts) — just hide.
      setVisible(false);
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      data-testid="help-nudge"
      className="mb-6 shelf-card p-4 flex flex-wrap items-center justify-between gap-3 bg-[#FDF3E1] border-[#E07A5F]/30"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#E07A5F]/15 text-[#E07A5F] flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-5 h-5" />
        </div>
        <p className="text-sm text-[#2C2C2C]">
          <span className="font-medium">New:</span> a full Shelfsort guide lives at{" "}
          <code className="text-[#5B5F4D]">/help</code> — uploads, smart shelves, refresh,
          version diffs, exports, everything.
        </p>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <Link
          to="/help"
          data-testid="help-nudge-open"
          onClick={dismiss}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[#E07A5F] text-white hover:bg-[#d06a4f] inline-flex items-center gap-2"
        >
          Open the guide <ArrowRight className="w-4 h-4" />
        </Link>
        <button
          data-testid="help-nudge-dismiss"
          onClick={dismiss}
          className="p-2 text-[#5B5F4D] hover:text-[#2C2C2C] rounded-lg hover:bg-white/60"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
