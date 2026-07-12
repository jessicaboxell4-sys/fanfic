/**
 * Shared building blocks for the AdminConsole page family.
 *
 * Extracted from ``pages/AdminConsole.jsx`` in the Phase 6C-A frontend
 * refactor (2026-07-XX). Anything that a card component needs in common
 * lives here — the card wrapper, the collapse/search context, and the
 * manifest that drives the sidebar + search bar.
 *
 * Consumers:
 *   - ``pages/AdminConsole.jsx`` (the top-level page)
 *   - ``pages/adminConsole/StorageCards.jsx``
 *   - (planned) further split-out card files
 */
import React, { useContext, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Page-level "Expand all / Collapse all" broadcast (see AdminConsole.jsx
// for the toolbar that mutates the ticks). Cards listen to the ticks and
// bump their local open/closed state accordingly.
// ---------------------------------------------------------------------------
export const AdminCardsContext = React.createContext({
  openTick: 0, closeTick: 0, remember: false, query: "", pushRecent: () => {},
});

export const REMEMBER_PREF_KEY = "shelfsort.admin.remember-open";
export const CARD_STATE_PREFIX = "shelfsort.admin.card.";

// Section groupings — the sidebar renders one entry per category and
// each Card carries a ``category`` slug so the sidebar can jump-scroll.
export const ADMIN_CATEGORIES = [
  { id: "overview",  label: "Overview",              icon: "BarChart3" },
  { id: "users",     label: "Users & sign-ups",      icon: "Users" },
  { id: "feedback",  label: "Feedback & moderation", icon: "MessageSquare" },
  { id: "storage",   label: "Storage & files",       icon: "HardDrive" },
  { id: "email",     label: "Email",                 icon: "Mail" },
  { id: "system",    label: "System & health",       icon: "Activity" },
  { id: "data",      label: "Data & diagnostics",    icon: "Database" },
];

// Hardcoded manifest used by the search bar's "X of N · No matches"
// count, the suggestion chips, and the Card wrapper's search filter.
// Kept in sync with the Card title/subtitle strings across the page;
// extra `keywords` make the search forgiving (e.g. "outage" matches
// the Maintenance banner card whose title doesn't contain that word).
export const ADMIN_CARD_MANIFEST = [
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
  { testid: "admin-crash-pulse-card", category: "system", title: "Crash pulse", subtitle: "Client-side render errors grouped by message + page. Empty = good.", keywords: "crash pulse client error render boundary uncaught react js javascript page tour appearance regression incident telemetry" },
  { testid: "admin-attribution-card", category: "data", title: "Attribution", subtitle: "Where new visitors are finding Shelfsort — referrer domains + UTM campaigns for the last N days.", keywords: "attribution referrer utm source medium campaign marketing traffic acquisition google twitter reddit facebook direct where from came landing signup conversion" },
  { testid: "cron-health-card", category: "system", title: "Scheduled jobs", subtitle: "Last-run telemetry for crons.", keywords: "cron jobs scheduled task background failure last-run" },
  { testid: "route-catalogue-card", category: "system", title: "Route catalogue", subtitle: "Every /api/* endpoint.", keywords: "route catalogue endpoint api list routes urls" },
  { testid: "admin-flags-card", category: "system", title: "Feature flags", subtitle: "Runtime kill switches.", keywords: "feature flags toggles kill switch runtime config" },
  { testid: "hidden-features-card", category: "system", title: "Hidden features", subtitle: "Built-but-invisible work parked behind feature flags.", keywords: "hidden features parked feature flag toggle dormant disabled invisible behind flag fichub kindle send url fetching ficfic" },
  { testid: "admin-changelog-card", category: "system", title: "Recent changelog", subtitle: "Last 20 dated entries from CHANGELOG.md.", keywords: "changelog history recent log entries shipped features fixes release dates h2 memory append" },
  { testid: "admin-canary-card", category: "system", title: "Production canary", subtitle: "7-day uptime sparkline from the nightly smoke-canary workflow.", keywords: "canary smoke production uptime sparkline workflow github actions monitor health" },
  { testid: "admin-drift-status-card", category: "system", title: "Prod ↔ source drift", subtitle: "Hourly parity check between the live prod bundle and the preview source. Green = safe to deploy.", keywords: "drift prod source parity testid regression deploy safety hourly monitor missing bundle compiled reverse-engineered reconstruct guard" },
  { testid: "admin-library-diagnostics-card", category: "data", title: "My library diagnostics", subtitle: "Reconcile expected vs actual book counts for your own account after bulk uploads.", keywords: "library diagnostics count breakdown trash cadence duplicates upload recovery reconcile totals category buckets by day admin self mine 2000 recovery" },
  { testid: "admin-nudge-preferences-card", category: "data", title: "Notification preferences", subtitle: "Turn celebration toasts and other in-app nudges on or off per browser.", keywords: "notification preferences nudge toast celebration opt in opt out toggle celebrate dopamine housekeeping settings" },
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

export function cardMatchesQuery(card, q) {
  if (!q) return true;
  const haystack = `${card.title} ${card.subtitle} ${card.keywords}`.toLowerCase();
  return haystack.includes(q);
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// Card wrapper — every admin section is rendered inside this so search,
// collapse-all/expand-all, remember-open and recent-cards work uniformly.
// ---------------------------------------------------------------------------
export function Card({ icon: Icon, title, subtitle, children, testid }) {
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

  const handleToggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && pushRecent && testid) pushRecent(testid);
      return next;
    });
  };

  // Search filter — hide the card entirely when query is set and doesn't
  // match this card's title / subtitle / manifest keywords.
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
