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
  Inbox, Database, Siren, HardDrive, TrendingUp, Eye, BookOpen, Sparkles, ShieldAlert, FlaskConical,
  Paperclip, HelpCircle, Bell, EyeOff, History,
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
const AdminCardsContext = React.createContext({ openTick: 0, closeTick: 0, remember: false, query: "", pushRecent: () => {} });
const REMEMBER_PREF_KEY = "shelfsort.admin.remember-open";
const CARD_STATE_PREFIX = "shelfsort.admin.card.";

// Hardcoded manifest used by the search bar's "X of N · No matches" count
// and the suggestion chips. Kept in sync with the Card title/subtitle strings
// below; extra `keywords` make the search forgiving (e.g. "outage" matches
// the Maintenance banner card whose title doesn't contain that word).
// Card sections (2026-06-22) — adds category grouping + sticky sidebar
// + Cmd+K command palette navigation across the 33-card admin page.
// Each manifest entry now carries a ``category`` slug that ties it to
// one of the sections rendered below.  Search still filters across the
// whole manifest regardless of category.
const ADMIN_CATEGORIES = [
  { id: "overview",  label: "Overview",            icon: "BarChart3" },
  { id: "users",     label: "Users & sign-ups",    icon: "Users" },
  { id: "feedback",  label: "Feedback & moderation", icon: "MessageSquare" },
  { id: "storage",   label: "Storage & files",     icon: "HardDrive" },
  { id: "email",     label: "Email",               icon: "Mail" },
  { id: "system",    label: "System & health",     icon: "Activity" },
  { id: "data",      label: "Data & diagnostics",  icon: "Database" },
];

