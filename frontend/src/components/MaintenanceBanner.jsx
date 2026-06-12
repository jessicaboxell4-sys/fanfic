import React, { useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { api } from "../lib/api";

// Site-wide maintenance/heads-up banner. Polls /api/maintenance-banner
// every 60s. Renders nothing when the endpoint returns null (i.e. the
// admin has not enabled a banner). Severity controls the colour:
//   info  — calm sand/green
//   warn  — amber
//   error — red
const SEV_STYLES = {
  info:  { bg: "bg-[#EAF0EB]", border: "border-[#3A5A40]/30", text: "text-[#3A5A40]", Icon: Info },
  warn:  { bg: "bg-[#FDF3E1]", border: "border-[#B87A00]/40", text: "text-[#8C5C00]", Icon: AlertTriangle },
  error: { bg: "bg-[#FBE9E7]", border: "border-[#D9534F]/40", text: "text-[#9B3531]", Icon: AlertCircle },
};

export default function MaintenanceBanner() {
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/maintenance-banner");
        if (!cancelled) setBanner(data || null);
      } catch { /* ignore — banner is non-essential */ }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!banner || !banner.message) return null;
  const style = SEV_STYLES[banner.severity] || SEV_STYLES.info;
  const Icon = style.Icon;
  return (
    <div
      data-testid="maintenance-banner"
      className={`${style.bg} ${style.text} border-b ${style.border} px-4 py-2 text-sm flex items-center gap-2`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{banner.message}</span>
    </div>
  );
}
