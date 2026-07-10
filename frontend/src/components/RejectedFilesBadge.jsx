// RejectedFilesBadge — tiny Navbar pill that surfaces the count of
// upload failures from the last 7 days.  Clicking the badge jumps
// the user to /library and scrolls the rejected-files banner on the
// dashboard into view so they can re-drop the files without having
// to hunt for the section.
//
// Lives next to BackgroundJobsBell in the Navbar.  Auto-hides when
// there are no failures, so the navbar stays clean for happy users.
// Polls every 30s; also refreshes when the tab regains focus.

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "../lib/api";

const POLL_INTERVAL_MS = 30000;
const DAYS = 7;

export default function RejectedFilesBadge() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/uploads/failures?days=${DAYS}`);
      setCount(Array.isArray(data?.failures) ? data.failures.length : 0);
    } catch {
      // Silent — non-essential surface.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const goToBanner = () => {
    const scrollNow = () => {
      const el = document.querySelector('[data-testid="dashboard-failed-uploads"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    if (location.pathname === "/library") {
      // Already on the dashboard — scroll immediately, but also re-load
      // in case the user has been sitting here without focus changes.
      load();
      // Wait a tick so any re-render that exposes the section completes.
      setTimeout(scrollNow, 50);
      return;
    }
    navigate("/library");
    // After navigation, the section needs a brief moment to mount
    // before scrollIntoView can find it.  Retry a few times with a
    // small backoff so we don't fire before the dashboard hydrates.
    let tries = 0;
    const max = 20;  // ~2s total
    const tryScroll = () => {
      tries += 1;
      const el = document.querySelector('[data-testid="dashboard-failed-uploads"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (tries < max) setTimeout(tryScroll, 100);
    };
    setTimeout(tryScroll, 100);
  };

  if (count <= 0) return null;

  const label = `${count} upload${count === 1 ? "" : "s"} didn't go through — click to review`;

  return (
    <button
      type="button"
      onClick={goToBanner}
      title={label}
      aria-label={label}
      data-testid="navbar-rejected-files-badge"
      data-count={count}
      className="relative inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-[#A03D33] bg-[#FBE7E4] hover:bg-[#F4D1CC] border border-[#E07A5F]/40 transition-colors"
    >
      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
      <span data-testid="navbar-rejected-files-count">{count}</span>
    </button>
  );
}
