import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, FileText, Filter, Library as LibraryIcon } from "lucide-react";
import { api } from "../lib/api";
import Navbar from "../components/Navbar";

// "Linkless library" — books that have NO embedded fanfic-source URLs.
// Useful for finding hand-curated EPUBs, scanned originals, or imports from
// sites we don't recognize, since these never dedupe against a URL list.
export default function LinklessShelf() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/library/linkless");
        if (!cancelled) {
          setBooks(data?.books || []);
          setByCategory(data?.by_category || {});
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return books.filter((b) => {
      if (categoryFilter && (b.category || "") !== categoryFilter) return false;
      if (!needle) return true;
      return (
        (b.title || "").toLowerCase().includes(needle) ||
        (b.author || "").toLowerCase().includes(needle) ||
        (b.fandom || "").toLowerCase().includes(needle)
      );
    });
  }, [books, search, categoryFilter]);

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate("/library")}
          data-testid="linkless-back"
          className="flex items-center gap-2 text-sm text-[#5B5F4D] hover:text-[#2C2C2C] mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <header className="mb-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#6B46C1]/10 text-[#6B46C1] flex items-center justify-center flex-shrink-0">
            <LibraryIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-[#2C2C2C]">Linkless library</h1>
            <p className="text-sm text-[#5B5F4D] mt-1 max-w-2xl">
              Books with no embedded source URL — typically hand-curated EPUBs, scanned originals, or imports from sources Shelfsort doesn&apos;t recognize. These never dedupe against a pasted URL list, so it&apos;s worth keeping an eye on them.
            </p>
          </div>
        </header>

        {/* Stats + filters */}
        <div className="shelf-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="linkless-summary">
          <div className="flex-shrink-0">
            <div className="font-serif text-3xl text-[#2C2C2C]" data-testid="linkless-count">{books.length}</div>
            <div className="text-xs text-[#5B5F4D] uppercase tracking-wide">linkless book{books.length === 1 ? "" : "s"}</div>
          </div>
          {Object.keys(byCategory).length > 0 && (
            <div className="flex flex-wrap gap-2 items-center" data-testid="linkless-by-category">
              <button
                onClick={() => setCategoryFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${categoryFilter === "" ? "bg-[#E07A5F] text-white border-[#E07A5F]" : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"}`}
              >
                All · {books.length}
              </button>
              {Object.entries(byCategory).map(([cat, n]) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat === categoryFilter ? "" : cat)}
                  data-testid={`linkless-cat-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${categoryFilter === cat ? "bg-[#6B46C1] text-white border-[#6B46C1]" : "bg-white text-[#2C2C2C] border-[#E5DDC5] hover:bg-[#F5F3EC]"}`}
                >
                  {cat} · {n}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5B5F4D]" />
          <input
            type="search"
            data-testid="linkless-search"
            placeholder="Search title, author, or fandom…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E5DDC5] bg-white focus:outline-none focus:border-[#E07A5F]/60"
          />
        </div>

        {loading ? (
          <p className="text-[#5B5F4D] italic text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="shelf-card p-8 text-center text-[#5B5F4D]">
            {books.length === 0 ? (
              <>
                <FileText className="w-10 h-10 mx-auto mb-3 text-[#6B46C1]" />
                <p className="font-medium text-[#2C2C2C] mb-1">Every book has a source URL.</p>
                <p className="text-sm">Nice — your library is fully traceable back to its sources.</p>
              </>
            ) : (
              <p className="text-sm italic">No books match your filter.</p>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="linkless-list">
            {filtered.map((b) => (
              <li
                key={b.book_id}
                onClick={() => navigate(`/book/${b.book_id}`)}
                className="shelf-card p-4 cursor-pointer hover:border-[#E07A5F]/50 transition-colors"
                data-testid={`linkless-book-${b.book_id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[#2C2C2C] truncate">{b.title || "Untitled"}</div>
                    <div className="text-xs text-[#5B5F4D] truncate">
                      {b.author || "Unknown author"}
                      {b.fandom && <> · {b.fandom}</>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E5DDC5]/60 text-[#2C2C2C] uppercase tracking-wide whitespace-nowrap">
                      {b.category || "Uncategorized"}
                    </span>
                    {b.original_format && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] uppercase tracking-wide whitespace-nowrap">
                        {b.original_format}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
