import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, Users, Heart, AlertTriangle, Activity, Layers,
  BarChart3, ToggleLeft, ClipboardList, Loader2, Plus, X as XIcon, Trash2,
  Check, ChevronRight, ChevronDown, Download, AlertOctagon, RotateCcw, Send,
  Mail, MessageSquare, Clock, CircleAlert, Route as RouteIcon, Search,
  Inbox, Database, Siren, HardDrive, TrendingUp, Eye, BookOpen, Sparkles, ShieldAlert,
} from "lucide-react";
import MongoInspectorCard from "../components/MongoInspectorCard";
import ModerationLogCard from "../components/ModerationLogCard";
import AdminAnalyticsCard from "../components/AdminAnalyticsCard";

// ---------------------------------------------------------------------------
// Page-level "Expand all / Collapse all" broadcast
// ---------------------------------------------------------------------------
// Every Card on this page is collapsed by default — admins click the section
// header (or the chevron) to reveal that one section. The toolbar at the top
// can bulk-open or bulk-close via these tick counters: each Card listens and
// flips its local `open` state when a tick increments.
// `remember` lets the user opt in to persisting each card's open/closed state
// to localStorage across page loads — off by default so the page is always
// tidy on first visit.
// `query` is the live search box value. Cards whose title + subtitle don't
// contain the (lowercased) query string render null so the page becomes a
// targeted view when an admin is firefighting a specific subsystem.
const AdminCardsContext = React.createContext({ openTick: 0, closeTick: 0, remember: false, query: "" });
const REMEMBER_PREF_KEY = "shelfsort.admin.remember-open";
const CARD_STATE_PREFIX = "shelfsort.admin.card.";

// Hardcoded manifest used by the search bar's "X of N · No matches" count
// and the suggestion chips. Kept in sync with the Card title/subtitle strings
// below; extra `keywords` make the search forgiving (e.g. "outage" matches
// the Maintenance banner card whose title doesn't contain that word).
const ADMIN_CARD_MANIFEST = [
  { testid: "admin-pending-users-card", title: "Pending sign-ups", subtitle: "Approve or reject new users.", keywords: "pending sign-up approval new user gate queue invite waitlist" },
  { testid: "admin-today-pulse-card", title: "Today · 24h pulse", subtitle: "Signups, uploads, errors at a glance.", keywords: "today pulse signups uploads errors fandoms 24h daily summary" },
  { testid: "admin-feedback-inbox-card", title: "Feedback inbox", subtitle: "User-submitted bugs, ideas, and feature requests.", keywords: "feedback suggestions bug feature request inbox users reports tickets" },
  { testid: "admin-help-feedback-card", title: "Help-page feedback", subtitle: "Per-page friction reports with screenshots.", keywords: "help suggestion friction page screenshot photo feedback short-form by-page" },
  { testid: "admin-signup-rules-card", title: "Sign-up rules & questions", subtitle: "Approval gate, onboarding questions, community rules.", keywords: "signup register approval gate onboarding questions rules community moderation referral fandom reader type" },
  { testid: "admin-antivirus-card", title: "Antivirus", subtitle: "ClamAV scanner status + recent flags.", keywords: "antivirus clamav virus malware scan quarantine infected eicar signature" },
  { testid: "admin-storage-by-user-card", title: "Top storage users", subtitle: "Top 20 accounts by uploaded bytes.", keywords: "storage user disk bytes top biggest heavy quota power outliers abandoned" },
  { testid: "admin-storage-trend-card", title: "Storage trend · 30 days", subtitle: "Cumulative bytes over time.", keywords: "storage trend disk growth chart graph history snapshot 30d size bytes" },
  { testid: "admin-view-consents-card", title: "View-as-user consents", subtitle: "Request read-only access to a user's library.", keywords: "view as user impersonate consent privacy access permission timeline" },
  { testid: "admin-users-card", title: "Users & admins", subtitle: "Promote or demote any account.", keywords: "users admins promote demote roles accounts" },
  { testid: "admin-watching-bookclubs-card", title: "Rooms I'm watching", subtitle: "Every bookclub the platform owner has been auto-added to.", keywords: "bookclubs rooms watching oversight admin auto-join clubs moderate" },
  { testid: "admin-chat-rooms-card", title: "Chat rooms", subtitle: "Direct-message rooms.", keywords: "chat rooms messages dm direct message conversations" },
  { testid: "admin-unknown-fandoms-card", title: "Unknown fandoms", subtitle: "Fandoms not yet in the keyword classifier.", keywords: "unknown fandoms classifier rescan dismiss missing tag" },
  { testid: "admin-banner-card", title: "Maintenance banner", subtitle: "Site-wide announcement banner.", keywords: "maintenance banner outage announcement downtime planned heads-up" },
  { testid: "admin-health-card", title: "System health", subtitle: "External dependencies + storage snapshot.", keywords: "health system mongo storage disk dependencies status" },
  { testid: "cron-health-card", title: "Scheduled jobs", subtitle: "Last-run telemetry for crons.", keywords: "cron jobs scheduled task background failure last-run" },
  { testid: "route-catalogue-card", title: "Route catalogue", subtitle: "Every /api/* endpoint.", keywords: "route catalogue endpoint api list routes urls" },
  { testid: "email-stats-card", title: "Resend deliveries · this week", subtitle: "Send volume, error rate, recent failures.", keywords: "email resend delivery send failure stats bounce mail" },
  { testid: "admin-email-diagnostic-card", title: "Email diagnostic", subtitle: "One-shot diagnostic email.", keywords: "email diagnostic test send resend troubleshoot mail" },
  { testid: "admin-aliases-card", title: "Global fandom aliases", subtitle: "Tenant-wide fandom aliases.", keywords: "fandom aliases global rename remap synonym" },
  { testid: "admin-stats-card", title: "Global stats", subtitle: "Tenant-wide rollup.", keywords: "stats global rollup books users storage signups categories fandoms" },
  { testid: "admin-flags-card", title: "Feature flags", subtitle: "Runtime kill switches.", keywords: "feature flags toggles kill switch runtime config" },
  { testid: "admin-audit-card", title: "Audit log", subtitle: "Every admin write action.", keywords: "audit log history admin actions write changes" },
  { testid: "admin-moderation-log-card", title: "Moderation log", subtitle: "All-time history of mod actions.", keywords: "moderation log mod history actions approvals rejections locks bookclub" },
  { testid: "admin-mongo-inspector-card", title: "Mongo inspector", subtitle: "Read-only browse of every collection.", keywords: "mongo db database collections docs raw browse inspect" },
  { testid: "admin-fulltext-card", title: "Full-text index", subtitle: "Backfill EPUB body text for search.", keywords: "fulltext full-text search epub index backfill body" },
];

