import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Target } from "lucide-react";
import Confetti from "./Confetti";
import { GOAL_HIT_EVENT, pulseGoalsCheck } from "../lib/goalHitWatcher";

// Mounted once at the App root. Listens for the global "goal hit" event,
// fires a confetti burst, and surfaces a celebration toast so the user
// notices even if confetti is hidden behind a modal.
//
// Also polls /api/goals once on mount (so a fresh page load right after
// a "Mark read" still surfaces the celebration) and every 90 seconds
// while the tab is focused so passive hits (e.g. heartbeat reaching
// minute thresholds) get caught too.
export default function GlobalConfettiHost() {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const onHit = (e) => {
      const goal = e.detail || {};
      setLabel(goal.period_label || "Goal reached");
      setActive(true);
      // Light, friendly toast — doesn't compete with the visual burst.
      toast.success(`🎉 You hit "${goal.period_label || "your goal"}"!`, {
        description: `Target: ${goal.target} ${goal.metric || ""}`,
        icon: <Target className="w-4 h-4" />,
        duration: 6000,
      });
      // Confetti is one-shot — clear after a beat so a SECOND hit can
      // animate again from the start.
      window.setTimeout(() => setActive(false), 3000);
    };
    window.addEventListener(GOAL_HIT_EVENT, onHit);
    // Catch any hits we missed while logged out / on a different device
    pulseGoalsCheck();
    // Periodic safety net — covers minute-based goals that flip while
    // the user is just reading a book.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") pulseGoalsCheck();
    }, 90000);
    return () => {
      window.removeEventListener(GOAL_HIT_EVENT, onHit);
      window.clearInterval(id);
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
