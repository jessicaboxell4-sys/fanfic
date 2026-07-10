import React, { useEffect, useState } from "react";
import { Shield, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * Privacy toggle: opt out of contributing your reading cursors to
 * the cross-reader heatmap aggregate.  Default is opt-in (ON).
 */
export default function ReadingPrivacyToggle() {
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/analytics/reading-data-sharing");
        setShared(data.reading_data_shared !== false);
      } catch { /* default on */ }
    })();
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/analytics/reading-data-sharing", {
        reading_data_shared: !shared,
      });
      setShared(data.reading_data_shared);
      toast.success(
        data.reading_data_shared
          ? "Your reading data feeds the aggregate"
          : "Your reading data is now private",
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    } finally { setBusy(false); }
  };

  return (
    <section
      className="shelf-card p-6 mb-6"
      data-testid="reading-privacy-card"
    >
      <h2 className="font-serif text-xl text-[#2C2C2C] mb-2">
        Reading-data sharing
      </h2>
      <p className="text-sm text-[#5B5F4D] mb-4">
        While reading, Shelfsort can roll up your anonymous chapter
        progress into a heatmap on the book detail page (only visible
        when 10+ readers have contributed).  Toggle this off if you
        prefer your reading stays purely private.
      </p>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        data-testid="reading-privacy-toggle"
        className={
          "tap-min inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 " +
          (shared
            ? "bg-[#6B46C1] text-white hover:bg-[#553397]"
            : "bg-white text-[#5B5F4D] border border-[#E8E6E1] hover:border-[#6B46C1]")
        }
      >
        {shared ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
        {shared ? "Contributing to heatmap" : "Private — not contributing"}
      </button>
    </section>
  );
}