function cardMatchesQuery(card, q) {
  if (!q) return true;
  const haystack = `${card.title} ${card.subtitle} ${card.keywords}`.toLowerCase();
  return haystack.includes(q);
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------
function Card({ icon: Icon, title, subtitle, children, testid }) {
  // Every admin section starts collapsed so the page is just a tidy
  // index of category headers. Click the header (or chevron) to reveal.
  // If the user opted into "remember open sections", we hydrate the
  // initial value from localStorage and persist on every change.
  const { openTick, closeTick, remember, query } = useContext(AdminCardsContext);
  const storageKey = testid ? `${CARD_STATE_PREFIX}${testid}` : null;
  const [open, setOpen] = useState(() => {
    if (!remember || !storageKey) return false;
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  useEffect(() => { if (openTick > 0) setOpen(true); }, [openTick]);
  useEffect(() => { if (closeTick > 0) setOpen(false); }, [closeTick]);
  useEffect(() => {
    if (!remember || !storageKey) return;
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open, remember, storageKey]);

  // Search filter: hide this card entirely when the page-level query
  // doesn't match title / subtitle / extra keywords from the manifest.
  if (query && testid) {
    const manifest = ADMIN_CARD_MANIFEST.find((m) => m.testid === testid);
    const extraKeywords = manifest ? manifest.keywords : "";
    const haystack = `${title} ${subtitle || ""} ${extraKeywords}`.toLowerCase();
    if (!haystack.includes(query)) return null;
  }

  return (
    <section
      className="shelf-card p-6 mb-6"
      data-testid={testid}
      data-collapsed={open ? "false" : "true"}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testid ? `${testid}-toggle` : undefined}
        className={`w-full flex items-start gap-3 text-left ${open ? "mb-4" : "mb-0"}`}
      >
        <div className="w-10 h-10 rounded-xl bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">{title}</h2>
          {subtitle && <p className="text-sm text-[#6B705C] mt-0.5">{subtitle}</p>}
        </div>
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] flex-shrink-0 pt-1.5">
          {open ? "Hide" : "Show"}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div data-testid={testid ? `${testid}-body` : undefined}>{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PendingUsersCard — approval queue for new sign-ups (2026-06-15)
// ---------------------------------------------------------------------------
// Every new sign-up (email/password OR Google OAuth) lands in
// ``approval_status="pending"`` and can't use the API. This card shows
// FIFO of pending users and lets the admin Approve (sets ``"approved"``,
// emails the user) or Reject with a reason (sets ``"rejected"``, emails
// the reason). The very first user ever auto-approves so the install
// bootstraps itself — see ``routes/auth.py``.
function PendingUsersCard() {
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

  return (
    <Card
      icon={Inbox}
      title={`Pending sign-ups${pending.length > 0 ? ` (${pending.length})` : ""}`}
      subtitle="New users sit here until you approve or reject them. They get an email either way."
      testid="admin-pending-users-card"
    >
      {loading ? (
        <p className="text-sm text-[#6B705C] italic" data-testid="admin-pending-loading">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5" data-testid="admin-pending-empty">
          <Check className="w-3.5 h-3.5" /> No one waiting. The queue is empty.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="admin-pending-list">
          {pending.map((u) => (
            <li
              key={u.user_id}
              className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
              data-testid={`admin-pending-row-${u.user_id}`}
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
                      className="px-3 py-1.5 rounded-full text-[#6B705C] text-xs font-medium hover:text-[#2C2C2C]"
                    >
                      Cancel
                    </button>
                    <span className="text-xs text-[#6B705C] ml-auto">{rejectReason.length}/500</span>
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
function TodayPulseCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/today-pulse");
      setData(data);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <Card
      icon={Activity}
      title="Today · 24h pulse"
      subtitle="What happened in the last 24 hours."
      testid="admin-today-pulse-card"
    >
      {loading || !data ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="admin-today-pulse-tiles">
            <StatTile label="Sign-ups" value={data.signups_24h} />
            <StatTile label="Uploads" value={data.uploads_24h} />
            <StatTile label="Resend errors" value={data.resend_errors_24h} />
            <StatTile label="New fandoms" value={data.new_fandoms_24h} />
            <StatTile label="Pending queue" value={data.pending_count} />
          </div>
          {data.new_fandom_names && data.new_fandom_names.length > 0 && (
            <details className="mt-4 group" data-testid="admin-today-new-fandoms">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] inline-flex items-center gap-1.5">
                <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                New fandom names ({data.new_fandom_names.length} of {data.new_fandoms_24h})
              </summary>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.new_fandom_names.map((f) => (
                  <li
                    key={f}
                    className="px-2 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] text-xs"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            onClick={load}
            data-testid="admin-today-pulse-refresh"
            className="mt-4 text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553397] inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-3 h-3" /> Refresh
          </button>
        </>
      )}
    </Card>
  );
}



// ---------------------------------------------------------------------------
// FeedbackInboxCard — admin view over user-submitted suggestions
// ---------------------------------------------------------------------------
// The /suggestions collection already powers the public Suggestions page
// (`/suggestions` route). This card just surfaces the same data with an
// admin-only filter and the existing status-update endpoint baked in.
function FeedbackInboxCard() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("open"); // open | under_review | planned | done | declined | all
  const [loading, setLoading] = useState(true);
  const [openCount, setOpenCount] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter === "all" ? {} : { status: filter };
      const [{ data: list }, { data: count }] = await Promise.all([
        api.get("/suggestions", { params }),
        api.get("/admin/suggestions/open-count"),
      ]);
      setItems(list?.suggestions || []);
      setOpenCount(count?.open || 0);
    } catch { toast.error("Couldn't load feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const setStatus = async (sid, status) => {
    setBusyId(sid);
    try {
      await api.put(`/admin/suggestions/${sid}`, { status });
      toast.success(`Marked ${status.replace("_", " ")}`);
      // Optimistic: drop the item from the current view if filter no longer matches
      if (filter !== "all" && filter !== status) {
        setItems(items.filter((i) => i.suggestion_id !== sid));
        if (status !== "open") setOpenCount(Math.max(0, openCount - 1));
      } else {
        setItems(items.map((i) => i.suggestion_id === sid ? { ...i, status } : i));
      }
    } catch { toast.error("Couldn't update"); }
    finally { setBusyId(null); }
  };

  const statusBadge = (s) => {
    const map = {
      open: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Open" },
      under_review: { bg: "bg-[#F5F0E0]", fg: "text-[#8B4F00]", label: "Reviewing" },
      planned: { bg: "bg-[#E8EEF5]", fg: "text-[#3A5A8C]", label: "Planned" },
      done: { bg: "bg-[#EEF3EC]", fg: "text-[#1F4D2A]", label: "Done" },
      declined: { bg: "bg-[#F5F3EC]", fg: "text-[#6B705C]", label: "Declined" },
    };
    const t = map[s] || map.open;
    return <span className={`px-2 py-0.5 rounded-full ${t.bg} ${t.fg} text-xs font-medium`}>{t.label}</span>;
  };

  const cat = (c) => ({
    bug: { fg: "text-[#B43F26]", label: "Bug" },
    improvement: { fg: "text-[#3A5A8C]", label: "Tweak" },
    feature: { fg: "text-[#6B46C1]", label: "Feature" },
  }[c] || { fg: "text-[#6B705C]", label: c });

  return (
    <Card
      icon={MessageSquare}
      title={`Feedback inbox${openCount > 0 ? ` (${openCount} open)` : ""}`}
      subtitle="Bugs, tweaks, and feature requests from your users."
      testid="admin-feedback-inbox-card"
    >
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="feedback-filter-row">
        {[
          ["open", "Open"],
          ["under_review", "Reviewing"],
          ["planned", "Planned"],
          ["done", "Done"],
          ["declined", "Declined"],
          ["all", "All"],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            data-testid={`feedback-filter-${val}`}
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
              filter === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#6B705C] hover:bg-[#E8E2D4]"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> No {filter === "all" ? "" : filter.replace("_", " ")} feedback right now.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="feedback-list">
          {items.map((it) => {
            const c = cat(it.category);
            const open = expanded === it.suggestion_id;
            return (
              <li
                key={it.suggestion_id}
                className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
                data-testid={`feedback-row-${it.suggestion_id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold uppercase tracking-[0.15em] ${c.fg}`}>{c.label}</span>
                      {statusBadge(it.status)}
                      <span className="text-xs text-[#6B705C]">· {it.votes_count} vote{it.votes_count === 1 ? "" : "s"}</span>
                    </div>
                    <p className="font-medium text-[#2C2C2C] mt-1">{it.title}</p>
                    <p className="text-xs text-[#6B705C] mt-0.5">
                      {it.submitter_name || it.submitter_email || "Anonymous"} · {fmtTime(it.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpanded(open ? null : it.suggestion_id)}
                    data-testid={`feedback-expand-${it.suggestion_id}`}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553B96]"
                  >
                    {open ? "Hide" : "Show"}
                  </button>
                </div>
                {open && (
                  <div className="mt-3 pt-3 border-t border-[#E5DDC5]">
                    {it.body ? (
                      <p className="text-sm text-[#2C2C2C] whitespace-pre-wrap mb-3">{it.body}</p>
                    ) : (
                      <p className="text-sm text-[#6B705C] italic mb-3">No description.</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {["under_review", "planned", "done", "declined", "open"]
                        .filter((s) => s !== it.status)
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() => setStatus(it.suggestion_id, s)}
                            disabled={busyId === it.suggestion_id}
                            data-testid={`feedback-status-${it.suggestion_id}-${s}`}
                            className="px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#2C2C2C] text-xs disabled:opacity-60 capitalize"
                          >
                            → {s.replace("_", " ")}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// HelpFeedbackCard — Help-page SuggestionBox feed
// ---------------------------------------------------------------------------
// Distinct from FeedbackInboxCard (which sits on the older `/api/suggestions`
// product board with titles/votes/categories). This card surfaces the
// short-form Help-page SuggestionBox stream: free-text + optional screenshot,
// grouped by the page the user was on when they wrote it.  The aggregation
// widget on top reveals which routes generate the most friction; clicking
// a row drills into that page's entries below.
function HelpFeedbackCard() {
  const [byPage, setByPage] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("open"); // open | all
  const [pageFilter, setPageFilter] = useState(""); // "" = all pages
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const statusParam = status === "all" ? "" : status;
      const [{ data: agg }, { data: list }] = await Promise.all([
        api.get("/admin/feedback/by-page", { params: { status: statusParam, limit: 30 } }),
        api.get("/admin/feedback", { params: { status: statusParam, page: pageFilter || undefined, limit: 100 } }),
      ]);
      setByPage(agg?.rows || []);
      setRows(list?.rows || []);
    } catch { toast.error("Couldn't load help feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, pageFilter]);

  const totalCount = byPage.reduce((s, r) => s + (r.count || 0), 0);

  return (
    <Card
      icon={MessageSquare}
      title={`Help-page feedback${totalCount > 0 ? ` (${totalCount})` : ""}`}
      subtitle="Free-text + screenshot reports from the Help page, grouped by where the user was."
      testid="admin-help-feedback-card"
    >
      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="help-feedback-filter-row">
        {[
          ["open", "Open"],
          ["all", "All"],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => { setStatus(val); setPageFilter(""); setExpanded(null); }}
            data-testid={`help-feedback-status-${val}`}
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
              status === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#6B705C] hover:bg-[#E8E2D4]"
            }`}
          >
            {lbl}
          </button>
        ))}
        {pageFilter && (
          <button
            type="button"
            onClick={() => { setPageFilter(""); setExpanded(null); }}
            data-testid="help-feedback-clear-page"
            className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] bg-[#FBE9E5] text-[#B43F26] hover:bg-[#F6D7CE]"
          >
            <XIcon className="w-3 h-3" />
            Page: {pageFilter}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {/* Per-page aggregation widget */}
          {byPage.length === 0 ? (
            <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5 mb-2" data-testid="help-feedback-empty">
              <Check className="w-3.5 h-3.5" /> No {status === "all" ? "" : status} feedback yet.
            </p>
          ) : (
            <div className="mb-5" data-testid="help-feedback-by-page">
              <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] font-bold mb-2">By page</p>
              <ul className="grid gap-1.5">
                {byPage.map((r) => {
                  const active = pageFilter === r.page;
                  return (
                    <li key={r.page || "(unknown)"}>
                      <button
                        type="button"
                        onClick={() => { setPageFilter(active ? "" : r.page); setExpanded(null); }}
                        data-testid={`help-feedback-page-${r.page || "unknown"}`}
                        className={`w-full flex items-center justify-between gap-3 text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#EDE6FA] border-[#6B46C1] text-[#2C2C2C]"
                            : "bg-[#FBFAF6] border-[#E5DDC5] hover:bg-[#F5F0E0] text-[#2C2C2C]"
                        }`}
                      >
                        <span className="truncate font-mono text-xs">{r.page || "(unknown)"}</span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          {r.with_photo > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.15em] text-[#6B705C]">
                              <ImageIconAlias /> {r.with_photo}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold">{r.count}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Drill-down list */}
          {rows.length > 0 && (
            <div data-testid="help-feedback-list">
              <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] font-bold mb-2">
                {pageFilter ? `Entries on ${pageFilter}` : "Latest entries"} · {rows.length}
              </p>
              <ul className="space-y-2">
                {rows.map((r, idx) => {
                  const id = `${r.ts}-${idx}`;
                  const open = expanded === id;
                  const text = r.text || "";
                  return (
                    <li
                      key={id}
                      className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
                      data-testid={`help-feedback-row-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#6B705C] font-mono truncate">{r.page || "(unknown)"}</p>
                          <p className="text-sm text-[#2C2C2C] mt-0.5 line-clamp-2">{text}</p>
                          <p className="text-xs text-[#6B705C] mt-1">
                            {r.user_email || r.user_id || "anonymous"} · {fmtTime(r.ts)}
                            {r.photo_b64 && <span className="ml-2 text-[#6B46C1] font-bold">· photo</span>}
                          </p>
                        </div>
                        {(r.photo_b64 || text.length > 160) && (
                          <button
                            onClick={() => setExpanded(open ? null : id)}
                            data-testid={`help-feedback-expand-${idx}`}
                            className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553B96] flex-shrink-0"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="mt-3 pt-3 border-t border-[#E5DDC5]">
                          <p className="text-sm text-[#2C2C2C] whitespace-pre-wrap mb-3">{text}</p>
                          {r.photo_b64 && (
                            <a
                              href={`data:${r.photo_mime || "image/png"};base64,${r.photo_b64}`}
                              target="_blank"
                              rel="noreferrer"
                              data-testid={`help-feedback-photo-${idx}`}
                            >
                              <img
                                src={`data:${r.photo_mime || "image/png"};base64,${r.photo_b64}`}
                                alt="attachment"
                                className="max-w-full max-h-80 rounded-md border border-[#E5DDC5]"
                              />
                            </a>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// Tiny inline icon used in the aggregation row's "N with photo" badge.
// Defined locally so we don't have to re-import lucide's Image elsewhere
// (the file already imports MessageSquare etc., but not Image).
function ImageIconAlias() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}


// ---------------------------------------------------------------------------
// SignupRulesCard — admin controls for approval gate + onboarding + rules
// ---------------------------------------------------------------------------
// Three knobs live in the ``app_config`` doc with ``_id='signup'``:
//   - ``approval_gate_enabled``: when False, new accounts auto-approve
//   - ``questions_enabled``:    when True, register form gates on four
//                               onboarding questions + rules accept
//   - ``rules_md``:             markdown surfaced on /rules and linked
//                               from the register form's checkbox
// Aggregated answers live further down in onboarding-stats so admins
// can see referral mix + favorite-fandom tally at a glance.
function SignupRulesCard() {
  const [cfg, setCfg] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [draftRules, setDraftRules] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: c }, { data: s }] = await Promise.all([
        api.get("/admin/signup-config"),
        api.get("/admin/onboarding-stats"),
      ]);
      setCfg(c);
      setStats(s);
      setDraftRules(c?.rules_md || "");
    } catch { toast.error("Couldn't load sign-up config"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const patch = async (body) => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/signup-config", body);
      setCfg(data);
      if (body.rules_md !== undefined) setDraftRules(data.rules_md || "");
      toast.success("Saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSaving(false); }
  };

  return (
    <Card
      icon={ShieldCheck}
      title="Sign-up rules & questions"
      subtitle="Toggle the approval gate, onboarding questions, and edit the community rules."
      testid="admin-signup-rules-card"
    >
      {loading || !cfg ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Two toggles */}
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => patch({ approval_gate_enabled: !cfg.approval_gate_enabled })}
              disabled={saving}
              data-testid="signup-toggle-approval-gate"
              className={`text-left rounded-xl border p-3 transition-colors ${
                cfg.approval_gate_enabled
                  ? "bg-[#EDE6FA] border-[#6B46C1]"
                  : "bg-[#FBFAF6] border-[#E5DDC5] hover:border-[#6B46C1]"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
                Approval gate
              </p>
              <p className="font-medium text-[#2C2C2C] mt-1">
                {cfg.approval_gate_enabled ? "ON — admin reviews every sign-up" : "OFF — auto-approve everyone"}
              </p>
              <p className="text-xs text-[#6B705C] mt-1.5">
                {cfg.approval_gate_enabled
                  ? "Click to disable: new users land in the library immediately."
                  : "Click to re-enable: new users queue for admin review."}
              </p>
            </button>

            <button
              type="button"
              onClick={() => patch({ questions_enabled: !cfg.questions_enabled })}
              disabled={saving}
              data-testid="signup-toggle-questions"
              className={`text-left rounded-xl border p-3 transition-colors ${
                cfg.questions_enabled
                  ? "bg-[#EDE6FA] border-[#6B46C1]"
                  : "bg-[#FBFAF6] border-[#E5DDC5] hover:border-[#6B46C1]"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
                Onboarding questions
              </p>
              <p className="font-medium text-[#2C2C2C] mt-1">
                {cfg.questions_enabled ? "ON — questions shown at sign-up" : "OFF — skip onboarding"}
              </p>
              <p className="text-xs text-[#6B705C] mt-1.5">
                {cfg.questions_enabled
                  ? "Click to stop asking — keeps signed-up users' existing answers."
                  : "Click to start collecting referral, fandom, reader-type, age."}
              </p>
            </button>
          </div>

          {/* Onboarding-answer aggregation */}
          {cfg.questions_enabled && stats && (
            <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-4" data-testid="signup-onboarding-stats">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
                  Onboarding answers
                </p>
                <p className="text-xs text-[#6B705C]">
                  {stats.total_with_onboarding} user{stats.total_with_onboarding === 1 ? "" : "s"} answered
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatList title="How they found us" rows={stats.referral} testid="signup-stats-referral" />
                <StatList title="Reader type"        rows={stats.reader_type} testid="signup-stats-reader-type" />
                <StatList title="Top fandoms"        rows={stats.favorite_fandoms} testid="signup-stats-favorite-fandoms" />
                <div data-testid="signup-stats-age">
                  <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] font-bold mb-1.5">Age</p>
                  <p className="text-sm text-[#2C2C2C]">
                    13+: <strong>{stats.age_13_plus}</strong> · Under 13: <strong>{stats.age_under_13}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tracked invite links (2026-06-18) */}
          <InviteLinksWidget />

          {/* Rules editor */}
          <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
                Community rules (markdown)
              </p>
              <a
                href="/rules"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#6B46C1] hover:text-[#553397] font-semibold"
                data-testid="signup-rules-view-link"
              >
                View public page →
              </a>
            </div>
            {editingRules ? (
              <>
                <textarea
                  value={draftRules}
                  onChange={(e) => setDraftRules(e.target.value)}
                  rows={14}
                  data-testid="signup-rules-textarea"
                  className="w-full text-sm font-mono bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 focus:outline-none focus:border-[#6B46C1] focus:ring-1 focus:ring-[#6B46C1]/30 resize-y"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => { patch({ rules_md: draftRules }); setEditingRules(false); }}
                    disabled={saving || draftRules.trim().length < 20}
                    data-testid="signup-rules-save"
                    className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] disabled:opacity-60"
                  >
                    Save rules
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingRules(false); setDraftRules(cfg.rules_md || ""); }}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C] hover:text-[#2C2C2C]"
                  >
                    Cancel
                  </button>
                  <span className="text-[10px] text-[#6B705C] ml-auto">{draftRules.length}/50000</span>
                </div>
              </>
            ) : (
              <>
                <pre className="text-xs text-[#2C2C2C] whitespace-pre-wrap line-clamp-6 mb-2" data-testid="signup-rules-preview">
                  {cfg.rules_md}
                </pre>
                <button
                  type="button"
                  onClick={() => setEditingRules(true)}
                  data-testid="signup-rules-edit"
                  className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553397]"
                >
                  Edit rules →
                </button>
              </>
            )}
            {cfg.updated_at && (
              <p className="text-[10px] text-[#6B705C] mt-2">
                Last updated {fmtTime(cfg.updated_at)}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// InviteLinksWidget — tracked-URL builder + copy buttons
// ---------------------------------------------------------------------------
// Hands the admin a one-click copy for ``?ref=<channel>`` invite URLs
// that pre-tag the new signup's onboarding.referral field.  Works
// regardless of whether the onboarding-questions toggle is on — the
// register handler falls through to a referral-only ``onboarding``
// payload when questions are off, so attribution survives both modes.
function InviteLinksWidget() {
  // Bake the base URL from the page so this works on preview, prod,
  // and any custom domain attached via Entri.
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const links = [
    { tag: "facebook",     label: "Facebook" },
    { tag: "twitter",      label: "Twitter / X" },
    { tag: "reddit",       label: "Reddit (generic)" },
    { tag: "hpfanfic",     label: "Reddit · r/HPfanfiction" },
    { tag: "fanfiction",   label: "Reddit · r/FanFiction" },
    { tag: "tiktok",       label: "TikTok" },
    { tag: "bookstagram",  label: "Instagram · Bookstagram" },
    { tag: "discord",      label: "Discord server" },
    { tag: "newsletter",   label: "Newsletter" },
  ];
  const copy = async (url, tag) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Copied ${tag} invite link`);
    } catch {
      toast.error("Couldn't access clipboard — copy manually");
    }
  };
  return (
    <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-4" data-testid="signup-invite-links">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
          Tracked invite links
        </p>
        <span className="text-[10px] text-[#6B705C]">
          new sign-ups tagged in onboarding-stats
        </span>
      </div>
      <p className="text-xs text-[#6B705C] mb-3">
        Each link auto-pre-fills the &ldquo;How did you find Shelfsort?&rdquo; answer
        for the new user.  Anything after <code className="font-mono">?ref=</code>
        is captured verbatim, so add your own tags too.
      </p>
      <ul className="grid sm:grid-cols-2 gap-1.5">
        {links.map(({ tag, label }) => {
          const url = `${baseUrl}/?ref=${tag}`;
          return (
            <li key={tag} className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[#2C2C2C] w-32 flex-shrink-0">{label}</span>
              <code className="font-mono text-[10px] text-[#6B705C] truncate flex-1">{url}</code>
              <button
                type="button"
                onClick={() => copy(url, label)}
                data-testid={`signup-invite-copy-${tag}`}
                className="px-2 py-0.5 rounded bg-[#6B46C1] text-white text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-[#553397] flex-shrink-0"
              >
                Copy
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


// Small two-column count list reused inside SignupRulesCard.
function StatList({ title, rows, testid }) {  return (
    <div data-testid={testid}>
      <p className="text-xs uppercase tracking-[0.15em] text-[#6B705C] font-bold mb-1.5">{title}</p>
      {!rows || rows.length === 0 ? (
        <p className="text-xs text-[#6B705C] italic">No answers yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between text-sm">
              <span className="text-[#2C2C2C] capitalize">{r.label}</span>
              <span className="text-[#6B705C] font-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// AntivirusCard — ClamAV scanner status + recent quarantine entries
// ---------------------------------------------------------------------------
// Health probe uses an EICAR liveness scan (real test signature all AV
// vendors flag, no actual threat) so we know the daemon AND the
// signature DB are functioning, not just installed.  Quarantine
// list shows every flagged file with the source endpoint, signature,
// user, and timestamp so admins can audit what got through (or didn't).
function AntivirusCard() {
  const [status, setStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: s }, { data: q }] = await Promise.all([
        api.get("/admin/antivirus/status"),
        api.get("/admin/antivirus/quarantine", {
          params: { limit: 100, source: sourceFilter || undefined },
        }),
      ]);
      setStatus(s);
      setRows(q?.rows || []);
    } catch { toast.error("Couldn't load antivirus status"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [sourceFilter]);

  return (
    <Card
      icon={ShieldAlert}
      title="Antivirus"
      subtitle="ClamAV scans every upload, restore, and cached download."
      testid="admin-antivirus-card"
    >
      {loading || !status ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Scanner status banner */}
          <div
            className={`rounded-xl border p-4 ${
              status.available && status.eicar_test_ok
                ? "bg-[#E8F3EC] border-[#2C7A3E]"
                : "bg-[#FDECE6] border-[#B43F26]"
            }`}
            data-testid="av-status-banner"
          >
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C] mb-1">
              Scanner status
            </p>
            <p className="font-medium text-[#2C2C2C]">
              {!status.available
                ? "DOWN — clamd unreachable; uploads currently UNSCANNED"
                : !status.eicar_test_ok
                ? "DEGRADED — daemon up but EICAR test failed"
                : `HEALTHY — EICAR test passed in ${status.scan_ms} ms`}
            </p>
            {status.available && status.signature && (
              <p className="text-xs text-[#6B705C] mt-1">
                Liveness signature: <code className="font-mono">{status.signature}</code>
              </p>
            )}
            <div className="flex gap-4 mt-2 text-xs text-[#6B705C]">
              <span>
                Total quarantined: <strong className="text-[#2C2C2C]">{status.quarantine_total}</strong>
              </span>
              <span>
                Last 24 h: <strong className="text-[#2C2C2C]">{status.quarantine_last_24h}</strong>
              </span>
            </div>
          </div>

          {/* Source filter */}
          <div className="flex flex-wrap items-center gap-2" data-testid="av-source-filter">
            {[
              ["", "All"],
              ["upload", "Uploads"],
              ["restore", "Restores"],
              ["share", "Shares"],
              ["backfill", "Backfill"],
            ].map(([val, lbl]) => (
              <button
                key={val || "all"}
                onClick={() => setSourceFilter(val)}
                data-testid={`av-source-${val || "all"}`}
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
                  sourceFilter === val
                    ? "bg-[#B43F26] text-white"
                    : "bg-[#F5F3EC] text-[#6B705C] hover:bg-[#E8E2D4]"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* Quarantine list */}
          {rows.length === 0 ? (
            <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5" data-testid="av-quarantine-empty">
              <Check className="w-3.5 h-3.5" />
              No flagged files{sourceFilter ? ` in ${sourceFilter}` : ""} yet.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="av-quarantine-list">
              {rows.map((r, idx) => (
                <li
                  key={`${r.ts}-${idx}`}
                  className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3"
                  data-testid={`av-quarantine-row-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#2C2C2C] truncate">
                        {r.filename || "(unnamed)"}
                      </p>
                      <p className="text-xs text-[#B43F26] font-mono mt-0.5">
                        {r.signature || "(no signature)"}
                      </p>
                      <p className="text-xs text-[#6B705C] mt-1">
                        {r.user_id} · {r.source} · {fmtTime(r.ts)}
                        {r.elapsed_ms > 0 && <> · {r.elapsed_ms} ms</>}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-[#FDECE6] text-[#B43F26] text-xs font-bold uppercase tracking-[0.1em] flex-shrink-0">
                      {r.infected ? "infected" : "error"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// StorageByUserCard — top 20 by uploaded bytes
// ---------------------------------------------------------------------------
function StorageByUserCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [drilldown, setDrilldown] = useState({});
  const [drillLoading, setDrillLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/storage-by-user", { params: { limit: 20 } });
      setData(data);
    } catch { toast.error("Couldn't load storage-by-user"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const expand = async (uid) => {
    if (expanded === uid) { setExpanded(null); return; }
    setExpanded(uid);
    if (drilldown[uid]) return;
    setDrillLoading(true);
    try {
      const { data } = await api.get(`/admin/users/${uid}/books`, { params: { limit: 50 } });
      setDrilldown((d) => ({ ...d, [uid]: data }));
    } catch { toast.error("Couldn't load this user's books"); }
    finally { setDrillLoading(false); }
  };

  return (
    <Card
      icon={HardDrive}
      title="Top storage users"
      subtitle="Top 20 accounts by total uploaded bytes. Storage triage only — no contents shown."
      testid="admin-storage-by-user-card"
    >
      {loading || !data ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : data.users.length === 0 ? (
        <p className="text-sm text-[#6B705C] italic">No uploads with size_bytes yet.</p>
      ) : (
        <>
          <p className="text-xs text-[#6B705C] mb-3">
            Grand total: <strong className="font-bold text-[#2C2C2C]">{fmtBytes(data.grand_total_bytes)}</strong> across{" "}
            <strong className="font-bold text-[#2C2C2C]">{data.grand_total_books_with_size.toLocaleString()}</strong> books.
            <span className="block text-[#6B705C] italic mt-0.5">
              (Books without ``size_bytes`` recorded contribute 0; about 58% of historical rows are missing this — they were uploaded before the field existed.)
            </span>
          </p>
          <ul className="space-y-1.5" data-testid="storage-by-user-list">
            {data.users.map((u, i) => {
              const pct = data.grand_total_bytes > 0
                ? (u.total_bytes / data.grand_total_bytes) * 100
                : 0;
              const open = expanded === u.user_id;
              return (
                <li
                  key={u.user_id}
                  className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] hover:bg-[#F5F3EC] transition-colors"
                  data-testid={`storage-row-${u.user_id}`}
                >
                  <button
                    type="button"
                    onClick={() => expand(u.user_id)}
                    className="w-full text-left p-3 flex items-center gap-3"
                  >
                    <span className="text-sm font-bold text-[#6B705C] tabular-nums w-7 text-right">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-[#2C2C2C] truncate">{u.name}</span>
                        {u.username && <span className="text-xs text-[#6B46C1]">@{u.username}</span>}
                      </div>
                      <p className="text-xs text-[#6B705C] truncate">{u.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono text-sm text-[#2C2C2C]">{fmtBytes(u.total_bytes)}</p>
                      <p className="text-xs text-[#6B705C]">
                        {u.book_count.toLocaleString()} books · {pct.toFixed(1)}%
                      </p>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-[#6B705C] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                    />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 border-t border-[#E5DDC5]" data-testid={`storage-drill-${u.user_id}`}>
                      {drillLoading && !drilldown[u.user_id] ? (
                        <p className="text-xs text-[#6B705C] italic py-2">Loading books…</p>
                      ) : drilldown[u.user_id] ? (
                        <>
                          <p className="text-xs text-[#6B705C] py-2">
                            Showing {drilldown[u.user_id].showing} of {drilldown[u.user_id].total_books.toLocaleString()} books, biggest first.
                          </p>
                          <ul className="space-y-1 max-h-72 overflow-y-auto">
                            {drilldown[u.user_id].books.slice(0, 50).map((b) => (
                              <li
                                key={b.book_id}
                                className="text-xs flex items-baseline justify-between gap-2 py-1 border-b border-[#F5F3EC] last:border-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="text-[#2C2C2C] truncate inline-block max-w-full">{b.title}</span>
                                  {b.fandom && <span className="text-[#6B46C1] ml-2">· {b.fandom}</span>}
                                </div>
                                <span className="font-mono text-[#6B705C] flex-shrink-0">
                                  {b.size_bytes ? fmtBytes(b.size_bytes) : "—"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// StorageTrendCard — 30-day cumulative chart
// ---------------------------------------------------------------------------
// The backend computes the curve retroactively from books.created_at +
// size_bytes (no need to wait 30 days for a snapshot cron to bootstrap).
// Each call also writes a row to ``storage_snapshots`` so a future cron
// can pick up cheaply.
function StorageTrendCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = async (d) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/storage-trend", { params: { days: d } });
      setData(data);
    } catch { toast.error("Couldn't load storage trend"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  const max = data?.points?.reduce((m, p) => Math.max(m, p.total_bytes), 0) || 1;
  const min = data?.points?.[0]?.total_bytes || 0;
  const range = Math.max(1, max - min);

  // Build SVG path for the line.
  const W = 600, H = 140, PAD = 8;
  const pts = data?.points || [];
  const xStep = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
  const yFor = (v) => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${PAD + i * xStep} ${yFor(p.total_bytes)}`)
    .join(" ");
  const areaPath = pts.length > 0
    ? `${linePath} L ${PAD + (pts.length - 1) * xStep} ${H - PAD} L ${PAD} ${H - PAD} Z`
    : "";

  return (
    <Card
      icon={TrendingUp}
      title="Storage trend"
      subtitle="Cumulative bytes over time, computed from existing data."
      testid="admin-storage-trend-card"
    >
      <div className="flex items-center gap-2 mb-3">
        {[7, 14, 30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            data-testid={`storage-trend-days-${d}`}
            className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
              days === d ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#6B705C] hover:bg-[#E8E2D4]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
      {loading || !data ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          <div className="flex items-baseline gap-4 mb-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-[#6B705C]">Now</p>
              <p className="font-mono text-lg text-[#2C2C2C]">{fmtBytes(data.latest?.total_bytes || 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#6B705C]">Growth · {days}d</p>
              <p className="font-mono text-lg text-[#1F8F4E]">+{fmtBytes(data.growth_bytes || 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#6B705C]">Books</p>
              <p className="font-mono text-lg text-[#2C2C2C]">{(data.latest?.book_count || 0).toLocaleString()}</p>
            </div>
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-32"
            data-testid="storage-trend-chart"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="storage-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6B46C1" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#6B46C1" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            {areaPath && <path d={areaPath} fill="url(#storage-trend-fill)" />}
            {linePath && (
              <path d={linePath} fill="none" stroke="#6B46C1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            )}
          </svg>
          <div className="flex items-center justify-between text-xs text-[#6B705C] mt-1">
            <span>{pts[0]?.date}</span>
            <span>{pts[pts.length - 1]?.date}</span>
          </div>
          <p className="text-xs text-[#6B705C] italic mt-2">
            Computed from books.created_at + size_bytes — no snapshot cron required.
            Each call writes a snapshot row so a future daily cron can pick up cheaply.
          </p>
        </>
      )}
    </Card>
  );
}



// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ViewConsentsCard — admin-side surface for per-admin user-consented view-as
// ---------------------------------------------------------------------------
// Surfaces outgoing requests for THIS admin. Active grants show a
// "View now" link to /admin/view/<uid>. Pending requests show "Waiting
// on user". Expired/revoked/denied are listed for the last 30d so the
// admin knows why a previously-working link stopped working.
// New requests go through the storage-by-user / users-list cards (which
// know the target user_id); this card just shows the resulting state.
function ViewConsentsCard() {
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
    expired: { bg: "bg-[#F5F3EC]", fg: "text-[#6B705C]", label: "Expired" },
  }[status] || { bg: "bg-[#F5F3EC]", fg: "text-[#6B705C]", label: status });

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
      <form onSubmit={submitRequest} className="mb-4 rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-3" data-testid="view-consent-request-form">
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
          <span className="text-xs text-[#6B705C] ml-auto">{reason.length}/500</span>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : consents.length === 0 ? (
        <p className="text-sm text-[#6B705C] italic">No view requests yet.</p>
      ) : (
        <div className="space-y-3">
          {[
            { label: "Active grants", rows: active },
            { label: "Pending", rows: pending },
            { label: "Past 30 days", rows: past },
          ].filter((g) => g.rows.length > 0).map((g) => (
            <div key={g.label}>
              <p className="text-xs uppercase tracking-wider text-[#6B705C] mb-1.5">{g.label}</p>
              <ul className="space-y-1.5" data-testid={`view-consent-group-${g.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {g.rows.map((c) => {
                  const t = tone(c.status);
                  return (
                    <li
                      key={c.consent_id}
                      className="rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] px-3 py-2 flex flex-wrap items-center gap-3"
                      data-testid={`view-consent-row-${c.consent_id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#2C2C2C] truncate">{c.user_name || c.user_email}</p>
                        <p className="text-xs text-[#6B705C] truncate">{c.user_email}</p>
                        {c.reason && <p className="text-xs text-[#6B705C] italic mt-0.5">"{c.reason}"</p>}
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
                            <span className="text-xs text-[#6B705C] flex-shrink-0">
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
function UsersCard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data?.users || []);
    } catch { toast.error("Couldn't load users"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleAdmin = async (u) => {
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
  const toggleMod = async (u) => {
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

  const realUsers = users.filter((u) => !isTestUser(u));
  const testUsers = users.filter(isTestUser);

  const renderRow = (u) => (
    <li key={u.user_id} className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-user-row-${u.user_id}`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#2C2C2C] truncate">
          {u.name || u.email}
          {u.is_admin && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#6B46C1] font-bold">
              <ShieldCheck className="w-3 h-3" /> Admin
            </span>
          )}
          {u.is_moderator && (
            <span
              data-testid={`admin-user-mod-badge-${u.user_id}`}
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#3D8B79] font-bold bg-[#E0F0EA] px-1.5 py-0.5 rounded"
              title="Moderator — can approve sign-ups and lock bookclub rooms"
            >
              <ShieldCheck className="w-3 h-3" /> Mod
            </span>
          )}
          {isTestUser(u) && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#6B705C] font-bold bg-[#F2EDDF] px-1.5 py-0.5 rounded"
              title="Heuristic match — looks like a test/QA account (example.com domain, test+ alias, etc.)"
              data-testid={`admin-user-testbadge-${u.user_id}`}
            >
              Test
            </span>
          )}
        </p>
        <p className="text-xs text-[#6B705C] truncate">{u.email} · {u.book_count} book{u.book_count === 1 ? "" : "s"} · joined {fmtTime(u.created_at)}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Mod toggle — distinct from the admin toggle on its right. */}
        <button
          type="button"
          onClick={() => toggleMod(u)}
          disabled={busyId === u.user_id}
          data-testid={`admin-user-mod-toggle-${u.user_id}`}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
            u.is_moderator
              ? "text-[#9B3531] hover:bg-[#FBE9E7]"
              : "text-[#3D8B79] hover:bg-[#E0F0EA]"
          }`}
          title={u.is_moderator ? "Remove the moderator flag" : "Make this user a moderator"}
        >
          {u.is_moderator ? "Unmod" : "Mod"}
        </button>
        <button
          type="button"
          onClick={() => toggleAdmin(u)}
          disabled={busyId === u.user_id}
          data-testid={`admin-user-toggle-${u.user_id}`}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
            u.is_admin
              ? "text-[#9B3531] hover:bg-[#FBE9E7]"
              : "text-[#6B46C1] hover:bg-[#EEE9FB]"
          }`}
        >
          {busyId === u.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {u.is_admin ? "Demote" : "Promote"}
        </button>
      </div>
    </li>
  );

  return (
    <Card icon={Users} title="Users & admins" subtitle="Promote or demote any account. The last admin cannot be demoted." testid="admin-users-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {/* Real users — always visible.  This is the list admins
              actually care about day-to-day. */}
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C]">
              Real users
              <span className="ml-2 font-normal normal-case text-[#9B9B8C]">({realUsers.length})</span>
            </p>
          </div>
          <ul className="space-y-1.5" data-testid="admin-users-list">
            {realUsers.map(renderRow)}
            {realUsers.length === 0 && (
              <li className="text-sm text-[#6B705C] italic px-3 py-2">No real users yet.</li>
            )}
          </ul>

          {/* Test / QA accounts — folded into a <details> so they don't
              clutter the main list.  Click to expand when you actually
              need to demote or audit them. */}
          {testUsers.length > 0 && (
            <details className="mt-4 group" data-testid="admin-users-test-collapse">
              <summary className="cursor-pointer select-none flex items-baseline justify-between px-1 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-[#6B705C] hover:text-[#2C2C2C]">
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

function AlertHealthBanner() {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/alert-health");
        setData(data);
      } catch { /* network/permissions — non-critical, just hide */ }
    })();
    // Restore in-session dismissal so re-renders don't flash it back.
    const ts = sessionStorage.getItem(ALERT_HEALTH_DISMISS_KEY);
    if (ts) setDismissed(true);
  }, []);

  const totalIssues = (data?.alert_send_failures_24h || 0)
    + (data?.cron_failures_uncovered_24h || 0)
    + ((data?.suppressed_reasons || []).reduce((s, r) => s + r.count, 0));
  if (!data || totalIssues === 0 || dismissed) return null;

  const isSendFailure = (data.alert_send_failures_24h || 0) > 0;
  const isOnlySuppressed =
    (data.alert_send_failures_24h || 0) === 0 &&
    (data.cron_failures_uncovered_24h || 0) === 0 &&
    (data.suppressed_reasons || []).length > 0;
  const tone = isSendFailure
    ? { bg: "bg-[#FBE9E5]", border: "border-[#D9534F]", icon: "text-[#B43F26]", title: "text-[#7A2417]", body: "text-[#7A2417]" }
    : { bg: "bg-[#FDF3E1]", border: "border-[#D49A1E]", icon: "text-[#8B4F00]", title: "text-[#5C3300]", body: "text-[#5C3300]" };

  const dismiss = () => {
    sessionStorage.setItem(ALERT_HEALTH_DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  };

  const latest = data.latest_failure;
  const latestWhen = latest?.at
    ? new Date(latest.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div
      className={`mb-6 rounded-2xl border-2 ${tone.border} ${tone.bg} p-4 md:p-5`}
      data-testid="alert-health-banner"
      role="status"
    >
      <div className="flex items-start gap-3">
        <Siren className={`w-6 h-6 ${tone.icon} flex-shrink-0 mt-0.5`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs font-bold uppercase tracking-[0.2em] ${tone.icon} mb-1`}
            data-testid="alert-health-banner-tag"
          >
            {isSendFailure
              ? "Cron alerts are misfiring"
              : isOnlySuppressed
              ? "Cron alert pipeline suppressed"
              : "Cron failures going un-alerted"}
          </p>
          <h2 className={`font-serif text-lg md:text-xl ${tone.title} leading-tight mb-2`}>
            {isSendFailure
              ? `${data.alert_send_failures_24h} alert send${data.alert_send_failures_24h === 1 ? "" : "s"} failed in the last 24h`
              : isOnlySuppressed
              ? `Cron-failure emails are being suppressed`
              : `${data.cron_failures_uncovered_24h} cron failure${data.cron_failures_uncovered_24h === 1 ? "" : "s"} in the last 24h with no alert email sent`}
            {!isSendFailure && (data.alert_send_failures_24h || 0) > 0 && (
              <> · plus {data.alert_send_failures_24h} Resend error{data.alert_send_failures_24h === 1 ? "" : "s"}</>
            )}
          </h2>
          {latest && (
            <p className={`text-sm ${tone.body} mb-2`} data-testid="alert-health-banner-latest">
              Latest: <code className="px-1.5 py-0.5 rounded bg-white/60 font-mono text-xs">{latest.job_id}</code>
              {latestWhen ? ` at ${latestWhen}` : ""}
              {latest.error && <span className="opacity-80"> — {latest.error}</span>}
            </p>
          )}
          {data.uncovered_job_ids && data.uncovered_job_ids.length > 0 && (
            <p className={`text-xs ${tone.body} opacity-80 mb-2`} data-testid="alert-health-banner-jobs">
              Uncovered jobs: {data.uncovered_job_ids.join(", ")}
            </p>
          )}
          {data.suppressed_reasons && data.suppressed_reasons.length > 0 && (
            <p
              className={`text-xs ${tone.body} opacity-90 mb-2`}
              data-testid="alert-health-banner-suppressions"
            >
              Alerts suppressed:{" "}
              {data.suppressed_reasons.map((r, i) => (
                <span key={r.reason} data-testid={`alert-health-suppression-${r.reason}`}>
                  {i > 0 && " · "}
                  <code className="px-1.5 py-0.5 rounded bg-white/60 font-mono text-[10px]">
                    {SUPPRESSION_REASON_LABEL[r.reason] || r.reason}
                  </code>
                  <span className="ml-1">({r.count})</span>
                </span>
              ))}
              {data.suppressed_reasons.some((r) => SUPPRESSION_FIX_HINT[r.reason]) && (
                <span className="block mt-1 italic opacity-90">
                  {data.suppressed_reasons
                    .map((r) => SUPPRESSION_FIX_HINT[r.reason])
                    .filter(Boolean)[0]}
                </span>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <a
              href="#cron-health-card"
              data-testid="alert-health-banner-open-cron"
              className={`text-xs font-bold uppercase tracking-[0.15em] ${tone.title} underline-offset-2 hover:underline`}
            >
              Open scheduled jobs →
            </a>
            <a
              href="#email-stats-card"
              data-testid="alert-health-banner-open-email"
              className={`text-xs font-bold uppercase tracking-[0.15em] ${tone.title} underline-offset-2 hover:underline`}
            >
              Open email stats →
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide for this session"
          data-testid="alert-health-banner-dismiss"
          className={`flex-shrink-0 w-8 h-8 rounded-full ${tone.icon} hover:bg-white/60 inline-flex items-center justify-center transition-colors`}
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
function MaintenanceBannerCard() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("info");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/maintenance-banner");
        setEnabled(!!data?.enabled);
        setMessage(data?.message || "");
        setSeverity(data?.severity || "info");
      } catch { /* ignore */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/maintenance-banner", { enabled, message, severity });
      toast.success(enabled ? "Banner published site-wide." : "Banner turned off.");
    } catch { toast.error("Couldn't save banner"); }
    finally { setSaving(false); }
  };

  return (
    <Card icon={AlertTriangle} title="Maintenance banner" subtitle="Site-wide non-dismissible banner. Use for outages, planned maintenance, or urgent heads-ups." testid="admin-banner-card">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-[#2C2C2C]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="admin-banner-enabled"
          />
          Show banner now
        </label>
        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1">Message</label>
          <input
            type="text"
            value={message}
            maxLength={240}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Calibre is unavailable — conversions paused until 5pm UTC."
            data-testid="admin-banner-message"
            className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
          />
          <p className="text-xs text-[#6B705C] mt-1">{message.length}/240</p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1">Severity</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            data-testid="admin-banner-severity"
            className="w-full md:w-48 px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C]"
          >
            <option value="info">Info (calm green)</option>
            <option value="warn">Warning (amber)</option>
            <option value="error">Error (red)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="admin-banner-save"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B46C1] text-white hover:bg-[#2c4530] disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? "Saving…" : "Save banner"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// System health card (c)
// ---------------------------------------------------------------------------
function HealthPill({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold ${
        ok ? "bg-[#EEE9FB] text-[#6B46C1]" : "bg-[#FBE9E7] text-[#9B3531]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#6B46C1]" : "bg-[#9B3531]"}`} />
      {label}: {ok ? "OK" : "Down"}
    </span>
  );
}

function HealthCard() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/system-health");
      setHealth(data);
    } catch { toast.error("Couldn't load health"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading || !health) {
    return (
      <Card icon={Activity} title="System health" testid="admin-health-card">
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      </Card>
    );
  }

  return (
    <Card icon={Activity} title="System health" subtitle="One-shot snapshot of external dependencies and storage." testid="admin-health-card">
      <div className="flex flex-wrap gap-2 mb-4" data-testid="admin-health-pills">
        <HealthPill ok={health.calibre?.ok} label="Calibre" />
        <HealthPill ok={health.resend?.configured} label="Resend (email)" />
        <HealthPill ok={health.llm?.configured} label="LLM key" />
        <HealthPill ok={health.digest_scheduler?.running} label="Digest scheduler" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4" data-testid="admin-health-collections">
        {Object.entries(health.collections || {}).map(([name, n]) => (
          <div key={name} className="text-xs bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
            <p className="text-[#6B705C] truncate">{name}</p>
            <p className="font-semibold text-[#2C2C2C]">{n.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="text-xs text-[#6B705C]" data-testid="admin-health-storage">
        Storage: <strong className="text-[#2C2C2C]">{fmtBytes(health.storage?.used_bytes)}</strong> used / {fmtBytes(health.storage?.total_bytes)} total
        ({fmtBytes(health.storage?.free_bytes)} free) on <code>{health.storage?.path}</code>
      </div>
      <button
        type="button"
        onClick={load}
        data-testid="admin-health-refresh"
        className="mt-3 text-xs font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1"
      >
        <ChevronRight className="w-3 h-3" /> Refresh
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Global fandom aliases card (d)
// ---------------------------------------------------------------------------
function GlobalAliasesCard() {
  const [aliases, setAliases] = useState({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/global-fandom-aliases");
        setAliases(data?.aliases || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const save = async (next) => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/global-fandom-aliases", { aliases: next });
      setAliases(data?.aliases || {});
    } catch { toast.error("Couldn't save"); }
    finally { setSaving(false); }
  };

  const add = async () => {
    const f = from.trim();
    const t = to.trim();
    if (!f || !t || f.toLowerCase() === t.toLowerCase()) { toast.error('Need "from" and "to" — and they must differ.'); return; }
    await save({ ...aliases, [f]: t });
    setFrom(""); setTo("");
  };

  const remove = async (key) => {
    const next = { ...aliases };
    delete next[key];
    await save(next);
  };

  const entries = Object.entries(aliases);
  return (
    <Card icon={Heart} title="Global fandom aliases" subtitle="Applied to every user's library at upload + reclassify time. Per-user aliases (Account page) override these on conflict." testid="admin-aliases-card">
      <div className="flex flex-col md:flex-row gap-2 mb-3">
        <input
          type="text"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="From (e.g. HP)"
          data-testid="admin-aliases-from"
          className="flex-1 px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:outline-none focus:border-[#E07A5F]"
        />
        <span className="self-center text-[#6B705C] hidden md:inline">→</span>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To (e.g. Harry Potter)"
          data-testid="admin-aliases-to"
          className="flex-1 px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:outline-none focus:border-[#E07A5F]"
        />
        <button
          type="button"
          onClick={add}
          disabled={saving}
          data-testid="admin-aliases-add"
          className="px-4 py-2 rounded-lg bg-[#E07A5F] text-white hover:bg-[#d06a4f] text-sm font-medium inline-flex items-center gap-1 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-[#6B705C] italic" data-testid="admin-aliases-empty">No global aliases yet.</p>
      ) : (
        <ul className="space-y-1" data-testid="admin-aliases-list">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-[#FBFAF6] border border-[#E5DDC5]">
              <span><strong>{k}</strong> → {v}</span>
              <button
                type="button"
                onClick={() => remove(k)}
                data-testid={`admin-aliases-remove-${k}`}
                className="text-[#D9534F] hover:text-[#B53C39]"
                aria-label={`Remove alias ${k}`}
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Global stats card (h)
// ---------------------------------------------------------------------------
function StatTile({ label, value }) {
  return (
    <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg p-3">
      <p className="text-xs text-[#6B705C] uppercase tracking-[0.15em]">{label}</p>
      <p className="text-2xl font-serif text-[#2C2C2C]">{value}</p>
    </div>
  );
}

function GlobalStatsCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // Per-section "show all" toggles so the card stays scannable on big
  // tenants. Each long list is collapsed to the top 8 by default with a
  // "Show all N · Hide" affordance that toggles into a scrollable view.
  const [showAllFandoms, setShowAllFandoms] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/global-stats");
        setStats(data);
      } catch { toast.error("Couldn't load stats"); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading || !stats) {
    return (
      <Card icon={BarChart3} title="Global stats" testid="admin-stats-card">
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      </Card>
    );
  }

  return (
    <Card icon={BarChart3} title="Global stats" subtitle="Tenant-wide rollup across every user's library." testid="admin-stats-card">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <StatTile label="Users" value={stats.users.toLocaleString()} />
        <StatTile label="Admins" value={stats.admins.toLocaleString()} />
        <StatTile label="Books" value={stats.books.toLocaleString()} />
        <StatTile label="Storage" value={fmtBytes(stats.total_storage_bytes)} />
        <StatTile label="Signups 7d" value={stats.signups_7d.toLocaleString()} />
        <StatTile label="Signups 30d" value={stats.signups_30d.toLocaleString()} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CondensedRankList
          title="Top fandoms"
          items={(stats.top_fandoms || []).map((f) => ({ key: f.fandom, label: f.fandom, value: f.count }))}
          showAll={showAllFandoms}
          onToggle={() => setShowAllFandoms((v) => !v)}
          testid="admin-stats-top-fandoms"
        />
        <CondensedRankList
          title="Categories"
          items={Object.entries(stats.categories || {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => ({ key: k, label: k, value: v }))}
          showAll={showAllCategories}
          onToggle={() => setShowAllCategories((v) => !v)}
          testid="admin-stats-categories"
        />
      </div>
    </Card>
  );
}

// Reusable: a ranked list with an inline "Show all N · Hide" toggle.
// Collapsed view shows the top 8; expanded view scrolls past 12 so the
// page doesn't stretch indefinitely on libraries with hundreds of
// fandoms / categories.
function CondensedRankList({ title, items, showAll, onToggle, testid }) {
  const COLLAPSED_LIMIT = 8;
  const visible = showAll ? items : items.slice(0, COLLAPSED_LIMIT);
  const overflow = items.length - COLLAPSED_LIMIT;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#6B46C1] mb-1.5 flex items-center justify-between">
        <span>{title} <span className="text-[#6B705C] font-normal lowercase tracking-normal">({items.length})</span></span>
        {overflow > 0 && (
          <button
            type="button"
            onClick={onToggle}
            data-testid={`${testid}-toggle`}
            className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B46C1] hover:text-[#553397] inline-flex items-center gap-1"
          >
            {showAll ? `Hide ${overflow}` : `Show all ${items.length}`}
            <ChevronRight className={`w-3 h-3 transition-transform ${showAll ? "rotate-90" : ""}`} />
          </button>
        )}
      </p>
      <ul
        className={`space-y-1 text-xs ${showAll && items.length > 12 ? "max-h-72 overflow-y-auto pr-1" : ""}`}
        data-testid={testid}
      >
        {visible.map((it) => (
          <li key={it.key} className="flex justify-between bg-[#FBFAF6] border border-[#E5DDC5] rounded px-2 py-1">
            <span className="truncate">{it.label}</span>
            <strong className="ml-2">{it.value.toLocaleString()}</strong>
          </li>
        ))}
        {!showAll && overflow > 0 && (
          <li
            className="text-[11px] italic text-[#6B705C] text-center pt-1"
            data-testid={`${testid}-overflow-hint`}
          >
            + {overflow} more
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature flags card (j)
// ---------------------------------------------------------------------------
function FeatureFlagsCard() {
  const [flags, setFlags] = useState({});
  const [known, setKnown] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/feature-flags");
      setFlags(data?.flags || {});
      setKnown(data?.known || {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (flag, enabled) => {
    setBusy(flag);
    try {
      const { data } = await api.put("/admin/feature-flags", { flag, enabled });
      setFlags(data?.flags || {});
      toast.success(`${flag} ${enabled ? "enabled" : "disabled"}`);
    } catch { toast.error("Couldn't toggle"); }
    finally { setBusy(null); }
  };

  return (
    <Card icon={ToggleLeft} title="Feature flags" subtitle="Runtime kill switches for heavy / external dependencies. Defaults: all on." testid="admin-flags-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <ul className="space-y-1.5" data-testid="admin-flags-list">
          {Object.keys(known).map((key) => {
            const on = !!flags[key];
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-flag-row-${key}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C]"><code>{key}</code></p>
                  <p className="text-xs text-[#6B705C]">{known[key]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(key, !on)}
                  disabled={busy === key}
                  data-testid={`admin-flag-toggle-${key}`}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold flex items-center gap-1 transition-colors ${
                    on ? "bg-[#EEE9FB] text-[#6B46C1] hover:bg-[#6B46C1] hover:text-white"
                       : "bg-[#FBE9E7] text-[#9B3531] hover:bg-[#D9534F] hover:text-white"
                  }`}
                >
                  {busy === key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  {on ? "Enabled" : "Disabled"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit log card (k)
// ---------------------------------------------------------------------------
function AuditLogCard() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/audit-log", { params: { limit: 50 } });
      setEntries(data?.entries || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Fetch up to 500 (server cap) and dump to CSV. Quotes any field that
  // contains comma/quote/newline; doubles inner quotes per RFC 4180.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data } = await api.get("/admin/audit-log", { params: { limit: 500 } });
      const rows = data?.entries || [];
      const escape = (v) => {
        const s = v == null ? "" : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["ts", "action", "actor_email", "actor_id", "target", "metadata"];
      const lines = [header.join(",")];
      for (const e of rows) {
        lines.push([
          escape(e.ts),
          escape(e.action),
          escape(e.actor_email),
          escape(e.actor_id),
          escape(e.target),
          escape(e.metadata ? JSON.stringify(e.metadata) : ""),
        ].join(","));
      }
      const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url; a.download = `shelfsort-audit-${today}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} entries.`);
    } catch { toast.error("Couldn't export"); }
    finally { setExporting(false); }
  };

  return (
    <Card icon={ClipboardList} title="Audit log" subtitle="Every admin write action across the app. Newest first, capped at the most recent 50 in this view; export pulls up to 500." testid="admin-audit-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#6B705C] italic" data-testid="admin-audit-empty">No audit entries yet.</p>
      ) : (
        <ul className="space-y-1" data-testid="admin-audit-list">
          {entries.map((e, i) => (
            <li key={i} className="text-xs px-2.5 py-1.5 rounded bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-audit-row-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span><strong>{e.action}</strong> by <span className="text-[#6B705C]">{e.actor_email}</span></span>
                <span className="text-[#6B705C] flex-shrink-0">{fmtTime(e.ts)}</span>
              </div>
              {(e.target || (e.metadata && Object.keys(e.metadata).length > 0)) && (
                <p className="text-[#6B705C] mt-0.5 truncate">
                  {e.target && <code className="mr-2">{e.target}</code>}
                  {e.metadata && Object.keys(e.metadata).length > 0 && JSON.stringify(e.metadata)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={load}
          data-testid="admin-audit-refresh"
          className="text-xs font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" /> Refresh
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          data-testid="admin-audit-export-csv"
          className="text-xs font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Unknown fandoms card — surfaces fandoms in books that aren't yet in the
// keyword classifier. Dismiss to hide forever (use for "Other", originals).
// ---------------------------------------------------------------------------
// Single row in the Unknown Fandoms card. Kept at module scope so React
// doesn't re-create the component type on every parent render.
function UnknownFandomRow({ r, isDismissed, busy, onRescan, onDismiss, onUndismiss }) {
  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]"
      data-testid={`admin-unknown-fandom-row-${r.fandom}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#2C2C2C] truncate">
          {r.fandom}
          <span className="ml-2 text-xs text-[#6B705C] font-normal">{r.count} book{r.count === 1 ? "" : "s"}</span>
          {isDismissed && <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-[#6B705C] font-bold">DISMISSED</span>}
        </p>
        {r.sample_book_ids?.length > 0 && (
          <p className="text-xs text-[#6B705C] truncate">
            Sample IDs: <code>{r.sample_book_ids.slice(0, 3).join(", ")}</code>
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => onRescan(r.fandom, r.count)}
          disabled={busy === `rescan:${r.fandom}`}
          data-testid={`admin-unknown-fandom-rescan-${r.fandom}`}
          className="text-xs px-3 py-1.5 rounded-lg text-[#6B46C1] hover:bg-[#EEE9FB] inline-flex items-center gap-1 font-semibold"
          title="Re-run keyword classifier on these books"
        >
          {busy === `rescan:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Rescan
        </button>
        {isDismissed ? (
          <button
            type="button"
            onClick={() => onUndismiss(r.fandom)}
            disabled={busy === `undismiss:${r.fandom}`}
            data-testid={`admin-unknown-fandom-undismiss-${r.fandom}`}
            className="text-xs px-3 py-1.5 rounded-lg text-[#6B705C] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
          >
            {busy === `undismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onDismiss(r.fandom)}
            disabled={busy === `dismiss:${r.fandom}`}
            data-testid={`admin-unknown-fandom-dismiss-${r.fandom}`}
            className="text-xs px-3 py-1.5 rounded-lg text-[#6B705C] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
          >
            {busy === `dismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}

function UnknownFandomsCard() {
  const [rows, setRows] = useState([]);
  const [dismissedRows, setDismissedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/unknown-fandoms");
      setRows(data?.unknown || []);
      setDismissedRows(data?.dismissed || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dismiss = async (fandom) => {
    setBusy(`dismiss:${fandom}`);
    try {
      await api.post(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Dismissed "${fandom}"`);
      await load();
    } catch { toast.error("Couldn't dismiss"); }
    finally { setBusy(null); }
  };

  const undismiss = async (fandom) => {
    setBusy(`undismiss:${fandom}`);
    try {
      await api.delete(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Restored "${fandom}"`);
      await load();
    } catch { toast.error("Couldn't restore"); }
    finally { setBusy(null); }
  };

  const rescan = async (fandom, count) => {
    if (!window.confirm(
      `Re-scan ${count} book${count === 1 ? "" : "s"} tagged "${fandom}" against the current ${151} keyword sets?\n\nBooks whose title/author/description now matches a known fandom will be reassigned. No EPUB re-parse, no AI call.`
    )) return;
    setBusy(`rescan:${fandom}`);
    try {
      const { data } = await api.post(
        `/admin/unknown-fandoms/${encodeURIComponent(fandom)}/rescan`,
        { dry_run: false },
      );
      toast.success(`Scanned ${data.scanned} · reclassified ${data.reclassified}`, { duration: 8000 });
      await load();
    } catch { toast.error("Rescan failed"); }
    finally { setBusy(null); }
  };

  return (
    <Card icon={AlertOctagon} title="Unknown fandoms" subtitle="Fandoms appearing in book records that aren't in the keyword classifier yet. Rescan re-runs the classifier on existing books (no AI, no re-parse). Dismiss to hide permanently." testid="admin-unknown-fandoms-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-[#6B46C1] inline-flex items-center gap-1.5" data-testid="admin-unknown-fandoms-empty">
              <Check className="w-4 h-4" /> All fandoms in your library are recognized.
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="admin-unknown-fandoms-list">
              {rows.map((r) => (
                <UnknownFandomRow
                  key={r.fandom}
                  r={r}
                  isDismissed={false}
                  busy={busy}
                  onRescan={rescan}
                  onDismiss={dismiss}
                  onUndismiss={undismiss}
                />
              ))}
            </ul>
          )}
          {dismissedRows.length > 0 && (
            <details className="mt-4" data-testid="admin-unknown-fandoms-dismissed-details">
              <summary className="text-xs font-semibold text-[#6B705C] cursor-pointer hover:text-[#2C2C2C]">
                Dismissed ({dismissedRows.length}) — still scannable
              </summary>
              <ul className="mt-2 space-y-1.5" data-testid="admin-unknown-fandoms-dismissed-list">
                {dismissedRows.map((r) => (
                  <UnknownFandomRow
                    key={r.fandom}
                    r={r}
                    isDismissed={true}
                    busy={busy}
                    onRescan={rescan}
                    onDismiss={dismiss}
                    onUndismiss={undismiss}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Email diagnostic card (operator one-shot send)
// ---------------------------------------------------------------------------
function EmailDiagnosticCard() {
  const [users, setUsers] = useState([]);
  const [mode, setMode] = useState("self"); // self | pick | custom
  const [pickedUserId, setPickedUserId] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    api.get("/admin/users").then(({ data }) => setUsers(data?.users || [])).catch(() => {});
  }, []);

  const send = async () => {
    const body = { note: note.trim() || undefined };
    if (mode === "pick") {
      if (!pickedUserId) {
        toast.error("Pick a user from the list");
        return;
      }
      body.target_user_id = pickedUserId;
    } else if (mode === "custom") {
      const e = customEmail.trim().toLowerCase();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        toast.error("Enter a valid email address");
        return;
      }
      body.target_email = e;
    }
    setSending(true);
    setLastResult(null);
    try {
      const { data } = await api.post("/admin/email-test", body);
      setLastResult({ ok: true, ...data });
      if (data.delivered) {
        toast.success(`Sent to ${data.to}`);
      } else if (data.logged) {
        toast.warning("Email sending isn't configured — logged only.");
      }
    } catch (e) {
      const detail = e?.response?.data?.detail || "Send failed";
      setLastResult({ ok: false, error: detail });
      toast.error(detail);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      icon={Mail}
      title="Email diagnostic"
      subtitle="Fire a one-shot diagnostic email to confirm Resend delivery for any user. Useful when someone reports a missing digest. Every send is audit-logged."
      testid="admin-email-diagnostic-card"
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1">Recipient</legend>
          <label className="flex items-center gap-2 text-sm text-[#2C2C2C]">
            <input
              type="radio"
              name="email-diag-mode"
              checked={mode === "self"}
              onChange={() => setMode("self")}
              data-testid="admin-email-diag-mode-self"
            />
            Send to me (the signed-in admin)
          </label>
          <label className="flex items-center gap-2 text-sm text-[#2C2C2C]">
            <input
              type="radio"
              name="email-diag-mode"
              checked={mode === "pick"}
              onChange={() => setMode("pick")}
              data-testid="admin-email-diag-mode-pick"
            />
            Pick a registered user
          </label>
          {mode === "pick" && (
            <select
              value={pickedUserId}
              onChange={(e) => setPickedUserId(e.target.value)}
              data-testid="admin-email-diag-user-select"
              className="ml-6 w-full max-w-md text-sm rounded-lg border border-[#E8E6E1] bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            >
              <option value="">— Choose a user —</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.email} {u.name ? `(${u.name})` : ""}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-[#2C2C2C]">
            <input
              type="radio"
              name="email-diag-mode"
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
              data-testid="admin-email-diag-mode-custom"
            />
            Custom email address
          </label>
          {mode === "custom" && (
            <input
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="ops@example.com"
              data-testid="admin-email-diag-custom-input"
              className="ml-6 w-full max-w-md text-sm rounded-lg border border-[#E8E6E1] bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            />
          )}
        </fieldset>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
            Optional note (shown in the email body)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="e.g. Checking that you can receive digests after your domain change"
            data-testid="admin-email-diag-note-input"
            className="w-full text-sm rounded-lg border border-[#E8E6E1] bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            rows={2}
          />
          <p className="text-xs text-[#6B705C] mt-1">{note.length}/200</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={send}
            disabled={sending}
            data-testid="admin-email-diag-send-btn"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4632] transition-colors disabled:opacity-60"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send diagnostic
          </button>
          {lastResult && lastResult.ok && lastResult.delivered && (
            <span
              data-testid="admin-email-diag-last-success"
              className="inline-flex items-center gap-1.5 text-xs text-[#6B46C1] font-semibold"
            >
              <Check className="w-3.5 h-3.5" />
              Delivered to {lastResult.to}
              {lastResult.id && (
                <code className="ml-1 text-[10px] text-[#6B705C] font-mono">#{lastResult.id.slice(0, 8)}</code>
              )}
            </span>
          )}
          {lastResult && !lastResult.ok && (
            <span
              data-testid="admin-email-diag-last-error"
              className="inline-flex items-center gap-1.5 text-xs text-[#B43F26] font-semibold"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {lastResult.error}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Watching Bookclubs card — every room the oversight admin is auto-joined to.
// ---------------------------------------------------------------------------
function WatchingBookclubsCard() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/bookclubs/watching");
      setRooms(data?.rooms || []);
    } catch { toast.error("Couldn't load watched rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <Card
      icon={Eye}
      testid="admin-watching-bookclubs-card"
      title={`Rooms I'm watching${rooms.length > 0 ? ` (${rooms.length})` : ""}`}
      subtitle="Every bookclub the platform owner is auto-added to as Admin (oversight). Includes any club you own outright."
    >
      {loading ? (
        <p className="text-sm text-[#6B705C]">Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-[#6B705C]">
          You aren&apos;t in any bookclubs yet. As soon as someone creates one,
          it&apos;ll appear here with an <em>Admin (oversight)</em> badge in
          the room&apos;s member list.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="watched-rooms-list">
          {rooms.map((r) => (
            <li
              key={r.room_id}
              data-testid={`watched-room-${r.room_id}`}
              className="flex items-start gap-3 p-3 rounded-lg border border-[#E8E6E1] bg-[#FDFBF7] hover:bg-white"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">{r.name || "(untitled)"}</p>
                  {r.my_role === "owner" ? (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#B87A00] bg-[#FDF3E1] px-1.5 py-0.5 rounded">Owner</span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#6B46C1] bg-[#EDE7FB] px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Oversight
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6B705C] truncate mt-0.5">
                  <span className="italic">{r.book_title || "(no book)"}</span>
                  {r.book_author ? <span> · {r.book_author}</span> : null}
                </p>
                <p className="text-xs text-[#6B705C] mt-1">
                  Owner: <strong>{r.owner_name || r.owner_email || "—"}</strong>
                  <span className="mx-1">·</span>
                  {r.member_count} member{r.member_count === 1 ? "" : "s"}
                  <span className="mx-1">·</span>
                  {r.message_count} message{r.message_count === 1 ? "" : "s"}
                  {r.last_message_at && (
                    <>
                      <span className="mx-1">·</span>
                      last activity {fmtTime(r.last_message_at)}
                    </>
                  )}
                </p>
              </div>
              <Link
                to={`/bookclubs/${r.room_id}`}
                data-testid={`open-room-${r.room_id}`}
                className="text-xs font-semibold text-[#6B46C1] hover:underline whitespace-nowrap inline-flex items-center gap-1 self-center"
              >
                Open <ChevronRight className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chat Rooms card (admin-curated direct messaging)
// ---------------------------------------------------------------------------
function ChatRoomsCard() {
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [r, u] = await Promise.all([
        api.get("/admin/chat-rooms"),
        api.get("/admin/users"),
      ]);
      setRooms(r?.data?.rooms || []);
      setUsers(u?.data?.users || []);
    } catch { toast.error("Couldn't load chat rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleMember = (uid, current, setCurrent) => {
    setCurrent(current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid]);
  };

  const create = async () => {
    if (!name.trim() || memberIds.length === 0) {
      toast.error("Need a name and at least one member");
      return;
    }
    setCreating(true);
    try {
      await api.post("/admin/chat-rooms", { name: name.trim(), member_user_ids: memberIds });
      toast.success("Room created");
      setName(""); setMemberIds([]);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create room");
    } finally { setCreating(false); }
  };

  const startEdit = (r) => {
    setEditingId(r.room_id);
    setEditName(r.name);
    setEditMembers(r.member_user_ids || []);
  };

  const saveEdit = async (room_id) => {
    try {
      await api.put(`/admin/chat-rooms/${room_id}`, { name: editName.trim(), member_user_ids: editMembers });
      toast.success("Room updated");
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    }
  };

  const remove = async (room_id, name) => {
    if (!window.confirm(`Delete room "${name}"? This wipes every message inside it.`)) return;
    try {
      await api.delete(`/admin/chat-rooms/${room_id}`);
      toast.success("Room deleted");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    }
  };

  return (
    <Card
      icon={MessageSquare}
      title="Chat rooms"
      subtitle="Create direct-message rooms for sets of users. Members can talk freely inside, share books and palette tokens. Only admins can create / edit / delete rooms (Phase 1 — open user-to-user messaging is parked)."
      testid="admin-chat-rooms-card"
    >
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {rooms.length === 0 ? (
            <p className="text-sm text-[#6B705C] italic mb-4" data-testid="admin-chat-rooms-empty">
              No rooms yet. Create one below.
            </p>
          ) : (
            <ul className="space-y-2 mb-5" data-testid="admin-chat-rooms-list">
              {rooms.map((r) => {
                const isEditing = editingId === r.room_id;
                return (
                  <li
                    key={r.room_id}
                    data-testid={`admin-chat-room-row-${r.room_id}`}
                    className="p-3 rounded-lg border border-[#E8E6E1] bg-white"
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          data-testid={`admin-chat-room-edit-name-${r.room_id}`}
                          className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5]"
                        />
                        <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-[#FBFAF6]">
                          {users.map((u) => (
                            <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editMembers.includes(u.user_id)}
                                onChange={() => toggleMember(u.user_id, editMembers, setEditMembers)}
                                data-testid={`admin-chat-room-edit-member-${r.room_id}-${u.user_id}`}
                              />
                              <span className="truncate">{u.email}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(r.room_id)}
                            data-testid={`admin-chat-room-save-${r.room_id}`}
                            className="text-xs px-3 py-1 rounded bg-[#6B46C1] text-white font-semibold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs px-3 py-1 rounded border border-[#E5DDC5]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#2C2C2C]">{r.name}</p>
                          <p className="text-[11px] text-[#6B705C]">
                            {r.member_user_ids.length} member{r.member_user_ids.length === 1 ? "" : "s"}
                            {r.last_message_at ? ` · last active ${fmtTime(r.last_message_at)}` : " · no messages yet"}
                          </p>
                          <p className="text-[10px] text-[#6B705C] truncate mt-0.5">
                            {r.member_user_ids.slice(0, 5).map((uid) => {
                              const u = users.find((x) => x.user_id === uid);
                              return u ? u.email : uid;
                            }).join(", ")}
                            {r.member_user_ids.length > 5 ? ` +${r.member_user_ids.length - 5}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            data-testid={`admin-chat-room-edit-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] hover:bg-[#FBFAF6]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(r.room_id, r.name)}
                            data-testid={`admin-chat-room-delete-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded text-[#B43F26] hover:bg-[#FBE8E0]"
                            title="Delete room"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Create form */}
          <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-4" data-testid="admin-chat-room-create-form">
            <p className="text-xs font-bold uppercase tracking-wider text-[#6B46C1] mb-2">Create a new room</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name (e.g. Beta readers)"
              data-testid="admin-chat-room-new-name"
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5] bg-white mb-2"
            />
            <p className="text-[10px] uppercase tracking-wider text-[#6B705C] mb-1">Members</p>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-white mb-3">
              {users.map((u) => (
                <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(u.user_id)}
                    onChange={() => toggleMember(u.user_id, memberIds, setMemberIds)}
                    data-testid={`admin-chat-room-new-member-${u.user_id}`}
                  />
                  <span className="truncate">{u.email}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={create}
              disabled={creating || !name.trim() || memberIds.length === 0}
              data-testid="admin-chat-room-create-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4632] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create room
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// Cron Health card — surfaces last run + status of every scheduled job so a
// silent cron crash can't go unnoticed (the reason this widget exists at all).
// ---------------------------------------------------------------------------
function fmtAgo(iso) {
  if (!iso) return "never";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

function CronJobRow({ job }) {
  const [expanded, setExpanded] = useState(false);
  const lastRun = job.last_run;
  const status = lastRun?.status;
  const isStale = job.stale;
  const isError = status === "error";

  // Pill colour: stale > error > ok > unknown.
  let pillClass = "bg-[#EEE9FB] text-[#6B46C1]";
  let pillLabel = "ok";
  let PillIcon = Check;
  if (!lastRun) { pillClass = "bg-gray-100 text-gray-500"; pillLabel = "no runs yet"; PillIcon = Clock; }
  else if (isStale) { pillClass = "bg-amber-100 text-amber-800"; pillLabel = "stale"; PillIcon = AlertTriangle; }
  else if (isError) { pillClass = "bg-red-100 text-red-800"; pillLabel = "last run failed"; PillIcon = CircleAlert; }

  return (
    <div className="border border-[#E8E2D4] rounded-xl p-4 mb-3" data-testid={`cron-job-${job.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[#2C2C2C]">{job.label}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pillClass}`} data-testid={`cron-pill-${job.id}`}>
              <PillIcon className="w-3 h-3" />
              {pillLabel}
            </span>
          </div>
          <p className="text-xs text-[#6B705C] mt-1">
            <Clock className="w-3 h-3 inline mr-1" />
            schedule: {job.schedule}
            {" · "}
            last run: {lastRun ? fmtAgo(lastRun.started_at) : "never"}
            {lastRun?.duration_ms ? ` (${lastRun.duration_ms}ms)` : ""}
            {" · "}
            24h: {job.runs_24h} runs / {job.errors_24h} errors
          </p>
          {isError && lastRun?.error && (
            <p className="text-xs text-red-700 mt-1 font-mono break-all" data-testid={`cron-error-${job.id}`}>
              {lastRun.error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-[#6B46C1] hover:underline"
          data-testid={`cron-toggle-${job.id}`}
        >
          {expanded ? "hide history" : `history (${job.recent.length})`}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#E8E2D4]">
          {job.recent.length === 0 ? (
            <p className="text-xs text-[#6B705C]">No runs recorded yet.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-auto" data-testid={`cron-history-${job.id}`}>
              {job.recent.map((r, idx) => (
                <li key={idx} className="text-xs flex items-start gap-2 font-mono">
                  <span className={r.status === "ok" ? "text-[#6B46C1]" : "text-red-700"}>
                    {r.status === "ok" ? "✓" : "✗"}
                  </span>
                  <span className="text-[#6B705C] flex-shrink-0">{fmtTime(r.started_at)}</span>
                  <span className="text-[#6B705C] flex-shrink-0">{r.duration_ms ?? "?"}ms</span>
                  {r.error && <span className="text-red-700 break-all">{r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CronHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/cron-health");
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load cron health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card icon={Clock} title="Scheduled jobs" subtitle="Last-run telemetry for every cron — flags silent failures." testid="cron-health-card">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#6B705C]">
          {data?.checked_at ? `Snapshot taken ${fmtAgo(data.checked_at)}` : ""}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-[#6B46C1] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
          data-testid="cron-health-refresh"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          refresh
        </button>
      </div>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3" data-testid="cron-health-error">
          {error}
        </div>
      )}
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
      {data?.jobs?.map((j) => <CronJobRow key={j.id} job={j} />)}
    </Card>
  );
}


// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route Catalogue — every registered /api/* endpoint grouped by source file.
// Surfaces the new module layout (routes/tags.py, routes/authors.py, etc.)
// from the books.py refactor, plus answers "where does this URL live?" fast.
// ---------------------------------------------------------------------------
function RouteCatalogueCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [staleDays, setStaleDays] = useState(90);
  const [openModules, setOpenModules] = useState({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/admin/routes?stale_days=${staleDays}`);
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed");
    } finally {
      setLoading(false);
    }
  };
  // Refetch whenever staleDays changes so the stale flag uses the user's window.
  useEffect(() => { load(); }, [staleDays]);

  const ql = q.trim().toLowerCase();
  const filtered = (data?.modules || []).map((g) => {
    const matchedRoutes = ql
      ? g.routes.filter((r) =>
          r.path.toLowerCase().includes(ql) ||
          r.name.toLowerCase().includes(ql) ||
          (r.doc || "").toLowerCase().includes(ql)
        )
      : g.routes;
    return { ...g, routes: matchedRoutes };
  }).filter((g) => {
    if (staleOnly && !g.is_stale) return false;
    return !ql || g.routes.length > 0 || g.module.toLowerCase().includes(ql);
  });

  return (
    <Card icon={RouteIcon} title="Route catalogue" subtitle="Every /api/* endpoint, grouped by source file." testid="route-catalogue-card">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B705C]" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by path, function name, or docstring…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#E8E2D4] rounded-lg focus:outline-none focus:border-[#6B46C1]"
            data-testid="route-catalogue-filter"
          />
        </div>
        <label className="text-xs text-[#2C2C2C] inline-flex items-center gap-1.5" data-testid="route-catalogue-stale-toggle-label">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(e) => setStaleOnly(e.target.checked)}
            data-testid="route-catalogue-stale-toggle"
          />
          stale only
        </label>
        <label className="text-xs text-[#2C2C2C] inline-flex items-center gap-1.5">
          stale ≥
          <input
            type="number"
            min={1}
            max={3650}
            value={staleDays}
            onChange={(e) => setStaleDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 px-1.5 py-0.5 border border-[#E8E2D4] rounded text-xs"
            data-testid="route-catalogue-stale-days"
          />
          d
        </label>
        <p className="text-xs text-[#6B705C]">
          {data ? `${data.total} routes / ${data.modules.length} modules` : ""}
          {data && data.stale_total > 0 && (
            <span className="ml-2 text-amber-700" data-testid="route-catalogue-stale-summary">
              · {data.stale_total} stale
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-[#6B46C1] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
          data-testid="route-catalogue-refresh"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          refresh
        </button>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{error}</div>}
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
      <div className="space-y-2" data-testid="route-catalogue-list">
        {filtered.map((g) => {
          const isOpen = openModules[g.module] ?? (!!ql || staleOnly);
          return (
            <div key={g.module} className={`border rounded-lg ${g.is_stale ? "border-amber-300 bg-amber-50/40" : "border-[#E8E2D4]"}`} data-testid={`route-mod-${g.module}`}>
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[#F7F4EE]"
                onClick={() => setOpenModules((prev) => ({ ...prev, [g.module]: !isOpen }))}
                data-testid={`route-mod-toggle-${g.module}`}
              >
                <span className="font-mono text-sm text-[#2C2C2C] flex items-center gap-2">
                  {g.module}
                  {g.is_stale && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded" data-testid={`route-mod-stale-${g.module}`}>
                      STALE
                    </span>
                  )}
                </span>
                <span className="text-xs text-[#6B705C]">
                  {g.routes.length} route{g.routes.length === 1 ? "" : "s"}
                  {g.last_modified && <span className="ml-2">· {fmtAgo(g.last_modified)}</span>}
                  <ChevronRight className={`w-3 h-3 inline ml-1 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </span>
              </button>
              {isOpen && (
                <ul className="border-t border-[#E8E2D4] px-3 py-2 space-y-1 text-xs font-mono">
                  {g.routes.map((r) => (
                    <li key={`${r.path}-${r.methods.join(",")}`} className="flex items-start gap-2">
                      <span className="flex-shrink-0 inline-flex gap-1">
                        {r.methods.map((m) => (
                          <span key={m} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            m === "GET" ? "bg-blue-100 text-blue-800" :
                            m === "POST" ? "bg-green-100 text-green-800" :
                            m === "PUT" ? "bg-amber-100 text-amber-800" :
                            m === "DELETE" ? "bg-red-100 text-red-800" :
                            "bg-gray-100 text-gray-800"
                          }`}>{m}</span>
                        ))}
                      </span>
                      <span className="text-[#2C2C2C] break-all">{r.path}</span>
                      {r.doc && <span className="text-[#6B705C] italic font-sans">— {r.doc}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-sm text-[#6B705C]" data-testid="route-catalogue-empty">
            {staleOnly ? `No modules stale (≥ ${staleDays} days).` : "No routes match your filter."}
          </p>
        )}
      </div>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// A2 — Email-stats card. Rolling 7-day Resend telemetry pulled from db.email_logs.
// ---------------------------------------------------------------------------
function EmailStatsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get("/admin/email-stats");
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <Card icon={Inbox} title="Resend deliveries · this week" subtitle="Send volume, error rate, and recent failures." testid="email-stats-card">
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="email-stats-error">{error}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-[#E8E2D4] rounded-lg p-3" data-testid="email-stats-total">
              <p className="text-xs text-[#6B705C]">Total (7d)</p>
              <p className="text-2xl font-medium text-[#2C2C2C]">{data.total_7d}</p>
            </div>
            <div className="bg-[#EEE9FB] border border-[#6B46C1]/30 rounded-lg p-3" data-testid="email-stats-ok">
              <p className="text-xs text-[#6B46C1]">Delivered</p>
              <p className="text-2xl font-medium text-[#6B46C1]">{data.ok_7d}</p>
            </div>
            <div className={`${data.error_7d > 0 ? "bg-red-50 border-red-200" : "bg-white border-[#E8E2D4]"} border rounded-lg p-3`} data-testid="email-stats-error-count">
              <p className="text-xs text-red-700">Errors</p>
              <p className={`text-2xl font-medium ${data.error_7d > 0 ? "text-red-700" : "text-[#2C2C2C]"}`}>{data.error_7d}</p>
            </div>
            <div className="bg-white border border-[#E8E2D4] rounded-lg p-3" data-testid="email-stats-rate">
              <p className="text-xs text-[#6B705C]">Error rate</p>
              <p className="text-2xl font-medium text-[#2C2C2C]">{(data.error_rate_7d * 100).toFixed(1)}%</p>
            </div>
          </div>
          {data.by_kind.length > 0 && (
            <div className="mb-4" data-testid="email-stats-by-kind">
              <p className="text-xs font-medium text-[#2C2C2C] mb-2">Per template (7d)</p>
              <ul className="space-y-1 text-sm font-mono">
                {data.by_kind.map((k) => (
                  <li key={k.kind} className="flex items-center gap-3 text-[#2C2C2C]" data-testid={`email-stats-kind-${k.kind}`}>
                    <span className="flex-1">{k.kind}</span>
                    <span className="text-[#6B46C1]">{k.ok} ok</span>
                    {k.error > 0 && <span className="text-red-700">{k.error} err</span>}
                    <span className="text-[#6B705C]">{k.total} total</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recent_failures.length > 0 && (
            <div data-testid="email-stats-failures">
              <p className="text-xs font-medium text-red-700 mb-2">Recent failures</p>
              <ul className="space-y-1 text-xs font-mono">
                {data.recent_failures.map((f, i) => (
                  <li key={i} className="text-red-700 break-all" data-testid={`email-stats-failure-${i}`}>
                    [{f.kind}] {f.to} — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" onClick={load} className="text-xs text-[#6B46C1] hover:underline mt-3 inline-flex items-center gap-1" data-testid="email-stats-refresh">
            <RotateCcw className="w-3 h-3" /> refresh
          </button>
        </>
      )}
    </Card>
  );
}

// Wrap the read-only Mongo inspector in a Card so it shares the
// collapse/expand machinery + section-search filtering with the rest
// of the admin console.
function MongoInspectorCardWrap() {
  return (
    <Card
      icon={Database}
      title="Mongo inspector"
      subtitle="Read-only browse of every collection."
      testid="admin-mongo-inspector-card"
    >
      <MongoInspectorCard />
    </Card>
  );
}

function FulltextBackfillCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await api.post("/admin/fulltext/backfill?limit=500");
      setResult(data);
      toast.success(`Indexed ${data.indexed} books (${data.skipped_missing_file} missing files, ${data.errors} errors)`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backfill failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      icon={Search}
      title="Full-text index"
      subtitle="Backfill EPUB body text for search."
      testid="admin-fulltext-card"
    >
      <div className="text-sm text-[#2C2C2C] space-y-3" data-testid="admin-fulltext-body">
        <p>
          New uploads are indexed automatically. Run this to index the older books that pre-date the feature. Each click processes up to <strong>500 books</strong> — re-click to continue.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          data-testid="admin-fulltext-backfill-btn"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {busy ? "Indexing…" : "Run backfill (500)"}
        </button>
        {result && (
          <div className="text-xs text-[#6B705C] font-mono" data-testid="admin-fulltext-result">
            scanned={result.scanned} · indexed={result.indexed} · missing_file={result.skipped_missing_file} · errors={result.errors}
          </div>
        )}
      </div>
    </Card>
  );
}




export default function AdminConsole() {
  const [openTick, setOpenTick] = useState(0);
  const [closeTick, setCloseTick] = useState(0);
  const [rawQuery, setRawQuery] = useState("");
  const query = rawQuery.trim().toLowerCase();
  const visibleCards = ADMIN_CARD_MANIFEST.filter((c) => cardMatchesQuery(c, query));
  const [remember, setRemember] = useState(() => {
    try { return localStorage.getItem(REMEMBER_PREF_KEY) === "1"; } catch { return false; }
  });
  const toggleRemember = () => {
    setRemember((v) => {
      const next = !v;
      try {
        localStorage.setItem(REMEMBER_PREF_KEY, next ? "1" : "0");
        if (!next) {
          // Turning OFF — wipe any persisted per-card state so the next
          // load is a clean collapsed page, no stale flags lingering.
          Object.keys(localStorage)
            .filter((k) => k.startsWith(CARD_STATE_PREFIX))
            .forEach((k) => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
      toast.success(next ? "Will remember which sections you leave open" : "Sections will reset on every visit");
      return next;
    });
  };
  // Small, friendly suggestion list shown under the search box so admins
  // don't have to guess what keywords are wired up. One-click sets the
  // search and immediately filters the cards below.
  const SEARCH_SUGGESTIONS = ["users", "email", "fandom", "cron", "stats", "flags", "chat", "audit", "route"];
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-10" data-testid="admin-console">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#6B46C1] text-white flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">Operator</p>
              <h1 className="font-serif text-4xl md:text-5xl text-[#2C2C2C] leading-tight">Admin console</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-testid="admin-bulk-toggles">
            <button
              type="button"
              onClick={() => setOpenTick((v) => v + 1)}
              data-testid="admin-expand-all"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" /> Expand all
            </button>
            <button
              type="button"
              onClick={() => setCloseTick((v) => v + 1)}
              data-testid="admin-collapse-all"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#6B46C1] text-[#6B46C1] text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#EEE9FB] transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-90" /> Collapse all
            </button>
            <button
              type="button"
              onClick={toggleRemember}
              data-testid="admin-remember-open-toggle"
              aria-pressed={remember}
              title={remember ? "Sections you leave open will stay open next time you visit. Click to turn off." : "Each visit starts with everything collapsed. Click to remember which sections you leave open."}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${remember ? "bg-[#EEE9FB] text-[#6B46C1] border border-[#6B46C1]" : "bg-[#F4EFE4] text-[#6B705C] border border-[#E5DDC5] hover:bg-[#EEE9FB] hover:text-[#6B46C1] hover:border-[#6B46C1]"}`}
            >
              <span
                className={`inline-block w-3 h-3 rounded-full ${remember ? "bg-[#6B46C1]" : "bg-[#C8C2A8]"}`}
                aria-hidden="true"
              />
              Remember: {remember ? "On" : "Off"}
            </button>
          </div>
        </header>

        <AlertHealthBanner />

        {/* Section search */}
        <div className="mb-4" data-testid="admin-section-search">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B705C] pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Search sections… (e.g. email, fandom, cron)"
              data-testid="admin-section-search-input"
              className="w-full pl-9 pr-9 py-2.5 rounded-full border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] placeholder:text-[#9A9580] focus:outline-none focus:border-[#6B46C1] focus:ring-2 focus:ring-[#EEE9FB] transition-colors"
            />
            {rawQuery && (
              <button
                type="button"
                onClick={() => setRawQuery("")}
                aria-label="Clear search"
                data-testid="admin-section-search-clear"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B705C] hover:text-[#2C2C2C]"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-[#6B705C]">
            <span className="italic">Try:</span>
            {SEARCH_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRawQuery(s)}
                data-testid={`admin-section-search-suggest-${s}`}
                className={`px-2 py-0.5 rounded-full border text-xs font-semibold transition-colors ${query === s ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-[#FBFAF6] text-[#6B46C1] border-[#E5DDC5] hover:bg-[#EEE9FB] hover:border-[#6B46C1]"}`}
              >
                {s}
              </button>
            ))}
            {query && (
              <span
                className="ml-auto text-[11px] uppercase tracking-[0.15em] font-bold text-[#6B46C1]"
                data-testid="admin-section-search-count"
              >
                {visibleCards.length} of {ADMIN_CARD_MANIFEST.length} sections
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-[#6B705C] italic mb-6" data-testid="admin-collapsed-hint">
          Sections are collapsed by default — click a category to reveal its contents.
          {remember ? " Your open sections will be remembered on your next visit." : ""}
        </p>

        <AdminCardsContext.Provider value={{ openTick, closeTick, remember, query }}>
          {visibleCards.length === 0 ? (
            <div
              className="shelf-card p-8 text-center"
              data-testid="admin-section-search-empty"
            >
              <Search className="w-8 h-8 text-[#6B705C] mx-auto mb-2" aria-hidden="true" />
              <p className="font-serif text-xl text-[#2C2C2C] mb-1">No sections match "{rawQuery}"</p>
              <p className="text-sm text-[#6B705C] mb-4">Try one of the suggestions above — or clear the search to see all {ADMIN_CARD_MANIFEST.length} sections.</p>
              <button
                type="button"
                onClick={() => setRawQuery("")}
                data-testid="admin-section-search-empty-clear"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              <PendingUsersCard />
              <TodayPulseCard />
              <FeedbackInboxCard />
              <HelpFeedbackCard />
              <SignupRulesCard />
              <AntivirusCard />
              <StorageByUserCard />
              <StorageTrendCard />
              <ViewConsentsCard />
              <UsersCard />
              <WatchingBookclubsCard />
              <ChatRoomsCard />
              <UnknownFandomsCard />
              <MaintenanceBannerCard />
              <HealthCard />
              <CronHealthCard />
              <RouteCatalogueCard />
              <EmailStatsCard />
              <EmailDiagnosticCard />
              <GlobalAliasesCard />
              <GlobalStatsCard />
              <FeatureFlagsCard />
              <AuditLogCard />
              {/* All-time append-only history of moderation actions.
                  Distinct from the broader admin Audit Log above —
                  scoped to the action slugs in the new
                  /admin/moderation-log endpoint. */}
              <Card
                icon={ShieldCheck}
                title="Moderation log"
                subtitle="All-time, append-only history of every mod action: approvals, rejections, room locks, and mod promotions."
                testid="admin-moderation-log-card"
              >
                <ModerationLogCard pageSize={25} />
                <AdminAnalyticsCard />
              </Card>
              <MongoInspectorCardWrap />
              <FulltextBackfillCard />
            </>
          )}
        </AdminCardsContext.Provider>
      </main>
    </div>
  );
}
