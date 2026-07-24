/**
 * CommunityCards — extracted 2026-08-19 from AdminConsole.jsx (Phase 6C-D).
 *
 * Cards: ChatRoomsCard, WatchingBookclubsCard
 */
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ChevronRight, Edit, Eye, Loader2, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { Card, fmtBytes, fmtAgo, fmtTime } from "./shared";

export function ChatRoomsCard() {
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState([]);
  // 2026-07-01 — Match every other admin card's convention: real rooms
  // by default, flip on to include test-fixture rooms.
  const [includeTests, setIncludeTests] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, u] = await Promise.all([
        api.get(`/admin/chat-rooms${includeTests ? "?include_tests=true" : ""}`),
        api.get("/admin/users"),
      ]);
      setRooms(r?.data?.rooms || []);
      setUsers(u?.data?.users || []);
    } catch { toast.error("Couldn't load chat rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeTests]);

  const toggleMember = (uid, current, setCurrent) => {
    setCurrent(current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid]);
  };

  const create = async () => {
    if (!name.trim() || memberIds.length === 0) {
      toast.error("Need a name and at least one member");
      return;
    }
    setCreating(true);
    try {
      await api.post("/admin/chat-rooms", { name: name.trim(), member_user_ids: memberIds });
      toast.success("Room created");
      setName(""); setMemberIds([]);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create room");
    } finally { setCreating(false); }
  };

  const startEdit = (r) => {
    setEditingId(r.room_id);
    setEditName(r.name);
    setEditMembers(r.member_user_ids || []);
  };

  const saveEdit = async (room_id) => {
    try {
      await api.put(`/admin/chat-rooms/${room_id}`, { name: editName.trim(), member_user_ids: editMembers });
      toast.success("Room updated");
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    }
  };

  const remove = async (room_id, name) => {
    if (!window.confirm(`Delete room "${name}"? This wipes every message inside it.`)) return;
    try {
      await api.delete(`/admin/chat-rooms/${room_id}`);
      toast.success("Room deleted");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    }
  };

  return (
    <Card
      icon={MessageSquare}
      title="Chat rooms"
      subtitle="Create direct-message rooms for sets of users. Members can talk freely inside, share books and palette tokens. Only admins can create / edit / delete rooms (Phase 1 — open user-to-user messaging is parked)."
      testid="admin-chat-rooms-card"
    >
      {/* Tests toggle — mirrors the other admin inbox cards so operators
          can flip between "real rooms only" and "everything including
          test fixtures" with a single click. */}
      <div className="flex items-center justify-end mb-3">
        <button
          type="button"
          onClick={() => setIncludeTests((v) => !v)}
          data-testid="admin-chat-rooms-toggle-include-tests"
          className="text-[10px] font-bold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full bg-[#F5F3EC] hover:bg-[#E8E2D4] text-[#5B5F4D]"
          title={includeTests ? "Currently showing test rooms too" : "Currently hiding test rooms"}
        >
          Tests: {includeTests ? "Shown" : "Hidden"}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-[#5B5F4D] italic">Loading…</p>
      ) : (
        <>
          {rooms.length === 0 ? (
            <p className="text-sm text-[#5B5F4D] italic mb-4" data-testid="admin-chat-rooms-empty">
              No rooms yet. Create one below.
            </p>
          ) : (
            <ul className="space-y-2 mb-5" data-testid="admin-chat-rooms-list">
              {rooms.map((r) => {
                const isEditing = editingId === r.room_id;
                return (
                  <li
                    key={r.room_id}
                    data-testid={`admin-chat-room-row-${r.room_id}`}
                    className="p-3 rounded-lg border border-[#E8E6E1] bg-white"
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          data-testid={`admin-chat-room-edit-name-${r.room_id}`}
                          className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5]"
                        />
                        <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-[#FBFAF6]">
                          {users.map((u) => (
                            <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editMembers.includes(u.user_id)}
                                onChange={() => toggleMember(u.user_id, editMembers, setEditMembers)}
                                data-testid={`admin-chat-room-edit-member-${r.room_id}-${u.user_id}`}
                              />
                              <span className="truncate">{u.email}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(r.room_id)}
                            data-testid={`admin-chat-room-save-${r.room_id}`}
                            className="text-xs px-3 py-1 rounded bg-[#6B46C1] text-white font-semibold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs px-3 py-1 rounded border border-[#E5DDC5]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#2C2C2C]">{r.name}</p>
                          <p className="text-[11px] text-[#5B5F4D]">
                            {r.member_user_ids.length} member{r.member_user_ids.length === 1 ? "" : "s"}
                            {r.last_message_at ? ` · last active ${fmtTime(r.last_message_at)}` : " · no messages yet"}
                          </p>
                          <p className="text-[10px] text-[#5B5F4D] truncate mt-0.5">
                            {r.member_user_ids.slice(0, 5).map((uid) => {
                              const u = users.find((x) => x.user_id === uid);
                              return u ? u.email : uid;
                            }).join(", ")}
                            {r.member_user_ids.length > 5 ? ` +${r.member_user_ids.length - 5}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            data-testid={`admin-chat-room-edit-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] hover:bg-[#FBFAF6]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(r.room_id, r.name)}
                            data-testid={`admin-chat-room-delete-btn-${r.room_id}`}
                            className="text-[11px] px-2 py-1 rounded text-[#B43F26] hover:bg-[#FBE8E0]"
                            title="Delete room"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Create form */}
          <div className="rounded-xl border border-[#E5DDC5] dark:border-zinc-700 bg-[#FBFAF6] dark:bg-zinc-800/60 p-4" data-testid="admin-chat-room-create-form">
            <p className="text-xs font-bold uppercase tracking-wider text-[#6B46C1] mb-2">Create a new room</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name (e.g. Beta readers)"
              data-testid="admin-chat-room-new-name"
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-[#E5DDC5] bg-white mb-2"
            />
            <p className="text-[10px] uppercase tracking-wider text-[#5B5F4D] mb-1">Members</p>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 border border-[#E5DDC5] rounded-lg bg-white mb-3">
              {users.map((u) => (
                <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(u.user_id)}
                    onChange={() => toggleMember(u.user_id, memberIds, setMemberIds)}
                    data-testid={`admin-chat-room-new-member-${u.user_id}`}
                  />
                  <span className="truncate">{u.email}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={create}
              disabled={creating || !name.trim() || memberIds.length === 0}
              data-testid="admin-chat-room-create-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#2D4632] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create room
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// Cron Health card — surfaces last run + status of every scheduled job so a
// silent cron crash can't go unnoticed (the reason this widget exists at all).
// ---------------------------------------------------------------------------


export function WatchingBookclubsCard() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/bookclubs/watching");
      setRooms(data?.rooms || []);
    } catch { toast.error("Couldn't load watched rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <Card
      icon={Eye}
      testid="admin-watching-bookclubs-card"
      title={`Rooms I'm watching${rooms.length > 0 ? ` (${rooms.length})` : ""}`}
      subtitle="Every bookclub the platform owner is auto-added to as Admin (oversight). Includes any club you own outright."
    >
      {loading ? (
        <p className="text-sm text-[#5B5F4D]">Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-[#5B5F4D]">
          You aren&apos;t in any bookclubs yet. As soon as someone creates one,
          it&apos;ll appear here with an <em>Admin (oversight)</em> badge in
          the room&apos;s member list.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="watched-rooms-list">
          {rooms.map((r) => (
            <li
              key={r.room_id}
              data-testid={`watched-room-${r.room_id}`}
              className="flex items-start gap-3 p-3 rounded-lg border border-[#E8E6E1] bg-[#FDFBF7] hover:bg-white"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">{r.name || "(untitled)"}</p>
                  {r.my_role === "owner" ? (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#B87A00] bg-[#FDF3E1] px-1.5 py-0.5 rounded">Owner</span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#6B46C1] bg-[#EDE7FB] px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Oversight
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5B5F4D] truncate mt-0.5">
                  <span className="italic">{r.book_title || "(no book)"}</span>
                  {r.book_author ? <span> · {r.book_author}</span> : null}
                </p>
                <p className="text-xs text-[#5B5F4D] mt-1">
                  Owner: <strong>{r.owner_name || r.owner_email || "—"}</strong>
                  <span className="mx-1">·</span>
                  {r.member_count} member{r.member_count === 1 ? "" : "s"}
                  <span className="mx-1">·</span>
                  {r.message_count} message{r.message_count === 1 ? "" : "s"}
                  {r.last_message_at && (
                    <>
                      <span className="mx-1">·</span>
                      last activity {fmtTime(r.last_message_at)}
                    </>
                  )}
                </p>
              </div>
              <Link
                to={`/bookclubs/${r.room_id}`}
                data-testid={`open-room-${r.room_id}`}
                className="text-xs font-semibold text-[#6B46C1] hover:underline whitespace-nowrap inline-flex items-center gap-1 self-center"
              >
                Open <ChevronRight className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chat Rooms card (admin-curated direct messaging)
// ---------------------------------------------------------------------------

