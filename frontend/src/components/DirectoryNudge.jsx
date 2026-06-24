import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, X } from "lucide-react";

// One-shot dismissible nudge surfaced on the Dashboard once the user
// has ≥5 books — points them at /users so they discover the friend-
// finding flow without us having to add another navbar item.  Dismissed
// state lives in localStorage and is permanent (they won't see it
// again from this browser).
const DISMISS_KEY = "shelfsort.directoryNudgeDismissed.v1";
const MIN_BOOKS = 5;

export default function DirectoryNudge({ totalBooks }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!Number.isFinite(totalBooks) || totalBooks < MIN_BOOKS) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch { /* localStorage blocked — show anyway */ }
    setShow(true);
  }, [totalBooks]);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <aside
      data-testid="directory-nudge"
      className="mb-6 p-4 rounded-xl border border-[#6B46C1]/20 bg-gradient-to-r from-[#EEE9FB] to-[#FBFAF6] flex items-start gap-3"
    >
      <div className="w-9 h-9 rounded-lg bg-white text-[#6B46C1] flex items-center justify-center flex-shrink-0 shadow-sm">
        <Users className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#2C2C2C]">
          Find readers you know on Shelfsort.
        </p>
        <p className="text-xs text-[#6B705C] mt-0.5">
          Browse the public reader directory — just usernames, no library peeking.
          Send a friend request and you can swap recommendations and (with their permission) borrow files.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Link
            to="/users"
            data-testid="directory-nudge-open-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397]"
            onClick={dismiss}
          >
            Open the directory →
          </Link>
          <button
            type="button"
            onClick={dismiss}
            data-testid="directory-nudge-dismiss-btn"
            className="text-xs text-[#6B705C] hover:text-[#2C2C2C] font-semibold px-2 py-1"
          >
            Not now
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        data-testid="directory-nudge-close-btn"
        aria-label="Dismiss"
        className="text-[#6B705C] hover:text-[#2C2C2C] p-1 flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </aside>
  );
}
