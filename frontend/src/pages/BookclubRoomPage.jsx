import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Loader2, Send, Settings, UserPlus, Trash2, LogOut,
  ShieldCheck, ShieldOff, Crown, BookOpen, MessageSquare, X as XIcon, Check,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

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

  if (loading) {
    return <div className="text-xs text-[#6B705C] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading friends…</div>;
  }
  if (friends.length === 0) {
    return (
      <p className="text-xs text-[#6B705C]">
        Add friends first from <Link to="/friends" className="text-[#6B46C1] underline">Friends</Link> — only friends can be invited to a reading room.
      </p>
    );
  }
  if (inviteable.length === 0) {
    return <p className="text-xs text-[#6B705C]">All your friends are already in this room.</p>;
  }

  return (
    <ul className="space-y-1" data-testid="invite-friends-list">
      {inviteable.map((f) => (
        <li
          key={f.other_user_id}
          data-testid={`invite-friend-${f.other_user_id}`}
          className="flex items-center gap-2 bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg px-3 py-2"
        >
          {f.picture ? (
            <img src={f.picture} alt={f.name} className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[#E5DDC5]" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#2C2C2C] truncate">{f.name || f.email}</p>
          </div>
          <button
            data-testid={`invite-btn-${f.other_user_id}`}
            disabled={busyId === f.other_user_id}
            onClick={() => send(f)}
            className="btn-secondary text-xs flex items-center gap-1"
          >
            {busyId === f.other_user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
            Invite
          </button>
        </li>
      ))}
    </ul>
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
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Name</label>
          <input data-testid="edit-room-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Schedule</label>
          <input data-testid="edit-room-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} maxLength={200} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[#6B705C]">Description</label>
          <textarea data-testid="edit-room-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button data-testid="save-edit-room" onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BookclubRoomPage() {
  const { roomId } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const initialChapter = parseInt(params.get("chapter") || "0", 10) || 0;

  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeChapter, setActiveChapter] = useState(initialChapter);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const messagesEndRef = useRef(null);

  const isOwner = room?.my_role === "owner";
  const isStaff = room?.my_role === "owner" || room?.my_role === "moderator";

  const loadRoom = useCallback(async () => {
    try {
      const { data } = await api.get(`/bookclubs/${roomId}`);
      setRoom(data);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || "Couldn't load room");
      if (e?.response?.status === 403 || e?.response?.status === 404) {
        navigate("/bookclubs");
      }
    }
  }, [roomId, navigate]);

  const loadMessages = useCallback(async () => {
    try {
      const { data } = await api.get(`/bookclubs/${roomId}/messages`, {
        params: { chapter: activeChapter },
      });
      setMessages(data?.messages || []);
    } catch { /* ignore */ }
  }, [roomId, activeChapter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadRoom();
      if (!cancelled) await loadMessages();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadRoom, loadMessages]);

  // Sync URL when chapter changes.
  useEffect(() => {
    const cur = parseInt(params.get("chapter") || "0", 10) || 0;
    if (cur !== activeChapter) {
      const p = new URLSearchParams(params);
      if (activeChapter > 0) p.set("chapter", String(activeChapter));
      else p.delete("chapter");
      setParams(p, { replace: true });
    }
    loadMessages();
    // eslint-disable-next-line
  }, [activeChapter]);

  // Light polling for new messages every 20s.
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
        body: body.trim(),
        chapter_index: activeChapter,
      });
      setMessages((prev) => [...prev, data]);
      setBody("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't post");
    } finally { setPosting(false); }
  };

  const updateProgress = async (newChapter) => {
    setSavingProgress(true);
    try {
      const { data } = await api.post(`/bookclubs/${roomId}/progress`, {
        current_chapter: newChapter,
      });
      setRoom((r) => r ? ({ ...r, my_current_chapter: data.current_chapter }) : r);
      toast.success(`Progress updated to ch. ${data.current_chapter}`);
      await loadRoom();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update progress");
    } finally { setSavingProgress(false); }
  };

  const removeMember = async (memberId, displayName) => {
    if (!window.confirm(`Remove ${displayName} from this room?`)) return;
    try {
      await api.post(`/bookclubs/${roomId}/members/${memberId}/remove`);
      toast.success("Member removed");
      await loadRoom();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't remove");
    }
  };

  const setRole = async (memberId, role) => {
    try {
      await api.post(`/bookclubs/${roomId}/members/${memberId}/role`, { role });
      toast.success(`Role updated`);
      await loadRoom();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update role");
    }
  };

  const transferTo = async (memberId, name) => {
    if (!window.confirm(`Transfer ownership to ${name}? You'll become a moderator.`)) return;
    try {
      await api.post(`/bookclubs/${roomId}/transfer`, { new_owner_user_id: memberId });
      toast.success("Ownership transferred");
      await loadRoom();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't transfer");
    }
  };

  const leaveRoom = async () => {
    if (!window.confirm("Leave this reading room?")) return;
    try {
      const { data } = await api.post(`/bookclubs/${roomId}/leave`);
      toast.success(data.room_deleted ? "Room deleted (you were the only member)" : "Left room");
      navigate("/bookclubs");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't leave");
    }
  };

  const deleteRoom = async () => {
    if (!window.confirm("Delete this room permanently? All members, messages and progress will be lost.")) return;
    try {
      await api.delete(`/bookclubs/${roomId}`);
      toast.success("Room deleted");
      navigate("/bookclubs");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    }
  };

  if (loading || !room) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-5xl mx-auto px-6 md:px-8 py-8">
          <div className="text-sm text-[#6B705C] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading room…</div>
        </main>
      </div>
    );
  }

  const total = room.book_total_chapters || 0;
  const activeMembers = (room.members || []).filter((m) => m.status === "active");
  const invitedMembers = (room.members || []).filter((m) => m.status === "invited");
  const memberIdsSet = new Set((room.members || []).map((m) => m.user_id));

  const chapters = [0, ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 md:px-8 py-8 space-y-6" data-testid="bookclub-room-page">
        {/* Header */}
        <div>
          <Link to="/bookclubs" className="text-xs text-[#6B705C] hover:text-[#2C2C2C] flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to reading rooms
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 data-testid="room-title" className="font-serif text-3xl text-[#2C2C2C]">{room.name}</h1>
              <p className="text-sm text-[#6B705C] mt-1 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                <Link to={`/book/${room.book_id}`} className="hover:underline">{room.book_title}</Link>
                {room.book_author && <span>· {room.book_author}</span>}
              </p>
              {room.schedule && (
                <p className="text-xs text-[#6B705C] mt-1">Schedule: <span className="text-[#2C2C2C]">{room.schedule}</span></p>
              )}
              {room.description && (
                <p className="text-sm text-[#2C2C2C] mt-2 max-w-xl whitespace-pre-wrap">{room.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {isStaff && (
                <button data-testid="edit-room-btn" onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-1">
                  <Settings className="w-3 h-3" /> Edit
                </button>
              )}
              {!isOwner && (
                <button data-testid="leave-room-btn" onClick={leaveRoom} className="btn-secondary text-sm flex items-center gap-1">
                  <LogOut className="w-3 h-3" /> Leave
                </button>
              )}
              {isOwner && (
                <button data-testid="delete-room-btn" onClick={deleteRoom} className="text-sm flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FBE9E5] text-[#B43F26] hover:bg-[#F5D4CB]">
                  <Trash2 className="w-3 h-3" /> Delete room
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Chapter selector + messages */}
          <section className="md:col-span-2 space-y-4">
            <div className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2 px-2">Discussion thread</p>
              <div className="flex flex-wrap gap-1.5 px-2" data-testid="chapter-tabs">
                {chapters.map((c) => (
                  <button
                    key={c}
                    data-testid={`chapter-tab-${c}`}
                    onClick={() => setActiveChapter(c)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      activeChapter === c
                        ? "bg-[#6B46C1] text-white border-[#6B46C1]"
                        : "bg-white text-[#6B705C] border-[#E5DDC5] hover:border-[#6B46C1]"
                    }`}
                  >
                    {c === 0 ? "Lobby" : `Ch. ${c}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-[#E8E6E1] rounded-2xl p-4 min-h-[400px] flex flex-col">
              <div className="flex-1 space-y-3 max-h-[480px] overflow-y-auto pr-1" data-testid="messages-list">
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
                      <div
                        key={m.message_id}
                        data-testid={`message-${m.message_id}`}
                        className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                      >
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                          mine ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#2C2C2C]"
                        }`}>
                          <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${mine ? "text-white/80" : "text-[#6B705C]"}`}>
                            {m.user_name} · {fmtRelative(m.created_at)}
                          </p>
                          <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="mt-3 flex items-end gap-2 border-t border-[#E8E6E1] pt-3">
                <textarea
                  data-testid="message-input"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder={
                    activeChapter === 0
                      ? "Say hi or set the vibe for the room…"
                      : `Discuss chapter ${activeChapter}…`
                  }
                  className="flex-1 px-3 py-2 bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
                  }}
                />
                <button
                  data-testid="send-message-btn"
                  onClick={post}
                  disabled={posting || !body.trim()}
                  className="btn-primary flex items-center gap-1 text-sm"
                >
                  {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send
                </button>
              </div>
              <p className="text-[10px] text-[#6B705C] mt-1">⌘/Ctrl + Enter to send</p>
            </div>
          </section>

          {/* Right column: progress, members, invites */}
          <aside className="space-y-4">
            {/* My progress */}
            {total > 0 && (
              <div className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-4" data-testid="my-progress-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2">My progress</p>
                <p className="text-2xl font-serif text-[#2C2C2C]">
                  Ch. {room.my_current_chapter} <span className="text-sm text-[#6B705C]">of {total}</span>
                </p>
                <input
                  data-testid="progress-slider"
                  type="range"
                  min={0}
                  max={total}
                  value={room.my_current_chapter}
                  onChange={(e) => updateProgress(parseInt(e.target.value, 10))}
                  disabled={savingProgress}
                  className="mt-2 w-full accent-[#6B46C1]"
                />
              </div>
            )}

            {/* Members */}
            <div className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-4" data-testid="members-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1">
                <Users className="w-3 h-3" /> Members · {activeMembers.length}
              </p>
              <ul className="space-y-1">
                {activeMembers.map((m) => {
                  const isMe = m.user_id === user?.user_id;
                  return (
                    <li
                      key={m.user_id}
                      data-testid={`member-${m.user_id}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F5F3EC]"
                    >
                      {m.picture ? (
                        <img src={m.picture} alt={m.name} className="w-6 h-6 rounded-full flex-shrink-0" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-[#E5DDC5] flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#2C2C2C] truncate flex items-center gap-1">
                          {m.name || m.email}
                          {m.role === "owner" && <Crown className="w-3 h-3 text-[#B87A00]" title="Owner" />}
                          {m.role === "moderator" && <ShieldCheck className="w-3 h-3 text-[#6B46C1]" title="Moderator" />}
                          {isMe && <span className="text-[10px] text-[#6B705C]">(you)</span>}
                        </p>
                        {total > 0 && (
                          <p className="text-[10px] text-[#6B705C]">ch. {m.current_chapter} / {total}</p>
                        )}
                      </div>
                      {isOwner && !isMe && m.role !== "owner" && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {m.role === "member" ? (
                            <button
                              data-testid={`promote-${m.user_id}`}
                              title="Promote to moderator"
                              onClick={() => setRole(m.user_id, "moderator")}
                              className="p-1 hover:bg-[#EEF3EC] rounded"
                            >
                              <ShieldCheck className="w-3 h-3 text-[#6B46C1]" />
                            </button>
                          ) : (
                            <button
                              data-testid={`demote-${m.user_id}`}
                              title="Demote to member"
                              onClick={() => setRole(m.user_id, "member")}
                              className="p-1 hover:bg-[#FBFAF6] rounded"
                            >
                              <ShieldOff className="w-3 h-3 text-[#6B705C]" />
                            </button>
                          )}
                          <button
                            data-testid={`transfer-${m.user_id}`}
                            title="Transfer ownership"
                            onClick={() => transferTo(m.user_id, m.name || m.email)}
                            className="p-1 hover:bg-[#FDF3E1] rounded"
                          >
                            <Crown className="w-3 h-3 text-[#B87A00]" />
                          </button>
                          <button
                            data-testid={`remove-${m.user_id}`}
                            title="Remove from room"
                            onClick={() => removeMember(m.user_id, m.name || m.email)}
                            className="p-1 hover:bg-[#FBE9E5] rounded"
                          >
                            <XIcon className="w-3 h-3 text-[#B43F26]" />
                          </button>
                        </div>
                      )}
                      {isStaff && !isOwner && !isMe && m.role !== "owner" && m.role !== "moderator" && (
                        <button
                          data-testid={`remove-${m.user_id}`}
                          title="Remove from room"
                          onClick={() => removeMember(m.user_id, m.name || m.email)}
                          className="p-1 hover:bg-[#FBE9E5] rounded"
                        >
                          <XIcon className="w-3 h-3 text-[#B43F26]" />
                        </button>
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
                      <li key={m.user_id} className="text-xs text-[#6B705C] flex items-center gap-1 px-2 py-1">
                        <Check className="w-3 h-3" /> {m.name || m.email}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Invite */}
            {isStaff && (
              <div className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-4" data-testid="invite-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1">
                  <UserPlus className="w-3 h-3" /> Invite friends
                </p>
                <InviteFriendsBlock
                  roomId={roomId}
                  currentMemberIds={memberIdsSet}
                  onInvited={loadRoom}
                />
              </div>
            )}
          </aside>
        </div>

        {editing && (
          <EditRoomDialog
            room={room}
            onClose={() => setEditing(false)}
            onSaved={(r) => setRoom((prev) => ({ ...prev, ...r }))}
          />
        )}
      </main>
    </div>
  );
}
