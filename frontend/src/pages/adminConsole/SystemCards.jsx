/**
 * SystemCards — extracted 2026-08-19 from AdminConsole.jsx (Phase 6C-D).
 *
 * Cards: HiddenFeaturesCard, AdminPendingAlertsCard, ReExtractLinksCard, MaintenanceBannerCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { AlertTriangle, Bell, Check, EyeOff, Info, Loader2, RotateCcw, Save, Users, X as XIcon } from "lucide-react";
import { Card, fmtBytes } from "./shared";

export function HiddenFeaturesCard() {
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

export function AdminPendingAlertsCard() {
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

export function ReExtractLinksCard() {
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




export function MaintenanceBannerCard() {
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

