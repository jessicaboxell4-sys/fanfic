import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Loader2, Smartphone, Monitor, Tablet, LogOut, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// ActiveSessionsCard (2026-08-22)
// ---------------------------------------------------------------------------
// "Signed in elsewhere" panel on the Account settings page. Lists every
// non-expired row in `user_sessions` for the current user, marks which
// one is the calling device, and offers per-row revoke + one-tap
// "Sign out everywhere else". Complements the AuthContext resilience
// fix (retry /auth/me under transient 401s) by giving users visibility
// when a session actually was invalidated on purpose.
//
// Backend contract (see /app/backend/routes/auth.py):
//   GET    /api/auth/sessions              → { sessions:[{id, browser, platform, user_agent, created_at, last_active_at, expires_at, is_current}], count }
//   DELETE /api/auth/sessions/{id}         → { ok, revoked }
//   POST   /api/auth/sessions/revoke-others → { ok, revoked }
//
// Anchor / testid: `active-sessions-card` (referenced by SettingsToC).
// ---------------------------------------------------------------------------

function relativeTime(iso) {
  if (!iso) return "just now";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function DeviceIcon({ platform }) {
  const p = (platform || "").toLowerCase();
  if (p.includes("iphone") || p.includes("android")) return <Smartphone className="w-5 h-5" />;
  if (p.includes("ipad")) return <Tablet className="w-5 h-5" />;
  return <Monitor className="w-5 h-5" />;
}

export default function ActiveSessionsCard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/auth/sessions");
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Couldn't load your sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeOne = async (id) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.success("Session signed out.");
      // Optimistic — drop the row locally, then re-fetch to be safe.
      setSessions((prev) => prev.filter((s) => s.id !== id));
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't revoke that session.");
    } finally {
      setBusyId(null);
    }
  };

  const revokeAllOthers = async () => {
    if (busyAll) return;
    const others = sessions.filter((s) => !s.is_current).length;
    if (others === 0) return;
    if (!window.confirm(`Sign out of ${others} other session${others === 1 ? "" : "s"}?`)) return;
    setBusyAll(true);
    try {
      const { data } = await api.post("/auth/sessions/revoke-others");
      toast.success(`Signed out of ${data?.revoked ?? others} other session${(data?.revoked ?? others) === 1 ? "" : "s"}.`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't revoke other sessions.");
    } finally {
      setBusyAll(false);
    }
  };

  const otherCount = sessions.filter((s) => !s.is_current).length;

  return (
    <section
      id="active-sessions"
      className="shelf-card p-6 mb-6"
      data-testid="active-sessions-card"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#2C2C2C] dark:text-white flex items-center gap-2">
            <Monitor className="w-5 h-5 text-[#6B46C1]" />
            Active devices
          </h2>
          <p className="text-sm text-[#5B5F4D] dark:text-white/70 mt-1">
            Every browser and device signed in as you. Sign out anything that shouldn&rsquo;t be here.
          </p>
        </div>
        {otherCount > 0 && (
          <button
            type="button"
            onClick={revokeAllOthers}
            disabled={busyAll}
            className="text-xs px-3 py-1.5 rounded-md border border-[#E5DDC5] dark:border-zinc-700 text-[#2C2C2C] dark:text-white hover:bg-[#F5F0E5] dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
            data-testid="active-sessions-revoke-others"
          >
            {busyAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Sign out everywhere else
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-[#5B5F4D] dark:text-white/70 py-4" data-testid="active-sessions-loading">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading&hellip;
        </div>
      )}

      {!loading && error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 p-3 rounded-md" data-testid="active-sessions-error">
          {error}
          <button
            type="button"
            onClick={load}
            className="ml-3 underline"
            data-testid="active-sessions-retry"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <p className="text-sm italic text-[#5B5F4D] dark:text-white/70 py-2" data-testid="active-sessions-empty">
          No active sessions found.
        </p>
      )}

      {!loading && !error && sessions.length > 0 && (
        <ul className="divide-y divide-[#E5DDC5] dark:divide-zinc-700" data-testid="active-sessions-list">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="py-3 flex items-center gap-3"
              data-testid={`active-session-row-${s.id}`}
            >
              <div className="text-[#6B46C1] shrink-0" aria-hidden="true">
                <DeviceIcon platform={s.platform} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[#2C2C2C] dark:text-white">
                    {s.browser} &middot; {s.platform}
                  </span>
                  {s.is_current && (
                    <span
                      className="text-[10px] uppercase tracking-wider bg-[#6B46C1] text-white px-1.5 py-0.5 rounded"
                      data-testid={`active-session-current-${s.id}`}
                    >
                      This device
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#5B5F4D] dark:text-white/60 mt-0.5">
                  Last active {relativeTime(s.last_active_at)}
                  {" · "}
                  Signed in {relativeTime(s.created_at)}
                </div>
              </div>
              {!s.is_current && (
                <button
                  type="button"
                  onClick={() => revokeOne(s.id)}
                  disabled={busyId === s.id}
                  className="text-xs px-2.5 py-1 rounded-md border border-[#E5DDC5] dark:border-zinc-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 flex items-center gap-1 shrink-0"
                  data-testid={`active-session-revoke-${s.id}`}
                  aria-label={`Sign out of ${s.browser} on ${s.platform}`}
                >
                  {busyId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
