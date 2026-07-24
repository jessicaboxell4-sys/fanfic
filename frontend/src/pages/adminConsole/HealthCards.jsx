/**
 * HealthCards — extracted 2026-08-18 from AdminConsole.jsx.
 *
 * Cards: AntivirusCard, LibraryDiagnosticsCard, StuckUploadsCard, ClientErrorPulseCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronRight, Copy, HardDrive, Inbox, LineChart, Loader2, RotateCcw, Server, ShieldAlert, Trash, Upload, Users, X as XIcon } from "lucide-react";
import { Card, fmtBytes, fmtTime, fmtAgo } from "./shared";
import { getNudgePref, subscribeToNudgePrefs } from "../../lib/nudgePrefs";

export function AntivirusCard() {
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
// NOTE: Storage-cluster cards (SavingsLine, R2MigrationProgressCard,
// OrphanCleanupCard, StorageByUserCard, StorageTrendCard) were moved
// to ./adminConsole/StorageCards.jsx in the Phase 6C-A refactor
// (2026-07-XX). Imported at the top of this file.

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

export function LibraryDiagnosticsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [justCleaned, setJustCleaned] = useState(false);
  const [celebrate, setCelebrate] = useState(() =>
    getNudgePref("celebrate_clean_duplicates"),
  );

  // Keep in sync when the operator flips the toggle in the central
  // "Notification preferences" card.
  useEffect(() => {
    const unsub = subscribeToNudgePrefs((key, value) => {
      if (key === "celebrate_clean_duplicates") {
        setCelebrate(value);
        if (!value) setJustCleaned(false);
      }
    });
    return unsub;
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp } = await api.get("/admin/my-library-diagnostics");
      // --- Celebration: excess just transitioned from >0 to 0 ---------------
      // Gated by the `celebrate_clean_duplicates` nudge pref so operators
      // who don't want the dopamine hit can silence it centrally.
      try {
        const KEY = "shelfsort.diagnostics.lastExcess";
        const prevRaw = window.localStorage.getItem(KEY);
        const prev = prevRaw == null ? null : parseInt(prevRaw, 10);
        const nextExcess = resp?.duplicates?.excess ?? 0;
        if (celebrate && prev != null && prev > 0 && nextExcess === 0) {
          toast.success("🎉 All duplicates resolved! Your library is squeaky clean.", { duration: 6000 });
          setJustCleaned(true);
          setTimeout(() => setJustCleaned(false), 20000);
        }
        window.localStorage.setItem(KEY, String(nextExcess));
      } catch { /* localStorage unavailable — silent */ }
      setData(resp);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const copyReport = () => {
    if (!data) return;
    const lines = [
      `=== Library Diagnostics (${data.generated_at}) ===`,
      `User: ${data.user_id}`,
      ``,
      `Totals:`,
      `  All (incl. trash): ${data.totals.all}`,
      `  On the shelves:    ${data.totals.non_trash}`,
      `  In trash:          ${data.totals.trash}`,
      ``,
      `Cadence:`,
      `  Last 24h: ${data.cadence.last_24h}`,
      `  Last 48h: ${data.cadence.last_48h}`,
      `  Last 7d:  ${data.cadence.last_7d}`,
      `  Last 30d: ${data.cadence.last_30d}`,
      ``,
      `Duplicates: ${data.duplicates.groups} groups / ${data.duplicates.books_in_groups} books / ${data.duplicates.excess} excess`,
      `Recent upload failures (7d): ${data.recent_failures_count}`,
      ``,
      `Top categories:`,
      ...data.by_category.map((c) => `  ${String(c.name).padEnd(24)} ${c.count}`),
      ``,
      `Last 14 days:`,
      ...data.by_day_last_14.map((d) => `  ${d.day}  ${d.count}`),
    ].join("\n");
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <Card
      icon={LineChart}
      title="My library diagnostics"
      subtitle="Reconcile expected vs actual book counts for your own account after bulk uploads."
      testid="admin-library-diagnostics-card"
    >
      {loading && (
        <div className="flex items-center gap-2 text-sm text-[#5B5F4D]" data-testid="admin-library-diagnostics-loading">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {error && !loading && (
        <div
          data-testid="admin-library-diagnostics-error"
          className="p-3 rounded bg-[#FBE2E0] border border-[#F0B6B0] text-[#7C2D2A] text-sm"
        >
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-4">
          {/* Totals */}
          <div className="grid grid-cols-3 gap-2" data-testid="admin-library-diagnostics-totals">
            <div className="p-3 rounded bg-[#F5F1E4] border border-[#E4D9C8]">
              <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">All books</p>
              <p className="text-2xl font-serif tabular-nums text-[#2C2C2C]" data-testid="admin-diag-total-all">
                {data.totals.all.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded bg-[#E7F2ED] border border-[#B9DAC9]">
              <p className="text-[10px] uppercase tracking-wide text-[#2F6E60]">On shelves</p>
              <p className="text-2xl font-serif tabular-nums text-[#2F6E60]" data-testid="admin-diag-total-shelves">
                {data.totals.non_trash.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded bg-[#FBE2E0] border border-[#F0B6B0]">
              <p className="text-[10px] uppercase tracking-wide text-[#7C2D2A]">In trash</p>
              <p className="text-2xl font-serif tabular-nums text-[#7C2D2A]" data-testid="admin-diag-total-trash">
                {data.totals.trash.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Cadence */}
          <div className="grid grid-cols-4 gap-2 text-sm" data-testid="admin-library-diagnostics-cadence">
            {[
              { label: "24h", key: "last_24h" },
              { label: "48h", key: "last_48h" },
              { label: "7d", key: "last_7d" },
              { label: "30d", key: "last_30d" },
            ].map((b) => (
              <div key={b.key} className="p-2 rounded bg-[#FBFAF6] border border-[#E4D9C8] text-center">
                <p className="text-[10px] uppercase tracking-wide text-[#5B5F4D]">Added last {b.label}</p>
                <p className="font-serif text-lg tabular-nums text-[#2C2C2C]" data-testid={`admin-diag-cadence-${b.key}`}>
                  {data.cadence[b.key].toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {/* Duplicates */}
          <div
            data-testid="admin-library-diagnostics-duplicates"
            className={`p-3 rounded border text-sm ${
              data.duplicates.groups === 0
                ? "bg-[#E7F2ED] border-[#B9DAC9] text-[#2F6E60]"
                : "bg-[#FDF3E1] border-[#F5D48A] text-[#8C5C00]"
            }`}
          >
            <p className="font-semibold">
              {data.duplicates.groups === 0
                ? "No likely duplicate groups detected."
                : `${data.duplicates.groups} duplicate group${data.duplicates.groups === 1 ? "" : "s"} · ${data.duplicates.excess} excess book${data.duplicates.excess === 1 ? "" : "s"} could be removed`}
            </p>
            {justCleaned && data.duplicates.groups === 0 && (
              <p
                data-testid="admin-library-diagnostics-just-cleaned"
                className="mt-1 text-[11px] font-medium text-[#2F6E60]"
              >
                🎉 You just cleaned this up. Empty Trash next to reclaim the storage.
              </p>
            )}
            <p className="text-[11px] mt-0.5 opacity-80">
              Match by normalized title + author or shared source URL. Use the <em>Duplicates</em> page in the library to review.
            </p>
          </div>

          {/* Category breakdown */}
          <details className="rounded border border-[#E4D9C8] bg-[#FBFAF6]">
            <summary
              className="px-3 py-2 text-sm cursor-pointer text-[#2C2C2C] font-medium"
              data-testid="admin-library-diagnostics-categories-toggle"
            >
              Top categories ({data.by_category.length})
            </summary>
            <ul className="divide-y divide-[#E4D9C8]" data-testid="admin-library-diagnostics-categories-list">
              {data.by_category.map((c) => (
                <li key={c.name} className="px-3 py-1.5 flex items-center justify-between text-sm">
                  <span className="text-[#2C2C2C]">{c.name}</span>
                  <span className="tabular-nums text-[#5B5F4D]">{c.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </details>

          {/* Per-day histogram */}
          {data.by_day_last_14.length > 0 && (
            <details className="rounded border border-[#E4D9C8] bg-[#FBFAF6]">
              <summary
                className="px-3 py-2 text-sm cursor-pointer text-[#2C2C2C] font-medium"
                data-testid="admin-library-diagnostics-days-toggle"
              >
                Added last 14 days ({data.by_day_last_14.length} active days)
              </summary>
              <ul className="divide-y divide-[#E4D9C8]" data-testid="admin-library-diagnostics-days-list">
                {data.by_day_last_14.map((d) => (
                  <li key={d.day} className="px-3 py-1.5 flex items-center justify-between text-sm">
                    <span className="text-[#2C2C2C] font-mono text-[11px]">{d.day}</span>
                    <span className="tabular-nums text-[#5B5F4D]">{d.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Recent upload jobs */}
          {data.recent_upload_jobs.length > 0 && (
            <details className="rounded border border-[#E4D9C8] bg-[#FBFAF6]">
              <summary
                className="px-3 py-2 text-sm cursor-pointer text-[#2C2C2C] font-medium"
                data-testid="admin-library-diagnostics-jobs-toggle"
              >
                Recent upload jobs (last 7d, top {data.recent_upload_jobs.length})
              </summary>
              <ul className="divide-y divide-[#E4D9C8]" data-testid="admin-library-diagnostics-jobs-list">
                {data.recent_upload_jobs.map((j, i) => (
                  <li key={i} className="px-3 py-1.5 text-xs text-[#5B5F4D]">
                    <span className="tabular-nums">{String(j.created_at || "").replace("T", " ").slice(0, 16)}</span>
                    {" · "}<span className="font-medium">{j.status}</span>
                    {" · "}{j.processed_files || 0}/{j.total_files || 0} processed
                    {j.duplicate_count ? ` · ${j.duplicate_count} dupes` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {data.recent_failures_count > 0 && (
            <div className="p-2 rounded bg-[#FDF3E1] border border-[#F5D48A] text-[11px] text-[#8C5C00]" data-testid="admin-library-diagnostics-failures">
              <strong>{data.recent_failures_count}</strong> upload failures logged in the last 7 days.
            </div>
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <button
              type="button"
              onClick={load}
              data-testid="admin-library-diagnostics-refresh"
              className="px-3 py-1.5 text-xs rounded bg-[#F5F1E4] border border-[#E4D9C8] hover:bg-[#E4D9C8] text-[#2C2C2C] inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Refresh
            </button>
            <button
              type="button"
              onClick={copyReport}
              data-testid="admin-library-diagnostics-copy"
              className="px-3 py-1.5 text-xs rounded bg-[#F5F1E4] border border-[#E4D9C8] hover:bg-[#E4D9C8] text-[#2C2C2C]"
            >
              {copied ? "Copied ✓" : "Copy report"}
            </button>
            <span className="ml-auto text-[10px] text-[#5B5F4D] italic">
              Manage the 🎉 toast in the <em>Notification preferences</em> card.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences (2026-07-12).  Central home for every in-app
// nudge/celebration toast defined in ../lib/nudgePrefs.  Adding a new
// entry to NUDGE_PREFS automatically renders a toggle here — no UI
// changes required.

export function StuckUploadsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recovering, setRecovering] = useState(false);

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/admin/upload-jobs/stuck?threshold_minutes=10");
      setData(data);
    } catch (e) {
      if (!silent) setError(e?.response?.data?.detail || e.message || "Failed to load stuck uploads");
    } finally {
      if (!silent) setLoading(false);
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

  // 2026-07-01 — Tightened from 60s -> 15s and moved to silent refresh so
  // the "Loading…" placeholder doesn't flash every tick.  Skips ticks
  // while a recovery-now click is in flight to avoid racing the response.
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (recovering) return;
      load({ silent: true });
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovering]);

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

export function ClientErrorPulseCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [windowHours, setWindowHours] = useState(24);

  const load = async (hours = windowHours) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/admin/client-errors/recent?hours=${hours}&limit=20`);
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load crash pulse");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(windowHours);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(windowHours);
    }, 60_000);
    return () => clearInterval(id);
  }, [windowHours]);

  const totals = data?.totals || {};
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const empty = !loading && !error && groups.length === 0;

  return (
    <Card
      icon={AlertTriangle}
      title="Crash pulse"
      subtitle="Client-side render errors captured by AppErrorBoundary. Empty = good."
      testid="admin-crash-pulse-card"
    >
      {/* Window selector */}
      <div className="flex items-center gap-1 mb-3" data-testid="crash-pulse-window-selector">
        {[24, 72, 168].map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setWindowHours(h)}
            className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
              windowHours === h
                ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                : "bg-white text-[#2C2C2C] border-[#E4D9C8] hover:bg-[#FDFBF7]"
            }`}
            data-testid={`crash-pulse-window-${h}h`}
          >
            {h === 24 ? "24h" : h === 72 ? "3d" : "7d"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => load(windowHours)}
          className="ml-auto text-[11px] px-2 py-1 rounded-md border border-[#E4D9C8] bg-white hover:bg-[#FDFBF7]"
          disabled={loading}
          data-testid="crash-pulse-refresh"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#7C2D2A] py-3" data-testid="crash-pulse-error">
          ✗ {error}
        </p>
      )}

      {empty && (
        <p className="text-xs text-[#5B5F4D] py-6 text-center" data-testid="crash-pulse-empty">
          No client-side crashes in the last {windowHours === 24 ? "24 hours" : windowHours === 72 ? "3 days" : "7 days"}. Quiet skies.
        </p>
      )}

      {data && groups.length > 0 && (
        <div className="space-y-3">
          {/* Headline totals */}
          <div className="grid grid-cols-3 gap-2 text-center" data-testid="crash-pulse-totals">
            <div className="rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] py-2 px-1">
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="crash-pulse-total-events">
                {totals.events ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                crashes
              </p>
            </div>
            <div className="rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] py-2 px-1">
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="crash-pulse-unique-users">
                {totals.unique_users ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                users hit
              </p>
            </div>
            <div className="rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] py-2 px-1">
              <p className="font-serif text-2xl text-[#2C2C2C]" data-testid="crash-pulse-unique-pages">
                {totals.unique_pages ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B5F4D] mt-0.5">
                pages
              </p>
            </div>
          </div>

          {/* Per-group rows */}
          <ul className="space-y-1.5" data-testid="crash-pulse-groups">
            {groups.map((g, i) => {
              const key = `${g.message}::${g.href}`;
              const isOpen = expandedKey === key;
              const pagePath = (() => {
                try {
                  return new URL(g.href).pathname || g.href;
                } catch {
                  return g.href || "(unknown)";
                }
              })();
              return (
                <li
                  key={key}
                  className="rounded-lg bg-white border border-[#E5DDC5] overflow-hidden"
                  data-testid={`crash-pulse-row-${i}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedKey(isOpen ? null : key)}
                    className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[#FDFBF7] transition-colors"
                  >
                    <span
                      className="shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded-full bg-[#FBE7E4] text-[#A03D33] text-xs font-bold"
                      data-testid={`crash-pulse-row-count-${i}`}
                    >
                      {g.count}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-xs text-[#2C2C2C] font-mono truncate"
                        title={g.message}
                        data-testid={`crash-pulse-row-message-${i}`}
                      >
                        {g.message || "(no message)"}
                      </p>
                      <p className="text-[11px] text-[#5B5F4D] truncate">
                        <code className="font-mono">{pagePath}</code>
                        <span className="mx-1 text-[#7A7461]">·</span>
                        {g.unique_users} user{g.unique_users === 1 ? "" : "s"}
                        <span className="mx-1 text-[#7A7461]">·</span>
                        last seen {fmtTime(g.last_seen)}
                      </p>
                    </div>
                    <span className="text-[11px] text-[#6B46C1] shrink-0">{isOpen ? "Hide" : "Details"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2 bg-[#FBF7EE] border-t border-[#E5DDC5] text-[11px] text-[#3A3A3A] space-y-2" data-testid={`crash-pulse-row-details-${i}`}>
                      {g.sample_component_stack && (
                        <div>
                          <p className="font-semibold text-[#5B5F4D] mb-1">Component stack:</p>
                          <pre className="whitespace-pre-wrap font-mono text-[10px] bg-white border border-[#E5DDC5] rounded p-2 max-h-32 overflow-auto">
                            {g.sample_component_stack}
                          </pre>
                        </div>
                      )}
                      {g.sample_stack && (
                        <div>
                          <p className="font-semibold text-[#5B5F4D] mb-1">Stack trace (one sample):</p>
                          <pre className="whitespace-pre-wrap font-mono text-[10px] bg-white border border-[#E5DDC5] rounded p-2 max-h-32 overflow-auto">
                            {g.sample_stack}
                          </pre>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#5B5F4D] pt-1">
                        <span>first seen {fmtTime(g.first_seen)}</span>
                        {g.sample_user_agent && (
                          <span className="truncate max-w-[16rem]" title={g.sample_user_agent}>
                            UA: {g.sample_user_agent}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}


// ---------------------------------------------------------------------------
// AttributionCard (2026-07-01) — where are new visitors finding Shelfsort?
// Pulls /api/admin/attribution/summary; renders top referrer domains + top
// UTM campaigns with a signup-conversion column.  Users list can also link
// individual users to their full visit timeline via
// /api/admin/attribution/user/{user_id}.
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// PodMemorySparkline + PodMemoryPill (extracted 2026-07-20 from AdminConsole.jsx)
//
// PodMemoryPill: compact pill in the AdminConsole header showing current
// pod memory %.  Click expands a 48h sparkline popover with peak, sample
// count, and deploy-boundary markers.  Polls /health every 30s;
// history from /admin/pod-memory/history?hours=48 on first popover open.
// ---------------------------------------------------------------------------

function PodMemorySparkline({ points, deploys = [], warnPct = 80, infoPct = 60 }) {
  // Inline SVG so we don't pull in a charting lib for one popover.
  const W = 320, H = 80, PAD_L = 30, PAD_R = 6, PAD_T = 8, PAD_B = 16;
  if (!points || points.length < 2) {
    return (
      <p className="text-xs text-[#5B5F4D] italic py-8 text-center" data-testid="admin-pod-memory-sparkline-empty">
        Not enough data yet — canary needs a few minutes to warm up.
      </p>
    );
  }
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const times = points.map((p) => new Date(p.t).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const tSpan = Math.max(1, tMax - tMin);
  const xForT = (ms) => PAD_L + ((ms - tMin) / tSpan) * innerW;
  const xs = times.map(xForT);
  // Y is % — always 0..100 so operator sees the warn/info bands in context.
  const yFor = (pct) => PAD_T + innerH - (Math.max(0, Math.min(100, pct)) / 100) * innerH;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]},${yFor(p.pct || 0)}`).join(" ");
  const areaPath = `${linePath} L${xs[xs.length - 1]},${PAD_T + innerH} L${xs[0]},${PAD_T + innerH} Z`;
  const first = new Date(times[0]);
  const last  = new Date(times[times.length - 1]);
  const fmtTs = (d) => d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  // Deploy-boundary markers — only draw ones inside the visible time span.
  const deployMarkers = (deploys || [])
    .map((d) => ({ x: xForT(new Date(d.t).getTime()), boot_id: d.boot_id, t: d.t }))
    .filter((m) => m.x >= PAD_L && m.x <= W - PAD_R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" data-testid="admin-pod-memory-sparkline">
      {/* threshold bands */}
      <rect x={PAD_L} y={yFor(100)} width={innerW} height={yFor(warnPct) - yFor(100)} fill="#FBE2E0" opacity="0.55" />
      <rect x={PAD_L} y={yFor(warnPct)} width={innerW} height={yFor(infoPct) - yFor(warnPct)} fill="#FBF1D9" opacity="0.55" />
      <rect x={PAD_L} y={yFor(infoPct)} width={innerW} height={yFor(0) - yFor(infoPct)} fill="#F4F8F0" opacity="0.4" />
      {/* Y-axis tick labels */}
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yFor(v)} y2={yFor(v)} stroke="#E5DDC5" strokeWidth="0.5" strokeDasharray="2,3" />
          <text x={PAD_L - 4} y={yFor(v) + 3} fontSize="9" fill="#7A7457" textAnchor="end">{v}%</text>
        </g>
      ))}
      {/* Deploy-boundary markers — vertical dashed lines with a small
          triangle at the top so the operator can spot them without
          learning yet another chart convention. */}
      {deployMarkers.map((m, i) => (
        <g key={`deploy-${i}`} data-testid={`admin-pod-memory-deploy-marker-${i}`}>
          <line
            x1={m.x} x2={m.x}
            y1={PAD_T} y2={PAD_T + innerH}
            stroke="#6B46C1" strokeWidth="1" strokeDasharray="2,2" opacity="0.7"
          />
          <polygon
            points={`${m.x - 3},${PAD_T} ${m.x + 3},${PAD_T} ${m.x},${PAD_T + 4}`}
            fill="#6B46C1"
          >
            <title>{`Deploy · boot_id ${m.boot_id?.slice(0, 8)} · ${new Date(m.t).toLocaleString()}`}</title>
          </polygon>
        </g>
      ))}
      {/* filled area under the line */}
      <path d={areaPath} fill="#6B46C1" opacity="0.12" />
      {/* the line itself */}
      <path d={linePath} fill="none" stroke="#6B46C1" strokeWidth="1.5" />
      {/* X-axis first/last timestamps */}
      <text x={PAD_L} y={H - 2} fontSize="9" fill="#7A7457" textAnchor="start">{fmtTs(first)}</text>
      <text x={W - PAD_R} y={H - 2} fontSize="9" fill="#7A7457" textAnchor="end">{fmtTs(last)}</text>
    </svg>
  );
}

export function PodMemoryPill() {
  const [snap, setSnap] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/health");
        if (!cancelled) setSnap(data?.checks?.pod_memory || null);
      } catch { /* silent — pill just doesn't render */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get("/admin/pod-memory/history?hours=48");
      setHistory(data);
    } catch {
      toast.error("Couldn't load pod memory history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const togglePopover = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !history) loadHistory();
  };

  if (!snap || snap.available === false) return null;
  const pct = typeof snap.pct === "number" ? snap.pct : null;
  if (pct === null) return null;

  const tier =
    pct >= 80 ? { bg: "bg-[#FBE2E0] dark:bg-red-950/40", border: "border-[#E8B5B0] dark:border-red-800/50", text: "text-[#7C2D2A] dark:text-red-200", dot: "bg-[#C5564B]" } :
    pct >= 60 ? { bg: "bg-[#FBF1D9] dark:bg-amber-950/40", border: "border-[#E8CFA0] dark:border-amber-700/50", text: "text-[#7A5B1F] dark:text-amber-200", dot: "bg-[#D48F2C]" } :
                { bg: "bg-[#F4F8F0] dark:bg-emerald-950/40", border: "border-[#D6E0CC] dark:border-emerald-800/50", text: "text-[#3A4A2E] dark:text-emerald-200", dot: "bg-[#5C8A5C]" };

  const usedMb = typeof snap.used_mb === "number" ? snap.used_mb.toFixed(0) : "?";
  const limitMb = typeof snap.limit_mb === "number" ? snap.limit_mb.toFixed(0) : "?";
  const limitGb = typeof snap.limit_mb === "number" ? (snap.limit_mb / 1024).toFixed(1) : "?";
  const peak = history?.peak_pct;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={togglePopover}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-[0.15em] hover:brightness-95 transition ${tier.bg} ${tier.border} ${tier.text}`}
        title={`Pod memory: ${usedMb} MB / ${limitMb} MB (${pct}% of the K8s cgroup limit).  Click for 48h history.`}
        data-testid="admin-pod-memory-pill"
        aria-expanded={expanded}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${tier.dot}`} aria-hidden="true" />
        <HardDrive className="w-3.5 h-3.5" />
        <span data-testid="admin-pod-memory-pct">Pod: {pct}%</span>
        <span className="text-[10px] opacity-70">/ {limitGb} GB</span>
      </button>
      {expanded && (
        <div
          className="absolute top-full right-0 mt-2 w-[360px] max-w-[92vw] z-50 bg-white border border-[#E5DDC5] rounded-2xl shadow-xl p-4"
          data-testid="admin-pod-memory-popover"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">Pod memory · last 48h</p>
              <p className="font-serif text-xl text-[#2C2C2C] leading-tight" data-testid="admin-pod-memory-popover-current">
                {pct}% <span className="text-[#7A7457] text-sm font-sans">({usedMb} / {limitMb} MB)</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[#7A7457] hover:text-[#2C2C2C] p-1"
              aria-label="Close"
              data-testid="admin-pod-memory-popover-close"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          {historyLoading ? (
            <p className="text-xs text-[#5B5F4D] italic py-6 text-center">Loading history…</p>
          ) : (
            <>
              <PodMemorySparkline points={history?.points || []} deploys={history?.deploys || []} />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-2 py-1.5">
                  <p className="text-[#7A7457]">48h peak</p>
                  <p className="font-semibold text-[#2C2C2C]" data-testid="admin-pod-memory-peak">
                    {typeof peak === "number" ? `${peak}%` : "—"}
                  </p>
                </div>
                <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-2 py-1.5">
                  <p className="text-[#7A7457]">Samples</p>
                  <p className="font-semibold text-[#2C2C2C]" data-testid="admin-pod-memory-sample-count">
                    {history?.points?.length ?? 0}{history?.downsampled ? " (peak-bucketed)" : ""}
                  </p>
                </div>
              </div>
              {history?.deploys?.length > 0 && (
                <p className="mt-2 text-[10px] text-[#7A7457] flex items-center gap-1.5" data-testid="admin-pod-memory-deploy-legend">
                  <span className="inline-block w-[1px] h-3 border-l border-dashed border-[#6B46C1]" aria-hidden="true" />
                  <span>{history.deploys.length} deploy{history.deploys.length === 1 ? "" : "s"} in the last 48 h — vertical dashed lines mark each pod boot.</span>
                </p>
              )}
              <button
                type="button"
                onClick={loadHistory}
                className="mt-3 text-[11px] font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1"
                data-testid="admin-pod-memory-refresh"
              >
                <ChevronRight className="w-3 h-3" /> Refresh history
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// StartupTimingCard — deploy-to-deploy sparkline of the deferred
// migration wall-time.  Reads /api/admin/startup-timing/history and
// renders an SVG sparkline + a red "AT RISK" banner when the last two
// consecutive boots both exceeded 2× the K8s readiness budget.  This is
// the earliest visual signal that a migration is creeping toward a
// deploy-failing timeout — well before the time-budget admin alert
// fires at 1× threshold, and long before the pod actually times out.
// ---------------------------------------------------------------------------

export function StartupTimingCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const { data: d } = await api.get("/admin/startup-timing/history?limit=20");
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Load failed");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const budget = data?.budget_seconds ?? 20;
  // Newest-first from the API; reverse for chronological plot order.
  const pts = React.useMemo(() => (data?.points || []).slice().reverse(), [data]);
  const maxElapsed = React.useMemo(() => {
    const vals = pts.map(p => p.elapsed_seconds || 0);
    // Anchor the y-axis at max(budget*2, observed max) so the budget
    // and 2×-budget threshold lines are always visible for scale.
    return Math.max(budget * 2, ...vals, 1);
  }, [pts, budget]);

  return (
    <Card
      icon={LineChart}
      title="Startup timing"
      subtitle="Deferred-migration wall-time per deploy. Slow-creep detection before deploys start failing."
      testid="admin-startup-timing-card"
    >
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="admin-startup-timing-error">{error}</div>}
      {!error && data && (
        <>
          {data.at_risk && (
            <div
              className="mb-3 p-3 rounded-lg border-2 border-[#C5564B] bg-[#FBE7E4] text-sm"
              data-testid="admin-startup-timing-at-risk"
            >
              <p className="font-bold uppercase tracking-wider text-[#7C2D2A] text-xs mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Deploys at risk
              </p>
              <p className="text-[#7C2D2A]" data-testid="admin-startup-timing-at-risk-reason">
                {data.at_risk_reason}
              </p>
            </div>
          )}
          {pts.length === 0 ? (
            <p className="text-sm text-[#5B5F4D] italic" data-testid="admin-startup-timing-empty">
              No boots recorded yet — the sparkline populates after the first successful deploy on this pod.
            </p>
          ) : (
            <>
              <StartupSparkline points={pts} budget={budget} maxElapsed={maxElapsed} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-2 py-1.5" data-testid="admin-startup-timing-latest">
                  <p className="text-[#7A7457]">Latest boot</p>
                  <p className="font-semibold text-[#2C2C2C]">
                    {pts[pts.length - 1]?.elapsed_seconds?.toFixed?.(2) ?? "—"}s
                  </p>
                </div>
                <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-2 py-1.5">
                  <p className="text-[#7A7457]">Budget</p>
                  <p className="font-semibold text-[#2C2C2C]" data-testid="admin-startup-timing-budget">
                    {budget.toFixed(0)}s
                  </p>
                </div>
                <div className="bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-2 py-1.5">
                  <p className="text-[#7A7457]">Boots tracked</p>
                  <p className="font-semibold text-[#2C2C2C]" data-testid="admin-startup-timing-count">
                    {data.count}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={load}
                className="mt-3 text-[11px] font-semibold text-[#6B46C1] hover:text-[#E07A5F] inline-flex items-center gap-1"
                data-testid="admin-startup-timing-refresh"
              >
                <ChevronRight className="w-3 h-3" /> Refresh
              </button>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function StartupSparkline({ points, budget, maxElapsed }) {
  // Inline SVG so we don't pull in a charting lib for one card.
  const W = 320, H = 90, PAD_L = 26, PAD_R = 6, PAD_T = 8, PAD_B = 16;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const xFor = (i) => PAD_L + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const yFor = (v) => PAD_T + innerH - (Math.max(0, Math.min(maxElapsed, v)) / maxElapsed) * innerH;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.elapsed_seconds || 0)}`).join(" ");
  const budgetY = yFor(budget);
  const budget2xY = yFor(budget * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" data-testid="admin-startup-timing-sparkline">
      {/* budget + 2× threshold lines */}
      <line x1={PAD_L} x2={W - PAD_R} y1={budgetY} y2={budgetY} stroke="#D48F2C" strokeWidth="0.7" strokeDasharray="3,3" />
      <text x={PAD_L - 2} y={budgetY + 3} fontSize="8" fill="#B7791F" textAnchor="end">{budget.toFixed(0)}s</text>
      <line x1={PAD_L} x2={W - PAD_R} y1={budget2xY} y2={budget2xY} stroke="#C5564B" strokeWidth="0.7" strokeDasharray="4,3" />
      <text x={PAD_L - 2} y={budget2xY + 3} fontSize="8" fill="#7C2D2A" textAnchor="end">{(budget * 2).toFixed(0)}s</text>
      {/* the trend line */}
      <path d={linePath} fill="none" stroke="#6B46C1" strokeWidth="1.5" />
      {/* per-boot dots — over-budget in amber, over-2x in red */}
      {points.map((p, i) => {
        const c = p.over_budget_2x ? "#C5564B" : p.over_budget ? "#D48F2C" : "#6B46C1";
        return (
          <circle
            key={p.boot_id || i}
            cx={xFor(i)}
            cy={yFor(p.elapsed_seconds || 0)}
            r="2.5"
            fill={c}
            data-testid={`admin-startup-timing-dot-${i}`}
          >
            <title>{`boot ${p.boot_id?.slice(0, 8)} · ${p.elapsed_seconds?.toFixed?.(2)}s · ${p.finished_at || ""}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}


// ---------------------------------------------------------------------------
// UploadBatchHealthCard (2026-08-24)
// ---------------------------------------------------------------------------
// Shows the failure-rate trend across recent bulk uploads so operators can
// tune concurrency / retry / jitter with data instead of guessing.  Reads
// GET /api/admin/upload-jobs/batch-stats which returns per-batch rows +
// per-day aggregates.
//
// Context — this card exists specifically to close the loop on the
// 2026-08-24 concurrency-tuning work: previous baseline gave 27/200
// failures on a 200-file cold-drop; new baseline (slow-start 3→6,
// ±30% jittered backoff, 5 attempts up to 45s) targets ≤5/200.
// The card lets us see whether the new tuning is actually holding
// or whether we need to iterate again.
// ---------------------------------------------------------------------------

export function UploadBatchHealthCard() {
  const [state, setState] = useState({ loading: true, rows: [], trend: [], summary: null, err: null });
  const [days, setDays] = useState(7);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, err: null }));
    try {
      const { data } = await api.get(`/admin/upload-jobs/batch-stats?days=${days}&limit=100`);
      setState({ loading: false, rows: data.rows || [], trend: data.trend || [], summary: data.summary, err: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, err: e?.response?.data?.detail || "Couldn't load batch stats" }));
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  const pct1 = (n) => `${(n * 100).toFixed(1)}%`;
  const fmtDurationMs = (ms) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  };

  // Peak failure rate anywhere in trend → drives the sparkline y-scale.
  const maxRate = state.trend.reduce((mx, d) => Math.max(mx, d.failure_rate || 0), 0.001);
  return (
    <Card
      icon={Upload}
      title="Upload batch health"
      subtitle="Failure-rate trend, retry burn, throttle events across recent bulk uploads."
      testid="admin-upload-health-card"
    >
      {state.loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading batch stats…</p>
      ) : state.err ? (
        <p className="text-sm text-[#B87A00] italic">{state.err}</p>
      ) : (
        <div className="space-y-5">
          {/* Window selector + refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[#5B5F4D]">Window</span>
            {[1, 7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  days === d
                    ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                    : "bg-white dark:bg-zinc-800 text-[#2C2C2C] dark:text-white border-[#E8E6E1] dark:border-zinc-700 hover:bg-[#F5F0E5] dark:hover:bg-zinc-700"
                }`}
                data-testid={`admin-upload-health-window-${d}`}
              >
                {d}d
              </button>
            ))}
            <button
              type="button"
              onClick={load}
              className="ml-auto text-xs px-2 py-1 rounded border border-[#E8E6E1] dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-[#F5F0E5] dark:hover:bg-zinc-700"
              data-testid="admin-upload-health-refresh"
              title="Refresh"
            >
              <RotateCcw className="w-3 h-3 inline" /> Refresh
            </button>
          </div>

          {/* Summary strip */}
          {state.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-lg border border-[#E8E6E1] dark:border-zinc-700 p-2">
                <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60">Batches</div>
                <div className="text-lg font-semibold tabular-nums" data-testid="admin-upload-health-batches">{state.summary.batches}</div>
              </div>
              <div className="rounded-lg border border-[#E8E6E1] dark:border-zinc-700 p-2">
                <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60">Files</div>
                <div className="text-lg font-semibold tabular-nums" data-testid="admin-upload-health-files">{state.summary.files.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-[#E8E6E1] dark:border-zinc-700 p-2">
                <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60">Failed</div>
                <div className="text-lg font-semibold tabular-nums text-[#B04A2A]" data-testid="admin-upload-health-failed">{state.summary.failed.toLocaleString()}</div>
              </div>
              <div className={`rounded-lg border p-2 ${
                state.summary.failure_rate <= 0.025
                  ? "border-[#2C7A3E] bg-[#E8F3EC] dark:bg-emerald-950/40"
                  : state.summary.failure_rate <= 0.05
                  ? "border-[#B87A00] bg-[#FDF3E1] dark:bg-amber-950/40"
                  : "border-[#B04A2A] bg-[#FBEEE9] dark:bg-red-950/40"
              }`}>
                <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60">Failure rate</div>
                <div className="text-lg font-semibold tabular-nums" data-testid="admin-upload-health-rate">{pct(state.summary.failure_rate)}</div>
              </div>
            </div>
          )}

          {/* Per-day trend bars.  Simple bar chart — one column per day. */}
          {state.trend.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60 mb-1">
                Daily failure rate (target ≤ 2.5%)
              </div>
              <div className="flex items-end gap-1 h-24" data-testid="admin-upload-health-trend">
                {state.trend.map((d) => {
                  const height = Math.max(2, (d.failure_rate / (maxRate || 1)) * 100);
                  const ok = d.failure_rate <= 0.025;
                  const warn = d.failure_rate > 0.025 && d.failure_rate <= 0.05;
                  return (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col items-center gap-0.5 min-w-0"
                      title={`${d.day} · ${d.batches} batches · ${d.files} files · ${d.failed} failed · ${pct1(d.failure_rate)} · ${d.retries} retries · ${d.throttled_events} throttle events`}
                    >
                      <div
                        className={`w-full rounded-t ${
                          ok ? "bg-[#2C7A3E]" : warn ? "bg-[#B87A00]" : "bg-[#B04A2A]"
                        }`}
                        style={{ height: `${height}%`, minHeight: "4px" }}
                      />
                      <div className="text-[9px] text-[#5B5F4D] dark:text-white/60 truncate w-full text-center"> {/* fontsize-ok — admin heatmap chart axis date label, intentional 9px */}
                        {d.day.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-[#5B5F4D] dark:text-white/60">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-[#2C7A3E] rounded-sm" />≤ 2.5%</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-[#B87A00] rounded-sm" />2.5–5%</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-[#B04A2A] rounded-sm" />&gt; 5%</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#5B5F4D] dark:text-white/70 italic" data-testid="admin-upload-health-empty">
              No batch uploads in the last {days} day{days === 1 ? "" : "s"}. Drop a batch of files on your library and this chart will populate.
            </p>
          )}

          {/* Recent batches — most recent 20. */}
          {state.rows.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60 mb-1">
                Recent batches
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="admin-upload-health-batches-table">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60 border-b border-[#E8E6E1] dark:border-zinc-700">
                      <th className="py-1 pr-2">When</th>
                      <th className="py-1 pr-2">User</th>
                      <th className="py-1 pr-2 text-right">Files</th>
                      <th className="py-1 pr-2 text-right">Failed</th>
                      <th className="py-1 pr-2 text-right">Rate</th>
                      <th className="py-1 pr-2 text-right">Retries</th>
                      <th className="py-1 pr-2 text-right">Throttled</th>
                      <th className="py-1 pr-2 text-right">Peak conc.</th>
                      <th className="py-1 pr-2 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.rows.slice(0, 20).map((r) => {
                      const rate = r.total_files > 0 ? r.failed / r.total_files : 0;
                      return (
                        <tr key={r.batch_id} className="border-b border-[#F1EEE5] dark:border-zinc-800">
                          <td className="py-1 pr-2 tabular-nums">{fmtAgo(new Date(r.finished_at).toISOString())}</td>
                          <td className="py-1 pr-2 truncate max-w-[10rem]" title={r.user_email}>{r.user_email || "—"}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{r.total_files}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${r.failed > 0 ? "text-[#B04A2A] font-semibold" : ""}`}>{r.failed}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${
                            rate <= 0.025 ? "" : rate <= 0.05 ? "text-[#B87A00]" : "text-[#B04A2A] font-semibold"
                          }`}>{pct1(rate)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{r.transient_retries || 0}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{r.throttled_events || 0}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{r.peak_concurrency}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmtDurationMs(r.duration_ms)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tuning history annotation.  Hardcoded — updated whenever
              we ship a knob change so the chart is self-documenting. */}
          <div className="rounded-lg border border-[#E8E6E1] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-900/60 p-3 text-xs" data-testid="admin-upload-health-tuning-history">
            <div className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-white/60 mb-1">
              Tuning history
            </div>
            <ul className="space-y-1 text-[#2C2C2C] dark:text-white">
              <li>
                <span className="font-mono text-[10px] mr-1">2026-08-24 (b)</span>
                Slow-start ramp <b>3 → 6</b>, jittered backoff ±30%, 5 attempts up to ~45s. Target ≤ 5 fails / 200.
              </li>
              <li>
                <span className="font-mono text-[10px] mr-1">2026-08-24 (a)</span>
                Baseline CONCURRENCY <b>8 → 6</b>, TRANSIENT_THROTTLE <b>3 → 2</b>. Landed 30% failure-rate cut.
              </li>
              <li>
                <span className="font-mono text-[10px] mr-1">2026-06-28</span>
                Retry-on-5xx + sliding-window throttle first landed.
              </li>
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
