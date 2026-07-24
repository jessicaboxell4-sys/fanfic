import React, { useContext, useEffect, useRef, useState } from "react";
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
  Paperclip, HelpCircle, Bell, EyeOff, History, ExternalLink, Edit2, LineChart, UploadCloud,
} from "lucide-react";
import MongoInspectorCard from "../components/MongoInspectorCard";
import ModerationLogCard from "../components/ModerationLogCard";
import CardErrorBoundary from "../components/CardErrorBoundary";
import AdminAnalyticsCard from "../components/AdminAnalyticsCard";
import OneTimeTip from "../components/OneTimeTip";
import { NUDGE_PREFS, getNudgePref, setNudgePref, subscribeToNudgePrefs } from "../lib/nudgePrefs";

// Shared building blocks extracted to ./adminConsole/shared.jsx in the
// Phase 6C-A frontend refactor (2026-07-XX). Card wrapper, expand/collapse
// context, the manifest driving sidebar + search, and small formatters.
import {
  AdminCardsContext,
  REMEMBER_PREF_KEY,
  CARD_STATE_PREFIX,
  ADMIN_CATEGORIES,
  ADMIN_CARD_MANIFEST,
  cardMatchesQuery,
  fmtBytes,
  fmtTime,
  fmtAgo,
  Card,
} from "./adminConsole/shared";

// Storage-cluster cards — see ./adminConsole/StorageCards.jsx
import {
  R2MigrationProgressCard,
  OrphanCleanupCard,
  StorageByUserCard,
  StorageTrendCard,
} from "./adminConsole/StorageCards";

// Recently-built self-contained cards (drift, dedup, uploads, R2) —
// see ./adminConsole/RecentCards.jsx for the extracted implementations.
import {
  DriftStatusCard,
  DedupRetryCard,
  UploadFailureInsightsCard,
  UploadSkipDigestCard,
  R2StorageCard,
} from "./adminConsole/RecentCards";

import {
  PendingUsersCard,
  UsersCard,
  ViewConsentsCard,
  ALERT_HEALTH_DISMISS_KEY,
  SUPPRESSION_REASON_LABEL,
  SUPPRESSION_FIX_HINT,
} from "./adminConsole/UsersCards";
import {
  FeedbackInboxCard,
  HelpFeedbackCard,
  SignupRulesCard,
} from "./adminConsole/ModerationCards";
import {
  AntivirusCard,
  LibraryDiagnosticsCard,
  StuckUploadsCard,
  ClientErrorPulseCard,
  PodMemoryPill,
  StartupTimingCard,
  UploadBatchHealthCard,
} from "./adminConsole/HealthCards";

import {
  EmailDiagnosticCard, AdminEmailModeCard, EmailStatsCard, EmailSystemCard, EmailVolumeForecastCard,
} from "./adminConsole/EmailCards";
import {
  FulltextBackfillCard, LlmKeyHealthCard, CanaryCard, ChangelogCard,
} from "./adminConsole/AnalyticsCards";
import {
  UnknownFandomsCard, CrossoverSuggestionsCard,
} from "./adminConsole/ContentCards";
import {
  ChatRoomsCard, WatchingBookclubsCard,
} from "./adminConsole/CommunityCards";
import {
  HiddenFeaturesCard, AdminPendingAlertsCard, ReExtractLinksCard, MaintenanceBannerCard,
} from "./adminConsole/SystemCards";

import {
  ImageIconAlias, InviteLinksWidget, CampaignStatsWidget, StatList,
} from "./adminConsole/widgets";

// NOTE: AdminCardsContext, Card wrapper, ADMIN_CATEGORIES, ADMIN_CARD_MANIFEST,
// fmtBytes / fmtTime and REMEMBER_PREF_KEY / CARD_STATE_PREFIX all moved to
// ./adminConsole/shared.jsx in the Phase 6C-A refactor (2026-07-XX).

