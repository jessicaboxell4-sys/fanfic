import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ChevronDown } from "lucide-react";

/**
 * AdminShortcutButton
 * -------------------
 * The purple shield in the Navbar admin cluster.  Two pieces welded
 * together with a divider:
 *
 *   [ shield → /admin ] | [ chevron → recent-cards dropdown ]
 *
 * The chevron pops a menu listing the last 3 admin cards the operator
 * opened, sourced from `localStorage["admin.recent_cards"]` — that key
 * is populated inside `AdminConsole.jsx` when a card is expanded.  Each
 * entry stores `{testid, title}`; clicking a row deep-links to
 * `/admin` and the console scrolls to + auto-expands that card via a
 * `?card=` query-param handshake.
 *
 * The orange dot badge on the shield indicates unhandled attention:
 * unknown fandoms + pending crossover suggestions.  Values come in via
 * props from the top-level `Navbar` component which polls the two
 * counters every 5 min.
 *
 * 2026-07-05 rebuild — reconstructed from the shipped prod bundle
 * after an earlier fork's source was lost during a pod state reset.
 */
export default function AdminShortcutButton({ unknownFandomCount = 0, crossoverPendingCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const containerRef = useRef(null);

  const loadRecent = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("admin.recent_cards") || "[]");
      if (!Array.isArray(raw)) { setRecent([]); return; }
      const clean = raw
        .map((r) => (r && typeof r === "object" && r.testid && r.title ? { testid: r.testid, title: r.title } : null))
        .filter(Boolean)
        .slice(0, 3);
      setRecent(clean);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => { if (open) loadRecent(); }, [open, loadRecent]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const totalAttention = unknownFandomCount + crossoverPendingCount;
  const shieldTitle = (() => {
    const bits = [];
    if (unknownFandomCount > 0) bits.push(`${unknownFandomCount} unknown fandom${unknownFandomCount === 1 ? "" : "s"}`);
    if (crossoverPendingCount > 0) bits.push(`${crossoverPendingCount} pending crossover suggestion${crossoverPendingCount === 1 ? "" : "s"}`);
    return bits.length ? `Admin console — ${bits.join(" · ")}` : "Admin console";
  })();

  return (
    <div ref={containerRef} className="relative flex items-stretch">
      <Link
        to="/admin"
        data-testid="navbar-admin"
        className="flex items-center px-2 hover:bg-[#F5F3EC] transition-colors relative"
        title={shieldTitle}
      >
        <ShieldCheck className="w-4 h-4 text-[#6B46C1]" />
        {totalAttention > 0 && (
          <span
            data-testid="navbar-admin-badge"
            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E07A5F] ring-2 ring-[var(--surface)]"
          />
        )}
      </Link>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="navbar-admin-recent-toggle"
        aria-expanded={open}
        aria-label="Recent admin cards"
        title="Recent admin cards"
        className="flex items-center px-1 hover:bg-[#F5F3EC] transition-colors border-l border-[var(--border)]"
      >
        <ChevronDown className={`w-3 h-3 text-[#5B5F4D] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          data-testid="navbar-admin-menu"
          className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-[#E8E6E1] py-1.5 z-50"
        >
          <div className="px-3 py-2 border-b border-[#EFEDE5]">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5B5F4D]">
              Recent admin cards
              <span className="ml-2 font-normal normal-case text-[#9B9B8C]">last 3</span>
            </p>
          </div>

          {recent.length === 0 ? (
            <p className="px-3 py-4 text-xs text-[#9B9B8C] italic">
              No cards opened yet — try expanding a card in the Admin console.
            </p>
          ) : (
            <ul className="py-1">
              {recent.map((c, i) => (
                <li key={c.testid} data-testid={`navbar-admin-recent-${i}`}>
                  <Link
                    to={`/admin?card=${encodeURIComponent(c.testid)}`}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-1.5 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC] truncate"
                    title={c.title}
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="px-3 py-2 border-t border-[#EFEDE5]">
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              data-testid="navbar-admin-open-full"
              className="text-xs text-[#6B46C1] font-semibold hover:underline"
            >
              Open Admin console →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
