import React, { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { getPushStatus, enablePush, disablePush } from "../lib/push";

/**
 * Card for opting into cross-device push notifications (the
 * "Continue reading on iPhone" handoff prompt).  Self-contained —
 * drop it anywhere on Account.jsx and it manages its own state.
 *
 * Hides itself entirely on browsers that don't support Push.
 */
export default function PushHandoffToggle() {
  const [state, setState] = useState({ supported: true, permission: "default", subscribed: false });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const s = await getPushStatus();
      setState((prev) => ({ ...prev, ...s }));
    } catch { /* unsupported / blocked — leave previous state */ }
  };
  useEffect(() => { refresh(); }, []);

  if (!state.supported) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (state.subscribed) {
        await disablePush();
        toast.success("Push notifications disabled");
      } else {
        await enablePush();
        toast.success("Cross-device handoff enabled");
      }
      await refresh();
    } catch (e) {
      toast.error(e?.message || "Couldn't change push settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="shelf-card p-6 mb-6"
      data-testid="push-handoff-card"
    >
      <h2 className="font-serif text-xl text-[#2C2C2C] mb-2">
        Cross-device handoff
      </h2>
      <p className="text-sm text-[#5B5F4D] mb-4">
        Get a push notification on your other devices when you stop
        reading mid-book — tap it to resume on the spot.  Works on the
        same Google account / browser profile on every device.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          data-testid="push-toggle-button"
          className={
            "tap-min inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 " +
            (state.subscribed
              ? "bg-[#B91C1C] text-white hover:bg-[#991919]"
              : "bg-[#6B46C1] text-white hover:bg-[#553397]")
          }
        >
          {state.subscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {busy ? "…" : (state.subscribed ? "Disable" : "Enable on this device")}
        </button>
        <span className="text-xs text-[#5B5F4D]">
          Status: {state.subscribed ? "subscribed" : (state.permission === "denied" ? "blocked by browser" : "not enabled")}
        </span>
      </div>
    </section>
  );
}
