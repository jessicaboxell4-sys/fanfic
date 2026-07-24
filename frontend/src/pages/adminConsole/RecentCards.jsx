/**
 * Recent admin cards — extracted 2026-08-17.
 *
 * Grouped here because they were all built in the last ~4 iterations
 * and share a common "small self-contained monitor" shape.  Broken out
 * of the 9,200-line AdminConsole.jsx so each card can be edited (and
 * lazy-loaded in the future) without dragging its neighbours in.
 *
 * Cards:
 *   - DriftStatusCard            (source-vs-prod testid drift monitor)
 *   - DedupRetryCard             (sha256 idempotency guard stats)
 *   - UploadFailureInsightsCard  (uploads-that-crashed digest)
 *   - UploadSkipDigestCard       (uploads-that-refused digest)
 *   - R2StorageCard              (Cloudflare R2 usage + orphan purge)
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Copy, Loader2,
  RotateCcw, ShieldCheck, Upload, UploadCloud, Users,
} from "lucide-react";
import { Card, fmtBytes } from "./shared";

export function DriftStatusCard() {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // Text-sentinel companion — surfaces visible-copy regressions the
  // testid drift check would miss. Same hourly cadence, tick :23.
  const [textRow, setTextRow] = useState(null);
  const [textLoading, setTextLoading] = useState(true);
  const [textExpanded, setTextExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/drift-status");
      setRow(data);
    } catch (e) {
      setRow({ status: "error", error: e?.response?.data?.detail || "Failed to load" });
    } finally {
      setLoading(false);
    }
  };

  const loadText = async () => {
    setTextLoading(true);
    try {
      const { data } = await api.get("/admin/text-sentinel-status");
      setTextRow(data);
    } catch (e) {
      setTextRow({ status: "error", error: e?.response?.data?.detail || "Failed to load" });
    } finally {
      setTextLoading(false);
    }
  };

  useEffect(() => { load(); loadText(); }, []);

  const status = row?.status;
  const driftCount = row?.drift_count ?? 0;
  const driftList = row?.drift || [];
  const neverRun = row?.never_run === true;
  const showList = driftList.length > 0;

  // colour / label
  let tone, iconEl, label;
  if (loading) {
    tone = "bg-[#F5F1E4] border-[#E4D9C8] text-[#5B5F4D]";
    iconEl = <Loader2 className="w-5 h-5 animate-spin" />;
    label = "Checking…";
  } else if (neverRun) {
    tone = "bg-[#F5F1E4] border-[#E4D9C8] text-[#5B5F4D]";
    iconEl = <Clock className="w-5 h-5" />;
    label = "No check has run yet";
  } else if (status === "ok" && driftCount === 0) {
    tone = "bg-[#E7F2ED] border-[#B9DAC9] text-[#2F6E60]";
    iconEl = <ShieldCheck className="w-5 h-5" />;
    label = "Safe to deploy";
  } else if (status === "drift" || driftCount > 0) {
    tone = "bg-[#FBE2E0] border-[#F0B6B0] text-[#7C2D2A]";
    iconEl = <AlertTriangle className="w-5 h-5" />;
    label = `${driftCount} testid${driftCount === 1 ? "" : "s"} would regress`;
  } else if (status === "timeout") {
    tone = "bg-[#FDF3E1] border-[#F5D48A] text-[#8C5C00]";
    iconEl = <Clock className="w-5 h-5" />;
    label = "Last check timed out";
  } else {
    tone = "bg-[#FDF3E1] border-[#F5D48A] text-[#8C5C00]";
    iconEl = <AlertTriangle className="w-5 h-5" />;
    label = "Drift check errored";
  }

  const fmtWhen = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const now = new Date();
      const mins = Math.round((now - d) / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <Card
      icon={ShieldCheck}
      title="Prod ↔ source drift"
      subtitle="Hourly parity check between the live prod bundle and preview source. Green = safe to deploy."
      testid="admin-drift-status-card"
    >
      <div
        data-testid="admin-drift-status-badge"
        data-status={loading ? "loading" : (neverRun ? "never-run" : (status === "ok" && driftCount === 0 ? "ok" : (status === "drift" || driftCount > 0 ? "drift" : status)))}
        className={`flex items-start gap-3 p-3 rounded-lg border ${tone}`}
      >
        <div className="flex-shrink-0 mt-0.5">{iconEl}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" data-testid="admin-drift-status-label">{label}</p>
          {!loading && !neverRun && (
            <p className="text-[11px] mt-0.5 opacity-80" data-testid="admin-drift-status-meta">
              {row?.prod_testid_count != null && (
                <>
                  <span className="tabular-nums">{row.prod_testid_count.toLocaleString()}</span> testids in prod
                  {" · "}
                </>
              )}
              checked {fmtWhen(row?.checked_at)}
            </p>
          )}
          {row?.error && (
            <p className="text-[11px] mt-1 italic opacity-80" data-testid="admin-drift-status-error">{row.error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="admin-drift-status-refresh"
          className="p-1.5 rounded hover:bg-black/5 disabled:opacity-40 flex-shrink-0"
          title="Refresh drift status"
        >
          <RotateCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {showList && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            data-testid="admin-drift-status-toggle"
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-xs text-[#5B5F4D] hover:text-[#2C2C2C]"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? "Hide" : "Show"} missing testids ({driftList.length})
          </button>
          {expanded && (
            <ul
              data-testid="admin-drift-status-list"
              className="mt-2 max-h-64 overflow-y-auto rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]"
            >
              {driftList.map((t) => (
                <li
                  key={t}
                  data-testid={`admin-drift-item-${t}`}
                  className="px-3 py-1.5 text-[11px] font-mono text-[#7C2D2A]"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!loading && neverRun && (
        <p className="mt-3 text-[11px] text-[#5B5F4D] italic">
          The hourly cron ticks at :17 past each hour. You can also run <code className="bg-[#FDF3E1] px-1 rounded">python3 /app/scripts/deploy_drift_check.py</code> from the pod.
        </p>
      )}

      {/* Text-sentinel companion — visible copy regressions the testid
          drift check would miss. Runs at :23 past each hour. */}
      {(() => {
        const tNeverRun = textRow?.never_run === true;
        const tStatus = textRow?.status;
        const tMissingCount = textRow?.missing_count ?? 0;
        const tMissing = textRow?.missing || [];
        const tShowList = tMissing.length > 0;
        let tTone, tIcon, tLabel;
        if (textLoading) {
          tTone = "bg-[#F5F1E4] border-[#E4D9C8] text-[#5B5F4D]";
          tIcon = <Loader2 className="w-4 h-4 animate-spin" />;
          tLabel = "Checking copy…";
        } else if (tNeverRun) {
          tTone = "bg-[#F5F1E4] border-[#E4D9C8] text-[#5B5F4D]";
          tIcon = <Clock className="w-4 h-4" />;
          tLabel = "Copy check not yet run";
        } else if (tStatus === "ok" && tMissingCount === 0) {
          tTone = "bg-[#E7F2ED] border-[#B9DAC9] text-[#2F6E60]";
          tIcon = <ShieldCheck className="w-4 h-4" />;
          tLabel = "All critical copy intact";
        } else if (tStatus === "missing" || tMissingCount > 0) {
          tTone = "bg-[#FBE2E0] border-[#F0B6B0] text-[#7C2D2A]";
          tIcon = <AlertTriangle className="w-4 h-4" />;
          tLabel = `${tMissingCount} copy string${tMissingCount === 1 ? "" : "s"} missing`;
        } else if (tStatus === "timeout") {
          tTone = "bg-[#FDF3E1] border-[#F5D48A] text-[#8C5C00]";
          tIcon = <Clock className="w-4 h-4" />;
          tLabel = "Last copy check timed out";
        } else {
          tTone = "bg-[#FDF3E1] border-[#F5D48A] text-[#8C5C00]";
          tIcon = <AlertTriangle className="w-4 h-4" />;
          tLabel = "Copy check errored";
        }
        return (
          <div className="mt-3" data-testid="admin-text-sentinel-wrapper">
            <div
              data-testid="admin-text-sentinel-badge"
              data-status={textLoading ? "loading" : (tNeverRun ? "never-run" : (tStatus === "ok" && tMissingCount === 0 ? "ok" : (tStatus === "missing" || tMissingCount > 0 ? "missing" : tStatus)))}
              className={`flex items-start gap-3 p-2.5 rounded-lg border ${tTone}`}
            >
              <div className="flex-shrink-0 mt-0.5">{tIcon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs" data-testid="admin-text-sentinel-label">
                  Copy sentinel · {tLabel}
                </p>
                {!textLoading && !tNeverRun && (
                  <p className="text-[11px] mt-0.5 opacity-80" data-testid="admin-text-sentinel-meta">
                    {textRow?.total_checks != null && (
                      <>
                        <span className="tabular-nums">{textRow.total_checks}</span> sentinels checked
                        {" · "}
                      </>
                    )}
                    checked {fmtWhen(textRow?.checked_at)}
                  </p>
                )}
                {textRow?.error && (
                  <p className="text-[11px] mt-1 italic opacity-80" data-testid="admin-text-sentinel-error">{textRow.error}</p>
                )}
              </div>
              <button
                type="button"
                onClick={loadText}
                disabled={textLoading}
                data-testid="admin-text-sentinel-refresh"
                className="p-1 rounded hover:bg-black/5 disabled:opacity-40 flex-shrink-0"
                title="Refresh copy-sentinel status"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${textLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {tShowList && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setTextExpanded((v) => !v)}
                  data-testid="admin-text-sentinel-toggle"
                  aria-expanded={textExpanded}
                  className="inline-flex items-center gap-1 text-xs text-[#5B5F4D] hover:text-[#2C2C2C]"
                >
                  {textExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {textExpanded ? "Hide" : "Show"} missing copy ({tMissing.length})
                </button>
                {textExpanded && (
                  <ul
                    data-testid="admin-text-sentinel-list"
                    className="mt-2 max-h-64 overflow-y-auto rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]"
                  >
                    {tMissing.map((m, i) => (
                      <li
                        key={`${m.surface}-${m.needle}-${i}`}
                        data-testid={`admin-text-sentinel-item-${m.surface}`}
                        className="px-3 py-1.5 text-[11px] text-[#7C2D2A]"
                      >
                        <span className="font-mono text-[#5B5F4D]">{m.surface}</span>
                        {" — "}
                        <span className="font-mono">{JSON.stringify(m.needle)}</span>
                        {m.note && (
                          <span className="text-[#5B5F4D] italic"> · {m.note}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!textLoading && tNeverRun && (
              <p className="mt-2 text-[11px] text-[#5B5F4D] italic">
                Ticks at :23 past each hour. Manual run: <code className="bg-[#FDF3E1] px-1 rounded">python3 /app/scripts/deploy_text_sentinel.py</code>.
              </p>
            )}
          </div>
        );
      })()}
    </Card>
  );
}





// ---------------------------------------------------------------------------
// My library diagnostics (2026-07-10).  Reconcile expected-vs-actual book
// counts after bulk uploads (e.g. the 2,000-book recovery flow).  Scoped
// to the CALLING admin's own user_id — never shows other users' data.

export function DedupRetryCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp } = await api.get("/admin/dedup-retry-stats", { params: { days: d } });
      setData(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load dedup stats");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const maxDaily = data?.daily?.reduce((m, r) => Math.max(m, r.count), 0) || 0;

  return (
    <Card
      icon={ShieldCheck}
      title="Retry dedup guard"
      subtitle="How often the sha256 idempotency check has saved a duplicate upload during network retries."
      testid="admin-dedup-retry-card"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-[#E4D9C8] bg-white overflow-hidden" data-testid="admin-dedup-retry-window">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDays(d); load(d); }}
              disabled={loading}
              data-testid={`admin-dedup-retry-window-${d}`}
              className={`px-2.5 py-1 text-xs font-medium ${days === d ? "bg-[#6B46C1] text-white" : "text-[#5B5F4D] hover:bg-[#FDFBF7]"} disabled:opacity-50`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => load(days)}
          disabled={loading}
          data-testid="admin-dedup-retry-refresh"
          className="p-1.5 rounded hover:bg-black/5 disabled:opacity-40"
          title="Refresh stats"
        >
          <RotateCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <p className="text-xs text-[#A03D33] italic mb-2" data-testid="admin-dedup-retry-error">{error}</p>
      )}
      {!error && !loading && data && (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-serif text-2xl text-[#2C2C2C] tabular-nums" data-testid="admin-dedup-retry-total">
              {data.total.toLocaleString()}
            </span>
            <span className="text-xs text-[#5B5F4D]">
              duplicate upload{data.total === 1 ? "" : "s"} prevented in the last {data.window_days}d
            </span>
          </div>
          {data.total > 0 && (
            <>
              <div className="mb-3">
                <p className="text-[11px] font-semibold text-[#5B5F4D] uppercase tracking-wide mb-1">Daily</p>
                <div className="flex items-end gap-0.5 h-16 rounded border border-[#E4D9C8] bg-[#FBFAF6] p-1" data-testid="admin-dedup-retry-sparkline">
                  {data.daily.map((row) => {
                    const pct = maxDaily > 0 ? (row.count / maxDaily) * 100 : 0;
                    return (
                      <div
                        key={row.date}
                        className="flex-1 min-w-[3px] bg-[#6B46C1] rounded-sm"
                        style={{ height: `${Math.max(pct, row.count > 0 ? 5 : 0)}%` }}
                        title={`${row.date}: ${row.count}`}
                        data-testid={`admin-dedup-retry-bar-${row.date}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3" data-testid="admin-dedup-retry-summary">
                <div className="rounded border border-[#E4D9C8] bg-[#FBFAF6] px-2.5 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Unique users</p>
                  <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid="admin-dedup-retry-unique-users">
                    {data.unique_users.toLocaleString()}
                  </p>
                </div>
                <div className="rounded border border-[#E4D9C8] bg-[#FBFAF6] px-2.5 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Avg per user</p>
                  <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid="admin-dedup-retry-avg-user">
                    {data.unique_users > 0 ? (data.total / data.unique_users).toFixed(1) : "0"}
                  </p>
                </div>
              </div>
              {data.top_users && data.top_users.length > 0 && (
                <div data-testid="admin-dedup-retry-top-users">
                  <p className="text-[11px] font-semibold text-[#5B5F4D] uppercase tracking-wide mb-1">Top users</p>
                  <ul className="rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]">
                    {data.top_users.slice(0, 5).map((row) => (
                      <li key={row.user_id} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs" data-testid={`admin-dedup-retry-user-${row.user_id}`}>
                        <span className="font-mono text-[#2C2C2C] truncate">{row.user_id}</span>
                        <span className="tabular-nums text-[#5B5F4D]">{row.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {data.total === 0 && (
            <p className="text-xs text-[#5B5F4D] italic" data-testid="admin-dedup-retry-empty">
              No retry-dedup hits in this window — the network is calm and clients are landing uploads on the first try.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// Companion to Retry Dedup — walks recent upload_incomplete notifications
// and buckets failures by parsed reason so pipeline bottlenecks surface.

export function UploadFailureInsightsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);
  const [expandedReason, setExpandedReason] = useState(null);

  const load = async (d = days) => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp } = await api.get("/admin/upload-failure-insights", { params: { days: d } });
      setData(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load failure insights");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      icon={AlertTriangle}
      title="Upload failure insights"
      subtitle="Recent upload_incomplete notifications grouped by failure reason — see which pipeline errors are recurring."
      testid="admin-upload-failure-insights-card"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-[#E4D9C8] bg-white overflow-hidden" data-testid="admin-upload-failure-window">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDays(d); load(d); }}
              disabled={loading}
              data-testid={`admin-upload-failure-window-${d}`}
              className={`px-2.5 py-1 text-xs font-medium ${days === d ? "bg-[#6B46C1] text-white" : "text-[#5B5F4D] hover:bg-[#FDFBF7]"} disabled:opacity-50`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => load(days)}
          disabled={loading}
          data-testid="admin-upload-failure-refresh"
          className="p-1.5 rounded hover:bg-black/5 disabled:opacity-40"
          title="Refresh insights"
        >
          <RotateCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <p className="text-xs text-[#A03D33] italic mb-2" data-testid="admin-upload-failure-error">{error}</p>
      )}
      {!error && loading && (
        <div className="space-y-2" data-testid="admin-upload-failure-loading">
          <div className="grid grid-cols-3 gap-2">
            <div className="h-12 rounded border border-[#E4D9C8] bg-[#FBFAF6] animate-pulse" />
            <div className="h-12 rounded border border-[#E4D9C8] bg-[#FBFAF6] animate-pulse" />
            <div className="h-12 rounded border border-[#E4D9C8] bg-[#FBFAF6] animate-pulse" />
          </div>
          <div className="h-16 rounded border border-[#E4D9C8] bg-[#FBFAF6] animate-pulse" />
        </div>
      )}
      {!error && !loading && data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3" data-testid="admin-upload-failure-summary">
            <div className="rounded border border-[#E4D9C8] bg-[#FBFAF6] px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Batches</p>
              <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid="admin-upload-failure-batches">
                {data.total_notifications.toLocaleString()}
              </p>
            </div>
            <div className="rounded border border-[#E4D9C8] bg-[#FBFAF6] px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Files affected</p>
              <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid="admin-upload-failure-files">
                {data.total_files_affected.toLocaleString()}
              </p>
            </div>
            <div className="rounded border border-[#E4D9C8] bg-[#FBFAF6] px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Users hit</p>
              <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid="admin-upload-failure-users">
                {data.unique_users.toLocaleString()}
              </p>
            </div>
          </div>
          {data.vanished_count > 0 && (
            <div
              className="mb-3 rounded border border-[#F1C6BF] bg-[#FBE7E4] px-2.5 py-1.5 text-xs text-[#A03D33]"
              data-testid="admin-upload-failure-vanished"
            >
              <strong>{data.vanished_count.toLocaleString()}</strong> file{data.vanished_count === 1 ? "" : "s"} vanished mid-pipeline (no reason recorded) — worth a look.
            </div>
          )}
          {data.reasons.length > 0 ? (
            <div data-testid="admin-upload-failure-reasons">
              <p className="text-[11px] font-semibold text-[#5B5F4D] uppercase tracking-wide mb-1">By reason</p>
              <ul className="rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]">
                {data.reasons.map((row) => {
                  const isOpen = expandedReason === row.reason;
                  return (
                    <li key={row.reason} data-testid={`admin-upload-failure-reason-row-${row.reason}`}>
                      <button
                        type="button"
                        onClick={() => setExpandedReason(isOpen ? null : row.reason)}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-white/60"
                        data-testid={`admin-upload-failure-reason-toggle-${row.reason}`}
                      >
                        <span className="font-medium text-[#2C2C2C] truncate">{row.reason}</span>
                        <span className="tabular-nums text-[#5B5F4D] shrink-0">{row.count.toLocaleString()}</span>
                      </button>
                      {isOpen && row.examples.length > 0 && (
                        <ul className="px-2.5 pb-2 space-y-0.5" data-testid={`admin-upload-failure-examples-${row.reason}`}>
                          {row.examples.map((fname, i) => (
                            <li key={i} className="text-[11px] font-mono text-[#5B5F4D] truncate pl-3">• {fname}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-[#5B5F4D] italic" data-testid="admin-upload-failure-empty">
              No upload_incomplete notifications in this window — the pipeline has been quiet.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upload Skip Digest (iter 89 rebuild from screenshot).  Weekly rollup of
// files users tried to upload but couldn't — corrupt, duplicate,
// unsupported, capped.  Shows total, reason pills, and top extensions.

export function UploadSkipDigestCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);

  const load = async (d = days) => {
    setLoading(true); setError(null);
    try {
      const { data: resp } = await api.get("/admin/upload-skip-digest", { params: { days: d } });
      setData(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load skip digest");
      setData(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(days); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      icon={AlertTriangle}
      title="Upload skip digest"
      subtitle="Weekly rollup of files users tried to upload but couldn't — corrupt, duplicate, unsupported, capped."
      testid="admin-upload-skip-digest-card"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center rounded-md border border-[#E4D9C8] bg-white overflow-hidden" data-testid="admin-skip-digest-window">
          {[1, 7, 30].map((d) => (
            <button
              key={d} type="button" onClick={() => { setDays(d); load(d); }} disabled={loading}
              data-testid={`admin-skip-digest-window-${d}`}
              className={`px-2.5 py-1 text-xs font-medium ${days === d ? "bg-[#6B46C1] text-white" : "text-[#5B5F4D] hover:bg-[#FDFBF7]"} disabled:opacity-50`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => load(days)} disabled={loading} data-testid="admin-skip-digest-refresh" className="p-1.5 rounded hover:bg-black/5 disabled:opacity-40" title="Refresh">
          <RotateCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && <p className="text-xs text-[#A03D33] italic mb-2" data-testid="admin-skip-digest-error">{error}</p>}
      {!error && !loading && data && (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-serif text-2xl text-[#2C2C2C] tabular-nums" data-testid="admin-skip-digest-total">{data.total.toLocaleString()}</span>
            <span className="text-xs text-[#5B5F4D]">files skipped in the last {data.window_days}d</span>
          </div>
          {data.total === 0 && (
            <p className="text-xs text-[#5B5F4D] italic" data-testid="admin-skip-digest-empty">
              No upload skips in this window — the pipeline has been quiet.
            </p>
          )}
          {data.reasons && data.reasons.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3" data-testid="admin-skip-digest-reasons">
              {data.reasons.map((r) => (
                <span
                  key={r.reason}
                  data-testid={`admin-skip-digest-reason-${r.reason}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#B7791F]/40 bg-[#B7791F]/10 text-xs text-[#B7791F]"
                >
                  {r.reason}: {r.count}
                </span>
              ))}
            </div>
          )}
          {data.corrupt_zero_bytes > 0 && (
            <p className="text-[11px] text-[#A03D33] mb-3" data-testid="admin-skip-digest-corrupt-note">
              {data.corrupt_zero_bytes.toLocaleString()} of those were corrupt or 0-byte files.
            </p>
          )}
          {data.extensions && data.extensions.length > 0 && (
            <div data-testid="admin-skip-digest-extensions">
              <p className="text-[11px] font-semibold text-[#5B5F4D] uppercase tracking-wide mb-1">Top extensions</p>
              <ul className="rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]">
                {data.extensions.map((e) => (
                  <li key={e.ext} className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs">
                    <span className="font-mono text-[#2C2C2C]">{e.ext}</span>
                    <span className="tabular-nums text-[#5B5F4D]">{e.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// R2 Storage & Orphans (iter 89 rebuild from screenshot).  Cloudflare R2
// usage snapshot with GB stored, object count, estimated monthly cost,
// top users by storage, and a one-click orphan-scan button.

export function R2StorageCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [purging, setPurging] = useState(false);
  // 2026-08-16 — Type-to-confirm purge dialog.  Admin must type
  // "PURGE" exactly before the destructive delete_objects call can
  // fire, so a mis-click on the red button never nukes the bucket.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  // 2026-08-18 — Age filter for the destructive purge.  Default 0
  // (all orphans).  Preset chips of 0/7/30/90/365 days let the admin
  // narrow the sweep to just long-abandoned junk without wiping
  // recent uploads that may still be mid-processing.  Counts +
  // bytes per bucket come from scanResult.age_buckets so the modal
  // updates instantly without another R2 sweep.
  const [minAgeDays, setMinAgeDays] = useState(0);
  const filteredBucket = (scanResult?.age_buckets && scanResult.age_buckets[String(minAgeDays)]) || null;
  const filteredCount = filteredBucket ? filteredBucket.count : (scanResult?.orphans_found || 0);
  const filteredBytes = filteredBucket ? filteredBucket.bytes : (scanResult?.bytes_recoverable || 0);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data: resp } = await api.get("/admin/storage/report");
      setData(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load storage report");
      setData(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const { data: resp } = await api.post("/admin/storage/orphans/scan");
      setScanResult(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Scan failed");
    } finally { setScanning(false); }
  };
  const runPurge = async () => {
    setPurging(true);
    try {
      const { data: resp } = await api.post(`/admin/storage/orphans/purge?min_age_days=${minAgeDays}`);
      setScanResult({ ...(scanResult || {}), purged: resp.purged, bytes_freed: resp.bytes_freed });
      setConfirmOpen(false);
      setConfirmText("");
      setMinAgeDays(0);
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || "Purge failed");
    } finally { setPurging(false); }
  };

  return (
    <Card
      icon={UploadCloud}
      title="R2 storage & orphans"
      subtitle="Cloudflare R2 usage, estimated monthly cost, and one-click orphan file cleanup."
      testid="admin-r2-storage-card"
    >
      {error && <p className="text-xs text-[#A03D33] italic mb-2" data-testid="admin-r2-storage-error">{error}</p>}
      {!error && loading && (
        <div className="animate-pulse space-y-3" data-testid="admin-r2-storage-loading">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="h-2.5 w-16 bg-[#EAE4D8] rounded mb-2" />
                <div className="h-6 w-24 bg-[#EEE9FB] rounded" />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#5B5F4D] italic">Fetching live R2 bucket stats… first load can take a few seconds.</p>
        </div>
      )}
      {!error && !loading && data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4" data-testid="admin-r2-storage-stats">
            <div>
              <p className="font-serif text-2xl text-[#2C2C2C] tabular-nums" data-testid="admin-r2-storage-bytes">{fmtBytes(data.total_bytes)}</p>
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Stored</p>
            </div>
            <div>
              <p className="font-serif text-2xl text-[#2C2C2C] tabular-nums" data-testid="admin-r2-storage-objects">{data.total_objects.toLocaleString()}</p>
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Objects</p>
            </div>
            <div>
              <p className="font-serif text-2xl text-[#2C2C2C] tabular-nums" data-testid="admin-r2-storage-cost">${data.est_monthly_cost.toFixed(2)}</p>
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Est. /month</p>
            </div>
          </div>
          {data.top_users && data.top_users.length > 0 && (
            <div className="mb-4" data-testid="admin-r2-top-users">
              <p className="text-[11px] font-semibold text-[#5B5F4D] uppercase tracking-wide mb-1">Top users by storage</p>
              <ul className="rounded border border-[#E4D9C8] bg-[#FBFAF6] divide-y divide-[#E4D9C8]">
                {data.top_users.map((row) => (
                  <li key={row.user_id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <span className="font-mono text-[#2C2C2C] truncate">{row.user_id}</span>
                    <span className="tabular-nums text-[#5B5F4D] shrink-0">{fmtBytes(row.bytes)} · {row.objects.toLocaleString()} obj</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={runScan} disabled={scanning}
              data-testid="admin-r2-orphan-scan"
              className="px-4 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-semibold hover:bg-[#4C2A99] disabled:opacity-40 transition-colors"
            >
              {scanning ? "Scanning…" : "Scan for orphans"}
            </button>
            {scanResult && scanResult.orphans_found > 0 && (
              <button
                type="button"
                onClick={() => { setConfirmOpen(true); setConfirmText(""); }}
                disabled={purging}
                data-testid="admin-r2-orphan-purge"
                className="px-4 py-1.5 rounded-full bg-[#A03D33] text-white text-xs font-semibold hover:bg-[#7A2E27] disabled:opacity-40 transition-colors"
              >
                {purging ? "Purging…" : `Purge ${scanResult.orphans_found}`}
              </button>
            )}
          </div>
          {confirmOpen && scanResult && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              data-testid="admin-r2-purge-confirm"
              onClick={(e) => { if (e.target === e.currentTarget) { setConfirmOpen(false); setConfirmText(""); } }}
            >
              <div className="w-full max-w-md rounded-lg border border-[#E4D9C8] bg-white shadow-2xl p-5">
                <h3 className="font-serif text-xl text-[#2C2C2C] mb-1">Permanently delete orphaned files?</h3>
                <p className="text-xs text-[#5B5F4D] mb-3">
                  This will remove <strong className="text-[#A03D33]" data-testid="admin-r2-purge-orphan-count">{filteredCount.toLocaleString()}</strong>{" "}
                  R2 object{filteredCount === 1 ? "" : "s"} totalling{" "}
                  <strong className="text-[#A03D33]" data-testid="admin-r2-purge-bytes">{fmtBytes(filteredBytes)}</strong>.
                  These files have no matching book in the database and can&rsquo;t be recovered after deletion.
                </p>
                {scanResult.age_buckets && (
                  <div className="mb-3" data-testid="admin-r2-purge-age-filter">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-[#5B5F4D] mb-1">Only purge files older than</p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { days: 0,   label: "Any age" },
                        { days: 7,   label: "7d+" },
                        { days: 30,  label: "30d+" },
                        { days: 90,  label: "90d+" },
                        { days: 365, label: "1y+" },
                      ].map((opt) => {
                        const bucket = scanResult.age_buckets[String(opt.days)] || { count: 0, bytes: 0 };
                        const active = minAgeDays === opt.days;
                        return (
                          <button
                            key={opt.days}
                            type="button"
                            onClick={() => setMinAgeDays(opt.days)}
                            data-testid={`admin-r2-purge-age-${opt.days}`}
                            aria-pressed={active}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                              active
                                ? "border-[#A03D33] bg-[#A03D33] text-white"
                                : "border-[#E4D9C8] bg-white text-[#5B5F4D] hover:bg-[#F5F3EC]"
                            }`}
                          >
                            {opt.label} <span className="opacity-70">· {bucket.count.toLocaleString()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {scanResult.top_affected_users && scanResult.top_affected_users.length > 0 ? (
                  <div className="mb-3" data-testid="admin-r2-purge-affected-users">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-[#5B5F4D] mb-1">
                      Users losing files in THIS purge
                    </p>
                    <ul className="rounded border border-[#A03D33]/40 bg-[#FBF3F1] divide-y divide-[#F0D9D3] max-h-32 overflow-auto">
                      {scanResult.top_affected_users.slice(0, 5).map((row) => (
                        <li
                          key={row.user_id}
                          className="flex items-center justify-between gap-2 px-2.5 py-1 text-[11px]"
                          data-testid={`admin-r2-purge-affected-${row.user_id}`}
                        >
                          <span className="font-mono text-[#2C2C2C] truncate">{row.user_id}</span>
                          <span className="tabular-nums text-[#A03D33] font-semibold shrink-0">
                            {fmtBytes(row.bytes)} · {row.objects} file{row.objects === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {scanResult.top_affected_users.length > 5 && (
                      <p className="mt-1 text-[10px] text-[#5B5F4D] italic">
                        …and {scanResult.top_affected_users.length - 5} more.
                      </p>
                    )}
                  </div>
                ) : null}
                {scanResult.sample && scanResult.sample.length > 0 && (
                  <div className="mb-3" data-testid="admin-r2-purge-sample">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-[#5B5F4D] mb-1">Sample keys to be deleted</p>
                    <ul className="rounded border border-[#E4D9C8] bg-[#FBFAF6] max-h-24 overflow-auto text-[10px] font-mono text-[#5B5F4D]">
                      {scanResult.sample.map((k) => (
                        <li key={k} className="px-2 py-0.5 truncate" title={k}>{k}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {scanResult.sweep_capped && (
                  <p className="text-[11px] text-[#8B6E1D] bg-[#FBF6E4] border border-[#EFE2B8] rounded px-2 py-1 mb-3" data-testid="admin-r2-purge-capped-warn">
                    Note: this scan was capped at 25,000 keys — the bucket may contain more orphans that a re-scan after purge will find.
                  </p>
                )}
                <label className="block text-xs text-[#2C2C2C] mb-1">
                  Type <span className="font-mono font-semibold text-[#A03D33]">PURGE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  data-testid="admin-r2-purge-confirm-input"
                  placeholder="PURGE"
                  className="w-full px-2 py-1.5 text-sm font-mono border border-[#E4D9C8] rounded focus:outline-none focus:border-[#A03D33] focus:ring-1 focus:ring-[#A03D33]/40"
                />
                <div className="flex items-center justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
                    data-testid="admin-r2-purge-cancel"
                    className="px-4 py-1.5 rounded-full border border-[#E4D9C8] text-xs font-semibold text-[#5B5F4D] hover:bg-[#F5F3EC] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runPurge}
                    disabled={confirmText !== "PURGE" || purging || filteredCount === 0}
                    data-testid="admin-r2-purge-confirm-btn"
                    className="px-4 py-1.5 rounded-full bg-[#A03D33] text-white text-xs font-semibold hover:bg-[#7A2E27] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {purging ? "Purging…" : "Yes, delete permanently"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {scanResult && (
            <p className="text-xs text-[#5B5F4D] mt-2" data-testid="admin-r2-orphan-result">
              {scanResult.purged != null
                ? `Purged ${scanResult.purged} orphan${scanResult.purged === 1 ? "" : "s"}, freed ${fmtBytes(scanResult.bytes_freed || 0)}.`
                : scanResult.orphans_found === 0
                  ? "No orphans found — R2 is clean."
                  : `Found ${scanResult.orphans_found} orphan${scanResult.orphans_found === 1 ? "" : "s"} (${fmtBytes(scanResult.bytes_recoverable)} recoverable).`}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

