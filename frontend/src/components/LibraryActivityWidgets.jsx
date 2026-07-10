/**
 * Library activity widgets — surfaces the P2 batch-1 endpoints on the
 * Dashboard:
 *   • S4 "Since last login" counters
 *   • W1 Surprise-me random unread book button
 *   • W2 Books I haven't read filter chip
 *   • W3 Reading queue mini-widget
 *   • S1 Friends recently added carousel
 *
 * Designed to render as a compact strip above the main library so it's
 * unobtrusive. All data-test-ids are kebab-case and unique.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Shuffle, Bookmark, Bell, BookOpen, X as XIcon, Heart, Loader2, ChevronRight,
} from "lucide-react";
import { api } from "../lib/api";

function fmtAgo(iso) {
  if (!iso) return "never";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// S4 — Since last login
// ---------------------------------------------------------------------------
function SinceLastLogin() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/dashboard/since-last-login").then(({ data }) => setData(data)).catch(() => {});
  }, []);
  if (!data || !data.since) return null;
  const total = data.new_books + data.friend_requests + data.new_messages + data.unread_notifications;
  if (total === 0) return null;
  return (
    <div className="bg-[#EEF3EC] border border-[#6B46C1]/30 rounded-xl p-3 text-sm text-[#2C2C2C] flex flex-wrap items-center gap-3" data-testid="since-last-login">
      <Bell className="w-4 h-4 text-[#6B46C1]" />
      <span className="font-medium">Since you were last here ({fmtAgo(data.since)}):</span>
      {data.new_books > 0 && <span data-testid="since-new-books">📚 {data.new_books} new book{data.new_books === 1 ? "" : "s"}</span>}
      {data.friend_requests > 0 && <span data-testid="since-friend-requests">👋 {data.friend_requests} friend request{data.friend_requests === 1 ? "" : "s"}</span>}
      {data.new_messages > 0 && <span data-testid="since-messages">💬 {data.new_messages} new message{data.new_messages === 1 ? "" : "s"}</span>}
      {data.unread_notifications > 0 && <span data-testid="since-notifications">🔔 {data.unread_notifications} unread</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// W1 — Surprise-me
// ---------------------------------------------------------------------------
function SurpriseMeButton() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const click = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/library/random-unread");
      navigate(`/read/${data.book.book_id}`);
    } catch (e) {
      if (e?.response?.status === 404) {
        alert("All your books are read — nothing left to surprise you with! 📚");
      } else {
        alert(e?.response?.data?.detail || e.message);
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={click}
      disabled={loading}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D4] hover:bg-[#F7F4EE] text-sm text-[#2C2C2C] disabled:opacity-50"
      data-testid="surprise-me-btn"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4 text-[#6B46C1]" />}
      Surprise me
    </button>
  );
}

// ---------------------------------------------------------------------------
// W2 — Books I haven't read filter chip
// ---------------------------------------------------------------------------
function UnreadFilterChip() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/library/unread")}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D4] hover:bg-[#F7F4EE] text-sm text-[#2C2C2C]"
      data-testid="unread-filter-chip"
    >
      <BookOpen className="w-4 h-4 text-[#6B46C1]" />
      Books I haven&apos;t read
    </button>
  );
}

// ---------------------------------------------------------------------------
// W3 — Reading queue mini-widget
// ---------------------------------------------------------------------------
function ReadingQueueWidget() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const load = async () => {
    try {
      const { data } = await api.get("/library/queue");
      setQueue(data.queue || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (bid) => {
    try {
      const { data } = await api.post("/library/queue/remove", { book_id: bid });
      // refetch to get hydrated book metadata
      const r = await api.get("/library/queue");
      setQueue(r.data.queue || []);
    } catch (e) { /* silent */ }
  };

  if (loading) return null;
  if (queue.length === 0) {
    return (
      <div className="text-xs text-[#5B5F4D] italic" data-testid="queue-empty">
        Up next: nothing queued. Hit &ldquo;Add to queue&rdquo; on any book to start your stack.
      </div>
    );
  }
  return (
    <div className="bg-white border border-[#E8E2D4] rounded-xl p-3" data-testid="reading-queue-widget">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#2C2C2C] inline-flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-[#6B46C1]" /> Up next ({queue.length})
        </span>
        <button
          type="button"
          onClick={() => navigate("/library/queue")}
          data-testid="queue-manage-link"
          className="text-xs text-[#6B46C1] hover:text-[#553397] font-semibold uppercase tracking-wider"
        >
          Manage →
        </button>
      </div>
      <ul className="space-y-1">
        {queue.slice(0, 5).map((b) => (
          <li key={b.book_id} className="flex items-center justify-between text-sm group" data-testid={`queue-item-${b.book_id}`}>
            <button
              type="button"
              onClick={() => navigate(`/read/${b.book_id}`)}
              className="flex-1 text-left truncate text-[#2C2C2C] hover:text-[#6B46C1]"
            >
              {b.title} <span className="text-[#5B5F4D] text-xs">— {b.author || "Unknown"}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(b.book_id)}
              className="opacity-0 group-hover:opacity-100 text-[#5B5F4D] hover:text-red-600"
              title="Remove from queue"
              data-testid={`queue-remove-${b.book_id}`}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
      {queue.length > 5 && (
        <p className="text-xs text-[#5B5F4D] mt-2">+ {queue.length - 5} more</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// S1 — Friends recently added (pulled from notifications kind=friend_new_book)
// ---------------------------------------------------------------------------
function FriendsRecentCarousel() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get("/notifications?kind=friend_new_book&limit=20")
      .then(({ data }) => {
        // Fallback: server may not support the filter — filter client-side too.
        const all = data?.notifications || [];
        setItems(all.filter((n) => n.kind === "friend_new_book").slice(0, 8));
      })
      .catch(() => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="bg-white border border-[#E8E2D4] rounded-xl p-3" data-testid="friends-recent-carousel">
      <div className="flex items-center gap-2 mb-2">
        <Heart className="w-4 h-4 text-[#B85C7C]" />
        <span className="text-sm font-medium text-[#2C2C2C]">Friends recently added</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="friends-recent-list">
        {items.map((n, i) => (
          <a
            key={n.id || i}
            href={n.link || "/friends"}
            className="flex-shrink-0 w-56 p-2 rounded-lg border border-[#E8E2D4] hover:bg-[#F7F4EE] text-xs"
            data-testid={`friends-recent-card-${i}`}
          >
            <p className="font-medium text-[#2C2C2C] truncate">{n.title}</p>
            {n.body && <p className="text-[#5B5F4D] truncate mt-0.5">{n.body}</p>}
            <p className="text-[#9B9B8C] mt-1">{fmtAgo(n.created_at)} <ChevronRight className="w-3 h-3 inline" /></p>
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported bundle
// ---------------------------------------------------------------------------
export default function LibraryActivityWidgets() {
  return (
    <div className="space-y-3" data-testid="library-activity-widgets">
      <SinceLastLogin />
      <FriendsRecentCarousel />
      <ReadingQueueWidget />
      <div className="flex flex-wrap items-center gap-2">
        <SurpriseMeButton />
        <UnreadFilterChip />
      </div>
    </div>
  );
}
