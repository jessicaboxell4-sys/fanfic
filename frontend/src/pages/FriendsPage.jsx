import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Search, UserPlus, Check, X as XIcon, MessageSquare,
  Ban, ShieldOff, Loader2, Mail, Send, Library,
} from "lucide-react";
import Navbar from "../components/Navbar";
import FriendLibraryModal from "../components/FriendLibraryModal";
import { api } from "../lib/api";

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
          <Mail className="w-3.5 h-3.5 text-[#6B705C]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#2C2C2C] truncate">{row.name || row.email}</p>
        <p className="text-[10px] text-[#6B705C] truncate">{row.email}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">{children}</div>
    </li>
  );
}

export default function FriendsPage() {
  const [data, setData] = useState({ accepted: [], pending_in: [], pending_out: [], blocked: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Invite-by-email state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [myInvites, setMyInvites] = useState([]);
  // Per-friend mutual counts and the active library-viewer target
  const [mutualByFriend, setMutualByFriend] = useState({});
  const [libraryFriend, setLibraryFriend] = useState(null);

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

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
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

  const openDM = async (uid) => {
    setBusyId(uid);
    try {
      const { data } = await api.post(`/chat/dm/${uid}`);
      window.location.href = `/messages/${data.room_id}`;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't open DM");
    } finally { setBusyId(null); }
  };

  return (
    <div className="min-h-screen bg-[#FBF7EE]">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="friends-page">
        <Link to="/account" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-4">
          <ArrowLeft className="w-4 h-4" /> back to account
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-[#FBFAF6] border border-[#E5DDC5] flex items-center justify-center">
            <Users className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2C2C2C]">Friends</h1>
            <p className="text-sm text-[#6B705C]">
              Send friend requests, accept incoming ones, manage blocks. Direct messages live at <Link to="/messages" className="underline">/messages</Link>. Read a book together in a <Link to="/bookclubs" className="underline text-[#6B46C1]" data-testid="friends-to-bookclubs">reading room</Link>.
            </p>
          </div>
        </div>

        {/* Search */}
        <section className="shelf-card p-5 mb-5" data-testid="friends-search-card">
          <p className="text-xs font-bold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1.5">
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
                <li className="px-3 py-2 text-xs text-[#6B705C]">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-[#6B705C] italic">No users found</li>
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
                    <span className="text-[11px] text-[#6B705C] italic">Request sent</span>
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
                      onClick={() => openDM(u.user_id)}
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
          <p className="text-xs font-bold uppercase tracking-wider text-[#6B705C] mb-2 flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> Invite someone by email
          </p>
          <p className="text-xs text-[#6B705C] mb-3">
            Not on Shelfsort yet? Send them an invite — they get an email with a one-click link to sign up and become your friend automatically.
          </p>
          <div className="space-y-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@example.com"
              data-testid="friends-invite-email"
              className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#6B46C1]/30"
            />
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
              <summary className="text-xs font-semibold text-[#6B705C] cursor-pointer">
                Pending invites ({myInvites.filter((i) => i.status === "pending").length})
              </summary>
              <ul className="mt-2 rounded-lg border border-[#E8E6E1]">
                {myInvites.filter((i) => i.status === "pending").map((inv) => (
                  <li
                    key={inv.invite_id}
                    data-testid={`friends-invite-row-${inv.invite_id}`}
                    className="px-3 py-2 flex items-center gap-2 border-b border-[#E8E6E1] last:border-b-0 text-xs"
                  >
                    <Mail className="w-3 h-3 text-[#6B705C]" />
                    <span className="flex-1 truncate text-[#2C2C2C]">{inv.target_email}</span>
                    <button
                      type="button"
                      onClick={() => cancelInvite(inv.invite_id)}
                      className="text-[10px] px-2 py-0.5 rounded border border-[#E5DDC5] text-[#6B705C]"
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
          <p className="text-sm text-[#6B705C]"><Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…</p>
        ) : (
          <>
            <section className="shelf-card p-5 mb-5" data-testid="friends-incoming-card">
              <h2 className="font-serif text-lg text-[#2C2C2C] mb-2">
                Incoming requests{data.pending_in.length > 0 && (
                  <span className="ml-2 text-xs text-[var(--primary)] font-semibold">({data.pending_in.length})</span>
                )}
              </h2>
              {data.pending_in.length === 0 ? (
                <p className="text-xs text-[#6B705C] italic">No pending requests.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.pending_in.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-pending-in-${r.other_user_id}`}>
                      <button type="button" onClick={() => accept(r.other_user_id)} data-testid={`friends-accept-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded bg-[#6B46C1] text-white font-semibold inline-flex items-center gap-1">
                        <Check className="w-3 h-3" /> Accept
                      </button>
                      <button type="button" onClick={() => decline(r.other_user_id)} data-testid={`friends-decline-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#6B705C]">
                        <XIcon className="w-3 h-3" />
                      </button>
                    </PersonRow>
                  ))}
                </ul>
              )}
              {/* "Switch to open" banner (Phase 1c — only shows when there are pending requests) */}
              {data.pending_in.length > 0 && (
                <p className="text-xs text-[#6B705C] mt-3">
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
                <p className="text-xs text-[#6B705C] italic">No friends yet. Use the search above to find people.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.accepted.map((r) => {
                    const m = mutualByFriend[r.other_user_id];
                    return (
                      <PersonRow key={r.friendship_id} row={r} testid={`friends-accepted-row-${r.other_user_id}`}>
                        {m && m.count > 0 && (
                          <span
                            data-testid={`friends-mutual-badge-${r.other_user_id}`}
                            title={`${m.count} of their ${m.their_total} books are in your library`}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#FBFAF6] border border-[#E5DDC5] text-[#6B705C] font-semibold"
                          >
                            🤝 {m.count}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setLibraryFriend(r)}
                          data-testid={`friends-view-library-btn-${r.other_user_id}`}
                          className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#6B705C] hover:bg-[#FBFAF6] inline-flex items-center gap-1"
                          title="Browse their library"
                        >
                          <Library className="w-3 h-3" /> Library
                        </button>
                        <button type="button" onClick={() => openDM(r.other_user_id)} data-testid={`friends-message-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#6B46C1] text-[#6B46C1] inline-flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> Message
                        </button>
                        <button type="button" onClick={() => block(r.other_user_id)} className="text-[11px] px-2 py-1 rounded text-[#B43F26]" title="Block">
                          <Ban className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => remove(r.other_user_id)} data-testid={`friends-remove-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded text-[#6B705C]" title="Remove">
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
                      <button type="button" onClick={() => decline(r.other_user_id)} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#6B705C]">
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
                <p className="text-xs text-[#6B705C] italic">You haven&apos;t blocked anyone.</p>
              ) : (
                <ul className="rounded-lg border border-[#E8E6E1]">
                  {data.blocked.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-blocked-row-${r.other_user_id}`}>
                      <button type="button" onClick={() => unblock(r.other_user_id)} data-testid={`friends-unblock-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#E5DDC5] text-[#6B705C] inline-flex items-center gap-1">
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
      </main>
    </div>
  );
}
