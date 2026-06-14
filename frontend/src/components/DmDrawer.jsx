import React, { useEffect, useState, useRef, useCallback } from "react";
import { X as XIcon, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * Inline DM drawer — slides in from the right when a friend is opened
 * for chat from /friends. Polls every 15s for new messages while open.
 */
export default function DmDrawer({ roomId, friendName, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/chat/rooms/${roomId}/messages`, { params: { limit: 200 } });
      setMessages(data?.messages || []);
      api.post(`/chat/rooms/${roomId}/read`).catch(() => {});
    } catch {/* non-blocking */}
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async () => {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const { data } = await api.post(`/chat/rooms/${roomId}/messages`, { body: body.trim() });
      setMessages((prev) => [...prev, data]);
      setBody("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send");
    } finally { setPosting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="dm-drawer">
      <button className="flex-1 bg-black/30" onClick={onClose} aria-label="Close DM" />
      <div className="w-full max-w-md bg-[#FDFBF7] border-l border-[#E8E6E1] flex flex-col h-full shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E8E6E1] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B705C]">Direct message</p>
            <p className="font-serif text-lg text-[#2C2C2C] truncate" data-testid="dm-drawer-title">{friendName}</p>
          </div>
          <button onClick={onClose} data-testid="dm-drawer-close" className="p-1.5 hover:bg-[#F5F3EC] rounded">
            <XIcon className="w-4 h-4 text-[#6B705C]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" data-testid="dm-drawer-messages">
          {loading ? (
            <div className="text-sm text-[#6B705C] flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-[#6B705C] text-center py-12">No messages yet — say hi!</p>
          ) : (
            messages.map((m) => {
              const mine = m.user_id === user?.user_id;
              return (
                <div key={m.message_id} data-testid={`dm-msg-${m.message_id}`} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${mine ? "bg-[#6B46C1] text-white" : "bg-[#F5F3EC] text-[#2C2C2C]"}`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-[#E8E6E1] px-4 py-3 pb-5 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Type a message… (⌘/Ctrl + Enter to send)"
              data-testid="dm-drawer-input"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              className="flex-1 px-3 py-2 bg-[#FBFAF6] border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1] resize-none"
            />
            <button
              onClick={send}
              disabled={posting || !body.trim()}
              data-testid="dm-drawer-send"
              className="btn-primary flex items-center gap-1 text-sm"
            >
              {posting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
