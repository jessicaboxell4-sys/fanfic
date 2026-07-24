/**
 * EmailCards — extracted 2026-08-19 from AdminConsole.jsx (Phase 6C-D).
 *
 * Cards: EmailDiagnosticCard, AdminEmailModeCard, EmailStatsCard, EmailSystemCard, EmailVolumeForecastCard
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { AlertTriangle, Bell, Check, Inbox, Loader2, Mail, RotateCcw, Send, TrendingUp } from "lucide-react";
import { Card, fmtBytes } from "./shared";

// ---------------------------------------------------------------------------
// A2 — Email-stats card. Rolling 7-day Resend telemetry pulled from db.email_logs.
// ---------------------------------------------------------------------------

// QuotaGauges — Resend plan usage bars (used inside EmailStatsCard).
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

export function EmailDiagnosticCard() {
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

export function AdminEmailModeCard() {
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

export function EmailStatsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get("/admin/email-stats");
      setData(resp?.data ?? null);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

export function EmailSystemCard() {
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

export function EmailVolumeForecastCard() {
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

