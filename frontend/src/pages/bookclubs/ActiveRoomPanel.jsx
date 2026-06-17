import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  BookOpen, Check, Clock, Crown, Eye, Loader2, LogOut, MessageSquare, Send,
  Settings, ShieldCheck, ShieldOff, Trash2, UserPlus, Users, X as XIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import DisplayName from "../../components/DisplayName";
import { fmtRelative } from "./_shared";
import { EditRoomDialog, InviteFriendsBlock } from "./RoomDialogs";

/**
 * Main conversation column for a single reading room: chapter tabs, message
 * thread, composer, and the collapsible right-rail (progress + members +
 * invite).
 */
export default function ActiveRoomPanel({ roomId, onRoomChanged, onRoomGone }) {
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
  // "Real" member count for the header — excludes platform-owner oversight,
  // which is auto-added to every room and shouldn't inflate the visible count.
  const realActiveCount = activeMembers.filter((m) => m.role !== "oversight").length;
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
                      <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${mine ? "text-white/80" : "text-[#6B705C]"}`}>
                        <DisplayName user={{ username: m.user_username, previous_username: m.user_previous_username, name: m.user_name }} />
                        {" · "}{fmtRelative(m.created_at)}
                      </p>
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
                <Users className="w-3 h-3" /> Members · {realActiveCount}
              </p>
              <ul className="space-y-1">
                {activeMembers.map((m) => {
                  const isMe = m.user_id === user?.user_id;
                  const isOversight = m.role === "oversight";
                  return (
                    <li key={m.user_id} data-testid={`member-${m.user_id}`} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white ${isOversight ? "bg-[#EDE7FB]/40" : ""}`}>
                      {m.picture ? <img src={m.picture} alt={m.name} className="w-6 h-6 rounded-full flex-shrink-0" /> : <div className="w-6 h-6 rounded-full bg-[#E5DDC5] flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#2C2C2C] truncate flex items-center gap-1">
                          <DisplayName user={m} />
                          {m.role === "owner" && <Crown className="w-3 h-3 text-[#B87A00]" title="Owner" />}
                          {m.role === "moderator" && <ShieldCheck className="w-3 h-3 text-[#6B46C1]" title="Moderator" />}
                          {isOversight && (
                            <span data-testid={`oversight-badge-${m.user_id}`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#6B46C1] bg-[#EDE7FB] px-1.5 py-0.5 rounded" title="Platform admin with read access for safety + moderation. Never receives notifications.">
                              <Eye className="w-3 h-3" /> Admin (oversight)
                            </span>
                          )}
                          {isMe && <span className="text-[10px] text-[#6B705C]">(you)</span>}
                        </p>
                        {total > 0 && !isOversight && (<p className="text-[10px] text-[#6B705C]">ch. {m.current_chapter} / {total}</p>)}
                      </div>
                      {isOwner && !isMe && m.role !== "owner" && !isOversight && (
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
                      {isStaff && !isOwner && !isMe && m.role !== "owner" && m.role !== "moderator" && !isOversight && (
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