const ADMIN_CARD_MANIFEST = [
  { testid: "admin-today-pulse-card", category: "overview", title: "Today · 24h pulse", subtitle: "Signups, uploads, errors at a glance.", keywords: "today pulse signups uploads errors fandoms 24h daily summary" },
  { testid: "admin-pending-users-card", category: "users", title: "Pending sign-ups", subtitle: "Approve or reject new users.", keywords: "pending sign-up approval new user gate queue invite waitlist" },
  { testid: "admin-signup-rules-card", category: "users", title: "Sign-up rules & questions", subtitle: "Approval gate, onboarding questions, community rules.", keywords: "signup register approval gate onboarding questions rules community moderation referral fandom reader type" },
  { testid: "admin-users-card", category: "users", title: "Users & admins", subtitle: "Promote or demote any account.", keywords: "users admins promote demote roles accounts" },
  { testid: "admin-view-consents-card", category: "users", title: "View-as-user consents", subtitle: "Request read-only access to a user's library.", keywords: "view as user impersonate consent privacy access permission timeline" },
  { testid: "admin-feedback-inbox-card", category: "feedback", title: "Feedback inbox", subtitle: "User-submitted bugs, ideas, and feature requests.", keywords: "feedback suggestions bug feature request inbox users reports tickets" },
  { testid: "admin-help-feedback-card", category: "feedback", title: "Help-page feedback", subtitle: "Per-page friction reports with screenshots.", keywords: "help suggestion friction page screenshot photo feedback short-form by-page" },
  { testid: "admin-watching-bookclubs-card", category: "feedback", title: "Rooms I'm watching", subtitle: "Every bookclub the platform owner has been auto-added to.", keywords: "bookclubs rooms watching oversight admin auto-join clubs moderate" },
  { testid: "admin-chat-rooms-card", category: "feedback", title: "Chat rooms", subtitle: "Direct-message rooms.", keywords: "chat rooms messages dm direct message conversations" },
  { testid: "admin-moderation-log-card", category: "feedback", title: "Moderation log", subtitle: "All-time history of mod actions.", keywords: "moderation log mod history actions approvals rejections locks bookclub" },
  { testid: "admin-antivirus-card", category: "storage", title: "Antivirus", subtitle: "ClamAV scanner status + recent flags.", keywords: "antivirus clamav virus malware scan quarantine infected eicar signature" },
  { testid: "admin-storage-by-user-card", category: "storage", title: "Top storage users", subtitle: "Top 20 accounts by uploaded bytes.", keywords: "storage user disk bytes top biggest heavy quota power outliers abandoned" },
  { testid: "admin-r2-migration-card", category: "storage", title: "R2 migration progress", subtitle: "Lazy Emergent → R2 migration sampled progress.", keywords: "r2 migration storage emergent cloudflare progress sample backfill" },
  { testid: "admin-orphan-audit-card", category: "storage", title: "Orphan audit & cleanup", subtitle: "Find books whose files are missing in both R2 and Emergent.", keywords: "orphan audit cleanup missing files head-check r2 emergent storage dead row dangling" },
  { testid: "admin-storage-trend-card", category: "storage", title: "Storage trend · 30 days", subtitle: "Cumulative bytes over time.", keywords: "storage trend disk growth chart graph history snapshot 30d size bytes" },
  { testid: "email-system-card", category: "email", title: "Email system", subtitle: "Master ON/OFF for all outbound Resend mail.", keywords: "email outbound resend pause stop disable quota system master kill switch" },
  { testid: "email-volume-forecast-card", category: "email", title: "Email volume forecast", subtitle: "7/30-day past sends + projected weekly volume vs Resend cap.", keywords: "email volume forecast quota cap resend project past 7 30 days cliff projection prediction warning" },
  { testid: "admin-email-mode-card", category: "email", title: "Admin alert email frequency", subtitle: "Immediate / Weekly digest / Off — Resend quota brake.", keywords: "admin alert email frequency digest weekly batch immediate off cron failure resend quota" },
  { testid: "admin-pending-alerts-card", category: "email", title: "Admin bell · pending alerts", subtitle: "In-app queue replacing per-failure emails.", keywords: "bell pending alerts admin in-app notifications cron failure queue digest" },
  { testid: "email-stats-card", category: "email", title: "Resend deliveries · this week", subtitle: "Send volume, error rate, recent failures.", keywords: "email resend delivery send failure stats bounce mail" },
  { testid: "admin-email-diagnostic-card", category: "email", title: "Email diagnostic", subtitle: "One-shot diagnostic email.", keywords: "email diagnostic test send resend troubleshoot mail" },
  { testid: "admin-banner-card", category: "system", title: "Maintenance banner", subtitle: "Site-wide announcement banner.", keywords: "maintenance banner outage announcement downtime planned heads-up" },
  { testid: "admin-health-card", category: "system", title: "System health", subtitle: "External dependencies + storage snapshot.", keywords: "health system mongo storage disk dependencies status" },
  { testid: "admin-stuck-uploads-card", category: "system", title: "Stuck uploads", subtitle: "Upload jobs sitting queued/processing for >10 min — leading indicator of Atlas instability or staging-disk loss.", keywords: "stuck uploads upload jobs queued processing mongo atlas failover recovery cron stranded airdrop" },
  { testid: "admin-classifier-reliability-card", category: "system", title: "Classifier reliability", subtitle: "Polish-worker error fingerprints, retry distribution, permanently-stuck count — last 7 days.", keywords: "classifier reliability polish failed errors fingerprint claude llm ai timeout retry attempts stuck pending sort book" },
  { testid: "cron-health-card", category: "system", title: "Scheduled jobs", subtitle: "Last-run telemetry for crons.", keywords: "cron jobs scheduled task background failure last-run" },
  { testid: "route-catalogue-card", category: "system", title: "Route catalogue", subtitle: "Every /api/* endpoint.", keywords: "route catalogue endpoint api list routes urls" },
  { testid: "admin-flags-card", category: "system", title: "Feature flags", subtitle: "Runtime kill switches.", keywords: "feature flags toggles kill switch runtime config" },
  { testid: "hidden-features-card", category: "system", title: "Hidden features", subtitle: "Built-but-invisible work parked behind feature flags.", keywords: "hidden features parked feature flag toggle dormant disabled invisible behind flag fichub kindle send url fetching ficfic" },
  { testid: "admin-changelog-card", category: "system", title: "Recent changelog", subtitle: "Last 20 dated entries from CHANGELOG.md.", keywords: "changelog history recent log entries shipped features fixes release dates h2 memory append" },
  { testid: "admin-canary-card", category: "system", title: "Production canary", subtitle: "7-day uptime sparkline from the nightly smoke-canary workflow.", keywords: "canary smoke production uptime sparkline workflow github actions monitor health" },
  { testid: "admin-re-extract-links-card", category: "data", title: "Backfill EPUB links", subtitle: "Re-run the link extractor on existing books to pick up reconstructed Storyid URLs.", keywords: "backfill links epub storyid fanfiction.net url reconstruction source extract reextract reprocess" },
  { testid: "admin-llm-key-health-card", category: "system", title: "LLM key health", subtitle: "Universal Key balance + 7-day burn rate + days of runway.", keywords: "llm key health balance burn rate runway days remaining claude nano banana cost spend usage emergent universal key cliff warning" },
  { testid: "admin-unknown-fandoms-card", category: "system", title: "Unknown fandoms", subtitle: "Fandoms not yet in the keyword classifier.", keywords: "unknown fandoms classifier rescan dismiss missing tag" },
  { testid: "admin-crossover-suggestions-card", category: "system", title: "Crossover suggestions", subtitle: "Character-keyword gaps detected by the AI classifier.", keywords: "crossover suggestions character keywords gap fandom overlay ai classifier feedback accept reject" },
  { testid: "admin-aliases-card", category: "system", title: "Global fandom aliases", subtitle: "Tenant-wide fandom aliases.", keywords: "fandom aliases global rename remap synonym" },
  { testid: "admin-stats-card", category: "data", title: "Global stats", subtitle: "Tenant-wide rollup.", keywords: "stats global rollup books users storage signups categories fandoms" },
  { testid: "admin-audit-card", category: "data", title: "Audit log", subtitle: "Every admin write action.", keywords: "audit log history admin actions write changes" },
  { testid: "admin-mongo-inspector-card", category: "data", title: "Mongo inspector", subtitle: "Read-only browse of every collection.", keywords: "mongo db database collections docs raw browse inspect" },
  { testid: "admin-fulltext-card", category: "data", title: "Full-text index", subtitle: "Backfill EPUB body text for search.", keywords: "fulltext full-text search epub index backfill body" },
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
  const { openTick, closeTick, remember, query, pushRecent } = useContext(AdminCardsContext);
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
  // Track expand events so the sidebar's "Recent" list reflects what
  // the operator actually opens (not what they merely scrolled past).
  // Push on the transition to open only — closing isn't a "use".
  // 2026-06-22 — added with the Recent-cards sidebar feature.
  const handleToggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && pushRecent && testid) pushRecent(testid);
      return next;
    });
  };

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
        onClick={handleToggle}
        aria-expanded={open}
        data-testid={testid ? `${testid}-toggle` : undefined}
        className={`w-full flex items-start gap-3 text-left ${open ? "mb-4" : "mb-0"}`}
      >
        <div className="w-10 h-10 rounded-xl bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-2xl text-[#2C2C2C]">{title}</h2>
          {subtitle && <p className="text-sm text-[#5B5F4D] mt-0.5">{subtitle}</p>}
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
  // 2026-06-27 — Show/hide test-fixture rows in the inbox.  Defaults
  // to OFF (real-user view) so TEST_ship_* / TEST_dbg noise from
  // integration tests stays out of the admin's eyeline.  Toggle is
  // persisted to localStorage so an admin who flipped it ON for
  // debugging stays in that mode across reloads.
  const [includeTests, setIncludeTests] = useState(() => {
    try { return localStorage.getItem("admin.feedback.include_tests") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("admin.feedback.include_tests", includeTests ? "1" : "0"); }
    catch { /* ignore */ }
  }, [includeTests]);
  // Mark-Shipped modal state.  `shipItem` is the suggestion row being
  // shipped (null = modal closed); the modal collects admin_note + a
  // "send celebration email" checkbox before PUT-ing status=done in
  // one go.  Combines what used to be 3 separate admin steps.
  const [shipItem, setShipItem] = useState(null);
  const [shipNote, setShipNote] = useState("");
  const [shipSendEmail, setShipSendEmail] = useState(true);
  const [shipBusy, setShipBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter === "all" ? {} : { status: filter };
      if (includeTests) params.include_tests = true;
      const [{ data: list }, { data: count }] = await Promise.all([
        api.get("/suggestions", { params }),
        api.get("/admin/suggestions/open-count", { params: includeTests ? { include_tests: true } : {} }),
      ]);
      setItems(list?.suggestions || []);
      setOpenCount(count?.open || 0);
    } catch { toast.error("Couldn't load feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, includeTests]);

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

  // Mark Shipped flow — opens a small modal so admin can attach a
  // public-facing changelog note + choose whether to fire the
  // celebration email, all in one click (used to be 3 steps).
  const openShipModal = (it) => {
    setShipItem(it);
    setShipNote(it.admin_note || "");
    // Default ON unless we've already sent the credit email for this
    // suggestion (re-shipping = no double notification).
    setShipSendEmail(!it.shipped_credit_sent_at);
  };
  const closeShipModal = () => {
    if (shipBusy) return; // don't drop the modal mid-request
    setShipItem(null);
    setShipNote("");
    setShipSendEmail(true);
  };
  const submitShip = async () => {
    if (!shipItem) return;
    setShipBusy(true);
    const sid = shipItem.suggestion_id;
    try {
      const trimmed = shipNote.trim();
      await api.put(`/admin/suggestions/${sid}`, {
        status: "done",
        admin_note: trimmed || null,
        skip_email: !shipSendEmail,
      });
      toast.success(shipSendEmail ? "🚢 Shipped — celebration email sent" : "🚢 Shipped — email skipped");
      // Same optimistic-update rules as setStatus().
      if (filter !== "all" && filter !== "done") {
        setItems(items.filter((i) => i.suggestion_id !== sid));
        setOpenCount(Math.max(0, openCount - 1));
      } else {
        setItems(items.map((i) => i.suggestion_id === sid ? { ...i, status: "done", admin_note: trimmed || null } : i));
      }
      setShipItem(null);
      setShipNote("");
      setShipSendEmail(true);
    } catch (err) {
      // Surface the real server reason instead of a generic toast so
      // admins aren't left wondering why nothing happened (review
      // finding from iteration_46).
      const detail = err?.response?.data?.detail || err?.message || "Try again.";
      toast.error(`Couldn't mark shipped — ${detail}`);
    } finally {
      setShipBusy(false);
    }
  };

  const statusBadge = (s) => {
    const map = {
      open: { bg: "bg-[#FBE9E5]", fg: "text-[#B43F26]", label: "Open" },
      under_review: { bg: "bg-[#F5F0E0]", fg: "text-[#8B4F00]", label: "Reviewing" },
      planned: { bg: "bg-[#E8EEF5]", fg: "text-[#3A5A8C]", label: "Planned" },
      done: { bg: "bg-[#EEF3EC]", fg: "text-[#1F4D2A]", label: "Done" },
      declined: { bg: "bg-[#F5F3EC]", fg: "text-[#5B5F4D]", label: "Declined" },
    };
    const t = map[s] || map.open;
    return <span className={`px-2 py-0.5 rounded-full ${t.bg} ${t.fg} text-xs font-medium`}>{t.label}</span>;
  };

  const cat = (c) => ({
    bug: { fg: "text-[#B43F26]", label: "Bug" },
    improvement: { fg: "text-[#3A5A8C]", label: "Tweak" },
    feature: { fg: "text-[#6B46C1]", label: "Feature" },
  }[c] || { fg: "text-[#5B5F4D]", label: c });

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
              filter === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
            }`}
          >
            {lbl}
          </button>
        ))}
        {/* 2026-06-27 — Test-fixture toggle.  Off by default so the
            inbox shows only real-user feedback; flip ON to debug
            fixture leakage / verify integration-test rows landed
            correctly.  Sits at the end of the chip row with a
            distinct amber tint so it doesn't read as a status. */}
        <button
          type="button"
          onClick={() => setIncludeTests((v) => !v)}
          aria-pressed={includeTests}
          data-testid="feedback-toggle-include-tests"
          title={includeTests
            ? "Hide TEST_ fixture rows from agent/test users"
            : "Show TEST_ fixture rows submitted by test/agent accounts"}
          className={`ml-auto px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
            includeTests
              ? "bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]/30"
              : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4] border border-transparent"
          }`}
        >
          {includeTests ? "🧪 Tests: shown" : "🧪 Tests: hidden"}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
                className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
                data-testid={`feedback-row-${it.suggestion_id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold uppercase tracking-[0.15em] ${c.fg}`}>{c.label}</span>
                      {statusBadge(it.status)}
                      <span className="text-xs text-[#5B5F4D]">· {it.votes_count} vote{it.votes_count === 1 ? "" : "s"}</span>
                      {it.has_attachment && (() => {
                        // Pick a label + accent based on MIME family
                        // so admins can spot screenshots vs log dumps
                        // at a glance before they expand the row.
                        const mime = (it.attachment_mime || "").toLowerCase();
                        let label = "file";
                        let tone = "bg-[#EEE9FB] text-[#6B46C1] border-[#6B46C1]/30";
                        if (mime.startsWith("image/")) {
                          label = "image";
                          tone = "bg-emerald-50 text-emerald-800 border-emerald-300";
                        } else if (mime.includes("pdf")) {
                          label = "pdf";
                          tone = "bg-rose-50 text-rose-800 border-rose-300";
                        } else if (
                          mime.startsWith("text/") ||
                          mime.includes("log") ||
                          mime.includes("json") ||
                          mime.includes("csv")
                        ) {
                          label = "log";
                          tone = "bg-amber-50 text-amber-800 border-amber-300";
                        } else if (
                          mime.includes("zip") ||
                          mime.includes("compressed") ||
                          mime.includes("tar") ||
                          mime.includes("octet-stream")
                        ) {
                          label = "zip";
                          tone = "bg-slate-100 text-slate-700 border-slate-300";
                        }
                        return (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] border rounded-full px-2 py-0.5 ${tone}`}
                            data-testid={`feedback-attachment-badge-${it.suggestion_id}`}
                            data-mime-family={label}
                            title={`Attachment: ${it.attachment_name || ""} (${it.attachment_mime || "unknown"})`}
                          >
                            <Paperclip className="w-2.5 h-2.5" /> {label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="font-medium text-[#2C2C2C] mt-1">{it.title}</p>
                    <p className="text-xs text-[#5B5F4D] mt-0.5">
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
                      <p className="text-sm text-[#5B5F4D] italic mb-3">No description.</p>
                    )}
                    {it.has_attachment && (
                      <div className="mb-3" data-testid={`feedback-attachment-${it.suggestion_id}`}>
                        <a
                          href={`${process.env.REACT_APP_BACKEND_URL}/api/suggestions/${it.suggestion_id}/attachment`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[#6B46C1] bg-white border border-[#E5DDC5] rounded-full px-2.5 py-1 hover:border-[#6B46C1]"
                          data-testid={`feedback-attachment-open-${it.suggestion_id}`}
                          title={it.attachment_name || "attachment"}
                        >
                          <Paperclip className="w-3 h-3" />
                          <span className="truncate max-w-[22ch]">{it.attachment_name || "attachment"}</span>
                          {it.attachment_size ? (
                            <span className="text-[10px] text-[#5B5F4D]">
                              {it.attachment_size < 1024 * 1024
                                ? `${Math.round(it.attachment_size / 1024)} KB`
                                : `${(it.attachment_size / 1024 / 1024).toFixed(1)} MB`}
                            </span>
                          ) : null}
                        </a>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Primary action: ship the suggestion in one
                          modal click (status=done + admin_note +
                          celebration email).  Hidden when the
                          suggestion is already done — admin can still
                          change status via the secondary chips below. */}
                      {it.status !== "done" && (
                        <button
                          onClick={() => openShipModal(it)}
                          disabled={busyId === it.suggestion_id || shipBusy}
                          data-testid={`feedback-mark-shipped-${it.suggestion_id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#6B46C1] hover:bg-[#553B96] text-white text-xs font-semibold disabled:opacity-60 transition-colors"
                        >
                          <Send className="w-3 h-3" /> Mark shipped
                        </button>
                      )}
                      {["under_review", "planned", "done", "declined", "open"]
                        .filter((s) => s !== it.status && s !== "done")
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
                      {it.status === "done" && (
                        // Once shipped, allow re-opening via the same
                        // chip row.  Less-common path so it sits as a
                        // de-emphasized chip.
                        <button
                          onClick={() => setStatus(it.suggestion_id, "open")}
                          disabled={busyId === it.suggestion_id}
                          data-testid={`feedback-status-${it.suggestion_id}-open`}
                          className="px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#2C2C2C] text-xs disabled:opacity-60 capitalize"
                        >
                          → open
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* Mark Shipped modal — opens from the primary button on each
          row.  Combines status=done + admin_note + email-checkbox so
          the most-rewarding admin action is one click + one submit. */}
      {shipItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeShipModal}
          data-testid="feedback-ship-modal-backdrop"
        >
          <div
            className="bg-[#FBF7EE] dark:bg-zinc-900 rounded-2xl shadow-2xl border border-[#E5DDC5] dark:border-zinc-700 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-ship-modal-title"
            data-testid="feedback-ship-modal"
          >
            <div className="p-5 border-b border-[#E5DDC5] dark:border-zinc-700 flex items-start justify-between gap-3">
              <div>
                <h3 id="feedback-ship-modal-title" className="font-serif text-lg text-[#2C2C2C] dark:text-zinc-100 flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#6B46C1]" /> Mark suggestion shipped
                </h3>
                <p className="text-xs text-[#5B5F4D] mt-1 truncate max-w-[36ch]" title={shipItem.title}>
                  &ldquo;{shipItem.title}&rdquo;
                </p>
              </div>
              <button
                onClick={closeShipModal}
                disabled={shipBusy}
                className="text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50 p-1 -m-1"
                aria-label="Close"
                data-testid="feedback-ship-modal-close"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label htmlFor="feedback-ship-note" className="block text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-1.5">
                  Public note (optional)
                </label>
                <textarea
                  id="feedback-ship-note"
                  value={shipNote}
                  onChange={(e) => setShipNote(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder='e.g. "Now ships with iPhone Safari support."'
                  disabled={shipBusy}
                  className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-[#2C2C2C] dark:text-zinc-100 placeholder-[#A5A29A] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/40 resize-none"
                  data-testid="feedback-ship-note-input"
                />
                <p className="text-[11px] text-[#5B5F4D] mt-1">
                  Shown publicly on the <span className="font-medium">/changelog</span> credit row.
                </p>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none" data-testid="feedback-ship-email-label">
                <input
                  type="checkbox"
                  checked={shipSendEmail}
                  onChange={(e) => setShipSendEmail(e.target.checked)}
                  disabled={shipBusy || !!shipItem.shipped_credit_sent_at}
                  className="mt-1 w-4 h-4 accent-[#6B46C1]"
                  data-testid="feedback-ship-email-checkbox"
                />
                <span className="text-sm text-[#2C2C2C] dark:text-zinc-100">
                  Send celebration email to <span className="font-medium">{shipItem.submitter_name || shipItem.submitter_email || "submitter"}</span>
                  {shipItem.shipped_credit_sent_at ? (
                    <span className="block text-[11px] text-[#5B5F4D] mt-0.5 italic">
                      Already sent — re-shipping won&rsquo;t notify again.
                    </span>
                  ) : (
                    <span className="block text-[11px] text-[#5B5F4D] mt-0.5">
                      Fires the &ldquo;Your idea shipped!&rdquo; email (once per suggestion).
                    </span>
                  )}
                </span>
              </label>
            </div>
            <div className="p-5 pt-3 border-t border-[#E5DDC5] dark:border-zinc-700 flex items-center justify-end gap-2">
              <button
                onClick={closeShipModal}
                disabled={shipBusy}
                className="px-4 py-1.5 rounded-full text-sm text-[#5B5F4D] hover:text-[#2C2C2C] disabled:opacity-50"
                data-testid="feedback-ship-modal-cancel"
              >
                Cancel
              </button>
              <button
                onClick={submitShip}
                disabled={shipBusy}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#6B46C1] hover:bg-[#553B96] text-white text-sm font-semibold disabled:opacity-60 transition-colors"
                data-testid="feedback-ship-modal-submit"
              >
                {shipBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {shipBusy ? "Shipping…" : "Ship it"}
              </button>
            </div>
          </div>
        </div>
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
  // 2026-06-27 — Help-page feedback is also polluted by integration
  // tests posting placeholder text from agent-account submitters
  // (@example.com / user_* / etc.).  Mirror the FeedbackInboxCard
  // toggle so admins see the real-user friction queue by default.
  const [includeTests, setIncludeTests] = useState(() => {
    try { return localStorage.getItem("admin.helpfeedback.include_tests") === "1"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("admin.helpfeedback.include_tests", includeTests ? "1" : "0"); }
    catch { /* ignore */ }
  }, [includeTests]);

  const load = async () => {
    setLoading(true);
    try {
      const statusParam = status === "all" ? "" : status;
      const baseParams = { status: statusParam, ...(includeTests ? { include_tests: true } : {}) };
      const [{ data: agg }, { data: list }] = await Promise.all([
        api.get("/admin/feedback/by-page", { params: { ...baseParams, limit: 30 } }),
        api.get("/admin/feedback", { params: { ...baseParams, page: pageFilter || undefined, limit: 100 } }),
      ]);
      setByPage(agg?.rows || []);
      setRows(list?.rows || []);
    } catch { toast.error("Couldn't load help feedback"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, pageFilter, includeTests]);

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
              status === val ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
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
        {/* 2026-06-27 — Tests toggle.  Sits at the end of the chip
            row (or right of the page-filter clear if visible).
            Distinct amber tint so it doesn't read as a status pill. */}
        <button
          type="button"
          onClick={() => setIncludeTests((v) => !v)}
          aria-pressed={includeTests}
          data-testid="help-feedback-toggle-include-tests"
          title={includeTests
            ? "Hide test-account submissions from the friction queue"
            : "Show test-account submissions (debug fixture leakage)"}
          className={`${pageFilter ? "" : "ml-auto"} px-3 py-1 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${
            includeTests
              ? "bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]/30"
              : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4] border border-transparent"
          }`}
        >
          {includeTests ? "🧪 Tests: shown" : "🧪 Tests: hidden"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {/* Per-page aggregation widget */}
          {byPage.length === 0 ? (
            <p className="text-sm text-[#1F8F4E] italic inline-flex items-center gap-1.5 mb-2" data-testid="help-feedback-empty">
              <Check className="w-3.5 h-3.5" /> No {status === "all" ? "" : status} feedback yet.
            </p>
          ) : (
            <div className="mb-5" data-testid="help-feedback-by-page">
              <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] font-bold mb-2">By page</p>
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
                            <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D]">
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
              <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] font-bold mb-2">
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
                      className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
                      data-testid={`help-feedback-row-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#5B5F4D] font-mono truncate">{r.page || "(unknown)"}</p>
                          <p className="text-sm text-[#2C2C2C] mt-0.5 line-clamp-2">{text}</p>
                          <p className="text-xs text-[#5B5F4D] mt-1">
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
                  ? "bg-[#EDE6FA] dark:bg-purple-900/40 border-[#6B46C1] text-[#2C2C2C] dark:text-purple-50"
                  : "bg-[#FBFAF6] dark:bg-zinc-800/60 border-[#E5DDC5] dark:border-zinc-700 hover:border-[#6B46C1] text-[#2C2C2C] dark:text-zinc-100"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                Approval gate
              </p>
              <p className="font-medium mt-1">
                {cfg.approval_gate_enabled ? "ON — admin reviews every sign-up" : "OFF — auto-approve everyone"}
              </p>
              <p className="text-xs text-[#3F4034] dark:text-zinc-400 mt-1.5">
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
                  ? "bg-[#EDE6FA] dark:bg-purple-900/40 border-[#6B46C1] text-[#2C2C2C] dark:text-purple-50"
                  : "bg-[#FBFAF6] dark:bg-zinc-800/60 border-[#E5DDC5] dark:border-zinc-700 hover:border-[#6B46C1] text-[#2C2C2C] dark:text-zinc-100"
              } disabled:opacity-60`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                Onboarding questions
              </p>
              <p className="font-medium mt-1">
                {cfg.questions_enabled ? "ON — questions shown at sign-up" : "OFF — skip onboarding"}
              </p>
              <p className="text-xs text-[#3F4034] dark:text-zinc-400 mt-1.5">
                {cfg.questions_enabled
                  ? "Click to stop asking — keeps signed-up users' existing answers."
                  : "Click to start collecting referral, fandom, reader-type, age."}
              </p>
            </button>
          </div>

          {/* Onboarding-answer aggregation */}
          {cfg.questions_enabled && stats && (
            <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-onboarding-stats">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
                  Onboarding answers
                </p>
                <p className="text-xs text-[#5B5F4D] dark:text-zinc-400">
                  {stats.total_with_onboarding} user{stats.total_with_onboarding === 1 ? "" : "s"} answered
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <StatList title="How they found us" rows={stats.referral} testid="signup-stats-referral" />
                <StatList title="Reader type"        rows={stats.reader_type} testid="signup-stats-reader-type" />
                <StatList title="Top fandoms"        rows={stats.favorite_fandoms} testid="signup-stats-favorite-fandoms" />
                <div data-testid="signup-stats-age">
                  <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400 font-bold mb-1.5">Age</p>
                  <p className="text-sm text-[#2C2C2C] dark:text-zinc-100">
                    13+: <strong>{stats.age_13_plus}</strong> · Under 13: <strong>{stats.age_under_13}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tracked invite links (2026-06-18) */}
          <InviteLinksWidget />

          {/* Campaign conversion funnel (2026-06-19) — pairs with
              InviteLinksWidget above: shows how each tracked channel
              actually converts (signup → approved → uploaded → active). */}
          <CampaignStatsWidget />

          {/* Rules editor */}
          <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
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
                    className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] hover:text-[#2C2C2C]"
                  >
                    Cancel
                  </button>
                  <span className="text-[10px] text-[#5B5F4D] ml-auto">{draftRules.length}/50000</span>
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
              <p className="text-[10px] text-[#5B5F4D] mt-2">
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
    <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-invite-links">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
          Tracked invite links
        </p>
        <span className="text-[10px] text-[#5B5F4D] dark:text-zinc-400">
          new sign-ups tagged in onboarding-stats
        </span>
      </div>
      <p className="text-xs text-[#3F4034] dark:text-zinc-400 mb-3">
        Each link auto-pre-fills the &ldquo;How did you find Shelfsort?&rdquo; answer
        for the new user.  Anything after <code className="font-mono">?ref=</code>
        is captured verbatim, so add your own tags too.
      </p>
      <ul className="grid sm:grid-cols-2 gap-1.5">
        {links.map(({ tag, label }) => {
          const url = `${baseUrl}/?ref=${tag}`;
          return (
            <li key={tag} className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[#2C2C2C] dark:text-zinc-100 w-32 flex-shrink-0">{label}</span>
              <code className="font-mono text-[10px] text-[#3F4034] dark:text-zinc-400 truncate flex-1">{url}</code>
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


// ---------------------------------------------------------------------------
// CampaignStatsWidget — per-channel conversion funnel
// ---------------------------------------------------------------------------
// Paired with InviteLinksWidget above.  For every tracked
// ``onboarding.referral`` value, shows the funnel:
//     signups → approved → uploaded ≥ 1 book → active in last 7 days
// Real users only (test fixtures filtered server-side).  Sorted by
// signups so the most-active channel surfaces first; the "organic"
// row (users with no ref) is the baseline.
function CampaignStatsWidget() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/campaign-stats");
      setRows(data?.campaigns || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const channelLabel = (ref) => {
    if (!ref) return "Organic / direct";
    const known = {
      facebook: "Facebook", twitter: "Twitter / X", reddit: "Reddit",
      hpfanfic: "r/HPfanfiction", fanfiction: "r/FanFiction",
      tiktok: "TikTok", bookstagram: "Bookstagram", discord: "Discord",
      newsletter: "Newsletter", google: "Google search", friend: "Friend",
    };
    return known[ref] || ref;
  };

  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);

  return (
    <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-campaign-stats">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
          Campaign conversion
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="campaign-stats-refresh"
          className="text-[10px] text-[#6B46C1] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> refresh
        </button>
      </div>
      <p className="text-[11px] text-[#5B5F4D] dark:text-zinc-400 mb-3">
        Funnel for each tracked invite channel — real users only.
      </p>

      {loading ? (
        <p className="text-xs text-[#5B5F4D] italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[#5B5F4D] italic">No campaign data yet. Share a tracked invite link to start measuring.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs" data-testid="campaign-stats-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-zinc-400 border-b border-[#E5DDC5] dark:border-zinc-700">
                <th className="text-left py-2 px-1 font-semibold">Channel</th>
                <th className="text-right py-2 px-1 font-semibold" title="Landing-page visits with this ?ref= tag (deduped by IP/30-min window)">Clicks</th>
                <th className="text-right py-2 px-1 font-semibold">Signups</th>
                <th className="text-right py-2 px-1 font-semibold" title="Awaiting your approval — click to bulk-approve">Pending</th>
                <th className="text-right py-2 px-1 font-semibold">Approved</th>
                <th className="text-right py-2 px-1 font-semibold" title="Users who uploaded ≥ 1 book">Uploaded</th>
                <th className="text-right py-2 px-1 font-semibold" title="Users who logged in in the last 7 days">Active 7d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOrganic = !r.ref;
                const triggerBulk = () => {
                  if (!r.ref || (r.pending || 0) === 0) return;
                  window.dispatchEvent(new CustomEvent("shelfsort:bulk-approve-ref", { detail: { ref: r.ref } }));
                };
                return (
                  <tr
                    key={r.ref || "__organic__"}
                    data-testid={`campaign-row-${r.ref || "organic"}`}
                    className="border-b border-[#E5DDC5]/40 dark:border-zinc-700/40 last:border-0"
                  >
                    <td className={`py-1.5 px-1 ${isOrganic ? "italic text-[#5B5F4D]" : "text-[#2C2C2C] dark:text-zinc-100 font-medium"}`}>
                      {channelLabel(r.ref)}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {isOrganic ? (
                        <span className="text-[#5B5F4D] dark:text-zinc-400">—</span>
                      ) : (
                        <>
                          {r.clicks || 0}
                          {(r.clicks || 0) > 0 && (
                            <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">
                              ({pct(r.signups, r.clicks)}%)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">{r.signups}</td>
                    <td className="text-right py-1.5 px-1 font-mono">
                      {(r.pending || 0) > 0 && !isOrganic ? (
                        <button
                          type="button"
                          onClick={triggerBulk}
                          data-testid={`campaign-row-approve-${r.ref}`}
                          title={`Bulk-approve all ${r.pending} pending from ${channelLabel(r.ref)}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 transition-colors"
                        >
                          {r.pending} <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[#5B5F4D] dark:text-zinc-400">{r.pending || 0}</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.approved}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.approved, r.signups)}%)</span>
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.uploaded}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.uploaded, r.signups)}%)</span>
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.active_7d}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.active_7d, r.signups)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// Small two-column count list reused inside SignupRulesCard.
function StatList({ title, rows, testid }) {  return (
    <div data-testid={testid}>
      <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400 font-bold mb-1.5">{title}</p>
      {!rows || rows.length === 0 ? (
        <p className="text-xs text-[#5B5F4D] dark:text-zinc-400 italic">No answers yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between text-sm">
              <span className="text-[#2C2C2C] dark:text-zinc-100 capitalize">{r.label}</span>
              <span className="text-[#5B5F4D] dark:text-zinc-400 font-mono">{r.count}</span>
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Scanner status banner */}
          <div
            className={`rounded-xl border p-4 ${
              status.available && status.eicar_test_ok
                ? "bg-[#E8F3EC] dark:bg-emerald-950/40 border-[#2C7A3E] dark:border-emerald-700"
                : "bg-[#FDECE6] dark:bg-red-950/40 border-[#B43F26] dark:border-red-700"
            }`}
            data-testid="av-status-banner"
          >
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400 mb-1">
              Scanner status
            </p>
            <p className="font-medium text-[#2C2C2C] dark:text-zinc-100">
              {!status.available
                ? "DOWN — clamd unreachable; uploads currently UNSCANNED"
                : !status.eicar_test_ok
                ? "DEGRADED — daemon up but EICAR test failed"
                : `HEALTHY — EICAR test passed in ${status.scan_ms} ms`}
            </p>
            {!status.available && status?.diagnostics?.reason && (
              <p
                className="text-xs text-[#B43F26] dark:text-red-300 mt-2 leading-relaxed"
                data-testid="av-diagnostic-reason"
              >
                <strong className="uppercase tracking-wider text-[10px] mr-1">Why:</strong>
                {status.diagnostics.reason}
              </p>
            )}
            {!status.available && status?.diagnostics && (
              <details className="mt-2" data-testid="av-diagnostic-details">
                <summary className="text-xs text-[#5B5F4D] dark:text-zinc-400 cursor-pointer hover:text-[#2C2C2C] dark:hover:text-zinc-200">
                  Show full diagnostics ↓
                </summary>
                <ul className="text-xs text-[#5B5F4D] dark:text-zinc-400 mt-2 space-y-0.5 font-mono">
                  <li>binary: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.binary_path || "—"}</span></li>
                  <li>kind: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.binary_kind || "—"}</span></li>
                  <li>sig dir: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.signature_dir}</span></li>
                  <li>sig files: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.signature_files?.length ? status.diagnostics.signature_files.join(", ") : "(none)"}</span></li>
                  <li>clamd unix socket: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.clamd_socket_exists ? "yes" : "no"}</span></li>
                  <li>clamd tcp 127.0.0.1:3310: <span className="text-[#2C2C2C] dark:text-zinc-200">{status.diagnostics.clamd_tcp_reachable ? "reachable" : "unreachable"}</span></li>
                </ul>
              </details>
            )}
            {status.available && status.signature && (
              <p className="text-xs text-[#5B5F4D] dark:text-zinc-400 mt-1">
                Liveness signature: <code className="font-mono">{status.signature}</code>
              </p>
            )}
            <div className="flex gap-4 mt-2 text-xs text-[#5B5F4D] dark:text-zinc-400">
              <span>
                Total quarantined: <strong className="text-[#2C2C2C] dark:text-zinc-100">{status.quarantine_total}</strong>
              </span>
              <span>
                Last 24 h: <strong className="text-[#2C2C2C] dark:text-zinc-100">{status.quarantine_last_24h}</strong>
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
                    : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
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
                  className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-3"
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
                      <p className="text-xs text-[#5B5F4D] mt-1">
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
// R2MigrationProgressCard — sample-based gauge of how many books are on R2
// ---------------------------------------------------------------------------
// Hidden when STORAGE_BACKEND is not "r2" (the backend returns
// enabled=false).  Useful as the operator's "is it safe to drop the
// Emergent fallback?" decision tool.  Server samples 100 random books
// and HEAD-checks each one against R2 — extrapolates to the full
// collection.  Sampling takes ~5s so we don't auto-poll.

