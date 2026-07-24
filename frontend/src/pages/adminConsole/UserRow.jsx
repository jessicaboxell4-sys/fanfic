/**
 * UserRow — extracted 2026-08-22 from UsersCards.jsx.
 *
 * The <li> for a single admin user row on the Users & admins card.
 * Was previously inlined as a `renderRow` closure inside UsersCard,
 * where it accounted for ~185 of the file's ~975 lines and had to
 * capture the whole surrounding state via lexical scope. Pulling it
 * into a standalone component:
 *
 *   - keeps UsersCards.jsx below the ~700-line refactor guideline
 *   - makes each piece of user-facing UI (presence pill, admin
 *     badges, attribution "came from" strip, mod/admin toggles)
 *     independently readable and greppable
 *   - lets us memoize on `u.user_id` + `busyId === u.user_id` if we
 *     ever start rendering hundreds of users at once
 *
 * NO behavior changes vs the closure it replaced — every testid,
 * class name, tooltip, and interaction handler is preserved
 * verbatim. If you're diff-reading this against the removed
 * `renderRow` block, expect a byte-for-byte match modulo the
 * `props` unpacking at the top.
 */
import React from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { fmtTime, fmtAgo } from "./shared";

export default function UserRow({
  u,
  busyId,
  toggleAdmin,
  toggleMod,
  openTimeline,
  isUserOnline,
  fmtActive,
  isTestUser,
}) {
  const online = isUserOnline(u);
  return (
    <li
      key={u.user_id}
      data-online={online ? "true" : "false"}
      className={`flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg border transition-colors ${online ? "bg-[#F0F7EE] dark:bg-emerald-950/40 border-l-[3px] border-l-[#3D6B3D] dark:border-l-emerald-500 border-[#D6E5CE] dark:border-emerald-800/50" : "bg-[#FBFAF6] dark:bg-zinc-800/60 border-[#E5DDC5] dark:border-zinc-700"}`}
      data-testid={`admin-user-row-${u.user_id}`}
    >
      <div className="min-w-0 flex-1">
        {u.email && (
          <p
            className="text-[10px] font-mono text-[#5B5F4D] dark:text-white/60 truncate mb-0.5"
            data-testid={`admin-user-email-${u.user_id}`}
          >
            {u.email}
          </p>
        )}
        <p className="font-semibold text-[#2C2C2C] dark:text-white truncate flex items-center gap-1.5 flex-wrap">
          {/* Presence pill — green "ONLINE · active X" if last_seen_at
              within 5 min, grey "OFFLINE" otherwise.  Throttled write
              from get_current_user.  See auth_dep.py. */}
          {(() => {
            const seenIso = u.last_seen_at;
            const isOnline = isUserOnline(u);
            const activeText = seenIso ? fmtActive(seenIso) : "";
            return (
              <span
                data-testid={`admin-user-presence-${u.user_id}`}
                data-online={isOnline ? "true" : "false"}
                className={`inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.15em] px-1.5 py-0.5 rounded ${
                  isOnline
                    ? "bg-[#E0F0EA] text-[#2F6E60] border border-[#3D6B3D]/25"
                    : "bg-[#F2EDDF] text-[#5B5F4D] border border-[#9B9B8C]/25"
                }`}
                title={
                  seenIso
                    ? (isOnline
                        ? `Online — last activity ${new Date(seenIso).toLocaleString()}`
                        : `Offline — last activity ${new Date(seenIso).toLocaleString()}`)
                    : "Offline — no activity since presence tracking was introduced"
                }
              >
                <span
                  aria-hidden="true"
                  className={`inline-block w-1.5 h-1.5 rounded-full ${isOnline ? "bg-[#3D6B3D]" : "bg-[#9B9B8C]/70"}`}
                />
                {isOnline ? (
                  <>
                    <span>Online</span>
                    {activeText && (
                      <span className="font-normal normal-case tracking-normal text-[#5B5F4D]">
                        · active {activeText}
                      </span>
                    )}
                    {/* 2026-07-10 — Where they are right now, admin-only.
                        Written by `auth_dep._touch_last_seen` throttled
                        to 1/min per user; noisy polls skipped so this
                        shows a real page navigation. Only rendered for
                        online users (the offline value is stale). */}
                    {u.last_seen_path && (
                      <span
                        className="font-normal normal-case tracking-normal text-[#5B5F4D] max-w-[16em] truncate"
                        data-testid={`admin-user-location-${u.user_id}`}
                        title={`Last seen at ${u.last_seen_path}`}
                      >
                        · on <code className="text-[#4C2A99] font-mono text-[10px]">{u.last_seen_path}</code>
                      </span>
                    )}
                  </>
                ) : (
                  <span>Offline</span>
                )}
              </span>
            );
          })()}
          {u.name || u.email}
          {u.is_admin && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#6B46C1] font-bold">
              <ShieldCheck className="w-3 h-3" /> Admin
            </span>
          )}
          {u.is_moderator && (
            <span
              data-testid={`admin-user-mod-badge-${u.user_id}`}
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#2F6E60] font-bold bg-[#E0F0EA] px-1.5 py-0.5 rounded"
              title="Moderator — can approve sign-ups and lock bookclub rooms"
            >
              <ShieldCheck className="w-3 h-3" /> Mod
            </span>
          )}
          {isTestUser(u) && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-[#5B5F4D] font-bold bg-[#F2EDDF] px-1.5 py-0.5 rounded"
              title="Heuristic match — looks like a test/QA account (example.com domain, test+ alias, etc.)"
              data-testid={`admin-user-testbadge-${u.user_id}`}
            >
              Test
            </span>
          )}
        </p>
        <p className="text-xs text-[#5B5F4D] dark:text-white/70 truncate">
          {u.book_count} book{u.book_count === 1 ? "" : "s"} · joined {fmtTime(u.created_at)}
          {" · "}
          <span
            data-testid={`admin-user-last-login-${u.user_id}`}
            className={u.last_login_at ? "" : "italic text-[#9B9B8C] dark:text-white/40"}
            title={u.last_login_at ? `Last login: ${new Date(u.last_login_at).toLocaleString()}` : "This user has never logged in."}
          >
            last on {fmtAgo(u.last_login_at)}
            {u.last_login_at && (
              <span className="text-[#5B5F4D]/70 dark:text-white/50"> ({fmtTime(u.last_login_at)})</span>
            )}
          </span>
        </p>
        {/* Attribution "came from" — shows the referrer domain + a
            click-through to the exact URL they arrived from, plus an
            info-i button that opens their full visit timeline.  See
            utils/attribution.py + AttributionCard in this file. */}
        {u.first_referrer_domain && (
          <p
            className="text-xs text-[#5B5F4D] dark:text-white/70 mt-0.5 flex items-center gap-1.5 flex-wrap"
            data-testid={`admin-user-attribution-${u.user_id}`}
          >
            <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7457] dark:text-white/50">Came from</span>
            {u.first_referrer_url ? (
              <a
                href={u.first_referrer_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6B46C1] hover:text-[#E07A5F] underline decoration-dotted underline-offset-2 inline-flex items-center gap-1 min-w-0 max-w-[24rem]"
                title={u.first_referrer_url}
                data-testid={`admin-user-referrer-link-${u.user_id}`}
              >
                {u.first_referrer_label ? (
                  <>
                    <span
                      className="truncate"
                      data-testid={`admin-user-referrer-label-${u.user_id}`}
                    >{u.first_referrer_label}</span>
                    <span className="text-[10px] text-[#9B9B8C] shrink-0 font-mono">· {u.first_referrer_domain}</span>
                  </>
                ) : (
                  <span className="font-mono truncate">{u.first_referrer_domain}</span>
                )}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ) : (
              <span className="font-mono text-[#6B46C1]">{u.first_referrer_domain}</span>
            )}
            {u.first_utm_campaign && (
              <span
                className="text-[10px] bg-[#EEE9FB] text-[#6B46C1] px-1.5 py-0.5 rounded"
                title={`utm_source: ${u.first_utm_source || "?"}`}
              >
                {u.first_utm_campaign}
              </span>
            )}
            <button
              type="button"
              onClick={() => openTimeline(u)}
              className="text-[10px] font-semibold text-[#7A7457] hover:text-[#6B46C1] underline decoration-dotted underline-offset-2"
              data-testid={`admin-user-timeline-btn-${u.user_id}`}
              title="See every visit this user has recorded"
            >
              full timeline
            </button>
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Mod toggle — distinct from the admin toggle on its right. */}
        <button
          type="button"
          onClick={() => toggleMod(u)}
          disabled={busyId === u.user_id}
          data-testid={`admin-user-mod-toggle-${u.user_id}`}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
            u.is_moderator
              ? "text-[#9B3531] hover:bg-[#FBE9E7]"
              : "text-[#2F6E60] hover:bg-[#E0F0EA]"
          }`}
          title={u.is_moderator ? "Remove the moderator flag" : "Make this user a moderator"}
        >
          {u.is_moderator ? "Unmod" : "Mod"}
        </button>
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
      </div>
    </li>
  );
}