// ---------------------------------------------------------------------------
// PendingUsersCard — approval queue for new sign-ups (2026-06-15)
// ---------------------------------------------------------------------------
// Every new sign-up (email/password OR Google OAuth) lands in
// ``approval_status="pending"`` and can't use the API. This card shows
// FIFO of pending users and lets the admin Approve (sets ``"approved"``,
// emails the user) or Reject with a reason (sets ``"rejected"``, emails
// the reason). The very first user ever auto-approves so the install
// bootstraps itself — see ``routes/auth.py``.
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

// ---------------------------------------------------------------------------
// ClientErrorPulseCard (2026-06-30)
// ---------------------------------------------------------------------------
// Surfaces the AppErrorBoundary client-side crash log on the AdminConsole.
// Every uncaught React render error POSTs to /api/analytics/client-errors
// (collected silently from every page).  This widget groups those rows by
// (message, href) and renders the top recent crashes so the operator can
// catch a regression before users start filing Help feedback.
//
// Reads from GET /api/admin/client-errors/recent?hours=24.  Refreshes every
// 60s when the tab is visible.  Empty state means "no crashes in the
// window" — which is the goal.
// ---------------------------------------------------------------------------
function AttributionCard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (d = days) => {
    setLoading(true);
    try {
      const { data: resp } = await api.get(`/admin/attribution/summary?days=${d}`);
      setData(resp);
    } catch {
      toast.error("Couldn't load attribution data.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  const domains = data?.by_domain || [];
  const campaigns = data?.by_campaign || [];
  const totalVisits = data?.total_visits ?? 0;
  const totalSignups = data?.total_signups ?? 0;
  const convRate = totalVisits > 0 ? ((totalSignups / totalVisits) * 100).toFixed(1) : "0";

  return (
    <Card icon={TrendingUp} title="Attribution" subtitle="Where visitors are arriving from — referrer domains + UTM campaigns." testid="admin-attribution-card">
      <div className="flex items-center gap-1 mb-3" data-testid="attribution-window-selector">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            data-testid={`attribution-window-${d}d`}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] border ${days === d ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#5B5F4D] border-[#E5DDC5] hover:border-[#6B46C1] hover:text-[#6B46C1]"}`}
          >
            {d}d
          </button>
        ))}
        <button
          type="button"
          onClick={() => load(days)}
          data-testid="attribution-refresh"
          className="ml-auto text-[11px] font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-[#5B5F4D] italic py-6 text-center">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4 text-center" data-testid="attribution-totals">
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#7A7457]">Visits</p>
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="attribution-total-visits">{totalVisits.toLocaleString()}</p>
            </div>
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#7A7457]">Signups</p>
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="attribution-total-signups">{totalSignups.toLocaleString()}</p>
            </div>
            <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.15em] text-[#7A7457]">Conv %</p>
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="attribution-conv-rate">{convRate}%</p>
            </div>
          </div>

          <div className="mb-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-1.5">Top referrer domains</p>
            {domains.length === 0 ? (
              <p className="text-xs text-[#5B5F4D] italic py-3 text-center" data-testid="attribution-domains-empty">No visits recorded in this window yet.</p>
            ) : (
              <ul className="space-y-1" data-testid="attribution-domains-list">
                {domains.map((d, i) => {
                  const pct = totalVisits > 0 ? (d.visits / totalVisits) * 100 : 0;
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-xs bg-white border border-[#E5DDC5] rounded-lg px-3 py-1.5"
                      data-testid={`attribution-domain-row-${i}`}
                    >
                      <span className="font-mono text-[#2C2C2C] truncate flex-1" data-testid={`attribution-domain-name-${i}`}>{d.key || "direct"}</span>
                      <span className="text-[#7A7457] w-16 text-right shrink-0">{d.visits} visits</span>
                      <span className="text-[#7A7457] w-16 text-right shrink-0">{d.signups} signup{d.signups === 1 ? "" : "s"}</span>
                      <span className="w-12 text-right text-[10px] text-[#7A7457] shrink-0">{pct.toFixed(0)}%</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {campaigns.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D] mb-1.5">Top UTM campaigns</p>
              <ul className="space-y-1" data-testid="attribution-campaigns-list">
                {campaigns.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-xs bg-white border border-[#E5DDC5] rounded-lg px-3 py-1.5"
                    data-testid={`attribution-campaign-row-${i}`}
                  >
                    <span className="font-mono text-[#2C2C2C] truncate flex-1">{c.key}</span>
                    <span className="text-[#7A7457] w-16 text-right shrink-0">{c.visits} visits</span>
                    <span className="text-[#7A7457] w-16 text-right shrink-0">{c.signups} signup{c.signups === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[10px] text-[#7A7457] italic">
            Tag your promo links with <code className="bg-[#F4EFE4] px-1 rounded">?utm_source=twitter&utm_campaign=launch</code> to bucket a channel in the campaigns table.
          </p>
        </>
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
function NudgePreferencesCard() {
  const [values, setValues] = useState(() => {
    const out = {};
    for (const p of NUDGE_PREFS) out[p.key] = getNudgePref(p.key);
    return out;
  });

  const toggle = (key) => {
    const next = !values[key];
    setValues((prev) => ({ ...prev, [key]: next }));
    setNudgePref(key, next);
  };

  // Group by the human-readable `category` field so future additions cluster
  // (e.g. "Library upkeep", "Community", "Reading", …).
  const grouped = NUDGE_PREFS.reduce((acc, p) => {
    const cat = p.category || "General";
    (acc[cat] = acc[cat] || []).push(p);
    return acc;
  }, {});

  return (
    <Card
      icon={Bell}
      title="Notification preferences"
      subtitle="Turn celebration toasts and other in-app nudges on or off per browser."
      testid="admin-nudge-preferences-card"
    >
      {NUDGE_PREFS.length === 0 && (
        <p className="text-sm text-[#5B5F4D] italic">
          No nudges configured yet. This card lights up when the app adds
          optional in-app celebrations or reminders.
        </p>
      )}

      {Object.entries(grouped).map(([cat, prefs]) => (
        <div key={cat} className="mb-4 last:mb-0" data-testid={`admin-nudge-prefs-group-${cat.toLowerCase().replace(/\s+/g, "-")}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5B5F4D] mb-2">
            {cat}
          </p>
          <ul className="space-y-2">
            {prefs.map((p) => (
              <li
                key={p.key}
                className="flex items-start gap-3 p-2 rounded border border-[#E4D9C8] bg-[#FBFAF6]"
                data-testid={`admin-nudge-pref-row-${p.key}`}
              >
                <label className="mt-0.5 relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={!!values[p.key]}
                    onChange={() => toggle(p.key)}
                    data-testid={`admin-nudge-pref-toggle-${p.key}`}
                    className="sr-only"
                  />
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${values[p.key] ? "bg-[#6B46C1]" : "bg-[#E4D9C8]"}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${values[p.key] ? "left-[18px]" : "left-0.5"}`} />
                  </div>
                </label>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#2C2C2C]">{p.label}</p>
                  {p.description && (
                    <p className="text-[11px] text-[#5B5F4D] mt-0.5">{p.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="text-[10px] text-[#5B5F4D] italic mt-3">
        Preferences are stored in this browser only. Sign in from another device to configure them there.
      </p>
    </Card>
  );
}





// ---------------------------------------------------------------------------
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
// Admin alert email frequency (2026-06-22) — Resend quota brake.
// Backed by GET/PUT /api/admin/email-mode which toggles the
// ``cron_failure_alerts`` and ``cron_alerts_weekly_batch`` flags
// under the hood.  Three radios so the operator doesn't have to
// reason about two-flag combinations.
// ---------------------------------------------------------------------------
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
// Retry Dedup Guard (iter 89 rebuild).  Reads GET /api/admin/dedup-retry-stats
// and renders total prevented duplicates, a 24h/7d/30d toggle, daily
// sparkline, unique-users + avg-per-user cards, and top-5 users
// leaderboard.  Empty state when the network is calm.

// ---------------------------------------------------------------------------
// R2MirrorHealthBanner — persistent header banner that reads
// /api/admin/r2-mirror-health every 60s and renders a red "R2 mirror
// is degraded/broken" strip when strict-mode uploads have been
// rejected in the last hour.  Silent when healthy (renders nothing).
// Threshold-driven: `outage` (red) above the config threshold,
// `degraded` (amber) below, `healthy` (nothing).  Prevents the
// silent-block scenario from the 2026-07-22 incident where R2
// misconfig would 503 every upload without an operator signal.
// ---------------------------------------------------------------------------

function R2MirrorHealthBanner() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: d } = await api.get("/admin/r2-mirror-health");
        if (!cancelled) setData(d);
      } catch { /* silent — banner just doesn't render */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!data || data.status === "healthy") return null;

  const isOutage = data.status === "outage";
  const bg = isOutage
    ? "bg-[#FBE7E4] dark:bg-red-950/40 border-[#C5564B] dark:border-red-800"
    : "bg-[#FDF3E1] dark:bg-amber-950/40 border-[#D48F2C] dark:border-amber-700";
  const textPrimary = isOutage ? "text-[#7C2D2A] dark:text-red-200" : "text-[#7A5B1F] dark:text-amber-200";

  return (
    <div
      className={`mb-4 p-4 rounded-2xl border-2 ${bg}`}
      data-testid="admin-r2-health-banner"
      data-status={data.status}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${textPrimary}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-bold uppercase tracking-[0.15em] mb-1 ${textPrimary}`}>
            {isOutage ? "R2 mirror is broken" : "R2 mirror is flaky"} · {data.last_hour} failure{data.last_hour === 1 ? "" : "s"} last hour
          </p>
          <p className={`text-sm ${textPrimary}`} data-testid="admin-r2-health-reason">
            {data.reason}
          </p>
          {data.recent && data.recent.length > 0 && (
            <details className="mt-2">
              <summary className={`text-xs cursor-pointer ${textPrimary} opacity-80 hover:opacity-100`}>
                Show {data.recent.length} recent (last hour)
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs font-mono opacity-90" data-testid="admin-r2-health-recent">
                {data.recent.map((r, i) => (
                  <li key={i} className={textPrimary}>
                    {new Date(r.created_at).toLocaleTimeString()} · {r.user_id?.slice(0, 12)}… · {r.filename}
                    {r.size ? ` (${(r.size/1024).toFixed(0)}KB)` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
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

  // Category expand/collapse for the sidebar — same treatment as
  // /help and /admin/help.  Persisted so operators keep their preferred
  // layout across sessions; the category containing the currently
  // active section is always force-open so scroll-spy still reveals
  // the card list the operator is reading right now.
  const SIDEBAR_EXPAND_KEY = "admin.sidebar_expanded_categories";
  const [expandedCats, setExpandedCats] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SIDEBAR_EXPAND_KEY) || "null");
      if (Array.isArray(raw)) return new Set(raw);
    } catch { /* ignore */ }
    return new Set(); // default: all collapsed
  });
  const toggleCategoryExpand = (catId) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      try { localStorage.setItem(SIDEBAR_EXPAND_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
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

  // 2026-07-11 — removed the internal auto-scroll effect that used to
  // ``scrollIntoView`` the active category as the page scrolled.  On
  // shorter viewports that behaviour was pushing the RECENT list up
  // out of the sidebar's visible area whenever the active section
  // was near the bottom of the SECTIONS list.  With Recent now
  // ``sticky top-0`` inside the aside (see below), the internal
  // auto-scroll is no longer needed — the highlight follows the
  // page-scroll naturally via the IntersectionObserver, and Recent
  // stays pinned so it's always reachable regardless of viewport
  // height.
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
        {/* ─── Sticky category sidebar (2026-06-22, updated 2026-07-11) ─
            Sticky-scrolls with the page.  Internal max-height + scroll
            keeps the whole nav visible even when the recent + section
            list combined exceeds viewport height.  Active category
            auto-scrolls into the sidebar viewport when scroll-spy
            updates so the highlight is always visible. */}
        <aside
          className="hidden lg:block sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-hidden pr-1"
          data-testid="admin-sidebar"
        >
          {recentCards.length > 0 && (
            <div
              className="sticky top-0 z-10 -mx-1 px-1 pt-1 pb-2 bg-[#FAF6EE] dark:bg-[color:var(--bg,#1B1B1E)]"
              data-testid="admin-sidebar-recent-sticky"
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] mb-2 px-2">Recent</p>
              <nav className="space-y-0.5" aria-label="Recently viewed" data-testid="admin-sidebar-recent">
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
            </div>
          )}
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5B5F4D] mb-3 px-2">Sections</p>
          <nav className="space-y-1" aria-label="Admin sections">
            {ADMIN_CATEGORIES.map((cat) => {
              const cardsInCat = ADMIN_CARD_MANIFEST.filter((c) => c.category === cat.id);
              const count = cardsInCat.length;
              const active = activeCategory === cat.id && !query;
              // Force-open when scroll-spy has landed in this category
              // so the card list is visible while you're reading it.
              const isOpen = expandedCats.has(cat.id) || active;
              return (
                <div key={cat.id}>
                  <div
                    className={`w-full flex items-stretch rounded-lg text-xs transition-colors overflow-hidden ${
                      active
                        ? "bg-[#6B46C1] text-white font-semibold"
                        : "text-[#5B5F4D] hover:bg-[#EEE9FB]"
                    }`}
                  >
                    {/* Expand/collapse toggle — small chevron on the left
                        edge of the row.  Separate hit target from the
                        category-jump button so a click on the chevron
                        never accidentally jumps the page. */}
                    <button
                      type="button"
                      onClick={() => toggleCategoryExpand(cat.id)}
                      aria-expanded={isOpen}
                      aria-controls={`admin-sidebar-cat-${cat.id}-list`}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${cat.label}`}
                      data-testid={`admin-sidebar-toggle-${cat.id}`}
                      className={`px-1.5 flex items-center justify-center transition-colors ${
                        active
                          ? "hover:bg-white/10"
                          : "hover:bg-[#DAD4EF] hover:text-[#6B46C1]"
                      }`}
                    >
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpToCategory(cat.id)}
                      data-testid={`admin-sidebar-link-${cat.id}`}
                      data-active={active ? "true" : "false"}
                      className={`flex-1 text-left flex items-center justify-between px-2 py-1.5 transition-colors ${
                        active ? "" : "hover:text-[#6B46C1]"
                      }`}
                    >
                      <span>{cat.label}</span>
                      <span className={`text-[10px] tabular-nums ${active ? "text-[#EEE9FB]" : "text-[#6E6E6E]"}`}>{count}</span>
                    </button>
                  </div>
                  {isOpen && cardsInCat.length > 0 && (
                    <nav
                      id={`admin-sidebar-cat-${cat.id}-list`}
                      className="space-y-0.5 mt-1 ml-4 mb-1"
                      aria-label={`${cat.label} cards`}
                    >
                      {cardsInCat.map((card) => (
                        <button
                          key={card.testid}
                          type="button"
                          onClick={() => jumpToCard(card.testid)}
                          title={card.subtitle}
                          data-testid={`admin-sidebar-card-${card.testid}`}
                          className="w-full text-left block px-2 py-1 rounded text-[11px] text-[#5B5F4D] hover:bg-[#FDF3E1] hover:text-[#B87A00] transition-colors truncate"
                        >
                          {card.title}
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
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
              // 2026-08-22 — Interpolate label + count into a single
              // string child so the visual-editor runtime doesn't wrap
              // `{cat.label}` in a `<span data-ve-dynamic>` (which is
              // invalid inside `<option>` and produces a React
              // hydration warning). Same output, one text node.
              return (
                <option key={cat.id} value={cat.id}>
                  {`${cat.label} (${count})`}
                </option>
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
            <PodMemoryPill />
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

        <R2MirrorHealthBanner />

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
              <p className="font-serif text-xl text-[#2C2C2C] mb-1">No sections match &ldquo;{rawQuery}&rdquo;</p>
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
                    // Each card is wrapped in a section-level error
                    // boundary — a bug in one card (see iter 102's
                    // EmailStatsCard `load` regression) no longer
                    // takes down the whole console.  The inner IIFE
                    // just runs the existing switch so touching the
                    // manifest stays exactly as it was.
                    const rendered = (() => {
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
                      case "admin-upload-health-card":          return <UploadBatchHealthCard key={c.testid} />;
                      case "admin-classifier-reliability-card": return <ClassifierReliabilityCard key={c.testid} />;
                      case "admin-crash-pulse-card":            return <ClientErrorPulseCard key={c.testid} />;
                      case "admin-startup-timing-card":         return <StartupTimingCard key={c.testid} />;
                      case "admin-attribution-card":            return <AttributionCard key={c.testid} />;
                      case "cron-health-card":                  return <CronHealthCard key={c.testid} />;
                      case "route-catalogue-card":              return <RouteCatalogueCard key={c.testid} />;
                      case "admin-flags-card":                  return <FeatureFlagsCard key={c.testid} />;
                      case "hidden-features-card":              return <HiddenFeaturesCard key={c.testid} />;
                      case "admin-changelog-card":              return <ChangelogCard key={c.testid} />;
                      case "admin-canary-card":                 return <CanaryCard key={c.testid} />;
                      case "admin-drift-status-card":           return <DriftStatusCard key={c.testid} />;
                      case "admin-library-diagnostics-card":    return <LibraryDiagnosticsCard key={c.testid} />;
                      case "admin-nudge-preferences-card":      return <NudgePreferencesCard key={c.testid} />;
                      case "admin-llm-key-health-card":         return <LlmKeyHealthCard key={c.testid} />;
                      case "admin-unknown-fandoms-card":        return <UnknownFandomsCard key={c.testid} />;
                      case "admin-crossover-suggestions-card":  return <CrossoverSuggestionsCard key={c.testid} />;
                      case "admin-aliases-card":                return <GlobalAliasesCard key={c.testid} />;
                      case "admin-stats-card":                  return <GlobalStatsCard key={c.testid} />;
                      case "admin-audit-card":                  return <AuditLogCard key={c.testid} />;
                      case "admin-mongo-inspector-card":        return <MongoInspectorCardWrap key={c.testid} />;
                      case "admin-fulltext-card":               return <FulltextBackfillCard key={c.testid} />;
                      case "admin-dedup-retry-card":            return <DedupRetryCard key={c.testid} />;
                      case "admin-upload-failure-insights-card": return <UploadFailureInsightsCard key={c.testid} />;
                      case "admin-upload-skip-digest-card":     return <UploadSkipDigestCard key={c.testid} />;
                      case "admin-r2-storage-card":             return <R2StorageCard key={c.testid} />;
                      case "admin-re-extract-links-card":       return <ReExtractLinksCard key={c.testid} />;
                      default:                                  return null;
                    }
                    })();
                    if (rendered === null) return null;
                    return (
                      <CardErrorBoundary key={c.testid} cardId={c.testid}>
                        {rendered}
                      </CardErrorBoundary>
                    );
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
