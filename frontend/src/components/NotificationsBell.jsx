import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "../lib/api";

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function NotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const loadCount = async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data?.unread || 0);
    } catch { /* ignore */ }
  };

  const loadList = async () => {
    try {
      const { data } = await api.get("/notifications", { params: { limit: 20 } });
      setItems(data?.notifications || []);
    } catch { setItems([]); }
  };

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    loadList();
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  };

  const handleClick = async (n) => {
    try {
      await api.post(`/notifications/${n.notification_id}/read`);
      setItems((prev) => prev.map((x) => x.notification_id === n.notification_id ? { ...x, read: true } : x));
      setUnread((c) => Math.max(0, c - (n.read ? 0 : 1)));
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="navbar-notifications"
        className="relative p-2 hover:bg-[#F5F3EC] rounded-lg"
        title={unread > 0 ? `${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="w-4 h-4 text-[#6B705C]" />
        {unread > 0 && (
          <span
            data-testid="navbar-notifications-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-[#FDFBF7]"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="notifications-popover"
          className="absolute right-0 mt-2 w-80 rounded-xl border border-[#E8E6E1] bg-white shadow-lg z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[#E8E6E1] flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B705C]">Notifications</p>
            {items.some((n) => !n.read) && (
              <button
                type="button"
                onClick={markAll}
                data-testid="notifications-mark-all-read"
                className="inline-flex items-center gap-1 text-[10px] text-[var(--primary)] font-semibold"
              >
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto" data-testid="notifications-list">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-xs text-[#6B705C] italic text-center">Nothing new.</li>
            ) : items.map((n) => {
              const content = (
                <div className={`flex flex-col gap-1 px-3 py-2 hover:bg-[#FBFAF6] border-b border-[#E8E6E1] last:border-b-0 ${n.read ? "" : "bg-[#FBF7EE]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#2C2C2C] truncate">{n.title}</p>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--primary)] flex-shrink-0" />}
                  </div>
                  {n.body && <p className="text-[11px] text-[#4A4A4A] line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-[#6B705C]">{relTime(n.created_at)}</p>
                </div>
              );
              return (
                <li key={n.notification_id} data-testid={`notification-${n.notification_id}`}>
                  {n.link ? (
                    <Link to={n.link} onClick={() => { handleClick(n); setOpen(false); }} className="block">
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => handleClick(n)} className="w-full text-left">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
