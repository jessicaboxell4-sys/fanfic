/**
 * Small helper widgets used by extracted admin cards.
 * Split out 2026-08-18 so the per-category card files (ModerationCards,
 * UsersCards, HealthCards, RecentCards) can import them without
 * dragging in the full AdminConsole.jsx.
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { ChevronRight, Copy, Image as ImageIcon, Loader2, RotateCcw, Users } from "lucide-react";
import { fmtBytes, fmtTime } from "./shared";

export function ImageIconAlias() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}


// ---------------------------------------------------------------------------
// SignupRulesCard — admin controls for approval gate + onboarding + rules
// ---------------------------------------------------------------------------
// Three knobs live in the ``app_config`` doc with ``_id='signup'``:
//   - ``approval_gate_enabled``: when False, new accounts auto-approve
//   - ``questions_enabled``:    when True, register form gates on four
//                               onboarding questions + rules accept
//   - ``rules_md``:             markdown surfaced on /rules and linked
//                               from the register form's checkbox
// Aggregated answers live further down in onboarding-stats so admins
// can see referral mix + favorite-fandom tally at a glance.

export function InviteLinksWidget() {
  // Bake the base URL from the page so this works on preview, prod,
  // and any custom domain attached via Entri.
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const links = [
    { tag: "facebook",     label: "Facebook" },
    { tag: "twitter",      label: "Twitter / X" },
    { tag: "reddit",       label: "Reddit (generic)" },
    { tag: "hpfanfic",     label: "Reddit · r/HPfanfiction" },
    { tag: "fanfiction",   label: "Reddit · r/FanFiction" },
    { tag: "tiktok",       label: "TikTok" },
    { tag: "bookstagram",  label: "Instagram · Bookstagram" },
    { tag: "discord",      label: "Discord server" },
    { tag: "newsletter",   label: "Newsletter" },
  ];
  const copy = async (url, tag) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Copied ${tag} invite link`);
    } catch {
      toast.error("Couldn't access clipboard — copy manually");
    }
  };
  return (
    <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-invite-links">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
          Tracked invite links
        </p>
        <span className="text-[10px] text-[#5B5F4D] dark:text-zinc-400">
          new sign-ups tagged in onboarding-stats
        </span>
      </div>
      <p className="text-xs text-[#3F4034] dark:text-zinc-400 mb-3">
        Each link auto-pre-fills the &ldquo;How did you find Shelfsort?&rdquo; answer
        for the new user.  Anything after <code className="font-mono">?ref=</code>
        is captured verbatim, so add your own tags too.
      </p>
      <ul className="grid sm:grid-cols-2 gap-1.5">
        {links.map(({ tag, label }) => {
          const url = `${baseUrl}/?ref=${tag}`;
          return (
            <li key={tag} className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[#2C2C2C] dark:text-zinc-100 w-32 flex-shrink-0">{label}</span>
              <code className="font-mono text-[10px] text-[#3F4034] dark:text-zinc-400 truncate flex-1">{url}</code>
              <button
                type="button"
                onClick={() => copy(url, label)}
                data-testid={`signup-invite-copy-${tag}`}
                className="px-2 py-0.5 rounded bg-[#6B46C1] text-white text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-[#553397] flex-shrink-0"
              >
                Copy
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


// ---------------------------------------------------------------------------
// CampaignStatsWidget — per-channel conversion funnel
// ---------------------------------------------------------------------------
// Paired with InviteLinksWidget above.  For every tracked
// ``onboarding.referral`` value, shows the funnel:
//     signups → approved → uploaded ≥ 1 book → active in last 7 days
// Real users only (test fixtures filtered server-side).  Sorted by
// signups so the most-active channel surfaces first; the "organic"
// row (users with no ref) is the baseline.

export function CampaignStatsWidget() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/campaign-stats");
      setRows(data?.campaigns || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const channelLabel = (ref) => {
    if (!ref) return "Organic / direct";
    const known = {
      facebook: "Facebook", twitter: "Twitter / X", reddit: "Reddit",
      hpfanfic: "r/HPfanfiction", fanfiction: "r/FanFiction",
      tiktok: "TikTok", bookstagram: "Bookstagram", discord: "Discord",
      newsletter: "Newsletter", google: "Google search", friend: "Friend",
    };
    return known[ref] || ref;
  };

  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);

  return (
    <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="signup-campaign-stats">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400">
          Campaign conversion
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="campaign-stats-refresh"
          className="text-[10px] text-[#6B46C1] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> refresh
        </button>
      </div>
      <p className="text-[11px] text-[#5B5F4D] dark:text-zinc-400 mb-3">
        Funnel for each tracked invite channel — real users only.
      </p>

      {loading ? (
        <p className="text-xs text-[#5B5F4D] italic">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[#5B5F4D] italic">No campaign data yet. Share a tracked invite link to start measuring.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs" data-testid="campaign-stats-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#5B5F4D] dark:text-zinc-400 border-b border-[#E5DDC5] dark:border-zinc-700">
                <th className="text-left py-2 px-1 font-semibold">Channel</th>
                <th className="text-right py-2 px-1 font-semibold" title="Landing-page visits with this ?ref= tag (deduped by IP/30-min window)">Clicks</th>
                <th className="text-right py-2 px-1 font-semibold">Signups</th>
                <th className="text-right py-2 px-1 font-semibold" title="Awaiting your approval — click to bulk-approve">Pending</th>
                <th className="text-right py-2 px-1 font-semibold">Approved</th>
                <th className="text-right py-2 px-1 font-semibold" title="Users who uploaded ≥ 1 book">Uploaded</th>
                <th className="text-right py-2 px-1 font-semibold" title="Users who logged in in the last 7 days">Active 7d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOrganic = !r.ref;
                const triggerBulk = () => {
                  if (!r.ref || (r.pending || 0) === 0) return;
                  window.dispatchEvent(new CustomEvent("shelfsort:bulk-approve-ref", { detail: { ref: r.ref } }));
                };
                return (
                  <tr
                    key={r.ref || "__organic__"}
                    data-testid={`campaign-row-${r.ref || "organic"}`}
                    className="border-b border-[#E5DDC5]/40 dark:border-zinc-700/40 last:border-0"
                  >
                    <td className={`py-1.5 px-1 ${isOrganic ? "italic text-[#5B5F4D]" : "text-[#2C2C2C] dark:text-zinc-100 font-medium"}`}>
                      {channelLabel(r.ref)}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {isOrganic ? (
                        <span className="text-[#5B5F4D] dark:text-zinc-400">—</span>
                      ) : (
                        <>
                          {r.clicks || 0}
                          {(r.clicks || 0) > 0 && (
                            <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">
                              ({pct(r.signups, r.clicks)}%)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">{r.signups}</td>
                    <td className="text-right py-1.5 px-1 font-mono">
                      {(r.pending || 0) > 0 && !isOrganic ? (
                        <button
                          type="button"
                          onClick={triggerBulk}
                          data-testid={`campaign-row-approve-${r.ref}`}
                          title={`Bulk-approve all ${r.pending} pending from ${channelLabel(r.ref)}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 transition-colors"
                        >
                          {r.pending} <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[#5B5F4D] dark:text-zinc-400">{r.pending || 0}</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.approved}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.approved, r.signups)}%)</span>
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.uploaded}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.uploaded, r.signups)}%)</span>
                    </td>
                    <td className="text-right py-1.5 px-1 font-mono text-[#2C2C2C] dark:text-zinc-100">
                      {r.active_7d}
                      <span className="text-[#5B5F4D] dark:text-zinc-400 ml-1">({pct(r.active_7d, r.signups)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// Small two-column count list reused inside SignupRulesCard.

export function StatList({ title, rows, testid }) {  return (
    <div data-testid={testid}>
      <p className="text-xs uppercase tracking-[0.15em] text-[#5B5F4D] dark:text-zinc-400 font-bold mb-1.5">{title}</p>
      {!rows || rows.length === 0 ? (
        <p className="text-xs text-[#5B5F4D] dark:text-zinc-400 italic">No answers yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between text-sm">
              <span className="text-[#2C2C2C] dark:text-zinc-100 capitalize">{r.label}</span>
              <span className="text-[#5B5F4D] dark:text-zinc-400 font-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// AntivirusCard — ClamAV scanner status + recent quarantine entries
// ---------------------------------------------------------------------------
// Health probe uses an EICAR liveness scan (real test signature all AV
// vendors flag, no actual threat) so we know the daemon AND the
// signature DB are functioning, not just installed.  Quarantine
// list shows every flagged file with the source endpoint, signature,
// user, and timestamp so admins can audit what got through (or didn't).
