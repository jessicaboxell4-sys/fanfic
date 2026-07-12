/**
 * Storage & files cluster of the AdminConsole page — extracted in the
 * Phase 6C-A frontend refactor (2026-07-XX).
 *
 * Cards:
 *   - R2MigrationProgressCard  (Emergent → Cloudflare R2 lazy migration)
 *   - OrphanCleanupCard        (dead-row cleanup — files missing in both backends)
 *   - StorageByUserCard        (top 20 heaviest accounts)
 *   - StorageTrendCard         (30-day cumulative bytes chart)
 *
 * ``SavingsLine`` is a small child of R2MigrationProgressCard — kept
 * local because nothing else uses it.
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import {
  HardDrive, TrendingUp, Loader2, Sparkles, ChevronRight, AlertOctagon, Trash2,
} from "lucide-react";
import { Card, fmtBytes } from "./shared";

export function SavingsLine({ savings, onChanged }) {
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

export function R2MigrationProgressCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfill, setLastBackfill] = useState(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [savings, setSavings] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const abortRef = useRef(false);

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
    // 2026-07-11 — loop backfill until nothing left to migrate.
    // Serial "Migrate next 25" was blowing Cloudflare's 120s proxy
    // on slow Emergent HEAD days, and forcing the admin to hand-click
    // ~30 times to drain a typical 682-book queue.  Now: one click,
    // small server-side chunks (safely under 120s each), auto-loop
    // client-side until the response reports nothing remaining.
    const CHUNK = 15;
    // Safety cap — 500 * 15 = 7,500 books max per session, well above
    // any realistic library size.  Prevents a runaway loop if the API
    // ever starts lying about `processed` / `remaining_estimate`.
    const MAX_ITER = 500;
    abortRef.current = false;
    setBackfilling(true);
    setLastBackfill(null);
    const totals = { migrated: 0, already: 0, missing: 0, failed: 0, iterations: 0 };
    setBatchProgress({ ...totals, remaining: data?.total_remaining ?? null, stage: "starting" });
    try {
      for (let i = 0; i < MAX_ITER; i += 1) {
        if (abortRef.current) break;
        // eslint-disable-next-line no-await-in-loop
        const { data: r } = await api.post(
          `/admin/storage-migration-backfill?chunk_size=${CHUNK}`,
        );
        totals.migrated += r?.migrated || 0;
        totals.already  += r?.already_on_r2 || 0;
        totals.missing  += r?.emergent_missing || 0;
        totals.failed   += r?.failed || 0;
        totals.iterations = i + 1;
        setBatchProgress({
          ...totals,
          remaining: r?.remaining_estimate ?? null,
          pct: r?.percent ?? null,
          stage: "running",
        });
        setLastBackfill(r);
        // Stop conditions:
        //   1. Nothing left to migrate (processed = 0 = no candidates found)
        //   2. Everything remaining is missing-from-Emergent (nothing to do)
        //   3. Server reports 100% migrated
        const noProgress = (r?.processed || 0) === 0;
        const complete = (r?.percent ?? 0) >= 100;
        if (noProgress || complete) break;
      }
      toast.success(
        `Migration ${abortRef.current ? "stopped" : "complete"} · ${totals.migrated} moved`
        + (totals.missing ? ` · ${totals.missing} missing (data loss)` : "")
        + (totals.failed  ? ` · ${totals.failed} failed`               : ""),
        { duration: 8000 },
      );
      load();
    } catch (e) {
      // Report partial progress before the failure.
      if (totals.migrated > 0) {
        toast.error(
          `Partial: ${totals.migrated} migrated before error. `
          + (e?.response?.data?.detail || "Backfill loop failed"),
        );
      } else {
        toast.error(e?.response?.data?.detail || "Backfill failed");
      }
      // Still reload the gauge so the admin sees the true state.
      load();
    } finally {
      setBackfilling(false);
      setBatchProgress(null);
      abortRef.current = false;
    }
  };
  const stopBackfill = () => { abortRef.current = true; };

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
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <button
              type="button"
              onClick={backfill}
              disabled={backfilling || (data?.percent ?? 0) >= 100}
              data-testid="r2-migration-backfill"
              className="px-3 py-1.5 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#5C3AAD] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {backfilling ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {backfilling
                ? (batchProgress
                    ? `Migrating… (${batchProgress.migrated} moved)`
                    : "Migrating…")
                : "Migrate all remaining"}
            </button>
            {backfilling && (
              <button
                type="button"
                onClick={stopBackfill}
                data-testid="r2-migration-stop"
                className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] text-[#E07A5F] hover:bg-[#FDECE7] inline-flex items-center gap-2"
                title="Stop after the current batch finishes"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={load}
              disabled={loading || backfilling}
              data-testid="r2-migration-resample"
              className="text-[11px] text-[#6B46C1] hover:underline disabled:opacity-50"
            >
              {loading ? "Sampling…" : "Re-sample"}
            </button>
          </div>
          {backfilling && batchProgress && (
            <p
              className="text-[11px] text-[#5B5F4D] italic"
              data-testid="r2-migration-batch-progress"
            >
              Batch {batchProgress.iterations || 0} · migrated
              {" "}<span className="font-mono font-semibold text-[#6B46C1]">{batchProgress.migrated}</span>
              {batchProgress.remaining != null && batchProgress.remaining > 0 ? (
                <>
                  {" "}· ~<span className="font-mono">{batchProgress.remaining}</span> remaining
                </>
              ) : null}
              {batchProgress.pct != null ? (
                <> · <span className="font-mono font-semibold">{batchProgress.pct}%</span></>
              ) : null}
              {batchProgress.missing ? (
                <> · <span className="text-[#E07A5F]">{batchProgress.missing} missing</span></>
              ) : null}
              {batchProgress.failed ? (
                <> · <span className="text-[#E07A5F]">{batchProgress.failed} failed</span></>
              ) : null}
            </p>
          )}
          {lastBackfill && !backfilling && (
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
export function OrphanCleanupCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [lastResult, setLastResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [deleteProgress, setDeleteProgress] = useState(null);

  const audit = async () => {
    setLoading(true);
    setLastResult(null);
    setProgress({ scanned: 0, total: 0, found: 0 });
    try {
      // Paginate through the library in 1000-book windows.  A single
      // scan of the whole library reliably blows past Cloudflare's
      // 120s proxy read timeout when the store has thousands of
      // rows.  Each 1000-book window returns in ~10-15s at 64-wide
      // R2 HEAD concurrency, well under the ceiling.
      const CHUNK = 1000;
      let offset = 0;
      const allOrphans = [];
      let totalBooks = 0;
      let backend = "";
      // Hard-cap iterations so a runaway loop can't hammer the API.
      for (let i = 0; i < 50; i += 1) {
        const { data: page } = await api.get("/admin/orphan-audit", {
          params: { limit: CHUNK, offset },
        });
        allOrphans.push(...(page?.orphans || []));
        totalBooks = page?.total_books ?? totalBooks;
        backend = page?.backend || backend;
        offset += page?.scanned || 0;
        setProgress({ scanned: offset, total: totalBooks, found: allOrphans.length });
        if ((page?.scanned || 0) < CHUNK) break; // reached the end
      }
      const merged = {
        scanned: offset,
        orphan_count: allOrphans.length,
        orphans: allOrphans,
        total_books: totalBooks,
        backend,
      };
      setData(merged);
      // Default to selecting every orphan — admin can untick before delete.
      setSelected(new Set(allOrphans.map((o) => o.book_id)));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't run orphan audit");
    } finally {
      setLoading(false);
      setProgress(null);
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
      + `Files won't be touched (they're already gone). This action is logged.\n\n`
      + `Large batches are automatically split into chunks of 100 — no more clicking.`,
    )) return;
    setDeleting(true);
    setLastResult(null);
    // Backend caps each POST at 250 book_ids AND does the HEAD-recheck
    // phase in parallel (32-wide) — a 100-row window comfortably clears
    // Cloudflare's 120s proxy timeout even on slow R2 days.  Dropped
    // from 500 → 100 on 2026-07-11 after a 1166-orphan cleanup 524'd
    // at 500/batch.
    const CHUNK = 100;
    const totals = { deleted: 0, recovered: [], not_found: [] };
    setDeleteProgress({ done: 0, total: ids.length, chunks: Math.ceil(ids.length / CHUNK) });
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const { data: r } = await api.post("/admin/orphan-audit/delete-bulk", {
          book_ids: slice,
          confirm_recheck: true,
        });
        totals.deleted += r?.deleted || 0;
        if (r?.recovered?.length) totals.recovered.push(...r.recovered);
        if (r?.not_found?.length) totals.not_found.push(...r.not_found);
        setDeleteProgress({
          done: Math.min(i + CHUNK, ids.length),
          total: ids.length,
          chunks: Math.ceil(ids.length / CHUNK),
          deletedSoFar: totals.deleted,
        });
      }
      setLastResult(totals);
      const chunkCount = Math.ceil(ids.length / CHUNK);
      toast.success(
        `Removed ${totals.deleted} orphan${totals.deleted === 1 ? "" : "s"}`
        + (chunkCount > 1 ? ` across ${chunkCount} batches` : "")
        + (totals.recovered.length ? ` · ${totals.recovered.length} skipped (recovered)` : ""),
      );
      // Refresh the audit so the table reflects the post-delete state.
      audit();
    } catch (e) {
      // Report partial progress if some chunks succeeded before a failure.
      if (totals.deleted > 0) {
        setLastResult(totals);
        toast.error(
          `Partial: removed ${totals.deleted} before failure. `
          + (e?.response?.data?.detail || "Bulk delete failed mid-batch"),
        );
      } else {
        toast.error(e?.response?.data?.detail || "Bulk delete failed");
      }
    } finally {
      setDeleting(false);
      setDeleteProgress(null);
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
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(
                "Send a one-time in-app notification to every existing user "
                + "(created before today's orphan-delete) explaining what happened?\n\n"
                + "• Idempotent — a second click is a no-op.\n"
                + "• New signups (post-purge) are NOT notified.\n"
                + "• Only users who actually had books get pinged."
              )) return;
              try {
                const { data: r } = await api.post("/admin/orphan-audit/notify-retroactive");
                if (r.already_sent) toast(`Already sent · ${r.sent_count} users notified previously`);
                else toast.success(`Sent to ${r.sent_count} user${r.sent_count === 1 ? "" : "s"} (of ${r.old_users_considered} old users considered)`);
              } catch (e) {
                toast.error(e?.response?.data?.detail || "Retroactive notify failed");
              }
            }}
            data-testid="orphan-audit-notify-retroactive"
            className="text-[11px] px-2.5 py-1 rounded-lg text-[#B87A00] hover:bg-[#FDF3E1] inline-flex items-center gap-1 font-semibold"
            title="One-shot: notify existing users about the 2026-07-11 purge (idempotent)"
          >
            Send retroactive notice
          </button>
          {loading && progress && (
            <p className="text-xs text-[#5B5F4D]" data-testid="orphan-audit-progress">
              Scanning <span className="font-mono">{progress.scanned}</span>
              {progress.total ? <> / <span className="font-mono">{progress.total}</span></> : null}
              {" "}books · found{" "}
              <span className="font-mono font-semibold text-[#E07A5F]">{progress.found}</span>
              {" "}orphan{progress.found === 1 ? "" : "s"} so far…
            </p>
          )}
          {!loading && data && (
            <p className="text-xs text-[#5B5F4D]" data-testid="orphan-audit-summary">
              Scanned <span className="font-mono">{data.scanned}</span>
              {data.total_books ? <> / <span className="font-mono">{data.total_books}</span></> : null}
              {" "}· found{" "}
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
                {deleting
                  ? (deleteProgress
                      ? `Removing ${deleteProgress.done}/${deleteProgress.total}…`
                      : "Removing…")
                  : `Delete ${selected.size || ""} selected${selected.size > 100 ? ` (auto-batched)` : ""}`}
              </button>
            </div>
            {deleting && deleteProgress && deleteProgress.chunks > 1 && (
              <p
                className="text-[11px] text-[#5B5F4D] italic"
                data-testid="orphan-audit-delete-progress"
              >
                Batch {Math.min(Math.ceil(deleteProgress.done / 100), deleteProgress.chunks)} of
                {" "}{deleteProgress.chunks}
                {" "}· removed <span className="font-mono">{deleteProgress.deletedSoFar ?? 0}</span> so far…
              </p>
            )}
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
export function StorageByUserCard() {
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
export function StorageTrendCard() {
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
