import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, Users, Heart, AlertTriangle, Activity, Layers,
  BarChart3, ToggleLeft, ClipboardList, Loader2, Plus, X as XIcon, Trash2,
  Check, ChevronRight, Download, AlertOctagon, RotateCcw, Send, Mail,
  MessageSquare, Clock, CircleAlert, Route as RouteIcon, Search,
  Inbox,
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
        <div className="w-10 h-10 rounded-xl bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0">
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
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#6B46C1] font-bold">
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
                    : "text-[#6B46C1] hover:bg-[#EEE9FB]"
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
          <p className="text-xs text-[#6B705C] mt-1">{message.length}/240</p>
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
        ok ? "bg-[#EEE9FB] text-[#6B46C1]" : "bg-[#FBE9E7] text-[#9B3531]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#6B46C1]" : "bg-[#9B3531]"}`} />
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
        <span>{title} <span className="text-[#6B705C] font-normal lowercase tracking-normal">({items.length})</span></span>
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
            className="text-[11px] italic text-[#6B705C] text-center pt-1"
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
function UnknownFandomRow({ r, isDismissed, busy, onRescan, onDismiss, onUndismiss }) {
  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5]"
      data-testid={`admin-unknown-fandom-row-${r.fandom}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#2C2C2C] truncate">
          {r.fandom}
          <span className="ml-2 text-xs text-[#6B705C] font-normal">{r.count} book{r.count === 1 ? "" : "s"}</span>
          {isDismissed && <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-[#6B705C] font-bold">DISMISSED</span>}
        </p>
        {r.sample_book_ids?.length > 0 && (
          <p className="text-xs text-[#6B705C] truncate">
            Sample IDs: <code>{r.sample_book_ids.slice(0, 3).join(", ")}</code>
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => onRescan(r.fandom, r.count)}
          disabled={busy === `rescan:${r.fandom}`}
          data-testid={`admin-unknown-fandom-rescan-${r.fandom}`}
          className="text-xs px-3 py-1.5 rounded-lg text-[#6B46C1] hover:bg-[#EEE9FB] inline-flex items-center gap-1 font-semibold"
          title="Re-run keyword classifier on these books"
        >
          {busy === `rescan:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Rescan
        </button>
        {isDismissed ? (
          <button
            type="button"
            onClick={() => onUndismiss(r.fandom)}
            disabled={busy === `undismiss:${r.fandom}`}
            data-testid={`admin-unknown-fandom-undismiss-${r.fandom}`}
            className="text-xs px-3 py-1.5 rounded-lg text-[#6B705C] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
          >
            {busy === `undismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onDismiss(r.fandom)}
            disabled={busy === `dismiss:${r.fandom}`}
            data-testid={`admin-unknown-fandom-dismiss-${r.fandom}`}
            className="text-xs px-3 py-1.5 rounded-lg text-[#6B705C] hover:bg-[#F5F3EC] inline-flex items-center gap-1"
          >
            {busy === `dismiss:${r.fandom}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
            Dismiss
          </button>
        )}
      </div>
    </li>
  );
}

function UnknownFandomsCard() {
  const [rows, setRows] = useState([]);
  const [dismissedRows, setDismissedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/unknown-fandoms");
      setRows(data?.unknown || []);
      setDismissedRows(data?.dismissed || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dismiss = async (fandom) => {
    setBusy(`dismiss:${fandom}`);
    try {
      await api.post(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Dismissed "${fandom}"`);
      await load();
    } catch { toast.error("Couldn't dismiss"); }
    finally { setBusy(null); }
  };

  const undismiss = async (fandom) => {
    setBusy(`undismiss:${fandom}`);
    try {
      await api.delete(`/admin/unknown-fandoms/${encodeURIComponent(fandom)}/dismiss`);
      toast.success(`Restored "${fandom}"`);
      await load();
    } catch { toast.error("Couldn't restore"); }
    finally { setBusy(null); }
  };

  const rescan = async (fandom, count) => {
    if (!window.confirm(
      `Re-scan ${count} book${count === 1 ? "" : "s"} tagged "${fandom}" against the current ${151} keyword sets?\n\nBooks whose title/author/description now matches a known fandom will be reassigned. No EPUB re-parse, no AI call.`
    )) return;
    setBusy(`rescan:${fandom}`);
    try {
      const { data } = await api.post(
        `/admin/unknown-fandoms/${encodeURIComponent(fandom)}/rescan`,
        { dry_run: false },
      );
      toast.success(`Scanned ${data.scanned} · reclassified ${data.reclassified}`, { duration: 8000 });
      await load();
    } catch { toast.error("Rescan failed"); }
    finally { setBusy(null); }
  };

  return (
    <Card icon={AlertOctagon} title="Unknown fandoms" subtitle="Fandoms appearing in book records that aren't in the keyword classifier yet. Rescan re-runs the classifier on existing books (no AI, no re-parse). Dismiss to hide permanently." testid="admin-unknown-fandoms-card">
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-[#6B46C1] inline-flex items-center gap-1.5" data-testid="admin-unknown-fandoms-empty">
              <Check className="w-4 h-4" /> All fandoms in your library are recognized.
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="admin-unknown-fandoms-list">
              {rows.map((r) => (
                <UnknownFandomRow
                  key={r.fandom}
                  r={r}
                  isDismissed={false}
                  busy={busy}
                  onRescan={rescan}
                  onDismiss={dismiss}
                  onUndismiss={undismiss}
                />
              ))}
            </ul>
          )}
          {dismissedRows.length > 0 && (
            <details className="mt-4" data-testid="admin-unknown-fandoms-dismissed-details">
              <summary className="text-xs font-semibold text-[#6B705C] cursor-pointer hover:text-[#2C2C2C]">
                Dismissed ({dismissedRows.length}) — still scannable
              </summary>
              <ul className="mt-2 space-y-1.5" data-testid="admin-unknown-fandoms-dismissed-list">
                {dismissedRows.map((r) => (
                  <UnknownFandomRow
                    key={r.fandom}
                    r={r}
                    isDismissed={true}
                    busy={busy}
                    onRescan={rescan}
                    onDismiss={dismiss}
                    onUndismiss={undismiss}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Email diagnostic card (operator one-shot send)
// ---------------------------------------------------------------------------
function EmailDiagnosticCard() {
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
          <legend className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1">Recipient</legend>
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
          <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1 block">
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
          <p className="text-xs text-[#6B705C] mt-1">{note.length}/200</p>
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
                <code className="ml-1 text-[10px] text-[#6B705C] font-mono">#{lastResult.id.slice(0, 8)}</code>
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
// Chat Rooms card (admin-curated direct messaging)
// ---------------------------------------------------------------------------
function ChatRoomsCard() {
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [r, u] = await Promise.all([
        api.get("/admin/chat-rooms"),
        api.get("/admin/users"),
      ]);
      setRooms(r?.data?.rooms || []);
      setUsers(u?.data?.users || []);
    } catch { toast.error("Couldn't load chat rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleMember = (uid, current, setCurrent) => {
    setCurrent(current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid]);
  };

  const create = async () => {
    if (!name.trim() || memberIds.length === 0) {
      toast.error("Need a name and at least one member");
      return;
    }
    setCreating(true);
    try {
      await api.post("/admin/chat-rooms", { name: name.trim(), member_user_ids: memberIds });
      toast.success("Room created");
      setName(""); setMemberIds([]);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create room");
    } finally { setCreating(false); }
  };

  const startEdit = (r) => {
    setEditingId(r.room_id);
    setEditName(r.name);
    setEditMembers(r.member_user_ids || []);
  };

  const saveEdit = async (room_id) => {
    try {
      await api.put(`/admin/chat-rooms/${room_id}`, { name: editName.trim(), member_user_ids: editMembers });
      toast.success("Room updated");
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    }
  };

  const remove = async (room_id, name) => {
    if (!window.confirm(`Delete room "${name}"? This wipes every message inside it.`)) return;
    try {
      await api.delete(`/admin/chat-rooms/${room_id}`);
      toast.success("Room deleted");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    }
  };

  return (
    <Card
      icon={MessageSquare}
      title="Chat rooms"
      subtitle="Create direct-message rooms for sets of users. Members can talk freely inside, share books and palette tokens. Only admins can create / edit / delete rooms (Phase 1 — open user-to-user messaging is parked)."
      testid="admin-chat-rooms-card"
    >
      {loading ? (
        <p className="text-sm text-[#6B705C] italic">Loading…</p>
      ) : (
        <>
          {rooms.length === 0 ? (
            <p className="text-sm text-[#6B705C] italic mb-4" data-testid="admin-chat-rooms-empty">
              No rooms yet. Create one below.
            </p>
          ) : (
            <ul className="space-y-2 mb-5" data-testid="admin-chat-rooms-list">
              {rooms.map((r) => {
                const isEditing = editingId === r.room_id;
                return (
                  <li
                    key={r.room_id}
                    data-testid={`admin-chat-room-row-${r.room_id}`}
                    className="p-3 rounded-lg border border-[#E8E6E1] bg-white"
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          data-testid={`admin-chat-room-edit-name-${r.room_id}`}
                          className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5]"
                        />
                        <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-[#FBFAF6]">
                          {users.map((u) => (
                            <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editMembers.includes(u.user_id)}
                                onChange={() => toggleMember(u.user_id, editMembers, setEditMembers)}
                                data-testid={`admin-chat-room-edit-member-${r.room_id}-${u.user_id}`}
                              />
                              <span className="truncate">{u.email}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(r.room_id)}
                            data-testid={`admin-chat-room-save-${r.room_id}`}
                            className="text-xs px-3 py-1 rounded bg-[#6B46C1] text-white font-semibold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs px-3 py-1 rounded border border-[#E5DDC5]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#2C2C2C]">{r.name}</p>
                          <p className="text-[11px] text-[#6B705C]">
                            {r.member_user_ids.length} member{r.member_user_ids.length === 1 ? "" : "s"}
                            {r.last_message_at ? ` · last active ${fmtTime(r.last_message_at)}` : " · no messages yet"}
                          </p>
                          <p className="text-[10px] text-[#6B705C] truncate mt-0.5">
                            {r.member_user_ids.slice(0, 5).map((uid) => {
                              const u = users.find((x) => x.user_id === uid);
                              return u ? u.email : uid;
                            }).join(", ")}
                            {r.member_user_ids.length > 5 ? ` +${r.member_user_ids.length - 5}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            data-testid={`admin-chat-room-edit-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] hover:bg-[#FBFAF6]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(r.room_id, r.name)}
                            data-testid={`admin-chat-room-delete-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded text-[#B43F26] hover:bg-[#FBE8E0]"
                            title="Delete room"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Create form */}
          <div className="rounded-xl border border-[#E5DDC5] bg-[#FBFAF6] p-4" data-testid="admin-chat-room-create-form">
            <p className="text-xs font-bold uppercase tracking-wider text-[#6B46C1] mb-2">Create a new room</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name (e.g. Beta readers)"
              data-testid="admin-chat-room-new-name"
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5] bg-white mb-2"
            />
            <p className="text-[10px] uppercase tracking-wider text-[#6B705C] mb-1">Members</p>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-white mb-3">
              {users.map((u) => (
                <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(u.user_id)}
                    onChange={() => toggleMember(u.user_id, memberIds, setMemberIds)}
                    data-testid={`admin-chat-room-new-member-${u.user_id}`}
                  />
                  <span className="truncate">{u.email}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={create}
              disabled={creating || !name.trim() || memberIds.length === 0}
              data-testid="admin-chat-room-create-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4632] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create room
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// Cron Health card — surfaces last run + status of every scheduled job so a
// silent cron crash can't go unnoticed (the reason this widget exists at all).
// ---------------------------------------------------------------------------
function fmtAgo(iso) {
  if (!iso) return "never";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

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
          <p className="text-xs text-[#6B705C] mt-1">
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
            <p className="text-xs text-[#6B705C]">No runs recorded yet.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-auto" data-testid={`cron-history-${job.id}`}>
              {job.recent.map((r, idx) => (
                <li key={idx} className="text-xs flex items-start gap-2 font-mono">
                  <span className={r.status === "ok" ? "text-[#6B46C1]" : "text-red-700"}>
                    {r.status === "ok" ? "✓" : "✗"}
                  </span>
                  <span className="text-[#6B705C] flex-shrink-0">{fmtTime(r.started_at)}</span>
                  <span className="text-[#6B705C] flex-shrink-0">{r.duration_ms ?? "?"}ms</span>
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
        <p className="text-xs text-[#6B705C]">
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
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
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
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B705C]" />
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
        <p className="text-xs text-[#6B705C]">
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
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
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
                <span className="text-xs text-[#6B705C]">
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
                      {r.doc && <span className="text-[#6B705C] italic font-sans">— {r.doc}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && !loading && (
          <p className="text-sm text-[#6B705C]" data-testid="route-catalogue-empty">
            {staleOnly ? `No modules stale (≥ ${staleDays} days).` : "No routes match your filter."}
          </p>
        )}
      </div>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// A2 — Email-stats card. Rolling 7-day Resend telemetry pulled from db.email_logs.
// ---------------------------------------------------------------------------
function EmailStatsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get("/admin/email-stats");
      setData(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <Card icon={Inbox} title="Resend deliveries · this week" subtitle="Send volume, error rate, and recent failures." testid="email-stats-card">
      {loading && !data && <p className="text-sm text-[#6B705C]">Loading…</p>}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" data-testid="email-stats-error">{error}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white border border-[#E8E2D4] rounded-lg p-3" data-testid="email-stats-total">
              <p className="text-xs text-[#6B705C]">Total (7d)</p>
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
              <p className="text-xs text-[#6B705C]">Error rate</p>
              <p className="text-2xl font-medium text-[#2C2C2C]">{(data.error_rate_7d * 100).toFixed(1)}%</p>
            </div>
          </div>
          {data.by_kind.length > 0 && (
            <div className="mb-4" data-testid="email-stats-by-kind">
              <p className="text-xs font-medium text-[#2C2C2C] mb-2">Per template (7d)</p>
              <ul className="space-y-1 text-sm font-mono">
                {data.by_kind.map((k) => (
                  <li key={k.kind} className="flex items-center gap-3 text-[#2C2C2C]" data-testid={`email-stats-kind-${k.kind}`}>
                    <span className="flex-1">{k.kind}</span>
                    <span className="text-[#6B46C1]">{k.ok} ok</span>
                    {k.error > 0 && <span className="text-red-700">{k.error} err</span>}
                    <span className="text-[#6B705C]">{k.total} total</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recent_failures.length > 0 && (
            <div data-testid="email-stats-failures">
              <p className="text-xs font-medium text-red-700 mb-2">Recent failures</p>
              <ul className="space-y-1 text-xs font-mono">
                {data.recent_failures.map((f, i) => (
                  <li key={i} className="text-red-700 break-all" data-testid={`email-stats-failure-${i}`}>
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



export default function AdminConsole() {
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-10" data-testid="admin-console">
        <Link to="/library" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>
        <header className="mb-8 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1] text-white flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1]">Operator</p>
            <h1 className="font-serif text-4xl md:text-5xl text-[#2C2C2C] leading-tight">Admin console</h1>
          </div>
        </header>

        <UsersCard />
        <ChatRoomsCard />
        <UnknownFandomsCard />
        <MaintenanceBannerCard />
        <HealthCard />
        <CronHealthCard />
        <RouteCatalogueCard />
        <EmailStatsCard />
        <EmailDiagnosticCard />
        <GlobalAliasesCard />
        <GlobalStatsCard />
        <FeatureFlagsCard />
        <AuditLogCard />
      </main>
    </div>
  );
}
