import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { BookOpen, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import axios from "axios";
import { API } from "../lib/api";
import SiteFooter from "../components/SiteFooter";

// Public status page.  No auth.  Linkable from the footer and shareable
// during incidents.  Surfaces a live snapshot of /api/health alongside
// the 30-day canary sparkline already powered by /api/canary/uptime.
//
// Three layers, top to bottom:
//   1. Big "All systems operational" / "Degraded" / "Major outage" banner
//   2. Per-dependency live state — mongo, env_config, scheduler, storage,
//      antivirus — each with a one-line status and a "Why" tooltip.
//   3. 30-day pass/fail sparkline of the prod-smoke-canary, with an
//      "N days since last incident" counter for at-a-glance trust.
//
// Auto-refreshes every 30 s.  Designed to be the page you share when
// someone DMs "is shelfsort down?" — answer in one screenshot.

const REFRESH_MS = 30_000;

// Friendly labels + descriptions for each /api/health check.  Stays
// in this page so the backend probe stays a raw machine surface.
const CHECK_META = {
  mongo: {
    label: "Database",
    desc: "MongoDB connectivity — every page load reads from here.",
  },
  env_config: {
    label: "Config",
    desc: "Critical env vars (MONGO_URL, DB_NAME, CORS_ORIGINS) present and well-formed.",
  },
  scheduler: {
    label: "Background jobs",
    desc: "Weekly digests, AV scans, upload recovery — APScheduler running.",
  },
  storage: {
    label: "File storage",
    desc: "Where your uploaded EPUBs live.",
  },
  antivirus: {
    label: "Antivirus",
    desc: "ClamAV scanner for incoming uploads. Optional — uploads still work without it.",
  },
};

// Per-check display order — Database + Config first because they're
// the only hard deps; the rest are degradation-only.
const CHECK_ORDER = ["mongo", "env_config", "scheduler", "storage", "antivirus"];

// Render the headline traffic light + copy based on the top-level
// /api/health status.  Defensive — `down` and `unknown` both fall
// into the same "things are broken" bucket.
function StatusBanner({ status, fetchError }) {
  let bg, fg, border, Icon, headline, sub;
  if (fetchError) {
    bg = "bg-[#FBE2E0]"; fg = "text-[#7C2D2A]"; border = "border-[#E8B5B0]";
    Icon = XCircle;
    headline = "Status check failed";
    sub = "We couldn't reach the API. Either you're offline, or shelfsort.com is currently unreachable.";
  } else if (status === "ok") {
    bg = "bg-[#E6F2E6]"; fg = "text-[#3D6B3D]"; border = "border-[#C8E1C8]";
    Icon = CheckCircle2;
    headline = "All systems operational";
    sub = "Every core service is responding normally.";
  } else if (status === "degraded") {
    bg = "bg-[#FBF1D6]"; fg = "text-[#7C5F1F]"; border = "border-[#E8D89A]";
    Icon = AlertTriangle;
    headline = "Some systems are degraded";
    sub = "Core functionality works, but one or more optional services are unhealthy.";
  } else {
    bg = "bg-[#FBE2E0]"; fg = "text-[#7C2D2A]"; border = "border-[#E8B5B0]";
    Icon = XCircle;
    headline = "Major outage";
    sub = "A critical dependency is down. Sign-ups, sign-ins, and uploads may not work.";
  }

  return (
    <div
      className={`rounded-2xl border ${border} ${bg} px-6 py-7 flex items-start gap-4`}
      data-testid="status-banner"
      data-status={fetchError ? "fetch_error" : status}
    >
      <Icon className={`w-8 h-8 flex-shrink-0 ${fg}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <h2
          className={`font-serif text-3xl ${fg} leading-tight`}
          data-testid="status-headline"
        >
          {headline}
        </h2>
        <p className={`mt-1 text-sm ${fg} opacity-90`}>{sub}</p>
      </div>
    </div>
  );
}

// One row per /api/health check — current state + a "Why this matters"
// caption.  When the check has structured `findings` (env_config does),
// they're listed verbatim so the page is self-explanatory during an
// outage.
function CheckRow({ id, check }) {
  const meta = CHECK_META[id] || { label: id, desc: "" };
  const ok = !!(check && check.ok);
  const Icon = ok ? CheckCircle2 : (id === "antivirus" || id === "scheduler" || id === "storage" ? AlertTriangle : XCircle);
  const stateColor = ok
    ? "text-[#3D6B3D]"
    : (id === "antivirus" || id === "scheduler" || id === "storage" ? "text-[#7C5F1F]" : "text-[#7C2D2A]");
  const stateLabel = ok ? "Operational" : (
    id === "antivirus" || id === "scheduler" || id === "storage" ? "Degraded" : "Down"
  );

  return (
    <div
      className="flex items-start gap-4 py-4 border-b border-[#EDE6D5] last:border-b-0"
      data-testid={`status-check-${id}`}
      data-ok={ok ? "true" : "false"}
    >
      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${stateColor}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="font-serif text-lg text-[#2C2C2C]" data-testid={`status-check-${id}-label`}>
            {meta.label}
          </p>
          <span
            className={`text-xs uppercase tracking-[0.12em] font-bold ${stateColor}`}
            data-testid={`status-check-${id}-state`}
          >
            {stateLabel}
          </span>
        </div>
        <p className="text-sm text-[#5B5F4D] mt-1">{meta.desc}</p>
        {/* Surface structured failure detail when present (env_config emits these). */}
        {!ok && Array.isArray(check?.findings) && check.findings.length > 0 && (
          <ul
            className="mt-2 text-xs text-[#7C2D2A] space-y-1 pl-1"
            data-testid={`status-check-${id}-findings`}
          >
            {check.findings.map((f, i) => (
              <li key={i} className="font-mono">
                ✗ {f.var}: {f.error}
              </li>
            ))}
          </ul>
        )}
        {!ok && check?.error && (
          <p
            className="mt-2 text-xs text-[#7C2D2A] font-mono break-words"
            data-testid={`status-check-${id}-error`}
          >
            {check.error}
          </p>
        )}
      </div>
    </div>
  );
}

// 30-day pass/fail sparkline — same color scheme as the changelog
// uptime pill so visual language stays consistent across the app.
function CanarySparkline({ info }) {
  const cellClass = (d) => {
    if (!d || d.total === 0) return "bg-[#EDE9DF]";
    if (d.fail === 0) return "bg-[#5C8A5C]";
    if (d.pass === 0) return "bg-[#C75450]";
    return "bg-[#D49A33]";
  };
  const cellTitle = (d) => {
    if (!d || d.total === 0) return `${d?.date || ""} — no canary run`;
    if (d.fail === 0) return `${d.date} — ${d.pass}/${d.total} passed`;
    if (d.pass === 0) return `${d.date} — ${d.fail}/${d.total} failed`;
    return `${d.date} — mixed: ${d.pass} passed, ${d.fail} failed`;
  };

  if (!info?.daily?.length) return null;

  // Days-since-last-incident counter — quietly counts up while things
  // are healthy, snaps to "Today" the moment a canary cell goes red.
  let lastRedIdx = -1;
  for (let i = info.daily.length - 1; i >= 0; i--) {
    if ((info.daily[i].fail || 0) > 0) { lastRedIdx = i; break; }
  }
  let incidentLine;
  if (lastRedIdx === -1) {
    incidentLine = `${info.daily.length}+ days without a canary failure.`;
  } else {
    const gap = info.daily.length - 1 - lastRedIdx;
    if (gap === 0) incidentLine = "A canary failure happened today (UTC).";
    else incidentLine = `${gap} day${gap === 1 ? "" : "s"} since the last canary failure (${info.daily[lastRedIdx].date}).`;
  }

  return (
    <div className="mt-6" data-testid="status-canary-sparkline-wrap">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <p className="text-xs uppercase tracking-[0.18em] text-[#5B5F4D] font-bold">
          Production canary — last {info.days} days
        </p>
        <p className="text-sm text-[#2C2C2C]" data-testid="status-uptime-pct">
          <span className="font-bold">{info.uptime_pct.toFixed(info.uptime_pct === 100 ? 0 : 1)}%</span>
          <span className="text-[#5B5F4D]"> uptime · {info.pass_count}/{info.total_runs} runs</span>
        </p>
      </div>
      <div
        className="inline-flex items-end gap-[3px] py-2"
        data-testid="status-canary-sparkline"
        aria-label={`Daily canary status for the last ${info.daily.length} days`}
      >
        {info.daily.map((d) => (
          <span
            key={d.date}
            title={cellTitle(d)}
            className={`inline-block w-[7px] h-5 rounded-[2px] ${cellClass(d)}`}
            data-testid={`status-canary-cell-${d.date}`}
          />
        ))}
      </div>
      <p className="text-xs text-[#5B5F4D] mt-2" data-testid="status-incident-counter">
        {incidentLine}
      </p>
    </div>
  );
}

export default function Status() {
  const [health, setHealth] = useState(null);
  const [canary, setCanary] = useState(null);
  const [fetchError, setFetchError] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Public endpoints — no axios `withCredentials` needed since the page
  // is fully anonymous. Use bare axios so an unauthenticated client
  // never sees a stale logged-in cookie path.
  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [hRes, cRes] = await Promise.allSettled([
        axios.get(`${API}/health`, { timeout: 10000 }),
        axios.get(`${API}/canary/uptime?days=30&include_daily=true`, { timeout: 10000 }),
      ]);
      if (hRes.status === "fulfilled") {
        setHealth(hRes.value.data);
        setFetchError(false);
      } else {
        setHealth(null);
        setFetchError(true);
      }
      if (cRes.status === "fulfilled" && cRes.value.data?.available) {
        setCanary(cRes.value.data);
      } else if (cRes.status === "fulfilled") {
        setCanary(null);  // available:false (fresh install / no runs yet)
      }
    } finally {
      setLastChecked(new Date());
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Shelfsort — Status";
    fetchAll();
    const t = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchAll]);

  const status = health?.status || "unknown";
  const checks = health?.checks || {};

  return (
    <div className="min-h-screen flex flex-col bg-[#FDFBF7]" data-testid="status-page">
      <header className="border-b border-[#EDE6D5] bg-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2"
            data-testid="status-home-link"
          >
            <BookOpen className="w-6 h-6 text-[#E07A5F]" />
            <span className="font-serif text-xl text-[#2C2C2C]">Shelfsort</span>
          </Link>
          <button
            type="button"
            onClick={fetchAll}
            disabled={refreshing}
            data-testid="status-refresh-btn"
            className="text-xs font-semibold text-[#6B46C1] hover:text-[#553397] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#6B46C1] mb-2">
          Live status
        </p>
        <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] mb-2">
          Shelfsort, right now.
        </h1>
        <p className="text-[#5B5F4D] mb-8">
          Auto-refreshes every 30 seconds. Last checked{" "}
          <span data-testid="status-last-checked">
            {lastChecked ? lastChecked.toLocaleTimeString() : "…"}
          </span>
          .
        </p>

        <StatusBanner status={status} fetchError={fetchError} />

        <section
          className="mt-10 rounded-2xl border border-[#EDE6D5] bg-white px-6 py-2"
          data-testid="status-checks-section"
        >
          {CHECK_ORDER.map((id) => (
            <CheckRow key={id} id={id} check={checks[id]} />
          ))}
        </section>

        {canary && <CanarySparkline info={canary} />}

        <section className="mt-10 text-sm text-[#5B5F4D] space-y-2" data-testid="status-meta">
          {health?.boot_id && (
            <p>
              Backend boot ID:{" "}
              <code className="font-mono text-[#2C2C2C]">{health.boot_id}</code>
              {health.version && health.version !== "dev" && (
                <span> · version <code className="font-mono text-[#2C2C2C]">{health.version}</code></span>
              )}
            </p>
          )}
          <p>
            See historical incidents and what we shipped to fix them in the{" "}
            <Link to="/changelog" className="text-[#6B46C1] font-semibold hover:underline" data-testid="status-changelog-link">
              changelog
            </Link>
            .
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
