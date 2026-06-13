import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Search, UserPlus, Check, X as XIcon, MessageSquare,
  Ban, ShieldOff, Loader2, Mail,
} from "lucide-react";
import Navbar from "../components/Navbar";
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

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/friends");
      setData(data);
    } catch { toast.error("Couldn't load friends"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

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
              Send friend requests, accept incoming ones, manage blocks. Direct messages live at <Link to="/messages" className="underline">/messages</Link>.
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
            className="w-full text-sm px-3 py-2 rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:ring-2 focus:ring-[#3A5A40]/30"
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
                      className="text-[11px] px-2 py-1 rounded bg-[#3A5A40] text-white font-semibold inline-flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Accept
                    </button>
                  )}
                  {u.relation === "friend" && (
                    <button
                      type="button"
                      onClick={() => openDM(u.user_id)}
                      className="text-[11px] px-2 py-1 rounded border border-[#3A5A40] text-[#3A5A40] inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" /> Message
                    </button>
                  )}
                </PersonRow>
              ))}
            </ul>
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
                      <button type="button" onClick={() => accept(r.other_user_id)} data-testid={`friends-accept-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded bg-[#3A5A40] text-white font-semibold inline-flex items-center gap-1">
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
                  {data.accepted.map((r) => (
                    <PersonRow key={r.friendship_id} row={r} testid={`friends-accepted-row-${r.other_user_id}`}>
                      <button type="button" onClick={() => openDM(r.other_user_id)} data-testid={`friends-message-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded border border-[#3A5A40] text-[#3A5A40] inline-flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> Message
                      </button>
                      <button type="button" onClick={() => block(r.other_user_id)} className="text-[11px] px-2 py-1 rounded text-[#B43F26]" title="Block">
                        <Ban className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => remove(r.other_user_id)} data-testid={`friends-remove-btn-${r.other_user_id}`} className="text-[11px] px-2 py-1 rounded text-[#6B705C]" title="Remove">
                        <XIcon className="w-3 h-3" />
                      </button>
                    </PersonRow>
                  ))}
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
      </main>
    </div>
  );
}
