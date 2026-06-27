import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search, Users, CheckCircle2, Clock } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// CHARACTERS DIRECTORY — `/library/characters` lists every character
// Shelfsort can derive from the user's library, sorted by book count.
// Characters are inferred at query time by splitting each book's
// `relationships` field on AO3's `/` and ` & ` separators (see
// `backend/routes/characters.py`).  No re-parse of EPUBs required —
// works on every book in the DB today.
export function CharactersDirectory() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/characters");
        if (!cancelled) setCharacters(data?.characters || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return characters;
    return characters.filter((c) => (c.name || "").toLowerCase().includes(needle));
  }, [characters, search]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="characters-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>
        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Characters</h1>
            <p className="text-sm text-[#6B705C] mt-1 max-w-2xl">
              Every character Shelfsort can pull from your library's pairings, sorted by how many books feature them. Click any character to see the books.
            </p>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex items-center gap-4" data-testid="characters-summary">
          <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="characters-count">
            {characters.length}
          </div>
          <div className="text-xs text-[#6B705C] uppercase tracking-wide">
            distinct character{characters.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B705C]" />
          <input
            type="search"
            data-testid="characters-search"
            placeholder="Search characters…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#6B46C1]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C]">
            {characters.length === 0
              ? "No characters detected yet — upload fanfic EPUBs with relationships tagged and Shelfsort will derive characters automatically."
              : <p className="text-sm italic">No characters match your filter.</p>}
          </div>
        ) : (
          <ul className="space-y-2" data-testid="characters-list">
            {filtered.map((c) => (
              <li key={c.name}>
                <button
                  onClick={() => navigate(`/library/by-character/${encodeURIComponent(c.name)}`)}
                  data-testid={`characters-row-${c.name}`}
                  className="shelf-card p-3 w-full text-left hover:bg-[#F5F3EC] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-[#2C2C2C] text-sm">
                      <Users className="w-3.5 h-3.5 text-[#6B46C1] flex-shrink-0" aria-hidden="true" />
                      {c.name}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-full bg-[#6B46C1]/10 text-[#6B46C1] flex-shrink-0">
                      {c.count} book{c.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  {((c.fandoms || []).length > 0 || (c.sample_titles || []).length > 0) && (
                    <div className="text-xs text-[#6B705C] italic truncate">
                      {(c.fandoms || []).slice(0, 2).join(" · ")}
                      {(c.fandoms || []).length > 0 && (c.sample_titles || []).length > 0 ? " — " : ""}
                      {(c.sample_titles || []).slice(0, 2).map((t) => `"${t}"`).join(", ")}
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


// PER-CHARACTER SHELF — `/library/by-character/:character` lists every
// book whose relationships array references the given character.
export function CharacterShelf() {
  const { character: characterParam } = useParams();
  const navigate = useNavigate();
  const character = decodeURIComponent(characterParam || "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/library/by-character?character=${encodeURIComponent(character)}`);
        if (!cancelled) setBooks(data?.books || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [character]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library/characters")}
          data-testid="character-shelf-back"
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All characters
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#6B705C] uppercase tracking-wide">Character</p>
            <h1 className="font-serif text-3xl text-[#2C2C2C]" data-testid="character-shelf-name">{character}</h1>
          </div>
        </header>

        <div className="shelf-card p-5 mb-6 flex items-center gap-4">
          <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="character-shelf-count">{books.length}</div>
          <div className="text-xs text-[#6B705C] uppercase tracking-wide">book{books.length === 1 ? "" : "s"}</div>
        </div>

        {loading ? (
          <p className="text-[#6B705C] italic text-sm">Loading…</p>
        ) : books.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#6B705C] italic text-sm">
            No books for this character.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="character-shelf-list">
            {books.map((b) => {
              const isOngoing = b.effective_status === "ongoing";
              return (
                <li
                  key={b.book_id}
                  className="shelf-card p-3"
                  data-testid={`character-shelf-book-${b.book_id}`}
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
