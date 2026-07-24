/**
 * UsersCards — extracted 2026-08-18 from AdminConsole.jsx.
 *
 * Cards: PendingUsersCard, UsersCard, ViewConsentsCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Check, Eye, FlaskConical, Inbox, Loader2, Plus, Users, X as XIcon } from "lucide-react";
import { Card, fmtBytes, fmtTime, fmtAgo } from "./shared";
import UserRow from "./UserRow";

export function PendingUsersCard() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(null); // null | "all" | "ref:facebook" | ...

  // Group pending users by their tracked invite campaign (the
  // ``onboarding.referral`` field, populated either by the multi-step
  // signup question OR by ``?ref=<channel>`` URL tracking).  Only
  // surface campaigns with ≥ 2 sign-ups — single sign-ups are clutter.
  const refCampaigns = (() => {
    const counts = new Map();
    for (const u of pending) {
      const r = u?.onboarding?.referral;
      if (!r) continue;
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1]);
  })();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/pending-users");
      setPending(data?.users || []);
    } catch { toast.error("Couldn't load pending sign-ups"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const approve = async (u) => {
    if (!window.confirm(`Approve ${u.email}? They'll be emailed and can sign in immediately.`)) return;
    setBusyId(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/approve`);
      toast.success(`Approved ${u.email}`);
      setPending(pending.filter((p) => p.user_id !== u.user_id));
    } catch { toast.error("Couldn't approve"); }
    finally { setBusyId(null); }
  };

  const openReject = (u) => {
    setRejectingId(u.user_id);
    setRejectReason("");
  };

  const submitReject = async (u) => {
    setBusyId(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/reject`, { reason: rejectReason.trim() });
      toast.success(`Rejected ${u.email}`);
      setPending(pending.filter((p) => p.user_id !== u.user_id));
      setRejectingId(null);
      setRejectReason("");
    } catch { toast.error("Couldn't reject"); }
    finally { setBusyId(null); }
  };

  // One-click approve everyone (or everyone from a specific campaign).
  // Each call fires its own approval email — same as the per-user
  // button — but in parallel server-side so a 20-user batch still
  // returns in well under 5s.
  //
  // ``ref`` may also come from the Campaign Conversion widget via the
  // ``shelfsort:bulk-approve-ref`` custom event (see useEffect below) —
  // that lets a single click from the funnel table jump the operator
  // straight into the confirm dialog for the matching campaign.
  const bulkApprove = async (ref) => {
    const targets = ref
      ? pending.filter((u) => u?.onboarding?.referral === ref)
      : pending;
    if (targets.length === 0) return;
    const label = ref ? `everyone from "${ref}" (${targets.length})` : `all ${targets.length} pending sign-ups`;
    if (!window.confirm(`Approve ${label}?\n\nEach user gets an approval email and can sign in immediately.`)) return;
    setBulkBusy(ref ? `ref:${ref}` : "all");
    try {
      const { data } = await api.post("/admin/pending-users/approve-bulk", { ref: ref || null });
      const okCount = data?.approved ?? 0;
      const emailedCount = data?.emails_sent ?? 0;
      toast.success(
        `Approved ${okCount} user${okCount === 1 ? "" : "s"}${emailedCount === okCount ? "" : ` · ${emailedCount} emailed`}`
      );
      const approvedIds = new Set((data?.users || []).map((u) => u.user_id));
      setPending((prev) => prev.filter((u) => !approvedIds.has(u.user_id)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't bulk-approve — try again");
    } finally {
      setBulkBusy(null);
    }
  };

  // Listen for cross-card triggers fired by the Campaign Conversion
  // widget.  Decoupled via CustomEvent so neither card has to import
  // the other or share parent state — useful since they sit in two
  // different collapsible sections.
  useEffect(() => {
    const onTrigger = (ev) => {
      const ref = ev?.detail?.ref;
      if (!ref) return;
      // Scroll the pending card into view first so the confirm dialog
      // doesn't pop up over a card the user can't see.
      const card = document.querySelector('[data-testid="admin-pending-users-card"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      // Give scroll a moment, then fire.
      setTimeout(() => bulkApprove(ref), 350);
    };
    window.addEventListener("shelfsort:bulk-approve-ref", onTrigger);
    return () => window.removeEventListener("shelfsort:bulk-approve-ref", onTrigger);
  }, [pending]);

  return (
    <Card
      icon={Inbox}
      title={`Pending sign-ups${pending.length > 0 ? ` (${pending.length})` : ""}`}
      subtitle="New users sit here until you approve or reject them. They get an email either way."
      testid="admin-pending-users-card"
    >
      <div className="mb-3 text-xs">
        <Link
          to="/admin/test-accounts"
          data-testid="admin-pending-test-accounts-link"
          className="inline-flex items-center gap-1 text-[#6B46C1] hover:underline"
          title="Fixture accounts from the testing agent are hidden from this inbox. View them separately."
        >
          <FlaskConical className="w-3.5 h-3.5" /> View test accounts →
        </Link>
      </div>

      {/* Bulk-approve toolbar — only shown when there are ≥ 2 pending.
          Each campaign chip is a one-click "Approve all from this
          channel" that uses the existing tracked invite link
          (``?ref=<channel>``) → ``onboarding.referral`` mapping. */}
      {!loading && pending.length >= 2 && (
        <div className="mb-4 p-3 rounded-xl bg-[#F5F3EC] border border-[#E5DDC5] flex flex-wrap items-center gap-2" data-testid="admin-bulk-approve-toolbar">
          <button
            type="button"
            onClick={() => bulkApprove(null)}
            disabled={bulkBusy !== null}
            data-testid="admin-bulk-approve-all"
            className="px-3 py-1.5 rounded-full bg-[#1F8F4E] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#176D3A] transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {bulkBusy === "all" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Approve all ({pending.length})
          </button>
          {refCampaigns.length > 0 && (
            <>
              <span className="text-[10px] uppercase tracking-wider text-[#5B5F4D] ml-2">or by campaign:</span>
              {refCampaigns.map(([ref, n]) => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => bulkApprove(ref)}
                  disabled={bulkBusy !== null}
                  data-testid={`admin-bulk-approve-ref-${ref}`}
                  className="px-2.5 py-1 rounded-full bg-white border border-[#E5DDC5] text-xs text-[#2C2C2C] hover:bg-[#FDFBF7] hover:border-[#6B46C1] transition-colors inline-flex items-center gap-1 disabled:opacity-60"
                  title={`Approve everyone who joined via ?ref=${ref}`}
                >
                  {bulkBusy === `ref:${ref}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3 text-[#1F8F4E]" />
                  )}
                  <span className="capitalize">{ref}</span>
                  <span className="text-[#5B5F4D]">({n})</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic" data-testid="admin-pending-loading">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5" data-testid="admin-pending-empty">
          <Check className="w-3.5 h-3.5" /> No one waiting. The queue is empty.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="admin-pending-list">
          {pending.map((u) => (
            <li
              key={u.user_id}
              className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
              data-testid={`admin-pending-row-${u.user_id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#2C2C2C]">{u.name || u.email}</p>
                  <p className="text-xs text-[#5B5F4D]">{u.email}</p>
                  <p className="text-xs text-[#5B5F4D] mt-0.5">
                    Signed up {fmtTime(u.created_at)}
                  </p>
                  {u?.onboarding?.referral && (
                    <span
                      data-testid={`admin-pending-row-ref-${u.user_id}`}
                      title={`Arrived via the ?ref=${u.onboarding.referral} invite link`}
                      className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EFE7FD] dark:bg-violet-900/40 text-[#5B3FBE] dark:text-violet-200 text-[10px] font-semibold uppercase tracking-[0.1em] border border-[#D7C8FA] dark:border-violet-700/60"
                    >
                      via {u.onboarding.referral}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => approve(u)}
                    disabled={busyId === u.user_id}
                    data-testid={`admin-approve-${u.user_id}`}
                    className="px-3 py-1.5 rounded-full bg-[#1F8F4E] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#176D3A] transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {busyId === u.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => openReject(u)}
                    disabled={busyId === u.user_id || rejectingId === u.user_id}
                    data-testid={`admin-reject-${u.user_id}`}
                    className="px-3 py-1.5 rounded-full border border-[#D9534F] text-[#D9534F] text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#FBE9E5] transition-colors disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </div>
              {rejectingId === u.user_id && (
                <div className="mt-3 pt-3 border-t border-[#E5DDC5]" data-testid={`admin-reject-form-${u.user_id}`}>
                  <label className="text-xs uppercase tracking-wider text-[#B43F26] mb-1.5 block">
                    Reason (sent to the user)
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                    placeholder="Optional. e.g. Sign-up looks automated, please re-register from a personal email."
                    rows={2}
                    data-testid={`admin-reject-reason-${u.user_id}`}
                    className="w-full text-sm bg-white border border-[#E5DDC5] rounded-lg px-3 py-2 focus:outline-none focus:border-[#D9534F] focus:ring-2 focus:ring-[#FBE9E5]"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => submitReject(u)}
                      disabled={busyId === u.user_id}
                      data-testid={`admin-reject-confirm-${u.user_id}`}
                      className="px-3 py-1.5 rounded-full bg-[#D9534F] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#a83a36] disabled:opacity-60"
                    >
                      {busyId === u.user_id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Confirm reject"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRejectingId(null); setRejectReason(""); }}
                      className="px-3 py-1.5 rounded-full text-[#5B5F4D] text-xs font-medium hover:text-[#2C2C2C]"
                    >
                      Cancel
                    </button>
                    <span className="text-xs text-[#5B5F4D] ml-auto">{rejectReason.length}/500</span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// TodayPulseCard — 24h mini-dashboard (2026-06-15)
// ---------------------------------------------------------------------------
// First-thing-in-the-morning glance: signups, uploads, Resend errors, and
// brand-new fandoms (first appearance in the last 24h). Plus a permanent
// pending-queue counter so the admin can see "you have N waiting" even
// when the PendingUsersCard is collapsed.

export function UsersCard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  // Per-user attribution timeline modal — opened via the "full timeline"
  // link next to each user's "Came from" badge.  See utils/attribution.py.
  const [timelineUser, setTimelineUser] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const openTimeline = async (u) => {
    setTimelineUser(u);
    setTimeline(null);
    setTimelineLoading(true);
    try {
      const { data } = await api.get(`/admin/attribution/user/${u.user_id}`);
      setTimeline(data?.visits || []);
    } catch {
      toast.error("Couldn't load visit timeline.");
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  };
  const closeTimeline = () => { setTimelineUser(null); setTimeline(null); };

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data?.users || []);
    } catch { if (!silent) toast.error("Couldn't load users"); }
    finally { if (!silent) setLoading(false); }
  };
  // 2026-07-01 — Live refresh every 15s while the tab is visible so
  // operators see new sign-ups / last_login shifts without hitting F5.
  // Skips ticks while a mutation is in flight (``busyId`` set) so
  // optimistic UI state doesn't get stomped mid-toggle.
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busyId) return;
      load({ silent: true });
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyId]);

  const toggleAdmin = async (u) => {
    const promoting = !u.is_admin;
    const verb = promoting ? "Promote" : "Demote";
    const consequence = promoting
      ? `${u.email} will gain full admin access — approvals, deletions, feature flags, the lot. They won't be notified, but they'll see /admin tools if they navigate there.`
      : `${u.email} will lose admin access. They won't be notified. They keep their normal user account.`;
    if (!window.confirm(`${verb} ${u.email} ${promoting ? "to admin" : "from admin"}?\n\n${consequence}`)) return;
    setBusyId(u.user_id);
    try {
      const endpoint = u.is_admin ? "demote" : "promote";
      await api.post(`/admin/users/${u.user_id}/${endpoint}`);
      toast.success(u.is_admin ? "Demoted" : "Promoted to admin");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    } finally { setBusyId(null); }
  };

  // Mod-flag toggle — independent column from admin.  Admins are NOT
  // implicitly mods; promoting to mod doesn't touch admin and vice
  // versa (so the audit log stays clean and the powers are scoped).
  // Confirmation prompt added 2026-06-22 after an accidental click on
  // launch day — same pattern as the admin toggle above.
  const toggleMod = async (u) => {
    const promoting = !u.is_moderator;
    const verb = promoting ? "Promote" : "Demote";
    const consequence = promoting
      ? `${u.email} will gain moderator tools (approve sign-ups, lock bookclub rooms, etc). They won't be notified — the role is silent until they navigate to a mod-only page.`
      : `${u.email} will lose moderator tools. They won't be notified.`;
    if (!window.confirm(`${verb} ${u.email} ${promoting ? "to moderator" : "from moderator"}?\n\n${consequence}`)) return;
    setBusyId(u.user_id);
    try {
      const endpoint = u.is_moderator ? "demote-mod" : "promote-mod";
      await api.post(`/admin/users/${u.user_id}/${endpoint}`);
      toast.success(u.is_moderator ? "Mod role removed" : "Promoted to moderator");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    } finally { setBusyId(null); }
  };

  // Heuristic for "this is a developer/QA test account". Catches:
  //   - any @example.com / @test.* / @localhost address
  //   - emails containing the word "test" (e.g. testuser+1@gmail.com)
  //   - "+test" plus-addressed mailboxes
  //   - placeholder seed accounts like helptest@ / admin@example
  // Real users almost never match any of these.
  const isTestUser = (u) => {
    const e = (u.email || "").toLowerCase();
    if (!e) return false;
    if (/@example\.com$/.test(e)) return true;
    if (/@(test|localhost)(\.|$)/.test(e)) return true;
    if (/\+test[\w-]*@/.test(e)) return true;
    if (/(^|\b)test\d*@/.test(e)) return true;
    if (/(^|[._-])(qa|qatest|helptest|seed|dummy)([._-]|@)/.test(e)) return true;
    return false;
  };

  // Presence helpers — a user is "online" if they've had any auth-touched
  // request within the last 5 minutes.  See `utils/auth_dep.py` for the
  // throttled last_seen_at writer.  We compute this once per render so the
  // per-row pill and the header counts agree.
  const ONLINE_MS = 5 * 60 * 1000;
  const isUserOnline = (u) => {
    if (!u.last_seen_at) return false;
    return Date.now() - new Date(u.last_seen_at).getTime() < ONLINE_MS;
  };
  // Short human relative for the "· active Xm ago" pill sub-label.
  // <60s → "just now", <5m → "Xm ago".  Anything older isn't online.
  const fmtActive = (iso) => {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60 * 1000) return "just now";
    const mins = Math.floor(diffMs / 60000);
    return `${mins}m ago`;
  };

  const realUsersUnsorted = users.filter((u) => !isTestUser(u));
  const testUsers = users.filter(isTestUser);
  const realOnlineCount = realUsersUnsorted.filter(isUserOnline).length;
  const realOfflineCount = realUsersUnsorted.length - realOnlineCount;
  // 2026-07-21 — Sort online users to the top of the list.
  // Array.prototype.sort is stable in modern engines (ES2019+), so
  // offline users keep the server-provided order.  When a user comes
  // online they float to the top; when they go offline the row slots
  // right back into its original position.  Split into two arrays
  // for the section divider render below.
  const realOnline  = realUsersUnsorted.filter(isUserOnline);
  const realOffline = realUsersUnsorted.filter((u) => !isUserOnline(u));
  const realUsers   = [...realOnline, ...realOffline];

  // 2026-08-22 — The row markup (presence pill, badges, attribution
  // strip, mod/admin toggles) lives in ./UserRow. This one-liner
  // adapts the .map(renderRow) callsites below so the closure over
  // handlers/helpers still works without re-plumbing every list.
  const renderRow = (u) => (
    <UserRow
      key={u.user_id}
      u={u}
      busyId={busyId}
      toggleAdmin={toggleAdmin}
      toggleMod={toggleMod}
      openTimeline={openTimeline}
      isUserOnline={isUserOnline}
      fmtActive={fmtActive}
      isTestUser={isTestUser}
    />
  );


  return (
    <Card icon={Users} title="Users & admins" subtitle="Promote or demote any account. The last admin cannot be demoted." testid="admin-users-card">
      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {/* Real users — always visible.  This is the list admins
              actually care about day-to-day. */}
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
              Real users
              <span className="ml-2 font-normal normal-case text-[#9B9B8C]">({realUsers.length})</span>
              <span className="ml-2 font-normal normal-case text-[#5B5F4D]/80 inline-flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1"
                  data-testid="admin-users-online-count"
                  title={`${realOnlineCount} real user${realOnlineCount === 1 ? "" : "s"} active in the last 5 minutes`}
                >
                  <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-[#3D6B3D]" />
                  Online: {realOnlineCount}
                </span>
                <span
                  className="inline-flex items-center gap-1"
                  data-testid="admin-users-offline-count"
                  title={`${realOfflineCount} real user${realOfflineCount === 1 ? "" : "s"} not seen in the last 5 minutes`}
                >
                  <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-[#9B9B8C]/70" />
                  Offline: {realOfflineCount}
                </span>
              </span>
            </p>
          </div>
          <ul className="space-y-1.5" data-testid="admin-users-list">
            {realOnline.map(renderRow)}
            {realOnline.length > 0 && realOffline.length > 0 && (
              <li
                aria-hidden="true"
                data-testid="admin-users-online-offline-divider"
                className="flex items-center gap-2 py-1 px-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#9B9B8C] dark:text-white/50 select-none"
              >
                <span className="h-px flex-1 bg-[#E5DDC5] dark:bg-zinc-700" />
                Offline · {realOffline.length}
                <span className="h-px flex-1 bg-[#E5DDC5] dark:bg-zinc-700" />
              </li>
            )}
            {realOffline.map(renderRow)}
            {realUsers.length === 0 && (
              <li className="text-sm text-[#5B5F4D] italic px-3 py-2">No real users yet.</li>
            )}
          </ul>

          {/* Test / QA accounts — folded into a <details> so they don't
              clutter the main list.  Click to expand when you actually
              need to demote or audit them. */}
          {testUsers.length > 0 && (
            <details className="mt-4 group" data-testid="admin-users-test-collapse">
              <summary className="cursor-pointer select-none flex items-baseline justify-between px-1 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] hover:text-[#2C2C2C]">
                <span>
                  Test / QA accounts
                  <span className="ml-2 font-normal normal-case text-[#9B9B8C]">({testUsers.length})</span>
                </span>
                <span className="text-[10px] font-semibold text-[#9B9B8C] group-open:hidden">expand ▾</span>
                <span className="text-[10px] font-semibold text-[#9B9B8C] hidden group-open:inline">collapse ▴</span>
              </summary>
              <ul className="space-y-1.5 mt-2" data-testid="admin-users-test-list">
                {testUsers.map(renderRow)}
              </ul>
              <p className="mt-2 text-[10px] text-[#9B9B8C] italic">
                Matched by email pattern (example.com, test+, helptest@, etc.). False positives can&apos;t be moved out of this list yet — flag one and we&apos;ll add a per-user override.
              </p>
            </details>
          )}
        </>
      )}
      {/* Per-user attribution timeline modal */}
      {timelineUser && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2C2C2C]/60 backdrop-blur-sm p-4"
          data-testid="admin-user-timeline-modal"
          onClick={closeTimeline}
        >
          <div
            className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[#E5DDC5] flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">Visit timeline</p>
                <p className="font-serif text-2xl text-[#2C2C2C] leading-tight truncate">{timelineUser.name || timelineUser.email}</p>
                <p className="text-xs text-[#7A7457] truncate">{timelineUser.email}</p>
              </div>
              <button
                type="button"
                onClick={closeTimeline}
                aria-label="Close"
                className="text-[#7A7457] hover:text-[#2C2C2C] p-1"
                data-testid="admin-user-timeline-close"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {timelineLoading ? (
                <p className="text-xs text-[#5B5F4D] italic py-6 text-center">Loading…</p>
              ) : timeline && timeline.length > 0 ? (
                <ol className="space-y-2" data-testid="admin-user-timeline-list">
                  {timeline.map((v, i) => (
                    <li
                      key={i}
                      className="bg-white border border-[#E5DDC5] rounded-lg px-3 py-2 text-xs"
                      data-testid={`admin-user-timeline-visit-${i}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.referrer_label ? (
                          <>
                            <span className="text-[#2C2C2C] font-semibold" data-testid={`admin-user-timeline-label-${i}`}>{v.referrer_label}</span>
                            <span className="font-mono text-[10px] text-[#7A7457]">· {v.referrer_domain}</span>
                          </>
                        ) : (
                          <span className="font-mono text-[#6B46C1]">{v.referrer_domain || "direct"}</span>
                        )}
                        {v.utm_campaign && (
                          <span className="text-[10px] bg-[#EEE9FB] text-[#6B46C1] px-1.5 py-0.5 rounded">{v.utm_campaign}</span>
                        )}
                        <span className="text-[#7A7457] text-[10px] ml-auto">{v.arrived_at ? new Date(v.arrived_at).toLocaleString() : "?"}</span>
                      </div>
                      {v.referrer_url && (
                        <a
                          href={v.referrer_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block text-[#6B46C1] hover:text-[#E07A5F] underline decoration-dotted underline-offset-2 break-all"
                          title={v.referrer_url}
                        >
                          {v.referrer_url}
                        </a>
                      )}
                      <div className="mt-1 text-[10px] text-[#7A7457] flex flex-wrap gap-x-3 gap-y-0.5">
                        {v.landing_path && <span>landed: <code className="bg-[#F4EFE4] px-1 rounded">{v.landing_path}</code></span>}
                        {v.utm_source && <span>utm_source: <code className="bg-[#F4EFE4] px-1 rounded">{v.utm_source}</code></span>}
                        {v.utm_medium && <span>utm_medium: <code className="bg-[#F4EFE4] px-1 rounded">{v.utm_medium}</code></span>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-[#5B5F4D] italic py-6 text-center" data-testid="admin-user-timeline-empty">
                  No attribution records yet — this user hasn&apos;t opened a browser session since attribution was introduced (2026-07-01).
                </p>
              )}
            </div>
          </div>
        </div>
      )}

    </Card>
  );
}

// ---------------------------------------------------------------------------
// Maintenance banner card (b)
// ---------------------------------------------------------------------------
// AlertHealthBanner — surfaces silent cron-alert pipeline failures
// ---------------------------------------------------------------------------
// The cron-failure-alert path in ``utils/cron_health.py`` is intentionally
// best-effort: any error in admin lookup, Resend config, or the Resend
// API itself is swallowed so the alerting pipeline can never *itself*
// crash the cron wrapper. That's safe but blind — silent drop-outs go
// un-noticed until a human reads backend logs.
//
// This banner reads ``/admin/alert-health`` on mount and renders a
// dismissable strip at the top of /admin if anything fired in the last
// 24h that *should* have alerted but didn't. Two failure modes:
//   • Red strip   — Resend returned an error mid-send.
//   • Amber strip — A cron job errored but no alert row ever got written
//                   for it (usually Resend isn't configured, the feature
//                   flag is off, or no admin has an email set).
//
// Dismissal is intentionally local-only (sessionStorage) — the next page
// load surfaces it again if it's still happening, so it can't be
// silenced into permanent obscurity.
const ALERT_HEALTH_DISMISS_KEY = "shelfsort.admin.alert-health-dismissed-at";
export { ALERT_HEALTH_DISMISS_KEY, SUPPRESSION_REASON_LABEL, SUPPRESSION_FIX_HINT };

// Friendly labels + fix-hints for each suppression reason the
// backend can record on ``cron_alerts`` rows.  Kept here (not in a
// shared module) because they're admin-banner-specific copy.
const SUPPRESSION_REASON_LABEL = {
  resend_not_configured: "Resend not configured",
  no_admin_recipients:   "No admins with email",
  feature_flag_off:      "Feature flag off",
  admin_lookup_failed:   "Admin lookup failed",
  unknown:               "Unknown reason",
};
const SUPPRESSION_FIX_HINT = {
  resend_not_configured: "Set RESEND_API_KEY and SENDER_EMAIL in backend/.env, then restart the backend.",
  no_admin_recipients:   "Add an email to at least one admin user in the Users & admins card.",
  feature_flag_off:      "Toggle 'cron_failure_alerts' back on in the Feature flags card.",
  admin_lookup_failed:   "Mongo couldn't be queried for admin emails — check /api/health.",
};


export function ViewConsentsCard() {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targetUid, setTargetUid] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/view-requests/mine");
      setConsents(data?.consents || []);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submitRequest = async (e) => {
    e?.preventDefault?.();
    if (!targetUid.trim()) { toast.error("Enter a user_id"); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post(
        `/admin/users/${targetUid.trim()}/view-request`,
        { reason: reason.trim() },
      );
      if (data?.created) {
        toast.success("Request sent. The user will see it on their Account page.");
      } else {
        toast.message("A pending or active request already exists for this user.");
      }
      setTargetUid("");
      setReason("");
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't send request";
      toast.error(typeof msg === "string" ? msg : "Couldn't send request");
    } finally { setSubmitting(false); }
  };

  const tone = (status) => ({
    pending: { bg: "bg-[#F5F0E0]", fg: "text-[#8B4F00]", label: "Waiting on user" },
    granted: { bg: "bg-[#EEF3EC]", fg: "text-[#1F4D2A]", label: "Active" },
    denied: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Denied" },
    revoked: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Revoked" },
    expired: { bg: "bg-[#F5F3EC]", fg: "text-[#5B5F4D]", label: "Expired" },
  }[status] || { bg: "bg-[#F5F3EC]", fg: "text-[#5B5F4D]", label: status });

  const active = consents.filter((c) => c.status === "granted");
  const pending = consents.filter((c) => c.status === "pending");
  const past = consents.filter((c) => !["granted", "pending"].includes(c.status));

  return (
    <Card
      icon={Eye}
      title={`View-as-user consents${active.length > 0 ? ` (${active.length} active)` : ""}`}
      subtitle="Read-only access to a user's library — requires their explicit consent. All reads are audit-logged."
      testid="admin-view-consents-card"
    >
      <form onSubmit={submitRequest} className="mb-4 rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3" data-testid="view-consent-request-form">
        <p className="text-xs uppercase tracking-wider text-[#6B46C1] mb-2 font-bold">Request access</p>
        <input
          type="text" value={targetUid}
          onChange={(e) => setTargetUid(e.target.value)}
          placeholder="user_id (find via Top storage users card)"
          data-testid="view-consent-uid-input"
          className="w-full text-sm bg-white border border-[#E5DDC5] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#6B46C1] mb-2 font-mono"
        />
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          rows={2}
          placeholder="Why? (shown to the user)"
          data-testid="view-consent-reason-input"
          className="w-full text-sm bg-white border border-[#E5DDC5] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#6B46C1]"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="submit" disabled={submitting || !targetUid.trim()}
            data-testid="view-consent-submit"
            className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553B96] disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Send request"}
          </button>
          <span className="text-xs text-[#5B5F4D] ml-auto">{reason.length}/500</span>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : consents.length === 0 ? (
        <p className="text-sm text-[#5B5F4D] italic">No view requests yet.</p>
      ) : (
        <div className="space-y-3">
          {[
            { label: "Active grants", rows: active },
            { label: "Pending", rows: pending },
            { label: "Past 30 days", rows: past },
          ].filter((g) => g.rows.length > 0).map((g) => (
            <div key={g.label}>
              <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-1.5">{g.label}</p>
              <ul className="space-y-1.5" data-testid={`view-consent-group-${g.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {g.rows.map((c) => {
                  const t = tone(c.status);
                  return (
                    <li
                      key={c.consent_id}
                      className="rounded-lg border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 px-3 py-2 flex flex-wrap items-center gap-3"
                      data-testid={`view-consent-row-${c.consent_id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2C2C2C] truncate">{c.user_name || c.user_email}</p>
                        <p className="text-xs text-[#5B5F4D] truncate">{c.user_email}</p>
                        {c.reason && <p className="text-xs text-[#5B5F4D] italic mt-0.5">&ldquo;{c.reason}&rdquo;</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full ${t.bg} ${t.fg} text-xs font-medium flex-shrink-0`}>
                        {t.label}
                      </span>
                      {c.status === "granted" && (
                        <>
                          <Link
                            to={`/admin/view/${c.user_id}`}
                            data-testid={`view-consent-open-${c.consent_id}`}
                            className="px-3 py-1 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553B96] flex-shrink-0"
                          >
                            View now
                          </Link>
                          {c.expires_at && (
                            <span className="text-xs text-[#5B5F4D] flex-shrink-0">
                              expires {new Date(c.expires_at).toLocaleString(undefined, {dateStyle:"short",timeStyle:"short"})}
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}



// Users card (a)
// ---------------------------------------------------------------------------

