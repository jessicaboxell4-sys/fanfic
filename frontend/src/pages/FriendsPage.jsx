import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Search, UserPlus, Check, X as XIcon, MessageSquare,
  Ban, ShieldOff, Loader2, Mail, Send, Library,
} from "lucide-react";
import Navbar from "../components/Navbar";
import FriendLibraryModal from "../components/FriendLibraryModal";
import DmDrawer from "../components/DmDrawer";
import DisplayName from "../components/DisplayName";
import PrimaryCTAButton from "../components/PrimaryCTAButton";
import { api } from "../lib/api";
import { useEventStream } from "../hooks/useEventStream";
import { useAuth } from "../context/AuthContext";

function PersonRow({ row, children, testid }) {
  return (
    <li
      data-testid={testid}
      className="px-3 py-2 flex items-center gap-3 border-b border-[#E8E6E1] last:border-b-0"
    >
      <div className="w-8 h-8 rounded-full bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center flex-shrink-0">
        {row.picture ? (
          <img src={row.picture} alt={row.name} className="w-full h-full rounded-full object-cover" />
        ) : (
          <Mail className="w-3.5 h-3.5 text-[#5B5F4D]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <DisplayName user={row} className="text-sm font-semibold text-[#2C2C2C] truncate block" testid={testid ? `${testid}-name` : undefined} />
        <p className="text-[10px] text-[#5B5F4D] truncate">{row.email}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">{children}</div>
    </li>
  );
}

export default function FriendsPage() {
  const { user: authedUser } = useAuth();
  const [data, setData] = useState({ accepted: [], pending_in: [], pending_out: [], blocked: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Invite-by-email state
  const [inviteEmail, setInviteEmail] = useState("");
  // Autocomplete state for @-prefixed lookups (already-Shelfsort users).
  const [inviteSuggestions, setInviteSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [requestingId, setRequestingId] = useState(null);
  const [inviteNote, setInviteNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [myInvites, setMyInvites] = useState([]);
  // Per-friend mutual counts and the active library-viewer target
  const [mutualByFriend, setMutualByFriend] = useState({});
  const [libraryFriend, setLibraryFriend] = useState(null);
  const [dmTarget, setDmTarget] = useState(null);  // {room_id, name}
  // Map of friend user_id → {room_id, unread} pulled from /chat/rooms so the
  // friends list can show an unread-message dot per friend.
  const [dmUnreadByFriend, setDmUnreadByFriend] = useState({});

  const loadDmUnread = async () => {
    try {
      const { data } = await api.get("/chat/rooms");
      const next = {};
      (data?.rooms || []).forEach((room) => {
        if (!room.unread || !Array.isArray(room.member_user_ids)) return;
        // DMs are 2-member rooms; flag the *other* member as having unreads.
        room.member_user_ids
          .filter((uid) => uid !== authedUser?.user_id)
          .forEach((uid) => {
            const prev = next[uid] || { unread: 0 };
            next[uid] = { room_id: room.room_id, unread: prev.unread + room.unread };
          });
      });
      setDmUnreadByFriend(next);
    } catch { /* non-blocking */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/friends");
      setData(data);
      // Fire-and-forget per-friend mutual counts; harmless if one fails.
      (data.accepted || []).forEach(async (f) => {
        try {
          const { data: m } = await api.get(`/friends/${f.other_user_id}/mutual`);
          setMutualByFriend((prev) => ({ ...prev, [f.other_user_id]: m }));
        } catch { /* ignore */ }
      });
    } catch { toast.error("Couldn't load friends"); }
    finally { setLoading(false); }
    try {
      const { data } = await api.get("/friends/invites");
      setMyInvites(data?.invites || []);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  // Pull DM unread counts once the auth context is ready. Re-fetched after
  // the DM drawer closes so the dot disappears as the user clears messages.
  useEffect(() => {
    if (!authedUser?.user_id) return;
    loadDmUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedUser?.user_id]);

  // Poll for new DMs every 60s while the tab is visible and no drawer
  // is open (relaxed from 20s — the unified SSE channel handles the
  // fast path; this just self-heals dropped connections).  Refetch
  // immediately on tab refocus so the unread dot reflects reality
  // after a long absence.
  useEffect(() => {
    if (!authedUser?.user_id) return;
    let interval = null;
    const tick = () => {
      if (document.hidden) return;
      if (dmTarget) return; // skip — drawer is open, user is actively reading
      loadDmUnread();
    };
    interval = setInterval(tick, 60000);
    const onVisibility = () => {
      if (!document.hidden && !dmTarget) loadDmUnread();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedUser?.user_id, dmTarget]);

  // Live updates via the unified SSE channel — no polling latency
  // for incoming DMs / friend requests.
  useEventStream({
    "chat-incoming": () => { if (!dmTarget) loadDmUnread(); },
    "notification": (n) => {
      if (n?.kind === "friend_request" || n?.kind === "friend_accepted") {
        // Re-pull the full friends + pending list to pick up the new edge.
        load();
      }
    },
  });

  // Honour `?room=<roomId>` deep links (legacy /messages/:roomId redirects).
  // Look the room up in /chat/rooms, find the other member, open the drawer,
  // then strip the param so it doesn't re-trigger on every state change.
  const location = useLocation();
  const navigate = useNavigate();
  const handledRoomRef = useRef(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wantedRoom = params.get("room");
    if (!wantedRoom) return;
    // Strict-mode double-mount + finally{navigate} re-renders both fire this
    // effect more than once for the same URL — dedupe via ref.
    if (handledRoomRef.current === wantedRoom) return;
    handledRoomRef.current = wantedRoom;
    (async () => {
      try {
        const { data } = await api.get("/chat/rooms");
        const rooms = data?.rooms || data || [];
        const match = rooms.find((r) => r.room_id === wantedRoom);
        if (match) {
          // Pick the other member's display name (or fall back to "Friend").
          const others = (match.members || []).filter((m) => m.user_id !== authedUser?.user_id);
          const name = others[0]?.name || others[0]?.email || match.name || "Friend";
          setDmTarget({ room_id: match.room_id, name });
        } else {
          toast.info("That conversation isn't available anymore.");
        }
      } catch {
        toast.error("Couldn't open that conversation");
      } finally {
        // Strip the query param either way so a reload doesn't loop.
        navigate("/friends", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, authedUser?.user_id]);

  // Debounced autocomplete: trigger only when the input starts with "@".
  useEffect(() => {
    const trimmed = inviteEmail.trim();
    if (!trimmed.startsWith("@")) {
      setInviteSuggestions([]);
      setShowSuggest(false);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/users/search", { params: { q: trimmed } });
        setInviteSuggestions(data?.users || []);
        setShowSuggest(true);
      } catch {
        setInviteSuggestions([]);
        setShowSuggest(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [inviteEmail]);

  const sendUsernameRequest = async (handle) => {
    const clean = (handle || "").trim();
    if (!clean) return;
    setRequestingId(clean);
    try {
      const { data } = await api.post("/friends/request", { target_username: clean });
      if (data.status === "accepted") {
        toast.success(`You're now friends with @${clean}`);
      } else {
        toast.success(`Friend request sent to @${clean}`);
      }
      setInviteEmail("");
      setShowSuggest(false);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't request @${clean}`);
    } finally { setRequestingId(null); }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    // If the user typed "@handle", route through /friends/request (username
    // path) instead of /friends/invite (email path).  This catches the case
    // where someone clicks the input, types a handle, and hits Send instead
    // of picking from the dropdown.
    const trimmed = inviteEmail.trim();
    if (trimmed.startsWith("@") || !trimmed.includes("@")) {
      await sendUsernameRequest(trimmed.replace(/^@+/, ""));
      return;
    }
    setInviting(true);
    try {
      const { data } = await api.post("/friends/invite", {
        email: inviteEmail.trim(),
        note: inviteNote.trim() || undefined,
      });
      if (data.path === "friend_request_sent" || data.path === "auto_accepted") {
        toast.success("That email is already on Shelfsort — friend request sent");
      } else if (data.path === "invite_sent") {
        toast.success(`Invite emailed to ${data.target_email}`);
      } else if (data.path === "invite_already_pending") {
        toast.info("You've already invited that email");
      } else if (data.path === "invite_created_email_failed") {
        toast.warning("Invite created but email failed — share the link manually");
      } else if (data.path === "request_already_pending") {
        toast.info("Friend request already pending with that user");
      } else if (data.path === "already_friends") {
        toast.info("You're already friends with that user");
      }
      setInviteEmail(""); setInviteNote("");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send invite");
    } finally { setInviting(false); }
  };

  const cancelInvite = async (inviteId) => {
    if (!window.confirm("Cancel this invite? The link will stop working.")) return;
    try { await api.delete(`/friends/invites/${inviteId}`); toast.success("Invite cancelled"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't cancel"); }
  };

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/users/search", { params: { q: q.trim() } });
        setResults(data?.users || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const request = async (uid) => {
    setBusyId(uid);
    try {
      await api.post("/friends/request", { target_user_id: uid });
      toast.success("Friend request sent");
      await load();
      setResults((r) => r.map((u) => u.user_id === uid ? { ...u, relation: "pending_out" } : u));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send request");
    } finally { setBusyId(null); }
  };

  const accept = async (uid) => {
    setBusyId(uid);
    try { await api.post(`/friends/${uid}/accept`); toast.success("Now friends"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't accept"); }
    finally { setBusyId(null); }
  };

  const decline = async (uid) => {
    setBusyId(uid);
    try { await api.post(`/friends/${uid}/decline`); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't decline"); }
    finally { setBusyId(null); }
  };

  const remove = async (uid) => {
    if (!window.confirm("Remove this friend? Your DM room with them is wiped.")) return;
    setBusyId(uid);
    try { await api.delete(`/friends/${uid}`); toast.success("Removed"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't remove"); }
    finally { setBusyId(null); }
  };

  const block = async (uid) => {
    if (!window.confirm("Block this user? They won't be able to message you or appear in your searches.")) return;
    setBusyId(uid);
    try { await api.post(`/friends/${uid}/block`); toast.success("Blocked"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't block"); }
    finally { setBusyId(null); }
  };

  const unblock = async (uid) => {
    setBusyId(uid);
    try { await api.delete(`/friends/${uid}/block`); toast.success("Unblocked"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't unblock"); }
    finally { setBusyId(null); }
  };

  const openDM = async (uid, name) => {
    setBusyId(uid);
    try {
      const { data } = await api.post(`/chat/dm/${uid}`);
      setDmTarget({ room_id: data.room_id, name: name || "Friend" });
      // The drawer marks the room as read on mount; clear the dot eagerly.
      setDmUnreadByFriend((prev) => {
        if (!prev[uid]) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't open DM");
    } finally { setBusyId(null); }
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="friends-page">
        <Link to="/account" className="inline-flex items-center gap-1 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to account
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
            <Users className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C]">Friends</h1>
            <p className="text-sm text-[#5B5F4D]">
              Send friend requests, accept incoming ones, manage blocks. Click <strong>Message</strong> on any friend to chat inline.
            </p>
            <PrimaryCTAButton
              to="/bookclubs"
              icon={Library}
              testid="friends-to-bookclubs"
              className="mt-3"
            >
              Read a book together in a reading room
            </PrimaryCTAButton>
          </div>
        </div>

        {/* Search */}
        <section className="shelf-card p-5 mb-5" data-testid="friends-search-card">
          <p className="text-xs font-bold uppercase tracking-wider text-[#5B5F4D] mb-2 flex items-center gap-1.5">
            <Search className="w-3 h-3" /> Find someone
          </p>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or email (min 2 chars)…"
            data-testid="friends-search-input"
            className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
          />
          {q.trim().length >= 2 && (
            <ul className="mt-3 rounded-lg border border-[#E8E6E1] bg-white overflow-hidden">
              {searching ? (
                <li className="px-3 py-2 text-xs text-[#5B5F4D]">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-[#5B5F4D] italic">No users found</li>
              ) : results.map((u) => (
                <PersonRow key={u.user_id} row={u} testid={`friends-search-result-${u.user_id}`}>
                  {u.relation === "none" && (
                    <button
                      type="button"
                      onClick={() => request(u.user_id)}
                      disabled={busyId === u.user_id}
                      data-testid={`friends-request-btn-${u.user_id}`}
                      className="text-[11px] px-2 py-1 rounded bg-[var(--primary)] text-white font-semibold disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" /> Request
                    </button>
                  )}
                  {u.relation === "pending_out" && (
                    <span className="text-[11px] text-[#5B5F4D] italic">Request sent</span>
                  )}
                  {u.relation === "pending_in" && (
                    <button
                      type="button"
                      onClick={() => accept(u.user_id)}
                      data-testid={`friends-accept-btn-${u.user_id}`}
                      className="text-[11px] px-2 py-1 rounded bg-[#6B46C1] text-white font-semibold inline-flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Accept
                    </button>
                  )}
                  {u.relation === "friend" && (
                    <button
                      type="button"
                      onClick={() => openDM(u.user_id, u.name || u.email)}
                      className="text-[11px] px-2 py-1 rounded border border-[#6B46C1] text-[#6B46C1] inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" /> Message
                    </button>
                  )}
                </PersonRow>
              ))}
            </ul>
          )}
        </section>

        {/* Invite by email — for people not on Shelfsort yet */}
        <section className="shelf-card p-5 mb-5" data-testid="friends-invite-card">
          <p className="text-xs font-bold uppercase tracking-wider text-[#5B5F4D] mb-2 flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> Find a friend
          </p>
          <p className="text-xs text-[#5B5F4D] mb-3">
            Already on Shelfsort? Type <code className="bg-[#F5F3EC] px-1 rounded">@handle</code> to find them. Not yet? Send an email invite — they get a one-click link to sign up and become your friend automatically.
          </p>
          <div className="space-y-2 relative">
            <input
              type="text"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onFocus={() => inviteEmail.trim().startsWith("@") && setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="friend@example.com or @handle"
              data-testid="friends-invite-email"
              className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            />
            {showSuggest && inviteSuggestions.length > 0 && (
              <ul
                data-testid="friends-invite-suggestions"
                className="absolute left-0 right-0 top-[42px] z-20 bg-white border border-[#E5DDC5] rounded-lg shadow-lg max-h-60 overflow-y-auto"
              >
                {inviteSuggestions.map((u) => (
                  <li key={u.user_id}>
                    <button
                      type="button"
                      data-testid={`friends-invite-suggest-${u.username}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => sendUsernameRequest(u.username)}
                      disabled={requestingId === u.username}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-[#FBFAF6] disabled:opacity-50"
                    >
                      {u.picture
                        ? <img src={u.picture} alt={u.username} className="w-6 h-6 rounded-full flex-shrink-0" />
                        : <div className="w-6 h-6 rounded-full bg-[#E5DDC5] flex-shrink-0 flex items-center justify-center text-xs font-mono text-[#5B5F4D]">@</div>}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono text-[#2C2C2C] truncate">@{u.username}</p>
                        {u.previous_username && (
                          <p className="text-[10px] text-[#5B5F4D] truncate">was @{u.previous_username}</p>
                        )}
                      </div>
                      {requestingId === u.username && <Loader2 className="w-3 h-3 animate-spin text-[#6B46C1]" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showSuggest && inviteEmail.trim().startsWith("@") && inviteSuggestions.length === 0 && inviteEmail.trim().length >= 3 && (
              <div className="absolute left-0 right-0 top-[42px] z-20 bg-white border border-[#E5DDC5] rounded-lg shadow-lg px-3 py-2 text-xs text-[#5B5F4D]" data-testid="friends-invite-no-results">
                No one with that handle yet.
              </div>
            )}
            <input
              type="text"
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value.slice(0, 200))}
              placeholder="Optional note (e.g. 'You'd love this for your fanfic stash')"
              data-testid="friends-invite-note"
              className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            />
            <button
              type="button"
              onClick={sendInvite}
              disabled={inviting || !inviteEmail.trim()}
              data-testid="friends-invite-send-btn"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send invite
            </button>
          </div>
          {myInvites.filter((i) => i.status === "pending").length > 0 && (
            <details className="mt-4" data-testid="friends-invite-pending-details">
              <summary className="text-xs font-semibold text-[#5B5F4D] cursor-pointer">
                Pending invites ({myInvites.filter((i) => i.status === "pending").length})
              </summary>
              <ul className="mt-2 rounded-lg border border-[#E8E6E1]">
                {myInvites.filter((i) => i.status === "pending").map((inv) => (
                  <li
                    key={inv.invite_id}
                    data-testid={`friends-invite-row-${inv.invite_id}`}
                    className="px-3 py-2 flex items-center gap-2 border-b border-[#E8E6E1] last:border-b-0 text-xs"
                  >
                    <Mail className="w-3 h-3 text-[#5B5F4D]" />
                    <span className="flex-1 truncate text-[#2C2C2C]">{inv.target_email}</span>
                    <button
                      type="button"
                      onClick={() => cancelInvite(inv.invite_id)}
                      className="text-[10px] px-2 py-0.5 rounded border border-[#E5DDC5] text-[#5B5F4D]"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* Three lists */}
        {loading ? (
          <p className="text-sm text-[#5B5F4D]"><Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…</p>
        ) : (
          <>
            <section className="shelf-card p-5 mb-5" data-testid="friends-incoming-card">
              <h2 className="font-serif text-lg text-[#2C2C2C] mb-2">
                Incoming requests{data.pending_in.length > 0 && (
                  <span className="ml-2 text-xs text-[var(--primary)] font-semibold">({data.pending_in.length})</span>
                )}
              </h2>
              {data.pending_in.length === 0 ? (
                <p className="text-xs text-[#5B5F4D] italic">No pending requests.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.pending_in.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-pending-in-${r.other_user_id}`}>
                      <button type="button" onClick={() => accept(r.other_user_id)} data-testid={`friends-accept-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded bg-[#6B46C1] text-white font-semibold inline-flex items-center gap-1">
                        <Check className="w-3 h-3" /> Accept
                      </button>
                      <button type="button" onClick={() => decline(r.other_user_id)} data-testid={`friends-decline-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#5B5F4D]">
                        <XIcon className="w-3 h-3" />
                      </button>
                    </PersonRow>
                  ))}
                </ul>
              )}
              {/* "Switch to open" banner (Phase 1c — only shows when there are pending requests) */}
              {data.pending_in.length > 0 && (
                <p className="text-xs text-[#5B5F4D] mt-3">
                  Tired of friend requests?{" "}
                  <Link to="/account#privacy" className="underline text-[var(--primary)] font-semibold">
                    Switch to open DM mode →
                  </Link>
                </p>
              )}
            </section>

            <section className="shelf-card p-5 mb-5" data-testid="friends-accepted-card">
              <h2 className="font-serif text-lg text-[#2C2C2C] mb-2">Friends ({data.accepted.length})</h2>
              {data.accepted.length === 0 ? (
                <p className="text-xs text-[#5B5F4D] italic">No friends yet. Use the search above to find people.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.accepted.map((r) => {
                    const m = mutualByFriend[r.other_user_id];
                    const dm = dmUnreadByFriend[r.other_user_id];
                    const unreadCount = dm?.unread || 0;
                    return (
                      <PersonRow key={r.friendship_id} row={r} testid={`friends-accepted-row-${r.other_user_id}`}>
                        {unreadCount > 0 && (
                          <span
                            data-testid={`friends-unread-dot-${r.other_user_id}`}
                            title={`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`}
                            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold"
                          >
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        )}
                        {m && m.count > 0 && (
                          <span
                            data-testid={`friends-mutual-badge-${r.other_user_id}`}
                            title={`${m.count} of their ${m.their_total} books are in your library`}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#FBFAF6] border border-[#E5DDC5] text-[#5B5F4D] font-semibold"
                          >
                            🤝 {m.count}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setLibraryFriend(r)}
                          data-testid={`friends-view-library-btn-${r.other_user_id}`}
                          className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#5B5F4D] hover:bg-[#FBFAF6] inline-flex items-center gap-1"
                          title="Browse their library"
                        >
                          <Library className="w-3 h-3" /> Library
                        </button>
                        <button type="button" onClick={() => openDM(r.other_user_id, r.name || r.email)} disabled={busyId === r.other_user_id} data-testid={`friends-message-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#6B46C1] text-[#6B46C1] inline-flex items-center gap-1 disabled:opacity-50">
                          <MessageSquare className="w-3 h-3" /> Message
                        </button>
                        <button type="button" onClick={() => block(r.other_user_id)} className="text-[11px] px-2 py-1 rounded text-[#B43F26]" title="Block">
                          <Ban className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => remove(r.other_user_id)} data-testid={`friends-remove-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded text-[#5B5F4D]" title="Remove">
                          <XIcon className="w-3 h-3" />
                        </button>
                      </PersonRow>
                    );
                  })}
                </ul>
              )}
            </section>

            {data.pending_out.length > 0 && (
              <section className="shelf-card p-5 mb-5">
                <h2 className="font-serif text-lg text-[#2C2C2C] mb-2">Outgoing requests ({data.pending_out.length})</h2>
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.pending_out.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-pending-out-${r.other_user_id}`}>
                      <button type="button" onClick={() => decline(r.other_user_id)} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#5B5F4D]">
                        Cancel
                      </button>
                    </PersonRow>
                  ))}
                </ul>
              </section>
            )}

            <section className="shelf-card p-5 mb-5" data-testid="friends-blocked-card">
              <h2 className="font-serif text-lg text-[#2C2C2C] mb-2">Blocked ({data.blocked.length})</h2>
              {data.blocked.length === 0 ? (
                <p className="text-xs text-[#5B5F4D] italic">You haven&apos;t blocked anyone.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.blocked.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-blocked-row-${r.other_user_id}`}>
                      <button type="button" onClick={() => unblock(r.other_user_id)} data-testid={`friends-unblock-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#5B5F4D] inline-flex items-center gap-1">
                        <ShieldOff className="w-3 h-3" /> Unblock
                      </button>
                    </PersonRow>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        {libraryFriend && (
          <FriendLibraryModal friend={libraryFriend} onClose={() => setLibraryFriend(null)} />
        )}
        {dmTarget && (
          <DmDrawer
            roomId={dmTarget.room_id}
            friendName={dmTarget.name}
            onClose={() => { setDmTarget(null); loadDmUnread(); }}
          />
        )}
      </main>
    </div>
  );
}
