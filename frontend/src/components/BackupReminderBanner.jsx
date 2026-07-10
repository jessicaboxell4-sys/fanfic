import React, { useEffect, useState } from "react";
import { Download, X, Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

// Gentle backup reminder. Renders nothing when the reminder API says
// "not yet" (dismissed within 14 days, or no trigger met). When shown,
// the X button quiets it for 14 days; the Download button kicks off the
// same backup stream as the Account-page card and the server-side
// `last_backup_at` write means the banner auto-quiets after a successful
// run too.
export default function BackupReminderBanner() {
  const [state, setState] = useState({ should_show: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/user/backup-reminder");
        if (!cancelled) setState(data || { should_show: false });
      } catch { /* non-fatal — banner just stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const resp = await api.get("/library/backup", {
        responseType: "blob",
        timeout: 5 * 60 * 1000,
      });
      const url = URL.createObjectURL(resp.data);
      const today = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = url;
      a.download = `shelfsort-backup-${today}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded.");
      // Backend already wrote last_backup_at — hide the banner client-side
      // so it doesn't flicker back before the next page load.
      setState({ should_show: false });
    } catch {
      toast.error("Couldn't generate the backup — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setState({ should_show: false });  // optimistic
    try {
      await api.post("/user/backup-reminder/dismiss");
    } catch { /* non-fatal */ }
  };

  if (!state.should_show) return null;

  const headline = (
    state.reason === "never_backed_up"
      ? `You have ${state.book_count} books and no backup yet.`
      : state.reason === "cadence"
        ? `It's been ${state.days_since_backup} days since your last backup.`
        : `You've added ${state.books_since_backup} books since your last backup.`
  );

  return (
    <div
      className="mb-4 shelf-card p-4 flex items-start gap-3 border-l-4 border-l-[#6B46C1]"
      data-testid="backup-reminder-banner"
    >
      <Shield className="w-5 h-5 text-[#6B46C1] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#2C2C2C]">{headline}</p>
        <p className="text-xs text-[#5B5F4D] mt-0.5">
          One click downloads every EPUB plus a manifest of your tags, smart shelves, and prefs as a single ZIP — your insurance against accidents.
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={download}
          disabled={busy}
          data-testid="backup-reminder-download"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#6B46C1] text-white hover:bg-[#2c4530] transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {busy ? "Generating…" : "Download backup"}
        </button>
        <button
          onClick={dismiss}
          data-testid="backup-reminder-dismiss"
          aria-label="Dismiss reminder"
          title="Quiet this reminder for 14 days"
          className="p-1.5 rounded-full text-[#5B5F4D] hover:bg-[#F5F3EC] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
