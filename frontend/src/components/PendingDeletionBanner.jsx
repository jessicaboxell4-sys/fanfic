import React, { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

// Site-wide banner shown above MaintenanceBanner whenever the signed-in
// user has `scheduled_deletion_at` set. Lets them cancel the pending
// deletion with one click — calls /api/account/cancel-deletion, refreshes
// the auth context, and dismisses the banner.
export default function PendingDeletionBanner() {
  const { user, checkAuth } = useAuth();
  const [cancelling, setCancelling] = useState(false);

  if (!user?.scheduled_deletion_at) return null;

  const when = new Date(user.scheduled_deletion_at);
  const days = Math.max(0, Math.ceil((when.getTime() - Date.now()) / 86400000));
  const whenLabel = when.toLocaleString(undefined, { dateStyle: "long" });

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.post("/account/cancel-deletion");
      toast.success("Account deletion cancelled. Welcome back.");
      if (typeof checkAuth === "function") await checkAuth();
    } catch {
      toast.error("Couldn't cancel — try refreshing.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      data-testid="pending-deletion-banner"
      className="bg-[#FBE9E7] text-[#9B3531] border-b border-[#D9534F]/40 px-4 py-2 text-sm flex items-center gap-3"
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">
        <strong>Your account is scheduled for deletion on {whenLabel}</strong>
        {" "}({days} day{days === 1 ? "" : "s"} left). Books and files are still intact — cancel to keep your account.
      </span>
      <button
        type="button"
        onClick={cancel}
        disabled={cancelling}
        data-testid="pending-deletion-cancel-btn"
        className="px-3 py-1 rounded-lg bg-[#3A5A40] text-white text-xs font-semibold hover:bg-[#2c4530] disabled:opacity-60 flex items-center gap-1 flex-shrink-0"
      >
        {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {cancelling ? "Cancelling…" : "Cancel deletion"}
      </button>
    </div>
  );
}
