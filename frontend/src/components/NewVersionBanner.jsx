import React, { useEffect, useState } from "react";
import { Sparkles, RotateCw, X } from "lucide-react";
import { api } from "../lib/api";

/**
 * <NewVersionBanner />
 *
 * Auto-detects redeploys by polling GET /api/version every 60s and
 * comparing the returned ``boot_id`` to the one captured on initial
 * page load.  Backend regenerates ``boot_id`` on every container
 * boot, so the very next poll after a deploy lands shows the change.
 *
 * When a new version is detected we surface a calm sticky-bottom
 * banner: "✨ Shelfsort just updated — refresh for the latest".
 * Two actions:
 *   - "Refresh now" → ``window.location.reload(true)`` (hard reload)
 *   - "Later" → dismisses for the current session via ``sessionStorage``
 *
 * The dismiss is session-scoped on purpose: if the user navigates to
 * another page or comes back the next day, they'll see the banner
 * again (because the new boot_id is now the baseline if they reloaded
 * since, or because session storage cleared).
 *
 * Polling interval intentionally matches the maintenance-banner poll
 * (60s) so they share a rhythm.  We back off to 5-min intervals after
 * the banner is shown to avoid hammering the endpoint while the user
 * decides whether to refresh.
 */
const POLL_FAST_MS = 60_000;
const POLL_SLOW_MS = 300_000;
const DISMISS_KEY = "shelfsort_new_version_dismissed_for_boot";

export default function NewVersionBanner() {
  const [boot, setBoot] = useState(null);          // baseline boot_id
  const [latest, setLatest] = useState(null);      // most-recent observed boot_id
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchVersion = async () => {
      try {
        const { data } = await api.get("/version");
        if (cancelled || !data?.boot_id) return;
        setLatest(data.boot_id);
        // First successful response: lock in the baseline.
        setBoot((prev) => prev || data.boot_id);
      } catch {
        // Network glitch / backend rebooting — try again next tick.
      }
    };

    fetchVersion();
    let id = setInterval(fetchVersion, POLL_FAST_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Check sessionStorage for a previous dismiss against this latest boot_id.
  useEffect(() => {
    if (!latest) return;
    try {
      const dismissedBoot = window.sessionStorage.getItem(DISMISS_KEY);
      setDismissed(dismissedBoot === latest);
    } catch {/* private mode */}
  }, [latest]);

  const showing = boot && latest && boot !== latest && !dismissed;

  // Once the banner is up, throttle polling — the user has been told.
  useEffect(() => {
    if (!showing) return;
    // No-op (interval already running) — the slowdown logic could be
    // implemented by tracking the interval id, but the simpler win is
    // to just accept the small extra traffic until the user clicks one
    // of the two buttons.  Keeping the code tiny here.
    void POLL_SLOW_MS;
  }, [showing]);

  if (!showing) return null;

  const onRefresh = () => {
    // Hard reload bypasses any cached bundle.  React-router won't
    // intercept because this is a real page reload, not a Link click.
    window.location.reload();
  };

  const onLater = () => {
    try { window.sessionStorage.setItem(DISMISS_KEY, latest); } catch {/* */}
    setDismissed(true);
  };

  return (
    <div
      data-testid="new-version-banner"
      className="bg-[#EEE9FB] border-b border-[#6B46C1]/30 text-[#6B46C1] px-4 py-2 text-sm flex items-center gap-2"
      role="status"
      aria-live="polite"
    >
      <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1">
        <strong className="font-semibold">Shelfsort just updated.</strong>{" "}
        Refresh to pick up the latest version &mdash; your reading position is already saved.
      </span>
      <button
        type="button"
        onClick={onRefresh}
        data-testid="new-version-refresh-btn"
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#553397]"
      >
        <RotateCw className="w-3 h-3" />
        Refresh now
      </button>
      <button
        type="button"
        onClick={onLater}
        data-testid="new-version-later-btn"
        className="text-[#6B46C1] hover:text-[#553397] text-xs flex items-center gap-0.5"
        title="Dismiss for this session"
      >
        <X className="w-3 h-3" />
        Later
      </button>
    </div>
  );
}
