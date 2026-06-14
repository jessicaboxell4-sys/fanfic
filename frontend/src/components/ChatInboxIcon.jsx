import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { api } from "../lib/api";

// Navbar inbox icon — polls /api/chat/unread-count + /api/friends/pending-count
// every 15s. Shows a combined numeric badge (Phase 4b — one badge for all
// things-needing-attention). Tooltip breaks down which is which.
export default function ChatInboxIcon() {
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [a, b] = await Promise.all([
          api.get("/chat/unread-count").catch(() => ({ data: { unread: 0 } })),
          api.get("/friends/pending-count").catch(() => ({ data: { pending_in: 0 } })),
        ]);
        if (!cancelled) {
          setUnread(a?.data?.unread || 0);
          setPending(b?.data?.pending_in || 0);
        }
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = unread + pending;
  const title = total === 0
    ? "Messages"
    : `${unread} unread message${unread === 1 ? "" : "s"}${pending ? ` · ${pending} friend request${pending === 1 ? "" : "s"}` : ""}`;

  return (
    <Link
      to="/friends"
      data-testid="navbar-messages"
      className="relative p-2 hover:bg-[#F5F3EC] rounded-lg"
      title={title}
    >
      <MessageSquare className="w-4 h-4 text-[#6B705C]" />
      {total > 0 && (
        <span
          data-testid="navbar-messages-badge"
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-[#FDFBF7]"
        >
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}
