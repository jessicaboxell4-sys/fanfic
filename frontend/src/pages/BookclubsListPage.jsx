import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Plus, BookOpen, Loader2, Check, X as XIcon, Clock,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";

function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function RoleBadge({ role }) {
  const map = {
    owner:     { label: "Owner",     bg: "#FDF3E1", color: "#B87A00" },
    moderator: { label: "Moderator", bg: "#EEF3EC", color: "#6B46C1" },
    member:    { label: "Member",    bg: "#FBFAF6", color: "#6B705C" },
  };
  const s = map[role] || map.member;
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function CreateRoomForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingBooks(true);
    api.get("/books?limit=500")
      .then(({ data }) => setBooks(data?.books || []))
      .catch(() => toast.error("Couldn't load your books"))
      .finally(() => setLoadingBooks(false));
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Give your room a name");
    if (!bookId) return toast.error("Pick a book to read together");
    setSubmitting(true);
    try {
      const { data } = await api.post("/bookclubs", {
        name: name.trim(),
        book_id: bookId,
        description: description.trim(),
        schedule: schedule.trim(),
      });
      toast.success("Reading room created");
      setOpen(false); setName(""); setBookId(""); setDescription(""); setSchedule("");
      onCreated?.(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create room");
    } finally { setSubmitting(false); }
  };

  if (!open) {
    return (
      <button
        data-testid="open-create-room-btn"
        onClick={() => setOpen(true)}
        className="btn-primary flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> New reading room
      </button>
    );
  }

  return (
    <div data-testid="create-room-form" className="bg-[#FDFBF7] border border-[#E8E6E1] rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-[#2C2C2C]">Start a reading room</h3>
        <button onClick={() => setOpen(false)} className="p-1 hover:bg-[#F5F3EC] rounded">
          <XIcon className="w-4 h-4 text-[#6B705C]" />
        </button>
      </div>
      <div>
        <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Room name</label>
        <input
          data-testid="new-room-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. HP Re-read 2026"
          maxLength={80}
          className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Book to read together</label>
        {loadingBooks ? (
          <div className="mt-1 text-sm text-[#6B705C] flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading your library…
          </div>
        ) : (
          <select
            data-testid="new-room-book"
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
          >
            <option value="">— pick a book —</option>
            {books.map((b) => (
              <option key={b.book_id} value={b.book_id}>
                {b.title}{b.author ? ` — ${b.author}` : ""}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-[11px] text-[#6B705C]">
          The book becomes the room&apos;s canonical reference. Friends don&apos;t need to own a copy themselves.
        </p>
      </div>
      <div>
        <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Schedule (optional)</label>
        <input
          data-testid="new-room-schedule"
          type="text"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="e.g. 2 chapters / week"
          maxLength={200}
          className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-[#6B705C] uppercase tracking-wider">Description (optional)</label>
        <textarea
          data-testid="new-room-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What's the vibe? Spoiler-free? Discussion focused?"
          className="mt-1 w-full px-3 py-2 bg-white border border-[#E5DDC5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1]"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => setOpen(false)} className="btn-secondary text-sm">Cancel</button>
        <button
          data-testid="submit-create-room"
          onClick={submit}
          disabled={submitting}
          className="btn-primary text-sm flex items-center gap-2"
        >
          {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Create room
        </button>
      </div>
    </div>
  );
}

export default function BookclubsListPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/bookclubs");
      setRooms(data?.rooms || []);
      setInvites(data?.invites || []);
    } catch { toast.error("Couldn't load reading rooms"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const respondInvite = async (room, action) => {
    setBusyId(room.room_id);
    try {
      await api.post(`/bookclubs/${room.room_id}/${action}`);
      toast.success(action === "accept" ? `Joined "${room.name}"` : "Declined");
      if (action === "accept") {
        navigate(`/bookclubs/${room.room_id}`);
      } else {
        await load();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't respond to invite");
    } finally { setBusyId(null); }
  };

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 space-y-6" data-testid="bookclubs-list-page">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link to="/library" className="text-xs text-[#6B705C] hover:text-[#2C2C2C] flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to library
            </Link>
            <h1 className="font-serif text-4xl text-[#2C2C2C] flex items-center gap-3 mt-1">
              <Users className="w-7 h-7 text-[#6B46C1]" /> Reading rooms
            </h1>
            <p className="text-sm text-[#6B705C] mt-1">
              Private spaces to read a book with friends — chapter-by-chapter discussion threads, shared progress, optional schedule.
            </p>
          </div>
          <CreateRoomForm onCreated={(r) => navigate(`/bookclubs/${r.room_id}`)} />
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <section data-testid="pending-invites" className="bg-[#FDF3E1] border border-[#E5C780] rounded-2xl p-5 space-y-3">
            <h2 className="font-serif text-xl text-[#2C2C2C]">Pending invites</h2>
            <ul className="space-y-2">
              {invites.map((inv) => (
                <li
                  key={inv.room_id}
                  data-testid={`invite-${inv.room_id}`}
                  className="bg-white border border-[#E5DDC5] rounded-xl p-4 flex flex-wrap items-center gap-3"
                >
                  <BookOpen className="w-5 h-5 text-[#6B46C1] flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#2C2C2C] truncate">{inv.name}</p>
                    <p className="text-xs text-[#6B705C] truncate">{inv.book_title}{inv.book_author ? ` · ${inv.book_author}` : ""}</p>
                    <p className="text-[11px] text-[#6B705C] mt-0.5">Invited {fmtRelative(inv.invited_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      data-testid={`accept-invite-${inv.room_id}`}
                      disabled={busyId === inv.room_id}
                      onClick={() => respondInvite(inv, "accept")}
                      className="btn-primary text-xs flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Accept
                    </button>
                    <button
                      data-testid={`decline-invite-${inv.room_id}`}
                      disabled={busyId === inv.room_id}
                      onClick={() => respondInvite(inv, "decline")}
                      className="btn-secondary text-xs flex items-center gap-1"
                    >
                      <XIcon className="w-3 h-3" /> Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Active rooms */}
        <section>
          <h2 className="font-serif text-xl text-[#2C2C2C] mb-3">Your rooms</h2>
          {loading ? (
            <div className="text-sm text-[#6B705C] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : rooms.length === 0 ? (
            <div className="bg-[#FBFAF6] border border-dashed border-[#E5DDC5] rounded-2xl p-10 text-center">
              <Users className="w-10 h-10 text-[#E5DDC5] mx-auto mb-2" />
              <p className="text-sm text-[#6B705C]">No reading rooms yet. Start one to read a book with friends.</p>
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="rooms-grid">
              {rooms.map((r) => {
                const progress = r.book_total_chapters > 0
                  ? Math.min(100, Math.round((r.my_current_chapter / r.book_total_chapters) * 100))
                  : 0;
                return (
                  <li
                    key={r.room_id}
                    data-testid={`room-card-${r.room_id}`}
                  >
                    <Link
                      to={`/bookclubs/${r.room_id}`}
                      className="block bg-white border border-[#E8E6E1] rounded-2xl p-5 hover:shadow-md hover:border-[#6B46C1] transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-serif text-lg text-[#2C2C2C] truncate flex-1">{r.name}</h3>
                        <RoleBadge role={r.my_role} />
                      </div>
                      <p className="text-xs text-[#6B705C] truncate mb-1">{r.book_title}{r.book_author ? ` · ${r.book_author}` : ""}</p>
                      {r.schedule && (
                        <p className="text-[11px] text-[#6B705C] flex items-center gap-1 mb-2">
                          <Clock className="w-3 h-3" /> {r.schedule}
                        </p>
                      )}
                      {r.book_total_chapters > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 bg-[#F5F3EC] rounded-full overflow-hidden">
                            <div className="h-full bg-[#6B46C1] rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <p className="text-[10px] text-[#6B705C] mt-1">
                            Your progress: ch. {r.my_current_chapter} / {r.book_total_chapters}
                          </p>
                        </div>
                      )}
                      <p className="text-[11px] text-[#6B705C] mt-2 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {r.member_count} member{r.member_count === 1 ? "" : "s"}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
