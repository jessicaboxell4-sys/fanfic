import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { api } from "../lib/api";

// Navbar inbox icon — polls /api/chat/unread-count every 15s. Shows a
// purple dot + numeric badge when there are unread messages. Hidden if
// the user isn't a member of any room yet (count returns 0 indefinitely
// in that case which is fine — the icon stays badge-less).
export default function ChatInboxIcon() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/chat/unread-count");
        if (!cancelled) setUnread(data?.unread || 0);
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <Link
      to="/messages"
      data-testid="navbar-messages"
      className="relative p-2 hover:bg-[#F5F3EC] rounded-lg"
      title={unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : "Messages"}
    >
      <MessageSquare className="w-4 h-4 text-[#6B705C]" />
      {unread > 0 && (
        <span
          data-testid="navbar-messages-badge"
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-[#FDFBF7]"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
