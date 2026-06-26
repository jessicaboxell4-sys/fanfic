import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Library, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// Anon-accessible discovery page for a single fandom.  Reached via
// /explore/fandom/:fandom — lists every opted-in user who has ≥1
// book in that fandom, sorted by per-user book count.  Built as
// Group B of the 2026-06-26 library-social bundle.
export default function FandomDiscoveryPage() {
  const { fandom } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const { data: payload } = await api.get(`/library/discover/by-fandom/${encodeURIComponent(fandom)}`);
        if (alive) {
          setData(payload);
          document.title = `${payload.fandom} readers · Shelfsort`;
        }
      } catch (e) {
        if (alive) {
          setNotFound(true);
          document.title = `Fandom not found · Shelfsort`;
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fandom]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center text-[#6B705C]">
          <Loader2 className="w-8 h-8 mx-auto mb-3 opacity-50 animate-spin" />
          Loading…
        </main>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          <div className="shelf-card p-10 text-center" data-testid="fandom-discovery-not-found">
            <Library className="w-10 h-10 mx-auto mb-4 text-[#6B705C] opacity-60" />
            <h1 className="font-serif text-2xl text-[#2C2C2C] mb-2">
              Fandom not found
            </h1>
            <p className="text-sm text-[#6B705C] mb-6">
              No public libraries match this fandom yet.
            </p>
            <Link
              to="/users"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#6B46C1] text-white text-sm font-semibold hover:bg-[#553397]"
            >
              Browse all readers →
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main
        className="max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12 fade-in"
        data-testid="fandom-discovery-page"
      >
        <Link to="/users" className="inline-flex items-center gap-1 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6">
          <ArrowLeft className="w-4 h-4" /> Reader directory
        </Link>

        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B46C1] mb-3">
            Explore fandom
          </p>
          <h1
            className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-[1.05] tracking-tight"
            data-testid="fandom-discovery-heading"
          >
            {data.fandom}
          </h1>
          <p className="text-[#6B705C] mt-3 text-base sm:text-lg">
            <span className="font-semibold text-[#2C2C2C]" data-testid="fandom-discovery-count">
              {data.total}
            </span>{" "}
            public {data.total === 1 ? "library" : "libraries"} with at least one book in this fandom.
          </p>
        </header>

        {data.users.length === 0 ? (
          <div className="shelf-card p-10 text-center text-[#6B705C]" data-testid="fandom-discovery-empty">
            <Library className="w-8 h-8 mx-auto mb-3 opacity-60" />
            Nobody has shared a public library with this fandom yet.
          </div>
        ) : (
          <ul
            className="shelf-card divide-y divide-[#E8E6E1] overflow-hidden"
            data-testid="fandom-discovery-list"
          >
            {data.users.map((u) => (
              <li
                key={u.username}
                data-testid={`fandom-discovery-row-${u.username}`}
                className="px-4 py-3 flex items-start gap-3"
              >
                {u.picture ? (
                  <img src={u.picture} alt={`@${u.username}`} className="w-10 h-10 rounded-full flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#EEE9FB] text-[#6B46C1] flex items-center justify-center font-serif text-base flex-shrink-0">
                    {(u.username || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#2C2C2C] truncate">@{u.username}</p>
                  <p className="text-xs text-[#6B705C]">
                    <span className="font-semibold text-[#2C2C2C]">{u.books_in_fandom}</span>{" "}
                    {u.books_in_fandom === 1 ? "book" : "books"} in {data.fandom}
                  </p>
                  {u.bio ? <p className="text-xs text-[#6B705C] italic mt-1 line-clamp-1">&ldquo;{u.bio}&rdquo;</p> : null}
                </div>
                <Link
                  to={`/u/${u.username}/library`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#EEE9FB] text-[#6B46C1] hover:bg-[#DDD1F3] flex-shrink-0 transition-colors"
                  data-testid={`fandom-discovery-library-link-${u.username}`}
                >
                  <BookOpen className="w-3 h-3" /> Library
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
