import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { Library, Search, BookOpen, Sparkles, ArrowLeft, ExternalLink, LogIn, Heart } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Authenticated read-only view of someone's library.
// Reached via /u/:username/library — only renders when:
//   1) the viewer is signed in (anonymous callers see a sign-in gate), AND
//   2) the target user has flipped on `library_visible_to_public` in
//      their Privacy settings.
//
// Privacy invariants (server-side enforced):
//   - 401 for anonymous viewers (auth-required as of 2026-06-26).
//   - 404 (not 403) for both "doesn't exist" and "not public", so
//     this page can't be used to enumerate handles.
//   - Only title/author/fandom/category surface — no files, no AV
//     status, no download links.  Owner's email never returned.
//   - Link previews (OG tags) still work for anon — the /api/share/u
//     endpoint stays public so FB/Twitter crawlers can render rich
//     cards, but the actual click lands here and is gated.
export default function PublicLibraryView() {
  const { username } = useParams();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Distinct from notFound: when the API returns 401 we render a
  // login-prompt card instead of the generic "library not found"
  // card, with a return-to-this-page redirect baked into the CTA.
  const [needsLogin, setNeedsLogin] = useState(false);
  // Preview data shown on the 401 gate ("@alice has 247 books") —
  // pulled from the anon library-preview endpoint when needsLogin
  // is set.  Optional; absent on rate-limit/network failure so the
  // gate still works without it.
  const [previewData, setPreviewData] = useState(null);
  const [q, setQ] = useState("");
  const [fandomFilter, setFandomFilter] = useState("");
  // Per-book heart state.  Map<book_id, true/false>.  Lazy-fetched
  // for the visible page only — we don't pre-load reactions for
  // every book to avoid an N-request stampede on large libraries.
  const [hearts, setHearts] = useState({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setNeedsLogin(false);
    (async () => {
      try {
        const { data: payload } = await api.get(`/users/${username}/public-library`);
        if (alive) {
          setData(payload);
          document.title = `@${payload.owner.username}'s library · Shelfsort`;
          // Fire the rate-limited view-ping so the owner sees an
          // "@<viewer> peeked at your library" notification (max
          // once per 24h per viewer/owner pair).  Backend rejects
          // self-views silently — no UI handling needed.
          if (payload.viewer_is_signed_in) {
            try { await api.post(`/users/${username}/public-library/view-ping`); }
            catch { /* best-effort */ }
          }
        }
      } catch (e) {
        if (alive) {
          // 401 → not signed in; show the login gate instead of 404.
          if (e?.response?.status === 401) {
            setNeedsLogin(true);
            document.title = `Sign in to view this library · Shelfsort`;
            // Best-effort preview fetch — the anon library-preview
            // endpoint returns enough to make the gate compelling
            // ("@alice has 247 books — top fandom: Harry Potter").
            // 404 here is silently ignored so the gate still works.
            try {
              const { data: pv } = await api.get(`/users/${username}/library-preview`);
              if (alive) setPreviewData(pv);
            } catch { /* preview is optional */ }
          } else {
            setNotFound(true);
            document.title = `Library not found · Shelfsort`;
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [username]);

  // Client-side filter (search + fandom chip) layered on top of the
  // server's broader result.  Avoids round-trips when the user is
  // just browsing.
  const visibleBooks = useMemo(() => {
    if (!data?.books) return [];
    const needle = q.trim().toLowerCase();
    return data.books.filter((b) => {
      if (fandomFilter && (b.fandom || "") !== fandomFilter) return false;
      if (!needle) return true;
      const hay = `${b.title || ""} ${b.author || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q, fandomFilter]);

  // Toggle a heart on someone else's book.  Optimistic update with
  // rollback on error.  Self-react returns {self_react: true} — we
  // surface a quick toast instead of mutating state.
  const toggleHeart = async (bookId) => {
    const prev = !!hearts[bookId];
    setHearts((h) => ({ ...h, [bookId]: !prev }));
    try {
      const { data: res } = await api.post(`/books/${bookId}/react`);
      if (res?.self_react) {
        // Owner can't heart their own book — undo the optimistic flip.
        setHearts((h) => ({ ...h, [bookId]: false }));
        return;
      }
      setHearts((h) => ({ ...h, [bookId]: !!res?.hearted }));
    } catch {
      setHearts((h) => ({ ...h, [bookId]: prev }));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
          <div className="text-center text-[#6B705C]" data-testid="public-library-loading">
            <Library className="w-8 h-8 mx-auto mb-3 opacity-50 animate-pulse" />
            Loading library…
          </div>
        </main>
      </div>
    );
  }

  if (needsLogin) {
    // Reach the same library after sign-in via ?next=/u/<handle>/library.
    // /login reads the param and redirects there on success.
    const next = encodeURIComponent(location.pathname + (location.search || ""));
    const pv = previewData;
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          <div
            className="shelf-card p-10 text-center"
            data-testid="public-library-needs-login"
          >
            {pv ? (
              <>
                {/* Owner preview pulled from the anon library-preview
                    endpoint — converts "sign in" from a generic prompt
                    into "here's exactly what you're about to see". */}
                <div className="mb-4 flex flex-col items-center gap-2" data-testid="public-library-gate-preview">
                  {pv.picture ? (
                    <img
                      src={pv.picture}
                      alt={`@${pv.username}`}
                      className="w-16 h-16 rounded-full ring-2 ring-[#EEE9FB]"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center font-serif text-2xl ring-2 ring-[#EEE9FB]">
                      {(pv.username || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <p className="text-sm text-[#6B705C]">
                    <span className="font-semibold text-[#2C2C2C]">@{pv.username}</span>{" "}
                    has
                    <span className="font-semibold text-[#2C2C2C]" data-testid="public-library-gate-book-count"> {pv.total_books} </span>
                    {pv.total_books === 1 ? "book" : "books"}
                    {pv.top_fandom ? (
                      <> across <span className="font-semibold text-[#2C2C2C]" data-testid="public-library-gate-top-fandom">{pv.top_fandom}</span></>
                    ) : null}
                    {pv.top_fandom && pv.fandom_count > 1 ? (
                      <> +{pv.fandom_count - 1} more</>
                    ) : null}
                    .
                  </p>
                  {pv.bio ? (
                    <p className="text-xs text-[#6B705C] italic max-w-sm" data-testid="public-library-gate-bio">
                      &ldquo;{pv.bio}&rdquo;
                    </p>
                  ) : null}
                </div>
                <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">
                  Sign in to see what they&rsquo;re reading
                </h1>
                <p className="text-sm text-[#6B705C] mb-6">
                  Free account, 30 seconds — and you get your own
                  Shelfsort library out of the deal.
                </p>
              </>
            ) : (
              <>
                <Library className="w-10 h-10 mx-auto mb-4 text-[#6B46C1] opacity-80" />
                <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">
                  Sign in to read libraries
                </h1>
                <p className="text-sm text-[#6B705C] mb-6">
                  Shelfsort libraries are for members only. Sign in or create a
                  free account to browse @{username}&rsquo;s shelves and see books
                  you have in common.
                </p>
              </>
            )}
            <div className="flex items-center justify-center gap-2">
              <Link
                to={`/login?next=${next}`}
                data-testid="public-library-signin-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#553397]"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign in
              </Link>
              <Link
                to={`/register?next=${next}`}
                data-testid="public-library-register-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F5F3EC] text-[#2C2C2C] text-sm font-semibold hover:bg-[#E8E2D4]"
              >
                Create a free account
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          <div
            className="shelf-card p-10 text-center"
            data-testid="public-library-not-found"
          >
            <Library className="w-10 h-10 mx-auto mb-4 text-[#6B705C] opacity-60" />
            <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              This library isn&rsquo;t public
            </h1>
            <p className="text-sm text-[#6B705C] mb-6">
              The reader either hasn&rsquo;t shared their library publicly,
              or the @handle doesn&rsquo;t exist. If you&rsquo;re looking for
              someone you know, try the reader directory.
            </p>
            <Link
              to="/users"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#553397]"
              data-testid="public-library-find-readers-btn"
            >
              Find readers →
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const owner = data.owner || {};
  const totalBooks = data.books?.length || 0;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12 fade-in" data-testid="public-library-page">
        <Link to="/users" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6">
          <ArrowLeft className="w-4 h-4" /> Reader directory
        </Link>

        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            Public library
          </p>
          <h1
            className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05] tracking-tight"
            data-testid="public-library-owner-heading"
          >
            @{owner.username}&rsquo;s shelves.
          </h1>
          {/* 2026-06-27 Phase 2 — Owner library_mode badge.  Tells
              visitors at a glance what kind of reader they're looking
              at, and ALSO foreshadows the fandom-strip-or-not below
              so the layout doesn't feel inconsistent. */}
          {(owner.library_mode === "fanfic" || owner.library_mode === "original") && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 mt-2 mr-2 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#EEE9FB] text-[#6B46C1]"
              data-testid="public-library-owner-mode"
              title={
                owner.library_mode === "fanfic"
                  ? "This reader's library is fandom-first — pairings, fandom shelves, the works."
                  : "This reader keeps it author-first — original fiction and non-fic, fanfic chrome hidden."
              }
            >
              {owner.library_mode === "fanfic" ? "💜 Fanfic reader" : "📖 Original-fic reader"}
            </span>
          )}
          {owner.bio && (
            <p
              className="text-sm text-[#6B705C] italic mt-2 max-w-xl"
              data-testid="public-library-owner-bio"
            >
              &ldquo;{owner.bio}&rdquo;
            </p>
          )}
          <p className="text-[#6B705C] mt-3 text-base sm:text-lg flex items-center flex-wrap gap-x-3 gap-y-1">
            <span>
              <span className="font-semibold text-[#2C2C2C]" data-testid="public-library-total-books">
                {totalBooks}
              </span>{" "}
              {totalBooks === 1 ? "book" : "books"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-semibold text-[#2C2C2C]" data-testid="public-library-total-fandoms">
                {(data.top_fandoms || []).length}
              </span>{" "}
              {(data.top_fandoms || []).length === 1 ? "fandom" : "fandoms"}
            </span>
            <Link
              to={`/u/${owner.username}`}
              className="text-[#6B46C1] font-semibold inline-flex items-center gap-1 hover:underline"
              data-testid="public-library-cover-profile-link"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Cover profile
            </Link>
          </p>

          {/* Shelf-overlap "magic moment" — when a signed-in visitor
              has books in common with the owner, surface the count
              prominently so they feel the connection immediately.
              Backend computes the match server-side (case-insensitive
              title+author key) so we don't ship the visitor's whole
              library to the client. */}
          {data.viewer_is_signed_in && data.overlap_count > 0 && (
            <p
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-[#FDF6D6] text-[#7C5F1F]"
              data-testid="public-library-overlap-banner"
            >
              <Sparkles className="w-4 h-4" />
              {data.overlap_count === 1 ? (
                <>You have <span data-testid="public-library-overlap-count">1</span> book in common.</>
              ) : (
                <>You have <span data-testid="public-library-overlap-count">{data.overlap_count}</span> of these books too.</>
              )}
            </p>
          )}
        </header>

        {/* 2026-06-27 Phase 2 — Hide fandom chip strip when owner is
            an original-fic reader.  Their library legitimately has
            no fandoms; rendering a near-empty strip would look like
            a bug, not a feature. */}
        {owner.library_mode !== "original" && (data.top_fandoms || []).length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2" data-testid="public-library-fandom-chips">
            <button
              type="button"
              onClick={() => setFandomFilter("")}
              data-testid="public-library-fandom-chip-all"
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                fandomFilter === ""
                  ? "bg-[#6B46C1] text-white"
                  : "bg-[#F5F3EC] text-[#2C2C2C] hover:bg-[#E8E2D4]"
              }`}
            >
              All ({totalBooks})
            </button>
            {data.top_fandoms.map((f) => (
              <button
                key={f.fandom}
                type="button"
                onClick={() => setFandomFilter(f.fandom)}
                data-testid={`public-library-fandom-chip-${f.fandom.replace(/\s+/g, "_")}`}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                  fandomFilter === f.fandom
                    ? "bg-[#6B46C1] text-white"
                    : "bg-[#F5F3EC] text-[#2C2C2C] hover:bg-[#E8E2D4]"
                }`}
              >
                {f.fandom} ({f.count})
              </button>
            ))}
          </div>
        )}

        <div className="shelf-card p-3 mb-5 flex items-center gap-2">
          <Search className="w-4 h-4 text-[#6B705C] ml-1.5" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter this library by title or author…"
            data-testid="public-library-search"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#A09A8B]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              data-testid="public-library-search-clear"
              className="text-xs text-[#6B705C] hover:text-[#2C2C2C] px-2 py-1"
            >
              clear
            </button>
          )}
        </div>

        {visibleBooks.length === 0 ? (
          <div className="shelf-card p-10 text-center text-[#6B705C]" data-testid="public-library-empty">
            <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-60" />
            {totalBooks === 0
              ? "This reader hasn't added any books yet."
              : "No books match this filter."}
          </div>
        ) : (
          <ul
            className="shelf-card divide-y divide-[#E8E6E1] overflow-hidden"
            data-testid="public-library-list"
          >
            {visibleBooks.map((b) => (
              <li
                key={b.book_id}
                data-testid={`public-library-row-${b.book_id}`}
                className="px-4 py-3 flex items-start gap-3"
              >
                <div className="w-9 h-12 rounded bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">
                    {b.title || "Untitled"}
                  </p>
                  <p className="text-xs text-[#6B705C] truncate">
                    {b.author || "Unknown author"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {b.fandom ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EEE9FB] text-[#6B46C1] font-semibold">
                        {b.fandom}
                      </span>
                    ) : null}
                    {b.category ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F3EC] text-[#6B705C]">
                        {b.category}
                      </span>
                    ) : null}
                    {/* Per-book overlap badge — only rendered when the
                        backend marked this book as one the visitor
                        also has.  Tiny, low-contrast so it doesn't
                        scream, but unmistakable as a "you-too" mark. */}
                    {b.you_also_have && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full bg-[#FDF6D6] text-[#7C5F1F] font-semibold inline-flex items-center gap-0.5"
                        data-testid={`public-library-overlap-${b.book_id}`}
                        title="You have this book too"
                      >
                        <Sparkles className="w-2.5 h-2.5" /> You have this
                      </span>
                    )}
                  </div>
                </div>
                {/* Heart button — visible only when viewer is a
                    signed-in non-owner (data.viewer_is_signed_in true).
                    Owner sees their own books and can't heart them.
                    Anon viewers (401) never reach this branch since
                    they're redirected to the gate before render. */}
                {data.viewer_is_signed_in && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); toggleHeart(b.book_id); }}
                    data-testid={`public-library-heart-${b.book_id}`}
                    aria-pressed={!!hearts[b.book_id]}
                    aria-label={hearts[b.book_id] ? "Unheart this book" : "Heart this book"}
                    className={
                      "flex-shrink-0 p-2 rounded-full transition-colors " +
                      (hearts[b.book_id]
                        ? "bg-[#FDE2E4] text-[#C53030] hover:bg-[#FBC4C8]"
                        : "bg-transparent text-[#6B705C] hover:bg-[#F5F3EC] hover:text-[#C53030]")
                    }
                  >
                    <Heart
                      className="w-4 h-4"
                      fill={hearts[b.book_id] ? "currentColor" : "none"}
                    />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p
          className="mt-8 p-4 rounded-lg border border-[#E5DDC5] bg-[#FBFAF6] text-xs text-[#6B705C] flex items-start gap-2"
          data-testid="public-library-privacy-note"
        >
          <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#6B46C1]" />
          <span>
            This reader opted in to sharing their library publicly. Want a library of your own?{" "}
            <Link to="/" className="text-[#6B46C1] underline font-semibold">
              Start sorting with Shelfsort
            </Link>{" "}
            — it&rsquo;s free.
          </span>
        </p>
      </main>
    </div>
  );
}
