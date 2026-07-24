/**
 * AnalyticsCards — extracted 2026-08-19 from AdminConsole.jsx (Phase 6C-D).
 *
 * Cards: FulltextBackfillCard, LlmKeyHealthCard, CanaryCard, ChangelogCard
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { Activity, AlertOctagon, ChevronDown, Copy, History, Loader2, Search, Sparkles, Split } from "lucide-react";
import { Card, fmtBytes, fmtTime } from "./shared";

export function FulltextBackfillCard() {
  const [stats, setStats] = useState(null);
  const [starting, setStarting] = useState(false);

  // 2026-07-04 — "Run until done" mode.  Historically each click of the
  // Run button processed one 500-book batch, so an admin with 4,500
  // books left had to babysit ten clicks.  When `autoContinue` is true
  // (default) we watch for the running=false + remaining>0 transition
  // and immediately kick the next batch, so a single click walks the
  // whole backlog to completion.  The user can uncheck it if they want
  // manual batch-by-batch control (e.g. to pause after one batch to
  // look at logs).  Persisted in localStorage so the preference sticks
  // across page loads.
  const [autoContinue, setAutoContinue] = useState(() => {
    try {
      return localStorage.getItem("admin.fulltext.auto_continue") !== "false";
    } catch { return true; }
  });

  // Refs so the polling `useEffect` can read the latest values without
  // re-subscribing every tick.
  const autoContinueRef = useRef(autoContinue);
  const startingRef = useRef(false);
  const runRef = useRef(null);

  useEffect(() => { autoContinueRef.current = autoContinue; }, [autoContinue]);
  useEffect(() => {
    try { localStorage.setItem("admin.fulltext.auto_continue", String(autoContinue)); } catch { /* ignore */ }
  }, [autoContinue]);

  // Poll continuously so the bar keeps ticking even if the admin
  // closed the tab and re-opened it later.  When `autoContinue` is on
  // and we observe an idle-with-work-left transition, immediately
  // re-fire the run.  Uses `runRef` so we don't have to depend on `run`
  // in the effect.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/fulltext/stats");
        if (cancelled) return;
        setStats(data);
        if (
          autoContinueRef.current &&
          !startingRef.current &&
          !data?.running &&
          (data?.remaining ?? 0) > 0 &&
          (data?.total_active ?? 0) > 0
        ) {
          runRef.current?.();
        }
      } catch { /* keep the last snapshot */ }
    };
    tick(); // initial fetch
    const iv = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const run = async () => {
    setStarting(true);
    startingRef.current = true;
    // 2026-07-07 — Split the try/catch into two.  Previously a failing
    // stats-refresh call (which the frontend fires immediately after
    // the successful POST) landed in the same catch block as a failing
    // backfill-kickoff POST, so the user saw "Couldn't start backfill"
    // even when the backfill had actually started.  Prod stats endpoint
    // was hitting a 30s Mongo timeout on the $in join before we added
    // the book_fulltext.book_id index, and that misleading toast was
    // scaring admins away from an already-running batch.
    let kicked = false;
    try {
      const { data } = await api.post("/admin/fulltext/backfill?limit=500");
      kicked = true;
      if (data.already_running) {
        toast.info("A backfill is already running — watch the bar.");
      } else if (!autoContinueRef.current) {
        // Only toast on the first batch when NOT in auto-continue mode.
        // Otherwise each batch would fire a toast and drown the tab.
        toast.success("Backfill started. You can leave this page — it keeps running.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't start backfill");
    }
    if (kicked) {
      // Refresh once immediately so the button flips to "Indexing…"
      // without waiting for the next 4s tick.  Wrapped in its own
      // try so a stats-refresh error doesn't mask the kickoff success.
      try {
        const { data: fresh } = await api.get("/admin/fulltext/stats");
        setStats(fresh);
      } catch (_e) {
        // Silent — the interval poll will catch up.  Don't scare the
        // admin about a successful kickoff.
      }
    }
    setStarting(false);
    startingRef.current = false;
  };
  useEffect(() => { runRef.current = run; }); // always latest

  const pct = stats?.pct ?? 0;
  const done = stats && stats.remaining === 0 && stats.total_active > 0;
  const running = !!stats?.running;
  const btnLabel =
    starting ? "Starting…" :
    running  ? (autoContinue ? "Running…" : "Indexing…") :
    done     ? "All caught up" :
    (autoContinue && stats && stats.remaining > 0)
             ? `Run until done (${stats.remaining.toLocaleString()} left)`
             : `Run backfill (${stats ? Math.min(500, stats.remaining).toLocaleString() : 500})`;

  // Deep-link an operator to the existing Orphan audit card — that's
  // where the storage-missing books can be re-checked and bulk-purged.
  const jumpToOrphanCard = () => {
    const card = document.querySelector('[data-testid="admin-orphan-audit-card"]');
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    const toggle = card.querySelector('[data-testid="admin-orphan-audit-card-toggle"]');
    if (toggle && card.getAttribute("data-collapsed") === "true") toggle.click();
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
          New uploads are indexed automatically. Run this to index the older books that pre-date the feature. Books are processed in <strong>500-at-a-time</strong> background batches — you can close this page and it&apos;ll keep running. With <strong>Continue automatically</strong> on (default), one click walks the whole backlog to completion.
        </p>

        {/* Overall progress panel — indexed vs total, from Mongo. */}
        {stats && (
          <div className="space-y-1.5" data-testid="admin-fulltext-progress">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-[#5B5F4D]">
                <span className="font-bold text-[#2C2C2C]" data-testid="admin-fulltext-indexed">{stats.indexed.toLocaleString()}</span>
                <span className="mx-1">of</span>
                <span className="font-bold text-[#2C2C2C]" data-testid="admin-fulltext-total">{stats.total_active.toLocaleString()}</span>
                <span> books indexed</span>
                {stats.remaining > 0 && (
                  <span className="text-[#5B5F4D]"> &middot; <span data-testid="admin-fulltext-remaining">{stats.remaining.toLocaleString()}</span> left</span>
                )}
              </span>
              <span
                className={`font-bold tabular-nums ${done ? "text-[#3F7A3F]" : "text-[#6B46C1]"}`}
                data-testid="admin-fulltext-pct"
              >
                {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-[#F5F3EC] dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full transition-[width] duration-500 ease-out ${done ? "bg-[#5C8A5C]" : "bg-gradient-to-r from-[#6B46C1] to-[#8A6DD9]"}`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                data-testid="admin-fulltext-progress-bar"
              />
            </div>

            {/* Sub-line: "this run" progress while a batch is in flight. */}
            {running && stats.batch_target > 0 && (
              <div className="text-[11px] text-[#5B5F4D] italic pt-0.5" data-testid="admin-fulltext-batch-progress">
                This batch: <span className="font-mono text-[#2C2C2C]">{stats.batch_scanned}</span> / <span className="font-mono text-[#2C2C2C]">{stats.batch_target}</span> scanned
                {" · "}<span className="font-mono">{stats.batch_indexed}</span> indexed
                {stats.batch_missing_file > 0 && <>{" · "}<span className="font-mono">{stats.batch_missing_file}</span> missing</>}
                {stats.batch_errors > 0 && <>{" · "}<span className="font-mono text-[#B43F26]">{stats.batch_errors}</span> errors</>}
              </div>
            )}

            {/* Orphan pill — books flagged storage-missing by the walker.  */}
            {stats.orphaned > 0 && (
              <button
                type="button"
                onClick={jumpToOrphanCard}
                data-testid="admin-fulltext-orphan-pill"
                className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FDF3E7] border border-[#F1D9B6] text-[11px] text-[#8A5A20] hover:bg-[#FCEBD3] transition-colors"
                title="Books whose EPUB file went missing in storage. Excluded from indexing totals. Click to open the Orphan audit card."
              >
                <AlertOctagon className="w-3 h-3" />
                {stats.orphaned.toLocaleString()} orphaned {stats.orphaned === 1 ? "record" : "records"} excluded &middot; review in Orphan audit &rarr;
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={run}
              disabled={starting || running || done}
              data-testid="admin-fulltext-backfill-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6B46C1] text-white text-xs font-bold uppercase tracking-[0.15em] hover:bg-[#553397] transition-colors disabled:opacity-40"
            >
              {(starting || running) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {btnLabel}
            </button>
            {running && (
              <span className="text-xs text-[#5B5F4D] italic" data-testid="admin-fulltext-busy-hint">
                {autoContinue ? "Running batches until done — safe to close this tab." : "Running in the background — safe to close this tab."}
              </span>
            )}
          </div>
          <label
            className="flex items-center gap-2 text-xs text-[#2C2C2C] cursor-pointer select-none"
            title="When on, each 500-book batch that finishes automatically kicks the next one until nothing's left."
            data-testid="admin-fulltext-auto-continue-label"
          >
            <input
              type="checkbox"
              checked={autoContinue}
              onChange={(e) => setAutoContinue(e.target.checked)}
              className="accent-[#6B46C1]"
              data-testid="admin-fulltext-auto-continue-checkbox"
            />
            Continue automatically until done
          </label>
        </div>

        {/* Last-run summary once the batch finishes. */}
        {stats && !running && stats.finished_at && stats.batch_target > 0 && (
          <div className="text-xs text-[#5B5F4D] font-mono" data-testid="admin-fulltext-result">
            last batch — scanned={stats.batch_scanned} · indexed={stats.batch_indexed} · missing_file={stats.batch_missing_file} · errors={stats.batch_errors}
            {stats.last_error && <span className="text-[#B43F26]"> · error: {stats.last_error}</span>}
          </div>
        )}
      </div>
    </Card>
  );
}




// ---------------------------------------------------------------------------
// Pod-memory pill (2026-07-01) — surfaces the live cgroup-v2 memory snapshot
// from utils/memory_canary via /api/health.  After two 520 incidents in 4 days
// we wanted an always-on operator signal: red pill when the pod is >=80% of
// its K8s limit, amber at >=60%, green otherwise.  Polls every 30s.  Only
// renders when the backend reports pod_memory.available (K8s + cgroup-v2);
// otherwise hides so we don't clutter the header on dev laptops.
//
// Click the pill to open a popover with the 48-hour sparkline (bucket-peak
// downsample from utils/memory_canary.load_history) — long enough that an
// overnight/weekend spike is still visible when the operator checks in
// after "life happens" delays.
// ---------------------------------------------------------------------------

export function LlmKeyHealthCard() {
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

export function CanaryCard() {
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
// Prod ↔ source drift status.  Backed by GET /api/admin/drift-status which
// returns the most recent hourly run of scripts/deploy_drift_check.py.  This
// card is the single-glance "is it safe to deploy?" signal.

export function ChangelogCard() {
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

