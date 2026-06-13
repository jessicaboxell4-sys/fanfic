import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Send, BookOpen, Palette, X as XIcon, Users as UsersIcon, MessageSquare, Loader2, ChevronLeft,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { usePalette } from "../context/PaletteContext";
import { useAuth } from "../context/AuthContext";
import { encodePaletteToken, decodePaletteToken } from "../lib/palettes";

const POLL_MS = 15000;

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function MemberPills({ members, currentUserId }) {
  const others = (members || []).filter((m) => m.user_id !== currentUserId);
  return (
    <div className="flex flex-wrap gap-1.5">
      {others.map((m) => (
        <span
          key={m.user_id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FBFAF6] border border-[#E5DDC5] text-[11px] text-[#2C2C2C]"
        >
          {m.name || m.email}
        </span>
      ))}
      {others.length === 0 && (
        <span className="text-[11px] text-[#6B705C] italic">just you (waiting for company)</span>
      )}
    </div>
  );
}

function MessageRow({ msg, isMine, currentUserId, onApplyPalette }) {
  return (
    <div
      data-testid={`chat-message-${msg.message_id}`}
      className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
    >
      {!isMine && (
        <p className="text-[10px] uppercase tracking-wider text-[#6B705C] font-semibold mb-0.5 px-2">
          {msg.sender_name}
        </p>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm ${
          isMine
            ? "bg-[var(--primary)] text-white rounded-br-sm"
            : "bg-white border border-[#E8E6E1] rounded-bl-sm"
        }`}
      >
        {msg.body && <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>}

        {msg.kind === "book" && msg.attachment?.book_id && (
          <Link
            to={`/library/book/${msg.attachment.book_id}`}
            data-testid={`chat-book-attachment-${msg.attachment.book_id}`}
            className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg ${
              isMine ? "bg-white/15 hover:bg-white/25" : "bg-[#FBFAF6] hover:bg-[#F4EFE5]"
            } transition-colors`}
          >
            <BookOpen className={`w-4 h-4 flex-shrink-0 ${isMine ? "text-white" : "text-[var(--primary)]"}`} />
            <div className="min-w-0">
              <p className={`text-xs font-semibold truncate ${isMine ? "text-white" : "text-[#2C2C2C]"}`}>
                {msg.attachment.book_title || "Open book"}
              </p>
              {msg.attachment.book_author && (
                <p className={`text-[10px] truncate ${isMine ? "text-white/80" : "text-[#6B705C]"}`}>
                  {msg.attachment.book_author}
                </p>
              )}
            </div>
          </Link>
        )}

        {msg.kind === "palette" && msg.attachment?.palette_token && (
          <div
            data-testid={`chat-palette-attachment-${msg.message_id}`}
            className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg ${
              isMine ? "bg-white/15" : "bg-[#FBFAF6]"
            }`}
          >
            <Palette className={`w-4 h-4 flex-shrink-0 ${isMine ? "text-white" : "text-[var(--primary)]"}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold truncate ${isMine ? "text-white" : "text-[#2C2C2C]"}`}>
                Palette: {msg.attachment.palette_name || "shared palette"}
              </p>
              <code className={`text-[9px] font-mono truncate block ${isMine ? "text-white/70" : "text-[#6B705C]"}`}>
                {msg.attachment.palette_token.slice(0, 36)}{msg.attachment.palette_token.length > 36 ? "…" : ""}
              </code>
            </div>
            <button
              type="button"
              onClick={() => onApplyPalette(msg.attachment.palette_token)}
              className={`text-[10px] font-semibold px-2 py-1 rounded ${
                isMine ? "bg-white text-[var(--primary)]" : "bg-[var(--primary)] text-white"
              } hover:opacity-90 flex-shrink-0`}
            >
              Apply
            </button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-[#6B705C] mt-0.5 px-2">{fmtTime(msg.created_at)}</p>
    </div>
  );
}

function AttachBookPopover({ open, onClose, onPick }) {
  const [q, setQ] = useState("");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/books", { params: { limit: 20, q: q || undefined } })
      .then(({ data }) => setBooks(data?.books || data || []))
      .catch(() => setBooks([]))
      .finally(() => setLoading(false));
  }, [open, q]);

  if (!open) return null;
  return (
    <div
      data-testid="chat-attach-book-popover"
      className="absolute bottom-full mb-2 left-0 w-80 rounded-xl border border-[#E8E6E1] bg-white shadow-lg z-30 overflow-hidden"
    >
      <div className="p-3 border-b border-[#E8E6E1] flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-[#6B705C]">Attach a book</p>
        <button type="button" onClick={onClose} className="text-[#6B705C] hover:text-[#2C2C2C]">
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 border-b border-[#E8E6E1]">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title…"
          data-testid="chat-attach-book-search"
          className="w-full text-xs px-3 py-1.5 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {loading && (
          <li className="px-3 py-2 text-xs text-[#6B705C]">Loading…</li>
        )}
        {!loading && books.length === 0 && (
          <li className="px-3 py-2 text-xs text-[#6B705C] italic">No books found</li>
        )}
        {books.map((b) => (
          <li key={b.book_id}>
            <button
              type="button"
              onClick={() => { onPick(b); onClose(); }}
              data-testid={`chat-attach-book-option-${b.book_id}`}
              className="w-full text-left px-3 py-2 hover:bg-[#FBFAF6] text-xs"
            >
              <p className="font-semibold text-[#2C2C2C] truncate">{b.title}</p>
              <p className="text-[10px] text-[#6B705C] truncate">{b.author || "Unknown author"}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Composer({ roomId, onSent }) {
  const { paletteId, customLight, palette } = usePalette();
  const [body, setBody] = useState("");
  const [pendingBook, setPendingBook] = useState(null);
  const [pendingPalette, setPendingPalette] = useState(null);
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [sending, setSending] = useState(false);

  const reset = () => {
    setBody("");
    setPendingBook(null);
    setPendingPalette(null);
  };

  const send = async () => {
    const hasText = body.trim().length > 0;
    if (!hasText && !pendingBook && !pendingPalette) {
      return;
    }
    let kind = "text";
    let attachment = null;
    if (pendingBook) {
      kind = "book";
      attachment = { book_id: pendingBook.book_id };
    } else if (pendingPalette) {
      kind = "palette";
      attachment = { palette_token: pendingPalette.token, palette_name: pendingPalette.name };
    }
    setSending(true);
    try {
      await api.post(`/chat/rooms/${roomId}/messages`, {
        body: hasText ? body : "",
        kind,
        attachment,
      });
      reset();
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send");
    } finally {
      setSending(false);
    }
  };

  const attachCurrentPalette = () => {
    const token = encodePaletteToken(paletteId, customLight);
    setPendingPalette({ token, name: palette.name });
    toast.success(`Palette ${palette.name} attached`);
  };

  return (
    <div className="border-t border-[#E8E6E1] bg-white p-3" data-testid="chat-composer">
      {/* Pending attachment chip */}
      {pendingBook && (
        <div
          data-testid="chat-composer-book-chip"
          className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] text-xs"
        >
          <BookOpen className="w-3.5 h-3.5 text-[var(--primary)]" />
          <span className="truncate max-w-[200px]">{pendingBook.title}</span>
          <button type="button" onClick={() => setPendingBook(null)} className="text-[#6B705C] hover:text-[#2C2C2C]">
            <XIcon className="w-3 h-3" />
          </button>
        </div>
      )}
      {pendingPalette && (
        <div
          data-testid="chat-composer-palette-chip"
          className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FBFAF6] border border-[#E5DDC5] text-xs"
        >
          <Palette className="w-3.5 h-3.5 text-[var(--primary)]" />
          <span>Palette: {pendingPalette.name}</span>
          <button type="button" onClick={() => setPendingPalette(null)} className="text-[#6B705C] hover:text-[#2C2C2C]">
            <XIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 relative">
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowBookPicker((v) => !v)}
            data-testid="chat-attach-book-btn"
            disabled={!!pendingBook || !!pendingPalette}
            className="p-2 rounded-lg hover:bg-[#FBFAF6] text-[#6B705C] disabled:opacity-40"
            title="Attach a book"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <AttachBookPopover
            open={showBookPicker}
            onClose={() => setShowBookPicker(false)}
            onPick={(b) => setPendingBook(b)}
          />
        </div>
        <button
          type="button"
          onClick={attachCurrentPalette}
          data-testid="chat-attach-palette-btn"
          disabled={!!pendingBook || !!pendingPalette}
          className="p-2 rounded-lg hover:bg-[#FBFAF6] text-[#6B705C] disabled:opacity-40 flex-shrink-0"
          title="Share your current palette"
        >
          <Palette className="w-5 h-5" />
        </button>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message… (Shift+Enter for new line)"
          data-testid="chat-composer-input"
          rows={1}
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30 resize-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending}
          data-testid="chat-send-btn"
          className="p-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-60 flex-shrink-0"
          title="Send"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const { setPaletteId, setCustomLight } = usePalette();
  const { roomId: paramRoomId } = useParams();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const scrollRef = useRef(null);

  const loadRooms = async () => {
    try {
      const { data } = await api.get("/chat/rooms");
      setRooms(data?.rooms || []);
    } catch { /* ignore */ }
    finally { setLoadingRooms(false); }
  };

  const loadMessages = async (rid) => {
    setLoadingMsgs(true);
    try {
      const { data } = await api.get(`/chat/rooms/${rid}/messages`, { params: { limit: 200 } });
      setMessages(data?.messages || []);
      await api.post(`/chat/rooms/${rid}/read`).catch(() => {});
    } catch (e) {
      if (e?.response?.status === 403) toast.error("You are no longer a member of this room");
      setMessages([]);
    } finally { setLoadingMsgs(false); }
  };

  useEffect(() => { loadRooms(); }, []);

  // Pick the room from the URL or fall back to the first one with unread.
  useEffect(() => {
    if (!rooms.length) return;
    const pick = paramRoomId
      ? rooms.find((r) => r.room_id === paramRoomId)
      : rooms[0];
    if (pick && pick.room_id !== activeRoom?.room_id) {
      setActiveRoom(pick);
      loadMessages(pick.room_id);
    }
  }, [rooms, paramRoomId]);

  // Poll messages every POLL_MS while a room is active.
  useEffect(() => {
    if (!activeRoom?.room_id) return;
    const id = setInterval(() => loadMessages(activeRoom.room_id), POLL_MS);
    return () => clearInterval(id);
  }, [activeRoom?.room_id]);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, activeRoom?.room_id]);

  const handleApplyPalette = (token) => {
    const res = decodePaletteToken(token);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (res.customLight) setCustomLight(res.customLight);
    setPaletteId(res.paletteId);
    toast.success("Palette applied");
  };

  const switchRoom = (room) => {
    setActiveRoom(room);
    navigate(`/messages/${room.room_id}`, { replace: true });
    loadMessages(room.room_id);
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-testid="messages-page">
        <Link
          to="/library"
          className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> back to library
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C] leading-tight">Messages</h1>
            <p className="text-sm text-[#6B705C]">
              Private chat with people sharing your rooms. Rooms are admin-curated for now.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 shelf-card overflow-hidden" style={{ minHeight: 480 }}>
          {/* Sidebar */}
          <aside className="border-r border-[#E8E6E1] bg-white md:max-h-[70vh] md:overflow-y-auto" data-testid="chat-room-list">
            <div className="p-3 border-b border-[#E8E6E1] flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#6B705C]">Your rooms</p>
              <Link
                to="/friends"
                data-testid="chat-new-dm-link"
                className="text-[10px] font-semibold text-[var(--primary)] hover:underline"
                title="Find someone to DM"
              >
                + DM
              </Link>
            </div>
            {loadingRooms ? (
              <p className="p-4 text-xs text-[#6B705C]">Loading…</p>
            ) : rooms.length === 0 ? (
              <div className="p-4">
                <p className="text-sm text-[#6B705C] italic mb-2">No rooms yet.</p>
                <p className="text-xs text-[#6B705C]">Ask an admin to add you to one, or create one yourself if you have admin access.</p>
              </div>
            ) : (
              <ul>
                {rooms.map((r) => {
                  const active = r.room_id === activeRoom?.room_id;
                  return (
                    <li key={r.room_id}>
                      <button
                        type="button"
                        onClick={() => switchRoom(r)}
                        data-testid={`chat-room-row-${r.room_id}`}
                        className={`w-full text-left px-4 py-3 border-b border-[#E8E6E1] hover:bg-[#FBFAF6] transition-colors ${
                          active ? "bg-[#FBFAF6]" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[#2C2C2C] truncate">{r.name}</p>
                          {r.unread > 0 && (
                            <span
                              data-testid={`chat-room-unread-${r.room_id}`}
                              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold"
                            >
                              {r.unread}
                            </span>
                          )}
                        </div>
                        <div className="mt-1">
                          <MemberPills members={r.members} currentUserId={user?.user_id} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Thread panel */}
          <section className="flex flex-col bg-white" style={{ minHeight: 480, maxHeight: "70vh" }}>
            {activeRoom ? (
              <>
                <header className="p-3 border-b border-[#E8E6E1] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveRoom(null)}
                    className="md:hidden p-1 text-[#6B705C] hover:text-[#2C2C2C]"
                    title="Back to room list"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <UsersIcon className="w-4 h-4 text-[#6B705C]" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#2C2C2C] truncate" data-testid="chat-active-room-name">
                      {activeRoom.name}
                    </p>
                    <p className="text-[10px] text-[#6B705C] truncate">
                      {(activeRoom.members || []).filter((m) => m.user_id !== user?.user_id).map((m) => m.name || m.email).join(", ") || "just you"}
                    </p>
                  </div>
                </header>

                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FBF7EE]"
                  data-testid="chat-message-list"
                >
                  {loadingMsgs && messages.length === 0 ? (
                    <p className="text-xs text-[#6B705C] text-center">Loading…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-xs text-[#6B705C] text-center italic mt-8">
                      No messages yet. Be the first to say hello.
                    </p>
                  ) : (
                    messages.map((m) => (
                      <MessageRow
                        key={m.message_id}
                        msg={m}
                        isMine={m.sender_user_id === user?.user_id}
                        currentUserId={user?.user_id}
                        onApplyPalette={handleApplyPalette}
                      />
                    ))
                  )}
                </div>

                <Composer roomId={activeRoom.room_id} onSent={() => loadMessages(activeRoom.room_id)} />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-[#6B705C] italic p-8 text-center">
                {rooms.length === 0
                  ? "You're not in any rooms yet."
                  : "Pick a room from the sidebar to start chatting."}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
