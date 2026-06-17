import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Target } from "lucide-react";
import Confetti from "./Confetti";
import { GOAL_HIT_EVENT, pulseGoalsCheck } from "../lib/goalHitWatcher";

// Mounted once at the App root. Listens for goal-hit events from two
// sources:
//
//   1. Local bus — ``goalHitWatcher`` fires the GOAL_HIT_EVENT after a
//      "Mark read" or progress update lazily flips a goal client-side.
//
//   2. Server-Sent Events — ``GET /api/goals/stream`` pushes any hit
//      detected on the backend (heartbeat-driven, friend-mark-finished,
//      goal-target-lowered) live, with no polling.  Replaces the old
//      90-second polling loop.
//
// We still call ``pulseGoalsCheck()`` once on mount: it catches up any
// hits we missed while the tab was closed AND populates the local
// "already-celebrated" set so the SSE stream doesn't re-celebrate a
// goal the user has seen on another device.
export default function GlobalConfettiHost() {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const showHit = (goal) => {
      setLabel(goal.period_label || "Goal reached");
      setActive(true);
      toast.success(`🎉 You hit "${goal.period_label || "your goal"}"!`, {
        description: `Target: ${goal.target} ${goal.metric || ""}`,
        icon: <Target className="w-4 h-4" />,
        duration: 6000,
      });
      // Confetti is one-shot — clear after a beat so a SECOND hit can
      // animate again from the start.
      window.setTimeout(() => setActive(false), 3000);
    };

    const onLocalHit = (e) => showHit(e.detail || {});
    window.addEventListener(GOAL_HIT_EVENT, onLocalHit);

    // Catch any hits we missed while logged out / on a different device.
    // This also seeds the "celebrated" set in localStorage so the SSE
    // event handler below can dedupe against it.
    pulseGoalsCheck();

    // ── SSE: live push from the backend ──────────────────────────────
    // EventSource uses the session cookie automatically with
    // withCredentials=true, since the backend is same-suffix-domain.
    // We don't reuse pulseGoalsCheck() here because the server already
    // told us the exact goal that flipped — no need to re-fetch /goals.
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/goals/stream`;
    let es;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      es = null;
    }
    if (es) {
      es.addEventListener("goal-hit", (evt) => {
        let goal = {};
        try { goal = JSON.parse(evt.data || "{}"); } catch { return; }
        if (!goal || !goal.goal_id) return;
        // De-dupe against any hit the local watcher already celebrated.
        try {
          const raw = window.localStorage.getItem("shelfsort_goals_celebrated");
          const seen = new Set(raw ? JSON.parse(raw) : []);
          if (seen.has(goal.goal_id)) return;
          seen.add(goal.goal_id);
          window.localStorage.setItem(
            "shelfsort_goals_celebrated",
            JSON.stringify([...seen]),
          );
        } catch { /* localStorage disabled — fall through and celebrate */ }
        showHit(goal);
      });
      // ``onerror`` fires on disconnect — EventSource auto-reconnects
      // with exponential backoff, so we just log and let it heal.
      es.onerror = () => {
        // Intentionally quiet: a flicker on flaky networks shouldn't
        // toast.  EventSource will retry on its own.
      };
    }

    return () => {
      window.removeEventListener(GOAL_HIT_EVENT, onLocalHit);
      if (es) es.close();
    };
  }, []);

  return (
    <>
      <Confetti active={active} />
      {/* Hidden label kept for testing — confirms which goal triggered the
          most recent celebration. */}
      <span data-testid="global-confetti-label" className="sr-only">{label}</span>
    </>
  );
}
