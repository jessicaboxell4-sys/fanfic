import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Library, Search, BookOpen, Sparkles, ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Public, no-auth-required read-only view of someone's library.
// Reached via /u/:username/library — only renders when the target
// user has flipped on `library_visible_to_public` in their Privacy
// settings.  Otherwise the backend returns 404 and we render a
// friendly "library is private" empty state.
//
// Privacy invariants:
//   - Only title/author/fandom/category surface — no files, no AV
//     status, no download links.
//   - The owner's email is never returned by the API.
//   - 404 (not 403) is returned for both "doesn't exist" and "not
//     public", so this page can't be used to enumerate handles.
export default function PublicLibraryView() {
  const { username } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [q, setQ] = useState("");
  const [fandomFilter, setFandomFilter] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const { data: payload } = await api.get(`/users/${username}/public-library`);
        if (alive) {
          setData(payload);
          document.title = `@${payload.owner.username}'s library · Shelfsort`;
        }
      } catch (e) {
        if (alive) {
          setNotFound(true);
          document.title = `Library not found · Shelfsort`;
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
        </header>

        {(data.top_fandoms || []).length > 0 && (
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
                  </div>
                </div>
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
