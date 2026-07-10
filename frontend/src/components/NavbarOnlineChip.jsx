import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { api } from "../lib/api";

/**
 * NavbarOnlineChip
 * ----------------
 * Admin-only pill in the Navbar that shows how many users are active
 * "right now" (last 5 minutes) with a dropdown listing them.
 *
 * Data source: `GET /api/admin/presence/online` → `{count, users:[{user_id,name,email,is_admin,last_seen_at}]}`.
 *
 * Polls every 30s + refetches on window focus so the count is fresh
 * without hammering Mongo.  When the count changes between polls the
 * pill briefly flashes amber (went up) or dim (went down) — a subtle
 * signal so admins notice signups landing in real time without needing
 * a full page reload.
 *
 * The `merged` prop pulls off the outer border so the chip can sit
 * flush inside `navbar-admin-cluster` next to `AdminShortcutButton`
 * without a double-border seam.
 *
 * 2026-07-05 rebuild — reconstructed from the shipped prod bundle after
 * an earlier fork's source was lost during a pod state reset.  See
 * `memory/DEPLOY_BLOCKER.md` for the incident timeline.
 */
export default function NavbarOnlineChip({ isAdmin, merged = false }) {
  const [count, setCount] = useState(0);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState(null); // "up" | "down" | null
  const lastCountRef = useRef(null);
  const containerRef = useRef(null);

  const fetchOnline = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/presence/online");
      const c = data?.count || 0;
      setCount(c);
      setUsers(data?.users || []);
      setLoaded(true);
      if (lastCountRef.current !== null && c !== lastCountRef.current) {
        setDirection(c > lastCountRef.current ? "up" : "down");
        setTimeout(() => setDirection(null), 1500);
      }
      lastCountRef.current = c;
    } catch { /* swallow — keep last snapshot */ }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchOnline();
    const id = setInterval(fetchOnline, 30000);
    const onFocus = () => fetchOnline();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [isAdmin, fetchOnline]);

  // Click-outside to close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isAdmin) return null;

  const relTime = (iso) => {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return "just now";
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  const btnBase = merged
    ? "flex items-center gap-1.5 py-1.5 px-2.5 transition-all duration-500 text-sm"
    : "btn-secondary text-sm flex items-center gap-1.5 py-1.5 px-2.5 transition-all duration-500";
  const flash =
    direction === "up"   ? (merged ? "bg-[#F4C77B]/50 scale-[1.03]" : "!bg-[#F4C77B]/50 scale-[1.03]") :
    direction === "down" ? (merged ? "bg-[#9B9B8C]/25 scale-[0.98] opacity-80" : "!bg-[#9B9B8C]/25 scale-[0.98] opacity-80") :
                           (merged ? "hover:bg-[#F5F3EC]" : "");

  return (
    <div ref={containerRef} className="relative flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Online users"
        title={loaded ? `${count} ${count === 1 ? "user" : "users"} online right now` : "Checking who's online…"}
        className={`${btnBase} ${flash}`}
        data-testid="navbar-online-chip"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${count > 0 ? "bg-[#3D6B3D] ring-2 ring-[#3D6B3D]/25" : "bg-[#9B9B8C]"}`} />
        <Users className="w-3.5 h-3.5 opacity-70" />
        <span className="font-semibold tabular-nums" data-testid="navbar-online-count">{count}</span>
      </button>

      {open && (
        <div
          data-testid="navbar-online-chip-menu"
          className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-[#E8E6E1] py-1.5 z-50"
        >
          <div className="px-3 py-2 border-b border-[#EFEDE5]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
              Online now
              <span className="ml-2 font-normal normal-case text-[#9B9B8C]">last 5 min</span>
            </p>
          </div>

          {users.length === 0 ? (
            <p className="px-3 py-4 text-xs text-[#9B9B8C] italic">No one active right now.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {users.map((u) => (
                <li key={u.user_id} data-testid={`navbar-online-user-${u.user_id}`}>
                  <Link
                    to="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F5F3EC]"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3D6B3D] shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[#2C2C2C]">
                      {u.name || u.email || u.user_id}
                    </span>
                    {u.is_admin && (
                      <span className="text-[10px] uppercase tracking-[0.15em] text-[#6B46C1] font-bold shrink-0">Admin</span>
                    )}
                    <span className="text-[10px] text-[#9B9B8C] shrink-0">{relTime(u.last_seen_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="px-3 py-2 border-t border-[#EFEDE5]">
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className="text-xs text-[#6B46C1] font-semibold hover:underline"
              data-testid="navbar-online-chip-view-all"
            >
              View full users list →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
