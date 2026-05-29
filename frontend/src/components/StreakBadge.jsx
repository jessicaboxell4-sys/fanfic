import React, { useEffect, useState, useCallback } from "react";
import { Flame } from "lucide-react";
import { api } from "../lib/api";

export default function StreakBadge() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/stats/streak");
      setData(data);
    } catch (e) {
      // Silent: no badge shown
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh every 5 minutes — streak only changes on user activity
    const t = setInterval(load, 300000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  if (!data || data.streak_days < 1) return null;

  const isHot = data.streak_days >= 7;
  const grace = data.grace_today;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        grace
          ? "bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]/30"
          : isHot
          ? "bg-[#FDEFE7] text-[#E07A5F] border border-[#E07A5F]/30"
          : "bg-[#EEF3EC] text-[#3A5A40] border border-[#3A5A40]/20"
      }`}
      title={
        grace
          ? `Read something today to keep your ${data.streak_days}-day streak alive!`
          : `${data.streak_days}-day streak · ${data.today_minutes || 0} min today`
      }
      data-testid="streak-badge"
    >
      <Flame className={`h-3.5 w-3.5 ${isHot && !grace ? "animate-pulse" : ""}`} />
      <span>
        {data.streak_days}
        <span className="hidden md:inline"> day{data.streak_days === 1 ? "" : "s"}</span>
      </span>
    </div>
  );
}
