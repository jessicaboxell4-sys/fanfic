import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { UserPlus, X } from "lucide-react";

/**
 * FriendRequestBanner
 * --------------------
 * Tiny inline banner that surfaces incoming friend requests so users
 * don't have to open the navbar bell to see them.  Dismissible per
 * browser-session (sessionStorage), self-fetches from
 * GET /api/friends/pending-count and silently hides when count is 0
 * or the user is signed out.
 */
const DISMISS_KEY = "shelfsort.friendRequestBanner.dismissed";

export default function FriendRequestBanner() {
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    api.get("/friends/pending-count")
      .then(({ data }) => { if (!cancelled) setCount(data?.pending_in || 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (e) { void e; }
  };

  if (dismissed || count <= 0) return null;

  return (
    <div
      data-testid="friend-request-banner"
      className="mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#FDF3E1] dark:bg-[#3a2f1a] border border-[#E07A5F]/40 dark:border-[#8C5C00]/60"
    >
      <div className="flex items-center gap-3 text-sm text-[#8C5C00] dark:text-[#E6CFA1]">
        <UserPlus className="w-4 h-4 shrink-0" />
        <span>
          <span className="font-semibold" data-testid="friend-request-banner-count">
            {count === 1 ? "1 new friend request" : `${count} new friend requests`}
          </span>
          {" — "}
          <Link
            to="/friends"
            data-testid="friend-request-banner-link"
            className="underline underline-offset-2 hover:text-[#6B46C1] dark:hover:text-[#B7A7FF]"
          >
            see who wants to be friends
          </Link>
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        data-testid="friend-request-banner-dismiss"
        aria-label="Dismiss friend request banner"
        className="p-1 rounded hover:bg-[#E07A5F]/15 dark:hover:bg-[#8C5C00]/30 text-[#8C5C00] dark:text-[#E6CFA1]"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
