import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Users, Plus, BookOpen, Loader2, Send, Settings, UserPlus, Trash2, LogOut,
  ShieldCheck, ShieldOff, Crown, MessageSquare, X as XIcon, Check, Clock,
  Search, ChevronDown, ChevronUp, Menu,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/* ----------------------------- utils ----------------------------- */
function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

function RoleBadge({ role }) {
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

/* ---------------------- shared sub-components ---------------------- */
function CreateRoomForm({ onCreated, onClose }) {
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get("/books?limit=500")
      .then(({ data }) => setBooks(data?.books || []))
      .catch(() => toast.error("Couldn't load your books"))
      .finally(() => setLoadingBooks(false));
  }, []);

  const submit = async () => {
    if (!name.trim()) return toast.error("Give your room a name");
    if (!bookId) return toast.error("Pick a book to read together");
    setSubmitting(true);
    try {
      const { data } = await api.post("/bookclubs", {
        name: name.trim(), book_id: bookId,
        description: description.trim(), schedule: schedule.trim(),
      });
      toast.success("Reading room created");
      onCreated?.(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create room");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" data-testid="create-room-dialog">
      <div className="bg-[#FDFBF7] rounded-2xl max-w-md w-full p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl text-[#2C2C2C]">Start a reading room</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#F5F3EC] rounded"><XIcon className="w-4 h-4 text-[#6B705C]" /></button>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Room name</label>
          <input data-testid="new-room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HP Re-read 2026" maxLength={80} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Book</label>
          {loadingBooks ? (
            <div className="mt-1 text-sm text-[#6B705C] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading your library…</div>
          ) : (
            <select data-testid="new-room-book" value={bookId} onChange={(e) => setBookId(e.target.value)} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]">
              <option value="">— pick a book —</option>
              {books.map((b) => (<option key={b.book_id} value={b.book_id}>{b.title}{b.author ? ` — ${b.author}` : ""}</option>))}
            </select>
          )}
          <p className="mt-1 text-[11px] text-[#6B705C]">Friends don&apos;t need to own a copy themselves.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Schedule (optional)</label>
          <input data-testid="new-room-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. 2 chapters / week" maxLength={200} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Description (optional)</label>
          <textarea data-testid="new-room-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button data-testid="submit-create-room" onClick={submit} disabled={submitting} className="btn-primary text-sm flex items-center gap-2">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create room
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRoomDialog({ room, onSaved, onClose }) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description || "");
  const [schedule, setSchedule] = useState(room.schedule || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/bookclubs/${room.room_id}`, {
        name: name.trim(), description: description.trim(), schedule: schedule.trim(),
      });
      toast.success("Room updated");
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" data-testid="edit-room-dialog">
      <div className="bg-[#FDFBF7] rounded-2xl max-w-md w-full p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl">Edit room</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#F5F3EC] rounded"><XIcon className="w-4 h-4" /></button>
        </div>
        <div><label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Name</label>
          <input data-testid="edit-room-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div><label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Schedule</label>
          <input data-testid="edit-room-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} maxLength={200} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div><label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Description</label>
          <textarea data-testid="edit-room-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button data-testid="save-edit-room" onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function InviteFriendsBlock({ roomId, currentMemberIds, onInvited }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api.get("/friends")
      .then(({ data }) => setFriends(data?.accepted || []))
      .catch(() => toast.error("Couldn't load friends"))
      .finally(() => setLoading(false));
  }, []);

  const inviteable = useMemo(
    () => friends.filter((f) => !currentMemberIds.has(f.other_user_id)),
    [friends, currentMemberIds],
  );

  const send = async (f) => {
    setBusyId(f.other_user_id);
    try {
      await api.post(`/bookclubs/${roomId}/invite`, { user_id: f.other_user_id });
      toast.success(`Invited ${f.name || f.email}`);
      onInvited?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't invite");
    } finally { setBusyId(null); }
  };

  if (loading) return <div className="text-xs text-[#6B705C] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading friends…</div>;
  if (friends.length === 0) return <p className="text-xs text-[#6B705C]">Add friends first from <Link to="/friends" className="text-[#6B46C1] underline">Friends</Link>.</p>;
  if (inviteable.length === 0) return <p className="text-xs text-[#6B705C]">All your friends are already in this room.</p>;

  return (
    <ul className="space-y-1" data-testid="invite-friends-list">
      {inviteable.map((f) => (
        <li key={f.other_user_id} data-testid={`invite-friend-${f.other_user_id}`} className="flex items-center gap-2 bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2">
          {f.picture ? <img src={f.picture} alt={f.name} className="w-6 h-6 rounded-full" /> : <div className="w-6 h-6 rounded-full bg-[#E5DDC5]" />}
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#2C2C2C] truncate">{f.name || f.email}</p></div>
          <button data-testid={`invite-btn-${f.other_user_id}`} disabled={busyId === f.other_user_id} onClick={() => send(f)} className="btn-secondary text-xs flex items-center gap-1">
            {busyId === f.other_user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} Invite
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------ Active-room panel ------------------------ */
function ActiveRoomPanel({ roomId, onRoomChanged, onRoomGone }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const initialChapter = parseInt(params.get("chapter") || "0", 10) || 0;

  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeChapter, setActiveChapter] = useState(initialChapter);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const messagesEndRef = useRef(null);

  const isOwner = room?.my_role === "owner";
  const isStaff = isOwner || room?.my_role === "moderator";

  const loadRoom = useCallback(async () => {
    try {
      const { data } = await api.get(`/bookclubs/${roomId}`);
      setRoom(data);
      return data;
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || "Couldn't load room");
      if (e?.response?.status === 403 || e?.response?.status === 404) onRoomGone?.();
      return null;
    }
  }, [roomId, onRoomGone]);

  const loadMessages = useCallback(async () => {
    try {
      const { data } = await api.get(`/bookclubs/${roomId}/messages`, {
        params: { chapter: activeChapter },
      });
      setMessages(data?.messages || []);
    } catch { /* ignore */ }
  }, [roomId, activeChapter]);

  // Re-fetch when room or chapter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setActiveChapter(parseInt(params.get("chapter") || "0", 10) || 0);
      await loadRoom();
      if (!cancelled) await loadMessages();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Sync URL when active chapter changes (replace, no nav).
  useEffect(() => {
    const cur = parseInt(params.get("chapter") || "0", 10) || 0;
    if (cur !== activeChapter) {
      const p = new URLSearchParams(params);
      if (activeChapter > 0) p.set("chapter", String(activeChapter));
      else p.delete("chapter");
      setParams(p, { replace: true });
    }
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter]);

  // Light polling every 20s.
  useEffect(() => {
    const id = setInterval(() => loadMessages(), 20000);
    return () => clearInterval(id);
  }, [loadMessages]);

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const post = async () => {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const { data } = await api.post(`/bookclubs/${roomId}/messages`, {
        body: body.trim(), chapter_index: activeChapter,
      });
      setMessages((prev) => [...prev, data]);
      setBody("");
      onRoomChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't post");
    } finally { setPosting(false); }
  };

  const updateProgress = async (newChapter) => {
    setSavingProgress(true);
    try {
      const { data } = await api.post(`/bookclubs/${roomId}/progress`, { current_chapter: newChapter });
      setRoom((r) => r ? ({ ...r, my_current_chapter: data.current_chapter }) : r);
      await loadRoom();
      onRoomChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update progress");
    } finally { setSavingProgress(false); }
  };

  const removeMember = async (memberId, name) => {
    if (!window.confirm(`Remove ${name} from this room?`)) return;
    try { await api.post(`/bookclubs/${roomId}/members/${memberId}/remove`); toast.success("Member removed"); await loadRoom(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't remove"); }
  };
  const setRole = async (memberId, role) => {
    try { await api.post(`/bookclubs/${roomId}/members/${memberId}/role`, { role }); toast.success("Role updated"); await loadRoom(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update role"); }
  };
  const transferTo = async (memberId, name) => {
    if (!window.confirm(`Transfer ownership to ${name}? You'll become a moderator.`)) return;
    try { await api.post(`/bookclubs/${roomId}/transfer`, { new_owner_user_id: memberId }); toast.success("Ownership transferred"); await loadRoom(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't transfer"); }
  };
  const leaveRoom = async () => {
    if (!window.confirm("Leave this reading room?")) return;
    try {
      const { data } = await api.post(`/bookclubs/${roomId}/leave`);
      toast.success(data.room_deleted ? "Room deleted (you were the only member)" : "Left room");
      onRoomGone?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't leave"); }
  };
  const deleteRoom = async () => {
    if (!window.confirm("Delete this room permanently? All members, messages and progress will be lost.")) return;
    try { await api.delete(`/bookclubs/${roomId}`); toast.success("Room deleted"); onRoomGone?.(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete"); }
  };

  if (loading || !room) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[#6B705C]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading room…
      </div>
    );
  }

  const total = room.book_total_chapters || 0;
  const activeMembers = (room.members || []).filter((m) => m.status === "active");
  const invitedMembers = (room.members || []).filter((m) => m.status === "invited");
  const memberIdsSet = new Set((room.members || []).map((m) => m.user_id));
  const chapters = [0, ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="active-room-panel">
      {/* Header */}
      <div className="bg-[#FDFBF7] border-b border-[#E8E6E1] px-4 md:px-6 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 data-testid="room-title" className="font-serif text-xl text-[#2C2C2C] truncate">{room.name}</h2>
          <p className="text-xs text-[#6B705C] mt-0.5 flex items-center gap-1 truncate">
            <BookOpen className="w-3 h-3 flex-shrink-0" />
            <Link to={`/book/${room.book_id}`} className="hover:underline truncate">{room.book_title}</Link>
            {room.book_author && <span className="truncate">· {room.book_author}</span>}
            {room.schedule && <span className="text-[#6B705C]"> · <Clock className="w-3 h-3 inline" /> {room.schedule}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 flex-shrink-0">
          {isStaff && (<button data-testid="edit-room-btn" onClick={() => setEditing(true)} className="p-1.5 hover:bg-[#F5F3EC] rounded" title="Edit"><Settings className="w-4 h-4 text-[#6B705C]" /></button>)}
          {!isOwner && (<button data-testid="leave-room-btn" onClick={leaveRoom} className="p-1.5 hover:bg-[#F5F3EC] rounded" title="Leave"><LogOut className="w-4 h-4 text-[#6B705C]" /></button>)}
          {isOwner && (<button data-testid="delete-room-btn" onClick={deleteRoom} className="p-1.5 hover:bg-[#FBE9E5] rounded" title="Delete"><Trash2 className="w-4 h-4 text-[#B43F26]" /></button>)}
          <button data-testid="toggle-right-rail" onClick={() => setRightOpen((v) => !v)} className="p-1.5 hover:bg-[#F5F3EC] rounded" title="Members / progress">
            <Users className="w-4 h-4 text-[#6B705C]" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Conversation column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chapter tabs */}
          <div className="bg-white border-b border-[#E8E6E1] px-3 py-2 flex flex-wrap gap-1.5 overflow-x-auto" data-testid="chapter-tabs">
            {chapters.map((c) => (
              <button key={c} data-testid={`chapter-tab-${c}`} onClick={() => setActiveChapter(c)}
                className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap transition ${
                  activeChapter === c ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#6B705C] border-[#E5DDC5] hover:border-[#6B46C1]"
                }`}>
                {c === 0 ? "Lobby" : `Ch. ${c}`}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3" data-testid="messages-list">
            {messages.length === 0 ? (
              <div className="text-center py-12 text-[#6B705C] text-sm">
                <MessageSquare className="w-8 h-8 mx-auto text-[#E5DDC5] mb-2" />
                <p>No messages in {activeChapter === 0 ? "the lobby" : `chapter ${activeChapter}`} yet.</p>
                <p className="text-xs mt-1">Be the first to start the conversation.</p>
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.user_id === user?.user_id;
                return (
                  <div key={m.message_id} data-testid={`message-${m.message_id}`} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${mine ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#2C2C2C]"}`}>
                      <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${mine ? "text-white/80" : "text-[#6B705C]"}`}>{m.user_name} · {fmtRelative(m.created_at)}</p>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-[#E8E6E1] px-4 md:px-6 py-3 bg-[#FDFBF7]">
            <div className="flex items-end gap-2">
              <textarea data-testid="message-input" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000}
                placeholder={activeChapter === 0 ? "Say hi or set the vibe…" : `Discuss chapter ${activeChapter}…`}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
                className="flex-1 px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1] resize-none" />
              <button data-testid="send-message-btn" onClick={post} disabled={posting || !body.trim()} className="btn-primary flex items-center gap-1 text-sm">
                {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
              </button>
            </div>
            <p className="text-[10px] text-[#6B705C] mt-1">⌘/Ctrl + Enter to send</p>
          </div>
        </div>

        {/* Right rail: members + progress + invite */}
        {rightOpen && (
          <aside className="hidden lg:block w-72 border-l border-[#E8E6E1] bg-[#FBFAF6] overflow-y-auto p-4 space-y-4" data-testid="right-rail">
            {total > 0 && (
              <div data-testid="my-progress-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-1">My progress</p>
                <p className="text-xl font-serif text-[#2C2C2C]">Ch. {room.my_current_chapter} <span className="text-sm text-[#6B705C]">of {total}</span></p>
                <input data-testid="progress-slider" type="range" min={0} max={total} value={room.my_current_chapter}
                  onChange={(e) => updateProgress(parseInt(e.target.value, 10))} disabled={savingProgress}
                  className="mt-2 w-full accent-[#6B46C1]" />
              </div>
            )}

            <div data-testid="members-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1">
                <Users className="w-3 h-3" /> Members · {activeMembers.length}
              </p>
              <ul className="space-y-1">
                {activeMembers.map((m) => {
                  const isMe = m.user_id === user?.user_id;
                  return (
                    <li key={m.user_id} data-testid={`member-${m.user_id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white">
                      {m.picture ? <img src={m.picture} alt={m.name} className="w-6 h-6 rounded-full flex-shrink-0" /> : <div className="w-6 h-6 rounded-full bg-[#E5DDC5] flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#2C2C2C] truncate flex items-center gap-1">
                          {m.name || m.email}
                          {m.role === "owner" && <Crown className="w-3 h-3 text-[#B87A00]" title="Owner" />}
                          {m.role === "moderator" && <ShieldCheck className="w-3 h-3 text-[#6B46C1]" title="Moderator" />}
                          {isMe && <span className="text-[10px] text-[#6B705C]">(you)</span>}
                        </p>
                        {total > 0 && (<p className="text-[10px] text-[#6B705C]">ch. {m.current_chapter} / {total}</p>)}
                      </div>
                      {isOwner && !isMe && m.role !== "owner" && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {m.role === "member" ? (
                            <button data-testid={`promote-${m.user_id}`} title="Promote" onClick={() => setRole(m.user_id, "moderator")} className="p-1 hover:bg-[#EEF3EC] rounded"><ShieldCheck className="w-3 h-3 text-[#6B46C1]" /></button>
                          ) : (
                            <button data-testid={`demote-${m.user_id}`} title="Demote" onClick={() => setRole(m.user_id, "member")} className="p-1 hover:bg-white rounded"><ShieldOff className="w-3 h-3 text-[#6B705C]" /></button>
                          )}
                          <button data-testid={`transfer-${m.user_id}`} title="Transfer ownership" onClick={() => transferTo(m.user_id, m.name || m.email)} className="p-1 hover:bg-[#FDF3E1] rounded"><Crown className="w-3 h-3 text-[#B87A00]" /></button>
                          <button data-testid={`remove-${m.user_id}`} title="Remove" onClick={() => removeMember(m.user_id, m.name || m.email)} className="p-1 hover:bg-[#FBE9E5] rounded"><XIcon className="w-3 h-3 text-[#B43F26]" /></button>
                        </div>
                      )}
                      {isStaff && !isOwner && !isMe && m.role !== "owner" && m.role !== "moderator" && (
                        <button data-testid={`remove-${m.user_id}`} title="Remove" onClick={() => removeMember(m.user_id, m.name || m.email)} className="p-1 hover:bg-[#FBE9E5] rounded"><XIcon className="w-3 h-3 text-[#B43F26]" /></button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {invitedMembers.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B705C] mt-3 mb-1">Pending invites</p>
                  <ul className="space-y-1">
                    {invitedMembers.map((m) => (
                      <li key={m.user_id} className="text-xs text-[#6B705C] flex items-center gap-1 px-2 py-1"><Check className="w-3 h-3" /> {m.name || m.email}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {isStaff && (
              <div data-testid="invite-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1">
                  <UserPlus className="w-3 h-3" /> Invite friends
                </p>
                <InviteFriendsBlock roomId={roomId} currentMemberIds={memberIdsSet} onInvited={loadRoom} />
              </div>
            )}
          </aside>
        )}
      </div>

      {editing && (
        <EditRoomDialog room={room} onClose={() => setEditing(false)} onSaved={(r) => setRoom((prev) => ({ ...prev, ...r }))} />
      )}
    </div>
  );
}

/* --------------------------- Page shell --------------------------- */
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
          <Search className="w-3 h-3 text-[#6B705C] absolute left-2.5 top-1/2 -translate-y-1/2" />
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
                  <p className="text-[11px] text-[#6B705C] truncate">{inv.book_title}</p>
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
          <div className="p-4 text-xs text-[#6B705C] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
        ) : filteredRooms.length === 0 ? (
          rooms.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#6B705C]">
              <Users className="w-8 h-8 text-[#E5DDC5] mx-auto mb-1" />
              No reading rooms yet. Hit <span className="text-[#6B46C1] font-semibold">+</span> to start one.
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-[#6B705C]">No rooms match &quot;{query}&quot;.</div>
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
                    <p className="text-[11px] text-[#6B705C] truncate">{r.book_title}</p>
                    {r.book_total_chapters > 0 && (
                      <div className="mt-1.5">
                        <div className="h-1 bg-[#F5F3EC] rounded-full overflow-hidden">
                          <div className="h-full bg-[#6B46C1] rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[10px] text-[#6B705C] mt-1 flex items-center gap-2">
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
            <div className="flex-1 flex items-center justify-center px-8 py-16 text-center text-[#6B705C]" data-testid="empty-room-pane">
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
