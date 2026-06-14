import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Plus, UserPlus, X as XIcon } from "lucide-react";
import { api } from "../../lib/api";

/**
 * Modal dialogs shared by the Bookclubs page: create-room, edit-room, and
 * the inline invite-friends list rendered inside the right-rail.
 */

export function CreateRoomForm({ onCreated, onClose }) {
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

export function EditRoomDialog({ room, onSaved, onClose }) {
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

export function InviteFriendsBlock({ roomId, currentMemberIds, onInvited }) {
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
