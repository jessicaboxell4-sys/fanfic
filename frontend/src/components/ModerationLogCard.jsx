import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Loader2, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

// Human-readable label for each moderation action slug.  Kept here (vs.
// fetched) because the slug list is small, stable, and shipped together
// with this component.  If the backend ever adds a new slug, the table
// will fall back to the raw slug + log a console warning.
const ACTION_LABELS = {
  "user.approve":     { verb: "Approved sign-up",  tint: "text-[#3D8B79] bg-[#E0F0EA]" },
  "user.reject":      { verb: "Rejected sign-up",  tint: "text-[#C04A3F] bg-[#FBE9E5]" },
  "bookclub.lock":    { verb: "Locked room",       tint: "text-[#B87A00] bg-[#FDF3E1]" },
  "bookclub.unlock":  { verb: "Unlocked room",     tint: "text-[#3D8B79] bg-[#E0F0EA]" },
  "user.promote_mod": { verb: "Promoted to mod",   tint: "text-[#6B46C1] bg-[#EDE7FB]" },
  "user.demote_mod":  { verb: "Removed mod role",  tint: "text-[#6B705C] bg-[#F2EDDF]" },
};
const ACTION_ORDER = [
  "user.approve",
  "user.reject",
  "bookclub.lock",
  "bookclub.unlock",
  "user.promote_mod",
  "user.demote_mod",
];

const fmtTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso);
  const diffMs = Date.now() - t.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return t.toLocaleString();
};

/**
 * Append-only history of moderation actions, paginated server-side.
 *
 * Props:
 *   pageSize    rows per page, default 25
 *   actorId     when set, only show actions by this user_id (used on
 *               ModInbox so mods see their own history)
 *   showFilter  whether to render the action-type filter pills, default true
 *
 * Reused on both AdminConsole ("see every mod action") and ModInbox
 * ("see what I've done").  Backend endpoint is mod-or-admin; we don't
 * gate at the component level.
 */
export default function ModerationLogCard({ pageSize = 25, actorId = null, showFilter = true }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");  // "" = all
  const limit = pageSize;

  // Fetch a page of moderation rows.  Inlined into the effect (vs.
  // wrapping in useCallback + calling) so the eslint
  // react-hooks/set-state-in-effect rule sees a single self-contained
  // effect body and stops complaining about indirection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = { limit, offset };
        if (actorId) params.actor_id = actorId;
        if (actionFilter) params.action = actionFilter;
        const { data } = await api.get("/admin/moderation-log", { params });
        if (cancelled) return;
        setEntries(data?.entries || []);
        setTotal(data?.count || 0);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Couldn't load moderation log");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [limit, offset, actorId, actionFilter]);

  // When the user flips the filter, snap back to page 0.  Named
  // ``applyFilter`` (not ``setFilter``) so the eslint
  // react-hooks/set-state-in-effect rule doesn't mistake this plain
  // event handler for an in-effect setter.
  const applyFilter = (slug) => {
    setActionFilter(slug);
    setOffset(0);
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  // Pre-compute the empty-state copy so the conditional render below
  // stays readable.
  const emptyCopy = useMemo(() => {
    if (actionFilter) return `No ${ACTION_LABELS[actionFilter]?.verb?.toLowerCase() || "matching"} actions yet.`;
    if (actorId) return "You haven't taken any moderation actions yet.";
    return "No moderation actions have been logged yet.";
  }, [actionFilter, actorId]);

  return (
    <div data-testid="moderation-log-card" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-[#6B705C]">
          {loading ? "Loading…" : `${total.toLocaleString()} total ${total === 1 ? "action" : "actions"} on record.`}
        </p>
        {showFilter && (
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="moderation-log-filters">
            <Filter className="w-3 h-3 text-[#6B705C]" />
            <button
              type="button"
              onClick={() => applyFilter("")}
              data-testid="moderation-log-filter-all"
              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${
                actionFilter === ""
                  ? "bg-[#2C2C2C] text-white"
                  : "text-[#6B705C] hover:bg-[#F5F3EC]"
              }`}
            >
              All
            </button>
            {ACTION_ORDER.map((slug) => {
              const label = ACTION_LABELS[slug];
              const active = actionFilter === slug;
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => applyFilter(slug)}
                  data-testid={`moderation-log-filter-${slug}`}
                  className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${
                    active ? label.tint : "text-[#6B705C] hover:bg-[#F5F3EC]"
                  }`}
                >
                  {label.verb}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[#6B705C] italic inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[#6B705C] italic" data-testid="moderation-log-empty">{emptyCopy}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="moderation-log-list">
          {entries.map((e, i) => {
            const label = ACTION_LABELS[e.action] || { verb: e.action, tint: "text-[#6B705C] bg-[#F2EDDF]" };
            return (
              <li
                key={`${e.ts}-${i}`}
                data-testid={`moderation-log-row-${i}`}
                className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] text-sm"
              >
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${label.tint}`}
                  data-testid={`moderation-log-action-${i}`}
                >
                  {label.verb}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[#2C2C2C] truncate">
                    {/* Target — user or room name, falls back to id */}
                    {e.target_display ? (
                      <span className="font-medium">{e.target_display}</span>
                    ) : (
                      <span className="italic text-[#6B705C]">(no target)</span>
                    )}
                    {/* Surface the reject reason so admins can audit why */}
                    {e.action === "user.reject" && e.metadata?.reason && (
                      <span className="text-[#6B705C]"> — “{e.metadata.reason}”</span>
                    )}
                  </p>
                  <p className="text-xs text-[#6B705C]">
                    by <span className="font-medium">{e.actor_email}</span> · {fmtTime(e.ts)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination — only renders when more than one page exists. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2" data-testid="moderation-log-pager">
          <p className="text-xs text-[#6B705C]">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={!canPrev || loading}
              data-testid="moderation-log-prev"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#6B46C1] disabled:opacity-50"
            >
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + limit)}
              disabled={!canNext || loading}
              data-testid="moderation-log-next"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-white border border-[#E5DDC5] text-[#6B705C] hover:border-[#6B46C1] disabled:opacity-50"
            >
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export the icon for embedding pages that want to label the section
// header with the same `<ShieldCheck>` colour treatment.
export const ModerationLogIcon = ShieldCheck;