/**
 * Small "$ X saved this month" line that lives inside the
 * migration-complete banner.  Auto-formats based on scale so a
 * tiny library shows "$0.0003" and a big one shows "$10".  Hover
 * the line for a transparent tooltip explaining the math.
 */
function SavingsLine({ savings, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  if (!savings) return null;
  const usd = Number(savings.savings_usd || 0);
  const pct = Number(savings.savings_pct || 0);
  const isOverride = !!savings.rates?.egress_multiplier_is_override;
  const currentMultiplier = Number(savings.rates?.egress_multiplier || 0);
  const fmt = (n) => {
    const v = Number(n || 0);
    if (v >= 100) return `$${v.toFixed(0)}`;
    if (v >= 0.01) return `$${v.toFixed(2)}`;
    if (v > 0) return `$${v.toFixed(4)}`;
    return "$0";
  };
  const tooltip =
    `Library: ${savings.total_gb} GB stored · ${savings.monthly_egress_gb} GB est. monthly egress\n` +
    `(estimate uses egress multiplier=${currentMultiplier}${isOverride ? ' — tuned by admin' : ' — env default'})\n\n` +
    `Emergent: ${fmt(savings.emergent_estimated.total_usd)} (${fmt(savings.emergent_estimated.storage_usd)} storage + ${fmt(savings.emergent_estimated.egress_usd)} egress)\n` +
    `R2: ${fmt(savings.r2_estimated.total_usd)} (${fmt(savings.r2_estimated.storage_usd)} storage + ${fmt(savings.r2_estimated.egress_usd)} egress)\n` +
    `Savings: ${fmt(usd)} (${pct}% off)`;

  const save = async () => {
    const v = draft.trim() === "" ? null : parseFloat(draft);
    if (v !== null && (Number.isNaN(v) || v < 0 || v > 100)) {
      toast.error("Multiplier must be 0 – 100");
      return;
    }
    setSaving(true);
    try {
      await api.post("/admin/storage-cost-savings/multiplier", { multiplier: v });
      toast.success(v === null ? "Reverted to env default" : `Multiplier set to ${v}`);
      setEditing(false);
      setDraft("");
      onChanged?.();  // parent re-fetches /admin/storage-cost-savings
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save multiplier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2" data-testid="r2-savings-line-wrapper">
      <p
        className="text-[11px] text-emerald-900 italic cursor-help"
        data-testid="r2-savings-line"
        title={tooltip}
      >
        Estimated savings this month:{" "}
        <span className="font-semibold not-italic font-mono">{fmt(usd)}</span>
        {" "}
        <span className="text-emerald-700 not-italic">({pct}% off Emergent)</span>
        <span className="ml-1 text-emerald-700 not-italic">· estimate — hover for math</span>
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-1.5" data-testid="r2-multiplier-row">
        <span className="text-[10px] text-emerald-800 not-italic">
          Egress multiplier:{" "}
          <span className="font-mono font-semibold">{currentMultiplier}</span>
          {isOverride && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-[9px] font-bold uppercase tracking-wider"
              data-testid="r2-multiplier-override-badge"
            >
              admin
            </span>
          )}
        </span>
        {!editing ? (
          <button
            type="button"
            onClick={() => { setDraft(String(currentMultiplier)); setEditing(true); }}
            data-testid="r2-multiplier-edit"
            className="text-[10px] text-emerald-700 underline hover:text-emerald-900"
          >
            tune
          </button>
        ) : (
          <span className="inline-flex items-center gap-1">
            <input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              step="0.1"
              min="0"
              max="100"
              autoFocus
              placeholder="empty = env default"
              data-testid="r2-multiplier-input"
              className="w-32 text-[10px] px-2 py-0.5 border border-emerald-400 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              data-testid="r2-multiplier-save"
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? "…" : "save"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(""); }}
              data-testid="r2-multiplier-cancel"
              className="text-[10px] text-emerald-700 underline hover:text-emerald-900"
            >
              cancel
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function R2MigrationProgressCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfill, setLastBackfill] = useState(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [savings, setSavings] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/storage-migration-progress");
      setData(data);
    } catch { toast.error("Couldn't load R2 migration progress"); }
    finally { setLoading(false); }
  };
  // Cost savings rollup — loaded once on mount alongside the gauge.
  // Cheap (single Mongo aggregate) so safe to refresh on every reload.
  const loadSavings = async () => {
    try {
      const { data } = await api.get("/admin/storage-cost-savings");
      setSavings(data);
    } catch { /* silent — the banner just hides the line */ }
  };
  useEffect(() => { load(); loadSavings(); }, []);

  const backfill = async () => {
    setBackfilling(true);
    try {
      const { data: r } = await api.post("/admin/storage-migration-backfill?chunk_size=25");
      setLastBackfill(r);
      toast.success(`Migrated ${r.migrated} · skipped ${r.already_on_r2} · failed ${r.failed}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const togglePause = async () => {
    if (!data) return;
    const next = !data.emergent_fallback_paused;
    const verb = next ? "pause" : "resume";
    if (!window.confirm(
      next
        ? "Pause the Emergent fallback?\n\nFrom now on, R2 misses will return a true 404 instead of silently lazy-restoring from Emergent. You can resume any time."
        : "Resume the Emergent fallback?\n\nR2 misses will once again try Emergent and lazy-migrate any recovered file.",
    )) return;
    setTogglingPause(true);
    try {
      const { data: r } = await api.post("/admin/storage-fallback-pause", { paused: next });
      setData({ ...data, emergent_fallback_paused: r.emergent_fallback_paused });
      toast.success(`Emergent fallback ${r.emergent_fallback_paused ? "paused" : "resumed"}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't ${verb} fallback`);
    } finally {
      setTogglingPause(false);
    }
  };

  if (data && data.enabled === false) return null;

  const pct = data?.percent ?? 0;
  const complete = pct >= 100;
  const paused = !!data?.emergent_fallback_paused;
  const tint =
    pct >= 95 ? { bar: "bg-emerald-500", rail: "bg-emerald-100", text: "text-emerald-700" } :
    pct >= 60 ? { bar: "bg-amber-500",   rail: "bg-amber-100",   text: "text-amber-700"   } :
                { bar: "bg-[#6B46C1]",   rail: "bg-[#EEE9FB]",   text: "text-[#6B46C1]"   };

  return (
    <Card
      icon={HardDrive}
      title="R2 migration progress"
      subtitle="Sampled progress of the lazy Emergent → R2 migration. 100 books HEAD-checked per refresh."
      testid="admin-r2-migration-card"
    >
      {data ? (
        <div className="space-y-3" data-testid="r2-migration-stats">
          {complete && (
            <div
              className="rounded-lg p-4 bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-300"
              data-testid="r2-migration-complete-banner"
            >
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-lg text-emerald-900">
                    Migration complete · 100% on R2
                  </p>
                  <p className="text-xs text-emerald-800 mt-0.5 leading-relaxed">
                    Every sampled book lives in R2.  Safe to pause the Emergent fallback so a true R2 miss stops silently lazy-restoring from the legacy backend. You can resume any time.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePause}
                      disabled={togglingPause}
                      data-testid="r2-fallback-toggle"
                      className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] inline-flex items-center gap-2 transition-colors ${
                        paused
                          ? "bg-white text-emerald-800 border border-emerald-400 hover:bg-emerald-50"
                          : "bg-emerald-700 text-white hover:bg-emerald-800"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {togglingPause ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {paused ? "Resume Emergent fallback" : "Pause Emergent fallback"}
                    </button>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                        paused
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "bg-emerald-200 text-emerald-900"
                      }`}
                      data-testid="r2-fallback-status"
                    >
                      Fallback: {paused ? "PAUSED" : "active"}
                    </span>
                  </div>
                  {savings && (
                    <SavingsLine savings={savings} onChanged={loadSavings} />
                  )}
                </div>
              </div>
            </div>
          )}
          <div>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="text-[#5B5F4D]">Sample-based estimate</span>
              <span className={`font-mono ${tint.text}`}>
                {data.sample_hit} / {data.sampled} sampled · <span className="font-semibold">~{data.percent}%</span>
              </span>
            </div>
            <div className={`h-2 w-full rounded-full overflow-hidden ${tint.rail}`}>
              <div className={`h-full ${tint.bar} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded p-2">
              <p className="text-[#5B5F4D] text-[10px] uppercase tracking-wider">Total books</p>
              <p className="font-mono text-[#2C2C2C] text-base">{data.total.toLocaleString()}</p>
            </div>
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded p-2">
              <p className="text-[#5B5F4D] text-[10px] uppercase tracking-wider">Est. on R2</p>
              <p className="font-mono text-[#2C2C2C] text-base">{data.estimated_migrated.toLocaleString()}</p>
            </div>
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded p-2">
              <p className="text-[#5B5F4D] text-[10px] uppercase tracking-wider">Est. remaining</p>
              <p className="font-mono text-[#2C2C2C] text-base">{Math.max(0, data.total - data.estimated_migrated).toLocaleString()}</p>
            </div>
          </div>
          {pct >= 99 && !complete && (
            <p className="text-xs text-emerald-700 italic">
              Migration nearly complete. Safe to consider dropping the Emergent fallback after a week of clean reads.
            </p>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={backfill}
              disabled={backfilling || (data?.percent ?? 0) >= 100}
              data-testid="r2-migration-backfill"
              className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#5C3AAD] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {backfilling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {backfilling ? "Migrating…" : "Migrate next 25"}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              data-testid="r2-migration-resample"
              className="text-[11px] text-[#6B46C1] hover:underline disabled:opacity-50"
            >
              {loading ? "Sampling…" : "Re-sample"}
            </button>
          </div>
          {lastBackfill && (
            <p className="text-[11px] text-[#5B5F4D] italic" data-testid="r2-migration-last-result">
              Last batch: {lastBackfill.migrated} migrated · {lastBackfill.already_on_r2} already · {lastBackfill.failed} failed · {lastBackfill.emergent_missing} missing in Emergent
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[#5B5F4D]">{loading ? "Sampling…" : "Click refresh"}</p>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// OrphanCleanupCard — find + delete books whose files vanished from storage
// ---------------------------------------------------------------------------
// HEAD-checks every book with a stored filename against the active R2
// bucket AND the Emergent fallback.  A book is flagged "orphan" only if
// BOTH backends return 404 — meaning the bytes are truly gone and the
// DB row points at nothing.  Cleanup lets the admin bulk-delete those
// dead rows so the migration progress can finally hit 100% and the
// library counts stop overstating reality.
function OrphanCleanupCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [lastResult, setLastResult] = useState(null);

  const audit = async () => {
    setLoading(true);
    setLastResult(null);
    try {
      const { data } = await api.get("/admin/orphan-audit", { params: { limit: 5000 } });
      setData(data);
      // Default to selecting every orphan — admin can untick before delete.
      setSelected(new Set((data?.orphans || []).map((o) => o.book_id)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't run orphan audit");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (book_id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(book_id)) next.delete(book_id); else next.add(book_id);
      return next;
    });
  };

  const toggleAll = () => {
    const all = (data?.orphans || []).map((o) => o.book_id);
    setSelected((prev) => (prev.size === all.length ? new Set() : new Set(all)));
  };

  const removeSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(
      `Delete ${ids.length} orphaned book record${ids.length === 1 ? "" : "s"}?\n\n`
      + `Each row will be re-checked against object storage before deletion. `
      + `Files won't be touched (they're already gone). This action is logged.`,
    )) return;
    setDeleting(true);
    try {
      const { data: r } = await api.post("/admin/orphan-audit/delete-bulk", {
        book_ids: ids,
        confirm_recheck: true,
      });
      setLastResult(r);
      toast.success(`Removed ${r.deleted} orphan${r.deleted === 1 ? "" : "s"}`);
      // Refresh the audit so the table reflects the post-delete state.
      audit();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const orphans = data?.orphans || [];
  const allChecked = orphans.length > 0 && selected.size === orphans.length;
  const sizeTotal = orphans.reduce((s, o) => s + (o.size_bytes || 0), 0);

  return (
    <Card
      icon={AlertOctagon}
      title="Orphan audit & cleanup"
      subtitle="Find DB rows whose files are missing from both R2 and Emergent, then bulk-delete them so the migration can hit 100%."
      testid="admin-orphan-audit-card"
    >
      <div className="space-y-3" data-testid="orphan-audit-body">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={audit}
            disabled={loading}
            data-testid="orphan-audit-run"
            className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#5C3AAD] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {loading ? "Auditing…" : data ? "Re-audit" : "Run audit"}
          </button>
          {data && (
            <p className="text-xs text-[#5B5F4D]" data-testid="orphan-audit-summary">
              Scanned <span className="font-mono">{data.scanned}</span> · found
              {" "}
              <span className="font-mono font-semibold text-[#E07A5F]">{data.orphan_count}</span>
              {" "}orphan{data.orphan_count === 1 ? "" : "s"} on
              {" "}<span className="font-mono">{data.backend}</span>
            </p>
          )}
        </div>

        {data && orphans.length === 0 && (
          <p
            className="text-sm text-emerald-700 italic"
            data-testid="orphan-audit-empty"
          >
            No orphans — every book row points at a real file. The library is tidy.
          </p>
        )}

        {orphans.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FBFAF6] border border-[#E5DDC5] rounded p-2">
              <label className="inline-flex items-center gap-2 text-xs text-[#2C2C2C] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  data-testid="orphan-audit-toggle-all"
                  className="w-3.5 h-3.5"
                />
                {selected.size} of {orphans.length} selected · {fmtBytes(sizeTotal)}
              </label>
              <button
                type="button"
                onClick={removeSelected}
                disabled={deleting || !selected.size}
                data-testid="orphan-audit-delete-selected"
                className="px-3 py-1.5 rounded-full bg-[#E07A5F] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#C8674E] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                {deleting ? "Removing…" : `Delete ${selected.size || ""} selected`}
              </button>
            </div>
            <div className="overflow-x-auto border border-[#E5DDC5] rounded">
              <table className="w-full text-xs">
                <thead className="bg-[#FBFAF6] text-[#5B5F4D] uppercase tracking-[0.12em] text-[10px]">
                  <tr>
                    <th className="text-left p-2 w-8"></th>
                    <th className="text-left p-2">Title</th>
                    <th className="text-left p-2">Owner</th>
                    <th className="text-left p-2">Filename</th>
                    <th className="text-right p-2">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {orphans.map((o) => (
                    <tr
                      key={o.book_id}
                      className="border-t border-[#F0EBDE] hover:bg-[#FBFAF6]"
                      data-testid={`orphan-row-${o.book_id}`}
                    >
                      <td className="p-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(o.book_id)}
                          onChange={() => toggle(o.book_id)}
                          data-testid={`orphan-row-checkbox-${o.book_id}`}
                          className="w-3.5 h-3.5"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <p className="text-[#2C2C2C] font-medium truncate max-w-[28ch]">{o.title}</p>
                        {o.author && <p className="text-[10px] text-[#5B5F4D] truncate max-w-[28ch]">{o.author}</p>}
                      </td>
                      <td className="p-2 align-top">
                        <p className="text-[#2C2C2C] truncate max-w-[24ch]">{o.owner_email || o.user_id}</p>
                        {o.owner_is_test && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] text-[9px] font-bold uppercase tracking-wider">
                            Test
                          </span>
                        )}
                      </td>
                      <td className="p-2 align-top">
                        <span className="font-mono text-[10px] text-[#5B5F4D] break-all">{o.filename}</span>
                      </td>
                      <td className="p-2 align-top text-right font-mono text-[10px] text-[#5B5F4D]">
                        {fmtBytes(o.size_bytes || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {lastResult && (
          <p className="text-[11px] text-[#5B5F4D] italic" data-testid="orphan-audit-last-result">
            Last run: removed {lastResult.deleted}
            {lastResult.recovered?.length ? ` · skipped ${lastResult.recovered.length} recovered` : ""}
            {lastResult.not_found?.length ? ` · ${lastResult.not_found.length} not found` : ""}
          </p>
        )}
        {!data && !loading && (
          <p className="text-xs text-[#5B5F4D]">
            Click <span className="font-semibold">Run audit</span> to HEAD-check every book against R2 and Emergent.
            Safe — read-only until you click delete.
          </p>
        )}
      </div>
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : data.users.length === 0 ? (
        <p className="text-sm text-[#5B5F4D] italic">No uploads with size_bytes yet.</p>
      ) : (
        <>
          <p className="text-xs text-[#5B5F4D] mb-3">
            Grand total: <strong className="font-bold text-[#2C2C2C]">{fmtBytes(data.grand_total_bytes)}</strong> across{" "}
            <strong className="font-bold text-[#2C2C2C]">{data.grand_total_books_with_size.toLocaleString()}</strong> books.
            <span className="block text-[#5B5F4D] italic mt-0.5">
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
                  className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 hover:bg-[#F5F3EC] transition-colors"
                  data-testid={`storage-row-${u.user_id}`}
                >
                  <button
                    type="button"
                    onClick={() => expand(u.user_id)}
                    className="w-full text-left p-3 flex items-center gap-3"
                  >
                    <span className="text-sm font-bold text-[#5B5F4D] tabular-nums w-7 text-right">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-[#2C2C2C] truncate">{u.name}</span>
                        {u.username && <span className="text-xs text-[#6B46C1]">@{u.username}</span>}
                      </div>
                      <p className="text-xs text-[#5B5F4D] truncate">{u.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono text-sm text-[#2C2C2C]">{fmtBytes(u.total_bytes)}</p>
                      <p className="text-xs text-[#5B5F4D]">
                        {u.book_count.toLocaleString()} books · {pct.toFixed(1)}%
                      </p>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-[#5B5F4D] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                    />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 border-t border-[#E5DDC5]" data-testid={`storage-drill-${u.user_id}`}>
                      {drillLoading && !drilldown[u.user_id] ? (
                        <p className="text-xs text-[#5B5F4D] italic py-2">Loading books…</p>
                      ) : drilldown[u.user_id] ? (
                        <>
                          <p className="text-xs text-[#5B5F4D] py-2">
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
                                <span className="font-mono text-[#5B5F4D] flex-shrink-0">
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
              days === d ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#5B5F4D] hover:bg-[#E8E2D4]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
      {loading || !data ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          <div className="flex items-baseline gap-4 mb-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-[#5B5F4D]">Now</p>
              <p className="font-mono text-lg text-[#2C2C2C]">{fmtBytes(data.latest?.total_bytes || 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#5B5F4D]">Growth · {days}d</p>
              <p className="font-mono text-lg text-[#1F8F4E]">+{fmtBytes(data.growth_bytes || 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#5B5F4D]">Books</p>
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
          <div className="flex items-center justify-between text-xs text-[#5B5F4D] mt-1">
            <span>{pts[0]?.date}</span>
            <span>{pts[pts.length - 1]?.date}</span>
          </div>
          <p className="text-xs text-[#5B5F4D] italic mt-2">
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
                        {c.reason && <p className="text-xs text-[#5B5F4D] italic mt-0.5">"{c.reason}"</p>}
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

  const realUsers = users.filter((u) => !isTestUser(u));
  const testUsers = users.filter(isTestUser);

  const renderRow = (u) => (
    <li key={u.user_id} className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-user-row-${u.user_id}`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#2C2C2C] truncate flex items-center gap-1.5">
          {/* Presence dot — green if last_seen_at within 5 min, grey
              otherwise.  The touch endpoint runs from get_current_user
              throttled to ≤1 write/min per user.  See auth_dep.py. */}
          {(() => {
            const seenIso = u.last_seen_at;
            const onlineMs = 5 * 60 * 1000;
            const isOnline = seenIso && (Date.now() - new Date(seenIso).getTime() < onlineMs);
            return (
              <span
                data-testid={`admin-user-presence-${u.user_id}`}
                data-online={isOnline ? "true" : "false"}
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-[#3D6B3D] ring-2 ring-[#3D6B3D]/20" : "bg-[#9B9B8C]/60"}`}
                title={
                  seenIso
                    ? (isOnline
                        ? `Online — last activity ${new Date(seenIso).toLocaleString()}`
                        : `Offline — last activity ${new Date(seenIso).toLocaleString()}`)
                    : "Offline — no activity since presence tracking was introduced"
                }
              />
            );
          })()}
          {u.name || u.email}
          {u.is_admin && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#6B46C1] font-bold">
              <ShieldCheck className="w-3 h-3" /> Admin
            </span>
          )}
          {u.is_moderator && (
            <span
              data-testid={`admin-user-mod-badge-${u.user_id}`}
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#2F6E60] font-bold bg-[#E0F0EA] px-1.5 py-0.5 rounded"
              title="Moderator — can approve sign-ups and lock bookclub rooms"
            >
              <ShieldCheck className="w-3 h-3" /> Mod
            </span>
          )}
          {isTestUser(u) && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D] font-bold bg-[#F2EDDF] px-1.5 py-0.5 rounded"
              title="Heuristic match — looks like a test/QA account (example.com domain, test+ alias, etc.)"
              data-testid={`admin-user-testbadge-${u.user_id}`}
            >
              Test
            </span>
          )}
        </p>
        <p className="text-xs text-[#5B5F4D] truncate">
          {u.email} · {u.book_count} book{u.book_count === 1 ? "" : "s"} · joined {fmtTime(u.created_at)}
          {" · "}
          <span
            data-testid={`admin-user-last-login-${u.user_id}`}
            className={u.last_login_at ? "" : "italic text-[#9B9B8C]"}
            title={u.last_login_at ? `Last login: ${new Date(u.last_login_at).toLocaleString()}` : "This user has never logged in."}
          >
            last on {fmtAgo(u.last_login_at)}
          </span>
        </p>
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
              : "text-[#2F6E60] hover:bg-[#E0F0EA]"
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {/* Real users — always visible.  This is the list admins
              actually care about day-to-day. */}
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
              Real users
              <span className="ml-2 font-normal normal-case text-[#9B9B8C]">({realUsers.length})</span>
            </p>
          </div>
          <ul className="space-y-1.5" data-testid="admin-users-list">
            {realUsers.map(renderRow)}
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

  // Quick presets for deploy windows.  Saves us re-typing every time
  // we push.  Both call ``save`` afterwards so the change goes live
  // immediately — no second click required.
  const applyDeployStarting = async () => {
    setEnabled(true);
    setSeverity("warn");
    setMessage("Shelfsort is updating — you may see brief blips for ~2 min. Your reading position is safe.");
    setSaving(true);
    try {
      await api.put("/admin/maintenance-banner", {
        enabled: true,
        message: "Shelfsort is updating — you may see brief blips for ~2 min. Your reading position is safe.",
        severity: "warn",
      });
      toast.success("Deploy-starting banner published.");
    } catch { toast.error("Couldn't publish deploy banner"); }
    finally { setSaving(false); }
  };
  const applyDeployComplete = async () => {
    // For "complete" we turn the banner OFF — the NewVersionBanner
    // component on the frontend already picks up the new boot_id and
    // surfaces the per-user "refresh now" prompt automatically.
    // Leaving the site-wide warn banner up would just stack on top of
    // that prompt and look confusing.
    setEnabled(false);
    setMessage("");
    setSaving(true);
    try {
      await api.put("/admin/maintenance-banner", {
        enabled: false,
        message: "",
        severity: "info",
      });
      toast.success("Deploy complete — banner cleared. Users will see the auto-refresh prompt.");
    } catch { toast.error("Couldn't clear banner"); }
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
          <p className="text-xs text-[#5B5F4D] mt-1">{message.length}/240</p>
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
        {/* Deploy presets — one-click banners for the most common
            "I'm about to redeploy" / "just deployed" announcements.
            Apply-deploy-complete clears the banner because the
            NewVersionBanner component already auto-detects the new
            backend boot_id and prompts users to refresh per-tab. */}
        <div className="pt-2 border-t border-[#E5DDC5] flex flex-wrap gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D] w-full mb-1">
            Deploy presets
          </span>
          <button
            type="button"
            onClick={applyDeployStarting}
            disabled={saving}
            data-testid="admin-banner-deploy-starting"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FDF3E1] text-[#8C5C00] text-xs font-semibold border border-[#B87A00]/40 hover:bg-[#FCE9C2] disabled:opacity-50"
          >
            🛠️ Deploy starting
          </button>
          <button
            type="button"
            onClick={applyDeployComplete}
            disabled={saving}
            data-testid="admin-banner-deploy-complete"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] text-xs font-semibold border border-[#6B46C1]/30 hover:bg-[#E5DDF9] disabled:opacity-50"
          >
            ✅ Deploy complete
          </button>
        </div>
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

// 2026-06-27 — Floating "guardian paused" banner.
//
// Cross-page sticky alert that surfaces ANY auto-paused watchdog
// (AV, email-quota, canary) at the top of `/admin`, no matter
// which card the operator is focused on at the moment.  Without
// this, a paused brake could sit unnoticed for hours while the
// operator is deep in a different admin task — exactly the kind
// of "you don't realize until users complain" gap the watchdogs
// were meant to close in the first place.
//
// Implementation notes:
//   • Independent fetch / polling from HealthCard so we don't
//     couple them — the banner needs to live for the whole admin
//     session, HealthCard only when expanded.
//   • Poll interval = 60s.  Faster wouldn't help (watchdog crons
//     themselves run every 2h) and would just hit Mongo unnecessarily.
//   • Renders NOTHING when nothing is paused → zero visual cost
//     on healthy admin pages.
//   • Click handler scrolls smoothly to the System Health card so
//     the operator can take action immediately.
// ---------------------------------------------------------------------------
// In-flight uploads warning banner (2026-06-28)
// ---------------------------------------------------------------------------
// Renders a red sticky strip at the top of /admin when any users
// have upload_jobs in `queued` or `processing` state.  The point is
// to make redeploying-during-an-active-Airdrop a *visible* choice
// rather than a silent regret.  A redeploy will reliably interrupt
// the asyncio worker and (until the staging-path refactor lands)
// can lose in-flight bytes if the staging volume doesn't survive.
//
// Polls GET /api/admin/upload-jobs/in-flight every 30s while the
// tab is visible.  Returns null when count===0 → zero visual cost
// on healthy admin pages.
// ---------------------------------------------------------------------------
function InFlightUploadsBanner() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/admin/upload-jobs/in-flight");
        if (alive) setData(data);
      } catch {
        if (alive) setData(null);
      }
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const total = data?.total ?? 0;
  if (total === 0) return null;
  const users = data?.users ?? 0;
  return (
    <div
      className="mb-4 rounded-xl border border-[#C5564B] bg-[#FBE2E0] text-[#7C2D2A] p-4 flex items-start gap-3"
      role="alert"
      data-testid="admin-in-flight-uploads-banner"
    >
      <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5 text-[#C5564B]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">
          ⚠️ Don&rsquo;t redeploy right now — {total} upload job{total === 1 ? "" : "s"} in-flight
          {users > 0 ? ` across ${users} user${users === 1 ? "" : "s"}` : ""}.
        </p>
        <p className="text-xs mt-0.5 opacity-90">
          A redeploy interrupts the async worker.  Wait until the count
          drops to zero (or call the &ldquo;Re-kick now&rdquo; button on the{" "}
          <button
            type="button"
            onClick={() => {
              const el = document.querySelector('[data-testid="admin-stuck-uploads-card"]');
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="underline hover:text-[#5C1F1D]"
            data-testid="admin-in-flight-uploads-jump"
          >
            Stuck uploads card
          </button>
          {" "}afterwards if any get stranded).
        </p>
      </div>
    </div>
  );
}



function GuardiansBanner() {
  const [paused, setPaused] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const { data } = await api.get("/admin/system-health");
        if (cancelled) return;
        const list = Array.isArray(data?.watchdogs) ? data.watchdogs : [];
        setPaused(list.filter((w) => w.auto_paused === true));
      } catch { /* silent — banner is optional */ }
    };
    fetchHealth();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchHealth();
    }, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") fetchHealth(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (paused.length === 0) return null;

  // Friendly summary text — "1 guardian paused: Email quota" or
  // "2 guardians paused: Email quota, Antivirus".
  const names = paused.map((w) => w.name.replace(/\s*\(.+\)$/, "")).join(", ");

  const jumpToHealthCard = () => {
    const el = document.querySelector('[data-testid="admin-health-card"]');
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.style.transition = "box-shadow 0.4s ease-in-out";
      el.style.boxShadow = "0 0 0 3px #C5564B";
      setTimeout(() => { el.style.boxShadow = ""; }, 1600);
    }
  };

  return (
    <div
      className="sticky top-0 z-30 -mx-6 px-6 py-2.5 bg-[#7C2D2A] text-white shadow-md flex items-center gap-3 text-sm"
      role="alert"
      data-testid="admin-guardians-paused-banner"
    >
      <span aria-hidden="true">🛑</span>
      <span className="font-semibold">
        {paused.length} guardian{paused.length === 1 ? "" : "s"} auto-paused:
      </span>
      <span className="opacity-90" data-testid="admin-guardians-paused-names">{names}</span>
      <button
        type="button"
        onClick={jumpToHealthCard}
        className="ml-auto px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors"
        data-testid="admin-guardians-jump-to-health"
      >
        Review →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stuck Uploads card (2026-06-27)
// ---------------------------------------------------------------------------
// Surfaces upload_jobs sitting in queued/processing for longer than
// 10 min — the leading indicator of either sustained MongoDB
// instability (Atlas elections that take longer than the recovery
// cron's 5-min window) or staging-disk loss between accept and
// process.  Healthy admin pages render nothing visually noisy here
// (just a "✓ no stuck jobs" line).
//
// • Auto-poll every 60s when visible (matches the watchdog cadence).
// • Reads `/api/admin/upload-jobs/stuck?threshold_minutes=10`.
// • Renders the friendly error blurb the user would have seen, plus
//   the age in minutes — operator can spot a worsening pattern
//   without flipping into Mongo.
// ---------------------------------------------------------------------------
function StuckUploadsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recovering, setRecovering] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/upload-jobs/stuck?threshold_minutes=10");
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load stuck uploads");
    } finally {
      setLoading(false);
    }
  };

  const recoverNow = async () => {
    setRecovering(true);
    try {
      const { data: r } = await api.post("/admin/upload-jobs/recover-now");
      const n = r?.recovered ?? 0;
      if (n > 0) {
        toast.success(`Re-kicked ${n} stuck upload job${n === 1 ? "" : "s"} — they'll re-run in the background.`);
      } else {
        toast.success("Nothing to recover right now — all jobs are healthy.");
      }
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Recovery failed");
    } finally {
      setRecovering(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const count = data?.count ?? 0;
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

  return (
    <Card
      icon={Inbox}
      title="Stuck uploads"
      subtitle="Upload jobs older than 10 min still queued/processing. Empty = healthy."
      testid="admin-stuck-uploads-card"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#5B5F4D]" data-testid="admin-stuck-uploads-count">
          {loading && !data
            ? "Loading…"
            : count === 0
              ? "✓ No stuck jobs — the recovery cron is keeping up."
              : `${count} job${count === 1 ? "" : "s"} stuck (>10 min)`}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-[#6B46C1] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
          data-testid="admin-stuck-uploads-refresh"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          refresh
        </button>
      </div>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3" data-testid="admin-stuck-uploads-error">
          {error}
        </div>
      )}
      {count > 0 && (
        <div className="space-y-1.5" data-testid="admin-stuck-uploads-list">
          {jobs.map((j) => {
            const age = j.age_minutes != null ? `${j.age_minutes} min` : "—";
            return (
              <div
                key={j.job_id}
                className="text-xs flex flex-col gap-1 px-3 py-2 rounded-lg border bg-[#FBE2E0] border-[#E8B5B0] text-[#7C2D2A]"
                data-testid={`admin-stuck-upload-${j.job_id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-[#C5564B]" aria-hidden="true" />
                  <code className="font-semibold">{j.job_id}</code>
                  <span className="text-[11px] opacity-80">· {j.status} · {age} old · {j.total} file{j.total === 1 ? "" : "s"}</span>
                  <span className="ml-auto text-[10px] text-[#6E6E6E]">user {j.user_id}</span>
                </div>
                {j.error && (
                  <p className="text-[11px] italic opacity-90 pl-4">{j.error}</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between mt-2 gap-2">
            <p className="text-[11px] text-[#7C2D2A] italic">
              Still recoverable — the 5-min cron re-kicks these as soon as
              Atlas / the staging disk recovers.  Persistent growth here
              means the cron itself is wedged or the staging volume is full.
            </p>
            <button
              type="button"
              onClick={recoverNow}
              disabled={recovering}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-[#7C2D2A] hover:bg-[#5C1F1D] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              data-testid="admin-stuck-uploads-recover-now"
            >
              {recovering ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              {recovering ? "Re-kicking…" : "Re-kick now"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// ClassifierReliabilityCard (2026-06-29)
// ---------------------------------------------------------------------------
// Operator-side aggregate health of the polish/classifier worker.  Reads
// from GET /api/admin/classifier/reliability?days=7 — which groups books
// stuck as `classifier:"polish-failed"` by error fingerprint and by
// polish_attempts.
//
// Three rows:
//   1. Headline totals — recent failures, currently stuck, "permanently"
//      stuck (≥3 attempts).  Single glance "is everything fine?".
//   2. Top error fingerprints — first 80 chars of polish_last_error,
//      lower-cased.  Shows where to start when tuning the classifier
//      prompt.  Pinpoints stuff like "12% of failures are 'invalid JSON
//      from Claude'" so you can fix the prompt vs. retrying.
//   3. By-attempt distribution — how many failed books are sitting at
//      1, 2, 3, 4, 5+ attempts.  Tells you whether retries actually help
//      (a flat or growing distribution at attempts ≥ 3 means the failure
//      mode is permanent — needs a code/prompt change, not more retries).
//
// All counts; no titles or PII.  Refreshes every 60s when the tab is
// visible (cheap aggregate, but no reason to thrash Mongo when the
// operator isn't looking).
// ---------------------------------------------------------------------------
function ClassifierReliabilityCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/classifier/reliability?days=7");
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load classifier reliability");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const t = data?.totals || {};
  const topErrors = Array.isArray(data?.top_errors) ? data.top_errors : [];
  const byAttempt = Array.isArray(data?.by_attempt) ? data.by_attempt : [];

  return (
    <Card
      icon={AlertTriangle}
      title="Classifier reliability"
      subtitle="Polish-worker fingerprints — last 7 days. Empty = healthy."
      testid="admin-classifier-reliability-card"
    >
      {loading && !data && (
        <p className="text-xs text-[#5B5F4D] py-3">Loading…</p>
      )}
      {error && (
        <p className="text-xs text-[#7C2D2A] py-3" data-testid="admin-classifier-reliability-error">
          ✗ {error}
        </p>
      )}
      {data && (
        <div className="space-y-4">
          {/* 1. Headline totals */}
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="admin-classifier-reliability-totals">
            <div className="rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] py-2 px-1">
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="admin-classifier-recent-failures">
                {t.recent_failures ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                last 7 days
              </p>
            </div>
            <div className="rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] py-2 px-1">
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="admin-classifier-currently-stuck">
                {t.currently_stuck ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                currently stuck
              </p>
            </div>
            <div className={`rounded-lg py-2 px-1 border ${(t.permanently_stuck || 0) > 0 ? "bg-[#FBE2E0] border-[#E8B5B0]" : "bg-[#FBFAF6] border-[#E5DDC5]"}`}>
              <p className={`font-serif text-2xl ${(t.permanently_stuck || 0) > 0 ? "text-[#7C2D2A]" : "text-[#2C2C2C]"}`} data-testid="admin-classifier-permanently-stuck">
                {t.permanently_stuck ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                ≥3 attempts
              </p>
            </div>
          </div>

          {/* 2. Top errors */}
          {topErrors.length > 0 && (
            <div data-testid="admin-classifier-top-errors">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#5B5F4D] mb-2">
                Top error fingerprints
              </p>
              <ul className="space-y-1.5">
                {topErrors.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-xs"
                    data-testid={`admin-classifier-error-${i}`}
                  >
                    <code className="font-mono text-[#7C2D2A] truncate" title={e.fingerprint}>
                      {e.fingerprint}
                    </code>
                    <span className="font-semibold text-[#2C2C2C] shrink-0">×{e.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3. By-attempt distribution */}
          {byAttempt.length > 0 && (
            <div data-testid="admin-classifier-by-attempt">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#5B5F4D] mb-2">
                By attempt # (currently stuck)
              </p>
              <div className="flex flex-wrap gap-2">
                {byAttempt.map((b) => (
                  <span
                    key={b.attempts}
                    className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-full bg-[#F0EBE2] border border-[#E5DDC5] text-xs"
                    data-testid={`admin-classifier-attempt-${b.attempts}`}
                  >
                    <span className="font-mono text-[#5B5F4D]">#{b.attempts}</span>
                    <span className="font-semibold text-[#2C2C2C]">{b.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(t.recent_failures === 0 && t.currently_stuck === 0) && (
            <p
              className="text-xs italic text-[#3D6B3D] pt-1"
              data-testid="admin-classifier-all-clear"
            >
              ✓ No polish failures in the last 7 days. Worker healthy.
            </p>
          )}
        </div>
      )}
    </Card>
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
      {/* 2026-06-27 — Watchdog summary table.  Shows the latest
          state of every automated kill-switch (AV / email-quota /
          canary) so the operator gets a one-glance answer to
          "is anything currently auto-paused?".  Surfaces last-check
          time, current state, the underlying flag, and the
          watchdog's own summary blurb.  Red row background when
          auto_paused === true so it pops on a busy admin page. */}
      {Array.isArray(health.watchdogs) && health.watchdogs.length > 0 && (
        <div className="mb-4" data-testid="admin-health-watchdogs">
          <div className="text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D] mb-1.5 font-semibold">
            Automated guardians
          </div>
          <div className="space-y-1.5">
            {health.watchdogs.map((w) => {
              const paused = w.auto_paused === true;
              const last = w.last_check
                ? new Date(w.last_check).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })
                : "—";
              return (
                <div
                  key={w.key}
                  className={`text-xs flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    paused
                      ? "bg-[#FBE2E0] border-[#E8B5B0] text-[#7C2D2A]"
                      : "bg-[#F4F8F0] border-[#D6E0CC] text-[#3A4A2E]"
                  }`}
                  data-testid={`admin-watchdog-${w.key}`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${paused ? "bg-[#C5564B]" : "bg-[#5C8A5C]"}`} aria-hidden="true" />
                  <span className="font-semibold shrink-0">{w.name}</span>
                  <span className="ml-auto text-[11px] text-[#5B5F4D] shrink-0">
                    {paused ? "🛑 auto-paused" : "✓ active"}
                  </span>
                  <span className="text-[11px] text-[#6E6E6E] shrink-0">· checked {last}</span>
                </div>
              );
            })}
            {health.watchdogs.some((w) => w.auto_paused) && (
              <p className="text-[11px] text-[#7C2D2A] italic mt-1">
                One or more guardians have auto-paused.  Re-enable manually
                from Feature flags after auditing the trigger.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4" data-testid="admin-health-collections">
        {Object.entries(health.collections || {}).map(([name, n]) => (
          <div key={name} className="text-xs bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
            <p className="text-[#5B5F4D] truncate">{name}</p>
            <p className="font-semibold text-[#2C2C2C]">{n.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="text-xs text-[#5B5F4D]" data-testid="admin-health-storage">
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
        <span className="self-center text-[#5B5F4D] hidden md:inline">→</span>
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
        <p className="text-xs text-[#5B5F4D] italic" data-testid="admin-aliases-empty">No global aliases yet.</p>
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
      <p className="text-xs text-[#5B5F4D] uppercase tracking-[0.15em]">{label}</p>
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
        <span>{title} <span className="text-[#5B5F4D] font-normal lowercase tracking-normal">({items.length})</span></span>
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
            className="text-[11px] italic text-[#5B5F4D] text-center pt-1"
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <ul className="space-y-1.5" data-testid="admin-flags-list">
          {Object.keys(known).map((key) => {
            const on = !!flags[key];
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-flag-row-${key}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C]"><code>{key}</code></p>
                  <p className="text-xs text-[#5B5F4D]">{known[key]}</p>
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#5B5F4D] italic" data-testid="admin-audit-empty">No audit entries yet.</p>
      ) : (
        <ul className="space-y-1" data-testid="admin-audit-list">
          {entries.map((e, i) => (
            <li key={e._id || `${e.actor_email}-${e.ts}-${i}`} className="text-xs px-2.5 py-1.5 rounded bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-audit-row-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span><strong>{e.action}</strong> by <span className="text-[#5B5F4D]">{e.actor_email}</span></span>
                <span className="text-[#5B5F4D] flex-shrink-0">{fmtTime(e.ts)}</span>
              </div>
              {(e.target || (e.metadata && Object.keys(e.metadata).length > 0)) && (
                <p className="text-[#5B5F4D] mt-0.5 truncate">
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
          <span className="ml-2 text-xs text-[#5B5F4D] font-normal">{r.count} book{r.count === 1 ? "" : "s"}</span>
          {isDismissed && <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D] font-bold">DISMISSED</span>}
        </p>
        {r.sample_book_ids?.length > 0 && (
          <p className="text-xs text-[#5B5F4D] truncate">
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
            className="text-xs px-3 py-1.5 rounded-lg text-[#5B5F4D] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
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
            className="text-xs px-3 py-1.5 rounded-lg text-[#5B5F4D] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
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
              <summary className="text-xs font-semibold text-[#5B5F4D] cursor-pointer hover:text-[#2C2C2C]">
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
// Crossover suggestions card (Phase-6 AI feedback loop)
// ---------------------------------------------------------------------------
// When the AI classifier returns a multi-fandom crossover the heuristic
// missed (e.g. AI says "Harry Potter / Twilight" but heuristic only saw
// Harry Potter), the backend logs the gap to `crossover_suggestions`.
// Admins triage here: enter the character names the heuristic should
// have caught, click Accept → keywords merge into the runtime overlay
// and the classifier picks them up within 60 s.
function CrossoverSuggestionsCard() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, rejected: 0 });
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  // Per-row keyword inputs: { dedup_key: { fandom: "kw1, kw2" } }
  const [kwInputs, setKwInputs] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/crossover-suggestions?status=${status}`);
      setRows(data?.suggestions || []);
      setCounts(data?.counts || { pending: 0, accepted: 0, rejected: 0 });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const onKwChange = (dk, fandom, value) => {
    setKwInputs((prev) => ({
      ...prev,
      [dk]: { ...(prev[dk] || {}), [fandom]: value },
    }));
  };

  const accept = async (row) => {
    const dk = row.dedup_key;
    const inputs = kwInputs[dk] || {};
    const keywords_by_fandom = {};
    for (const f of row.gap_fandoms || []) {
      const raw = (inputs[f] || "").trim();
      if (!raw) continue;
      keywords_by_fandom[f] = raw.split(",").map((k) => k.trim()).filter(Boolean);
    }
    if (Object.keys(keywords_by_fandom).length === 0) {
      toast.error("Add at least one character name for a gap fandom before accepting.");
      return;
    }
    setBusy(`accept:${dk}`);
    try {
      const { data } = await api.post(
        `/admin/crossover-suggestions/${encodeURIComponent(dk)}/accept`,
        { keywords_by_fandom },
      );
      const added = (data?.updated_overlays || []).reduce((n, o) => n + (o.added?.length || 0), 0);
      toast.success(`Added ${added} keyword${added === 1 ? "" : "s"} to the overlay`, { duration: 6000 });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't accept");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (row) => {
    const dk = row.dedup_key;
    if (!window.confirm(`Reject this crossover suggestion?\n\n${row.title || "(no title)"} — gap: ${(row.gap_fandoms || []).join(", ")}`)) return;
    setBusy(`reject:${dk}`);
    try {
      await api.post(`/admin/crossover-suggestions/${encodeURIComponent(dk)}/reject`);
      toast.success("Rejected");
      await load();
    } catch { toast.error("Couldn't reject"); }
    finally { setBusy(null); }
  };

  return (
    <Card
      icon={Sparkles}
      title="Crossover suggestions"
      subtitle="When the AI classifier detects a multi-fandom crossover the keyword scanner missed, those gaps are logged here. Add the character names the heuristic should have caught — they'll merge into the runtime overlay and the classifier will pick them up on the next upload."
      testid="admin-crossover-suggestions-card"
    >
      <div className="flex items-center gap-2 mb-3 text-xs" data-testid="admin-crossover-suggestions-tabs">
        {[
          { id: "pending",  label: `Pending (${counts.pending})` },
          { id: "accepted", label: `Accepted (${counts.accepted})` },
          { id: "rejected", label: `Rejected (${counts.rejected})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setStatus(t.id)}
            className={`px-2.5 py-1 rounded-full border transition-colors ${status === t.id ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#5B5F4D] border-[#E4D9C8] hover:bg-[#FDF3E1]"}`}
            data-testid={`admin-crossover-suggestions-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#6B46C1] inline-flex items-center gap-1.5" data-testid="admin-crossover-suggestions-empty">
          <Check className="w-4 h-4" /> No {status} suggestions.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="admin-crossover-suggestions-list">
          {rows.map((r) => {
            const dk = r.dedup_key;
            const isPending = r.status === "pending";
            return (
              <li
                key={dk}
                className="border border-[#E4D9C8] rounded-lg p-3 bg-[#FDF8F0]"
                data-testid={`admin-crossover-suggestions-row-${dk}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#2C2C2C] truncate" title={r.title}>{r.title || "(no title)"}</div>
                    <div className="text-xs text-[#5B5F4D] truncate" title={r.author}>by {r.author || "(no author)"}</div>
                    <div className="mt-1.5 text-xs text-[#5B5F4D]">
                      <span className="font-semibold">AI saw:</span> {(r.ai_fandoms || []).join(" / ") || "—"}{" · "}
                      <span className="font-semibold">Heuristic saw:</span> {(r.heuristic_fandoms || []).join(" / ") || "(none)"}{" · "}
                      <span className="font-semibold">Seen:</span> {r.sightings || 1}×
                    </div>
                  </div>
                  {isPending && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => accept(r)}
                        disabled={busy === `accept:${dk}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#6B46C1] text-white hover:bg-[#5B36B0] disabled:opacity-60"
                        data-testid={`admin-crossover-suggestions-accept-${dk}`}
                      >
                        {busy === `accept:${dk}` ? "Saving…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(r)}
                        disabled={busy === `reject:${dk}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[#E4D9C8] text-[#5B5F4D] hover:bg-[#FDF3E1] disabled:opacity-60"
                        data-testid={`admin-crossover-suggestions-reject-${dk}`}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {isPending && (r.gap_fandoms || []).length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-[#5B5F4D]">
                      Add character names for the missed fandom(s) — comma-separated. They&apos;ll be lowercased + deduped automatically.
                    </div>
                    {(r.gap_fandoms || []).map((f) => (
                      <div key={f} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#6B46C1] w-28 shrink-0 truncate" title={f}>{f}:</span>
                        <input
                          type="text"
                          value={(kwInputs[dk]?.[f]) || ""}
                          onChange={(e) => onKwChange(dk, f, e.target.value)}
                          placeholder="e.g. Bella, Edward Cullen, Renesmee"
                          className="flex-1 text-xs px-2 py-1.5 border border-[#E4D9C8] rounded focus:outline-none focus:border-[#6B46C1] bg-white"
                          data-testid={`admin-crossover-suggestions-input-${dk}-${f}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!isPending && r.accepted_keywords && Object.keys(r.accepted_keywords).length > 0 && (
                  <div className="mt-2 text-xs text-[#5B5F4D]">
                    <span className="font-semibold">Added:</span>{" "}
                    {Object.entries(r.accepted_keywords).map(([f, kws]) => `${f}: ${(kws || []).join(", ")}`).join(" · ")}
                  </div>
                )}

                {r.meta_snapshot?.description && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-[#5B5F4D] cursor-pointer hover:text-[#2C2C2C]">Show description / sample</summary>
                    <div className="mt-1 text-[11px] text-[#5B5F4D] whitespace-pre-wrap leading-relaxed">
                      {r.meta_snapshot.description}
                      {r.meta_snapshot.sample_text && (
                        <>{"\n\n— sample —\n"}{r.meta_snapshot.sample_text}</>
                      )}
                    </div>
                  </details>
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
// Email diagnostic card (operator one-shot send)

// ---------------------------------------------------------------------------
// Production canary card — 7-day uptime sparkline
// ---------------------------------------------------------------------------
// Data lands via the `prod-smoke-canary.yml` GitHub workflow which POSTs
// to `/api/canary/report` (gated by CANARY_REPORT_SECRET) on every nightly
// run.  Widget shows uptime %, last-run status, and a dot-grid sparkline
// of the last 7 days.  If nothing has reported yet, the card shows an
// onboarding hint instead of an empty chart.
function CanaryCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/admin/canary-runs?days=${days}`);
        if (!cancelled) setData(data);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const runs = data?.runs || [];
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const uptimePct = data?.uptime_pct;

  const fmtTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <Card
      icon={Activity}
      title="Production canary"
      subtitle="Nightly smoke-test run against the live production deploy. The GitHub workflow POSTs its result here on every run so you can see uptime at a glance."
      testid="admin-canary-card"
    >
      <div className="flex items-center gap-2 mb-3 text-xs" data-testid="admin-canary-tabs">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 rounded-full border transition-colors ${days === d ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#5B5F4D] border-[#E4D9C8] hover:bg-[#FDF3E1]"}`}
            data-testid={`admin-canary-tab-${d}d`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : !data?.configured && runs.length === 0 ? (
        <div className="text-sm text-[#5B5F4D] space-y-2" data-testid="admin-canary-onboarding">
          <p className="font-semibold text-[#2C2C2C]">No canary runs reported yet.</p>
          <p>To activate the widget, add these two secrets to your GitHub repo:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><code className="bg-[#FDF3E1] text-[#6B46C1] px-1 rounded text-[11px]">SHELFSORT_PROD_URL</code> — already required for the nightly canary itself</li>
            <li><code className="bg-[#FDF3E1] text-[#6B46C1] px-1 rounded text-[11px]">CANARY_REPORT_SECRET</code> — a fresh random string; also set <code className="bg-[#FDF3E1] text-[#6B46C1] px-1 rounded text-[11px]">CANARY_REPORT_SECRET</code> in <code className="bg-[#FDF3E1] text-[#6B46C1] px-1 rounded text-[11px]">backend/.env</code> on prod so the endpoint accepts the POST</li>
          </ul>
          <p>Next nightly run (03:00 UTC) will populate the chart.</p>
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-[#5B5F4D]" data-testid="admin-canary-empty">
          Configured, but no runs in the last {days} days yet. Trigger a manual run from the Actions tab to populate this.
        </p>
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="flex flex-wrap items-baseline gap-4 mb-3" data-testid="admin-canary-headline">
            <div>
              <div className="text-2xl font-bold text-[#2C2C2C] tabular-nums">
                {uptimePct == null ? "—" : `${uptimePct.toFixed(1)}%`}
              </div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D]">Uptime</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#2F6E60] tabular-nums">{data.pass_count}</div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D]">Passed</div>
            </div>
            <div>
              <div className={`text-2xl font-bold tabular-nums ${data.fail_count > 0 ? "text-[#C5564B]" : "text-[#5B5F4D]"}`}>
                {data.fail_count}
              </div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D]">Failed</div>
            </div>
            {lastRun && (
              <div className="ml-auto text-right" data-testid="admin-canary-last-run">
                <div className={`text-sm font-semibold ${lastRun.status === "pass" ? "text-[#2F6E60]" : "text-[#C5564B]"}`}>
                  {lastRun.status === "pass" ? "✓ Last run passed" : "✗ Last run failed"}
                </div>
                <div className="text-[10px] text-[#5B5F4D]">{fmtTime(lastRun.finished_at)}</div>
                {/* 2026-06-27 — Tiered cadence badge.  The retry
                    workflow (`prod-smoke-canary-retry.yml`) sets
                    retry=true on its report POST, so we can
                    distinguish *confirmed* failures (failed both the
                    primary run AND the 15-min retry — operator must
                    investigate) from *recovered* runs (primary
                    failed, retry passed — silent recovery).  This
                    badge turns the 15-min cadence into a visible
                    trust signal: "yep, we double-checked, this is
                    real" or "no panic, prod recovered itself". */}
                {lastRun.retry && lastRun.status === "fail" && (
                  <div
                    className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FBE7E4] text-[#C5564B] border border-[#C5564B]/30"
                    title="The primary canary failed AND the 15-min auto-retry also failed — this is a real production issue, not a transient blip."
                    data-testid="admin-canary-confirmed-badge"
                  >
                    Confirmed by retry · 15 min
                  </div>
                )}
                {lastRun.retry && lastRun.status === "pass" && (
                  <div
                    className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#E4F4EE] text-[#2F6E60] border border-[#3D8B79]/30"
                    title="The primary canary failed but the 15-min auto-retry passed — prod recovered itself, no action needed."
                    data-testid="admin-canary-recovered-badge"
                  >
                    Recovered via retry · 15 min
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sparkline — one dot per run, oldest left, status-colored */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3" data-testid="admin-canary-sparkline">
            {runs.map((r) => (
              <span
                key={r.run_id}
                title={`${r.status === "pass" ? "✓" : "✗"} ${fmtTime(r.finished_at)} — ${r.passed}/${r.total} (${r.duration_s != null ? `${r.duration_s}s` : "?"})`}
                className={`w-3 h-3 rounded-sm ${r.status === "pass" ? "bg-[#3D8B79]" : "bg-[#C5564B]"}`}
                data-testid={`admin-canary-dot-${r.run_id}`}
              />
            ))}
          </div>

          {/* Last 5 runs table — text fallback for the colorblind */}
          <details className="text-xs" data-testid="admin-canary-recent-details">
            <summary className="cursor-pointer text-[#5B5F4D] hover:text-[#2C2C2C] font-semibold">
              Last {Math.min(5, runs.length)} run{runs.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1" data-testid="admin-canary-recent-list">
              {[...runs].reverse().slice(0, 5).map((r) => (
                <li
                  key={r.run_id}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-[#FDF8F0] border border-[#E4D9C8]"
                  data-testid={`admin-canary-row-${r.run_id}`}
                >
                  <span className={`w-2 h-2 rounded-full ${r.status === "pass" ? "bg-[#3D8B79]" : "bg-[#C5564B]"}`} />
                  <span className="text-[#2C2C2C] font-semibold">{r.status.toUpperCase()}</span>
                  {r.retry && (
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wider text-[#6B46C1] bg-[#F0EAFE] px-1 rounded"
                      title="15-min auto-retry run"
                      data-testid={`admin-canary-row-retry-${r.run_id}`}
                    >
                      retry
                    </span>
                  )}
                  <span className="text-[#5B5F4D]">{fmtTime(r.finished_at)}</span>
                  <span className="text-[#5B5F4D] ml-auto tabular-nums">{r.passed}/{r.total}</span>
                  {r.duration_s != null && <span className="text-[#5B5F4D] tabular-nums">{Math.round(r.duration_s)}s</span>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Card>
  );
}


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
          <legend className="text-xs font-semibold uppercase tracking-wider text-[#5B5F4D] mb-1">Recipient</legend>
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
          <label className="text-xs font-semibold uppercase tracking-wider text-[#5B5F4D] mb-1 block">
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
          <p className="text-xs text-[#5B5F4D] mt-1">{note.length}/200</p>
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
                <code className="ml-1 text-[10px] text-[#5B5F4D] font-mono">#{lastResult.id.slice(0, 8)}</code>
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
        <p className="text-sm text-[#5B5F4D]">Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-[#5B5F4D]">
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
                <p className="text-xs text-[#5B5F4D] truncate mt-0.5">
                  <span className="italic">{r.book_title || "(no book)"}</span>
                  {r.book_author ? <span> · {r.book_author}</span> : null}
                </p>
                <p className="text-xs text-[#5B5F4D] mt-1">
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
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {rooms.length === 0 ? (
            <p className="text-sm text-[#5B5F4D] italic mb-4" data-testid="admin-chat-rooms-empty">
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
                          <p className="text-[11px] text-[#5B5F4D]">
                            {r.member_user_ids.length} member{r.member_user_ids.length === 1 ? "" : "s"}
                            {r.last_message_at ? ` · last active ${fmtTime(r.last_message_at)}` : " · no messages yet"}
                          </p>
                          <p className="text-[10px] text-[#5B5F4D] truncate mt-0.5">
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
          <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="admin-chat-room-create-form">
            <p className="text-xs font-bold uppercase tracking-wider text-[#6B46C1] mb-2">Create a new room</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name (e.g. Beta readers)"
              data-testid="admin-chat-room-new-name"
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5] bg-white mb-2"
            />
            <p className="text-[10px] uppercase tracking-wider text-[#5B5F4D] mb-1">Members</p>
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
          <p className="text-xs text-[#5B5F4D] mt-1">
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
            <p className="text-xs text-[#5B5F4D]">No runs recorded yet.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-auto" data-testid={`cron-history-${job.id}`}>
              {job.recent.map((r, idx) => (
                <li key={r.started_at || `cron-run-${idx}`} className="text-xs flex items-start gap-2 font-mono">
                  <span className={r.status === "ok" ? "text-[#6B46C1]" : "text-red-700"}>
                    {r.status === "ok" ? "✓" : "✗"}
                  </span>
                  <span className="text-[#5B5F4D] flex-shrink-0">{fmtTime(r.started_at)}</span>
                  <span className="text-[#5B5F4D] flex-shrink-0">{r.duration_ms ?? "?"}ms</span>
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
        <p className="text-xs text-[#5B5F4D]">
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
      {loading && !data && <p className="text-sm text-[#5B5F4D]">Loading…</p>}
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
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5B5F4D]" />
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
        <p className="text-xs text-[#5B5F4D]">
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
      {loading && !data && <p className="text-sm text-[#5B5F4D]">Loading…</p>}
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
                <span className="text-xs text-[#5B5F4D]">
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
                      {r.doc && <span className="text-[#5B5F4D] italic font-sans">— {r.doc}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-sm text-[#5B5F4D]" data-testid="route-catalogue-empty">
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
// QuotaGauges — Resend plan usage bars (used inside EmailStatsCard).
// ---------------------------------------------------------------------------
// Two-bar layout: rolling 24h vs the daily plan limit, and rolling 30d
// vs the monthly plan limit.  Plan limits come from the backend (env
// vars on the backend pod) so upgrading from free → paid is a single
// .env tweak with zero code change.  Bar tint shifts amber at ≥ 75 %
// and red at ≥ 90 %, with an inline call-to-upgrade hint at red.
function QuotaGauges({ quota }) {
  const { used_today, used_month, daily_limit, monthly_limit } = quota;
  const dayPct   = daily_limit   > 0 ? Math.min(100, Math.round((used_today / daily_limit)   * 100)) : 0;
  const monthPct = monthly_limit > 0 ? Math.min(100, Math.round((used_month / monthly_limit) * 100)) : 0;
  const tint = (p) =>
    p >= 90 ? { bar: "bg-red-600",  rail: "bg-red-100",   text: "text-red-700"   } :
    p >= 75 ? { bar: "bg-amber-500",rail: "bg-amber-100", text: "text-amber-700" } :
              { bar: "bg-[#6B46C1]",rail: "bg-[#EEE9FB]", text: "text-[#6B46C1]" };
  const dayT   = tint(dayPct);
  const monthT = tint(monthPct);
  const showUpgrade = dayPct >= 90 || monthPct >= 90;

  return (
    <div className="mb-4 p-3 rounded-xl border border-[#E5DDC5] bg-[#FBFAF6]" data-testid="email-quota-gauges">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">Resend plan usage</p>
        {showUpgrade && (
          <a
            href="https://resend.com/settings/billing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-red-700 hover:underline"
            data-testid="email-quota-upgrade-link"
          >
            Upgrade plan →
          </a>
        )}
      </div>

      <div className="space-y-2" data-testid="email-quota-bars">
        <Gauge label="Today" used={used_today} limit={daily_limit}   pct={dayPct}   tint={dayT}   testid="email-quota-daily" />
        <Gauge label="Month" used={used_month} limit={monthly_limit} pct={monthPct} tint={monthT} testid="email-quota-monthly" />
      </div>
    </div>
  );
}

function Gauge({ label, used, limit, pct, tint, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="text-[#5B5F4D]">{label}</span>
        <span className={`font-mono ${tint.text}`}>
          {used.toLocaleString()} / {limit.toLocaleString()} <span className="text-[#5B5F4D]">({pct}%)</span>
        </span>
      </div>
      <div className={`h-1.5 w-full rounded-full overflow-hidden ${tint.rail}`}>
        <div className={`h-full ${tint.bar} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Admin alert email frequency (2026-06-22) — Resend quota brake.
// Backed by GET/PUT /api/admin/email-mode which toggles the
// ``cron_failure_alerts`` and ``cron_alerts_weekly_batch`` flags
// under the hood.  Three radios so the operator doesn't have to
// reason about two-flag combinations.
// ---------------------------------------------------------------------------
function AdminEmailModeCard() {
  const [mode, setMode] = useState(null); // null = loading
  const [lastDigest, setLastDigest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/email-mode");
      setMode(data?.mode || "weekly_batch");
      setLastDigest(data?.last_digest || null);
    } catch {
      setMode("weekly_batch");
    }
  };
  useEffect(() => { load(); }, []);

  const setModeRemote = async (next) => {
    if (next === mode) return;
    setBusy(true);
    const prev = mode;
    setMode(next); // optimistic
    try {
      await api.put("/admin/email-mode", { mode: next });
      const label = { immediate: "Immediate emails", weekly_batch: "Weekly digest", off: "In-app only" }[next];
      toast.success(`Admin alerts → ${label}`);
    } catch {
      setMode(prev);
      toast.error("Couldn't update mode");
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/pending-alerts/send-digest-now");
      if (data?.sent) {
        toast.success(`Digest sent · ${data?.recipients ?? 0} recipient(s), ${data?.alerts ?? 0} alert(s)`);
        load();
      } else {
        toast(`Digest skipped: ${data?.reason || "no_change"}`);
      }
    } catch {
      toast.error("Couldn't send digest");
    } finally { setBusy(false); }
  };

  const options = [
    {
      key: "weekly_batch",
      title: "Weekly digest (default)",
      sub: "One email per real admin, every Sunday 09:00 UTC. Burst-bypass if >10 alerts in 24 h.",
    },
    {
      key: "immediate",
      title: "Immediate emails",
      sub: "Every cron failure fans out an email (debounced 60 min/job). Old behaviour — quota-heavy.",
    },
    {
      key: "off",
      title: "In-app only",
      sub: "Never email admins about cron failures. Bell card below still shows them.",
    },
  ];

  return (
    <Card icon={Bell} title="Admin alert email frequency" subtitle="How often the platform pages you about cron failures and admin signals." testid="admin-email-mode-card">
      {mode === null ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <div className="space-y-3" data-testid="admin-email-mode-options">
          {options.map((o) => {
            const active = mode === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setModeRemote(o.key)}
                disabled={busy}
                data-testid={`admin-email-mode-${o.key}`}
                className={`w-full text-left px-3 py-3 rounded-xl border-2 transition-colors ${
                  active
                    ? "border-[#6B46C1] bg-[#EEE9FB]"
                    : "border-[#E5DDC5] bg-[#FBFAF6] hover:border-[#C9BFAE]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${active ? "border-[#6B46C1] bg-[#6B46C1]" : "border-[#9b9b9b]"}`}>
                    {active && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#2C2C2C]">{o.title}</p>
                    <p className="text-xs text-[#5B5F4D] mt-0.5">{o.sub}</p>
                  </div>
                </div>
              </button>
            );
          })}
          <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#E5DDC5] gap-2 flex-wrap">
            <div className="text-xs text-[#5B5F4D]">
              {lastDigest ? (
                <>Last digest: <span className="font-mono">{new Date(lastDigest.sent_at).toLocaleString()}</span> · {lastDigest.ok}/{(lastDigest.ok ?? 0) + (lastDigest.errors ?? 0)} delivered</>
              ) : (
                <>No digest sent yet.</>
              )}
            </div>
            <button
              type="button"
              onClick={sendNow}
              disabled={busy}
              data-testid="admin-email-mode-send-now"
              className="text-xs px-3 py-1.5 rounded-full bg-[#6B46C1] text-white hover:bg-[#5a3aa3] disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send digest now
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Pending admin alerts (bell list) — companion to AdminEmailModeCard.
// Shows what's queued for the next digest so the operator can act on
// individual items without waiting for Sunday.
// ---------------------------------------------------------------------------
function AdminPendingAlertsCard() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/pending-alerts");
      setRows(Array.isArray(data?.alerts) ? data.alerts : []);
    } catch {
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);

  const dismissOne = async (id) => {
    setBusy(id);
    try {
      await api.post("/admin/pending-alerts/dismiss", { alert_id: id });
      setRows((r) => (r || []).filter((x) => x.alert_id !== id));
    } catch {
      toast.error("Couldn't dismiss");
    } finally { setBusy(null); }
  };

  const dismissAll = async () => {
    if (!window.confirm(`Dismiss all ${(rows || []).length} pending alert(s)? They'll still appear in the next digest history.`)) return;
    setBusy("ALL");
    try {
      const { data } = await api.post("/admin/pending-alerts/dismiss", {});
      toast.success(`Dismissed ${data?.dismissed ?? 0}`);
      setRows([]);
    } catch {
      toast.error("Couldn't dismiss");
    } finally { setBusy(null); }
  };

  return (
    <Card icon={Bell} title="Admin bell · pending alerts" subtitle="In-app queue replacing per-failure emails. Drained by the weekly digest cron." testid="admin-pending-alerts-card">
      {rows === null ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#1F8F4E] italic" data-testid="admin-pending-alerts-empty">
          <Check className="inline w-4 h-4 mr-1" />
          No pending alerts — quiet right now.
        </p>
      ) : (
        <div className="space-y-2" data-testid="admin-pending-alerts-list">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-[#2C2C2C]">
              {rows.length} pending · queued for next digest
            </p>
            <button
              type="button"
              onClick={dismissAll}
              disabled={busy !== null}
              data-testid="admin-pending-alerts-dismiss-all"
              className="text-xs px-3 py-1 rounded-full border border-[#E5DDC5] hover:bg-[#FBE9E7] text-[#9B3531] disabled:opacity-50"
            >
              Dismiss all
            </button>
          </div>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.alert_id}
                data-testid={`admin-pending-alert-${r.alert_id}`}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${
                  r.severity === "critical" ? "border-[#D9534F] bg-[#FBE9E7]" : "border-[#E5DDC5] bg-[#FBFAF6]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">{r.title}</p>
                  <p className="text-xs text-[#5B5F4D] mt-0.5 line-clamp-2">{r.body}</p>
                  <p className="text-[11px] text-[#6E6E6E] mt-1 font-mono">
                    {r.kind} · {r.count > 1 ? `×${r.count} · ` : ""}{new Date(r.last_seen_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissOne(r.alert_id)}
                  disabled={busy === r.alert_id}
                  data-testid={`admin-pending-alert-dismiss-${r.alert_id}`}
                  className="flex-shrink-0 p-1 rounded hover:bg-[#E5DDC5] disabled:opacity-50"
                  title="Dismiss"
                >
                  {busy === r.alert_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XIcon className="w-4 h-4 text-[#5B5F4D]" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}




// ---------------------------------------------------------------------------
// Email volume forecast (2026-06-22) — Resend cliff warning.
// Backed by GET /api/admin/email-volume-forecast.  Shows past 7/30-day
// volume + a forward projection so the operator sees a quota cliff
// before they hit it.

// ---------------------------------------------------------------------------
// Hidden features inventory (2026-06-22) — what's *built but invisible*.
// Backed by GET /api/admin/hidden-features.  Reads both the client-side
// ``featureFlags.js`` constants (parsed live) and the backend feature_flags
// collection so the operator sees the effective state at a glance and
// doesn't accidentally rebuild work that already exists behind a flag.
// ---------------------------------------------------------------------------
function HiddenFeaturesCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: payload } = await api.get("/admin/hidden-features");
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setData({ error: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (data === null) {
    return (
      <Card icon={EyeOff} title="Hidden features" subtitle="Built-but-invisible work parked behind feature flags." testid="hidden-features-card">
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      </Card>
    );
  }
  if (data.error) {
    return (
      <Card icon={EyeOff} title="Hidden features" subtitle="Built-but-invisible work parked behind feature flags." testid="hidden-features-card">
        <p className="text-sm text-[#D9534F]">Couldn&rsquo;t load — check backend logs.</p>
      </Card>
    );
  }

  const stateLabel = {
    hidden:  { txt: "Hidden",   cls: "bg-[#EEF7E9] text-[#1F8F4E] border-[#82C99E]" },
    partial: { txt: "Partial",  cls: "bg-[#FDF3E1] text-[#B87A00] border-[#B87A00]" },
    visible: { txt: "Visible",  cls: "bg-[#EEE9FB] text-[#6B46C1] border-[#6B46C1]" },
  };

  return (
    <Card icon={EyeOff} title="Hidden features" subtitle="Built-but-invisible work parked behind feature flags." testid="hidden-features-card">
      <p className="text-xs text-[#5B5F4D] mb-3">
        Code stays in place when a feature is hidden — flip both the client-side constant in <code>{data.client_file?.replace("/app/frontend/src", "src")}</code> <em>and</em> the backend flag to bring it back.
      </p>
      <div className="flex gap-3 mb-4 text-xs">
        <span className="px-2 py-1 rounded-full bg-[#EEF7E9] text-[#1F8F4E] border border-[#82C99E]" data-testid="hidden-features-summary">
          {data.hidden_count} hidden
        </span>
        {data.partial_count > 0 && (
          <span className="px-2 py-1 rounded-full bg-[#FDF3E1] text-[#B87A00] border border-[#B87A00]">
            {data.partial_count} partial
          </span>
        )}
        {data.visible_count > 0 && (
          <span className="px-2 py-1 rounded-full bg-[#EEE9FB] text-[#6B46C1] border border-[#6B46C1]">
            {data.visible_count} visible
          </span>
        )}
      </div>
      <ul className="space-y-3" data-testid="hidden-features-list">
        {(data.features || []).map((f) => {
          const s = stateLabel[f.effective] || stateLabel.hidden;
          return (
            <li
              key={f.id}
              data-testid={`hidden-feature-${f.id}`}
              className="p-3 rounded-xl border border-[#E5DDC5] bg-[#FBFAF6]"
            >
              <div className="flex items-start gap-2 mb-1">
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.cls}`}>
                  {s.txt}
                </span>
                <h4 className="text-sm font-semibold text-[#2C2C2C] flex-1">{f.name}</h4>
              </div>
              <p className="text-xs text-[#5B5F4D] mb-2">{f.reason}</p>

              <div className="text-[11px] font-mono text-[#5B5F4D] mb-2">
                <span className="mr-3">
                  Client: <strong className={f.client_on ? "text-[#1F8F4E]" : "text-[#6E6E6E]"}>{f.client_flag}={String(f.client_on)}</strong>
                </span>
                {f.server_flag && (
                  <span>
                    Server: <strong className={f.server_on ? "text-[#1F8F4E]" : "text-[#6E6E6E]"}>{f.server_flag}={String(f.server_on)}</strong>
                  </span>
                )}
              </div>

              <details className="text-xs text-[#5B5F4D]">
                <summary className="cursor-pointer hover:text-[#2C2C2C]">
                  {f.surfaces.length} hidden surface{f.surfaces.length === 1 ? "" : "s"} · how to bring it back
                </summary>
                <p className="font-semibold text-[#2C2C2C] mt-2 mb-1">Surfaces currently hidden:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {f.surfaces.map((sf) => <li key={sf}>{sf}</li>)}
                </ul>
                <p className="font-semibold text-[#2C2C2C] mt-3 mb-1">To bring it back:</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  {f.rehydrate.map((step, i) => (
                    <li key={i} dangerouslySetInnerHTML={{
                      __html: step.replace(/``([^`]+)``/g, "<code>$1</code>"),
                    }} />
                  ))}
                </ol>
              </details>
            </li>
          );
        })}
        {(data.features || []).length === 0 && (
          <li className="text-sm text-[#5B5F4D] italic">No hidden features registered.</li>
        )}
      </ul>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Recent changelog (2026-06-22) — last 20 entries from CHANGELOG.md.
// Backed by GET /api/admin/changelog. Lets the operator see what's
// shipped recently without opening the repo. Each entry is collapsed
// by default; click to expand the body of that dated section.
// ---------------------------------------------------------------------------
function ChangelogCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: payload } = await api.get("/admin/changelog", { params: { limit: 20 } });
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setData({ error: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (data === null) {
    return (
      <Card icon={History} title="Recent changelog" subtitle="Last 20 dated entries from CHANGELOG.md." testid="admin-changelog-card">
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      </Card>
    );
  }
  if (data.error) {
    return (
      <Card icon={History} title="Recent changelog" subtitle="Last 20 dated entries from CHANGELOG.md." testid="admin-changelog-card">
        <p className="text-sm text-[#D9534F]">Couldn&rsquo;t load — check backend logs.</p>
      </Card>
    );
  }

  const entries = data.entries || [];

  return (
    <Card icon={History} title="Recent changelog" subtitle="Last 20 dated entries from CHANGELOG.md." testid="admin-changelog-card">
      <p className="text-xs text-[#5B5F4D] mb-3">
        Showing <strong data-testid="admin-changelog-returned">{data.returned}</strong> of{" "}
        <strong data-testid="admin-changelog-total">{data.total_in_file}</strong> total entries from{" "}
        <code className="text-[11px]">{(data.path || "").replace("/app/", "")}</code>.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-[#5B5F4D] italic">No entries yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="admin-changelog-list">
          {entries.map((e, i) => (
            <li
              key={`${e.date}-${e.slug}-${i}`}
              data-testid={`admin-changelog-entry-${i}`}
              className="p-3 rounded-xl border border-[#E5DDC5] bg-[#FBFAF6]"
            >
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border bg-[#EEE9FB] text-[#6B46C1] border-[#6B46C1]/30 shrink-0 mt-0.5">
                      {e.date}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-[#2C2C2C] leading-snug">{e.title}</h4>
                      {e.slug && (
                        <p className="text-[11px] font-mono text-[#5B5F4D] truncate">({e.slug}) · {e.lines} line{e.lines === 1 ? "" : "s"}</p>
                      )}
                    </div>
                    <ChevronDown className="w-4 h-4 text-[#6E6E6E] shrink-0 mt-1" />
                  </div>
                </summary>
                <pre className="mt-3 text-[11px] leading-relaxed text-[#2C2C2C] whitespace-pre-wrap font-sans bg-white border border-[#E5DDC5] rounded-lg p-3 max-h-80 overflow-auto">
                  {e.body || "(empty)"}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// LLM key health (2026-06-22) — Universal Key burn rate + runway.
// Backed by GET /api/admin/llm-key-health and PUT
// /api/admin/llm-key-health/balance. Emergent doesn't expose a
// programmatic balance read, so the operator types in what they
// see in Profile → Universal Key settings; the card combines that
// with self-instrumented call logs + pre-existing book proxies
// (classifier='ai', cover_source='ai_generated') to estimate
// days-of-runway and surface a warning before silent failures.
// ---------------------------------------------------------------------------
function LlmKeyHealthCard() {
  const [data, setData] = useState(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data: payload } = await api.get("/admin/llm-key-health");
      setData(payload);
      if (payload?.balance?.usd != null) {
        setBalanceInput(String(payload.balance.usd));
      }
    } catch {
      setData({ error: true });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: payload } = await api.get("/admin/llm-key-health");
        if (cancelled) return;
        setData(payload);
        if (payload?.balance?.usd != null) {
          setBalanceInput(String(payload.balance.usd));
        }
      } catch {
        if (!cancelled) setData({ error: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSaveBalance = async () => {
    const usd = parseFloat(balanceInput);
    if (!Number.isFinite(usd) || usd < 0) {
      toast.error("Enter a non-negative number (USD).");
      return;
    }
    setSaving(true);
    try {
      await api.put("/admin/llm-key-health/balance", { usd });
      toast.success("Balance updated.");
      await load();
    } catch {
      toast.error("Couldn't save — check backend logs.");
    } finally {
      setSaving(false);
    }
  };

  if (data === null) {
    return (
      <Card icon={Sparkles} title="LLM key health" subtitle="Universal Key balance + 7-day burn rate + days of runway." testid="admin-llm-key-health-card">
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      </Card>
    );
  }
  if (data.error) {
    return (
      <Card icon={Sparkles} title="LLM key health" subtitle="Universal Key balance + 7-day burn rate + days of runway." testid="admin-llm-key-health-card">
        <p className="text-sm text-[#D9534F]">Couldn&rsquo;t load — check backend logs.</p>
      </Card>
    );
  }

  const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(4)}`;
  const fmtUsdShort = (n) => `$${(Number(n) || 0).toFixed(2)}`;

  const instr7 = data.instrumented?.last_7_days?.totals || {};
  const instr30 = data.instrumented?.last_30_days?.totals || {};
  const proxy7 = data.proxy?.last_7_days || {};
  const proxy30 = data.proxy?.last_30_days || {};
  const runway = data.runway || {};
  const balance = data.balance || {};
  const byKind = data.instrumented?.last_7_days?.by_kind || [];

  const warnStyle = {
    ok:       { txt: "OK",       cls: "bg-[#EEF7E9] text-[#1F8F4E] border-[#82C99E]" },
    warning:  { txt: "Top up",   cls: "bg-[#FDF3E1] text-[#B87A00] border-[#B87A00]" },
    critical: { txt: "Critical", cls: "bg-[#FBE9E9] text-[#D9534F] border-[#D9534F]" },
    unknown:  { txt: "No data",  cls: "bg-[#F1F1F0] text-[#5B5F4D] border-[#9b9b9b]" },
  }[runway.warning_level || "unknown"];

  return (
    <Card icon={Sparkles} title="LLM key health" subtitle="Universal Key balance + 7-day burn rate + days of runway." testid="admin-llm-key-health-card">
      <p className="text-xs text-[#5B5F4D] mb-3">
        Emergent doesn&rsquo;t expose a balance API, so type in what you see at{" "}
        <strong>Profile → Universal Key</strong> below. The card combines it with
        self-instrumented call logs + pre-existing book proxies (<code>classifier=&quot;ai&quot;</code>,{" "}
        <code>cover_source=&quot;ai_generated&quot;</code>) to estimate runway.
      </p>

      {/* Runway / warning banner */}
      <div
        className={`p-3 mb-4 rounded-xl border ${warnStyle.cls}`}
        data-testid="llm-key-runway-banner"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold">{warnStyle.txt}</p>
            <p className="text-2xl font-serif font-semibold mt-0.5" data-testid="llm-key-days-remaining">
              {runway.days_remaining != null ? `${runway.days_remaining} days runway` : "Set balance to estimate runway"}
            </p>
          </div>
          <div className="text-right text-[11px]">
            <p>Daily avg (max of instrumented + proxy):</p>
            <p className="font-mono text-sm" data-testid="llm-key-daily-avg">{fmtUsd(runway.daily_avg_usd)}</p>
          </div>
        </div>
      </div>

      {/* 3 KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
        <div className="p-3 rounded-xl bg-[#EEE9FB] border border-[#6B46C1]/30" data-testid="llm-key-instr-7d">
          <p className="text-[10px] uppercase tracking-wider text-[#6B46C1] font-bold mb-1">Instrumented · 7d</p>
          <p className="font-mono text-lg text-[#2C2C2C]">{fmtUsd(instr7.cost_usd)}</p>
          <p className="text-[10px] text-[#5B5F4D] mt-1">{instr7.calls || 0} calls · {instr7.errors || 0} errors</p>
        </div>
        <div className="p-3 rounded-xl bg-[#FBF6E9] border border-[#B87A00]/30" data-testid="llm-key-proxy-7d">
          <p className="text-[10px] uppercase tracking-wider text-[#B87A00] font-bold mb-1">Proxy · 7d</p>
          <p className="font-mono text-lg text-[#2C2C2C]">{fmtUsd(proxy7.cost_usd_estimate)}</p>
          <p className="text-[10px] text-[#5B5F4D] mt-1">{proxy7.classifies || 0} classifies · {proxy7.covers || 0} covers</p>
        </div>
        <div className="p-3 rounded-xl bg-[#EEF7E9] border border-[#82C99E]" data-testid="llm-key-balance-display">
          <p className="text-[10px] uppercase tracking-wider text-[#1F8F4E] font-bold mb-1">Balance</p>
          <p className="font-mono text-lg text-[#2C2C2C]">{fmtUsdShort(balance.usd)}</p>
          <p className="text-[10px] text-[#5B5F4D] mt-1">
            {balance.set ? `Set ${fmtTime(balance.updated_at)}` : "Not set yet"}
          </p>
        </div>
      </div>

      {/* Balance setter */}
      <div className="p-3 mb-4 rounded-xl bg-[#FBFAF6] border border-[#E5DDC5]">
        <label htmlFor="llm-key-balance-input" className="block text-[10px] uppercase tracking-wider font-bold text-[#5B5F4D] mb-1">
          Update current balance (USD)
        </label>
        <div className="flex gap-2">
          <input
            id="llm-key-balance-input"
            data-testid="llm-key-balance-input"
            type="number"
            step="0.01"
            min="0"
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
            placeholder="e.g. 4.85"
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-[#E5DDC5] focus:outline-none focus:border-[#6B46C1] font-mono"
          />
          <button
            data-testid="llm-key-balance-save"
            onClick={onSaveBalance}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded-lg bg-[#6B46C1] text-white hover:bg-[#5a3aa3] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="text-[10px] text-[#6E6E6E] mt-1">
          Copy this from Profile → Universal Key. You can also enable auto-recharge there.
        </p>
      </div>

      {/* Per-kind table (instrumented only) */}
      {byKind.length > 0 ? (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider font-bold text-[#5B5F4D] mb-2">
            Instrumented 7d · by kind
          </p>
          <table className="w-full text-xs" data-testid="llm-key-by-kind-table">
            <thead>
              <tr className="text-left text-[#6E6E6E] border-b border-[#E5DDC5]">
                <th className="py-1">Kind</th>
                <th className="py-1 text-right">Calls</th>
                <th className="py-1 text-right">Errors</th>
                <th className="py-1 text-right">Tok in / out</th>
                <th className="py-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {byKind.map((k) => (
                <tr key={k.kind} className="border-b border-[#F1F1F0]" data-testid={`llm-key-kind-${k.kind}`}>
                  <td className="py-1 text-[#2C2C2C]">{k.kind}</td>
                  <td className="py-1 text-right">{k.calls}</td>
                  <td className={`py-1 text-right ${k.errors > 0 ? "text-[#D9534F]" : "text-[#6E6E6E]"}`}>{k.errors}</td>
                  <td className="py-1 text-right text-[#5B5F4D]">{k.tokens_in}/{k.tokens_out}{k.images ? ` · ${k.images}img` : ""}</td>
                  <td className="py-1 text-right text-[#2C2C2C]">{fmtUsd(k.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-[#6E6E6E] italic mb-3">
          No instrumented calls yet in the last 7 days — data fills in as Claude / Nano-Banana fire.
        </p>
      )}

      <details className="text-[11px] text-[#5B5F4D]">
        <summary className="cursor-pointer hover:text-[#2C2C2C]">Pricing constants &amp; 30-day rollup</summary>
        <div className="mt-2 space-y-1 font-mono">
          <p>Claude in: ${data.pricing_constants?.claude_in_per_million}/1M · out: ${data.pricing_constants?.claude_out_per_million}/1M</p>
          <p>Nano-Banana: ${data.pricing_constants?.nano_banana_per_image}/image</p>
          <p>Proxy fallback: classify ${data.pricing_constants?.proxy_classify_per_call} · cover ${data.pricing_constants?.proxy_cover_per_call} per call</p>
          <p className="pt-2">30d instrumented: {instr30.calls || 0} calls · {fmtUsd(instr30.cost_usd)} · {instr30.errors || 0} errors</p>
          <p>30d proxy: {proxy30.classifies || 0} classifies · {proxy30.covers || 0} covers · {fmtUsd(proxy30.cost_usd_estimate)}</p>
        </div>
      </details>
    </Card>
  );
}


// ---------------------------------------------------------------------------
function EmailVolumeForecastCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: payload } = await api.get("/admin/email-volume-forecast");
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setData({ error: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

  if (data === null) {
    return (
      <Card icon={TrendingUp} title="Email volume forecast" subtitle="Past sends + projected next 7/30 days vs the Resend daily cap." testid="email-volume-forecast-card">
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      </Card>
    );
  }
  if (data.error) {
    return (
      <Card icon={TrendingUp} title="Email volume forecast" subtitle="Past sends + projected next 7/30 days vs the Resend daily cap." testid="email-volume-forecast-card">
        <p className="text-sm text-[#D9534F]">Couldn&rsquo;t load the forecast — check backend logs.</p>
      </Card>
    );
  }

  const warnColor = {
    critical: "text-[#9B3531] bg-[#FBE9E7] border-[#D9534F]",
    warning:  "text-[#B87A00] bg-[#FDF3E1] border-[#B87A00]",
    ok:       "text-[#1F8F4E] bg-[#EEF7E9] border-[#82C99E]",
  }[data.warning_level] || "text-[#5B5F4D] bg-[#FBFAF6] border-[#E5DDC5]";

  const warnLabel = {
    critical: "⚠️  Critical — forecast exceeds daily cap",
    warning:  "⚠  Warning — forecast > 70% of daily cap",
    ok:       "✓ Healthy — well below the cap",
  }[data.warning_level] || "—";

  // Past-7d bars: kind buckets sorted by total desc
  const pastKinds = Object.entries(data.past_7d?.by_kind || {})
    .map(([k, v]) => ({ kind: k, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const maxPast = Math.max(1, ...pastKinds.map((k) => k.total));

  return (
    <Card icon={TrendingUp} title="Email volume forecast" subtitle="Past sends + projected next 7/30 days vs the Resend daily cap." testid="email-volume-forecast-card">
      <div className={`mb-4 p-3 rounded-xl border-2 text-sm font-semibold ${warnColor}`} data-testid="email-volume-warning">
        {warnLabel}
        <div className="text-xs mt-1 font-normal opacity-90">
          Cap: <strong>{data.daily_cap}/day</strong> · Past 7d daily avg: <strong>{data.daily_avg_7d}</strong> ({data.daily_avg_7d > 0 ? Math.round(data.daily_avg_7d / data.daily_cap * 100) : 0}% of cap)
          {data.cliff_eta_days !== null && data.cliff_eta_days >= 0 && (
            <> · Projected cliff: <strong>{data.cliff_eta_days === 0 ? "today" : `${data.cliff_eta_days}d`}</strong></>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-xl bg-[#FBFAF6] border border-[#E5DDC5]" data-testid="email-volume-past-7d">
          <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-1">Past 7 days</p>
          <p className="text-2xl font-serif text-[#2C2C2C]">{fmt(data.past_7d?.total)}</p>
        </div>
        <div className="p-3 rounded-xl bg-[#FBFAF6] border border-[#E5DDC5]" data-testid="email-volume-past-30d">
          <p className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-1">Past 30 days</p>
          <p className="text-2xl font-serif text-[#2C2C2C]">{fmt(data.past_30d?.total)}</p>
        </div>
        <div className="p-3 rounded-xl bg-[#EEE9FB] border border-[#6B46C1]/30" data-testid="email-volume-forecast-7d">
          <p className="text-xs uppercase tracking-wider text-[#6B46C1] mb-1">Projected · next 7d</p>
          <p className="text-2xl font-serif text-[#6B46C1]">{fmt(data.forecast_7d_total)}</p>
          <p className="text-[11px] text-[#5B5F4D] mt-1">≈ {data.forecast_daily_avg}/day</p>
        </div>
      </div>

      <h4 className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-2">Past 7 days by kind</h4>
      <ul className="space-y-1 mb-4" data-testid="email-volume-past-by-kind">
        {pastKinds.length === 0 && (
          <li className="text-xs text-[#6E6E6E] italic">No sends in the past 7 days.</li>
        )}
        {pastKinds.map((k) => (
          <li key={k.kind} className="flex items-center gap-3 text-xs">
            <span className="font-mono text-[#2C2C2C] w-44 truncate">{k.kind}</span>
            <div className="flex-1 h-2 bg-[#F5F3EC] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#6B46C1]"
                style={{ width: `${(k.total / maxPast * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="text-[#5B5F4D] tabular-nums w-12 text-right">{k.total}</span>
            {k.error > 0 && (
              <span className="text-[#D9534F] text-[10px]">·{k.error} err</span>
            )}
          </li>
        ))}
      </ul>

      <h4 className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-2">Projected weekly · by channel</h4>
      <ul className="space-y-1 mb-4" data-testid="email-volume-forecast-by-kind">
        {Object.entries(data.forecast_weekly || {})
          .filter(([k]) => k !== "total")
          .sort(([, a], [, b]) => b - a)
          .map(([k, v]) => (
            <li key={k} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[#FBFAF6] border border-[#E5DDC5]">
              <span className="font-mono text-[#2C2C2C]">{k}</span>
              <span className="text-[#5B5F4D] tabular-nums">{v}/week</span>
            </li>
          ))}
      </ul>

      <h4 className="text-xs uppercase tracking-wider text-[#5B5F4D] mb-2">Opt-in counts (real users only)</h4>
      <ul className="grid grid-cols-2 gap-1 text-xs" data-testid="email-volume-opt-in-counts">
        {Object.entries(data.opt_in_counts || {}).map(([k, v]) => (
          <li key={k} className="px-2 py-1 rounded bg-[#FBFAF6] border border-[#E5DDC5] flex justify-between">
            <span className="font-mono text-[#2C2C2C]">{k}</span>
            <span className="text-[#5B5F4D] tabular-nums">{v}</span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[#6E6E6E] mt-3 italic">
        Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : ""}
      </p>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Email system master switch — added 2026-06-20 as the prominent
// counterpart to the buried Feature flags ``outbound_emails_enabled``
// toggle.  Same backend (PUT /admin/feature-flags), but surfaced as a
// dedicated card with a big visual ON/PAUSED indicator so the admin
// can find and flip it in under 5 seconds during a quota emergency.
function EmailSystemCard() {
  const [enabled, setEnabled] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/admin/feature-flags");
        if (cancelled) return;
        const flags = data?.flags || {};
        // ``outbound_emails_enabled`` defaults to true on the backend;
        // any missing key here is treated the same.
        setEnabled(flags.outbound_emails_enabled !== false);
      } catch {
        if (!cancelled) setEnabled(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const flip = async () => {
    const next = !enabled;
    setBusy(true);
    setEnabled(next);  // optimistic
    try {
      await api.put("/admin/feature-flags", {
        flag: "outbound_emails_enabled",
        enabled: next,
      });
      toast.success(
        next
          ? "Email system ON — Resend will send real emails again."
          : "Email system PAUSED — outbound mail will queue as in-app notifications instead."
      );
    } catch {
      setEnabled(!next);
      toast.error("Couldn't toggle the email system");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={Mail}
      title="Email system"
      subtitle="Master ON/OFF for ALL outbound Resend mail (the kill switch)."
      testid="email-system-card"
    >
      {enabled === null ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div
            data-testid="email-system-state-pill"
            className={
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider " +
              (enabled
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200")
            }
          >
            <span className={enabled ? "w-2 h-2 rounded-full bg-emerald-500" : "w-2 h-2 rounded-full bg-rose-500"} />
            {enabled ? "ON — sending real emails" : "PAUSED — in-app only"}
          </div>
          <p className="text-sm text-[#2C2C2C] leading-relaxed">
            {enabled
              ? "Resend is delivering every email Shelfsort sends. Use this switch if you hit your Resend quota or need to pause all outbound mail."
              : "Outbound email is paused. Approval, suggestion-status, year-in-books, etc. are being queued as in-app notifications instead. Test emails still skip Resend (always have)."}
          </p>
          <button
            type="button"
            onClick={flip}
            disabled={busy}
            data-testid="email-system-toggle-btn"
            className={
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors " +
              (enabled
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "bg-emerald-600 text-white hover:bg-emerald-700") +
              " disabled:opacity-60"
            }
          >
            {enabled ? "🛑 Pause email system" : "✅ Resume email system"}
          </button>
          {!enabled && (
            <p className="text-xs text-[#B87A00] bg-[#FDF3E1] rounded-md px-3 py-2">
              Note: while paused, all per-user opt-in / opt-out settings on /account/emails are still honoured.
              Security-critical kinds (password reset, etc.) bypass this switch and always send.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}




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
      {loading && !data && <p className="text-sm text-[#5B5F4D]">Loading…</p>}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="email-stats-error">{error}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-[#E8E2D4] rounded-lg p-3" data-testid="email-stats-total">
              <p className="text-xs text-[#5B5F4D]">Total (7d)</p>
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
              <p className="text-xs text-[#5B5F4D]">Error rate</p>
              <p className="text-2xl font-medium text-[#2C2C2C]">{(data.error_rate_7d * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Resend plan quota gauge — counts OK sends in the last
              24h / 30d against the plan limits.  Limits come from the
              backend (env-driven), so an upgrade just means bumping
              RESEND_DAILY_LIMIT / RESEND_MONTHLY_LIMIT.  Bar colour
              flips amber at ≥ 75 % and red at ≥ 90 %. */}
          {data.quota && (
            <QuotaGauges quota={data.quota} />
          )}
          {data.by_kind.length > 0 && (
            <div className="mb-4" data-testid="email-stats-by-kind">
              <p className="text-xs font-medium text-[#2C2C2C] mb-2">Per template (7d)</p>
              <ul className="space-y-1 text-sm font-mono">
                {data.by_kind.map((k) => (
                  <li key={k.kind} className="flex items-center gap-3 text-[#2C2C2C]" data-testid={`email-stats-kind-${k.kind}`}>
                    <span className="flex-1">{k.kind}</span>
                    <span className="text-[#6B46C1]">{k.ok} ok</span>
                    {k.error > 0 && <span className="text-red-700">{k.error} err</span>}
                    <span className="text-[#5B5F4D]">{k.total} total</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recent_failures.length > 0 && (
            <div data-testid="email-stats-failures">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-red-700">Recent failures</p>
                <button
                  type="button"
                  data-testid="email-stats-clear-pre-cutover"
                  onClick={async () => {
                    if (!window.confirm("Delete every errored email row from before your Resend domain was verified?\n\n(Sandbox-era noise — real telemetry stays.)")) return;
                    try {
                      const { data: r } = await api.post("/admin/email-logs/clear-pre-cutover-failures");
                      toast.success(`Cleared ${r.deleted} pre-cutover row${r.deleted === 1 ? "" : "s"}.`);
                      load();
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || "Couldn't clear — retry?");
                    }
                  }}
                  className="text-[11px] text-[#6B46C1] hover:underline"
                  title="Removes errored email_log rows older than your Resend domain verification timestamp"
                >
                  Clear pre-cutover ↺
                </button>
              </div>
              <ul className="space-y-1 text-xs font-mono">
                {data.recent_failures.map((f, i) => (
                  <li key={`${f.kind}-${f.to}-${i}`} className="text-red-700 break-all" data-testid={`email-stats-failure-${i}`}>
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

// ---------------------------------------------------------------------------
// Re-extract EPUB links backfill (Phase-6 Storyid reconstruction)
// ---------------------------------------------------------------------------
// Re-runs `extract_urls_from_epub` on existing books so the host-aware
// Storyid reconstruction shipped 2026-06-26 lands on old uploads.
// Walks the library in 500-row chunks (admin re-clicks to continue);
// dry-run preview shows impact before any writes happen.
function ReExtractLinksCard() {
  const [busy, setBusy] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(500);
  const [result, setResult] = useState(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await api.post("/admin/re-extract-links", {
        dry_run: dryRun,
        only_missing_source: onlyMissing,
        limit: Number(limit) || 500,
      });
      setResult(data);
      const verb = data.dry_run ? "Would update" : "Updated";
      toast.success(
        `${verb} ${data.set_source} source URL${data.set_source === 1 ? "" : "s"} · ${data.rewrote_links} sidecar files rewritten · ${data.missing_file} missing files (of ${data.scanned} scanned)`,
        { duration: 8000 }
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backfill failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={RotateCcw}
      title="Backfill EPUB links"
      subtitle="Re-runs the URL extractor on existing books so newly-supported patterns (bare Storyid: + host name) land on old uploads. Rewrites the sidecar .links.txt and optionally fills in a missing source_url."
      testid="admin-re-extract-links-card"
    >
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer" data-testid="admin-re-extract-dry-run">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="w-4 h-4"
          />
          <span><strong>Dry run</strong> — preview impact without writing</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer" data-testid="admin-re-extract-only-missing">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
            className="w-4 h-4"
          />
          <span>Only fill in books with a <strong>missing</strong> source URL (never overwrite an existing one)</span>
        </label>
        <label className="flex items-center gap-2">
          <span>Batch size:</span>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            min={1}
            max={5000}
            className="w-24 px-2 py-1 border border-[#E4D9C8] rounded text-xs"
            data-testid="admin-re-extract-limit"
          />
          <span className="text-xs text-[#5B5F4D]">(books per click — re-run to walk the rest)</span>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#5B36B0] disabled:opacity-60"
          data-testid="admin-re-extract-run"
        >
          {busy ? "Scanning…" : (dryRun ? "Preview backfill" : "Run backfill")}
        </button>
        {result && (
          <div className="mt-3 p-3 rounded-lg bg-[#FDF8F0] border border-[#E4D9C8] text-xs space-y-1.5" data-testid="admin-re-extract-result">
            <div><strong>Scanned:</strong> {result.scanned}</div>
            <div><strong>{result.dry_run ? "Would set" : "Set"} source_url:</strong> {result.set_source}</div>
            <div><strong>Sidecar links rewritten:</strong> {result.rewrote_links}</div>
            <div><strong>Missing file (couldn&apos;t fetch from storage):</strong> {result.missing_file}</div>
            {result.samples && result.samples.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[#6B46C1] font-semibold">First {result.samples.length} examples</summary>
                <ul className="mt-1.5 space-y-1 pl-2">
                  {result.samples.map((s) => (
                    <li key={s.book_id} className="text-[11px] text-[#5B5F4D]">
                      <span className="font-semibold text-[#2C2C2C]">{s.title || s.book_id}</span>
                      {s.result === "missing_file" ? (
                        <span className="ml-1 text-[#C5564B]">— file not in storage</span>
                      ) : s.new_source ? (
                        <span className="ml-1">→ <span className="text-[#2F6E60] break-all">{s.new_source}</span></span>
                      ) : (
                        <span className="ml-1">— links updated ({s.links_count})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
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
          <div className="text-xs text-[#5B5F4D] font-mono" data-testid="admin-fulltext-result">
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

  // "Recently viewed" sidebar list — last 3 testids the operator
  // expanded, newest first.  Persisted to localStorage so it survives
  // a refresh / new tab.  Hydrated lazily so SSR / first-paint is
  // identical regardless of the saved state.  (2026-06-22.)
  const RECENT_KEY = "admin.recent_cards";
  const RECENT_MAX = 3;
  const [recentIds, setRecentIds] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(raw) ? raw.slice(0, RECENT_MAX) : [];
    } catch { return []; }
  });
  const pushRecent = (testid) => {
    setRecentIds((prev) => {
      // Dedupe + newest-first + capped.
      const next = [testid, ...prev.filter((x) => x !== testid)].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const recentCards = recentIds
    .map((id) => ADMIN_CARD_MANIFEST.find((c) => c.testid === id))
    .filter(Boolean);
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

  // Cmd+K command palette state (2026-06-22 navigation overhaul).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => {
          const next = !v;
          // Reset query + selection every time we toggle so the next
          // open doesn't show stale state from the previous session.
          // (Per testing-agent code-review feedback iter 34.)
          if (!next) { setPaletteQuery(""); setPaletteIndex(0); }
          return next;
        });
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
        setPaletteQuery("");
        setPaletteIndex(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);
  const paletteResults = paletteQuery.trim()
    ? ADMIN_CARD_MANIFEST.filter((c) => cardMatchesQuery(c, paletteQuery.trim().toLowerCase())).slice(0, 8)
    : ADMIN_CARD_MANIFEST.slice(0, 8);
  const jumpToCard = (testid) => {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteIndex(0);
    // Cmd+K → Enter counts as a "view" for the Recent sidebar list.
    pushRecent(testid);
    setTimeout(() => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        // Briefly highlight the target card so the eye finds it.
        el.style.transition = "box-shadow 0.4s ease-in-out";
        el.style.boxShadow = "0 0 0 3px #6B46C1";
        setTimeout(() => { el.style.boxShadow = ""; }, 1400);
      }
    }, 80);
  };

  // Scroll-spy for the sticky sidebar — track which category section is
  // currently in the viewport so we can highlight its sidebar link.
  const [activeCategory, setActiveCategory] = useState(ADMIN_CATEGORIES[0].id);
  useEffect(() => {
    if (query) return; // skip while filtering
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          // Pick the top-most visible section.
          visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          const id = visible[0].target.getAttribute("data-category");
          if (id) setActiveCategory(id);
        }
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    ADMIN_CATEGORIES.forEach((c) => {
      const el = document.getElementById(`admin-section-${c.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [query]);
  const jumpToCategory = (id) => {
    const el = document.getElementById(`admin-section-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Group cards by category for sectioned render — preserves manifest
  // order within each category.
  const visibleByCategory = ADMIN_CATEGORIES.map((cat) => ({
    ...cat,
    cards: visibleCards.filter((c) => c.category === cat.id),
  })).filter((cat) => cat.cards.length > 0);
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-10 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8" data-testid="admin-console">
        {/* Cross-page sticky banner — only renders when a watchdog has
            auto-paused.  Sits inside <main> so the layout grid still
            collapses cleanly on small screens. */}
        <div className="lg:col-span-2">
          <GuardiansBanner />
          <InFlightUploadsBanner />
        </div>
        {/* ─── Sticky category sidebar (2026-06-22) — jump-nav across the 33 cards. ─── */}
        <aside className="hidden lg:block sticky top-6 self-start" data-testid="admin-sidebar">
          {recentCards.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] mb-3 px-2">Recent</p>
              <nav className="space-y-0.5 mb-4" aria-label="Recently viewed" data-testid="admin-sidebar-recent">
                {recentCards.map((card) => (
                  <button
                    key={card.testid}
                    type="button"
                    onClick={() => {
                      const el = document.querySelector(`[data-testid="${card.testid}"]`);
                      if (el) {
                        el.scrollIntoView({ behavior: "smooth", block: "start" });
                        el.style.transition = "box-shadow 0.4s ease-in-out";
                        el.style.boxShadow = "0 0 0 3px #6B46C1";
                        setTimeout(() => { el.style.boxShadow = ""; }, 1400);
                      }
                    }}
                    title={card.subtitle}
                    data-testid={`admin-sidebar-recent-${card.testid}`}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-[#5B5F4D] hover:bg-[#FDF3E1] hover:text-[#B87A00] transition-colors truncate"
                  >
                    <span className="text-[10px] mr-1.5 opacity-60">↻</span>{card.title}
                  </button>
                ))}
              </nav>
            </>
          )}
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] mb-3 px-2">Sections</p>
          <nav className="space-y-0.5" aria-label="Admin sections">
            {ADMIN_CATEGORIES.map((cat) => {
              const count = ADMIN_CARD_MANIFEST.filter((c) => c.category === cat.id).length;
              const active = activeCategory === cat.id && !query;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => jumpToCategory(cat.id)}
                  data-testid={`admin-sidebar-link-${cat.id}`}
                  data-active={active ? "true" : "false"}
                  className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    active
                      ? "bg-[#6B46C1] text-white font-semibold"
                      : "text-[#5B5F4D] hover:bg-[#EEE9FB] hover:text-[#6B46C1]"
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-[10px] tabular-nums ${active ? "text-[#EEE9FB]" : "text-[#6E6E6E]"}`}>{count}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-4 px-2 text-[10px] text-[#6E6E6E]">
            <kbd className="px-1.5 py-0.5 rounded bg-[#FBFAF6] border border-[#E5DDC5] font-mono">⌘K</kbd> · jump to a card
          </div>
        </aside>

        <div>
        {/* Mobile category jump (lg:hidden — sidebar above replaces it on desktop).
            Sticky so it stays visible while scrolling long sections. */}
        <div className="lg:hidden mb-4 sticky top-2 z-10 bg-white/90 backdrop-blur-sm rounded-xl p-2 border border-[#E5DDC5]"> {/* dark-ok — bg-white/90 is remapped in index.css */}
          <label htmlFor="admin-mobile-jump" className="text-[10px] uppercase tracking-wider text-[#5B5F4D] mb-1 block px-1">
            Jump to section
          </label>
          <select
            id="admin-mobile-jump"
            data-testid="admin-mobile-jump"
            value={activeCategory}
            onChange={(e) => jumpToCategory(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm focus:border-[#6B46C1] focus:outline-none"
          >
            {ADMIN_CATEGORIES.map((cat) => {
              const count = ADMIN_CARD_MANIFEST.filter((c) => c.category === cat.id).length;
              return (
                <option key={cat.id} value={cat.id}>{cat.label} ({count})</option>
              );
            })}
          </select>
        </div>


        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-4">
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
            <Link
              to="/admin/help"
              data-testid="admin-help-link"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5DDC5] text-[#5B5F4D] text-xs font-bold uppercase tracking-[0.15em] hover:border-[#6B46C1] hover:text-[#6B46C1] transition-colors"
              title="What does each card do?"
            >
              <HelpCircle className="w-3.5 h-3.5" /> Help
            </Link>
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-colors ${remember ? "bg-[#EEE9FB] text-[#6B46C1] border border-[#6B46C1]" : "bg-[#F4EFE4] text-[#5B5F4D] border border-[#E5DDC5] hover:bg-[#EEE9FB] hover:text-[#6B46C1] hover:border-[#6B46C1]"}`}
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
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] pointer-events-none" aria-hidden="true" />
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5B5F4D] hover:text-[#2C2C2C]"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-[#5B5F4D]">
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

        <p className="text-xs text-[#5B5F4D] italic mb-6" data-testid="admin-collapsed-hint">
          Sections are collapsed by default — click a category to reveal its contents.
          {remember ? " Your open sections will be remembered on your next visit." : ""}
        </p>

        <AdminCardsContext.Provider value={{ openTick, closeTick, remember, query, pushRecent }}>
          {visibleCards.length === 0 ? (
            <div
              className="shelf-card p-8 text-center"
              data-testid="admin-section-search-empty"
            >
              <Search className="w-8 h-8 text-[#5B5F4D] mx-auto mb-2" aria-hidden="true" />
              <p className="font-serif text-xl text-[#2C2C2C] mb-1">No sections match "{rawQuery}"</p>
              <p className="text-sm text-[#5B5F4D] mb-4">Try one of the suggestions above — or clear the search to see all {ADMIN_CARD_MANIFEST.length} sections.</p>
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
              {/* Each component owns its data-testid that maps back to the
                  ADMIN_CARD_MANIFEST entry.  We render them in category
                  groups: a tiny header bar with anchor id introduces
                  each group so the sticky sidebar can scroll to it and
                  the scroll-spy IntersectionObserver can highlight the
                  active category as the operator scrolls. */}
              {visibleByCategory.map((cat) => (
                <section
                  key={cat.id}
                  id={`admin-section-${cat.id}`}
                  data-category={cat.id}
                  data-testid={`admin-section-${cat.id}`}
                  className="mb-8 scroll-mt-24"
                >
                  <h2 className="font-serif text-xl text-[#6B46C1] uppercase tracking-[0.18em] text-xs font-bold mb-3 pb-2 border-b border-[#E5DDC5]">
                    {cat.label} <span className="ml-2 text-[10px] text-[#6E6E6E] font-normal">{cat.cards.length}</span>
                  </h2>
                  {cat.cards.map((c) => {
                    switch (c.testid) {
                      case "admin-today-pulse-card":            return <TodayPulseCard key={c.testid} />;
                      case "admin-pending-users-card":          return <PendingUsersCard key={c.testid} />;
                      case "admin-signup-rules-card":           return <SignupRulesCard key={c.testid} />;
                      case "admin-users-card":                  return <UsersCard key={c.testid} />;
                      case "admin-view-consents-card":          return <ViewConsentsCard key={c.testid} />;
                      case "admin-feedback-inbox-card":         return <FeedbackInboxCard key={c.testid} />;
                      case "admin-help-feedback-card":          return <HelpFeedbackCard key={c.testid} />;
                      case "admin-watching-bookclubs-card":     return <WatchingBookclubsCard key={c.testid} />;
                      case "admin-chat-rooms-card":             return <ChatRoomsCard key={c.testid} />;
                      case "admin-moderation-log-card":         return (
                        <Card key={c.testid} icon={ShieldCheck} title="Moderation log"
                          subtitle="All-time, append-only history of every mod action: approvals, rejections, room locks, and mod promotions."
                          testid="admin-moderation-log-card">
                          <ModerationLogCard pageSize={25} />
                          <AdminAnalyticsCard />
                        </Card>
                      );
                      case "admin-antivirus-card":              return <AntivirusCard key={c.testid} />;
                      case "admin-storage-by-user-card":        return <StorageByUserCard key={c.testid} />;
                      case "admin-r2-migration-card":           return <R2MigrationProgressCard key={c.testid} />;
                      case "admin-orphan-audit-card":           return <OrphanCleanupCard key={c.testid} />;
                      case "admin-storage-trend-card":          return <StorageTrendCard key={c.testid} />;
                      case "email-system-card":                 return <EmailSystemCard key={c.testid} />;
                      case "email-volume-forecast-card":        return <EmailVolumeForecastCard key={c.testid} />;
                      case "admin-email-mode-card":             return <AdminEmailModeCard key={c.testid} />;
                      case "admin-pending-alerts-card":         return <AdminPendingAlertsCard key={c.testid} />;
                      case "email-stats-card":                  return <EmailStatsCard key={c.testid} />;
                      case "admin-email-diagnostic-card":       return <EmailDiagnosticCard key={c.testid} />;
                      case "admin-banner-card":                 return <MaintenanceBannerCard key={c.testid} />;
                      case "admin-health-card":                 return <HealthCard key={c.testid} />;
                      case "admin-stuck-uploads-card":          return <StuckUploadsCard key={c.testid} />;
                      case "cron-health-card":                  return <CronHealthCard key={c.testid} />;
                      case "route-catalogue-card":              return <RouteCatalogueCard key={c.testid} />;
                      case "admin-flags-card":                  return <FeatureFlagsCard key={c.testid} />;
                      case "hidden-features-card":              return <HiddenFeaturesCard key={c.testid} />;
                      case "admin-changelog-card":              return <ChangelogCard key={c.testid} />;
                      case "admin-canary-card":                 return <CanaryCard key={c.testid} />;
                      case "admin-llm-key-health-card":         return <LlmKeyHealthCard key={c.testid} />;
                      case "admin-unknown-fandoms-card":        return <UnknownFandomsCard key={c.testid} />;
                      case "admin-crossover-suggestions-card":  return <CrossoverSuggestionsCard key={c.testid} />;
                      case "admin-aliases-card":                return <GlobalAliasesCard key={c.testid} />;
                      case "admin-stats-card":                  return <GlobalStatsCard key={c.testid} />;
                      case "admin-audit-card":                  return <AuditLogCard key={c.testid} />;
                      case "admin-mongo-inspector-card":        return <MongoInspectorCardWrap key={c.testid} />;
                      case "admin-fulltext-card":               return <FulltextBackfillCard key={c.testid} />;
                      case "admin-re-extract-links-card":       return <ReExtractLinksCard key={c.testid} />;
                      default:                                  return null;
                    }
                  })}
                </section>
              ))}
            </>
          )}
        </AdminCardsContext.Provider>
        </div>
      </main>

      {/* ─── Cmd+K command palette (2026-06-22) — fuzzy-jump to any card. ─── */}
      {paletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="admin-command-palette"
          className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/40 backdrop-blur-sm"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-xl mx-4 bg-white rounded-2xl shadow-2xl border border-[#E5DDC5] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[#E5DDC5] flex items-center gap-2">
              <Search className="w-4 h-4 text-[#6E6E6E]" />
              <input
                autoFocus
                type="text"
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setPaletteIndex((i) => Math.min(i + 1, paletteResults.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteIndex((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter" && paletteResults[paletteIndex]) { jumpToCard(paletteResults[paletteIndex].testid); }
                }}
                placeholder="Jump to a card…"
                data-testid="admin-command-palette-input"
                className="flex-1 bg-transparent text-sm text-[#2C2C2C] placeholder:text-[#9A9580] focus:outline-none"
              />
              <kbd className="text-[10px] text-[#6E6E6E] font-mono">ESC</kbd>
            </div>
            <ul className="max-h-72 overflow-y-auto py-2" data-testid="admin-command-palette-results">
              {paletteResults.length === 0 && (
                <li className="px-4 py-3 text-sm text-[#5B5F4D] italic">No matches.</li>
              )}
              {paletteResults.map((c, i) => {
                const cat = ADMIN_CATEGORIES.find((x) => x.id === c.category);
                return (
                  <li
                    key={c.testid}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setPaletteIndex(i)}
                    onClick={() => jumpToCard(c.testid)}
                    data-testid={`admin-command-palette-item-${c.testid}`}
                    className={`px-4 py-2 cursor-pointer flex items-center justify-between gap-2 ${
                      paletteIndex === i ? "bg-[#EEE9FB]" : "hover:bg-[#FBFAF6]"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#2C2C2C] truncate">{c.title}</p>
                      <p className="text-[11px] text-[#5B5F4D] truncate">{c.subtitle}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-[#6E6E6E] flex-shrink-0">
                      {cat?.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-2 text-[10px] text-[#6E6E6E] border-t border-[#E5DDC5] flex items-center justify-between">
              <span><kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">↵</kbd> jump</span>
              <span>{paletteResults.length} of {ADMIN_CARD_MANIFEST.length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
