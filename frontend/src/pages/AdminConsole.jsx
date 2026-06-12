import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, Users, Heart, AlertTriangle, Activity, Layers,
  BarChart3, ToggleLeft, ClipboardList, Loader2, Plus, X as XIcon, Trash2,
  Check, ChevronRight, Download,
} from "lucide-react";

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
  return (
    <section className="shelf-card p-6 mb-6" data-testid={testid}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#EAF0EB] text-[#3A5A40] flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-[#2C2C2C]">{title}</h2>
          {subtitle && <p className="text-sm text-[#6B705C] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
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

  return (
    <Card icon={Users} title="Users & admins" subtitle="Promote or demote any account. The last admin cannot be demoted." testid="admin-users-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <ul className="space-y-1.5" data-testid="admin-users-list">
          {users.map((u) => (
            <li key={u.user_id} className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-user-row-${u.user_id}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#2C2C2C] truncate">
                  {u.name || u.email}
                  {u.is_admin && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#3A5A40] font-bold">
                      <ShieldCheck className="w-3 h-3" /> Admin
                    </span>
                  )}
                </p>
                <p className="text-xs text-[#6B705C] truncate">{u.email} · {u.book_count} book{u.book_count === 1 ? "" : "s"} · joined {fmtTime(u.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleAdmin(u)}
                disabled={busyId === u.user_id}
                data-testid={`admin-user-toggle-${u.user_id}`}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                  u.is_admin
                    ? "text-[#9B3531] hover:bg-[#FBE9E7]"
                    : "text-[#3A5A40] hover:bg-[#EAF0EB]"
                }`}
              >
                {busyId === u.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {u.is_admin ? "Demote" : "Promote"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Maintenance banner card (b)
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
          <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#3A5A40] mb-1">Message</label>
          <input
            type="text"
            value={message}
            maxLength={240}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Calibre is unavailable — conversions paused until 5pm UTC."
            data-testid="admin-banner-message"
            className="w-full px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white text-sm text-[#2C2C2C] focus:outline-none focus:border-[#E07A5F]"
          />
          <p className="text-xs text-[#6B705C] mt-1">{message.length}/240</p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.15em] text-[#3A5A40] mb-1">Severity</label>
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3A5A40] text-white hover:bg-[#2c4530] disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? "Saving…" : "Save banner"}
        </button>
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
        ok ? "bg-[#EAF0EB] text-[#3A5A40]" : "bg-[#FBE9E7] text-[#9B3531]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#3A5A40]" : "bg-[#9B3531]"}`} />
      {label}: {ok ? "OK" : "Down"}
    </span>
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
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4" data-testid="admin-health-collections">
        {Object.entries(health.collections || {}).map(([name, n]) => (
          <div key={name} className="text-xs bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
            <p className="text-[#6B705C] truncate">{name}</p>
            <p className="font-semibold text-[#2C2C2C]">{n.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="text-xs text-[#6B705C]" data-testid="admin-health-storage">
        Storage: <strong className="text-[#2C2C2C]">{fmtBytes(health.storage?.used_bytes)}</strong> used / {fmtBytes(health.storage?.total_bytes)} total
        ({fmtBytes(health.storage?.free_bytes)} free) on <code>{health.storage?.path}</code>
      </div>
      <button
        type="button"
        onClick={load}
        data-testid="admin-health-refresh"
        className="mt-3 text-xs font-semibold text-[#3A5A40] hover:text-[#E07A5F] inline-flex items-center gap-1"
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
        <span className="self-center text-[#6B705C] hidden md:inline">→</span>
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
        <p className="text-xs text-[#6B705C] italic" data-testid="admin-aliases-empty">No global aliases yet.</p>
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
      <p className="text-xs text-[#6B705C] uppercase tracking-[0.15em]">{label}</p>
      <p className="text-2xl font-serif text-[#2C2C2C]">{value}</p>
    </div>
  );
}

function GlobalStatsCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

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
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
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
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A5A40] mb-1.5">Top fandoms</p>
          <ul className="space-y-1 text-xs" data-testid="admin-stats-top-fandoms">
            {stats.top_fandoms?.map((f) => (
              <li key={f.fandom} className="flex justify-between bg-[#FBFAF6] border border-[#E5DDC5] rounded px-2 py-1">
                <span className="truncate">{f.fandom}</span>
                <strong className="ml-2">{f.count.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#3A5A40] mb-1.5">Categories</p>
          <ul className="space-y-1 text-xs" data-testid="admin-stats-categories">
            {Object.entries(stats.categories || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex justify-between bg-[#FBFAF6] border border-[#E5DDC5] rounded px-2 py-1">
                <span className="truncate">{k}</span>
                <strong className="ml-2">{v.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
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
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <ul className="space-y-1.5" data-testid="admin-flags-list">
          {Object.keys(known).map((key) => {
            const on = !!flags[key];
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-flag-row-${key}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C]"><code>{key}</code></p>
                  <p className="text-xs text-[#6B705C]">{known[key]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(key, !on)}
                  disabled={busy === key}
                  data-testid={`admin-flag-toggle-${key}`}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold flex items-center gap-1 transition-colors ${
                    on ? "bg-[#EAF0EB] text-[#3A5A40] hover:bg-[#3A5A40] hover:text-white"
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
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#6B705C] italic" data-testid="admin-audit-empty">No audit entries yet.</p>
      ) : (
        <ul className="space-y-1" data-testid="admin-audit-list">
          {entries.map((e, i) => (
            <li key={i} className="text-xs px-2.5 py-1.5 rounded bg-[#FBFAF6] border border-[#E5DDC5]" data-testid={`admin-audit-row-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span><strong>{e.action}</strong> by <span className="text-[#6B705C]">{e.actor_email}</span></span>
                <span className="text-[#6B705C] flex-shrink-0">{fmtTime(e.ts)}</span>
              </div>
              {(e.target || (e.metadata && Object.keys(e.metadata).length > 0)) && (
                <p className="text-[#6B705C] mt-0.5 truncate">
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
          className="text-xs font-semibold text-[#3A5A40] hover:text-[#E07A5F] inline-flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" /> Refresh
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          data-testid="admin-audit-export-csv"
          className="text-xs font-semibold text-[#3A5A40] hover:text-[#E07A5F] inline-flex items-center gap-1 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AdminConsole() {
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-10" data-testid="admin-console">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>
        <header className="mb-8 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#3A5A40] text-white flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40]">Operator</p>
            <h1 className="font-serif text-4xl md:text-5xl text-[#2C2C2C] leading-tight">Admin console</h1>
          </div>
        </header>

        <UsersCard />
        <MaintenanceBannerCard />
        <HealthCard />
        <GlobalAliasesCard />
        <GlobalStatsCard />
        <FeatureFlagsCard />
        <AuditLogCard />
      </main>
    </div>
  );
}
