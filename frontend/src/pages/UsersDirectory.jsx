import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Search, UserPlus, Loader2, Check, Clock, Users as UsersIcon, ShieldOff, AtSign, AlertCircle } from "lucide-react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// One-shot welcome toast (per device) shown the first time a user
// lands on /users.  Two variants depending on whether they've already
// claimed a @handle:
//   - No username   → CTA to claim one (otherwise they're invisible
//                     to other users, since the directory only lists
//                     accounts WITH a username).
//   - Has username  → light confirmation that they're listed.
const WELCOME_FLAG = "shelfsort.directoryWelcomeShown.v1";

// Public-ish user directory at /users.
//
// Privacy intent (Phase 1c, 2026-06-25):
//   - Every signed-in user is listed by default — friction-free way to
//     find someone you already know on Shelfsort.
//   - We only render the @username.  No name, no email, no avatar, no
//     library counts.  Anything beyond "this handle exists" goes
//     through the existing friend-request flow.
//   - Users can opt out from Account → Privacy → "Hide me from the
//     public directory".  Same flag (`hidden_from_search`) that already
//     governs the @-autocomplete in Friends.
//
// Backend: GET /api/users/directory?page=&limit= (see routes/friends.py).
// CTA: POST /api/friends/request {target_username}.

const PAGE_SIZE = 60;

