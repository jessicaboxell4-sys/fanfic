import React from "react";

/**
 * Shared helpers for the Bookclubs subpages.  Kept in a single file so the
 * tree stays flat and avoids deep imports.
 */

export function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

export function RoleBadge({ role }) {
  const map = {
    owner:     { label: "Owner",     bg: "#FDF3E1", color: "#B87A00" },
    moderator: { label: "Mod",       bg: "#EEF3EC", color: "#6B46C1" },
    member:    { label: "Member",    bg: "#FBFAF6", color: "#6B705C" },
  };
  const s = map[role] || map.member;
  return (
    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
