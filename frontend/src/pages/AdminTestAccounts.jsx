import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";
import { ArrowLeft, FlaskConical, Trash2, Loader2, Check, X as XIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * /admin/test-accounts — fixture quarantine.
 *
 * Companion page to the main AdminConsole Pending-Sign-ups card.  Lists
 * every account whose email matches the "test fixture" patterns defined
 * in ``backend/utils/test_account_filter.py`` (``@test.local``,
 * ``@example.com``, prefixes like ``test_``/``sync_``/``linkless_``)
 * regardless of approval status.
 *
 * Admins get a one-click "Purge all" button to wipe every fixture
 * (users + their books + their sessions) so the database stays clean
 * between testing-agent runs.  Moderators can only view.
 */
function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return ts; }
}

const STATUS_PILL = {
  pending:  "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
};

export default function AdminTestAccounts() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/test-accounts");
      setRows(data?.users || []);
    } catch (e) {
      toast.error("Couldn't load test accounts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const purgeAll = async () => {
    if (!window.confirm(`Hard-delete ${rows.length} fixture account${rows.length === 1 ? "" : "s"}?\n\nThis removes their user records, books, and sessions. Idempotent — safe to re-run.`)) return;
    setPurging(true);
    try {
      const { data } = await api.post("/admin/test-accounts/purge");
      toast.success(`Purged ${data.deleted_users} user${data.deleted_users === 1 ? "" : "s"} · ${data.deleted_books} book${data.deleted_books === 1 ? "" : "s"} · ${data.deleted_sessions} session${data.deleted_sessions === 1 ? "" : "s"}`);
      setRows([]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't purge — try again");
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <Link
          to="/admin"
          data-testid="back-to-admin"
          className="inline-flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Admin Console
        </Link>

        <header className="mb-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3 inline-flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Quarantine
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight">
              {loading
                ? "Loading test accounts…"
                : rows.length === 0
                  ? "No fixture accounts."
                  : `${rows.length} fixture account${rows.length === 1 ? "" : "s"}.`}
            </h1>
            <p className="text-[#5B5F4D] mt-3 max-w-2xl">
              Accounts whose email matches the test-fixture patterns
              (<code className="font-mono text-xs">@test.local</code>,
              <code className="font-mono text-xs"> @example.com</code>, prefixes like
              <code className="font-mono text-xs"> test_</code>,
              <code className="font-mono text-xs"> sync_</code>,
              <code className="font-mono text-xs"> linkless_</code>).
              They&apos;re filtered out of your main Pending sign-ups inbox so they don&apos;t clutter it.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              data-testid="test-accounts-refresh"
              className="px-3 py-2 rounded-xl border border-[#E8E6E1] bg-white text-sm text-[#5B5F4D] hover:bg-[#F5F3EC] inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={purgeAll}
              disabled={purging || rows.length === 0}
              data-testid="test-accounts-purge-all"
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {purging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {purging ? "Purging…" : "Purge all"}
            </button>
          </div>
        </header>

        {loading ? (
          <p className="text-[#5B5F4D] py-10 text-center" data-testid="test-accounts-loading">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="shelf-card p-10 text-center" data-testid="test-accounts-empty">
            <Check className="w-10 h-10 text-[#1F8F4E] mx-auto mb-4 opacity-70" />
            <h2 className="font-serif text-2xl text-[#2C2C2C] mb-2">All clean</h2>
            <p className="text-[#5B5F4D] max-w-md mx-auto">
              No fixture accounts in the database right now. The next test-agent run will land here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="test-accounts-list">
            {rows.map((u) => {
              const status = (u.approval_status || "pending").toLowerCase();
              const pillClass = STATUS_PILL[status] || STATUS_PILL.pending;
              return (
                <li
                  key={u.user_id}
                  className="shelf-card p-4 flex flex-wrap items-start justify-between gap-3"
                  data-testid={`test-account-row-${u.user_id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[#2C2C2C] truncate">{u.name || u.email}</p>
                    <p className="text-xs text-[#5B5F4D] truncate font-mono">{u.email}</p>
                    {u.username && (
                      <p className="text-xs text-[#5B5F4D] mt-0.5">@{u.username}</p>
                    )}
                    <p className="text-xs text-[#5B5F4D] mt-1">
                      Created {fmtTime(u.created_at)}
                      {u.approved_at && ` · approved ${fmtTime(u.approved_at)}`}
                    </p>
                    {u.approval_rejected_reason && (
                      <p className="text-xs text-red-700 mt-1 italic">
                        Rejected: {u.approval_rejected_reason}
                      </p>
                    )}
                  </div>
                  <span
                    data-testid={`test-account-status-${u.user_id}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border ${pillClass}`}
                  >
                    {status === "approved" ? <Check className="w-3 h-3" /> :
                      status === "rejected" ? <XIcon className="w-3 h-3" /> :
                      null}
                    {status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