function RelationCta({ row, busy, onSend }) {
  // The directory endpoint doesn't return relation status (keeps the
  // payload tiny + privacy-preserving), so we don't bother showing
  // friend/pending state per row — sending the request idempotently
  // resolves on the backend.  Errors surface via toast.
  const handle = row.username || "";
  const isBusy = busy === handle;
  return (
    <button
      type="button"
      onClick={() => onSend(handle)}
      disabled={isBusy || !handle}
      data-testid={`directory-add-${handle}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
      {isBusy ? "Sending…" : "Add"}
    </button>
  );
}

export default function UsersDirectory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(null);
  const [sentTo, setSentTo] = useState(() => new Set());
  // Handle of the row to scroll to + highlight when the URL contains
  // ?focus=somehandle.  Stored in state (not derived) so a successful
  // scroll can clear it locally without re-triggering on next render.
  const [focusHandle, setFocusHandle] = useState(() => {
    const raw = searchParams.get("focus") || "";
    return raw.trim().replace(/^@/, "").toLowerCase();
  });
  // Ref-of-handles → DOM node, populated as rows render.  Used by the
  // focus effect below to scroll the exact <li>.
  const rowRefs = useRef({});

  // One-shot welcome — fires once per device, gated on user being
  // loaded so the @handle branch is decided against fresh truth.
  useEffect(() => {
    if (!user) return;
    let shown = false;
    try { shown = localStorage.getItem(WELCOME_FLAG) === "1"; } catch { /* ignore */ }
    if (shown) return;
    try { localStorage.setItem(WELCOME_FLAG, "1"); } catch { /* ignore */ }

    const handle = (user.username || "").trim();
    if (handle) {
      toast.success(`Welcome — you're listed here as @${handle}.`, {
        description: "Filter above to find friends, or send a request to any handle below.",
        duration: 6000,
      });
    } else {
      toast("Claim your @handle so friends can find you.", {
        description: "Accounts without a username don't appear in this directory.",
        duration: 12000,
        action: {
          label: "Pick a handle",
          onClick: () => navigate("/account#profile"),
        },
      });
    }
  }, [user, navigate]);

  const load = async (p) => {
    setLoading(true);
    try {
      const { data } = await api.get("/users/directory", {
        params: { page: p, limit: PAGE_SIZE },
      });
      setRows(data?.users || []);
      setTotal(data?.total || 0);
      setHasMore(!!data?.has_more);
      setPage(data?.page || p);
    } catch {
      toast.error("Couldn't load the user directory");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(1); }, []);

  // Auto-scroll to a row when /users?focus=handle is used (e.g. from a
  // crossover suggestion or friend-request link).  We wait until rows
  // have rendered, then scroll the <li> into view and apply a 2.5s
  // amber highlight pulse so the eye lands on the right place.  After
  // scrolling we strip the ?focus= param so a page refresh doesn't
  // keep re-scrolling, and we clear the local state so the highlight
  // animation can finish + tear down.
  useEffect(() => {
    if (!focusHandle || loading || rows.length === 0) return;
    const node = rowRefs.current[focusHandle];
    if (!node) {
      // Handle not on this page (paged out). Toast so the user knows
      // why nothing scrolled, and clear so we don't trip again.
      toast(`@${focusHandle} isn't on this page — use the filter or paginate to find them.`, { duration: 6000 });
      setFocusHandle("");
      if (searchParams.get("focus")) {
        const next = new URLSearchParams(searchParams);
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    // Strip the ?focus= param so a refresh isn't sticky, but leave the
    // local state set for ~2.6s so the CSS highlight class can play.
    if (searchParams.get("focus")) {
      const next = new URLSearchParams(searchParams);
      next.delete("focus");
      setSearchParams(next, { replace: true });
    }
    const t = setTimeout(() => setFocusHandle(""), 2600);
    return () => clearTimeout(t);
  }, [focusHandle, loading, rows, searchParams, setSearchParams]);

  const sendRequest = async (handle) => {
    if (!handle) return;
    setBusy(handle);
    try {
      const { data } = await api.post("/friends/request", { target_username: handle });
      if (data.status === "accepted") {
        toast.success(`You're now friends with @${handle}`);
      } else {
        toast.success(`Friend request sent to @${handle}`);
      }
      setSentTo((prev) => new Set(prev).add(handle));
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't request @${handle}`);
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^@/, "");
    if (!q) return rows;
    return rows.filter((r) => (r.username || "").toLowerCase().includes(q));
  }, [rows, filter]);

  const pageStart = (page - 1) * PAGE_SIZE + 1;
  const pageEnd = (page - 1) * PAGE_SIZE + rows.length;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12 fade-in" data-testid="users-directory-page">
        <Link to="/friends" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6">
          <ArrowLeft className="w-4 h-4" /> Friends
        </Link>

        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            Reader directory
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05] tracking-tight">
            Find readers you know.
          </h1>
          <p className="text-[#6B705C] mt-3 text-base sm:text-lg">
            Just usernames — no names, emails, or library peeking.
            Send a friend request and we&apos;ll do the rest.
          </p>
        </header>

        {/* Persistent profile-completeness nudge.  Sits between the
            header and the search box, only when the signed-in user
            hasn't claimed a @handle yet (without a handle they're
            *invisible* in this directory, so this is the highest-
            leverage discoverability fix we can show).  Distinct from
            the one-shot welcome toast above: the toast fires once per
            device + dismisses fast; this banner stays until they act.
            data-testid wired for canary-friendly e2e. */}
        {user && !(user.username || "").trim() && (
          <div
            data-testid="directory-claim-handle-nudge"
            className="mb-5 p-4 rounded-xl border border-[#E5C97A] bg-[#FFF8E1] flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-[#B7791F] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#2C2C2C]">
                You&rsquo;re not in this directory yet.
              </p>
              <p className="text-xs text-[#6B705C] mt-1">
                Friends can&rsquo;t find you here until you claim a @handle.
                Takes about ten seconds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/account#profile")}
              data-testid="directory-claim-handle-cta"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] flex-shrink-0"
            >
              <AtSign className="w-3.5 h-3.5" /> Claim a handle
            </button>
          </div>
        )}

        <div className="shelf-card p-3 mb-5 flex items-center gap-2">
          <Search className="w-4 h-4 text-[#6B705C] ml-1.5" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this page by handle…"
            data-testid="directory-filter-input"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#A09A8B]"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              data-testid="directory-filter-clear"
              className="text-xs text-[#6B705C] hover:text-[#2C2C2C] px-2 py-1"
            >
              clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#6B705C]" data-testid="directory-loading">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            Loading the directory…
          </div>
        ) : visible.length === 0 ? (
          <div className="shelf-card p-10 text-center text-[#6B705C]" data-testid="directory-empty">
            <UsersIcon className="w-8 h-8 mx-auto mb-3 opacity-60" />
            {rows.length === 0
              ? "Nobody to show here yet — be the first to claim a handle in Account → Profile."
              : "No handles match this filter."}
          </div>
        ) : (
          <ul className="shelf-card divide-y divide-[#E8E6E1] overflow-hidden" data-testid="directory-list">
            {visible.map((row) => {
              const sent = sentTo.has(row.username);
              const handleLc = (row.username || "").toLowerCase();
              const isFocused = focusHandle && handleLc === focusHandle;
              return (
                <li
                  key={row.user_id}
                  ref={(el) => {
                    // React calls this with `null` on unmount; clean
                    // up the stale entry so paginating away from a
                    // focused row can't later scroll to a detached
                    // node.  Review finding from iteration_47.
                    if (!handleLc) return;
                    if (el) rowRefs.current[handleLc] = el;
                    else delete rowRefs.current[handleLc];
                  }}
                  data-testid={`directory-row-${row.username}`}
                  className={
                    "px-4 py-3 flex items-center gap-3 transition-colors duration-700 " +
                    (isFocused ? "bg-[#FFF6D6]" : "")
                  }
                >
                  <div className="w-8 h-8 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0 font-semibold text-sm">
                    {(row.username || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#2C2C2C] flex items-center gap-1 truncate">
                      <AtSign className="w-3.5 h-3.5 text-[#6B705C] flex-shrink-0" />
                      <span className="truncate">{row.username || "(no handle)"}</span>
                    </p>
                  </div>
                  {sent ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#3D8B79] px-2 py-1" data-testid={`directory-sent-${row.username}`}>
                      <Check className="w-3.5 h-3.5" /> Sent
                    </span>
                  ) : (
                    <RelationCta row={row} busy={busy} onSend={sendRequest} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && total > 0 && (
          <div
            className="flex items-center justify-between mt-5 text-xs text-[#6B705C]"
            data-testid="directory-pager"
          >
            <span>
              {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => load(page - 1)}
                disabled={page <= 1 || loading}
                data-testid="directory-prev-btn"
                className="px-3 py-1.5 rounded-md border border-[#E5DDC5] hover:bg-white disabled:opacity-50"
              >
                ← Prev
              </button>
              <span data-testid="directory-page-label">Page {page}</span>
              <button
                type="button"
                onClick={() => load(page + 1)}
                disabled={!hasMore || loading}
                data-testid="directory-next-btn"
                className="px-3 py-1.5 rounded-md border border-[#E5DDC5] hover:bg-white disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        <p
          className="mt-8 p-4 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] text-xs text-[#6B705C] flex items-start gap-2"
          data-testid="directory-privacy-note"
        >
          <ShieldOff className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#6B46C1]" />
          <span>
            Your handle is listed here so friends can find you. Don&apos;t want
            that?{" "}
            <Link to="/account#privacy" className="text-[#6B46C1] underline font-semibold">
              Hide me from the directory
            </Link>
            {" "}in Account → Privacy. We never show your name, email, or library to anyone outside your friends list.
          </span>
        </p>
      </main>
    </div>
  );
}
