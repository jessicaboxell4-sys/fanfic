import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Users, BookOpen } from "lucide-react";
import { api } from "../lib/api";

// Combined Messages / Friends / Reading-rooms dropdown.  Lives in the
// navbar in place of the standalone chat icon.  Polls unread + pending
// counts every 15s and shows one combined numeric badge so users notice
// new activity at a glance.
export default function MessagesDropdown() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const wrapRef = useRef(null);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const total = unread + pending;
  const title = total === 0
    ? "Messages, friends, and reading rooms"
    : `${unread} unread message${unread === 1 ? "" : "s"}${pending ? ` · ${pending} friend request${pending === 1 ? "" : "s"}` : ""}`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid="navbar-messages"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-expanded={open}
        className="relative p-2 hover:bg-[#F5F3EC] rounded-lg"
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
      </button>
      {open && (
        <div
          data-testid="navbar-messages-menu"
          className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl shadow-lg border border-[#E8E6E1] py-1.5 z-50"
        >
          <Link
            to="/friends"
            data-testid="messages-dropdown-messages"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC]"
          >
            <MessageSquare className="w-4 h-4 text-[#6B705C]" />
            <span className="flex-1">Messages</span>
            {unread > 0 && (
              <span className="text-[10px] font-semibold px-1.5 rounded-full bg-[var(--primary)] text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <Link
            to="/friends"
            data-testid="messages-dropdown-friends"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC]"
          >
            <Users className="w-4 h-4 text-[#6B705C]" />
            <span className="flex-1">Friends</span>
            {pending > 0 && (
              <span className="text-[10px] font-semibold px-1.5 rounded-full bg-[#E07A5F] text-white" title={`${pending} pending request${pending === 1 ? "" : "s"}`}>
                {pending}
              </span>
            )}
          </Link>
          <Link
            to="/bookclubs"
            data-testid="messages-dropdown-bookclubs"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#2C2C2C] hover:bg-[#F5F3EC]"
          >
            <BookOpen className="w-4 h-4 text-[#6B705C]" />
            <span className="flex-1">Reading rooms</span>
          </Link>
        </div>
      )}
    </div>
  );
}
