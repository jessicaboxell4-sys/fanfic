import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, Inbox, Check, X as XIcon, Loader2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Helpful little formatter — copies the convention from AdminConsole so
// signup timestamps read the same on both pages ("2 hours ago" / "yesterday").
const fmtTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso);
  const diffMs = Date.now() - t.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return t.toLocaleDateString();
};

/**
 * Mod inbox — the moderator-equivalent of the AdminConsole's pending-users
 * card.  Admins already see the same queue inside the full AdminConsole;
 * this exists so a mod-but-not-admin user has a clean focused page with
 * just the powers their role grants (currently: approve / reject pending
 * sign-ups).  As we expand the mod scope we'll add cards to this page —
 * locked-rooms list, reported-message inbox, etc.
 *
 * Route gating happens in App.js via ``ModeratorRoute``; this component
 * trusts that the request reached it because the user is a mod or admin.
 */
export default function ModInbox() {
  const { user } = useAuth();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/pending-users");
      setPending(data?.users || []);
    } catch {
      toast.error("Couldn't load pending sign-ups");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const approve = async (u) => {
    if (!window.confirm(`Approve ${u.email}? They'll be emailed and can sign in immediately.`)) return;
    setBusyId(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/approve`);
      toast.success(`Approved ${u.email}`);
      setPending(pending.filter((p) => p.user_id !== u.user_id));
    } catch {
      toast.error("Couldn't approve");
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async (u) => {
    setBusyId(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/reject`, { reason: rejectReason.trim() });
      toast.success(`Rejected ${u.email}`);
      setPending(pending.filter((p) => p.user_id !== u.user_id));
      setRejectingId(null);
      setRejectReason("");
    } catch {
      toast.error("Couldn't reject");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8" data-testid="mod-inbox-page">
        <Link to="/library" className="inline-flex items-center gap-1.5 text-sm text-[#6B705C] hover:text-[var(--primary)] mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to library
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <ShieldCheck className="w-7 h-7 text-[#3D8B79]" />
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Mod inbox</h1>
            <p className="text-sm text-[#6B705C]">
              Hi {user?.name || "moderator"} — approve or reject new sign-ups below.
            </p>
          </div>
        </div>

        <section
          className="bg-white border border-[#E5DDC5] rounded-2xl p-5 shadow-sm"
          data-testid="mod-pending-users-card"
        >
          <header className="flex items-center gap-2 mb-4">
            <Inbox className="w-4 h-4 text-[#6B705C]" />
            <h2 className="font-serif text-lg text-[#2C2C2C]">
              Pending sign-ups{pending.length > 0 ? ` (${pending.length})` : ""}
            </h2>
          </header>
          {loading ? (
            <p className="text-sm text-[#6B705C] italic" data-testid="mod-pending-loading">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5" data-testid="mod-pending-empty">
              <Check className="w-3.5 h-3.5" /> No one waiting. The queue is empty.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="mod-pending-list">
              {pending.map((u) => (
                <li
                  key={u.user_id}
                  className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
                  data-testid={`mod-pending-row-${u.user_id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[#2C2C2C]">{u.name || u.email}</p>
                      <p className="text-xs text-[#6B705C]">{u.email}</p>
                      <p className="text-xs text-[#6B705C] mt-0.5">
                        Signed up {fmtTime(u.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => approve(u)}
                        disabled={busyId === u.user_id}
                        data-testid={`mod-pending-approve-${u.user_id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#3D8B79] text-white hover:bg-[#2E6B5B] disabled:opacity-60"
                      >
                        {busyId === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectingId(u.user_id); setRejectReason(""); }}
                        disabled={busyId === u.user_id}
                        data-testid={`mod-pending-reject-${u.user_id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#C04A3F] hover:text-[#C04A3F] disabled:opacity-60"
                      >
                        <XIcon className="w-3.5 h-3.5" /> Reject…
                      </button>
                    </div>
                  </div>
                  {rejectingId === u.user_id && (
                    <div className="mt-3 pt-3 border-t border-[#E5DDC5] space-y-2">
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Optional reason (sent to the user via email)"
                        rows={2}
                        data-testid={`mod-pending-reject-reason-${u.user_id}`}
                        className="w-full text-sm rounded-lg border border-[#E5DDC5] px-3 py-2 focus:outline-none focus:border-[var(--primary)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setRejectingId(null); setRejectReason(""); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#6B705C]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => submitReject(u)}
                          disabled={busyId === u.user_id}
                          data-testid={`mod-pending-reject-submit-${u.user_id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#C04A3F] text-white hover:bg-[#A03D33] disabled:opacity-60"
                        >
                          {busyId === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XIcon className="w-3.5 h-3.5" />}
                          Reject &amp; email
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Future-mod-power placeholder — kept as a quiet note so mods know
            their permission scope without us showing dead cards. */}
        <p className="mt-6 text-xs text-[#6B705C] italic" data-testid="mod-inbox-scope-note">
          As a moderator you can also lock unruly bookclub rooms from inside the
          room itself. More moderation tools coming soon.
        </p>
      </main>
    </div>
  );
}
