import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search, Heart, CheckCircle2, Clock } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// PAIRINGS DIRECTORY — `/library/pairings` lists every ship the user
// has in their library, sorted by book count. Click → per-pairing shelf.
// `relationships` is populated at upload time by the EPUB parser and
// canonicalized (alphabetical order, "/" delimiter) so identical ships
// from different sources group correctly.
export function PairingsDirectory() {
  const navigate = useNavigate();
  const [pairings, setPairings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/pairings");
        if (!cancelled) setPairings(data?.pairings || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return pairings;
    return pairings.filter((p) => (p.pairing || "").toLowerCase().includes(needle));
  }, [pairings, search]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="pairings-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>
        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Heart className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Pairings</h1>
            <p className="text-sm text-[#6B705C] mt-1 max-w-2xl">
              Every relationship Shelfsort extracted from your library, sorted by how many books feature each ship. Click any pairing to see the books.
            </p>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex items-center gap-4" data-testid="pairings-summary">
          <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="pairings-count">
            {pairings.length}
          </div>
          <div className="text-xs text-[#6B705C] uppercase tracking-wide">
            distinct pairing{pairings.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B705C]" />
          <input
            type="search"
            data-testid="pairings-search"
            placeholder="Search pairings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            {pairings.length === 0
              ? "No pairings detected yet — upload fanfic EPUBs and Shelfsort will extract their relationships automatically."
              : <p className="text-sm italic">No pairings match your filter.</p>}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="pairings-list">
            {filtered.map((p) => (
              <li key={p.pairing}>
                <button
                  onClick={() => navigate(`/library/by-pairing/${encodeURIComponent(p.pairing)}`)}
                  data-testid={`pairings-row-${p.pairing}`}
                  className="shelf-card p-3 w-full text-left hover:bg-[#F5F3EC] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-[#2C2C2C] font-mono text-sm">
                      <Heart className="w-3.5 h-3.5 text-[#6B46C1] flex-shrink-0" aria-hidden="true" />
                      {p.pairing}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-full bg-[#6B46C1]/10 text-[#6B46C1] flex-shrink-0">
                      {p.count} book{p.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  {(p.sample_titles || []).length > 0 && (
                    <div className="text-xs text-[#6B705C] italic truncate">
                      e.g. {p.sample_titles.slice(0, 3).map((t) => `"${t}"`).join(", ")}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}


// PER-PAIRING SHELF — `/library/by-pairing/:pairing` lists every book
// featuring the given relationship.
export function PairingShelf() {
  const { pairing: pairingParam } = useParams();
  const navigate = useNavigate();
  const pairing = decodeURIComponent(pairingParam || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/library/by-pairing?pairing=${encodeURIComponent(pairing)}`);
        if (!cancelled) setBooks(data?.books || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [pairing]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library/pairings")}
          data-testid="pairing-shelf-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All pairings
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Heart className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#6B705C] uppercase tracking-wide">Pairing</p>
            <h1 className="font-serif text-3xl text-[#2C2C2C] font-mono" data-testid="pairing-shelf-name">{pairing}</h1>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex items-center gap-4">
          <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="pairing-shelf-count">{books.length}</div>
          <div className="text-xs text-[#6B705C] uppercase tracking-wide">book{books.length === 1 ? "" : "s"}</div>
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : books.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C] italic text-sm">
            No books for this pairing.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="pairing-shelf-list">
            {books.map((b) => {
              const isOngoing = b.effective_status === "ongoing";
              return (
                <li
                  key={b.book_id}
                  className="shelf-card p-3"
                  data-testid={`pairing-shelf-book-${b.book_id}`}
                >
                  <button
                    onClick={() => navigate(`/book/${b.book_id}`)}
                    className="text-left w-full hover:bg-[#F5F3EC] rounded-md p-1 -m-1 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-medium text-[#2C2C2C]">{b.title || "Untitled"}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                          isOngoing
                            ? "bg-[#F8E8D8] text-[#9E5A2E]"
                            : "bg-[#EEE9FB] text-[#6B46C1]"
                        }`}
                      >
                        {isOngoing
                          ? <><Clock className="w-3 h-3" /> Ongoing</>
                          : <><CheckCircle2 className="w-3 h-3" /> Finished</>}
                      </span>
                    </div>
                    <div className="text-xs text-[#6B705C]">
                      {b.author || "Unknown"}
                      {b.fandom ? <> · {b.fandom}</> : null}
                      {b.category ? <> · {b.category}</> : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
