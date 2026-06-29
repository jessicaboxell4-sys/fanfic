import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Check, Loader2, MessageSquare, Menu, Plus, Search, Users, X as XIcon,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { RoleBadge } from "./bookclubs/_shared";
import { CreateRoomForm } from "./bookclubs/RoomDialogs";
import ActiveRoomPanel from "./bookclubs/ActiveRoomPanel";

/**
 * Shell for the reading-rooms experience. Houses the left rail + invites,
 * forwards to <ActiveRoomPanel /> when a room is selected, and tracks per-
 * room "last seen" timestamps in localStorage for the unread-dot indicator.
 *
 * Sub-components live under /pages/bookclubs/ so this shell stays small.
 */
const ROOM_LASTSEEN_KEY = "shelfsort_bookclub_lastseen_v1";

function readLastSeen() {
  try {
    const raw = window.localStorage.getItem(ROOM_LASTSEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeLastSeen(map) {
  try { window.localStorage.setItem(ROOM_LASTSEEN_KEY, JSON.stringify(map)); }
  catch { /* ignore quota errors */ }
}

export default function BookclubsPage() {
  const navigate = useNavigate();
  const { roomId: routeRoomId } = useParams();

  const [rooms, setRooms] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyInvite, setBusyInvite] = useState(null);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Per-room "last seen" timestamps (ISO strings) for unread indicators.
  // localStorage-backed so it survives reloads but stays client-side.
  const [lastSeen, setLastSeen] = useState(() => readLastSeen());

  const activeRoomId = routeRoomId || null;

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const { data } = await api.get("/bookclubs");
      const r = data?.rooms || [];
      const i = data?.invites || [];
      setRooms(r);
      setInvites(i);
      // Baseline any rooms we've never seen so they don't all show as unread
      // on first load. New activity past this baseline will surface a dot.
      setLastSeen((prev) => {
        const next = { ...prev };
        let changed = false;
        r.forEach((room) => {
          if (!next[room.room_id] && room.updated_at) {
            next[room.room_id] = room.updated_at;
            changed = true;
          }
        });
        if (changed) writeLastSeen(next);
        return changed ? next : prev;
      });
      // Auto-select the first room when nothing's selected and there's something to show.
      if (!routeRoomId && r.length > 0) {
        navigate(`/bookclubs/${r[0].room_id}`, { replace: true });
      }
    } catch { toast.error("Couldn't load reading rooms"); }
    finally { setLoadingList(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // When the user opens a room, mark it as seen at its current updated_at so
  // any *future* activity (after their visit) re-surfaces the dot.
  useEffect(() => {
    if (!activeRoomId) return;
    const room = rooms.find((r) => r.room_id === activeRoomId);
    if (!room?.updated_at) return;
    setLastSeen((prev) => {
      if (prev[activeRoomId] === room.updated_at) return prev;
      const next = { ...prev, [activeRoomId]: room.updated_at };
      writeLastSeen(next);
      return next;
    });
  }, [activeRoomId, rooms]);

  const selectRoom = (rid) => {
    setDrawerOpen(false);
    navigate(`/bookclubs/${rid}`);
  };

  const onRoomGone = async () => {
    navigate("/bookclubs", { replace: true });
    await loadList();
  };

  const respondInvite = async (room, action) => {
    setBusyInvite(room.room_id);
    try {
      await api.post(`/bookclubs/${room.room_id}/${action}`);
      toast.success(action === "accept" ? `Joined "${room.name}"` : "Declined");
      await loadList();
      if (action === "accept") navigate(`/bookclubs/${room.room_id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't respond to invite");
    } finally { setBusyInvite(null); }
  };

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) =>
      (r.name || "").toLowerCase().includes(q) ||
      (r.book_title || "").toLowerCase().includes(q) ||
      (r.book_author || "").toLowerCase().includes(q),
    );
  }, [rooms, query]);

  const LeftRail = (
    <aside
      className="w-full lg:w-72 lg:flex-shrink-0 border-r border-[#E8E6E1] bg-[#FDFBF7] flex flex-col"
      data-testid="bookclubs-left-rail"
    >
      <div className="px-4 py-3 border-b border-[#E8E6E1]">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-serif text-lg text-[#2C2C2C] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#6B46C1]" /> Reading rooms
          </h1>
          <button
            data-testid="open-create-room-btn"
            onClick={() => setCreating(true)}
            className="p-1.5 hover:bg-[#F5F3EC] rounded"
            title="New room"
          >
            <Plus className="w-4 h-4 text-[#6B46C1]" />
          </button>
        </div>
        <div className="mt-2 relative">
          <Search className="w-3 h-3 text-[#5B5F4D] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            data-testid="room-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rooms…"
            className="w-full pl-7 pr-3 py-1.5 bg-white border border-[#E5DDC5] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {invites.length > 0 && (
          <div className="border-b border-[#E8E6E1] bg-[#FDF3E1]/40" data-testid="pending-invites">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#B87A00] px-4 pt-3 pb-1">Invites</p>
            <ul className="px-2 pb-2 space-y-1">
              {invites.map((inv) => (
                <li key={inv.room_id} data-testid={`invite-${inv.room_id}`} className="bg-white border border-[#E5C780] rounded-lg p-2">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">{inv.name}</p>
                  <p className="text-[11px] text-[#5B5F4D] truncate">{inv.book_title}</p>
                  <div className="flex gap-1 mt-2">
                    <button data-testid={`accept-invite-${inv.room_id}`} disabled={busyInvite === inv.room_id} onClick={() => respondInvite(inv, "accept")} className="btn-primary text-[11px] flex-1 flex items-center justify-center gap-1">
                      <Check className="w-3 h-3" /> Accept
                    </button>
                    <button data-testid={`decline-invite-${inv.room_id}`} disabled={busyInvite === inv.room_id} onClick={() => respondInvite(inv, "decline")} className="btn-secondary text-[11px] flex-1 flex items-center justify-center gap-1">
                      <XIcon className="w-3 h-3" /> Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loadingList ? (
          <div className="p-4 text-xs text-[#5B5F4D] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
        ) : filteredRooms.length === 0 ? (
          rooms.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#5B5F4D]">
              <Users className="w-8 h-8 text-[#E5DDC5] mx-auto mb-1" />
              No reading rooms yet. Hit <span className="text-[#6B46C1] font-semibold">+</span> to start one.
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-[#5B5F4D]">No rooms match &quot;{query}&quot;.</div>
          )
        ) : (
          <ul data-testid="rooms-list">
            {filteredRooms.map((r) => {
              const isActive = r.room_id === activeRoomId;
              const progress = r.book_total_chapters > 0
                ? Math.min(100, Math.round((r.my_current_chapter / r.book_total_chapters) * 100))
                : 0;
              const seen = lastSeen[r.room_id];
              const hasUnread = !isActive && !!r.updated_at && (!seen || r.updated_at > seen);
              return (
                <li key={r.room_id} data-testid={`room-list-item-${r.room_id}`}>
                  <button
                    data-testid={`select-room-${r.room_id}`}
                    onClick={() => selectRoom(r.room_id)}
                    className={`w-full text-left px-3 py-2.5 border-l-2 transition ${
                      isActive
                        ? "bg-white border-l-[#6B46C1]"
                        : "border-l-transparent hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <p className={`text-sm font-semibold truncate flex items-center gap-1.5 ${isActive ? "text-[#2C2C2C]" : "text-[#2C2C2C]"}`}>
                        {hasUnread && (
                          <span
                            data-testid={`room-unread-dot-${r.room_id}`}
                            title="New activity since your last visit"
                            className="w-2 h-2 rounded-full bg-[var(--primary)] flex-shrink-0"
                          />
                        )}
                        <span className="truncate">{r.name}</span>
                      </p>
                      <RoleBadge role={r.my_role} />
                    </div>
                    <p className="text-[11px] text-[#5B5F4D] truncate">{r.book_title}</p>
                    {r.book_total_chapters > 0 && (
                      <div className="mt-1.5">
                        <div className="h-1 bg-[#F5F3EC] rounded-full overflow-hidden">
                          <div className="h-full bg-[#6B46C1] rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[10px] text-[#5B5F4D] mt-1 flex items-center gap-2">
                          <span>ch. {r.my_current_chapter}/{r.book_total_chapters}</span>
                          <span>·</span>
                          <span><Users className="w-2.5 h-2.5 inline" /> {r.member_count}</span>
                        </p>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Navbar />
      <main
        className="flex-1 flex flex-col lg:flex-row min-h-0"
        data-testid="bookclubs-page"
      >
        {/* Mobile drawer toggle */}
        <div className="lg:hidden flex items-center justify-between px-4 py-2 bg-[#FDFBF7] border-b border-[#E8E6E1]">
          <button
            data-testid="mobile-room-drawer-toggle"
            onClick={() => setDrawerOpen((v) => !v)}
            className="text-xs text-[#6B46C1] font-semibold flex items-center gap-1"
          >
            <Menu className="w-3 h-3" />
            {drawerOpen ? "Close" : "Rooms"}
            {invites.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#FDF3E1] text-[#B87A00] text-[10px] font-bold">
                {invites.length} invite{invites.length === 1 ? "" : "s"}
              </span>
            )}
          </button>
          <button
            onClick={() => setCreating(true)}
            className="text-xs text-[#6B46C1] font-semibold flex items-center gap-1"
            data-testid="mobile-new-room-btn"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        </div>

        {/* Left rail: visible on lg+, drawer on mobile */}
        <div className={`${drawerOpen ? "block" : "hidden"} lg:block`}>
          {LeftRail}
        </div>

        {/* Main panel */}
        <section className="flex-1 flex min-h-0">
          {!activeRoomId ? (
            <div className="flex-1 flex items-center justify-center px-8 py-16 text-center text-[#5B5F4D]" data-testid="empty-room-pane">
              <div>
                {loadingList ? (
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                ) : rooms.length === 0 ? (
                  <>
                    <Users className="w-12 h-12 text-[#E5DDC5] mx-auto mb-3" />
                    <p className="font-serif text-xl text-[#2C2C2C] mb-1">Start your first reading room</p>
                    <p className="text-sm">Pick a book from your library and invite friends to read it together — chapter-by-chapter discussion, shared progress, optional schedule.</p>
                    <button onClick={() => setCreating(true)} className="btn-primary mt-4 inline-flex items-center gap-2" data-testid="empty-state-create-btn">
                      <Plus className="w-4 h-4" /> New reading room
                    </button>
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-10 h-10 text-[#E5DDC5] mx-auto mb-2" />
                    <p className="text-sm">Pick a room from the left to open the conversation.</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <ActiveRoomPanel
              key={activeRoomId}
              roomId={activeRoomId}
              onRoomChanged={loadList}
              onRoomGone={onRoomGone}
            />
          )}
        </section>
      </main>

      {creating && (
        <CreateRoomForm
          onClose={() => setCreating(false)}
          onCreated={async (r) => {
            setCreating(false);
            await loadList();
            navigate(`/bookclubs/${r.room_id}`);
          }}
        />
      )}
    </div>
  );
}
